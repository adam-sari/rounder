<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';
  import {
    bitmapToBlob,
    clamp,
    ensureDecodable,
    extractFrames,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    frameAt,
    isAbort,
    probe,
    videoCodecLabel,
    type MediaInfo,
    type VideoCodec,
  } from '@/engines/media';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { contactSheetLayout, FRAME_CAP, frameFileName, frameNumber, planFrameTimes, stepTime, type BatchMode } from '@/tools/lib/video-frame-extractor/frames';
  import { mediaErrorText } from '@/tools/lib/video-to-mp3/job';

  const ACCEPT = 'video/*,.mkv,.avi,.wmv,.flv,.m4v,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv,.vob';
  /** gallery tiles are ~150–250 CSS px wide; 400 covers a 2× screen */
  const THUMB_WIDTH = 400;
  type ImgFormat = 'jpeg' | 'png' | 'webp';
  const FORMATS: [ImgFormat, string, string, string][] = [
    ['jpeg', 'JPG', 'image/jpeg', 'jpg'],
    ['png', 'PNG', 'image/png', 'png'],
    ['webp', 'WebP', 'image/webp', 'webp'],
  ];
  const MODES: [BatchMode, string][] = [
    ['count', 'evenly spaced'],
    ['interval', 'every X sec'],
    ['all', 'all frames'],
  ];

  interface Shot {
    id: number;
    time: number;
    blob: Blob;
    url: string;
    /** small JPEG for the gallery, so hundreds of full-size stills aren't decoded just to show tiles */
    thumb: string;
    name: string;
    width: number;
    height: number;
    format: ImgFormat;
  }

  let file = $state.raw<File | null>(null);
  let info = $state.raw<MediaInfo | null>(null);
  /** what we decode from: the file itself, or a copy the ffmpeg fallback made readable */
  let source = $state.raw<Blob | null>(null);
  let url = $state('');
  let phase = $state<'probing' | 'decoder' | 'ready' | 'error'>('probing');
  let loadError = $state('');
  let video = $state<HTMLVideoElement | null>(null);
  let previewFailed = $state(false);
  let stillUrl = $state('');
  let now = $state(0);
  let start = $state(0);
  let end = $state(0);

  let mode = $state<BatchMode>('count');
  let count = $state(12);
  let interval = $state(2);
  let format = $state<ImgFormat>('jpeg');
  let quality = $state(92);

  let shots = $state<Shot[]>([]);
  let job = $state<{ startedAt: number; progress: number; label: string; status: string } | null>(null);
  let grabbing = $state(false);
  let flash = $state(0);
  let error = $state('');
  let zipping = $state(false);

  let columns = $state(4);
  let stamps = $state(true);
  let header = $state(true);
  let sheet = $state.raw<{ key: string; blob: Blob; url: string; width: number; height: number; name: string } | null>(null);
  let sheetBusy = $state(false);

  let ctrl: AbortController | null = null;
  let nextId = 0;

  const fmt = $derived(FORMATS.find((f) => f[0] === format)!);
  const fps = $derived(info?.video?.fps || 30);
  const duration = $derived(info?.durationSec ?? 0);
  const dims = $derived(info?.video ? `${info.video.displayWidth}×${info.video.displayHeight}` : '');
  const plan = $derived(planFrameTimes(mode, { start, end, count, interval, fps: info?.video?.fps }));
  const wholeRange = $derived(start <= 0.01 && end >= duration - 0.01);
  const mismatched = $derived(shots.filter((s) => s.format !== format).length);
  const totalBytes = $derived(shots.reduce((s, x) => s + x.blob.size, 0));
  const busy = $derived(!!job || grabbing);
  const base = $derived((file?.name ?? 'video').replace(/\.[^.]+$/, ''));
  const sheetKey = $derived(JSON.stringify([shots.map((s) => s.id), columns, stamps, header, format, quality]));

  $effect(() => {
    if (sheet && sheet.key !== sheetKey) {
      URL.revokeObjectURL(sheet.url);
      sheet = null;
    }
  });

  onDestroy(() => reset());

  // ---------------------------------------------------------------- open

  function reset() {
    ctrl?.abort();
    ctrl = null;
    job = null;
    if (url) URL.revokeObjectURL(url);
    if (stillUrl) URL.revokeObjectURL(stillUrl);
    if (sheet) URL.revokeObjectURL(sheet.url);
    shots.forEach(revokeShot);
    url = '';
    stillUrl = '';
    sheet = null;
    shots = [];
    file = null;
    info = null;
    source = null;
    previewFailed = false;
    error = '';
    loadError = '';
    now = 0;
    start = 0;
    end = 0;
  }

  async function open(files: File[]) {
    const f = files[0];
    if (!f) return;
    reset();
    file = f;
    phase = 'probing';
    try {
      const i = await probe(f);
      if (file !== f) return;
      info = i;
      if (i.container === 'gif') fail('This tool works with videos rather than GIFs. Try the GIF to MP4 tool first.');
      else if (!i.readable || (i.video && !i.video.canDecode)) phase = 'decoder';
      else if (!i.video) fail('This file has no video track, so there are no frames to grab.');
      else ready(f, i);
    } catch (e) {
      if (file === f) fail(mediaErrorText(e));
    }
  }

  function fail(why: string) {
    loadError = why;
    phase = 'error';
  }

  function ready(src: Blob, i: MediaInfo) {
    source = src;
    info = i;
    url = URL.createObjectURL(src);
    end = i.durationSec;
    phase = 'ready';
  }

  async function convert() {
    if (!file) return;
    const f = file;
    ctrl = new AbortController();
    const { signal } = ctrl;
    job = { startedAt: performance.now(), progress: 0, label: 'Making the video readable', status: 'Downloading decoder…' };
    try {
      const r = await ensureDecodable(f, { signal, onProgress: (p) => job && (job.progress = p), onStatus: (s) => job && (job.status = s) });
      if (file !== f) return;
      if (!r.info.video) fail('This file has no video track, so there are no frames to grab.');
      else ready(r.file, r.info);
    } catch (e) {
      // the ffmpeg path doesn't always report a cancel as 'aborted'
      if (file === f && !signal.aborted && !isAbort(e)) fail(mediaErrorText(e));
    } finally {
      job = null;
      ctrl = null;
    }
  }

  // ---------------------------------------------------------------- player

  function step(dir: number) {
    if (video && !previewFailed) {
      video.pause();
      video.currentTime = stepTime(video.currentTime, fps, dir, duration);
    } else now = stepTime(now, fps, dir, duration);
  }

  function seekTo(t: number) {
    if (video && !previewFailed) {
      video.pause();
      video.currentTime = t;
    } else now = t;
  }

  function keys(e: KeyboardEvent) {
    if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      step(e.key === ',' ? -1 : 1);
    }
  }

  // when the browser can't play the file, show decoded stills at the playhead instead
  let stillToken = 0;
  $effect(() => {
    if (!previewFailed || !source || !info?.video) return;
    const t = now;
    const src = source;
    const width = Math.min(960, info.video.displayWidth);
    const token = ++stillToken;
    const timer = setTimeout(async () => {
      try {
        const bmp = await frameAt(src, t, { width });
        const blob = await bitmapToBlob(bmp, 'image/jpeg', 0.85);
        bmp.close();
        if (token !== stillToken) return;
        if (stillUrl) URL.revokeObjectURL(stillUrl);
        stillUrl = URL.createObjectURL(blob);
      } catch {}
    }, 120);
    return () => clearTimeout(timer);
  });

  // ---------------------------------------------------------------- frames

  async function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, f: ImgFormat): Promise<Blob> {
    const [, , mime] = FORMATS.find((x) => x[0] === f)!;
    const q = quality / 100;
    const blob = canvas instanceof OffscreenCanvas ? await canvas.convertToBlob({ type: mime, quality: q }) : await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, q));
    if (blob?.type === mime) return blob;
    // Safari can't write WebP from a canvas; the image engine can
    const { encodeCanvas } = await import('@/engines/image/client');
    return encodeCanvas(canvas, { format: f, quality });
  }

  async function encode(bmp: ImageBitmap, f: ImgFormat) {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    return toBlob(canvas, f);
  }

  async function thumbnail(bmp: ImageBitmap) {
    const w = Math.min(THUMB_WIDTH, bmp.width);
    const canvas = new OffscreenCanvas(w, Math.max(1, Math.round((bmp.height * w) / bmp.width)));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  }

  function revokeShot(s: Shot) {
    URL.revokeObjectURL(s.url);
    URL.revokeObjectURL(s.thumb);
  }

  /** encodes and files one frame; false when skipped. Never throws, so a batch keeps going */
  async function store(bmp: ImageBitmap, time: number, f: File): Promise<boolean> {
    try {
      if (file !== f || shots.some((s) => Math.abs(s.time - time) < 1e-4 && s.format === format)) return false;
      const [blob, thumb] = await Promise.all([encode(bmp, format), thumbnail(bmp)]);
      if (file !== f) return false;
      const shot = { id: nextId++, time, blob, url: URL.createObjectURL(blob), thumb: URL.createObjectURL(thumb), name: frameFileName(f.name, time, fmt[3], duration >= 3600), width: bmp.width, height: bmp.height, format };
      const at = shots.findIndex((s) => s.time > time);
      shots.splice(at < 0 ? shots.length : at, 0, shot);
      return true;
    } catch (e) {
      error = mediaErrorText(e);
      return false;
    } finally {
      bmp.close();
    }
  }

  async function grab() {
    if (!source || !file || busy) return;
    // a player parked at the very end sits past the last frame's start; take the last frame
    const t = Math.min(video && !previewFailed ? video.currentTime : now, Math.max(0, duration - 0.5 / fps));
    video?.pause();
    grabbing = true;
    error = '';
    try {
      if (await store(await frameAt(source, t), t, file)) flash++;
    } catch (e) {
      error = mediaErrorText(e);
    } finally {
      grabbing = false;
    }
  }

  /** decodes `times` from the video in memory-sized chunks, with progress and Cancel; `use` must close the bitmap and never throw */
  async function decodeFrames(times: number[], label: string, use: (bmp: ImageBitmap, time: number, f: File) => Promise<unknown>) {
    if (!source || !file || !info?.video || !times.length || busy) return;
    const f = file;
    const src = source;
    // decode in chunks so full-size bitmaps never pile up faster than they're encoded
    const chunk = clamp(Math.floor(2e8 / (info.video.displayWidth * info.video.displayHeight * 4 || 1)), 4, 32);
    ctrl = new AbortController();
    const { signal } = ctrl;
    let done = 0;
    let chain = Promise.resolve();
    error = '';
    job = { startedAt: performance.now(), progress: 0, label, status: 'Decoding…' };
    try {
      for (let i = 0; i < times.length && !signal.aborted; i += chunk) {
        await extractFrames(src, { times: times.slice(i, i + chunk) }, {
          signal,
          onFrame: (fr) => {
            chain = chain.then(async () => {
              await use(fr.bitmap, fr.time, f);
              done++;
              if (job) {
                job.progress = done / times.length;
                job.status = `${done} of ${times.length} frames`;
              }
            });
          },
        });
        await chain;
      }
    } catch (e) {
      // the ffmpeg path doesn't always report a cancel as 'aborted'
      if (!signal.aborted && !isAbort(e)) error = mediaErrorText(e);
    } finally {
      await chain;
      job = null;
      ctrl = null;
    }
  }

  function extractBatch() {
    const n = plan.times.length;
    return decodeFrames(plan.times, `Extracting ${n} frame${n === 1 ? '' : 's'}`, store);
  }

  /** re-decodes from the video rather than re-encoding the old image, so a JPG turned PNG isn't left with JPG artifacts */
  function convertShots() {
    const pending = shots.filter((x) => x.format !== format);
    const to = format;
    const [, label, , ext] = fmt;
    return decodeFrames(pending.map((x) => x.time), `Converting ${pending.length} frame${pending.length === 1 ? '' : 's'} to ${label}`, async (bmp, time, f) => {
      try {
        // the engine reports the time it decoded, clamped to the video; match the nearest waiting shot
        const s = pending.reduce<Shot | null>((best, x) => (!best || Math.abs(x.time - time) < Math.abs(best.time - time) ? x : best), null);
        if (!s || file !== f) return;
        pending.splice(pending.indexOf(s), 1);
        if (!shots.includes(s)) return;
        // already grabbed in the new format: keep that one
        if (shots.some((x) => x !== s && x.format === to && Math.abs(x.time - s.time) < 1e-4)) return removeShot(s);
        const blob = await encode(bmp, to);
        URL.revokeObjectURL(s.url);
        Object.assign(s, { blob, url: URL.createObjectURL(blob), format: to, name: s.name.replace(/\.[^.]+$/, `.${ext}`) });
      } catch (e) {
        error = mediaErrorText(e);
      } finally {
        bmp.close();
      }
    });
  }

  function removeShot(s: Shot) {
    revokeShot(s);
    shots.splice(shots.indexOf(s), 1);
  }

  function clearShots() {
    shots.forEach(revokeShot);
    shots = [];
  }

  async function downloadAll() {
    if (shots.length === 1) return downloadBlob(shots[0].blob, shots[0].name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(shots.map((s) => ({ name: s.name, blob: s.blob }))), `${base}-frames.zip`);
    } catch {
      error = "The zip couldn't be made. Try downloading the frames one by one.";
    } finally {
      zipping = false;
    }
  }

  // ---------------------------------------------------------------- contact sheet

  async function makeSheet() {
    if (!shots.length || !file || sheetBusy) return;
    sheetBusy = true;
    error = '';
    const key = sheetKey;
    const list = [...shots];
    const pad = 32;
    try {
      await Promise.all([document.fonts.load('400 34px "Instrument Serif"'), document.fonts.load('500 16px "Geist Mono Variable"')]).catch(() => {});
      const L = contactSheetLayout(list.length, list[0].width, list[0].height, { columns, pad, header: header ? 76 : 0 });
      const canvas = document.createElement('canvas');
      canvas.width = L.width;
      canvas.height = L.height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#131211';
      ctx.fillRect(0, 0, L.width, L.height);
      if (header) {
        ctx.fillStyle = '#f2ede4';
        ctx.font = '400 34px "Instrument Serif", Georgia, serif';
        ctx.fillText(file.name, pad, pad + 30, L.width - pad * 2);
        ctx.fillStyle = '#9a948a';
        ctx.font = '500 16px "Geist Mono Variable", ui-monospace, monospace';
        ctx.fillText([formatTime(duration, 2), dims, `${list.length} frame${list.length === 1 ? '' : 's'}`].filter(Boolean).join('  ·  '), pad, pad + 58);
      }
      const size = clamp(Math.round(L.tileWidth / 15), 11, 22);
      ctx.font = `500 ${size}px "Geist Mono Variable", ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      for (const [i, s] of list.entries()) {
        const { x, y } = L.cells[i];
        const bmp = await createImageBitmap(s.blob, { resizeWidth: L.tileWidth, resizeHeight: L.tileHeight, resizeQuality: 'high' });
        ctx.drawImage(bmp, x, y, L.tileWidth, L.tileHeight);
        bmp.close();
        if (stamps) {
          const label = formatTime(s.time, 2);
          const w = ctx.measureText(label).width + size;
          const h = size * 1.7;
          const lx = x + L.tileWidth - w - size * 0.5;
          const ly = y + L.tileHeight - h - size * 0.5;
          ctx.fillStyle = 'rgba(19, 18, 17, 0.78)';
          ctx.beginPath();
          ctx.roundRect(lx, ly, w, h, h / 2);
          ctx.fill();
          ctx.fillStyle = '#f2ede4';
          ctx.fillText(label, lx + size / 2, ly + h / 2 + 1);
        }
      }
      const blob = await toBlob(canvas, format);
      canvas.width = canvas.height = 0;
      if (sheetKey !== key) return;
      if (sheet) URL.revokeObjectURL(sheet.url);
      sheet = { key, blob, url: URL.createObjectURL(blob), width: L.width, height: L.height, name: `${base}-contact-sheet.${fmt[3]}` };
    } catch (e) {
      error = mediaErrorText(e);
    } finally {
      sheetBusy = false;
    }
  }

  const codecName = (c: string | null | undefined) => (c ? (videoCodecLabel[c as VideoCodec] ?? c.toUpperCase()) : '');
</script>

{#if !file}
  <Dropzone accept={ACCEPT} title="Drop a video here" hint="or click to choose · MP4, MOV, WebM, MKV and more" onfiles={open} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="filebar">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{file.name}</p>
          <p class="mono">
            {#if info?.video}{formatTime(duration, 2)} · {dims} · {info.video.fps ? `${Math.round(info.video.fps * 100) / 100} fps` : 'fps unknown'}{info.video.codec ? ` · ${codecName(info.video.codec)}` : ''} · {/if}{formatBytes(file.size)}
          </p>
        </div>
        <button type="button" class="btn px-3! py-2!" onclick={() => reset()} disabled={!!job}>Change video</button>
      </div>

      {#if phase === 'probing'}
        <div class="still mono">reading the video…</div>
      {:else if phase === 'error'}
        <div class="still">
          <p class="font-serif text-2xl">Can't open this one</p>
          <p class="mono text-bad" role="alert">{loadError}</p>
        </div>
      {:else if phase === 'decoder'}
        <div class="still">
          <p class="font-serif text-2xl">Your browser can't read this video on its own</p>
          <p class="mono max-w-md">
            Rounder can fetch a free decoder (ffmpeg, {FALLBACK_DOWNLOAD_MB} MB) once and make a readable copy. It all happens on this device; nothing is uploaded.
          </p>
          {#if job}
            <div class="mt-2 w-full max-w-sm text-left">
              <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label={job.label} status={job.status} oncancel={() => ctrl?.abort()} />
            </div>
          {:else}
            <button type="button" class="btn btn-primary mt-2 justify-self-center" onclick={convert}>Download decoder · {FALLBACK_DOWNLOAD_MB} MB</button>
          {/if}
        </div>
      {:else if source && info}
        <section class="stage" aria-label="Player">
          <div class="screen">
            {#if previewFailed}
              {#if stillUrl}<img src={stillUrl} alt="Frame at {formatTime(now, 3)}" />{:else}<span class="mono">decoding a preview…</span>{/if}
            {:else}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video bind:this={video} src={url} controls playsinline preload="auto" onerror={() => (previewFailed = true)} onkeydown={keys}></video>
            {/if}
            {#key flash}
              {#if flash}<span class="flash" aria-hidden="true"></span>{/if}
            {/key}
          </div>

          <div class="controls">
            <div class="flex items-center gap-1">
              <button type="button" class="btn px-3! py-2!" onclick={() => step(-1)} aria-label="Previous frame" title="Previous frame ( , )">‹ 1f</button>
              <button type="button" class="btn px-3! py-2!" onclick={() => step(1)} aria-label="Next frame" title="Next frame ( . )">1f ›</button>
            </div>
            <p class="mono readout" aria-live="off">
              <span class="text-chalk">{formatTime(now, 3)}</span> · frame {frameNumber(now, fps)}
            </p>
            <button type="button" class="btn btn-primary grab" onclick={grab} disabled={busy}>
              {grabbing ? 'Grabbing…' : 'Grab this frame'}
            </button>
          </div>

          <div>
            <p class="label">range for batch extraction · drag the handles to narrow it</p>
            <TrimTimeline file={source} kind="video" {duration} media={previewFailed ? null : video} bind:start bind:end bind:currentTime={now} step={1 / fps} disabled={!!job} />
          </div>
        </section>
      {/if}

      {#if shots.length}
        <section class="grid gap-3" aria-label="Extracted frames">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-2xl">{shots.length} frame{shots.length === 1 ? '' : 's'} <span class="mono">· {formatBytes(totalBytes)}</span></h2>
            <button type="button" class="btn px-3! py-2!" onclick={clearShots} disabled={busy}>Clear all</button>
          </div>
          {#if mismatched}
            <p class="mono">
              {mismatched} frame{mismatched === 1 ? ' is' : 's are'} in another format.
              <button type="button" class="link" onclick={convertShots} disabled={busy}>Convert to {fmt[1]}</button>
            </p>
          {/if}
          <ul class="gallery" style:--ar={info?.video ? `${info.video.displayWidth} / ${info.video.displayHeight}` : '16 / 9'}>
            {#each shots as s (s.id)}
              <li class="tile">
                <button type="button" class="shot" onclick={() => seekTo(s.time)} aria-label="Go to {formatTime(s.time, 3)} in the player">
                  <img src={s.thumb} alt="Frame at {formatTime(s.time, 3)}" loading="lazy" decoding="async" />
                </button>
                <div class="cap">
                  <span class="mono min-w-0 flex-1 truncate"><span class="text-chalk">{formatTime(s.time, 2)}</span> · {formatBytes(s.blob.size)}</span>
                  <button type="button" class="icon" onclick={() => downloadBlob(s.blob, s.name)} aria-label="Download {s.name}">↓</button>
                  <button type="button" class="icon" onclick={() => removeShot(s)} disabled={busy} aria-label="Remove frame at {formatTime(s.time, 2)}">✕</button>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      {#if phase === 'ready'}
        <fieldset class="grid min-w-0 gap-4" disabled={busy}>
          <div>
            <span class="label">extract several frames</span>
            <div class="seg" role="group" aria-label="Batch mode">
              {#each MODES as [value, label] (value)}
                <button type="button" aria-pressed={mode === value} onclick={() => (mode = value)}>{label}</button>
              {/each}
            </div>
          </div>
          {#if mode === 'count'}
            <label class="flex items-center gap-2">
              <input type="number" class="field w-24! py-2!" min="1" max={FRAME_CAP} step="1" bind:value={count} aria-label="Number of frames" />
              <span class="mono">frames, spread evenly</span>
            </label>
          {:else if mode === 'interval'}
            <label class="flex items-center gap-2">
              <span class="mono">one every</span>
              <input type="number" class="field w-24! py-2!" min="0.1" step="0.5" bind:value={interval} aria-label="Seconds between frames" />
              <span class="mono">seconds</span>
            </label>
          {:else}
            <p class="mono">Every frame at {Math.round(fps * 100) / 100} fps{info?.video?.fps ? '' : ' (assumed)'}. Narrow the range on the timeline to a short stretch.</p>
          {/if}
          <p class="mono">
            {wholeRange ? 'Whole video' : `${formatTime(start, 2)} → ${formatTime(end, 2)}`} · <span class="text-chalk">{plan.times.length} frame{plan.times.length === 1 ? '' : 's'}</span>
          </p>
          {#if plan.wanted > FRAME_CAP}
            <p class="mono text-sun" role="note">
              That's {plan.wanted.toLocaleString('en-US')} frames. One batch stops at {FRAME_CAP}{mode === 'count' ? ', spread over the range' : `, up to ${formatTime(plan.times[plan.times.length - 1], 2)}`}. Narrow the range or run another batch for more.
            </p>
          {/if}
          {#if !job}
            <button type="button" class="btn" onclick={extractBatch} disabled={!plan.times.length || busy}>Extract {plan.times.length} frame{plan.times.length === 1 ? '' : 's'}</button>
          {/if}
        </fieldset>

        {#if job}
          <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label={job.label} status={job.status} oncancel={() => ctrl?.abort()} />
        {/if}

        <fieldset class="grid min-w-0 gap-4 border-t border-line pt-5" disabled={busy}>
          <div>
            <span class="label">image format</span>
            <div class="seg" role="group" aria-label="Image format">
              {#each FORMATS as [value, label] (value)}
                <button type="button" aria-pressed={format === value} onclick={() => (format = value)}>{label}</button>
              {/each}
            </div>
            <p class="mono mt-2">{format === 'png' ? 'lossless, larger files' : format === 'jpeg' ? 'opens everywhere, small files' : 'smaller than JPG, for the web'} · full {dims}</p>
          </div>
          {#if format !== 'png'}
            <label>
              <span class="label">quality · {quality}</span>
              <input type="range" min="40" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
              <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
            </label>
          {/if}
        </fieldset>

        {#if shots.length}
          <div class="grid gap-3 border-t border-line pt-5">
            <button type="button" class="btn btn-primary" disabled={zipping || busy} onclick={downloadAll}>
              {zipping ? 'Zipping…' : shots.length > 1 ? `Download all (${shots.length}) as .zip` : `Download ${fmt[1]}`}
            </button>
          </div>

          <fieldset class="grid min-w-0 gap-4 border-t border-line pt-5" disabled={busy || sheetBusy}>
            <div>
              <span class="label">contact sheet · columns</span>
              <div class="seg" role="group" aria-label="Contact sheet columns">
                {#each [2, 3, 4, 5, 6] as c (c)}
                  <button type="button" aria-pressed={columns === c} onclick={() => (columns = c)}>{c}</button>
                {/each}
              </div>
            </div>
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" bind:checked={stamps} class="mt-1" />
              <span>Timestamps on each frame</span>
            </label>
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" bind:checked={header} class="mt-1" />
              <span>Title line<span class="mono block">file name, length, size and frame count</span></span>
            </label>
            {#if sheet}
              <a class="sheet" href={sheet.url} target="_blank" rel="noopener">
                <img src={sheet.url} alt="Contact sheet of {shots.length} frames" />
              </a>
              <p class="mono">{sheet.width}×{sheet.height} · {formatBytes(sheet.blob.size)}</p>
              <button type="button" class="btn btn-primary" onclick={() => sheet && downloadBlob(sheet.blob, sheet.name)}>Download contact sheet</button>
            {:else}
              <button type="button" class="btn" onclick={makeSheet}>{sheetBusy ? 'Making the sheet…' : `Make a contact sheet of ${shots.length} frame${shots.length === 1 ? '' : 's'}`}</button>
            {/if}
          </fieldset>
        {:else if !job}
          <p class="mono border-t border-line pt-5">Frames you grab or extract show up here, ready to download one by one, as a zip or as a contact sheet.</p>
        {/if}
      {/if}
      {#if error}<p class="mono text-bad" role="alert">{error}</p>{/if}
    </aside>
  </div>
{/if}

<style>
  .filebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  .still {
    display: grid;
    justify-items: center;
    place-content: center;
    gap: 8px;
    min-height: 260px;
    padding: 28px;
    text-align: center;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px), #141312;
  }
  .stage {
    display: grid;
    gap: 14px;
    padding: 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .screen {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 180px;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
    & video,
    & img {
      width: 100%;
      max-height: 480px;
      object-fit: contain;
    }
  }
  .flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: #fff;
    animation: shutter 0.45s ease-out forwards;
  }
  @keyframes shutter {
    from {
      opacity: 0.55;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flash {
      display: none;
    }
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .readout {
    flex: 1;
    min-width: 150px;
    font-variant-numeric: tabular-nums;
  }
  .grab {
    background: var(--color-sun);
    border-color: var(--color-sun);
    &:hover {
      background: #ffe08a;
    }
  }
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .tile {
    display: grid;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
    background: #141312;
    animation: pop 0.35s var(--ease-spring) both;
  }
  .shot {
    display: block;
    padding: 0;
    border: 0;
    cursor: pointer;
    background: #000;
    aspect-ratio: var(--ar);
    & img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    &:hover img {
      opacity: 0.85;
    }
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 8px;
  }
  .icon {
    flex: none;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--color-soft);
    cursor: pointer;
    &:hover {
      background: var(--color-panel-2);
      color: var(--color-chalk);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--color-sun);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .sheet {
    display: block;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    overflow: hidden;
    animation: pop 0.35s var(--ease-spring) both;
    & img {
      width: 100%;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.92);
      opacity: 0;
    }
  }
  fieldset:disabled {
    opacity: 0.6;
  }
</style>
