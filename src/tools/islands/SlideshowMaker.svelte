<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import { decodeImage, toDecodable } from '@/engines/image/client';
  import {
    capabilities,
    containers,
    decodeAudio,
    fade,
    FALLBACK_DOWNLOAD_MB,
    formatBytes,
    formatTime,
    hasWebCodecs,
    imagesToVideo,
    MediaError,
    probe,
    throwIfAborted,
    transcode,
    writeWav,
    type Capabilities,
  } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import {
    aspects, errorText, fadeGain, fileBase, fitDurations, formatEta, frameState, MAX_SLIDE_SEC, MIN_SLIDE_SEC, outputSize, resolutions,
    resolveDurations, slideStarts, total, TRANSITION_SEC, transitionLength,
    type AspectId, type FitMode, type Transition,
  } from '@/tools/lib/slideshow-maker/plan';
  import { composeSlide, composeTitle, context, drawFrame, newCanvas, toJpeg, type AnyCanvas, type Img } from '@/tools/lib/slideshow-maker/render';

  interface Slide {
    id: number;
    name: string;
    file: File;
    /** downscaled copy for thumbnails and the preview; the file is decoded again at full size on export */
    bmp: ImageBitmap;
    /** own duration, or null to follow the global one */
    duration: number | null;
  }
  type Item = { id: number; slide: Slide | null }; // slide null = the title card
  type Format = 'mp4' | 'webm';

  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const MUSIC_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.weba';
  const KEEP = 800; // long side of each photo's in-memory copy
  const PREVIEW = 800; // long side of the preview canvas
  const TITLE_ID = -1;

  let slides = $state<Slide[]>([]);
  let decoding = $state(0);
  let notice = $state('');
  let selectedId = $state<number | null>(null);

  let aspectId = $state<AspectId>('16:9');
  let short = $state<number>(1080);
  let fit = $state<FitMode>('blur');
  let background = $state('#000000');
  let transition = $state<Transition>('fade');
  let kenBurns = $state(true);
  let globalSec = $state(3);

  let titleOn = $state(false);
  let titleText = $state('');
  let titleSub = $state('');
  let titleSec = $state(3);
  let titleFont = $state<'serif' | 'sans'>('serif');
  let titleOnPhoto = $state(true);

  let music = $state<{ blob: Blob; name: string; size: number; duration: number; url: string } | null>(null);
  let musicStart = $state(0);
  let musicEnd = $state(0);
  let fadeIn = $state(1);
  let fadeOut = $state(2);
  let fitToMusic = $state(false);
  let musicBusy = $state('');
  let musicError = $state('');
  let musicPending = $state<File | null>(null);

  let caps = $state<Capabilities | null>(null);
  let webCodecs = $state(true);
  let format = $state<Format>('mp4');
  let job = $state<{ stage: string; progress: number; started: number; now: number } | null>(null);
  let result = $state<{ blob: Blob; url: string; size: number; durationSec: number; width: number; height: number; container: Format; name: string } | null>(null);
  let error = $state('');
  let fontsReady = $state(false);

  let canvas = $state<HTMLCanvasElement>();
  let trimAudio = $state<HTMLAudioElement | null>(null);
  let previewAudio = $state<HTMLAudioElement>();
  let picker: HTMLInputElement;
  let musicPicker: HTMLInputElement;
  let nextId = 0;
  let generation = 0; // bumped by "start over" so photos still being read are dropped
  let abort: AbortController | null = null;
  let musicAbort: AbortController | null = null;

  // ---------------------------------------------------------------- timing

  const items = $derived<Item[]>([...(titleOn ? [{ id: TITLE_ID, slide: null }] : []), ...slides.map((s) => ({ id: s.id, slide: s }))]);
  const musicLen = $derived(music ? Math.max(0, musicEnd - musicStart) : 0);
  const fitted = $derived(
    fitToMusic && music && slides.length ? fitDurations(slides.map((s) => s.duration), Math.max(0, musicLen - (titleOn ? titleSec : 0))) : null,
  );
  const photoDurs = $derived(fitted?.durations ?? resolveDurations(slides.map((s) => s.duration), globalSec));
  const durs = $derived(titleOn ? [titleSec, ...photoDurs] : photoDurs);
  const totalSec = $derived(total(durs));
  const T = $derived(transitionLength(durs, transition));
  const starts = $derived(slideStarts(durs));
  const size = $derived(outputSize(aspectId, short));
  const view = $derived(outputSize(aspectId, Math.round((PREVIEW * Math.min(size.w, size.h)) / Math.max(size.w, size.h))));
  const aspect = $derived(aspects.find((a) => a.id === aspectId)!);
  const selected = $derived(slides.find((s) => s.id === selectedId) ?? null);
  const musicUsed = $derived(Math.min(musicLen, totalSec));
  const inputBytes = $derived(slides.reduce((n, s) => n + s.file.size, 0) + (music?.size ?? 0));

  // ---------------------------------------------------------------- photos

  const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);

  async function decodeFull(file: File): Promise<ImageBitmap> {
    const src = await toDecodable(file);
    if (src instanceof ImageBitmap) return src;
    try {
      // older engines reject that option value; retry with their defaults before the slow wasm path
      return await createImageBitmap(src, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(src));
    } catch {
      // formats the browser can't read itself go through the wasm codecs
      return createImageBitmap(await decodeImage(file));
    }
  }

  async function shrink(src: ImageBitmap, w: number, h: number) {
    try {
      const out = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      if (out.width === w && out.height === h) return out;
      out.close();
    } catch {
      // some browsers ignore or reject the resize options
    }
    const c = newCanvas(w, h);
    const ctx = context(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    try {
      return await createImageBitmap(c);
    } finally {
      c.width = c.height = 0; // Safari counts canvas memory until GC, so free it now
    }
  }

  async function load(file: File): Promise<Slide> {
    const full = await decodeFull(file);
    const s = KEEP / Math.max(full.width, full.height);
    let bmp = full;
    if (s < 1) {
      bmp = await shrink(full, Math.round(full.width * s), Math.round(full.height * s));
      full.close();
    }
    return { id: nextId++, name: file.name, file, bmp, duration: null };
  }

  async function add(files: File[]) {
    files = files.filter(isImage);
    if (!files.length) return;
    const gen = generation;
    let failed = 0;
    notice = '';
    decoding += files.length;
    // one at a time: several 24 MP photos decoded at once can run a phone out of memory
    for (const file of files) {
      if (gen === generation) {
        try {
          const s = await load(file);
          if (gen === generation) slides.push(s);
          else s.bmp.close();
        } catch {
          failed++;
        }
      }
      decoding--;
    }
    if (gen === generation && failed) notice = `Couldn't read ${failed} ${failed === 1 ? 'file' : 'files'}. Try JPG, PNG, WebP or HEIC.`;
  }

  function remove(id: number) {
    const i = slides.findIndex((s) => s.id === id);
    if (i < 0) return;
    slides[i].bmp.close();
    slides.splice(i, 1);
    if (selectedId === id) selectedId = slides[Math.min(i, slides.length - 1)]?.id ?? null;
  }

  /** moves a slide so it lands before position `to` (0 … length) */
  function moveTo(id: number, to: number) {
    const from = slides.findIndex((s) => s.id === id);
    if (from < 0) return;
    to = Math.max(0, Math.min(slides.length, to));
    const target = to > from ? to - 1 : to;
    if (target === from) return;
    const [s] = slides.splice(from, 1);
    slides.splice(target, 0, s);
  }

  // ---- drag to reorder (mouse anywhere on a card; touch from its grip so the page still scrolls)
  let drag = $state<{ id: number; x: number; y: number; sx: number; sy: number; moved: boolean; over: number | null } | null>(null);
  let justDragged = false;

  function dragStart(e: PointerEvent, id: number) {
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.grip')) return;
    justDragged = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, over: null };
  }

  function dragMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.index !== undefined);
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.over = Number(el.dataset.index) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
  }

  function dragEnd() {
    if (!drag) return;
    if (drag.moved && drag.over !== null) moveTo(drag.id, drag.over);
    justDragged = drag.moved;
    drag = null;
  }

  function cardKey(e: KeyboardEvent, s: Slide, i: number) {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveTo(s.id, e.key === 'ArrowLeft' ? i - 1 : i + 2);
      // keep focus on the card that moved
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slide="${s.id}"]`)?.focus());
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(s.id);
    }
  }

  function selectCard(id: number) {
    if (justDragged) return void (justDragged = false);
    selectedId = id === TITLE_ID ? null : id;
    const i = items.findIndex((it) => it.id === id);
    if (i >= 0) seek(starts[i]);
  }

  const thumb = (bmp: ImageBitmap) => (c: HTMLCanvasElement) => {
    c.width = c.height = 120;
    const s = Math.max(120 / bmp.width, 120 / bmp.height);
    c.getContext('2d')!.drawImage(bmp, (120 - bmp.width * s) / 2, (120 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  };

  // ---------------------------------------------------------------- music

  let musicGen = 0; // bumped whenever the music changes, so a slow probe or conversion can't land late

  function clearMusic() {
    musicGen++;
    musicAbort?.abort();
    if (music) URL.revokeObjectURL(music.url);
    music = null;
    musicPending = null;
    musicError = '';
    musicBusy = '';
    fitToMusic = false;
  }

  function setMusic(blob: Blob, name: string, duration: number) {
    music = { blob, name, size: blob.size, duration, url: URL.createObjectURL(blob) };
    musicStart = 0;
    musicEnd = duration;
  }

  async function addMusic(file: File | undefined) {
    if (!file) return;
    clearMusic();
    const gen = musicGen;
    musicBusy = 'Reading music…';
    try {
      const info = await probe(file);
      if (gen !== musicGen) return;
      if (!info.audio && !info.needsFallback) throw new MediaError('no-tracks', "This file doesn't have any sound in it.");
      if (info.needsFallback || !info.audio?.canDecode) musicPending = file;
      else setMusic(file, file.name, info.durationSec);
    } catch (e) {
      if (gen === musicGen) musicError = e instanceof MediaError && e.code === 'no-tracks' ? e.message : "This music file couldn't be read. Try an MP3, M4A, WAV or OGG file.";
    } finally {
      if (gen === musicGen) musicBusy = '';
    }
  }

  /** odd formats: converted once to WAV with the ffmpeg fallback, after asking */
  async function convertMusic() {
    const file = musicPending;
    if (!file) return;
    const gen = musicGen;
    musicAbort = new AbortController();
    musicBusy = 'Converting…';
    try {
      const out = await transcode(file, { container: 'wav', video: false }, {
        signal: musicAbort.signal,
        onStatus: (s) => gen === musicGen && (musicBusy = s),
      });
      if (gen !== musicGen) return;
      musicPending = null;
      setMusic(out.blob, file.name, out.durationSec);
    } catch (e) {
      if (gen !== musicGen) return;
      if (!(e instanceof MediaError && e.code === 'aborted')) musicError = "This music file couldn't be converted. Try an MP3, M4A, WAV or OGG file.";
      musicPending = null;
    } finally {
      if (gen === musicGen) musicBusy = '';
    }
  }

  // ---------------------------------------------------------------- preview

  let time = $state(0);
  let playing = $state(false);
  let raf = 0;
  let clock = 0;

  // composites at preview size, rebuilt only when something they show changes
  const cache = new Map<string, AnyCanvas>();
  const CACHE_MAX = 12;

  function compositeOf(item: Item, base: string): Img {
    const key = item.slide ? `${base}|${item.id}` : `${base}|title|${titleText}|${titleSub}|${titleFont}|${titleOnPhoto ? slides[0]?.id : 'plain'}|${fontsReady}`;
    let c = cache.get(key);
    if (!c) {
      c = newCanvas(view.w, view.h);
      const ctx = context(c);
      if (item.slide) composeSlide(ctx, item.slide.bmp, view.w, view.h, fit, background);
      else composeTitle(ctx, view.w, view.h, { text: titleText, sub: titleSub, font: titleFont }, titleOnPhoto ? (slides[0]?.bmp ?? null) : null, background);
      cache.set(key, c);
      while (cache.size > CACHE_MAX) {
        const [oldest, old] = cache.entries().next().value!;
        old.width = old.height = 0;
        cache.delete(oldest);
      }
    }
    return c;
  }

  $effect(() => {
    const c = canvas;
    if (!c || !items.length) return;
    const base = `${view.w}x${view.h}|${fit}|${background}`;
    if (c.width !== view.w || c.height !== view.h) Object.assign(c, { width: view.w, height: view.h });
    const list = items;
    drawFrame(c.getContext('2d')!, view.w, view.h, frameState(time, durs, T), (i) => compositeOf(list[i], base), transition, kenBurns);
  });

  function syncMusic() {
    const a = previewAudio;
    if (!a || !music) return;
    if (!playing || time >= musicUsed) {
      if (!a.paused) a.pause();
      return;
    }
    const want = musicStart + time;
    if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
    a.volume = fadeGain(time, musicUsed, fadeIn, fadeOut);
    if (a.paused) a.play().catch(() => {});
  }

  function tick(now: number) {
    time = Math.min(totalSec, (now - clock) / 1000);
    syncMusic();
    if (time >= totalSec) return pause();
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (!items.length) return;
    if (time >= totalSec - 0.05) time = 0;
    trimAudio?.pause();
    playing = true;
    clock = performance.now() - time * 1000;
    syncMusic(); // start the music inside the click: Safari blocks play() from animation frames
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    previewAudio?.pause();
  }

  function seek(t: number) {
    time = Math.max(0, Math.min(totalSec, t));
    clock = performance.now() - time * 1000;
  }

  // a shorter slideshow pulls the playhead back with it
  $effect(() => {
    if (time > totalSec) seek(totalSec);
  });

  const current = $derived(frameState(time, durs, T).slot);

  // ---------------------------------------------------------------- export

  function formatProblem(f: Format, c: Capabilities | null, withMusic: boolean): string {
    if (!webCodecs) return 'it has no WebCodecs video encoder';
    if (!c) return '';
    if (!c.video.encode.some((v) => containers[f].video.includes(v))) return `no ${containers[f].label} video encoder in this browser`;
    if (withMusic && !c.audio.encode.some((a) => containers[f].audio.includes(a))) return `no ${containers[f].label} audio encoder in this browser`;
    return '';
  }
  const problems = $derived({ mp4: formatProblem('mp4', caps, !!music), webm: formatProblem('webm', caps, !!music) });

  // fall over to the format this browser can write
  $effect(() => {
    const other: Format = format === 'mp4' ? 'webm' : 'mp4';
    if (problems[format] && !problems[other]) format = other;
  });

  async function makeVideo() {
    pause();
    error = '';
    abort = new AbortController();
    const signal = abort.signal;
    const started = performance.now();
    job = { stage: 'Preparing photos…', progress: 0, started, now: started };
    const tickJob = setInterval(() => job && (job.now = performance.now()), 250);

    // snapshot the settings: editing is hidden while this runs, but nothing should leak in midway
    const { w: W, h: H } = size;
    const list = [...items];
    const durations = [...durs];
    const opts = { fit, background, transition, kenBurns, container: format };
    const card = { text: titleText, sub: titleSub, font: titleFont };
    const titleBackdrop = titleOnPhoto ? (slides[0]?.bmp ?? null) : null;
    const song = music && { blob: music.blob, start: musicStart, used: musicUsed, fadeIn, fadeOut };
    const PREP = song ? 0.18 : 0.15;
    const out = newCanvas(W, H);

    try {
      const ctx = context(out);
      const frames: Blob[] = [];
      for (const [i, item] of list.entries()) {
        throwIfAborted(signal);
        job.stage = item.slide ? `Preparing photo ${i + 1 - (titleOn ? 1 : 0)} of ${slides.length}…` : 'Drawing the title card…';
        if (item.slide) {
          // a photo that won't decode at full size again still has its preview copy
          const full = await decodeFull(item.slide.file).catch(() => null);
          composeSlide(ctx, full ?? item.slide.bmp, W, H, opts.fit, opts.background, item.slide.bmp);
          full?.close();
        } else {
          composeTitle(ctx, W, H, card, titleBackdrop, opts.background);
        }
        frames.push(await toJpeg(out));
        job.progress = (PREP * (i + 1)) / list.length;
      }

      let audio: Blob | undefined;
      if (song && song.used > 0) {
        job.stage = 'Preparing music…';
        const pcm = await decodeAudio(song.blob, { start: song.start, end: song.start + song.used }, { signal });
        fade(pcm.channels, pcm.sampleRate, { inSec: song.fadeIn, outSec: song.fadeOut });
        audio = new Blob([writeWav(pcm)], { type: 'audio/wav' });
      }

      job.stage = 'Rendering video…';
      job.progress = PREP;
      const r = await imagesToVideo(
        frames,
        {
          container: opts.container,
          width: W,
          height: H,
          fps: 30,
          durations,
          transition: opts.transition,
          transitionSec: TRANSITION_SEC,
          fit: 'cover',
          kenBurns: opts.kenBurns,
          audio,
          audioFadeSec: 0, // fades are already in the music
        },
        { signal, onProgress: (p) => job && (job.progress = PREP + (1 - PREP) * p) },
      );
      result = {
        blob: r.blob,
        url: URL.createObjectURL(r.blob),
        size: r.blob.size,
        durationSec: r.durationSec,
        width: r.width ?? W,
        height: r.height ?? H,
        container: opts.container,
        name: `${fileBase(titleOn ? titleText : '')}.${containers[opts.container].ext}`,
      };
    } catch (e) {
      if (!(e instanceof MediaError && e.code === 'aborted')) {
        console.error(e);
        error = e instanceof MediaError ? errorText(e.code, e.message) : errorText(undefined, e instanceof Error ? e.message : String(e));
      }
    } finally {
      clearInterval(tickJob);
      out.width = out.height = 0;
      abort = null;
      job = null;
    }
  }

  const download = () => result && downloadBlob(result.blob, result.name);

  function backToEditing() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function startOver() {
    generation++;
    pause();
    abort?.abort();
    backToEditing();
    clearMusic();
    for (const s of slides) s.bmp.close();
    slides = [];
    selectedId = null;
    titleOn = false;
    titleText = titleSub = '';
    notice = error = '';
    time = 0;
  }

  onMount(() => {
    webCodecs = hasWebCodecs();
    capabilities().then((c) => (caps = c), () => (webCodecs = false));
    // canvas text only uses fonts that are already loaded
    Promise.all([document.fonts.load('400 40px "Instrument Serif"'), document.fonts.load('600 40px "Geist Variable"')]).then(
      () => (fontsReady = true),
      () => {},
    );
    // the dropzone handles pasting until the editor takes over
    const onPaste = (e: ClipboardEvent) => {
      if (slides.length && !job && !result && e.clipboardData?.files.length) add(Array.from(e.clipboardData.files));
    };
    // once the dropzone is gone, a photo dropped anywhere is added instead of the browser opening it (and losing the work)
    const onDragOver = (e: DragEvent) => {
      if (slides.length) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!slides.length || e.defaultPrevented) return;
      e.preventDefault();
      if (!job && !result) add(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  });

  onDestroy(() => {
    generation++;
    cancelAnimationFrame(raf);
    abort?.abort();
    musicAbort?.abort();
    for (const s of slides) s.bmp.close();
    for (const c of cache.values()) c.width = c.height = 0;
    if (music) URL.revokeObjectURL(music.url);
    if (result) URL.revokeObjectURL(result.url);
  });

  const fits: [FitMode, string][] = [['blur', 'Fit + blur'], ['contain', 'Fit'], ['cover', 'Fill']];
  const transitions: [Transition, string][] = [['none', 'Cut'], ['fade', 'Fade'], ['slide', 'Slide']];
  const swatches = ['#000000', '#131211', '#ffffff', '#f2ede4'];
  const secs = (n: number) => `${Number(n.toFixed(1))} s`;
  const pct = $derived(job ? Math.round(job.progress * 100) : 0);
  const elapsed = $derived(job ? (job.now - job.started) / 1000 : 0);
  const eta = $derived(job && job.progress > 0.03 ? (elapsed * (1 - job.progress)) / job.progress : NaN);
</script>

<input
  bind:this={picker}
  type="file"
  accept={ACCEPT}
  multiple
  hidden
  onchange={(e) => {
    add(Array.from(e.currentTarget.files ?? []));
    e.currentTarget.value = '';
  }}
/>
<input
  bind:this={musicPicker}
  type="file"
  accept={MUSIC_ACCEPT}
  hidden
  onchange={(e) => {
    addMusic(e.currentTarget.files?.[0]);
    e.currentTarget.value = '';
  }}
/>

{#if result}
  <section class="card done" aria-live="polite">
    <div class="flex flex-wrap items-center gap-3">
      <span class="tick" aria-hidden="true">✓</span>
      <h2 class="text-3xl">Your slideshow is ready</h2>
    </div>
    <!-- svelte-ignore a11y_media_has_caption -- photos and music only, there is no speech to caption -->
    <video class="player" src={result.url} controls playsinline style:aspect-ratio="{result.width} / {result.height}"></video>
    <p class="mono">
      {result.width} × {result.height} · {formatTime(result.durationSec, 0)} · {containers[result.container].label} ·
      <span class="text-chalk">{formatBytes(result.size)}</span> from {formatBytes(inputBytes)} of photos{music ? ' and music' : ''}
    </p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn btn-primary" onclick={download}>Download {containers[result.container].label}</button>
      <button type="button" class="btn" onclick={backToEditing}>Back to editing</button>
      <button type="button" class="btn" onclick={startOver}>Start over</button>
    </div>
  </section>
{:else if job}
  <section class="card working" aria-busy="true">
    <h2 class="text-3xl">Making your slideshow</h2>
    <p class="mono" aria-live="polite">{job.stage}</p>
    <div class="bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
      <span style:width="{job.progress * 100}%"></span>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="mono"><b class="text-chalk">{pct}%</b> · {formatEta(elapsed)} elapsed · {Number.isNaN(eta) ? 'estimating…' : `about ${formatEta(eta)} left`}</span>
      <button type="button" class="btn" onclick={() => abort?.abort()}>Cancel</button>
    </div>
    <p class="mono">Everything happens on this device, so keep this tab open until it's done.</p>
  </section>
{:else if !slides.length}
  {#if decoding}
    <div class="loading mono" aria-busy="true">reading {decoding} {decoding === 1 ? 'photo' : 'photos'}…</div>
  {:else}
    <Dropzone accept={ACCEPT} multiple title="Drop your photos" hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={(f) => add(f)} />
  {/if}
  {#if notice}<p class="text-bad mt-3 text-sm" role="alert">{notice}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-5">
      <div class="grid gap-3">
        <div class="stage" style:--ar={view.w / view.h} role="img" aria-label="Slideshow preview">
          <canvas bind:this={canvas} aria-hidden="true"></canvas>
        </div>
        <div class="transport">
          <button type="button" class="play" onclick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause preview' : 'Play preview'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min="0"
            max={totalSec}
            step="0.01"
            value={time}
            oninput={(e) => seek(Number(e.currentTarget.value))}
            aria-label="Preview position"
            class="min-w-0 flex-1 accent-(--color-sun)"
          />
          <span class="mono whitespace-nowrap">{formatTime(time, 1)} / {formatTime(totalSec, 1)}</span>
        </div>
        {#if music}<audio bind:this={previewAudio} src={music.url} preload="auto"></audio>{/if}
      </div>

      <div>
        <span class="label">slides · {slides.length} {slides.length === 1 ? 'photo' : 'photos'} · {secs(totalSec)}</span>
        <ul
          class="strip"
          aria-label="Slides in order"
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => {
            e.preventDefault();
            add(Array.from(e.dataTransfer?.files ?? []));
          }}
        >
          {#if titleOn}
            <li>
              <button type="button" class="card-slide title-tile" class:now={current === 0} onclick={() => selectCard(TITLE_ID)} aria-label="Title card, {secs(titleSec)}">
                <span class="aa">Aa</span>
                <span class="dur">{secs(titleSec)}</span>
              </button>
            </li>
          {/if}
          {#each slides as s, i (s.id)}
            {@const at = i + (titleOn ? 1 : 0)}
            <li
              class="slot"
              class:ins-before={drag?.moved && drag.over === i}
              class:ins-after={drag?.moved && i === slides.length - 1 && drag.over === slides.length}
            >
              <button
                type="button"
                class="card-slide"
                class:sel={selectedId === s.id}
                class:now={current === at}
                class:lifted={drag?.moved && drag.id === s.id}
                data-index={i}
                data-slide={s.id}
                aria-pressed={selectedId === s.id}
                aria-label="Photo {i + 1}: {s.name}, {secs(photoDurs[i])}. Alt + arrow keys to move, Delete to remove."
                onpointerdown={(e) => dragStart(e, s.id)}
                onpointermove={dragMove}
                onpointerup={dragEnd}
                onpointercancel={() => (drag = null)}
                onclick={() => selectCard(s.id)}
                onkeydown={(e) => cardKey(e, s, i)}
              >
                <canvas {@attach thumb(s.bmp)}></canvas>
                <span class="num">{i + 1}</span>
                <span class="dur" class:own={s.duration !== null}>{secs(photoDurs[i])}</span>
                <span class="grip" aria-hidden="true">⠿</span>
              </button>
              <button type="button" class="x" onclick={() => remove(s.id)} aria-label="Remove {s.name}">✕</button>
            </li>
          {/each}
          <li><button type="button" class="card-slide more" onclick={() => picker.click()} aria-label="Add photos">+</button></li>
        </ul>
        <p class="mono mt-2">drag to reorder · click a photo to set its own duration</p>
        {#if decoding}<p class="mono working-note">reading {decoding} {decoding === 1 ? 'photo' : 'photos'}…</p>{/if}
        {#if notice}<p class="text-bad text-sm" role="alert">{notice}</p>{/if}
      </div>

      {#if selected}
        {@const i = slides.findIndex((s) => s.id === selected.id)}
        <div class="panel">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span class="mono truncate">photo {i + 1} · {selected.name}</span>
            <div class="flex gap-2">
              <button type="button" class="btn sm" disabled={i === 0} onclick={() => moveTo(selected.id, i - 1)} aria-label="Move earlier">←</button>
              <button type="button" class="btn sm" disabled={i === slides.length - 1} onclick={() => moveTo(selected.id, i + 2)} aria-label="Move later">→</button>
              <button type="button" class="btn sm" onclick={() => remove(selected.id)}>Remove</button>
            </div>
          </div>
          <div class="flex flex-wrap items-end gap-3">
            <label class="w-28">
              <span class="label">duration (s)</span>
              <input
                class="field"
                type="number"
                min={MIN_SLIDE_SEC}
                max={MAX_SLIDE_SEC}
                step="0.5"
                value={selected.duration ?? photoDurs[i].toFixed(1)}
                onchange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v > 0) selected.duration = Math.min(MAX_SLIDE_SEC, Math.max(MIN_SLIDE_SEC, v));
                }}
              />
            </label>
            {#if selected.duration !== null}
              <button type="button" class="btn sm" onclick={() => (selected.duration = null)}>Use the global duration</button>
            {:else}
              <span class="mono pb-3">following the global duration</span>
            {/if}
          </div>
        </div>
      {/if}

      <section class="panel" aria-label="Background music" ondragover={(e) => e.preventDefault()} ondrop={(e) => {
        e.preventDefault();
        addMusic(e.dataTransfer?.files[0]);
      }}>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-2xl">Music</h3>
          {#if music}<button type="button" class="btn sm" onclick={clearMusic}>Remove music</button>{/if}
        </div>
        {#if music}
          <p class="mono truncate">{music.name} · {formatTime(music.duration, 0)}</p>
          <audio bind:this={trimAudio} src={music.url} preload="auto" onplay={pause}></audio>
          <TrimTimeline file={music.blob} duration={music.duration} media={trimAudio} kind="audio" bind:start={musicStart} bind:end={musicEnd} />
          <div class="grid gap-3 sm:grid-cols-2">
            <label>
              <span class="label">fade in · {secs(fadeIn)}</span>
              <input type="range" min="0" max="5" step="0.5" bind:value={fadeIn} class="w-full accent-(--color-sun)" />
            </label>
            <label>
              <span class="label">fade out · {secs(fadeOut)}</span>
              <input type="range" min="0" max="8" step="0.5" bind:value={fadeOut} class="w-full accent-(--color-sun)" />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" bind:checked={fitToMusic} />
            <span>Fit the slides to the music ({formatTime(musicLen, 1)})</span>
          </label>
          {#if fitted && !fitted.overridesKept}
            <p class="mono">Photos with their own duration didn't leave enough time, so every photo shares the music evenly.</p>
          {:else if !fitToMusic && musicLen < totalSec - 0.05}
            <p class="mono">The music ends {secs(totalSec - musicLen)} before the photos do, so the end will be silent. Tick "fit the slides" to match them.</p>
          {:else if !fitToMusic && musicLen > totalSec + 0.05}
            <p class="mono">The music is cut at {formatTime(totalSec, 1)} and faded out to match the photos.</p>
          {/if}
        {:else if musicPending}
          <p class="text-sm">
            {musicPending.name} needs a one-time {FALLBACK_DOWNLOAD_MB} MB decoder to play in this browser. It downloads once, runs on this device, and nothing
            is uploaded.
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary sm" disabled={!!musicBusy} onclick={convertMusic}>{musicBusy || `Download decoder (${FALLBACK_DOWNLOAD_MB} MB)`}</button>
            <button type="button" class="btn sm" onclick={clearMusic}>Cancel</button>
          </div>
        {:else}
          <p class="text-soft text-sm">Optional. Add a song and trim it, fade it, or stretch the photos to match its length.</p>
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn sm" disabled={!!musicBusy} onclick={() => musicPicker.click()}>{musicBusy || '+ Add music'}</button>
            <span class="mono">MP3, M4A, WAV, OGG…</span>
          </div>
        {/if}
        {#if musicError}<p class="text-bad text-sm" role="alert">{musicError}</p>{/if}
      </section>
    </div>

    <aside class="grid content-start gap-5">
      <div>
        <span class="label">shape · {aspect.label}</span>
        <div class="seg" role="group" aria-label="Video shape">
          {#each aspects as a (a.id)}
            <button type="button" aria-pressed={aspectId === a.id} onclick={() => (aspectId = a.id)}>{a.id}</button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">quality · {size.w} × {size.h}</span>
        <div class="seg" role="group" aria-label="Resolution">
          {#each resolutions as r (r)}
            <button type="button" aria-pressed={short === r} onclick={() => (short = r)}>{r}p</button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">photo fit</span>
        <div class="seg" role="group" aria-label="Photo fit">
          {#each fits as [value, label] (value)}
            <button type="button" aria-pressed={fit === value} onclick={() => (fit = value)}>{label}</button>
          {/each}
        </div>
        <p class="mono mt-2">
          {fit === 'blur' ? 'whole photo over a blurred copy of itself' : fit === 'contain' ? 'whole photo, with bars' : 'fills the frame, edges may be cropped'}
        </p>
        {#if fit === 'contain' || (titleOn && !titleOnPhoto)}
          <div class="mt-2 flex items-center gap-2" role="group" aria-label="Background color">
            {#each swatches as c (c)}
              <button type="button" class="sw" style:background={c} aria-pressed={background === c} aria-label="Background {c}" onclick={() => (background = c)}></button>
            {/each}
            <label class="sw pickr" aria-label="Custom background color">
              <input type="color" value={background} oninput={(e) => (background = e.currentTarget.value)} />
            </label>
          </div>
        {/if}
      </div>

      <label>
        <span class="label">each photo · {fitted ? 'fitted to the music' : secs(globalSec)}</span>
        <input type="range" min="1" max="10" step="0.5" bind:value={globalSec} disabled={!!fitted} class="w-full accent-(--color-sun)" />
      </label>

      <div>
        <span class="label">transition</span>
        <div class="seg" role="group" aria-label="Transition">
          {#each transitions as [value, label] (value)}
            <button type="button" aria-pressed={transition === value} onclick={() => (transition = value)}>{label}</button>
          {/each}
        </div>
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={kenBurns} />
        <span>Ken Burns slow zoom</span>
      </label>

      <div class="grid gap-3 border-t border-line pt-5">
        <label class="check">
          <input type="checkbox" bind:checked={titleOn} />
          <span>Title card at the start</span>
        </label>
        {#if titleOn}
          <input class="field" bind:value={titleText} placeholder="Summer in Lisbon" aria-label="Title" maxlength="120" />
          <input class="field" bind:value={titleSub} placeholder="Subtitle (optional)" aria-label="Subtitle" maxlength="120" />
          <div class="flex flex-wrap gap-2">
            <div class="seg" role="group" aria-label="Title font">
              <button type="button" aria-pressed={titleFont === 'serif'} onclick={() => (titleFont = 'serif')}>Serif</button>
              <button type="button" aria-pressed={titleFont === 'sans'} onclick={() => (titleFont = 'sans')}>Sans</button>
            </div>
            <div class="seg" role="group" aria-label="Title background">
              <button type="button" aria-pressed={titleOnPhoto} onclick={() => (titleOnPhoto = true)}>Photo</button>
              <button type="button" aria-pressed={!titleOnPhoto} onclick={() => (titleOnPhoto = false)}>Color</button>
            </div>
          </div>
          <label>
            <span class="label">title shows for · {secs(titleSec)}</span>
            <input type="range" min="1" max="8" step="0.5" bind:value={titleSec} class="w-full accent-(--color-sun)" />
          </label>
        {/if}
      </div>

      <div class="grid gap-2 border-t border-line pt-5">
        <div class="seg" role="group" aria-label="Video format">
          {#each ['mp4', 'webm'] as const as f (f)}
            <button type="button" aria-pressed={format === f} disabled={!!problems[f]} title={problems[f] || undefined} onclick={() => (format = f)}>
              {containers[f].label}
            </button>
          {/each}
        </div>
        {#if problems.mp4 && problems.webm}
          <p class="text-bad text-sm" role="alert">This browser can't make videos ({problems.mp4}). Try a recent Chrome, Edge, Safari or Firefox.</p>
        {:else if problems.mp4 || problems.webm}
          <p class="mono">{problems.mp4 ? `MP4: ${problems.mp4}` : `WebM: ${problems.webm}`}</p>
        {/if}
        <p class="mono">{formatTime(totalSec, 1)} · {size.w} × {size.h} · 30 fps{music ? ' · with music' : ''}</p>
        <button type="button" class="btn btn-primary" disabled={decoding > 0 || !!musicBusy || !!problems[format]} onclick={makeVideo}>Make video</button>
        {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

{#if drag?.moved}
  {@const s = slides.find((x) => x.id === drag?.id)}
  {#if s}<canvas class="ghost" style:translate="{drag.x}px {drag.y}px" {@attach thumb(s.bmp)} aria-hidden="true"></canvas>{/if}
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    min-height: 240px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .stage {
    aspect-ratio: var(--ar);
    width: min(100%, calc(min(62vh, 560px) * var(--ar)));
    margin-inline: auto;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    background: #000;
    & canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .play {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 99px;
    border: 0;
    background: var(--color-sun);
    color: var(--color-bg);
    font-size: 13px;
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:active {
      transform: scale(0.92);
    }
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .slot {
    position: relative;
    &.ins-before::before,
    &.ins-after::after {
      content: '';
      position: absolute;
      top: 4px;
      bottom: 4px;
      width: 3px;
      border-radius: 3px;
      background: var(--color-sun);
    }
    &.ins-before::before {
      left: -7px;
    }
    &.ins-after::after {
      right: -7px;
    }
  }
  .card-slide {
    position: relative;
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    padding: 0;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    overflow: hidden;
    background: var(--color-panel-2);
    color: var(--color-muted);
    cursor: grab;
    user-select: none;
    transition: opacity 0.15s, border-color 0.15s;
    & canvas {
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    &.now {
      border-color: var(--color-soft);
    }
    &.sel {
      border-color: var(--color-sun);
      box-shadow: 0 0 0 1px var(--color-sun);
    }
    &.lifted {
      opacity: 0.35;
    }
    &.more {
      font-size: 24px;
      cursor: pointer;
      border-style: dashed;
      &:hover {
        color: var(--color-chalk);
        border-color: var(--color-sun);
      }
    }
  }
  .title-tile {
    cursor: pointer;
    background: linear-gradient(160deg, #2a2926, #161514);
  }
  .aa {
    font: 400 30px/1 var(--font-serif);
    color: var(--color-chalk);
  }
  .num,
  .dur,
  .grip {
    position: absolute;
    padding: 0 4px;
    border-radius: 5px;
    background: #131211cc;
    font: 400 10.5px/16px var(--font-mono);
    color: var(--color-chalk);
  }
  .num {
    left: 4px;
    top: 4px;
  }
  .dur {
    right: 4px;
    bottom: 4px;
    &.own {
      background: var(--color-sun);
      color: var(--color-bg);
    }
  }
  .grip {
    left: 4px;
    bottom: 4px;
    display: none;
    font-size: 13px;
    touch-action: none;
  }
  @media (hover: none) {
    .grip {
      display: block;
      padding: 2px 6px;
    }
  }
  .x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-soft);
    font-size: 10px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    &:hover {
      color: var(--color-bad);
    }
  }
  .slot:hover .x,
  .slot:focus-within .x {
    opacity: 1;
  }
  @media (hover: none) {
    .x {
      opacity: 1;
    }
  }
  .panel {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 15px;
    & input {
      width: 18px;
      height: 18px;
      accent-color: var(--color-sun);
    }
  }
  .btn.sm {
    padding: 8px 12px;
    font-size: 14px;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .sw {
    width: 28px;
    height: 28px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    &[aria-pressed='true'] {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .pickr {
    position: relative;
    overflow: hidden;
    background: conic-gradient(#ff7a6b, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff7a6b);
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
  }
  .ghost {
    position: fixed;
    left: -32px;
    top: -32px;
    width: 64px;
    height: 64px;
    border-radius: 12px;
    border: 2px solid var(--color-sun);
    box-shadow: 0 10px 30px #0008;
    pointer-events: none;
    z-index: 50;
  }
  .working-note {
    color: var(--color-sun);
  }
  .working,
  .done {
    display: grid;
    gap: 16px;
    padding: clamp(18px, 4vw, 32px);
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
      border-radius: inherit;
      background: linear-gradient(90deg, #ffb84a, var(--color-sun));
      transition: width 0.3s linear;
    }
  }
  .tick {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 99px;
    background: var(--color-ok);
    color: var(--color-bg);
    font-weight: 700;
    animation: pop 0.5s var(--ease-spring) both;
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
  .player {
    display: block;
    width: 100%;
    max-height: 70vh;
    margin-inline: auto;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: #000;
  }
</style>
