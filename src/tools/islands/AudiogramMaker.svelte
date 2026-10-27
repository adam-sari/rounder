<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';
  import {
    audioCodecLabel,
    capabilities,
    containers,
    decodeAudio,
    downloadName,
    ensureDecodable,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    imagesToVideo,
    isAbort,
    preloadFallback,
    probe,
    transcode,
    videoCodecLabel,
    type AudioCodec,
    type Capabilities,
    type MediaInfo,
  } from '@/engines/media';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { mediaErrorText } from '@/tools/lib/video-to-mp3/job';
  import { captionAt, decodeText, parseSubtitles, type Cue } from '@/tools/lib/subtitles/format';
  import {
    ASPECTS,
    AUDIO_BITRATE,
    carrierSize,
    clampSection,
    DEFAULT_SECTION,
    estimateBytes,
    FPS,
    MAX_SECTION,
    outputSize,
    PALETTES,
    STYLES,
    titleFromName,
    videoBitrate,
    type Aspect,
    type Backdrop,
    type Resolution,
    type VisualStyle,
  } from '@/tools/lib/audiogram-maker/design';
  import { drawFrame, drawStatic, layout, SANS, SERIF, type Design, type Scene } from '@/tools/lib/audiogram-maker/render';
  import { analyze, ANALYSIS_RATE, type Spectrum } from '@/tools/lib/audiogram-maker/spectrum';

  const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.aiff,.aif,.mkv,.avi,.wmv,.flv,.ts,.mts';
  /** decoding a long section in pieces keeps the worker's memory flat */
  const DECODE_CHUNK = 60;

  type Phase = 'probing' | 'decoder' | 'ready' | 'unusable';
  type Out = 'mp4' | 'webm';
  const OUTS: Out[] = ['mp4', 'webm'];

  // ---------------------------------------------------------------- state

  let file = $state<File | null>(null);
  let source = $state.raw<Blob | null>(null);
  let sourceUrl = $state('');
  let info = $state.raw<MediaInfo | null>(null);
  let phase = $state<Phase>('probing');
  let problem = $state('');
  let caps = $state.raw<Capabilities | null>(null);
  let decoder = $state<'idle' | 'loading' | 'converting'>('idle');
  let decoderProgress = $state(0);

  let start = $state(0);
  let end = $state(0);
  let audio = $state<HTMLAudioElement | null>(null);
  let playbackFailed = $state(false);
  let scrubTime = $state(0);

  let aspect = $state<Aspect>('1:1');
  let style = $state<VisualStyle>('bars');
  let backdrop = $state<Backdrop>('gradient');
  let bg1 = $state(PALETTES[0].bg1);
  let bg2 = $state(PALETTES[0].bg2);
  let accent = $state(PALETTES[0].accent);
  let bgImage = $state.raw<ImageBitmap | null>(null);
  let blur = $state(0.5);
  let darken = $state(0.45);
  let title = $state('');
  let subtitle = $state('');
  let cover = $state.raw<ImageBitmap | null>(null);
  let showProgress = $state(true);
  let cues = $state.raw<Cue[]>([]);
  let cueFile = $state('');
  let cuesFromClip = $state(false);
  let res = $state<Resolution>(1080);
  let out = $state<Out>('mp4');
  let imageError = $state('');
  let fontsReady = $state(false);

  let spectrum = $state.raw<{ data: Spectrum; start: number; end: number } | null>(null);
  let analyzing = $state(false);
  let analyzeProgress = $state(0);
  let analyzeError = $state('');
  let analysisCtrl: AbortController | null = null;

  let job = $state<{ startedAt: number; progress: number; status: string } | null>(null);
  let result = $state<{ blob: Blob; url: string; name: string; width: number; height: number; duration: number } | null>(null);
  let runError = $state('');
  let ctrl: AbortController | null = null;

  let canvas = $state<HTMLCanvasElement | null>(null);

  const duration = $derived(info?.durationSec ?? 0);
  const length = $derived(Math.max(0, end - start));
  const size = $derived(outputSize(aspect, res));
  const canEncode = (c: Out) => !!caps && caps.containers[c] && caps.webCodecs.videoEncoder;
  const exportable = $derived(!!caps && (canEncode('mp4') || canEncode('webm')));
  const canRun = $derived(phase === 'ready' && !!source && length > 0 && exportable && canEncode(out) && !job);
  const activePalette = $derived(PALETTES.find((p) => p.bg1 === bg1 && p.bg2 === bg2 && p.accent === accent)?.name ?? '');

  const design: Design = $derived({
    style,
    backdrop,
    bg1,
    bg2,
    image: backdrop === 'image' ? bgImage : null,
    blur,
    darken,
    accent,
    title,
    subtitle,
    cover,
    progress: showProgress,
    captions: cues.length > 0,
  });

  onMount(() => {
    capabilities().then(
      (c) => {
        caps = c;
        if (!c.containers.mp4 && c.containers.webm) out = 'webm';
      },
      () => {},
    );
    // the canvas only draws with a font once it has loaded
    Promise.all([`400 48px ${SERIF}`, `500 48px ${SANS}`, `600 48px ${SANS}`].map((f) => document.fonts.load(f))).finally(() => (fontsReady = true));
  });

  onDestroy(() => {
    ctrl?.abort();
    analysisCtrl?.abort();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (result) URL.revokeObjectURL(result.url);
    bgImage?.close();
    cover?.close();
  });

  // ---------------------------------------------------------------- file

  async function open(files: File[]) {
    const f = files[0];
    if (!f) return;
    reset();
    file = f;
    phase = 'probing';
    title = titleFromName(f.name);
    try {
      const i = await probe(f);
      if (file !== f) return;
      if (i.container === 'gif') return fail('GIFs have no sound. Pick an audio file or a video with sound.');
      if (!i.readable || (i.audio && !i.audio.canDecode)) {
        info = i;
        phase = 'decoder';
        return;
      }
      use(f, i);
    } catch (e) {
      if (file === f) fail(mediaErrorText(e));
    }
  }

  function use(blob: Blob, i: MediaInfo) {
    if (!i.audio) return fail('This file has no audio track.');
    info = i;
    source = blob;
    sourceUrl = URL.createObjectURL(blob);
    start = 0;
    end = Math.min(i.durationSec, DEFAULT_SECTION);
    prev = { start, end };
    phase = 'ready';
  }

  function fail(why: string) {
    phase = 'unusable';
    problem = why;
  }

  async function getDecoder() {
    const f = file;
    if (!f) return;
    decoder = 'loading';
    decoderProgress = 0;
    try {
      await preloadFallback((p) => (decoderProgress = p));
    } catch {
      decoder = 'idle';
      if (file === f) fail("The decoder couldn't be downloaded. Check your connection and try again.");
      return;
    }
    decoder = 'converting';
    try {
      decoderProgress = 0;
      const r = await ensureDecodable(f, { onProgress: (p) => (decoderProgress = p) });
      if (file === f) use(r.file, r.info);
    } catch (e) {
      if (file === f) fail(mediaErrorText(e));
    } finally {
      decoder = 'idle';
    }
  }

  function reset() {
    ctrl?.abort();
    analysisCtrl?.abort();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    clearResult();
    file = null;
    source = null;
    sourceUrl = '';
    info = null;
    problem = '';
    spectrum = null;
    analyzeError = '';
    playbackFailed = false;
    runError = '';
  }

  function startOver() {
    reset();
    cues = [];
    cueFile = '';
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  // ---------------------------------------------------------------- section

  // keep the section between 1 s and 10 min; the handle being dragged wins and the other follows
  let prev = { start: 0, end: 0 };
  $effect(() => {
    const s = start;
    const e = end;
    if (!(duration > 0)) return;
    const c = clampSection(s, e, duration, s !== prev.start ? 'start' : 'end');
    prev = c;
    if (c.start !== s) start = c.start;
    if (c.end !== e) end = c.end;
  });

  // re-read the sound once the handles settle; never during an export, which reads it itself
  // (a pending timer would otherwise abort the export's shared controller)
  $effect(() => {
    const src = source;
    const s = start;
    const e = end;
    const busy = !!job;
    if (!src || busy || phase !== 'ready' || e <= s) return;
    if (spectrum && spectrum.start === s && spectrum.end === e) return;
    const t = setTimeout(() => {
      analysisCtrl?.abort();
      analysisCtrl = new AbortController();
      const signal = analysisCtrl.signal;
      readSound(src, s, e, signal, (p) => (analyzeProgress = p)).catch((err) => {
        if (!signal.aborted) analyzeError = mediaErrorText(err);
      });
    }, 450);
    return () => clearTimeout(t);
  });

  /** decodes the section at a low rate and turns it into per-frame spectra */
  async function readSound(src: Blob, s: number, e: number, signal: AbortSignal, onProgress: (p: number) => void): Promise<Spectrum> {
    analyzing = true;
    analyzeError = '';
    onProgress(0);
    try {
      const parts: Float32Array[] = [];
      for (let a = s; a < e - 1e-6; a += DECODE_CHUNK) {
        const b = Math.min(e, a + DECODE_CHUNK);
        const pcm = await decodeAudio(src, { start: a, end: b, mono: true, sampleRate: ANALYSIS_RATE }, { signal });
        parts.push(pcm.channels[0]);
        onProgress((0.6 * (b - s)) / (e - s));
      }
      const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((off, p) => (samples.set(p, off), off + p.length), 0);
      const data = await analyze(samples, ANALYSIS_RATE, FPS, { signal, onProgress: (p) => onProgress(0.6 + 0.4 * p) });
      if (!signal.aborted) spectrum = { data, start: s, end: e };
      return data;
    } finally {
      if (!signal.aborted || analysisCtrl?.signal === signal) analyzing = false;
    }
  }

  // ---------------------------------------------------------------- images & captions

  async function pickImage(e: Event, set: (b: ImageBitmap) => void) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    imageError = '';
    try {
      set(await createImageBitmap(f));
    } catch {
      imageError = `${f.name} couldn't be opened. Try a JPG, PNG or WebP.`;
    }
  }

  const setCover = (b: ImageBitmap) => {
    cover?.close();
    cover = b;
  };
  function removeCover() {
    cover?.close();
    cover = null;
  }
  const setBackground = (b: ImageBitmap) => {
    bgImage?.close();
    bgImage = b;
    backdrop = 'image';
  };

  let cueError = $state('');
  async function pickCaptions(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    cueError = '';
    const parsed = parseSubtitles(decodeText(new Uint8Array(await f.arrayBuffer())));
    if (!parsed.cues.length) {
      cueError = `No timed captions found in ${f.name}. It should be an .srt or .vtt file.`;
      return;
    }
    cues = parsed.cues;
    cueFile = f.name;
  }

  const captionFor = (clipTime: number) => (cues.length ? captionAt(cues, cuesFromClip ? clipTime : start + clipTime) : '');

  // ---------------------------------------------------------------- live preview

  let scene: Scene | null = null;
  let layer: HTMLCanvasElement | OffscreenCanvas | null = null;
  /** bumps when the static layer is rebuilt, so the frame loop knows to redraw */
  let sceneVersion = 0;

  function makeCanvas(w: number, h: number) {
    return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  }

  /** the static layer and layout for any size; the preview and the export both use it */
  function buildScene(w: number, h: number, d: Design) {
    const l = makeCanvas(w, h);
    const lctx = l.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const s = layout(lctx, w, h, d);
    drawStatic(lctx, s);
    return { scene: s, layer: l };
  }

  $effect(() => {
    const c = canvas;
    const d = design;
    const { width, height } = size;
    void fontsReady;
    if (!c) return;
    // a sharp but light preview: about 560 css px on the long side
    const k = Math.min(1, (560 * Math.min(2, devicePixelRatio || 1)) / Math.max(width, height));
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    ({ scene, layer } = buildScene(w, h, d));
    sceneVersion++;
  });

  $effect(() => {
    const c = canvas;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!scene || !layer) return;
      const now = audio && !playbackFailed ? audio.currentTime : scrubTime;
      const t = Math.min(length, Math.max(0, now - start));
      const spec = spectrum;
      const key = `${sceneVersion}|${t.toFixed(3)}|${spec?.start}|${spec?.end}|${length}|${cuesFromClip}|${cues.length}`;
      if (key === lastKey) return;
      lastKey = key;
      ctx.drawImage(layer, 0, 0);
      // while a new section is being read, the old analysis still lines up by source time
      drawFrame(ctx, scene, { time: t, duration: length, spectrum: spec?.data ?? null, spectrumTime: spec ? start + t - spec.start : t, caption: captionFor(t) });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // ---------------------------------------------------------------- export

  async function make() {
    if (!canRun || !source || !file) return;
    const src = source;
    const s = start;
    const e = end;
    const dur = e - s;
    const { width, height } = size;
    const d = design;
    const container = out;
    ctrl = new AbortController();
    const { signal } = ctrl;
    runError = '';
    clearResult();
    job = { startedAt: performance.now(), progress: 0, status: 'Starting…' };
    const at = (from: number, to: number) => (p: number) => job && (job.progress = from + (to - from) * p);
    try {
      let spec = spectrum && spectrum.start === s && spectrum.end === e ? spectrum.data : null;
      const needsSound = !spec;
      if (!spec) {
        analysisCtrl?.abort();
        analysisCtrl = ctrl;
        job.status = 'Reading the sound…';
        spec = await readSound(src, s, e, signal, (p) => {
          analyzeProgress = p;
          at(0, 0.1)(p);
        });
      }
      const base = needsSound ? 0.1 : 0;

      // the engine draws over a video's frames, so first make a blank one of the right length
      job.status = 'Setting up the frames…';
      const c = carrierSize(aspect);
      const blank = makeCanvas(c.width, c.height);
      const bctx = blank.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      bctx.fillStyle = '#000';
      bctx.fillRect(0, 0, c.width, c.height);
      const bitmap = await createImageBitmap(blank);
      const carrier = await imagesToVideo([bitmap], { container, width: c.width, height: c.height, fps: FPS, durations: dur, quality: 'low' }, { signal, onProgress: at(base, base + 0.08) }).finally(() => bitmap.close());

      job.status = 'Drawing and encoding the video…';
      const { scene: full, layer: fullLayer } = buildScene(width, height, d);
      const final = spec;
      const r = await transcode(
        carrier.blob,
        {
          container,
          video: {
            width,
            height,
            fit: 'fill',
            bitrate: videoBitrate(width, height),
            render: (ctx, _src, f) => {
              ctx.drawImage(fullLayer, 0, 0);
              drawFrame(ctx, full, { time: f.time, duration: dur, spectrum: final, caption: captionFor(f.time) });
            },
          },
          audio: { replace: src, replaceOffset: s, codec: container === 'webm' ? 'opus' : 'aac', bitrate: AUDIO_BITRATE },
        },
        { signal, onProgress: at(base + 0.08, 1) },
      );
      // Start over may have landed just as the encoder finished
      if (signal.aborted) return;
      const name = downloadName(file.name, r.container, '-audiogram');
      result = { blob: r.blob, url: URL.createObjectURL(r.blob), name, width, height, duration: dur };
    } catch (err) {
      if (!(isAbort(err) || signal.aborted)) {
        console.error(err);
        runError = mediaErrorText(err);
      }
    } finally {
      job = null;
      ctrl = null;
    }
  }

  // ---------------------------------------------------------------- display

  /** names the video codec this browser will really use for the container (the engine picks the first it can encode) */
  function formatHint(c: Out) {
    const v = caps ? containers[c].video.find((x) => caps!.video.encode.includes(x)) : c === 'mp4' ? 'avc' : 'vp9';
    if (c === 'mp4') return v === 'avc' || !v ? 'H.264 + AAC, plays everywhere and uploads to every app' : `${videoCodecLabel[v]} + AAC in MP4 (this browser can't make H.264, so some apps may refuse it)`;
    return `${v ? videoCodecLabel[v] : 'VP9'} + Opus, smaller, for the web`;
  }

  const codecName = (c: string | null | undefined) => (c ? (audioCodecLabel[c as AudioCodec] ?? c.toUpperCase()) : 'unknown');

  function details(i: MediaInfo) {
    const parts = [formatTime(i.durationSec, 0)];
    if (i.audio) parts.push(`${codecName(i.audio.codec)} · ${i.audio.channels === 1 ? 'mono' : i.audio.channels === 2 ? 'stereo' : `${i.audio.channels} ch`} · ${Math.round(i.audio.sampleRate / 100) / 10} kHz`);
    if (i.video) parts.push(`video ${i.video.displayWidth}×${i.video.displayHeight}`);
    return parts.join(' · ');
  }

  const styleIcon: Record<VisualStyle, string> = {
    bars: 'M3 15V11M7 15V6M11 15V9M15 15V4M19 15V8',
    wave: 'M2 10h2c1-3 2-5 3-5s2 3 3 5 2 5 3 5 2-2 3-5 1.5-3 2-3M2 10h2c1 3 2 5 3 5s2-3 3-5',
    line: 'M2 14c2 0 3-8 5-8s3 6 5 6 3-9 5-9 2 6 3 6',
    circle: 'M11 3v2M11 15v2M3 10h2M17 10h2M5.3 4.3l1.4 1.4M15.3 14.3l1.4 1.4M5.3 15.7l1.4-1.4M15.3 5.7l1.4-1.4',
  };
</script>

{#if !file}
  <Dropzone accept={ACCEPT} title="Drop an audio file here" hint="podcast, song or voice note · a video with sound works too" onfiles={open} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
    <div class="grid min-w-0 content-start gap-4">
      <section class="stage" aria-label="Preview">
        {#if phase === 'probing'}
          <div class="still mono" role="status">reading the file…</div>
        {:else if phase === 'unusable'}
          <div class="still">
            <p class="font-serif text-2xl">This file won't work</p>
            <p class="mono text-bad" role="alert">{problem}</p>
          </div>
        {:else if phase === 'decoder'}
          <div class="still">
            <p class="font-serif text-2xl">Your browser can't read this format on its own</p>
            <p class="mono max-w-md">
              Rounder can fetch a free decoder (ffmpeg, {FALLBACK_DOWNLOAD_MB} MB) once and convert it on this device. Nothing is uploaded.
            </p>
            {#if decoder === 'loading'}
              <div class="meter mx-auto w-56" role="progressbar" aria-label="Downloading the decoder" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(decoderProgress * 100)}>
                <span style:width="{decoderProgress * 100}%"></span>
              </div>
              <p class="mono" role="status">Downloading… {Math.round(decoderProgress * 100)}%</p>
            {:else if decoder === 'converting'}
              <div class="meter mx-auto w-56" role="progressbar" aria-label="Converting the file" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(decoderProgress * 100)}>
                <span style:width="{decoderProgress * 100}%"></span>
              </div>
              <p class="mono" role="status">Converting the file… {Math.round(decoderProgress * 100)}%</p>
            {:else}
              <button type="button" class="btn btn-primary mx-auto" onclick={getDecoder}>Download decoder · {FALLBACK_DOWNLOAD_MB} MB</button>
            {/if}
          </div>
        {:else}
          <div class="frame">
            <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
            <canvas
              bind:this={canvas}
              style:aspect-ratio="{size.width} / {size.height}"
              style:width="min(100%, calc(var(--preview-h) * {size.width / size.height}))"
              aria-label="Live preview of the video: {STYLES.find((x) => x.id === style)?.label} visualizer{title ? `, titled ${title}` : ''}"
              role="img"
            ></canvas>
          </div>
          <p class="mono flex flex-wrap justify-between gap-x-3" aria-live="polite">
            <span>
              {#if analyzing}<span class="text-sun">listening… {Math.round(analyzeProgress * 100)}%</span>{:else if analyzeError}<span class="text-bad">{analyzeError}</span>{:else}live preview · press play{/if}
            </span>
            <span>{size.width}×{size.height} · {FPS} fps</span>
          </p>
          <audio bind:this={audio} src={sourceUrl} controls preload="metadata" class="w-full" onerror={() => (playbackFailed = true)}></audio>
          {#if playbackFailed}
            <p class="mono">Your browser can't play this format, but the video can still be made. Drag the timeline to preview frames.</p>
          {/if}
        {/if}

        {#if file}
          <div class="grid gap-1 px-1">
            <p class="truncate text-sm">{file.name}</p>
            <p class="mono">{#if info && (info.readable || info.via === 'ffmpeg')}{details(info)} · {/if}{formatBytes(file.size)}</p>
          </div>
        {/if}
      </section>

      {#if phase === 'ready' && source && duration > 0}
        <section class="grid gap-2" aria-label="Section">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="label m-0!">section to use</span>
            <span class="mono">{formatTime(length, 1)} of {formatTime(duration, 0)} · up to {MAX_SECTION / 60} min</span>
          </div>
          <TrimTimeline file={source} kind="audio" {duration} media={playbackFailed ? null : audio} bind:start bind:end bind:currentTime={scrubTime} loop disabled={!!job} />
        </section>
      {/if}

      {#if result}
        <section class="result" aria-label="Your video">
          <div class="ready" role="status">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
            <div class="min-w-0">
              <p class="font-serif text-2xl leading-tight">Your video is ready</p>
              <p class="mono">
                {result.width}×{result.height} · {formatTime(result.duration, 0)} · audio {formatBytes(file.size)} → video <span class="text-chalk">{formatBytes(result.blob.size)}</span>
              </p>
            </div>
          </div>
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={result.url} controls playsinline preload="metadata"></video>
          <button type="button" class="btn btn-primary" onclick={() => result && downloadBlob(result.blob, result.name)}>Download {result.name.split('.').pop()?.toUpperCase()}</button>
        </section>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid min-w-0 gap-5" disabled={!!job || phase !== 'ready'}>
        <div>
          <span class="label">shape</span>
          <div class="seg" role="group" aria-label="Video shape">
            {#each ASPECTS as a (a.id)}
              <button type="button" aria-pressed={aspect === a.id} onclick={() => (aspect = a.id)}>{a.label}</button>
            {/each}
          </div>
          <p class="mono mt-2">{ASPECTS.find((a) => a.id === aspect)?.hint}</p>
        </div>

        <div>
          <span class="label">visualizer</span>
          <div class="styles" role="group" aria-label="Visualizer style">
            {#each STYLES as s (s.id)}
              <button type="button" aria-pressed={style === s.id} onclick={() => (style = s.id)}>
                <svg viewBox="0 0 22 20" aria-hidden="true"><path d={styleIcon[s.id]} /></svg>
                {s.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="grid gap-3">
          <span class="label m-0!">colors</span>
          <div class="swatches" role="group" aria-label="Color presets">
            {#each PALETTES as p (p.name)}
              <button
                type="button"
                aria-pressed={activePalette === p.name}
                aria-label={p.name}
                title={p.name}
                style:background="linear-gradient(135deg, {p.bg1}, {p.bg2})"
                onclick={() => ((bg1 = p.bg1), (bg2 = p.bg2), (accent = p.accent))}
              >
                <span style:background={p.accent}></span>
              </button>
            {/each}
          </div>
          <div class="seg" role="group" aria-label="Background">
            <button type="button" aria-pressed={backdrop === 'solid'} onclick={() => (backdrop = 'solid')}>Solid</button>
            <button type="button" aria-pressed={backdrop === 'gradient'} onclick={() => (backdrop = 'gradient')}>Gradient</button>
            <button type="button" aria-pressed={backdrop === 'image'} onclick={() => (backdrop = 'image')}>Image</button>
          </div>
          <div class="flex flex-wrap gap-3">
            <label class="color"><input type="color" bind:value={bg1} />{backdrop === 'gradient' ? 'from' : 'background'}</label>
            {#if backdrop === 'gradient'}<label class="color"><input type="color" bind:value={bg2} />to</label>{/if}
            <label class="color"><input type="color" bind:value={accent} />visualizer</label>
          </div>
          {#if backdrop === 'image'}
            <div class="grid gap-3">
              <label class="btn file">
                <input type="file" accept="image/*" class="sr-only" onchange={(e) => pickImage(e, setBackground)} />
                {bgImage ? 'Change background image' : 'Choose background image'}
              </label>
              {#if bgImage}
                <label class="grid gap-1 text-sm">
                  <span class="flex justify-between">Blur <span class="mono">{Math.round(blur * 100)}%</span></span>
                  <input type="range" min="0" max="1" step="0.05" bind:value={blur} />
                </label>
                <label class="grid gap-1 text-sm">
                  <span class="flex justify-between">Darken <span class="mono">{Math.round(darken * 100)}%</span></span>
                  <input type="range" min="0" max="0.85" step="0.05" bind:value={darken} />
                </label>
              {:else}
                <p class="mono">Until you pick one, the background color is used.</p>
              {/if}
            </div>
          {/if}
        </div>

        <div class="grid gap-3">
          <label class="grid gap-1">
            <span class="label m-0!">title</span>
            <input class="field" bind:value={title} maxlength="120" placeholder="Episode or song name" />
          </label>
          <label class="grid gap-1">
            <span class="label m-0!">subtitle</span>
            <input class="field" bind:value={subtitle} maxlength="160" placeholder="Show, artist or guest" />
          </label>
        </div>

        <div class="grid gap-2">
          <span class="label m-0!">cover art</span>
          <div class="flex flex-wrap gap-2">
            <label class="btn file">
              <input type="file" accept="image/*" class="sr-only" onchange={(e) => pickImage(e, setCover)} />
              {cover ? 'Change cover' : 'Add cover image'}
            </label>
            {#if cover}<button type="button" class="btn" onclick={removeCover}>Remove</button>{/if}
          </div>
          {#if imageError}<p class="mono text-bad" role="alert">{imageError}</p>{/if}
        </div>

        <div class="grid gap-2">
          <span class="label m-0!">captions</span>
          {#if cues.length}
            <p class="mono">{cueFile} · {cues.length} caption{cues.length === 1 ? '' : 's'}</p>
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" class="mt-1" bind:checked={cuesFromClip} />
              <span>Times count from the start of this section<span class="mono block">leave off if the file matches the full recording</span></span>
            </label>
            <button type="button" class="btn" onclick={() => ((cues = []), (cueFile = ''))}>Remove captions</button>
          {:else}
            <label class="btn file">
              <input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" class="sr-only" onchange={pickCaptions} />
              Add .srt or .vtt file
            </label>
            <p class="mono">Optional. Shown under the visualizer, timed to the audio.</p>
          {/if}
          {#if cueError}<p class="mono text-bad" role="alert">{cueError}</p>{/if}
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={showProgress} />
          Progress bar with timer
        </label>

        <div class="grid gap-3 border-t border-line pt-5">
          <div>
            <span class="label">format</span>
            <div class="seg" role="group" aria-label="Video format">
              {#each OUTS as c (c)}
                <button
                  type="button"
                  aria-pressed={out === c}
                  disabled={!!caps && !canEncode(c)}
                  title={caps && !canEncode(c) ? `Your browser can't create ${c.toUpperCase()} video` : undefined}
                  onclick={() => (out = c)}>{c === 'mp4' ? 'MP4' : 'WebM'}</button
                >
              {/each}
            </div>
            <p class="mono mt-2">{formatHint(out)}</p>
          </div>
          <div>
            <span class="label">size</span>
            <div class="seg" role="group" aria-label="Video size">
              <button type="button" aria-pressed={res === 1080} onclick={() => (res = 1080)}>1080p</button>
              <button type="button" aria-pressed={res === 720} onclick={() => (res = 720)}>720p · faster</button>
            </div>
          </div>
          {#if length > 0}
            <p class="mono">up to ≈ {formatBytes(estimateBytes(length, size.width, size.height))} for {formatTime(length, 0)} at {size.width}×{size.height}</p>
          {/if}
        </div>
      </fieldset>

      <div class="grid gap-3 border-t border-line pt-5">
        {#if job}
          <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label="Making your video" status={job.status} oncancel={() => ctrl?.abort()} />
        {:else}
          <button type="button" class="btn btn-primary" disabled={!canRun} onclick={make}>{result ? 'Make it again' : 'Make video'}</button>
          {#if caps && !exportable}
            <p class="mono text-bad">This browser can't encode video. Try a recent Chrome, Edge, Safari or Firefox.</p>
          {:else if phase === 'ready'}
            <p class="mono">Renders on your device, so long sections take a while. Keep this tab open until it's done.</p>
          {/if}
        {/if}
        {#if runError}<p class="mono text-bad" role="alert">{runError}</p>{/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .stage {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
    --preview-h: min(560px, 70vh);
  }
  .frame {
    display: grid;
    place-items: center;
    padding: 10px;
    border-radius: 12px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px), #0d0c0b;
    & canvas {
      display: block;
      border-radius: 8px;
      box-shadow: 0 10px 30px #0008;
    }
  }
  .still {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    min-height: 240px;
    padding: 24px;
    text-align: center;
    border-radius: 12px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px), #141312;
  }
  .styles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    & button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 10px;
      border: 1px solid var(--color-line-2);
      border-radius: 12px;
      background: var(--color-panel-2);
      color: var(--color-soft);
      font: 500 13.5px var(--font-sans);
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
    }
    & button[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-chalk);
    }
    & svg {
      flex: none;
      width: 22px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    & button[aria-pressed='true'] svg {
      stroke: var(--color-sun);
    }
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    & button {
      position: relative;
      width: 38px;
      height: 38px;
      border: 1px solid var(--color-line-2);
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.2s var(--ease-spring);
    }
    & span {
      position: absolute;
      right: 6px;
      bottom: 6px;
      width: 10px;
      height: 10px;
      border-radius: 99px;
    }
    & button[aria-pressed='true'] {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .color {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
    & input {
      width: 34px;
      height: 28px;
      padding: 0;
      border: 1px solid var(--color-line-2);
      border-radius: 8px;
      background: none;
      cursor: pointer;
    }
  }
  .file {
    cursor: pointer;
    justify-content: center;
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  input[type='range'] {
    accent-color: var(--color-sun);
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
      max-height: 480px;
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
    & path {
      stroke-width: 2;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .result {
      animation: rise 0.4s var(--ease-spring) both;
    }
    .tick circle {
      stroke-dasharray: 66;
      animation: draw 0.5s ease-out both;
    }
    .tick path {
      stroke-dasharray: 16;
      animation: draw16 0.35s 0.35s ease-out both;
    }
    .swatches button:hover {
      transform: translateY(-2px);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 66;
    }
  }
  @keyframes draw16 {
    from {
      stroke-dashoffset: 16;
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
