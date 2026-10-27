<script lang="ts">
  /*
   * Dev-only test bench for the media engine (/dev/media-lab). Load fixtures or drop files,
   * then exercise each API by hand, or press "Run smoke tests" for a pass/fail table.
   */
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import { drawOverlay, runSmoke as runSmokeTests, testImages } from './smoke';
  import {
    capabilities,
    computePeaks,
    concat,
    containers,
    decodeAudio,
    decodeGif,
    downloadName,
    encodeAudio,
    ensureDecodable,
    extractFrames,
    formatBitrate,
    formatBytes,
    formatTime,
    frameAt,
    bitmapToBlob,
    gifToVideo,
    imagesToVideo,
    preloadFallback,
    probe,
    transcode,
    videoToGif,
    type Container,
    type MediaInfo,
    type Peaks,
    type Segment,
    type TranscodeOptions,
    type VideoCodec,
    type AudioCodec,
    type QualityLevel,
    type Rotation,
  } from '@/engines/media';

  const FIXTURES = ['sample.mp4', 'sample.webm', 'sample.mov', 'sample.mp3', 'sample.wav', 'sample.gif', 'sample.avi'];

  interface Output {
    id: number;
    label: string;
    ms: number;
    blob: Blob;
    url: string;
    name: string;
    detail: string;
    notes: string[];
  }

  let files = $state<File[]>([]);
  let active = $state(0);
  let info = $state<MediaInfo | null>(null);
  let infoText = $state('');
  let capsText = $state('');
  let previewUrl = $state('');
  let previewFile = $state<Blob | null>(null);
  let mediaEl = $state<HTMLMediaElement | null>(null);
  let start = $state(0);
  let end = $state(0);
  let currentTime = $state(0);
  let timelineMode = $state<'trim' | 'segments'>('trim');
  let segments = $state<Segment[]>([]);
  let outputs = $state<Output[]>([]);
  let busy = $state('');
  let progress = $state(0);
  let status = $state('');
  let error = $state('');
  let controller: AbortController | null = null;
  let frames = $state<{ time: number; url: string }[]>([]);
  let peaks = $state<Peaks | null>(null);
  let smoke = $state<{ name: string; ok: boolean | null; ms: number; detail: string }[]>([]);
  let outId = 0;

  // transcode form
  let container = $state<Container>('mp4');
  let vcodec = $state<'' | VideoCodec>('');
  let width = $state<number | null>(null);
  let height = $state<number | null>(null);
  let fit = $state<'contain' | 'cover' | 'fill'>('contain');
  let cropPreset = $state<'none' | '9:16' | '1:1'>('none');
  let rotate = $state<Rotation>(0);
  let flipH = $state(false);
  let flipV = $state(false);
  let fps = $state<number | null>(null);
  let quality = $state<'' | QualityLevel>('');
  let vbitrate = $state<number | null>(null);
  let targetMB = $state<number | null>(null);
  let speed = $state(1);
  let useTrim = $state(true);
  let audioMode = $state<'keep' | 'mute' | 'replace'>('keep');
  let acodec = $state<'' | AudioCodec>('');
  let abitrate = $state<number | null>(null);
  let gain = $state(0);
  let overlay = $state(false);
  let engine = $state<'auto' | 'ffmpeg'>('auto');
  let frameCount = $state(8);
  let encodeFormat = $state<'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'webm'>('mp3');

  const file = $derived(files[active] ?? null);
  const isAudio = $derived(!!info && !info.video);

  async function loadFixture(name: string) {
    const res = await fetch(`/tests/fixtures/media/${name}`);
    const blob = await res.blob();
    addFiles([new File([blob], name, { type: blob.type, lastModified: Date.now() })]);
  }

  function addFiles(list: File[]) {
    files = [...files, ...list];
    select(files.length - list.length);
  }

  async function select(i: number) {
    active = i;
    const f = files[i];
    info = null;
    infoText = 'probing…';
    peaks = null;
    frames = [];
    segments = [];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    previewFile = null;
    if (!f) return;
    const t0 = performance.now();
    try {
      info = await probe(f);
      infoText = `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(info, null, 2)}`;
      start = 0;
      end = info.durationSec;
      if (!info.needsFallback && f.type !== 'image/gif') usePreview(f);
    } catch (e) {
      infoText = `probe failed: ${(e as Error).message}`;
    }
  }

  function usePreview(blob: Blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    previewFile = blob;
  }

  function addOutput(label: string, ms: number, blob: Blob, name: string, detail = '', notes: string[] = []) {
    outputs = [{ id: ++outId, label, ms, blob, url: URL.createObjectURL(blob), name, detail, notes }, ...outputs];
  }

  async function task<T>(label: string, fn: (ctl: { signal: AbortSignal; onProgress: (p: number) => void; onStatus: (s: string) => void }) => Promise<T>): Promise<T | undefined> {
    controller = new AbortController();
    busy = label;
    progress = 0;
    status = '';
    error = '';
    try {
      return await fn({ signal: controller.signal, onProgress: (p) => (progress = p), onStatus: (s) => (status = s) });
    } catch (e) {
      error = `${label}: [${(e as { code?: string }).code ?? 'error'}] ${(e as Error).message}`;
      console.error(e);
    } finally {
      busy = '';
      controller = null;
    }
  }

  function cropRect(w: number, h: number) {
    if (cropPreset === 'none') return undefined;
    const ratio = cropPreset === '9:16' ? 9 / 16 : 1;
    const cw = Math.min(w, Math.round(h * ratio));
    const ch = Math.min(h, Math.round(cw / ratio));
    return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch };
  }


  function buildOptions(): TranscodeOptions {
    const rotated = rotate === 90 || rotate === 270;
    const dw = info?.video ? (rotated ? info.video.displayHeight : info.video.displayWidth) : 0;
    const dh = info?.video ? (rotated ? info.video.displayWidth : info.video.displayHeight) : 0;
    const replacement = files.find((_, i) => i !== active);
    return {
      container,
      trim: useTrim ? { start, end } : undefined,
      video: {
        codec: vcodec || undefined,
        width: width ?? undefined,
        height: height ?? undefined,
        fit,
        crop: info?.video ? cropRect(dw, dh) : undefined,
        rotate,
        flipHorizontal: flipH,
        flipVertical: flipV,
        fps: fps ?? undefined,
        quality: quality || undefined,
        bitrate: vbitrate ? vbitrate * 1000 : undefined,
        targetSizeBytes: targetMB ? targetMB * 1e6 : undefined,
        speed: speed !== 1 ? speed : undefined,
        overlay: overlay ? drawOverlay : undefined,
      },
      audio:
        audioMode === 'mute'
          ? false
          : { codec: acodec || undefined, bitrate: abitrate ? abitrate * 1000 : undefined, gainDb: gain || undefined, replace: audioMode === 'replace' ? replacement : undefined },
    };
  }

  async function runTranscode() {
    if (!file) return;
    const opts = buildOptions();
    const t0 = performance.now();
    const r = await task('transcode', (ctl) => transcode(file, opts, { ...ctl, engine }));
    if (!r) return;
    const out = await probe(r.blob).catch(() => null);
    addOutput(
      `transcode → ${container}`,
      performance.now() - t0,
      r.blob,
      downloadName(file.name, r.container),
      `${r.mimeWithCodecs} · ${r.width ?? '–'}×${r.height ?? '–'} · ${formatTime(r.durationSec)} · via ${r.via}${out ? ` · probed ${formatTime(out.durationSec)} ${out.video ? `${out.video.displayWidth}×${out.video.displayHeight} ${out.video.codec}` : ''} ${out.audio?.codec ?? ''}` : ''}`,
      r.notes,
    );
  }

  async function runFrames() {
    if (!file) return;
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    frames = [];
    const t0 = performance.now();
    await task('frames', (ctl) =>
      extractFrames(file, { count: frameCount, height: 120, start: useTrim ? start : undefined, end: useTrim ? end : undefined }, {
        ...ctl,
        onFrame: async (f) => {
          const url = URL.createObjectURL(await bitmapToBlob(f.bitmap, 'image/jpeg', 0.8));
          f.bitmap.close();
          frames = [...frames, { time: f.time, url }];
        },
      }),
    );
    status = `${frames.length} frames in ${Math.round(performance.now() - t0)} ms`;
  }

  async function runFrameAt() {
    if (!file) return;
    const t0 = performance.now();
    const bmp = await task('frameAt', (ctl) => frameAt(file, currentTime, {}, ctl));
    if (!bmp) return;
    const png = await bitmapToBlob(bmp);
    addOutput(`frame @ ${formatTime(currentTime)}`, performance.now() - t0, png, downloadName(file.name, 'png', `-${currentTime.toFixed(2)}s`), `${bmp.width}×${bmp.height}`);
  }

  let pcm: Awaited<ReturnType<typeof decodeAudio>> | null = null;
  async function runDecodeAudio() {
    if (!file) return;
    const t0 = performance.now();
    const r = await task('decodeAudio', (ctl) => decodeAudio(file, useTrim ? { start, end } : {}, ctl));
    if (!r) return;
    pcm = r;
    const ms = performance.now() - t0;
    const t1 = performance.now();
    peaks = computePeaks(r, 1200);
    status = `decoded ${r.channels.length} ch · ${r.sampleRate} Hz · ${formatTime(r.channels[0].length / r.sampleRate)} in ${Math.round(ms)} ms · peaks in ${Math.round(performance.now() - t1)} ms`;
  }

  async function runEncodeAudio() {
    if (!pcm) await runDecodeAudio();
    if (!pcm || !file) return;
    const source = pcm;
    const t0 = performance.now();
    const blob = await task('encodeAudio', (ctl) => encodeAudio(source, { format: encodeFormat, bitrate: abitrate ? abitrate * 1000 : undefined }, ctl));
    if (blob) addOutput(`encodeAudio → ${encodeFormat}`, performance.now() - t0, blob, downloadName(file.name, encodeFormat === 'webm' ? 'webm' : encodeFormat));
  }

  async function runGif() {
    if (!file) return;
    const t0 = performance.now();
    if (info?.container === 'gif') {
      const r = await task('gifToVideo', (ctl) => gifToVideo(file, { container: 'mp4', repeat: 2 }, ctl));
      if (r) addOutput('gif → mp4', performance.now() - t0, r.blob, downloadName(file.name, 'mp4'), `${r.width}×${r.height} · ${formatTime(r.durationSec)}`);
      const g = await task('decodeGif', (ctl) => decodeGif(file, ctl));
      if (g) status = `decodeGif: ${g.frames.length} frames, ${g.width}×${g.height}, ${g.frames.reduce((s, f) => s + f.delayMs, 0)} ms total`;
      return;
    }
    const blob = await task('videoToGif', (ctl) => videoToGif(file, { fps: 12, width: 360, start: useTrim ? start : 0, end: useTrim ? Math.min(end, start + 6) : 6 }, ctl));
    if (blob) addOutput('video → gif', performance.now() - t0, blob, downloadName(file.name, 'gif'));
  }

  async function runConcat(target: 'mp4' | 'mp3') {
    if (files.length < 2) return void (error = 'Load at least two files to join.');
    const t0 = performance.now();
    const r = await task('concat', (ctl) => concat(files, { container: target }, ctl));
    if (r) addOutput(`concat ${files.length} → ${target}`, performance.now() - t0, r.blob, `joined.${target}`, `${r.width ?? ''}×${r.height ?? ''} · ${formatTime(r.durationSec)}`);
  }


  async function runSlideshow() {
    const images = files.filter((f) => f.type.startsWith('image/') && f.type !== 'image/gif');
    const soundtrack = files.find((f) => f.type.startsWith('audio/'));
    const t0 = performance.now();
    const r = await task('imagesToVideo', async (ctl) =>
      imagesToVideo(images.length ? images : await testImages(), { width: 720, height: 1280, durations: 1.5, transition: 'fade', kenBurns: true, audio: soundtrack }, ctl),
    );
    if (r) addOutput('slideshow → mp4', performance.now() - t0, r.blob, 'slideshow.mp4', `${r.width}×${r.height} · ${formatTime(r.durationSec)}${soundtrack ? ' · with audio' : ''}`);
  }

  async function runCaps() {
    const t0 = performance.now();
    const c = await task('capabilities', () => capabilities());
    if (c) capsText = `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(c, null, 2)}`;
  }

  async function runFallbackProbe() {
    if (!file) return;
    const r = await task('probe+ffmpeg', (ctl) => probe(file, { ...ctl, fallback: true }));
    if (r) infoText = JSON.stringify(r, null, 2);
  }

  async function runEnsure() {
    if (!file) return;
    const t0 = performance.now();
    const r = await task('ensureDecodable', (ctl) => ensureDecodable(file, ctl));
    if (!r) return;
    usePreview(r.file);
    info = r.info;
    if (r.converted) addOutput('ensureDecodable', performance.now() - t0, r.file, downloadName(file.name, 'mkv'), `converted · ${JSON.stringify({ v: r.info.video?.codec, a: r.info.audio?.codec })}`);
    status = r.converted ? 'converted with ffmpeg.wasm; preview now plays the converted copy' : 'already decodable';
  }

  // ---------------------------------------------------------------- smoke tests

  async function runSmoke() {
    busy = 'smoke tests';
    try {
      await runSmokeTests({
        keep: (label, blob, ext) => addOutput(`smoke: ${label}`, 0, blob, `smoke-${label.replace(/W+/g, '-')}.${ext}`),
        onStatus: (s) => (status = s),
        onUpdate: (rows) => (smoke = rows),
      });
    } finally {
      busy = '';
    }
  }

  const kindOf = (b: Blob) => (b.type.startsWith('video/') ? 'video' : b.type.startsWith('audio/') ? 'audio' : b.type.startsWith('image/') ? 'image' : 'file');
</script>

<div class="lab">
  <section class="card pad">
    <div class="row">
      <h2>Inputs</h2>
      <div class="row gap">
        {#each FIXTURES as f}
          <button type="button" class="btn sm" onclick={() => loadFixture(f)}>{f}</button>
        {/each}
      </div>
    </div>
    <Dropzone multiple title="Drop media" hint="video, audio, gif or images" onfiles={addFiles} />
    {#if files.length}
      <div class="row gap files">
        {#each files as f, i}
          <button type="button" class="seg-btn mono" aria-pressed={i === active} onclick={() => select(i)}>{f.name} · {formatBytes(f.size)}</button>
        {/each}
        <button type="button" class="btn sm" onclick={() => ((files = []), (info = null), (infoText = ''))}>clear</button>
      </div>
    {/if}
  </section>

  <section class="card pad">
    <div class="row">
      <h2>Automated smoke tests</h2>
      <button type="button" class="btn btn-primary" onclick={runSmoke} disabled={!!busy}>Run smoke tests</button>
    </div>
    <p class="mono">Runs every API on the fixtures and checks the outputs by probing them. The AVI tests download ffmpeg.wasm (~31 MB) once.</p>
    {#if smoke.length}
      <table class="smoke mono">
        <tbody>
          {#each smoke as t}
            <tr class:ok={t.ok === true} class:bad={t.ok === false}>
              <td>{t.ok === null ? '…' : t.ok ? 'PASS' : 'FAIL'}</td>
              <td>{t.name}</td>
              <td>{t.ms ? `${Math.round(t.ms)} ms` : ''}</td>
              <td>{t.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="mono" data-testid="smoke-summary">
        {smoke.filter((t) => t.ok).length} passed · {smoke.filter((t) => t.ok === false).length} failed · {smoke.filter((t) => t.ok === null).length} pending
      </p>
    {/if}
  </section>

  {#if file}
    <section class="card pad">
      <div class="row">
        <h2>{file.name}</h2>
        <div class="row gap">
          <button type="button" class="btn sm" onclick={runCaps}>capabilities</button>
          <button type="button" class="btn sm" onclick={runFallbackProbe}>probe via ffmpeg</button>
          <button type="button" class="btn sm" onclick={runEnsure}>ensureDecodable</button>
          <button type="button" class="btn sm" onclick={() => task('preload', (ctl) => preloadFallback((p) => ctl.onStatus(`downloading ${Math.round(p * 100)}%`)))}>preload ffmpeg</button>
        </div>
      </div>
      <div class="grid2">
        <pre class="mono">{infoText}</pre>
        <pre class="mono">{capsText || 'capabilities: press the button'}</pre>
      </div>
    </section>

    {#if info && previewUrl}
      <section class="card pad">
        <div class="row">
          <h2>Timeline</h2>
          <div class="seg">
            <button type="button" aria-pressed={timelineMode === 'trim'} onclick={() => (timelineMode = 'trim')}>trim</button>
            <button type="button" aria-pressed={timelineMode === 'segments'} onclick={() => (timelineMode = 'segments')}>segments (cut)</button>
          </div>
        </div>
        {#if isAudio}
          <audio bind:this={mediaEl} src={previewUrl} controls class="player"></audio>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={mediaEl} src={previewUrl} controls playsinline class="player"></video>
        {/if}
        {#key previewFile}
          <TrimTimeline
            file={previewFile}
            duration={info.durationSec}
            media={mediaEl}
            mode={timelineMode}
            segmentKind="cut"
            bind:start
            bind:end
            bind:segments
            bind:currentTime
            step={info.video?.fps ? 1 / info.video.fps : 0.01}
          />
        {/key}
        <p class="mono">start {start.toFixed(3)} · end {end.toFixed(3)} · playhead {currentTime.toFixed(3)} · segments {JSON.stringify(segments.map((s) => [+s.start.toFixed(2), +s.end.toFixed(2)]))}</p>
      </section>
    {/if}

    <section class="card pad">
      <h2>Transcode</h2>
      <div class="form">
        <label><span class="label">container</span>
          <select class="field" bind:value={container}>{#each Object.keys(containers) as c}<option>{c}</option>{/each}</select>
        </label>
        <label><span class="label">video codec</span>
          <select class="field" bind:value={vcodec}><option value="">auto / copy</option>{#each ['avc', 'hevc', 'vp9', 'av1', 'vp8'] as c}<option>{c}</option>{/each}</select>
        </label>
        <label><span class="label">width</span><input class="field" type="number" bind:value={width} placeholder="auto" /></label>
        <label><span class="label">height</span><input class="field" type="number" bind:value={height} placeholder="auto" /></label>
        <label><span class="label">fit</span>
          <select class="field" bind:value={fit}><option>contain</option><option>cover</option><option>fill</option></select>
        </label>
        <label><span class="label">crop</span>
          <select class="field" bind:value={cropPreset}><option value="none">none</option><option value="9:16">center 9:16</option><option value="1:1">center 1:1</option></select>
        </label>
        <label><span class="label">rotate</span>
          <select class="field" bind:value={rotate}>{#each [0, 90, 180, 270] as r}<option value={r}>{r}°</option>{/each}</select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={flipH} /> flip H</label>
        <label class="check"><input type="checkbox" bind:checked={flipV} /> flip V</label>
        <label><span class="label">fps cap</span><input class="field" type="number" bind:value={fps} placeholder="source" /></label>
        <label><span class="label">quality</span>
          <select class="field" bind:value={quality}><option value="">default</option>{#each ['very-low', 'low', 'medium', 'high', 'very-high'] as q}<option>{q}</option>{/each}</select>
        </label>
        <label><span class="label">video kbps</span><input class="field" type="number" bind:value={vbitrate} /></label>
        <label><span class="label">target MB</span><input class="field" type="number" step="0.1" bind:value={targetMB} /></label>
        <label><span class="label">speed</span><input class="field" type="number" step="0.25" min="0.25" max="4" bind:value={speed} /></label>
        <label class="check"><input type="checkbox" bind:checked={useTrim} /> use timeline trim</label>
        <label><span class="label">audio</span>
          <select class="field" bind:value={audioMode}><option value="keep">keep</option><option value="mute">mute</option><option value="replace">replace (next file)</option></select>
        </label>
        <label><span class="label">audio codec</span>
          <select class="field" bind:value={acodec}><option value="">auto / copy</option>{#each ['aac', 'opus', 'mp3', 'flac', 'vorbis', 'pcm-s16', 'pcm-s24', 'pcm-f32'] as c}<option>{c}</option>{/each}</select>
        </label>
        <label><span class="label">audio kbps</span><input class="field" type="number" bind:value={abitrate} /></label>
        <label><span class="label">gain dB</span><input class="field" type="number" bind:value={gain} /></label>
        <label class="check"><input type="checkbox" bind:checked={overlay} /> overlay hook (main thread)</label>
        <label><span class="label">engine</span>
          <select class="field" bind:value={engine}><option value="auto">auto</option><option value="ffmpeg">ffmpeg (forced)</option></select>
        </label>
      </div>
      <div class="row gap actions">
        <button type="button" class="btn btn-primary" onclick={runTranscode} disabled={!!busy}>Transcode</button>
        <button type="button" class="btn" onclick={runGif} disabled={!!busy}>{info?.container === 'gif' ? 'GIF → MP4 + decodeGif' : 'Video → GIF'}</button>
        <button type="button" class="btn" onclick={() => runConcat('mp4')} disabled={!!busy}>Concat all → mp4</button>
        <button type="button" class="btn" onclick={() => runConcat('mp3')} disabled={!!busy}>Concat all → mp3</button>
        <button type="button" class="btn" onclick={runSlideshow} disabled={!!busy}>Slideshow</button>
      </div>
    </section>

    <section class="card pad">
      <h2>Frames & audio</h2>
      <div class="row gap actions">
        <label class="inline"><span class="label">count</span><input class="field" type="number" bind:value={frameCount} /></label>
        <button type="button" class="btn" onclick={runFrames} disabled={!!busy}>extractFrames</button>
        <button type="button" class="btn" onclick={runFrameAt} disabled={!!busy}>frameAt(playhead) → PNG</button>
        <button type="button" class="btn" onclick={runDecodeAudio} disabled={!!busy}>decodeAudio + peaks</button>
        <label class="inline"><span class="label">format</span>
          <select class="field" bind:value={encodeFormat}>{#each ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'] as f}<option>{f}</option>{/each}</select>
        </label>
        <button type="button" class="btn" onclick={runEncodeAudio} disabled={!!busy}>encodeAudio</button>
      </div>
      {#if frames.length}
        <div class="frames">
          {#each frames as f}
            <figure><img src={f.url} alt="" /><figcaption class="mono">{formatTime(f.time)}</figcaption></figure>
          {/each}
        </div>
      {/if}
      {#if peaks}
        <div class="wave"><Waveform {peaks} /></div>
      {/if}
    </section>
  {/if}

  {#if busy || error || status}
    <section class="card pad status" aria-live="polite">
      {#if busy}
        <div class="row">
          <span class="mono">{busy} {status ? `· ${status}` : ''} · {Math.round(progress * 100)}%</span>
          <button type="button" class="btn sm" onclick={() => controller?.abort()}>cancel</button>
        </div>
        <div class="progress"><span style:width={`${progress * 100}%`}></span></div>
      {:else if status}
        <span class="mono">{status}</span>
      {/if}
      {#if error}<p class="err mono">{error}</p>{/if}
    </section>
  {/if}

  {#if outputs.length}
    <section class="card pad">
      <div class="row">
        <h2>Outputs</h2>
        <button type="button" class="btn sm" onclick={() => (outputs.forEach((o) => URL.revokeObjectURL(o.url)), (outputs = []))}>clear</button>
      </div>
      <div class="outs">
        {#each outputs as o (o.id)}
          <article class="out">
            {#if kindOf(o.blob) === 'video'}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={o.url} controls playsinline></video>
            {:else if kindOf(o.blob) === 'audio'}
              <audio src={o.url} controls></audio>
            {:else if kindOf(o.blob) === 'image'}
              <img src={o.url} alt={o.label} />
            {/if}
            <div class="mono">
              <b>{o.label}</b> · {formatBytes(o.blob.size)} {o.ms ? `· ${Math.round(o.ms)} ms` : ''}<br />
              {o.detail}
              {#each o.notes as n}<br />note: {n}{/each}
            </div>
            <a class="btn sm" href={o.url} download={o.name}>download {o.name}</a>
          </article>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .lab {
    display: grid;
    gap: 18px;
    padding-block: 32px 80px;
  }
  .pad {
    padding: 20px;
    display: grid;
    gap: 14px;
  }
  h2 {
    font-size: 28px;
    line-height: 1.1;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .gap {
    justify-content: flex-start;
    gap: 8px;
  }
  .sm {
    padding: 7px 11px;
    font-size: 13px;
  }
  .seg-btn {
    border: 1px solid var(--color-line-2);
    background: transparent;
    color: var(--color-soft);
    border-radius: 9px;
    padding: 6px 10px;
    cursor: pointer;
    &[aria-pressed='true'] {
      background: var(--color-chalk);
      color: var(--color-bg);
    }
  }
  pre {
    margin: 0;
    max-height: 340px;
    overflow: auto;
    padding: 12px;
    border-radius: 12px;
    background: #141312;
    border: 1px solid var(--color-line);
    white-space: pre-wrap;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px;
  }
  .player {
    width: 100%;
    max-height: 420px;
    border-radius: 14px;
    background: #000;
  }
  audio.player {
    background: transparent;
  }
  .form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    align-items: end;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font: 400 13px var(--font-mono);
    color: var(--color-soft);
    padding-bottom: 12px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    & .label {
      margin: 0;
    }
    & .field {
      width: 90px;
      padding: 8px 10px;
    }
  }
  .actions {
    margin-top: 4px;
  }
  .frames {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    & img {
      height: 90px;
      border-radius: 8px;
      display: block;
    }
    & figure {
      margin: 0;
    }
  }
  .wave {
    height: 96px;
    border-radius: 12px;
    background: var(--color-panel-2);
    overflow: hidden;
  }
  .progress {
    height: 6px;
    border-radius: 6px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.15s;
    }
  }
  .err {
    color: var(--color-bad);
    margin: 0;
  }
  .smoke {
    width: 100%;
    border-collapse: collapse;
    & td {
      padding: 6px 8px;
      border-top: 1px solid var(--color-line);
      vertical-align: top;
    }
    & td:first-child {
      width: 48px;
      font-weight: 600;
    }
    & .ok td:first-child {
      color: var(--color-ok);
    }
    & .bad td:first-child,
    & .bad td:last-child {
      color: var(--color-bad);
    }
  }
  .outs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .out {
    display: grid;
    gap: 8px;
    align-content: start;
    padding: 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    & video,
    & img {
      width: 100%;
      max-height: 260px;
      object-fit: contain;
      border-radius: 10px;
      background: #000;
    }
    & audio {
      width: 100%;
    }
    & b {
      color: var(--color-chalk);
      font-weight: 500;
    }
  }
</style>
