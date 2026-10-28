<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import DeviceNote from '@/components/tool/DeviceNote.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import {
    audioCodecLabel,
    capabilities,
    concat,
    containers,
    downloadName,
    ensureDecodable,
    FALLBACK_DOWNLOAD_MB,
    formatBytes,
    formatTime,
    isAbort,
    probe,
    segmentsDuration,
    transcode,
    videoCodecLabel,
    type Capabilities,
    type MediaError,
    type MediaInfo,
    type Segment,
    type TranscodeResult,
  } from '@/engines/media';
  import { checkDevice, deviceMessage, type Job } from '@/tools/lib/device-guard';
  import { downloadResult } from '@/tools/lib/files';
  import {
    copyBlocker,
    defaultContainer,
    etaSeconds,
    exportPreset,
    frameIndex,
    friendlyError,
    inPoint,
    keptParts,
    markCut,
    markTrimIn,
    markTrimOut,
    outPoint,
    outputCodec,
    skipTarget,
    sourceVideoBitrate,
    stepFrame,
    videoQuality,
    VIDEO_CONTAINERS,
    type Preset,
    type VideoContainer,
  } from '@/tools/lib/trim-video/plan';

  type Phase = 'empty' | 'probing' | 'needs-decoder' | 'converting' | 'edit' | 'working' | 'done';
  const MIN = 0.1;
  const ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.mpg,.mpeg,.3gp,.ts,.mts,.m2ts,.ogv';

  const presets: { id: Preset; label: string; hint: string }[] = [
    { id: 'very-high', label: 'Best', hint: "frame-accurate, re-encoded at the original's bitrate, so the file is about the size of that part of the original" },
    { id: 'high', label: 'High', hint: 'frame-accurate, a smaller file that still looks sharp' },
    { id: 'medium', label: 'Smaller', hint: 'frame-accurate, good for messaging and email' },
    { id: 'copy', label: 'No re-encode', hint: 'fastest and lossless, but the start snaps to the nearest keyframe (up to a few seconds early)' },
  ];

  let phase = $state<Phase>('empty');
  let error = $state('');
  let file = $state<File | null>(null);
  /** what we decode and play: the file itself, or a playable copy made by the fallback decoder */
  let src = $state<Blob | null>(null);
  let info = $state<MediaInfo | null>(null);
  let sourceContainer = $state('');
  let caps = $state<Capabilities | null>(null);
  let previewUrl = $state('');
  let previewBroken = $state(false);
  let video = $state<HTMLVideoElement | null>(null);

  // a preset from the address (/trim-video#start=10): where the kept part starts and ends, in seconds
  let { start: startAt = 0, end: endAt }: { start?: number; end?: number } = $props();

  let mode = $state<'trim' | 'segments'>('trim');
  let start = $state(0);
  let end = $state(0);
  let cuts = $state<Segment[]>([]);
  let currentTime = $state(0);
  let loop = $state(false);
  let skipCuts = $state(true);
  let container = $state<VideoContainer>('mp4');
  let preset = $state<Preset>('very-high');

  let controller: AbortController | null = null;
  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let result = $state<(TranscodeResult & { url: string }) | null>(null);
  let resultBroken = $state(false);

  const duration = $derived(info?.durationSec ?? 0);
  const fps = $derived(info?.video?.fps || 30);
  const parts = $derived(keptParts(mode, start, end, cuts, duration, 0.5 / fps));
  const outLength = $derived(segmentsDuration(parts));
  // low-end devices: the fallback decoder rewrites the whole file inside its 2 GB heap; an export keeps frames in flight
  const decoderFit = $derived(file ? checkDevice('ffmpeg', { bytes: file.size, tip: 'Try a shorter recording, or trim it on a computer.' }) : null);
  const exportJob: Job = 'video';
  const deviceFit = $derived(
    file && info?.video
      ? checkDevice(exportJob, {
          bytes: file.size,
          // joined parts are cut to intermediates first, so two copies of the output are held at once
          outBytes: duration ? ((parts.length > 1 ? 2 : 1) * file.size * outLength) / duration : undefined,
          seconds: outLength,
          width: info.video.displayWidth,
          height: info.video.displayHeight,
          tip: 'Try Smaller quality, a shorter part or fewer cuts.',
        })
      : null,
  );
  /** why the original stream can't be kept as is ('' = it can) */
  const copyBlock = $derived(
    parts.length !== 1 ? 'joining parts needs a re-encode' : info?.video ? copyBlocker(info.video.codec, info.video.rotation, container) : '',
  );
  const copyAllowed = $derived(!copyBlock);
  const effective = $derived<Preset>(preset === 'copy' && !copyAllowed ? 'very-high' : preset);
  /** what the export does: Best copies too when the kept part starts on the first frame */
  const exportAs = $derived(exportPreset(preset, parts, copyBlock, fps));
  const encodable = $derived(caps?.video.encode ?? null);
  const hint = $derived.by(() => {
    if (preset === 'very-high' && exportAs === 'copy') return 'the clip starts on the first frame, so nothing needs re-encoding: the original video is copied untouched (lossless, original quality and bitrate)';
    if (exportAs === 'copy' && parts[0]?.start < 0.5 / fps) return 'fastest and lossless; the clip starts on the first frame, so the start is exact too';
    // Best scales the bitrate up when it has to switch to a less efficient codec, so the size claim doesn't hold
    const v = info?.video;
    const unit = { codec: v?.codec ?? null, width: v?.displayWidth ?? 0, height: v?.displayHeight ?? 0, bitrate: 1e6 };
    if (exportAs === 'very-high' && v && videoQuality('very-high', unit, outputCodec('very-high', v.codec, container, encodable))!.bitrate > unit.bitrate)
      return `frame-accurate, at about the original's quality; this browser can't write ${v.codec?.toUpperCase() ?? 'its codec'} into ${container.toUpperCase()}, so the file can come out larger than that part of the original`;
    const base = presets.find((p) => p.id === effective)?.hint ?? '';
    return preset === 'copy' && !copyAllowed ? `${base} · ${copyBlock}, so Best is used` : base;
  });
  const ext = $derived(file?.name.match(/\.([^.]+)$/)?.[1].toUpperCase() ?? 'this');
  const busy = $derived(phase === 'working' || phase === 'converting');
  const eta = $derived(etaSeconds(now - startedAt, progress));

  // ---------------------------------------------------------------- open

  async function open(files: File[]) {
    reset();
    const f = files[0];
    file = f;
    phase = 'probing';
    try {
      const [probed, c] = await Promise.all([probe(f), capabilities().catch(() => null)]);
      if (file !== f) return; // another file was dropped meanwhile
      caps = c;
      sourceContainer = probed.container;
      if (probed.needsFallback) phase = 'needs-decoder';
      else use(f, probed);
    } catch (e) {
      if (file !== f) return;
      fail(e);
      file = null;
      phase = 'empty';
    }
  }

  function use(blob: Blob, probed: MediaInfo) {
    if (!probed.video) {
      error = friendlyError('no-tracks', '');
      file = null;
      phase = 'empty';
      return;
    }
    src = blob;
    info = probed;
    start = startAt < probed.durationSec ? startAt : 0;
    end = endAt && endAt > start && endAt < probed.durationSec ? endAt : probed.durationSec;
    cuts = [];
    currentTime = 0;
    container = defaultContainer(sourceContainer, caps?.containers ?? null);
    previewUrl = URL.createObjectURL(blob);
    phase = 'edit';
  }

  async function convert() {
    if (!file) return;
    const signal = begin('converting');
    try {
      const r = await ensureDecodable(file, { signal, onStatus: (s) => (status = s), onProgress: (p) => (progress = p) });
      use(r.file, r.info);
    } catch (e) {
      if (phase !== 'converting') return;
      phase = 'needs-decoder';
      if (!isAbort(e)) fail(e, 'ffmpeg');
    } finally {
      controller = null;
    }
  }

  // ---------------------------------------------------------------- export

  function begin(next: Phase) {
    controller = new AbortController();
    error = '';
    progress = 0;
    status = '';
    startedAt = now = performance.now();
    phase = next;
    return controller.signal;
  }

  async function run() {
    if (!src || !info?.video || !parts.length) return;
    video?.pause();
    const v = info.video;
    const source = { codec: v.codec, width: v.displayWidth, height: v.displayHeight, bitrate: sourceVideoBitrate(info) };
    const outCodec = outputCodec(exportAs, v.codec, container, encodable);
    const quality = videoQuality(exportAs, source, outCodec);
    // naming the codec keeps Best in the source's own codec (the engine would take the container's first)
    const videoOptions = quality ? { ...quality, codec: outCodec } : undefined;
    const signal = begin('working');
    try {
      let out: TranscodeResult;
      if (parts.length === 1) {
        out = await transcode(src, { container, trim: parts[0], video: videoOptions }, { signal, onStatus: (s) => (status = s), onProgress: (p) => (progress = p) });
      } else {
        // each kept part is cut at Best (the source's bitrate, so intermediates stay the size of the
        // parts), then the join encodes once at the chosen quality
        const pieceCodec = outputCodec('very-high', v.codec, container, encodable);
        const pieceQuality = { ...videoQuality('very-high', source, pieceCodec), codec: pieceCodec };
        const pieces: Blob[] = [];
        let done = 0;
        for (const [i, part] of parts.entries()) {
          status = `Cutting part ${i + 1} of ${parts.length}…`;
          const len = part.end - part.start;
          const piece = await transcode(src, { container, trim: part, video: pieceQuality }, { signal, onProgress: (p) => (progress = (0.5 * (done + p * len)) / outLength) });
          pieces.push(piece.blob);
          done += len;
        }
        status = `Joining ${parts.length} parts…`;
        out = await concat(pieces, { container, ...videoOptions }, { signal, onProgress: (p) => (progress = 0.5 + 0.5 * p) });
      }
      // cancelled (or closed) just as the job finished: don't show a result nobody wants
      if (signal.aborted) {
        if (phase === 'working') phase = 'edit';
        return;
      }
      progress = 1;
      now = performance.now();
      result = { ...out, url: URL.createObjectURL(out.blob) };
      resultBroken = false;
      phase = 'done';
    } catch (e) {
      if (phase !== 'working') return;
      phase = 'edit';
      if (!isAbort(e)) fail(e, exportJob);
    } finally {
      controller = null;
    }
  }

  const cancel = () => controller?.abort();

  /** `job` turns running out of memory into advice for that step */
  function fail(e: unknown, job?: Job) {
    const err = e as Partial<MediaError>;
    error = (job && deviceMessage(job, e)) || friendlyError(err?.code, err?.message ?? '');
  }

  function backToEdit() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
    phase = 'edit';
  }

  function reset() {
    controller?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
    previewUrl = '';
    result = null;
    previewBroken = false;
    file = null;
    src = null;
    info = null;
    error = '';
    mode = 'trim';
    loop = false;
    phase = 'empty';
  }

  function save() {
    if (!file || !result) return;
    downloadResult(result.blob, downloadName(file.name, result.container, mode === 'trim' ? '-trimmed' : '-cut'));
  }

  // ---------------------------------------------------------------- precision controls

  function seekTo(t: number) {
    currentTime = Math.min(Math.max(0, t), duration);
    if (video && !previewBroken) video.currentTime = currentTime;
  }

  function stepBy(dir: number, seconds = false) {
    video?.pause();
    seekTo(seconds ? currentTime + dir : stepFrame(currentTime, fps, dir, duration));
  }

  function markIn() {
    const t = inPoint(currentTime, fps);
    if (mode === 'trim') ({ start, end } = markTrimIn({ start, end }, t, duration, MIN));
    else cuts = markCut(cuts, t, 'start', duration, MIN);
  }

  function markOut() {
    const t = outPoint(currentTime, fps, duration);
    if (mode === 'trim') ({ start, end } = markTrimOut({ start, end }, t, duration, MIN));
    else cuts = markCut(cuts, t, 'end', duration, MIN);
  }

  function toggleLoop() {
    if (previewBroken) return;
    loop = !loop;
    if (loop && video && video.paused && parts.length && !previewBroken) {
      const first = parts[0].start;
      if (currentTime < first || currentTime >= parts[parts.length - 1].end - 0.05) video.currentTime = first;
      void video.play();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (phase !== 'edit' || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'i') markIn();
    else if (k === 'o') markOut();
    else if (k === 'l') toggleLoop();
    else if (k === ',' || k === '<') stepBy(-1, e.shiftKey);
    else if (k === '.' || k === '>') stepBy(1, e.shiftKey);
    else return;
    e.preventDefault();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // "preview without cuts": hop over removed parts while playing, and loop the result. Also
  // loops trim mode when the selection runs to the very end: playback stops there before the
  // timeline's own loop check sees it.
  $effect(() => {
    const v = video;
    if (!v) return;
    const segments = mode === 'segments';
    let raf = 0;
    const restart = () => {
      if (loop && parts.length) {
        v.currentTime = parts[0].start;
        void v.play();
      } else v.pause();
    };
    const tick = () => {
      const to = skipCuts ? skipTarget(cuts, v.currentTime) : null;
      if (to !== null) {
        if (to >= duration - 0.01) restart();
        else v.currentTime = to;
      }
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (!segments) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('ended', restart);
    if (!v.paused) onPlay(); // switched modes mid-playback
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('ended', restart);
    };
  });

  // elapsed / ETA clock
  $effect(() => {
    if (!busy) return;
    const id = setInterval(() => (now = performance.now()), 250);
    return () => clearInterval(id);
  });

  onDestroy(() => {
    controller?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
  });

  // ---------------------------------------------------------------- labels

  const codecName = (c: string | null | undefined, labels: Record<string, string>) => (c ? (labels[c] ?? c.toUpperCase()) : '');
  const clock = (sec: number) => formatTime(sec, 0);
  const shrink = (a: number, b: number) => {
    const pct = Math.round((1 - b / a) * 100);
    return pct > 0 ? `${pct}% smaller` : pct < 0 ? `${-pct}% larger` : 'same size';
  };
  function formatReason(c: VideoContainer) {
    if (!caps || caps.containers[c]) return '';
    return `This browser can't write ${containers[c].label} video`;
  }
</script>

{#if phase === 'empty' || phase === 'probing'}
  {#if phase === 'probing'}
    <div class="panel grid place-items-center gap-2 px-5 py-16 text-center" aria-busy="true">
      <p class="font-serif text-3xl">Opening your video…</p>
      <p class="mono">reading it on your device</p>
    </div>
  {:else}
    <Dropzone accept={ACCEPT} title="Drop a video to trim" hint="MP4, MOV, WebM, MKV, AVI and more" onfiles={open} />
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else if phase === 'needs-decoder' || phase === 'converting'}
  <div class="panel grid gap-4 p-5 sm:p-7">
    <div>
      <p class="mono">{file?.name} · {formatBytes(file?.size ?? 0)}</p>
      <h2 class="mt-1 text-3xl">This {ext} file needs a decoder</h2>
    </div>
    <p class="max-w-[60ch] text-soft">
      Your browser can't play this format by itself. We can convert it right here on your device with a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download.
      Nothing is uploaded. Long videos can take a while, since this decoder runs without hardware help.
    </p>
    {#if phase === 'converting'}
      {@render meter('Preparing your video')}
    {:else}
      <DeviceNote verdict={decoderFit} />
      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary" onclick={convert} disabled={decoderFit?.level === 'block'}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB) & open</button>
        <button type="button" class="btn" onclick={reset}>Choose another file</button>
      </div>
    {/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
  </div>
{:else if file && src && info?.video}
  {@const v = info.video}
  <div class="grid gap-5" hidden={phase === 'done'}>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate font-medium" title={file.name}>{file.name}</p>
        <p class="mono flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{formatTime(duration)}</span>
          <span>{v.displayWidth}×{v.displayHeight}</span>
          {#if v.fps}<span>{Math.round(v.fps * 100) / 100} fps</span>{/if}
          <span>{codecName(v.codec, videoCodecLabel)}{info.audio ? ` / ${codecName(info.audio.codec, audioCodecLabel)}` : ' · no sound'}</span>
          <span>{formatBytes(file.size)}</span>
          {#if src !== file}<span class="text-sun">converted for playback</span>{/if}
        </p>
      </div>
      <button type="button" class="btn sm" onclick={reset} disabled={busy}>Change video</button>
    </div>

    <div class="player">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} src={previewUrl} controls playsinline preload="auto" onerror={() => (previewBroken = true)}></video>
      {#if previewBroken}
        <p class="broken mono">Your browser can't preview this file, but trimming still works. Use the timeline thumbnails to find your spot.</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="seg" role="group" aria-label="What to do">
        <button type="button" aria-pressed={mode === 'trim'} onclick={() => (mode = 'trim')} disabled={busy}>keep one part</button>
        <button type="button" aria-pressed={mode === 'segments'} onclick={() => (mode = 'segments')} disabled={busy}>cut out parts</button>
      </div>
      {#if mode === 'segments'}
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={skipCuts} class="accent-(--color-sun)" />
          Preview without cuts
        </label>
      {/if}
    </div>

    <TrimTimeline
      file={src}
      kind="video"
      {duration}
      media={previewBroken ? null : video}
      {mode}
      segmentKind="cut"
      bind:start
      bind:end
      bind:segments={cuts}
      bind:currentTime
      step={1 / fps}
      minLength={MIN}
      loop={mode === 'trim' && loop}
      disabled={busy}
    />

    {#if mode === 'segments' && !cuts.length}
      <p class="mono -mt-2">Press <b>+ segment</b> (or play to a spot and press I, then O) over each part you want removed. Everything else is joined together.</p>
    {/if}

    <div class="precise" class:dim={busy}>
      <div class="nudge" role="group" aria-label="Step through frames">
        <button type="button" class="key" onclick={() => stepBy(-1)} disabled={busy} aria-label="Previous frame" title="Previous frame ( , )">‹</button>
        <span class="mono now" aria-live="off"><b>{formatTime(currentTime)}</b> frame {frameIndex(currentTime, fps)}</span>
        <button type="button" class="key" onclick={() => stepBy(1)} disabled={busy} aria-label="Next frame" title="Next frame ( . )">›</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn sm" onclick={markIn} disabled={busy}>{mode === 'trim' ? 'Set start' : 'Cut from'} here <kbd>I</kbd></button>
        <button type="button" class="btn sm" onclick={markOut} disabled={busy}>{mode === 'trim' ? 'Set end' : 'Cut to'} here <kbd>O</kbd></button>
        <button type="button" class="btn sm" aria-pressed={loop} onclick={toggleLoop} disabled={busy || previewBroken}>{loop ? 'Looping' : 'Loop preview'} <kbd>L</kbd></button>
      </div>
    </div>
    <p class="mono -mt-3 hidden sm:block">
      <kbd>,</kbd> <kbd>.</kbd> step one frame · with <kbd>shift</kbd> one second · arrow keys nudge a focused handle by a frame
    </p>

    <section class="panel grid gap-5 p-5 sm:p-6">
      <div class="grid gap-5 md:grid-cols-[auto_1fr]">
        <div>
          <span class="label">format</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each VIDEO_CONTAINERS as c (c)}
              {@const reason = formatReason(c)}
              <button type="button" aria-pressed={container === c} onclick={() => (container = c)} disabled={busy || !!reason} title={reason || undefined}>
                {containers[c].label}{c === sourceContainer ? ' · same' : ''}
              </button>
            {/each}
          </div>
        </div>
        <div>
          <span class="label">quality</span>
          <div class="seg" role="group" aria-label="Quality">
            {#each presets as p (p.id)}
              <button
                type="button"
                aria-pressed={effective === p.id}
                onclick={() => (preset = p.id)}
                disabled={busy || (p.id === 'copy' && !copyAllowed)}
                title={p.id === 'copy' && copyBlock ? copyBlock[0].toUpperCase() + copyBlock.slice(1) : undefined}>{p.label}</button
              >
            {/each}
          </div>
          <p class="mono mt-2">{hint}</p>
        </div>
      </div>

      {#if phase === 'working'}
        {@render meter(mode === 'trim' ? 'Trimming' : 'Cutting')}
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p class="mono">
            result <b class="text-chalk">{formatTime(outLength)}</b>
            {#if mode === 'segments'}· {parts.length} {parts.length === 1 ? 'part' : 'parts'}{parts.length > 1 ? ' joined' : ''}{/if}
            · {containers[container].label}
          </p>
          <button type="button" class="btn btn-primary" onclick={run} disabled={!parts.length || outLength < MIN || deviceFit?.level === 'block'}>
            {mode === 'trim' ? 'Trim video' : 'Cut & export'}
          </button>
        </div>
        <DeviceNote verdict={deviceFit} />
      {/if}
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
    </section>
  </div>

  {#if phase === 'done' && result}
    <div class="panel done grid gap-5 p-5 sm:p-7">
      <div class="flex items-center gap-4">
        <svg class="tick" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" /><path d="M14 25l7 7 13-15" /></svg>
        <div>
          <h2 class="text-3xl">Your clip is ready</h2>
          <p class="mono">made on your device in {clock((now - startedAt) / 1000)}</p>
        </div>
      </div>

      <div class="player">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={result.url} controls playsinline preload="metadata" onerror={() => (resultBroken = true)}></video>
        {#if resultBroken}
          <p class="broken mono">This browser can't play {containers[result.container].label} files, but the download is fine. Pick MP4 for a preview here.</p>
        {/if}
      </div>

      <dl class="stats">
        <div><dt class="mono">length</dt><dd>{formatTime(duration)} <span>→</span> {formatTime(result.durationSec)}</dd></div>
        <div><dt class="mono">size</dt><dd>{formatBytes(file.size)} <span>→</span> {formatBytes(result.blob.size)} <em>{shrink(file.size, result.blob.size)}</em></dd></div>
        <div><dt class="mono">format</dt><dd>{containers[result.container].label}{result.width ? ` · ${result.width}×${result.height}` : ''}</dd></div>
      </dl>
      {#each result.notes as note (note)}<p class="mono">{note}</p>{/each}

      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary" onclick={save}>Download {containers[result.container].label}</button>
        <button type="button" class="btn" onclick={backToEdit}>Back to editing</button>
        <button type="button" class="btn" onclick={reset}>Start over</button>
      </div>
    </div>
  {/if}
{/if}

{#snippet meter(label: string)}
  <div class="meter grid gap-3" aria-live="polite">
    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="font-serif text-2xl">{label}… <span class="text-sun">{Math.floor(progress * 100)}%</span></p>
        <p class="mono">{status || 'starting…'}</p>
      </div>
      <button type="button" class="btn sm" onclick={cancel}>Cancel</button>
    </div>
    <div class="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)}>
      <i style:transform={`scaleX(${progress})`}></i>
    </div>
    <p class="mono flex justify-between">
      <span>elapsed {clock((now - startedAt) / 1000)}</span>
      <span>{eta === null ? 'estimating time left…' : `about ${clock(eta)} left`}</span>
    </p>
  </div>
{/snippet}

<style>
  .panel {
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
  }
  .btn.sm {
    padding: 8px 12px;
    font-size: 14px;
    border-radius: 10px;
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .player {
    position: relative;
    display: grid;
    place-items: center;
    background: #0d0c0b;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    overflow: hidden;
    & video {
      display: block;
      width: 100%;
      max-height: min(62vh, 560px);
      background: #000;
    }
  }
  .broken {
    position: absolute;
    inset: auto 12px 12px;
    padding: 8px 12px;
    border-radius: 10px;
    background: #131211e6;
    border: 1px solid var(--color-line-2);
    color: var(--color-soft);
  }
  .precise {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    &.dim {
      opacity: 0.55;
    }
  }
  .nudge {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: #141312;
    padding: 3px;
  }
  .key {
    width: 36px;
    height: 32px;
    border-radius: 9px;
    border: 0;
    background: var(--color-panel-2);
    color: var(--color-chalk);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: transform 0.18s var(--ease-spring), background 0.15s;
    &:hover:not(:disabled) {
      background: #2c2a26;
    }
    &:active:not(:disabled) {
      transform: scale(0.92);
    }
  }
  .now {
    padding: 0 12px;
    min-width: 17ch;
    text-align: center;
    & b {
      font-weight: 500;
      color: var(--color-chalk);
      margin-right: 6px;
    }
  }
  kbd {
    font: 400 11px var(--font-mono);
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 0 5px;
    margin-left: 2px;
  }
  .bar {
    height: 10px;
    border-radius: 99px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    overflow: hidden;
    & i {
      display: block;
      height: 100%;
      transform-origin: left;
      background: linear-gradient(90deg, #ffd25eb3, var(--color-sun));
      box-shadow: 0 0 18px #ffd25e66;
      transition: transform 0.3s ease-out;
    }
  }
  .done {
    border-color: #9be58f55;
    animation: rise 0.45s var(--ease-spring);
  }
  .tick {
    flex: none;
    width: 52px;
    height: 52px;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke: #9be58f40;
      stroke-width: 3;
    }
    & path {
      stroke: var(--color-ok);
      stroke-width: 4;
      stroke-dasharray: 34;
      stroke-dashoffset: 34;
      animation: draw 0.5s 0.15s ease-out forwards;
    }
  }
  .stats {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    & div {
      padding: 12px 14px;
      border: 1px solid var(--color-line);
      border-radius: 12px;
      background: var(--color-panel-2);
    }
    & dd {
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
      & span {
        color: var(--color-muted);
      }
      & em {
        display: block;
        font: 400 12.5px var(--font-mono);
        color: var(--color-ok);
        font-style: normal;
      }
    }
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
