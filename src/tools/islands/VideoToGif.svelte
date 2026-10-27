<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import DeviceNote from '@/components/tool/DeviceNote.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import {
    capabilities,
    downloadName,
    ensureDecodable,
    extractFrames,
    FALLBACK_DOWNLOAD_MB,
    formatBytes,
    formatTime,
    MediaError,
    probe,
    transcode,
    videoCodecLabel,
    type Capabilities,
    type MediaInfo,
    type VideoCodec,
  } from '@/engines/media';
  import { checkDevice, deviceMessage } from '@/tools/lib/device-guard';
  import { downloadResult } from '@/tools/lib/files';
  import { layoutBox, type Measure } from '@/tools/lib/meme-generator/layout';
  import { gifWorker, transfer } from '@/tools/lib/video-to-gif/client';
  import { friendlyError } from '@/tools/lib/video-to-gif/errors';
  import {
    DEFAULT_RANGE_SEC,
    defaultWidth,
    estimateVideoBytes,
    eta,
    formatDuration,
    FPS_MAX,
    FPS_MIN,
    frameTimes,
    gifDelays,
    gifRepeat,
    LONG_GIF_SEC,
    loopBitrate,
    outputDuration,
    outputSize,
    widthRange,
    type Dither,
  } from '@/tools/lib/video-to-gif/plan';

  type Format = 'gif' | 'mp4' | 'webm';
  interface Result {
    blob: Blob;
    url: string;
    name: string;
    format: Format;
    width: number;
    height: number;
    frames: number;
    seconds: number;
  }

  /** frames decoded per round trip, so a long clip never piles up in memory */
  const BATCH = 24;
  const speeds = [0.5, 0.75, 1, 1.5, 2, 3];
  const palettes = [256, 128, 64, 32];
  const dithers: [Dither, string][] = [['none', 'off'], ['pattern', 'pattern'], ['diffuse', 'smooth']];
  const loops: [number, string][] = [[0, 'forever'], [1, 'once'], [3, '3 times']];
  // from (e.g. 'MOV' on /mov-to-gif) only names the format in the drop area; every video still opens
  let { from }: { from?: string } = $props();
  const accept = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.mpg,.mpeg,.ts,.ogv';

  let file = $state.raw<File | null>(null);
  /** what the engine decodes: the file itself, or its ffmpeg-converted copy */
  let src = $state.raw<Blob | null>(null);
  let info = $state.raw<MediaInfo | null>(null);
  let phase = $state<'empty' | 'probing' | 'needs-decoder' | 'decoding' | 'ready'>('empty');
  let loadProgress = $state(0);
  let loadStatus = $state('');
  let srcUrl = $state('');
  let playerFailed = $state(false);
  let video = $state<HTMLVideoElement | null>(null);
  let start = $state(0);
  let end = $state(0);

  let format = $state<Format>('gif');
  let width = $state(480);
  let fps = $state(12);
  let speed = $state(1);
  let colors = $state(256);
  let dither = $state<Dither>('none');
  let loop = $state(0);
  let caption = $state('');
  let captionAt = $state<'top' | 'bottom'>('bottom');
  let caps = $state.raw<Capabilities | null>(null);
  let capsFailed = $state(false);

  let preview = $state<HTMLCanvasElement>();
  let firstFrame = $state.raw<ImageBitmap | null>(null);
  let gifPreview = $state.raw<ImageBitmap | null>(null);
  let gifEstimate = $state<number | null>(null);
  let samplesVersion = $state(0);
  let captionVersion = $state(0);

  let job = $state<'idle' | 'running' | 'done'>('idle');
  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let error = $state('');
  let result = $state.raw<Result | null>(null);

  let controller: AbortController | null = null;
  let loadAbort: AbortController | null = null;
  let sampleAbort: AbortController | null = null;
  let encoder: ReturnType<typeof gifWorker> | null = null;
  let captionCanvas: HTMLCanvasElement | null = null;
  let memeFont = 'Impact, sans-serif';
  let ticker: ReturnType<typeof setInterval> | undefined;
  let opens = 0;

  const gif = () => (encoder ??= gifWorker()).api;

  const dispW = $derived(info?.video?.displayWidth ?? 0);
  const dispH = $derived(info?.video?.displayHeight ?? 0);
  const widths = $derived(widthRange(dispW));
  const gifSize = $derived(outputSize(dispW, dispH, width));
  const videoSize = $derived(outputSize(dispW, dispH, width, true));
  const step = $derived(speed / fps);
  const frameCount = $derived(frameTimes(start, end, fps, speed).length);
  const seconds = $derived(outputDuration(start, end, speed));
  const bitrate = $derived(loopBitrate(videoSize.width, videoSize.height, fps));
  const videoEstimate = $derived(estimateVideoBytes(bitrate, seconds));
  const estimate = $derived(format === 'gif' ? gifEstimate : videoEstimate);
  // low-end devices: warn about, or stop, an export this device can't hold
  const decoderFit = $derived(file ? checkDevice('ffmpeg', { bytes: file.size, tip: 'Try a shorter recording, or convert it to MP4 on a computer first.' }) : null);
  const deviceFit = $derived(
    format === 'gif'
      ? checkDevice('gif', { count: frameCount, seconds, width: gifSize.width, height: gifSize.height, outBytes: gifEstimate ?? undefined })
      : checkDevice('video', { seconds, width: videoSize.width, height: videoSize.height, outBytes: videoEstimate }),
  );
  const long = $derived(end - start > LONG_GIF_SEC);
  const elapsed = $derived(Math.max(0, now - startedAt));
  const remaining = $derived(eta(progress, elapsed));
  const codecName = $derived(info?.video?.codec ? (videoCodecLabel[info.video.codec as VideoCodec] ?? info.video.codec) : null);
  const extension = $derived(file?.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? '');

  const formats = $derived<{ id: Format; label: string; reason: string }[]>([
    { id: 'gif', label: 'GIF', reason: '' },
    { id: 'mp4', label: 'MP4', reason: videoReason('mp4') },
    { id: 'webm', label: 'WebM', reason: videoReason('webm') },
  ]);

  function videoReason(c: 'mp4' | 'webm') {
    if (capsFailed) return "Your browser can't encode video";
    if (!caps) return 'Checking what your browser can encode…';
    return caps.containers[c] ? '' : `Your browser can't encode ${c === 'mp4' ? 'MP4' : 'WebM'} video`;
  }

  onMount(() => {
    memeFont = detectFont();
    capabilities().then(
      (c) => (caps = c),
      () => (capsFailed = true),
    );
  });

  onDestroy(() => {
    controller?.abort();
    loadAbort?.abort();
    sampleAbort?.abort();
    encoder?.close();
    clearInterval(ticker);
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    if (result) URL.revokeObjectURL(result.url);
    firstFrame?.close();
    gifPreview?.close();
  });

  // ---------------------------------------------------------------- opening a file

  function reset() {
    opens++; // anything still opening is now stale
    controller?.abort();
    loadAbort?.abort();
    sampleAbort?.abort();
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    clearResult();
    // the old clip's samples and in-flight renders must not reach the next one's preview
    sampleToken++;
    previewToken++;
    samplesVersion = 0;
    void encoder?.api.setSamples([]);
    firstFrame?.close();
    gifPreview?.close();
    firstFrame = gifPreview = null;
    gifEstimate = null;
    file = src = info = null;
    srcUrl = '';
    playerFailed = false;
    error = '';
    job = 'idle';
    phase = 'empty';
  }

  async function open(files: File[]) {
    const f = files[0];
    reset();
    const id = opens;
    file = f;
    phase = 'probing';
    try {
      const i = await probe(f);
      if (id !== opens) return;
      if (i.container === 'gif') throw new MediaError('invalid-options', "That's already a GIF. To turn a GIF into a video, use the GIF to MP4 tool.");
      // frames are read with WebCodecs, even from the fallback decoder's copy, so don't offer that download
      if (typeof VideoDecoder === 'undefined') throw new MediaError('no-webcodecs', '');
      info = i;
      // the output has no sound, so audio the browser can't decode doesn't need the fallback
      if (!i.readable || (i.video && !i.video.canDecode)) phase = 'needs-decoder';
      else ready(f, i);
    } catch (e) {
      if (id !== opens) return;
      phase = 'empty';
      file = null;
      error = friendlyError(e) ?? '';
    }
  }

  async function useDecoder() {
    if (!file) return;
    const id = opens;
    phase = 'decoding';
    loadProgress = 0;
    loadStatus = 'Downloading decoder…';
    loadAbort = new AbortController();
    try {
      const out = await ensureDecodable(file, { signal: loadAbort.signal, onProgress: (p) => (loadProgress = p), onStatus: (s) => (loadStatus = s) });
      if (id === opens) ready(out.file, out.info);
    } catch (e) {
      if (id !== opens) return;
      const msg = deviceMessage('ffmpeg', e) ?? friendlyError(e);
      // a converted file with no picture can't be retried; anything else can
      phase = (e as MediaError)?.code === 'no-tracks' ? 'empty' : 'needs-decoder';
      if (phase === 'empty') file = null;
      error = msg ?? '';
    }
  }

  function ready(blob: Blob, i: MediaInfo) {
    if (!i.video) throw new MediaError('no-tracks', 'No video track.');
    src = blob;
    info = i;
    srcUrl = URL.createObjectURL(blob);
    start = 0;
    end = Math.min(DEFAULT_RANGE_SEC, i.durationSec);
    width = defaultWidth(i.video.displayWidth);
    error = '';
    phase = 'ready';
  }

  // ---------------------------------------------------------------- caption

  // Impact isn't on every device; fall back to the heaviest sans the browser has
  function detectFont() {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const sample = 'MEME wmIl 0123';
    ctx.font = '40px monospace';
    const base = ctx.measureText(sample).width;
    for (const name of ['Impact', 'Anton', 'Arial Black']) {
      ctx.font = `40px "${name}", monospace`;
      if (ctx.measureText(sample).width !== base) return `400 {px}px "${name}", sans-serif`;
    }
    return '800 {px}px sans-serif';
  }
  const fontAt = (px: number) => memeFont.replace('{px}', String(px));

  /** paints the caption on a transparent canvas the size of the output; false when there's none */
  function paintCaption(text: string, at: 'top' | 'bottom', w: number, h: number) {
    captionCanvas ??= document.createElement('canvas');
    captionCanvas.width = w;
    captionCanvas.height = h;
    const ctx = captionCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!text.trim()) return false;
    const measure: Measure = (s, px) => {
      ctx.font = fontAt(px);
      return ctx.measureText(s).width;
    };
    const box = { text, anchor: at, x: 0.5, y: 0, width: 0.94, size: 0.1, color: '#fff', stroke: true, strokeColor: '#000', align: 'center', upper: true } as const;
    const l = layoutBox(box, w, h, measure);
    ctx.font = fontAt(l.px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = l.strokeWidth;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    l.lines.forEach((line, i) => {
      const y = l.top + (i + 0.5) * l.lineHeight;
      ctx.strokeText(line, w / 2, y);
      ctx.fillText(line, w / 2, y);
    });
    return true;
  }

  // the worker composites the caption into every frame, so it gets a copy whenever it changes
  async function syncCaption(text: string, at: 'top' | 'bottom', w: number, h: number) {
    const has = paintCaption(text, at, w, h);
    await gif().setCaption(has ? transfer(await createImageBitmap(captionCanvas!)) : null);
    captionVersion++;
    return has;
  }

  $effect(() => {
    if (phase !== 'ready') return;
    const args = [caption, captionAt, gifSize.width, gifSize.height] as const;
    const t = setTimeout(() => syncCaption(...args), 120);
    return () => clearTimeout(t);
  });

  // ---------------------------------------------------------------- live preview & estimate

  let sampleToken = 0;
  $effect(() => {
    if (phase !== 'ready' || !src) return;
    const args = [src, start, end, gifSize.width, step] as const;
    const t = setTimeout(() => untrack(() => loadSamples(...args)), 250);
    return () => clearTimeout(t);
  });

  /** the first two frames (and a pair from the middle) feed the preview and the size estimate */
  async function loadSamples(blob: Blob, s: number, e: number, w: number, dt: number) {
    const token = ++sampleToken;
    sampleAbort?.abort();
    sampleAbort = new AbortController();
    const mid = s + Math.floor((e - s) / 2 / dt) * dt;
    const times = s + dt >= e ? [s] : mid >= s + 2 * dt && mid + dt < e ? [s, s + dt, mid, mid + dt] : [s, s + dt];
    try {
      const frames = await extractFrames(blob, { times, width: w }, { signal: sampleAbort.signal });
      if (token !== sampleToken || !frames.length) return frames.forEach((f) => f.bitmap.close());
      firstFrame?.close();
      firstFrame = await createImageBitmap(frames[0].bitmap);
      const bitmaps = frames.map((f) => f.bitmap);
      await gif().setSamples(transfer(bitmaps));
      samplesVersion++;
    } catch (err) {
      if (token === sampleToken && friendlyError(err)) console.warn('Preview failed', err);
    }
  }

  let previewToken = 0;
  $effect(() => {
    if (!samplesVersion) return;
    const args = [{ colors, dither }, frameCount, captionVersion] as const;
    const t = setTimeout(async () => {
      const token = ++previewToken;
      const out = await gif().preview(args[0], args[1]);
      if (token !== previewToken || !out) return out?.image.close();
      gifPreview?.close();
      gifPreview = out.image;
      gifEstimate = out.bytes;
    }, 120);
    return () => clearTimeout(t);
  });

  // GIF: the worker's exact palette render; video: the plain frame with the caption on top
  $effect(() => {
    const canvas = preview;
    const image = format === 'gif' ? gifPreview : firstFrame;
    void captionVersion;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    if (format !== 'gif' && caption.trim() && captionCanvas) ctx.drawImage(captionCanvas, 0, 0, image.width, image.height);
  });

  // the player previews the speed too
  $effect(() => {
    if (video) video.playbackRate = speed;
  });

  // ---------------------------------------------------------------- export

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  async function makeGif(blob: Blob, signal: AbortSignal) {
    const api = gif();
    const times = frameTimes(start, end, fps, speed);
    const delays = gifDelays(times.length, fps);
    const w = gifSize.width;
    await api.start({ colors, dither }, gifRepeat(loop));
    const stop = () => void api.cancel();
    signal.addEventListener('abort', stop);
    try {
      let k = 0;
      let done = 0;
      status = 'Making your GIF…';
      for (let b = 0; b < times.length; b += BATCH) {
        const adds: Promise<void>[] = [];
        await extractFrames(blob, { times: times.slice(b, b + BATCH), width: w }, {
          signal,
          onFrame: (f) => {
            const delay = delays[Math.min(k++, delays.length - 1)];
            adds.push(api.add(transfer(f.bitmap), delay).then(() => void (progress = (++done / times.length) * 0.99)));
          },
        });
        await Promise.all(adds);
        if (signal.aborted) throw new MediaError('aborted', 'Cancelled.');
      }
      status = 'Finishing…';
      const bytes = await api.finish();
      return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), frames: done };
    } catch (e) {
      void api.cancel(); // a decode error mustn't leave a half-built GIF in the worker's memory
      throw e;
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }

  async function make(target: Format = format) {
    if (!src || !file || job === 'running') return;
    format = target;
    const ctrl = (controller = new AbortController());
    clearResult();
    error = '';
    job = 'running';
    progress = 0;
    status = 'Starting…';
    startedAt = now = performance.now();
    ticker = setInterval(() => (now = performance.now()), 500);
    try {
      // the debounced caption update may not have landed yet if Make was clicked right after typing
      const hasCaption = await syncCaption(caption, captionAt, gifSize.width, gifSize.height);
      let out: Omit<Result, 'url' | 'name' | 'format'>;
      if (target === 'gif') {
        const g = await makeGif(src, ctrl.signal);
        out = { blob: g.blob, width: gifSize.width, height: gifSize.height, frames: g.frames, seconds };
      } else {
        const cap = hasCaption ? await createImageBitmap(captionCanvas!) : null;
        try {
          const r = await transcode(
            src,
            {
              container: target,
              trim: { start, end },
              video: {
                codec: target === 'mp4' ? 'avc' : 'vp9',
                width: videoSize.width,
                fps,
                speed,
                bitrate,
                overlay: cap ? (ctx, f) => ctx.drawImage(cap, 0, 0, f.width, f.height) : undefined,
              },
              audio: false,
            },
            { signal: ctrl.signal, onProgress: (p) => (progress = p), onStatus: (s) => (status = s === 'Converting…' ? 'Encoding your loop…' : s) },
          );
          out = { blob: r.blob, width: r.width ?? videoSize.width, height: r.height ?? videoSize.height, frames: frameCount, seconds: r.durationSec };
        } finally {
          cap?.close();
        }
      }
      result = {
        ...out,
        url: URL.createObjectURL(out.blob),
        name: target === 'gif' ? downloadName(file.name, 'gif') : downloadName(file.name, target, '-loop'),
        format: target,
      };
      progress = 1;
      job = 'done';
    } catch (e) {
      job = 'idle';
      // null means cancelled
      const msg = friendlyError(e);
      error = (msg && deviceMessage(target === 'gif' ? 'gif' : 'video', e)) || (msg ?? '');
    } finally {
      clearInterval(ticker);
      if (controller === ctrl) controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  function adjust() {
    clearResult();
    job = 'idle';
  }

  function setRangeEnd(input: HTMLInputElement) {
    const v = Number(input.value);
    if (Number.isFinite(v) && v > 0 && info) end = Math.min(info.durationSec, start + v);
    input.value = (end - start).toFixed(1);
  }

  const pctSmaller = (a: number, b: number) => Math.round((1 - a / b) * 100);
</script>

{#if phase === 'empty' || phase === 'probing'}
  {#if phase === 'probing'}
    <div class="grid place-items-center gap-2 rounded-[18px] border border-line-2 px-5 py-16 text-center" aria-live="polite">
      <p class="font-serif text-3xl">Reading your video…</p>
      <p class="mono">{file?.name}</p>
    </div>
  {:else}
    <Dropzone {accept} title={from ? `Drop your ${from} to make a GIF` : 'Drop a video to make a GIF'} hint="MP4, MOV, WebM, MKV, AVI and more" onfiles={open} />
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else if phase === 'needs-decoder' || phase === 'decoding'}
  <div class="card grid gap-4 p-6 sm:p-8">
    <div>
      <p class="font-serif text-3xl">This {extension ? `${extension} file` : 'file'} needs an extra decoder</p>
      <p class="mt-2 text-soft">
        Your browser can't read <span class="mono text-chalk!">{file?.name}</span> on its own. Rounder can fetch a one-time
        {FALLBACK_DOWNLOAD_MB} MB decoder and convert it right here on your device. Nothing is uploaded.
      </p>
    </div>
    {#if phase === 'decoding'}
      <div class="grid gap-2" aria-live="polite">
        <div class="bar" role="progressbar" aria-label="Preparing the video" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(loadProgress * 100)}>
          <span style:width="{loadProgress * 100}%"></span>
        </div>
        <p class="mono">{loadStatus || 'Working…'}</p>
      </div>
      <div><button type="button" class="btn" onclick={reset}>Cancel</button></div>
    {:else}
      <DeviceNote verdict={decoderFit} />
      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary" onclick={useDecoder} disabled={decoderFit?.level === 'block'}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB) & continue</button>
        <button type="button" class="btn" onclick={reset}>Choose another file</button>
      </div>
    {/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
  </div>
{:else if info?.video && src}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="player">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} src={srcUrl} controls muted playsinline preload="metadata" onerror={() => (playerFailed = true)}></video>
      </div>
      {#if playerFailed}
        <p class="mono">Your browser can't play this file here, but the GIF can still be made from it. Use the timeline to pick the part you want.</p>
      {/if}
      <p class="mono flex flex-wrap gap-x-3 gap-y-1">
        <span class="text-chalk">{file?.name}</span>
        <span>{dispW} × {dispH}</span>
        {#if codecName}<span>{codecName}</span>{/if}
        {#if info.video.fps}<span>{Math.round(info.video.fps * 100) / 100} fps</span>{/if}
        <span>{formatTime(info.durationSec)}</span>
        <span>{formatBytes(file?.size ?? 0)}</span>
      </p>

      <TrimTimeline file={src} duration={info.durationSec} media={video} bind:start bind:end loop step={1 / (info.video.fps || 30)} disabled={job === 'running'} />

      <div class="flex flex-wrap items-end justify-between gap-3">
        <p class="mono" aria-live="polite">
          range <span class="text-chalk">{formatTime(start)} → {formatTime(end)}</span> · {(end - start).toFixed(1)} s{speed !== 1 ? ` → plays in ${seconds.toFixed(1)} s` : ''}
        </p>
        <label class="flex items-center gap-2">
          <span class="mono">length (s)</span>
          <input class="field w-24! py-1.5!" type="number" min="0.1" step="0.5" value={(end - start).toFixed(1)} onchange={(e) => setRangeEnd(e.currentTarget)} disabled={job === 'running'} />
        </label>
      </div>
      {#if long && format === 'gif'}
        <p class="note" role="status">
          {(end - start).toFixed(0)} seconds is long for a GIF: that's {frameCount} frames, and GIF files grow with every one. A shorter range,
          a lower frame rate or MP4 will keep it manageable.
        </p>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid gap-2" disabled={job === 'running'}>
        <legend class="label">make a</legend>
        <div class="seg" role="group" aria-label="Output format">
          {#each formats as f}
            <button type="button" aria-pressed={format === f.id} disabled={!!f.reason} title={f.reason || undefined} onclick={() => (format = f.id)}>{f.label}</button>
          {/each}
        </div>
        <p class="mono">
          {#if format === 'gif'}Plays anywhere, but GIFs are big files.{:else}Much smaller than a GIF. Many sites and chat apps that take GIFs accept short silent videos too.{/if}
        </p>
        {#each formats.filter((f) => f.reason && (caps || capsFailed)) as f}<p class="mono">{f.label}: {f.reason}</p>{/each}
      </fieldset>

      <fieldset class="grid gap-5" disabled={job === 'running'}>
        <label>
          <span class="label">width · <span class="text-chalk">{gifSize.width} × {gifSize.height}</span> px</span>
          <input type="range" min={widths.min} max={widths.max} step="10" bind:value={width} class="w-full accent-(--color-sun)" />
        </label>

        <label>
          <span class="label">frame rate · <span class="text-chalk">{fps} fps</span></span>
          <input type="range" min={FPS_MIN} max={FPS_MAX} step="1" bind:value={fps} class="w-full accent-(--color-sun)" />
          <span class="mono flex justify-between"><span>smaller</span><span>smoother</span></span>
        </label>

        <div>
          <span class="label">speed</span>
          <div class="seg" role="group" aria-label="Speed">
            {#each speeds as s}<button type="button" aria-pressed={speed === s} onclick={() => (speed = s)}>{s}×</button>{/each}
          </div>
        </div>

        {#if format === 'gif'}
          <div>
            <span class="label">colors</span>
            <div class="seg" role="group" aria-label="Colors per frame">
              {#each palettes as c}<button type="button" aria-pressed={colors === c} onclick={() => (colors = c)}>{c}</button>{/each}
            </div>
          </div>
          <div>
            <span class="label">dithering</span>
            <div class="seg" role="group" aria-label="Dithering">
              {#each dithers as [d, label]}<button type="button" aria-pressed={dither === d} onclick={() => (dither = d)}>{label}</button>{/each}
            </div>
            <p class="mono mt-2">{dither === 'none' ? 'smallest file; gradients may band' : dither === 'pattern' ? 'fine grid hides banding, stays steady' : 'smoothest gradients, bigger file'}</p>
          </div>
          <div>
            <span class="label">loop</span>
            <div class="seg" role="group" aria-label="Loop">
              {#each loops as [n, label]}<button type="button" aria-pressed={loop === n} onclick={() => (loop = n)}>{label}</button>{/each}
            </div>
          </div>
        {/if}

        <div class="grid gap-2">
          <label for="gif-caption" class="label mb-0!">caption (optional)</label>
          <input id="gif-caption" class="field" maxlength="120" placeholder="when the build passes" bind:value={caption} />
          <div class="seg" role="group" aria-label="Caption position">
            <button type="button" aria-pressed={captionAt === 'top'} onclick={() => (captionAt = 'top')}>top</button>
            <button type="button" aria-pressed={captionAt === 'bottom'} onclick={() => (captionAt = 'bottom')}>bottom</button>
          </div>
        </div>
      </fieldset>
    </aside>
  </div>

  <section class="card mt-6 grid gap-5 p-4 sm:p-6 md:grid-cols-[minmax(0,320px)_1fr] md:items-center" aria-label="Preview and export">
    <figure class="grid gap-2">
      <div class="thumb">
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={preview} role="img" aria-label="Preview of the first frame"></canvas>
        {#if !(format === 'gif' ? gifPreview : firstFrame)}<span class="mono absolute">rendering preview…</span>{/if}
      </div>
      <figcaption class="mono">first frame{format === 'gif' ? ', in the GIF’s exact colors' : ''}</figcaption>
    </figure>

    <div class="grid content-center gap-4">
      {#if job === 'running'}
        <div class="grid gap-2" aria-live="polite">
          <div class="flex items-baseline justify-between gap-3">
            <span class="font-serif text-3xl">{Math.round(progress * 100)}%</span>
            <span class="mono">{formatDuration(elapsed / 1000)} elapsed{remaining !== null ? ` · about ${formatDuration(remaining)} left` : ''}</span>
          </div>
          <div class="bar" role="progressbar" aria-label="Export progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
            <span style:width="{progress * 100}%"></span>
          </div>
          <p class="mono">{status}</p>
          <div><button type="button" class="btn" onclick={cancel}>Cancel</button></div>
        </div>
      {:else if job === 'done' && result}
        <div class="done" role="status">
          <span class="tick" aria-hidden="true">✓</span>
          <div>
            <p class="font-serif text-2xl">Your {result.format === 'gif' ? 'GIF' : result.format === 'mp4' ? 'MP4' : 'WebM'} is ready</p>
            <p class="mono">{formatBytes(result.blob.size)} · {result.width} × {result.height} · {result.seconds.toFixed(1)} s</p>
          </div>
        </div>
      {:else}
        <dl class="stats">
          <div><dt>output</dt><dd>{format === 'gif' ? gifSize.width : videoSize.width} × {format === 'gif' ? gifSize.height : videoSize.height}</dd></div>
          <div><dt>frames</dt><dd>{frameCount}</dd></div>
          <div><dt>length</dt><dd>{seconds.toFixed(1)} s</dd></div>
          <div><dt>size</dt><dd>{estimate === null ? '…' : `≈ ${formatBytes(estimate)}`}</dd></div>
        </dl>
        {#if format !== 'gif' && gifEstimate}
          <p class="mono">as a GIF it would be ≈ {formatBytes(gifEstimate)}, {pctSmaller(videoEstimate, gifEstimate) > 0 ? `so this is about ${pctSmaller(videoEstimate, gifEstimate)}% smaller` : 'about the same'}</p>
        {/if}
        <DeviceNote verdict={deviceFit} />
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn btn-primary" onclick={() => make()} disabled={!!formats.find((f) => f.id === format)?.reason || deviceFit.level === 'block'}>
            Make {format === 'gif' ? 'GIF' : format === 'mp4' ? 'MP4' : 'WebM'}
          </button>
          <button type="button" class="btn" onclick={reset}>Choose another video</button>
        </div>
      {/if}
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
    </div>
  </section>

  {#if job === 'done' && result}
    <section class="card mt-6 grid gap-5 p-4 sm:p-6" aria-label="Result">
      <div class="result">
        {#if result.format === 'gif'}
          <img src={result.url} alt="Your animated GIF" width={result.width} height={result.height} />
        {:else}
          <video src={result.url} autoplay loop muted playsinline controls aria-label="Your looping video" width={result.width} height={result.height}></video>
        {/if}
      </div>
      <div class="compare" aria-label="Size comparison">
        <div><span class="mono">original video</span><span class="mono text-chalk!">{formatBytes(file?.size ?? 0)}</span></div>
        <div class="track"><span class="fill" style:width="{Math.min(100, (result.blob.size / Math.max(1, file?.size ?? 1)) * 100)}%"></span></div>
        <div><span class="mono">{result.name}</span><span class="mono text-sun!">{formatBytes(result.blob.size)}</span></div>
      </div>
      {#if result.format === 'gif' && !formats.find((f) => f.id === 'mp4')?.reason}
        <p class="note">
          The same clip as an MP4 would be about {formatBytes(videoEstimate)}{result.blob.size > videoEstimate ? `, roughly ${Math.max(2, Math.round(result.blob.size / videoEstimate))}× smaller` : ''}. Handy where
          the site accepts video.
          <button type="button" class="link" onclick={() => make('mp4')}>Make an MP4 instead</button>
        </p>
      {/if}
      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary" onclick={() => result && downloadResult(result.blob, result.name)}>Download {result.name}</button>
        <button type="button" class="btn" onclick={adjust}>Change settings</button>
        <button type="button" class="btn" onclick={reset}>Start over</button>
      </div>
    </section>
  {/if}
{/if}

<style>
  .player {
    display: flex;
    justify-content: center;
    background: #0b0a09;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    overflow: hidden;
  }
  .player video {
    display: block;
    width: 100%;
    max-height: min(56vh, 520px);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    border: 1px solid #ffd25e55;
    background: #ffd25e0d;
    border-radius: 12px;
    padding: 10px 14px;
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 120px;
    border-radius: 12px;
    overflow: hidden;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    border: 1px solid var(--color-line-2);
  }
  .thumb canvas {
    display: block;
    width: 100%;
    height: auto;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
    margin: 0;
    & div {
      border: 1px solid var(--color-line);
      border-radius: 12px;
      padding: 10px 12px;
      background: var(--color-panel-2);
    }
    & dt {
      font: 400 12px var(--font-mono);
      color: var(--color-muted);
    }
    & dd {
      margin: 2px 0 0;
      font: 400 20px/1.2 var(--font-serif);
    }
  }
  .bar {
    height: 10px;
    border-radius: 99px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #ffd25e, #ffb23e);
      border-radius: inherit;
      transition: width 0.3s ease-out;
    }
  }
  .done {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .tick {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--color-ok);
    color: var(--color-bg);
    font-size: 22px;
    font-weight: 700;
    animation: pop 0.45s var(--ease-spring);
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  .result {
    display: flex;
    justify-content: center;
    padding: 12px;
    border-radius: 14px;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    & img,
    & video {
      display: block;
      max-width: 100%;
      height: auto;
      max-height: 60vh;
      object-fit: contain;
      border-radius: 6px;
    }
  }
  .compare {
    display: grid;
    gap: 6px;
    & > div:not(.track) {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    & > div > span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  .track {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    min-width: 3px;
    background: var(--color-sun);
    border-radius: inherit;
  }
  .link {
    margin-left: 4px;
    color: var(--color-sun);
    text-decoration: underline;
    text-underline-offset: 3px;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
</style>
