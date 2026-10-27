<script lang="ts">
  import { onDestroy, tick as settled } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';
  import {
    capabilities,
    computePeaks,
    decodeAudio,
    downloadName,
    encodeAudio,
    ensureDecodable,
    FALLBACK_DOWNLOAD_MB,
    formatBytes,
    formatTime,
    isAbort,
    MediaError,
    preloadFallback,
    probe,
    transcode,
    waveform,
    writeWav,
    type Capabilities,
    type MediaInfo,
    type Pcm,
    type Peaks,
  } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import { describeMedia, errorMessage, rotatedPicture, sizeChange } from '@/tools/lib/mute-video/media';
  import { ABPlayer, type Side } from '@/tools/lib/audio-noise-reduction/ab-player';
  import { cleanAudio, disposeWorkers, separate, warmUp, type PreviewData } from '@/tools/lib/audio-noise-reduction/client';
  import { busiestWindow, clampSection, DEFAULT_SETTINGS, PREVIEW_SEC, RATE, renderPreview, toStereo, type Settings } from '@/tools/lib/audio-noise-reduction/dsp';
  import { AUDIO_FORMATS, audioBitrate, bitrateLabel, defaultFormat, unavailableReason, videoTarget, type OutFormat } from '@/tools/lib/audio-noise-reduction/formats';

  const ACCEPT =
    'audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.amr,.weba,.mkv,.mov,.m4v,.avi,.wmv,.flv,.3gp,.ts,.mts,.mpg,.mpeg,.ogv';

  interface Source {
    file: File;
    /** what we read and play: the file itself, or a copy the fallback decoder made */
    src: Blob;
    info: MediaInfo;
    url: string;
    converted: boolean;
  }

  let source = $state<Source | null>(null);
  let probing = $state(false);
  let error = $state('');
  let caps = $state<Capabilities | null>(null);
  let picker = $state<HTMLInputElement>();
  /** bumped by every new file and Start over, so a slow probe or conversion can't bring an old file back */
  let loadId = 0;

  let strength = $state(DEFAULT_SETTINGS.strength * 100);
  let highpass = $state(DEFAULT_SETTINGS.highpass);
  let gate = $state(DEFAULT_SETTINGS.gate);
  let normalize = $state(DEFAULT_SETTINGS.normalize);
  let format = $state<OutFormat>('mp3');
  const settings: Settings = $derived({ strength: strength / 100, highpass, gate, normalize });

  let decoder = $state<'idle' | 'loading' | 'converting'>('idle');
  let decoderPct = $state(0);
  let decoderStatus = $state('');
  let convertCtrl: AbortController | null = null;

  let model = $state<'loading' | 'ready' | 'failed'>('loading');

  // ---- preview: a 15 s section, cleaned with the current settings
  let overview = $state.raw<Peaks | null>(null);
  let sectionStart = $state(0);
  let previewBusy = $state(false);
  let previewStatus = $state('');
  let previewError = $state('');
  let previewPlan = $state<{ speech: boolean; gainDb: number } | null>(null);
  let sectionPeaks = $state.raw<Record<Side, Peaks> | null>(null);
  let sectionPcm: Pcm | null = null;
  /** where sectionPcm was decoded from, so a high-pass toggle can reuse it */
  let sectionPcmStart = -1;
  const separated = new Map<boolean, PreviewData>();
  let previewCtrl: AbortController | null = null;
  let remixTimer: ReturnType<typeof setTimeout> | undefined;
  let sectionTimer: ReturnType<typeof setTimeout> | undefined;

  const player = new ABPlayer();
  let side = $state<Side>('cleaned');
  let playing = $state(false);
  let pos = $state(0);
  let raf = 0;
  let videoEl = $state<HTMLVideoElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  /** the preview is steering the (muted) video so the picture matches what you hear */
  let driving = false;

  // ---- export
  let job = $state<{ progress: number; startedAt: number; status: string } | null>(null);
  let ctrl: AbortController | null = null;
  let resultEl = $state<HTMLElement>();
  let result = $state<{ blob: Blob; name: string; url: string; video: boolean; gainDb: number; gateSkipped: boolean } | null>(null);

  const duration = $derived(source?.info.durationSec ?? 0);
  const sectionLen = $derived(Math.min(PREVIEW_SEC, duration));
  const needsDecoder = $derived(!!source?.info.needsFallback && !source.converted);
  const ready = $derived(!!source && !needsDecoder && !probing);
  const canPreview = $derived(!!sectionPeaks && !previewError);
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const formatLabel = (f: OutFormat) => (f === 'video' && source ? `${videoTarget(source.info, source.converted, caps).container.toUpperCase()} video` : (AUDIO_FORMATS.find((a) => a.id === f)?.label ?? f));
  const srcChannels = $derived(source?.info.audio?.channels || 2);
  const outChannels = $derived(Math.min(2, srcChannels));
  const strengthHint = $derived(
    strength >= 100 ? 'everything the model can take out' : strength >= 70 ? 'most noise gone, a little of the original for natural-sounding voices' : 'a lighter touch: voices stay natural, some noise stays',
  );
  const formatHint = $derived.by(() => {
    const surround = srcChannels > 2 ? ' · surround mixed to stereo' : '';
    if (format === 'video') {
      const picture = source && rotatedPicture(source.info) ? 'this phone clip is stored sideways, so the picture is re-encoded upright at high quality' : 'the picture is copied as is; only the sound is re-encoded';
      return picture + surround;
    }
    const f = AUDIO_FORMATS.find((a) => a.id === format)!;
    const rate = bitrateLabel(format, f.codec, outChannels);
    return `${f.blurb}${rate ? ` · ${rate}` : ''} · 48 kHz${surround}`;
  });

  // ---------------------------------------------------------------- files

  async function load(file: File) {
    startOver();
    const id = loadId;
    probing = true;
    try {
      const info = await probe(file);
      if (info.readable && !info.audio) throw new MediaError('no-tracks', 'That file has no sound to clean.');
      caps ??= await capabilities().catch(() => null);
      if (id !== loadId) return;
      source = { file, src: file, info, url: URL.createObjectURL(file), converted: false };
      format = defaultFormat(info, caps);
      warm();
      probing = false;
      if (!info.needsFallback) await prepare();
    } catch (e) {
      if (id === loadId) error = errorMessage(e);
    } finally {
      if (id === loadId) probing = false;
    }
  }

  function warm() {
    if (model === 'ready') return;
    model = 'loading';
    warmUp().then(
      () => (model = 'ready'),
      // a cancelled job can stop the workers mid-load; the next job simply loads the model again
      (e) => {
        if (!isAbort(e)) model = 'failed';
      },
    );
  }

  /** downloads ffmpeg.wasm once, then makes a copy the browser can read */
  async function convertOdd() {
    const s = source;
    if (!s) return;
    const id = loadId;
    const { signal } = (convertCtrl = new AbortController());
    decoder = 'loading';
    decoderPct = 0;
    error = '';
    try {
      await preloadFallback((p) => (decoderPct = p));
      decoder = 'converting';
      const onStatus = (st: string) => (decoderStatus = st);
      let src: Blob;
      let info: MediaInfo;
      if (s.info.video) {
        ({ file: src, info } = await ensureDecodable(s.file, { onStatus, signal }));
      } else {
        decoderStatus = 'Decoding the audio…';
        src = new Blob([writeWav(await decodeAudio(s.file, {}, { onStatus, signal }))], { type: 'audio/wav' });
        info = await probe(src, { signal });
      }
      if (id !== loadId) return;
      if (!info.audio) throw new MediaError('no-tracks', 'That file has no sound to clean.');
      URL.revokeObjectURL(s.url);
      source = { ...s, src, info, url: URL.createObjectURL(src), converted: true };
      decoder = 'idle';
      await prepare();
    } catch (e) {
      if (id === loadId && !isAbort(e)) error = errorMessage(e);
    } finally {
      if (id === loadId) {
        decoder = 'idle';
        decoderStatus = '';
      }
    }
  }

  /** overview waveform, then the busiest 15 s as the preview */
  async function prepare() {
    const s = source!;
    previewBusy = true;
    previewStatus = 'Scanning the recording…';
    overview = s.info.durationSec > PREVIEW_SEC ? await waveform(s.src, 600).catch(() => null) : null;
    if (source !== s) return;
    sectionStart = overview ? busiestWindow(overview.rms, s.info.durationSec) : 0;
    await loadSection();
  }

  // ---------------------------------------------------------------- preview

  /** decodes the section (unless it already is) and cleans it with the current high-pass setting */
  async function loadSection() {
    const s = source;
    if (!s) return;
    previewCtrl?.abort();
    const ctl = (previewCtrl = new AbortController());
    previewBusy = true;
    previewError = '';
    try {
      const start = sectionStart;
      if (!sectionPcm || sectionPcmStart !== start) {
        stopPreview();
        sectionPeaks = null;
        previewStatus = 'Reading the section…';
        const raw = await decodeAudio(s.src, { start, end: Math.min(s.info.durationSec, start + PREVIEW_SEC) }, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        // the same stereo mix the export makes, so Original and Cleaned compare like for like
        const pcm = { ...raw, channels: toStereo(raw.channels) };
        sectionPcm = pcm;
        sectionPcmStart = start;
        separated.clear();
        player.set('original', pcm);
      }
      await refreshPreview(ctl.signal);
    } catch (e) {
      if (!isAbort(e)) previewError = errorMessage(e);
    } finally {
      if (previewCtrl === ctl) previewBusy = false;
    }
  }

  /** runs the noise model on the section if this high-pass setting isn't cached yet, then remixes */
  async function refreshPreview(signal: AbortSignal) {
    if (!sectionPcm) return;
    const hp = highpass;
    if (!separated.has(hp)) {
      previewStatus = model === 'ready' ? 'Cleaning the preview…' : 'Loading the noise model (about 3 MB, once)…';
      const pcm = sectionPcm;
      const data = await separate(pcm, hp, signal);
      model = 'ready';
      if (pcm !== sectionPcm) return;
      separated.set(hp, data);
    }
    if (hp === highpass) remix();
  }

  function remix() {
    const data = separated.get(highpass);
    if (!data || !sectionPcm) return;
    const r = renderPreview(data.dry, data.wet, data.vad, settings);
    const cleaned = { sampleRate: RATE, channels: r.channels };
    player.set('cleaned', cleaned);
    previewPlan = { speech: r.speech, gainDb: r.gainDb };
    sectionPeaks = { original: computePeaks(sectionPcm, 700), cleaned: computePeaks(cleaned, 700) };
  }

  /** settings that only change the blend: cheap, so the preview follows the slider */
  function blendChanged() {
    clearResult();
    clearTimeout(remixTimer);
    remixTimer = setTimeout(remix, 60);
  }

  function highpassChanged(e: Event) {
    highpass = (e.currentTarget as HTMLInputElement).checked;
    clearResult();
    if (sectionPcm) void loadSection();
  }

  function tick() {
    pos = player.position();
    if (videoEl && driving) {
      const t = sectionStart + pos;
      if (Math.abs(videoEl.currentTime - t) > 0.3) videoEl.currentTime = t;
      if (videoEl.paused) void videoEl.play().catch(() => {});
    }
    raf = requestAnimationFrame(tick);
  }

  function playPreview() {
    if (!canPreview) return;
    audioEl?.pause();
    player.play();
    playing = true;
    if (videoEl) {
      driving = true;
      videoEl.muted = true;
      videoEl.currentTime = sectionStart + player.position();
      void videoEl.play().catch(() => {});
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function stopPreview() {
    cancelAnimationFrame(raf);
    player.pause();
    playing = false;
    if (driving && videoEl) {
      driving = false;
      videoEl.pause();
      videoEl.muted = false;
    }
  }

  function setSide(s: Side) {
    side = s;
    player.switchTo(s);
  }

  /** clicking the section waveform jumps there */
  function seekSection(e: PointerEvent) {
    if (!canPreview) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * player.duration;
    player.seek(t);
    pos = t;
    if (videoEl && driving) videoEl.currentTime = sectionStart + t;
  }

  // the main video player takes over again when someone uses its own controls
  function onVideoPlay() {
    if (!driving && playing) stopPreview();
  }
  function onVideoPause() {
    if (driving && videoEl && !videoEl.ended) stopPreview();
  }

  // ---------------------------------------------------------------- section picker

  let lane = $state<HTMLDivElement>();
  let dragging = false;

  function moveSection(t: number) {
    sectionStart = Math.round(clampSection(t, duration) * 10) / 10;
  }

  function laneDown(e: PointerEvent) {
    if (e.button > 0 || !lane || job) return;
    lane.setPointerCapture(e.pointerId);
    dragging = true;
    laneMove(e);
  }

  function laneMove(e: PointerEvent) {
    if (!dragging || !lane) return;
    const r = lane.getBoundingClientRect();
    moveSection(((e.clientX - r.left) / r.width) * duration - sectionLen / 2);
  }

  function laneUp() {
    if (!dragging) return;
    dragging = false;
    void loadSection();
  }

  function windowKey(e: KeyboardEvent) {
    if (job) return;
    const step = e.shiftKey ? 5 : 1;
    const keys: Record<string, number> = { ArrowLeft: sectionStart - step, ArrowDown: sectionStart - step, ArrowRight: sectionStart + step, ArrowUp: sectionStart + step, Home: 0, End: duration };
    if (!(e.key in keys)) return;
    e.preventDefault();
    moveSection(keys[e.key]);
    clearTimeout(sectionTimer);
    sectionTimer = setTimeout(loadSection, 400);
  }

  // ---------------------------------------------------------------- export

  async function run() {
    const s = source;
    if (!s || job) return;
    stopPreview();
    // the export needs every worker and cancelling it stops them, so a preview still cleaning steps aside and resumes after
    previewCtrl?.abort();
    clearTimeout(sectionTimer);
    clearResult();
    error = '';
    ctrl = new AbortController();
    const { signal } = ctrl;
    const out = format;
    const toVideo = out === 'video';
    // the noise model is most of the work; re-muxing a video takes a little longer than encoding audio,
    // and a sideways phone clip's picture has to be re-encoded
    const split = toVideo ? (rotatedPicture(s.info) ? 0.5 : 0.85) : 0.92;
    job = { progress: 0, startedAt: performance.now(), status: 'Getting ready…' };
    const onStatus = (st: string) => job && (job.status = st);
    try {
      const cleaned = await cleanAudio(s.src, { ...settings }, { signal, onStatus, onProgress: (p) => job && (job.progress = p * split) });
      const rest = (p: number) => job && (job.progress = split + (1 - split) * p);
      const bitrate = audioBitrate(cleaned.pcm.channels.length);
      let blob: Blob;
      let name: string;
      if (toVideo) {
        onStatus('Putting the clean sound back into the video…');
        const { container, codec } = videoTarget(s.info, s.converted, caps);
        const wav = new Blob([writeWav(cleaned.pcm)], { type: 'audio/wav' });
        const r = await transcode(s.src, { container, audio: { replace: wav, codec, bitrate } }, { signal, onProgress: rest });
        blob = r.blob;
        name = downloadName(s.file.name, container, '-clean');
      } else {
        onStatus(out === 'wav' ? 'Writing the WAV…' : `Encoding ${formatLabel(out)}…`);
        blob = await encodeAudio(cleaned.pcm, { format: out, bitrate }, { signal, onProgress: rest });
        name = downloadName(s.file.name, out, '-clean');
      }
      result = { blob, name, url: URL.createObjectURL(blob), video: toVideo, gainDb: normalize ? cleaned.gainDb : 0, gateSkipped: gate && !cleaned.speech };
      await settled();
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      resultEl?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
    } catch (e) {
      if (!isAbort(e)) error = errorMessage(e);
    } finally {
      // after a failure, stops the workers still busy with the job's other pieces
      ctrl?.abort();
      job = null;
      ctrl = null;
      if (source === s && !separated.has(highpass)) void loadSection();
    }
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function startOver() {
    loadId++;
    ctrl?.abort();
    previewCtrl?.abort();
    convertCtrl?.abort();
    probing = false;
    decoder = 'idle';
    decoderStatus = '';
    clearTimeout(remixTimer);
    clearTimeout(sectionTimer);
    stopPreview();
    player.clear();
    clearResult();
    if (source) URL.revokeObjectURL(source.url);
    source = null;
    sectionPcm = null;
    sectionPcmStart = -1;
    separated.clear();
    overview = sectionPeaks = null;
    previewPlan = null;
    previewError = error = '';
    previewBusy = false;
    pos = 0;
  }

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void load(f);
  }

  onDestroy(() => {
    startOver();
    player.dispose();
    disposeWorkers();
  });
</script>

<input bind:this={picker} type="file" accept={ACCEPT} hidden onchange={pick} />

{#if !source && !probing}
  <Dropzone accept={ACCEPT} title="Drop a recording or a video" hint="voice memos, podcasts, interviews, lectures · or click to choose" onfiles={(f) => load(f[0])} />
  {#if error}<p class="mono mt-3 text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <section class="stage" aria-label="Your file">
        {#if probing || !source}
          <div class="still mono" role="status">reading the file…</div>
        {:else if needsDecoder}
          <div class="still">
            <p class="font-serif text-2xl">No preview for this format yet</p>
            <p class="mono">Your browser can't read it on its own, but the decoder below can.</p>
          </div>
        {:else if source.info.video}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={videoEl} src={source.url} controls playsinline preload="metadata" onplay={onVideoPlay} onpause={onVideoPause}></video>
        {:else}
          <audio bind:this={audioEl} src={source.url} controls preload="metadata" class="w-full" onplay={() => playing && stopPreview()}></audio>
        {/if}

        {#if source}
          <div class="flex items-center gap-3 px-1">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{source.file.name}</p>
              <p class="mono truncate">
                {#if source.info.readable || source.info.via === 'ffmpeg'}{describeMedia(source.info).join(' · ')} · {/if}{formatBytes(source.file.size)}{source.converted ? ' · converted' : ''}
              </p>
            </div>
            <button type="button" class="btn px-3! py-2! text-sm!" disabled={!!job || decoder !== 'idle'} onclick={() => picker?.click()}>change<span class="sr-only"> file</span></button>
          </div>
        {/if}
      </section>

      {#if needsDecoder}
        <div class="notice">
          <p class="text-sm">
            This file uses a format your browser can't read by itself. Rounder can fetch a free decoder (ffmpeg, {FALLBACK_DOWNLOAD_MB} MB) once. It runs on this device; nothing is uploaded.
          </p>
          {#if decoder !== 'idle'}
            <div class="meter" role="progressbar" aria-label="Downloading the decoder" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(decoderPct * 100)}>
              <span style:width="{decoderPct * 100}%"></span>
            </div>
            <p class="mono" role="status">{decoder === 'loading' ? `Downloading… ${Math.round(decoderPct * 100)}%` : decoderStatus || 'Converting…'}</p>
          {:else}
            <button type="button" class="btn" onclick={convertOdd}>Download decoder · {FALLBACK_DOWNLOAD_MB} MB</button>
          {/if}
        </div>
      {:else if ready}
        <section class="ab" aria-label="Before and after preview">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-2xl">Before &amp; after</h2>
            <p class="mono">{formatTime(sectionStart, 0)} – {formatTime(sectionStart + sectionLen, 0)} · loops</p>
          </div>

          {#if overview}
            <div
              class="lane"
              role="presentation"
              bind:this={lane}
              onpointerdown={laneDown}
              onpointermove={laneMove}
              onpointerup={laneUp}
              onpointercancel={laneUp}
            >
              <Waveform peaks={overview} color="var(--color-muted)" />
              <div
                class="window"
                style:left="{pct(sectionStart)}%"
                style:width="{pct(sectionLen)}%"
                role="slider"
                tabindex="0"
                aria-label="Preview section"
                aria-valuemin={0}
                aria-valuemax={Math.round(Math.max(0, duration - sectionLen))}
                aria-valuenow={Math.round(sectionStart)}
                aria-valuetext="{formatTime(sectionStart, 0)} to {formatTime(sectionStart + sectionLen, 0)}"
                onkeydown={windowKey}
              ></div>
            </div>
            <p class="mono -mt-1">Drag along the whole recording to preview another part.</p>
          {/if}

          <div class="section" class:busy={previewBusy} onpointerdown={seekSection} role="presentation">
            {#if sectionPeaks}
              <Waveform peaks={sectionPeaks[side]} progress={sectionLen ? pos / sectionLen : 0} color={side === 'cleaned' ? 'var(--color-audio)' : 'var(--color-soft)'} />
            {/if}
            {#if previewBusy}
              <p class="mono overlay" role="status">
                {previewStatus}
              </p>
            {/if}
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="play" disabled={!canPreview} onclick={() => (playing ? stopPreview() : playPreview())} aria-label={playing ? 'Pause preview' : 'Play preview'}>
              {#if playing}
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              {:else}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
              {/if}
            </button>
            <div class="seg ab-seg" role="group" aria-label="Listen to">
              <button type="button" aria-pressed={side === 'original'} onclick={() => setSide('original')}>Original</button>
              <button type="button" aria-pressed={side === 'cleaned'} onclick={() => setSide('cleaned')}>Cleaned</button>
            </div>
            <p class="mono tabular-nums">{formatTime(sectionStart + pos, 1)}</p>
          </div>
          <p class="mono">Switch while it plays: both versions run in sync, so you hear the same words.</p>
          {#if previewError}<p class="mono text-bad" role="alert">{previewError}</p>{/if}
          {#if model === 'failed'}<p class="mono text-bad" role="alert">The noise model didn't load. Check your connection, then choose the file again.</p>{/if}
          {#if gate && previewPlan && !previewPlan.speech}<p class="mono text-sun">No speech found in this part, so the voice gate leaves it alone.</p>{/if}
        </section>
      {/if}

      {#if result && source}
        <section class="result" aria-label="Result" bind:this={resultEl}>
          <div class="ready" role="status">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
            <div class="min-w-0">
              <p class="font-serif text-2xl leading-tight">{result.video ? 'Your video sounds cleaner' : 'Your audio is clean'}</p>
              <p class="mono">
                {formatBytes(source.file.size)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span>
                {#if sizeChange(source.file.size, result.blob.size).text}
                  <span class:text-ok={sizeChange(source.file.size, result.blob.size).smaller}> {sizeChange(source.file.size, result.blob.size).text}</span>
                {/if}
                {#if result.gainDb}· level {result.gainDb > 0 ? '+' : '−'}{Math.abs(result.gainDb).toFixed(1)} dB{/if}
              </p>
            </div>
          </div>
          {#if result.video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={result.url} controls playsinline preload="metadata"></video>
          {:else}
            <audio src={result.url} controls preload="metadata" class="w-full"></audio>
          {/if}
          {#if result.gateSkipped}<p class="mono">No speech was detected, so the voice gate left the audio as it was.</p>{/if}
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob, result!.name)}>Download {result.name.split('.').pop()?.toUpperCase()}</button>
            <button type="button" class="btn" onclick={startOver}>Start over</button>
          </div>
        </section>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid min-w-0 gap-5" disabled={!ready || !!job}>
        <legend class="sr-only">Settings</legend>
        <label class="grid gap-2">
          <span class="flex items-baseline justify-between">
            <span class="label">strength</span>
            <span class="mono text-chalk tabular-nums">{strength}%</span>
          </span>
          <input type="range" min="0" max="100" step="5" bind:value={strength} oninput={blendChanged} class="w-full accent-(--color-sun)" />
          <span class="mono">{strengthHint}</span>
        </label>

        <div class="grid gap-3">
          <span class="label">extras</span>
          <label class="opt">
            <input type="checkbox" checked={highpass} onchange={highpassChanged} />
            <span>Cut low rumble<span class="mono block">80 Hz high-pass for wind, traffic and desk bumps</span></span>
          </label>
          <label class="opt">
            <input type="checkbox" bind:checked={gate} onchange={blendChanged} />
            <span>Quiet the gaps<span class="mono block">voice gate: turns pauses between words down 20 dB</span></span>
          </label>
          <label class="opt">
            <input type="checkbox" bind:checked={normalize} onchange={blendChanged} />
            <span>Even out the volume<span class="mono block">gentle: speech to a steady level, never clipping</span></span>
          </label>
        </div>

        <div>
          <span class="label">save as</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each [...(source?.info.video ? (['video'] as const) : []), ...AUDIO_FORMATS.map((f) => f.id)] as f (f)}
              {@const why = unavailableReason(f, source?.info ?? null, caps)}
              <button type="button" aria-pressed={format === f} disabled={!!why} title={why || undefined} onclick={() => ((format = f), clearResult())}>{formatLabel(f)}</button>
            {/each}
          </div>
          <p class="mono mt-2">{formatHint}</p>
        </div>
      </fieldset>

      <div class="grid gap-3 border-t border-line pt-5">
        {#if job}
          <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label={source?.file.name ?? 'Cleaning'} status={job.status} oncancel={() => ctrl?.abort()} />
        {:else}
          <button type="button" class="btn btn-primary" disabled={!ready || model === 'failed'} onclick={run}>
            Remove noise{format === 'video' ? ' from the video' : ''}
          </button>
          <p class="mono">Works best on speech with steady noise: fans, hum, hiss, traffic. Not made for music.</p>
        {/if}
        {#if error}<p class="mono text-bad" role="alert">{error}</p>{/if}
        {#if !job && !result}<button type="button" class="btn" onclick={startOver}>Start over</button>{/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .stage {
    display: grid;
    gap: 14px;
    padding: 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
    & video {
      width: 100%;
      max-height: 420px;
      border-radius: 12px;
      background: #000;
    }
  }
  .still {
    display: grid;
    place-content: center;
    gap: 6px;
    min-height: 160px;
    padding: 24px;
    text-align: center;
    border-radius: 12px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px), #141312;
  }
  .ab {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .lane {
    position: relative;
    height: 44px;
    border-radius: 10px;
    background: #141312;
    cursor: pointer;
    touch-action: none;
  }
  .window {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 6px;
    border: 1.5px solid var(--color-sun);
    border-radius: 8px;
    background: #ffd25e1f;
    box-shadow: 0 0 18px #ffd25e33;
    transition: left 0.12s ease-out;
  }
  .section {
    position: relative;
    height: 96px;
    border-radius: 12px;
    background: #141312;
    cursor: pointer;
    transition: opacity 0.2s;
    &.busy {
      opacity: 0.6;
    }
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 12px;
    text-align: center;
    color: var(--color-chalk);
  }
  .play {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 99px;
    background: var(--color-sun);
    color: var(--color-bg);
    cursor: pointer;
    transition: transform 0.15s var(--ease-spring);
    &:hover:not(:disabled) {
      transform: scale(1.06);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    & svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
  }
  .ab-seg button {
    padding: 10px 16px;
  }
  .opt {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 14px;
    cursor: pointer;
    & input {
      margin-top: 4px;
      accent-color: var(--color-sun);
    }
  }
  .notice {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid #ffd25e55;
    border-radius: 14px;
    background: #ffd25e0d;
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.25s ease-out;
    }
  }
  .result {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid #9be58f55;
    border-radius: 18px;
    background: #9be58f0d;
    & video {
      width: 100%;
      max-height: 360px;
      border-radius: 12px;
      background: #000;
    }
  }
  .ready {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    flex: none;
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 66;
      animation: draw 0.5s ease-out both;
    }
    & path {
      --len: 16;
      stroke-width: 2;
      stroke-dasharray: 16;
      animation: draw 0.35s 0.35s ease-out both;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: var(--len, 66);
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  fieldset:disabled {
    opacity: 0.6;
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
