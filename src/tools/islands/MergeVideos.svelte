<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import DeviceNote from '@/components/tool/DeviceNote.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import {
    bitmapToBlob,
    capabilities,
    concat,
    downloadName,
    ensureDecodable,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    frameAt,
    isAbort,
    MediaError,
    preloadFallback,
    probe,
    transcode,
    videoCodecLabel,
    type Container,
    type MediaInfo,
    type QualityLevel,
    type TranscodeResult,
    type VideoCodec,
  } from '@/engines/media';
  import { checkDevice, deviceMessage } from '@/tools/lib/device-guard';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import {
    clipLength,
    clock,
    etaSeconds,
    friendlyError,
    isTrimmed,
    moveItem,
    musicFit,
    overallProgress,
    percentToDb,
    planStages,
    prepSize,
    resolveSize,
    sameAspect,
    SIZE_PRESETS,
    totalLength,
    type AudioMode,
    type ClipPlan,
    type FitMode,
    type SizeMode,
  } from '@/tools/lib/merge-videos/plan';

  interface Item {
    key: string;
    file: File;
    /** what the engine reads: the file itself, or the fallback decoder's playable copy */
    src: Blob;
    status: 'probing' | 'needs-decoder' | 'converting' | 'ready' | 'error';
    info?: MediaInfo;
    error?: string;
    /** fallback conversion, 0–1 */
    progress?: number;
    url?: string;
    thumb?: string;
    start: number;
    end: number;
    color: string;
  }

  const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.vob,.ogv';
  const MUSIC_ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.mp4,.mov,.webm,.mkv';
  const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|ts|mts|m2ts|mpe?g|vob|ogv)$/i;
  const FORMATS: Container[] = ['mp4', 'webm', 'mov', 'mkv'];
  const COLORS = ['--color-video', '--color-sun', '--color-image', '--color-ai', '--color-text', '--color-pdf', '--color-dev'];
  const QUALITIES: { id: QualityLevel; label: string }[] = [
    { id: 'medium', label: 'Smaller file' },
    { id: 'high', label: 'Balanced' },
    { id: 'very-high', label: 'Best' },
  ];

  let clips = $state<Item[]>([]);
  let music = $state<Item | null>(null);
  let errors = $state<string[]>([]);
  let openKey = $state<string | null>(null);
  let player = $state<HTMLVideoElement | null>(null);

  let sizeMode = $state<SizeMode>('first');
  let fit = $state<FitMode>('letterbox');
  let barColor = $state('#000000');
  let audioMode = $state<AudioMode>('keep');
  let volume = $state(100);
  let quality = $state<QualityLevel>('high');
  let format = $state<Container>('mp4');
  let canWrite = $state<Partial<Record<Container, boolean>> | null>(null);

  let decoder = $state<'idle' | 'loading' | 'ready'>('idle');
  let decoderProgress = $state(0);

  let job = $state<{ progress: number; status: string; startedAt: number } | null>(null);
  let now = $state(0);
  let mergeError = $state('');
  let result = $state<{ blob: Blob; url: string; name: string; container: Container; width?: number; height?: number; duration: number; inputBytes: number; lengths: { len: number; color: string }[]; notes: string[] } | null>(null);
  let message = $state('');
  let reduceMotion = $state(false);
  let over = $state(false);
  let picker = $state<HTMLInputElement>();
  let musicPicker = $state<HTMLInputElement>();
  let listEl = $state<HTMLOListElement>();
  let cancelBtn = $state<HTMLButtonElement>();
  let goBtn = $state<HTMLButtonElement>();
  let doneHead = $state<HTMLElement>();
  let ctrl: AbortController | undefined;
  const decoderCtrl = new AbortController();
  let nextKey = 0;
  const uid = $props.id();

  const ready = $derived(clips.filter((c) => c.status === 'ready'));
  const waitingForDecoder = $derived([...clips, ...(music ? [music] : [])].filter((c) => c.status === 'needs-decoder'));
  const busy = $derived(clips.some((c) => c.status === 'probing' || c.status === 'converting') || music?.status === 'probing' || music?.status === 'converting');
  const plans = $derived(ready.map(planOf));
  const target = $derived(resolveSize(sizeMode, plans));
  const total = $derived(totalLength(plans));
  const mismatched = $derived(!!target && plans.some((p) => !sameAspect(p, target)));
  const musicReady = $derived(music?.status === 'ready' ? music : null);
  const canMerge = $derived(
    ready.length > 0 && ready.length === clips.length && !!target && !job && !!canWrite?.[format] && (audioMode !== 'music' || !!musicReady),
  );
  // low-end devices: warn about, or stop, a merge this device can't hold
  const deviceFit = $derived(
    ready.length && target
      ? checkDevice('merge', { bytes: ready.reduce((s, c) => s + c.file.size, 0), seconds: total, width: target.width, height: target.height, count: ready.length })
      : null,
  );
  const elapsed = $derived(job ? (now - job.startedAt) / 1000 : 0);
  const eta = $derived(job ? etaSeconds(elapsed, job.progress) : null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const codecName = (codec: string | null | undefined) => (codec ? (videoCodecLabel[codec as VideoCodec] ?? codec.toUpperCase()) : 'video');

  function planOf(c: Item): ClipPlan {
    const v = c.info!.video!;
    return { width: v.displayWidth, height: v.displayHeight, duration: c.info!.durationSec, start: c.start, end: c.end };
  }

  onMount(() => {
    // animate:flip runs through the Web Animations API, which the global reduced-motion CSS doesn't reach
    reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => {
      endDrag();
      ctrl?.abort();
      decoderCtrl.abort();
      for (const c of clips) revoke(c);
      if (music) revoke(music);
      if (result) URL.revokeObjectURL(result.url);
    };
  });

  // elapsed/ETA readout ticks while a job runs
  $effect(() => {
    if (!job) return;
    now = performance.now();
    const t = setInterval(() => (now = performance.now()), 500);
    return () => clearInterval(t);
  });

  // only offer formats this browser can write
  async function loadCapabilities() {
    if (canWrite) return;
    try {
      const caps = await capabilities();
      canWrite = Object.fromEntries(FORMATS.map((f) => [f, caps.containers[f]]));
      if (!canWrite[format]) format = FORMATS.find((f) => canWrite![f]) ?? format;
    } catch {
      canWrite = {};
      errors.push("This browser can't encode video here. Try a recent Chrome, Edge, Safari or Firefox.");
    }
  }

  /* ---------- adding files ---------- */

  function newItem(file: File): Item {
    return { key: `c${++nextKey}`, file, src: file, status: 'probing', start: 0, end: 0, color: `var(${COLORS[nextKey % COLORS.length]})` };
  }

  async function addFiles(files: File[]) {
    void loadCapabilities();
    clearResult();
    const added: Item[] = [];
    for (const file of files) {
      if (!file.type.startsWith('video/') && !VIDEO_EXT.test(file.name)) {
        errors.push(`${file.name} isn't a video file.`);
        continue;
      }
      clips.push(newItem(file));
      added.push(clips[clips.length - 1]); // the reactive proxy, not the plain object
    }
    if (added.length) message = `${plural(added.length, 'clip')} added.`;
    for (const c of added) await open(c);
  }

  async function setMusic(file: File | undefined) {
    if (!file) return;
    if (music) revoke(music);
    music = newItem(file);
    audioMode = 'music';
    await open(music);
  }

  const alive = (c: Item) => clips.includes(c) || music === c;

  async function open(c: Item) {
    try {
      const info = await probe(c.file);
      if (!alive(c)) return;
      if (info.readable) checkTracks(c, info);
      if (info.needsFallback) {
        c.status = 'needs-decoder';
        if (decoder === 'ready') await convert(c);
        return;
      }
      await use(c, c.file, info);
    } catch (e) {
      fail(c, e);
    }
  }

  // files the browser can't read are only checked after the decoder converts them
  function checkTracks(c: Item, info: MediaInfo) {
    if (c !== music && !info.video) throw new MediaError('no-tracks', `${c.file.name} has no picture. To use its sound, add it as background music instead.`);
    if (c === music && !info.audio) throw new MediaError('no-tracks', `${c.file.name} has no sound to use as music.`);
  }

  function fail(c: Item, e: unknown) {
    if (!alive(c) || isAbort(e)) return;
    c.status = 'error';
    c.error = deviceMessage('ffmpeg', e) ?? (e instanceof MediaError ? e.message : "This file couldn't be read.");
  }

  async function use(c: Item, src: Blob, info: MediaInfo) {
    checkTracks(c, info);
    c.src = src;
    c.info = info;
    c.start = 0;
    c.end = info.durationSec;
    c.url = URL.createObjectURL(src);
    c.status = 'ready';
    if (c === music) return;
    try {
      const still = await frameAt(src, Math.min(1, info.durationSec / 4), { height: 96 });
      const jpg = await bitmapToBlob(still, 'image/jpeg', 0.8);
      still.close();
      if (alive(c)) c.thumb = URL.createObjectURL(jpg);
    } catch {
      // a missing thumbnail isn't worth an error; the row shows a film icon instead
    }
  }

  async function convert(c: Item) {
    c.status = 'converting';
    c.progress = 0;
    try {
      const r = await ensureDecodable(c.file, { signal: decoderCtrl.signal, onProgress: (p) => (c.progress = p) });
      if (alive(c)) await use(c, r.file, r.info);
    } catch (e) {
      fail(c, e);
    }
  }

  async function getDecoder() {
    decoder = 'loading';
    decoderProgress = 0;
    try {
      await preloadFallback((p) => (decoderProgress = p));
      decoder = 'ready';
      for (const c of waitingForDecoder) await convert(c);
    } catch (e) {
      decoder = 'idle';
      if (!isAbort(e)) errors.push("The decoder couldn't be downloaded. Check your connection and try again.");
    }
  }

  function revoke(c: Item) {
    if (c.url) URL.revokeObjectURL(c.url);
    if (c.thumb) URL.revokeObjectURL(c.thumb);
  }

  function removeClip(c: Item) {
    revoke(c);
    if (openKey === c.key) openKey = null;
    clips = clips.filter((x) => x !== c);
    message = `${c.file.name} removed.`;
  }

  function removeMusic() {
    if (music) revoke(music);
    music = null;
    if (audioMode === 'music') audioMode = 'keep';
  }

  function startOver() {
    ctrl?.abort();
    for (const c of clips) revoke(c);
    clips = [];
    removeMusic();
    clearResult();
    errors = [];
    mergeError = '';
    openKey = null;
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  /* ---------- order: drag the handle, arrow keys on it, or the nudge buttons ---------- */

  function moveClip(from: number, to: number, announce = true) {
    if (to < 0 || to >= clips.length || to === from) return;
    clips = moveItem(clips, from, to);
    if (announce) message = `${clips[to].file.name} moved to position ${to + 1} of ${clips.length}.`;
  }

  async function focusHandle(key: string) {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-key="${key}"] .handle`)?.focus();
  }

  function onHandleKey(e: KeyboardEvent, i: number) {
    const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: clips.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const key = clips[i].key;
    moveClip(i, Math.max(0, Math.min(clips.length - 1, to)));
    void focusHandle(key);
  }

  let dragKey = $state<string | null>(null);
  let dragFrom = -1;
  let dragPointer = -1;
  let dragY = 0;
  let scrollFrame = 0;

  function startDrag(e: PointerEvent, c: Item) {
    if (e.button !== 0 || dragKey || job) return;
    e.preventDefault();
    openKey = null; // rows of equal height make the drop slot predictable
    dragKey = c.key;
    dragPointer = e.pointerId;
    dragFrom = clips.indexOf(c);
    dragY = e.clientY;
    // on window, not the handle: the row moves in the DOM as it is dragged, which can drop pointer capture
    addEventListener('pointermove', onDragMove);
    addEventListener('pointerup', endDrag);
    addEventListener('pointercancel', endDrag);
    autoScroll();
  }

  function onDragMove(e: PointerEvent) {
    if (!dragKey || e.pointerId !== dragPointer) return;
    dragY = e.clientY;
    hitRow();
  }

  // the target slot is how many other rows have their middle above the pointer (layout positions, so flip transforms don't matter)
  function hitRow() {
    if (!dragKey || !listEl) return;
    const y = dragY - listEl.getBoundingClientRect().top;
    const from = clips.findIndex((c) => c.key === dragKey);
    let to = 0;
    for (const [i, row] of [...listEl.children].entries()) {
      const r = row as HTMLElement;
      if (i !== from && r.offsetTop + r.offsetHeight / 2 < y) to++;
    }
    moveClip(from, to, false);
  }

  function autoScroll() {
    cancelAnimationFrame(scrollFrame);
    if (!dragKey) return;
    const edge = 70;
    const v = dragY < edge ? -(edge - dragY) / 4 : dragY > innerHeight - edge ? (dragY - innerHeight + edge) / 4 : 0;
    if (v) {
      scrollBy(0, v);
      hitRow();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function endDrag(e?: PointerEvent) {
    if (!dragKey || (e && e.pointerId !== dragPointer)) return;
    cancelAnimationFrame(scrollFrame);
    removeEventListener('pointermove', onDragMove);
    removeEventListener('pointerup', endDrag);
    removeEventListener('pointercancel', endDrag);
    const to = clips.findIndex((c) => c.key === dragKey);
    if (to !== dragFrom && to >= 0) message = `${clips[to].file.name} moved to position ${to + 1} of ${clips.length}.`;
    dragKey = null;
  }

  /* ---------- merging ---------- */

  async function merge() {
    if (!canMerge || !target) return;
    const list = [...ready];
    const shapes = [...plans];
    const length = total;
    const steps = planStages(shapes, target, fit, audioMode);
    const container = format;
    const inputs = list.map((c) => c.src);
    const song = musicReady?.src;
    openKey = null;
    mergeError = '';
    clearResult();
    ctrl = new AbortController();
    const signal = ctrl.signal;
    job = { progress: 0, status: 'Starting…', startedAt: performance.now() };
    // the Merge button is replaced by Cancel; keep keyboard focus on the page's working part
    void tick().then(() => cancelBtn?.focus());
    let out: TranscodeResult | undefined;
    try {
      for (const [i, step] of steps.entries()) {
        const onProgress = (p: number) => job && (job.progress = overallProgress(steps, i, p));
        const onStatus = (s: string) => job && (job.status = s);
        if (step.kind === 'prepare') {
          const n = step.clip!;
          const p = shapes[n];
          const fill = fit === 'fill' && !sameAspect(p, target);
          job.status = `Preparing clip ${n + 1} of ${list.length} (${[isTrimmed(p) && 'trim', fill && 'crop to fill'].filter(Boolean).join(', ')})…`;
          const prepared = await transcode(
            inputs[n],
            {
              container,
              trim: isTrimmed(p) ? { start: p.start, end: p.end } : undefined,
              // top quality: this copy is encoded once more when the clips are joined
              video: { quality: 'very-high', ...prepSize(p, target, fit) },
              audio: audioMode === 'keep' ? undefined : false,
            },
            { signal, onProgress },
          );
          inputs[n] = prepared.blob;
        } else if (step.kind === 'join') {
          job.status = list.length > 1 ? `Joining ${plural(list.length, 'clip')}…` : 'Encoding…';
          out = await concat(inputs, { container, width: target.width, height: target.height, quality, background: barColor }, { signal, onProgress, onStatus });
        } else if (step.kind === 'mute') {
          job.status = 'Removing the sound…';
          out = await transcode(out!.blob, { container, audio: false }, { signal, onProgress });
        } else {
          job.status = 'Adding the music…';
          out = await transcode(out!.blob, { container, audio: { replace: song!, gainDb: percentToDb(volume) } }, { signal, onProgress });
        }
      }
      const blob = out!.blob;
      result = {
        blob,
        url: URL.createObjectURL(blob),
        name: downloadName(list[0].file.name, container, '-merged'),
        width: out!.width,
        height: out!.height,
        container,
        duration: length,
        inputBytes: list.reduce((s, c) => s + c.file.size, 0),
        lengths: list.map((c, k) => ({ len: clipLength(shapes[k]), color: c.color })),
        notes: out!.notes,
      };
      message = 'Your merged video is ready.';
    } catch (e) {
      const err = e instanceof MediaError ? e : null;
      if (!isAbort(e)) mergeError = deviceMessage('merge', e) ?? friendlyError(err?.code, err?.message ?? String((e as Error)?.message ?? e));
      else message = 'Merge cancelled.';
    } finally {
      job = null;
      ctrl = undefined;
    }
    await tick();
    (result ? doneHead : goBtn)?.focus();
  }
</script>

{#snippet sequence(items: { len: number; color: string }[], joined: boolean)}
  <div class="seq" class:joined aria-hidden="true">
    {#each items as s, i (i)}
      <span style:flex-grow={Math.max(s.len, 0.001)} style:--c={s.color}><b>{i + 1}</b></span>
    {/each}
  </div>
{/snippet}

<div
  class="merge"
  class:over
  role="region"
  aria-label="Merge videos"
  ondragover={(e) => {
    if (!clips.length || job || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    over = true;
  }}
  ondragleave={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) over = false;
  }}
  ondrop={(e) => {
    over = false;
    // the empty-state Dropzone handles its own drop
    if (e.defaultPrevented || !clips.length || job) return;
    e.preventDefault();
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  }}
>
  {#if !clips.length}
    <Dropzone accept={VIDEO_ACCEPT} multiple title="Drop your video clips here" hint="MP4, MOV, WebM, MKV, AVI… · add as many as you like" onfiles={(f) => void addFiles(f)} />
  {:else if result}
    <div class="result" role="status">
      <div class="result-head">
        <span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
        <div class="min-w-0 flex-1">
          <p bind:this={doneHead} tabindex="-1" class="font-serif text-[28px] leading-tight outline-none">Joined into one video</p>
          <p class="mono break-all">{result.name}</p>
        </div>
      </div>
      {@render sequence(result.lengths, true)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="player out" src={result.url} controls playsinline preload="metadata"></video>
      <dl class="stats">
        <div><dt class="mono">Length</dt><dd>{formatTime(result.duration, 1)}</dd></div>
        {#if result.width}<div><dt class="mono">Size</dt><dd>{result.width}×{result.height}</dd></div>{/if}
        <div><dt class="mono">File</dt><dd>{formatBytes(result.blob.size)}</dd></div>
        <div><dt class="mono">Clips in</dt><dd>{formatBytes(result.inputBytes)}</dd></div>
      </dl>
      {#each result.notes as note (note)}
        <p class="mono">{note}</p>
      {/each}
      <div class="actions">
        <button type="button" class="btn btn-primary" onclick={() => result && downloadBlob(result.blob, result.name)}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Download {result.container.toUpperCase()}
        </button>
        <button type="button" class="btn" onclick={clearResult}>Change something</button>
        <button type="button" class="btn ml-auto" onclick={startOver}>Start over</button>
      </div>
    </div>
  {:else}
    <div class="head">
      <div class="min-w-0">
        <p class="font-serif text-[28px] leading-none">{plural(clips.length, 'clip')}</p>
        <p class="mono mt-1">
          {formatTime(total, 1)} total{target ? ` · ${target.width}×${target.height}` : ''}{busy ? ' · reading…' : ''}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn add" disabled={!!job} onclick={() => picker?.click()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          Add clips
        </button>
        <button type="button" class="btn" disabled={!!job} onclick={startOver}>Start over</button>
      </div>
      <input bind:this={picker} type="file" accept={VIDEO_ACCEPT} multiple hidden onchange={(e) => (void addFiles(Array.from(e.currentTarget.files ?? [])), (e.currentTarget.value = ''))} />
    </div>

    {#if plans.length > 1}
      {@render sequence(ready.map((c, i) => ({ len: clipLength(plans[i]), color: c.color })), false)}
    {/if}

    {#if waitingForDecoder.length}
      <div class="decoder" role="status">
        <p>
          <strong>{plural(waitingForDecoder.length, 'file')}</strong> {waitingForDecoder.length === 1 ? 'uses' : 'use'} a format your browser can't play by itself
          ({waitingForDecoder.map((c) => c.file.name).join(', ')}). Rounder can convert {waitingForDecoder.length === 1 ? 'it' : 'them'} on your device with a one-time
          {FALLBACK_DOWNLOAD_MB} MB decoder download.
        </p>
        {#if decoder === 'loading'}
          <div class="track" role="progressbar" aria-label="Decoder download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(decoderProgress * 100)}><span style:width="{decoderProgress * 100}%"></span></div>
          <p class="mono">Downloading decoder… {Math.round(decoderProgress * 100)}%</p>
        {:else}
          <button type="button" class="btn" onclick={getDecoder}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB)</button>
        {/if}
      </div>
    {/if}

    <fieldset class="editor" disabled={!!job}>
      <p id="{uid}-keys" class="sr-only">Drag the handle, or focus it and press the up and down arrow keys, to change the order.</p>
      <ol bind:this={listEl} class="clips" class:dragging={!!dragKey} aria-label="Clips, in play order">
        {#each clips as c, i (c.key)}
          {@const v = c.info?.video}
          {@const p = c.status === 'ready' && v ? planOf(c) : null}
          <li class="row" class:lifted={dragKey === c.key} class:open={openKey === c.key} data-key={c.key} animate:flip={{ duration: reduceMotion ? 0 : 220 }}>
            <div class="line">
              <button
                type="button"
                class="handle"
                aria-label="Move {c.file.name}, position {i + 1} of {clips.length}"
                aria-describedby="{uid}-keys"
                onpointerdown={(e) => startDrag(e, c)}
                onkeydown={(e) => onHandleKey(e, i)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" /></svg>
              </button>
              <span class="thumb" style:--c={c.color}>
                {#if c.thumb}
                  <img src={c.thumb} alt="" />
                {:else if c.status === 'probing' || c.status === 'converting'}
                  <span class="shimmer"></span>
                {:else}
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M7.5 5.5v13M16.5 5.5v13M3.5 12h4M16.5 12h4" /></svg>
                {/if}
                <i class="num mono">{i + 1}</i>
                {#if p}<i class="dur mono">{formatTime(clipLength(p), 1)}</i>{/if}
              </span>
              <span class="info">
                <span class="file-name" title={c.file.name}>{c.file.name}</span>
                <span class="mono meta">
                  {#if c.status === 'probing'}
                    Reading…
                  {:else if c.status === 'converting'}
                    Converting with the decoder… {Math.round((c.progress ?? 0) * 100)}%
                  {:else if c.status === 'needs-decoder'}
                    Needs the decoder · {formatBytes(c.file.size)}
                  {:else if c.status === 'error'}
                    <span class="bad">{c.error}</span>
                  {:else if v && c.info}
                    {v.displayWidth}×{v.displayHeight} · {codecName(v.codec)}{c.info.audio ? '' : ' · no sound'} · {formatBytes(c.file.size)}
                  {/if}
                </span>
                {#if p && isTrimmed(p)}
                  <span class="mono trimmed">Trimmed {formatTime(p.start, 1)} – {formatTime(p.end, 1)} of {formatTime(p.duration, 1)}</span>
                {/if}
              </span>
              <span class="ctrl">
                {#if c.status === 'ready'}
                  <button type="button" class="btn trim-btn" aria-expanded={openKey === c.key} aria-controls="{uid}-trim-{c.key}" onclick={() => (openKey = openKey === c.key ? null : c.key)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="4" cy="4.5" r="2" /><circle cx="4" cy="11.5" r="2" /><path d="M5.6 5.6L13 12M5.6 10.4L13 4" /></svg>
                    <span>Trim</span>
                  </button>
                {/if}
                <button type="button" tabindex="-1" class="nudge hide-sm" aria-label="Move up" disabled={i === 0} onclick={() => moveClip(i, i - 1)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
                </button>
                <button type="button" tabindex="-1" class="nudge hide-sm" aria-label="Move down" disabled={i === clips.length - 1} onclick={() => moveClip(i, i + 1)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
                </button>
                <button
                  type="button"
                  class="nudge del"
                  aria-label="Remove {c.file.name}"
                  onclick={() => {
                    // keep keyboard focus in the list instead of losing it with the removed row
                    const next = clips[i + 1] ?? clips[i - 1];
                    removeClip(c);
                    if (next) void focusHandle(next.key);
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </span>
            </div>
            {#if openKey === c.key && c.status === 'ready' && c.info}
              <div class="trim" id="{uid}-trim-{c.key}">
                <!-- svelte-ignore a11y_media_has_caption -->
                <video bind:this={player} class="player" src={c.url} controls playsinline preload="metadata"></video>
                <TrimTimeline
                  file={c.src}
                  duration={c.info.durationSec}
                  media={player}
                  bind:start={c.start}
                  bind:end={c.end}
                  loop
                  step={v?.fps ? 1 / v.fps : 1 / 30}
                />
                <div class="trim-foot">
                  <span class="mono">Keeps {formatTime(Math.max(0, c.end - c.start), 2)} · drag the handles or use the arrow keys</span>
                  <span class="flex gap-2">
                    <button type="button" class="btn sm" disabled={!p || !isTrimmed(p)} onclick={() => ((c.start = 0), (c.end = c.info!.durationSec))}>Reset</button>
                    <button type="button" class="btn sm" onclick={() => (openKey = null)}>Done</button>
                  </span>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ol>

      <div class="options">
        <div class="opt wide">
          <span class="label" id="{uid}-size">output size</span>
          <div class="seg" role="group" aria-labelledby="{uid}-size">
            <button type="button" aria-pressed={sizeMode === 'first'} onclick={() => (sizeMode = 'first')}>Match first clip</button>
            <button type="button" aria-pressed={sizeMode === 'largest'} onclick={() => (sizeMode = 'largest')}>Largest clip</button>
            {#each Object.entries(SIZE_PRESETS) as [id, s] (id)}
              <button type="button" aria-pressed={sizeMode === id} title="{s.width}×{s.height}" onclick={() => (sizeMode = id as SizeMode)}>{s.label}</button>
            {/each}
          </div>
          {#if target}<p class="mono mt-2">{target.width}×{target.height}</p>{/if}
        </div>

        <div class="opt">
          <span class="label" id="{uid}-fit">clips of another shape</span>
          <div class="seg" role="group" aria-labelledby="{uid}-fit">
            <button type="button" aria-pressed={fit === 'letterbox'} onclick={() => (fit = 'letterbox')}>Fit with bars</button>
            <button type="button" aria-pressed={fit === 'fill'} onclick={() => (fit = 'fill')}>Crop to fill</button>
          </div>
          <p class="mono mt-2">
            {#if !mismatched}
              Every clip already has this shape.
            {:else if fit === 'letterbox'}
              <label class="inline-flex items-center gap-2">Bar color <input type="color" class="swatch" bind:value={barColor} /></label>
            {:else}
              Edges are cut off; those clips take a little longer.
            {/if}
          </p>
        </div>

        <div class="opt">
          <span class="label" id="{uid}-q">quality</span>
          <div class="seg" role="group" aria-labelledby="{uid}-q">
            {#each QUALITIES as q (q.id)}
              <button type="button" aria-pressed={quality === q.id} onclick={() => (quality = q.id)}>{q.label}</button>
            {/each}
          </div>
        </div>

        <div class="opt wide">
          <span class="label" id="{uid}-audio">sound</span>
          <div class="seg" role="group" aria-labelledby="{uid}-audio">
            <button type="button" aria-pressed={audioMode === 'keep'} onclick={() => (audioMode = 'keep')}>Keep each clip's sound</button>
            <button type="button" aria-pressed={audioMode === 'mute'} onclick={() => (audioMode = 'mute')}>Mute</button>
            <button type="button" aria-pressed={audioMode === 'music'} onclick={() => (music ? (audioMode = 'music') : musicPicker?.click())}>Background music</button>
          </div>
          <input bind:this={musicPicker} type="file" accept={MUSIC_ACCEPT} hidden onchange={(e) => (void setMusic(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
          {#if audioMode === 'music' && music}
            <div class="music">
              <div class="flex items-center gap-3 min-w-0">
                <span class="note" aria-hidden="true">♪</span>
                <span class="min-w-0 flex-1">
                  <span class="file-name block" title={music.file.name}>{music.file.name}</span>
                  <span class="mono meta block">
                    {#if music.status === 'probing'}Reading…
                    {:else if music.status === 'converting'}Converting with the decoder… {Math.round((music.progress ?? 0) * 100)}%
                    {:else if music.status === 'needs-decoder'}Needs the decoder
                    {:else if music.status === 'error'}<span class="bad">{music.error}</span>
                    {:else if music.info}{formatTime(music.info.durationSec, 1)} · {formatBytes(music.file.size)}{/if}
                  </span>
                </span>
                <button type="button" class="btn sm" onclick={() => musicPicker?.click()}>Change</button>
                <button type="button" class="nudge del" aria-label="Remove music" onclick={removeMusic}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </div>
              {#if musicReady}
                <audio class="w-full" src={musicReady.url} controls preload="metadata"></audio>
                <label class="volume">
                  <span class="mono">Music volume</span>
                  <input type="range" min="10" max="200" step="5" bind:value={volume} aria-valuetext="{volume}%" />
                  <span class="mono num-out">{volume}%</span>
                </label>
                <p class="mono">Replaces the clips' own sound. {musicFit(musicReady.info!.durationSec, total)}</p>
              {/if}
            </div>
          {/if}
        </div>

        <div class="opt wide">
          <span class="label" id="{uid}-fmt">format</span>
          <div class="seg" role="group" aria-labelledby="{uid}-fmt">
            {#each FORMATS as f (f)}
              {@const off = !!canWrite && !canWrite[f]}
              <button type="button" aria-pressed={format === f} disabled={off} title={off ? `This browser can't write ${f.toUpperCase()} video` : undefined} onclick={() => (format = f)}>
                {f.toUpperCase()}
              </button>
            {/each}
          </div>
          {#if canWrite && FORMATS.some((f) => !canWrite![f])}
            <p class="mono mt-2">Grayed-out formats can't be encoded by this browser.</p>
          {/if}
        </div>
      </div>
    </fieldset>

    {#if job}
      <div class="progress" role="status">
        <div class="track" role="progressbar" aria-label="Merge progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}><span style:width="{job.progress * 100}%"></span></div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="mono min-w-0">
            {job.status} · {Math.round(job.progress * 100)}% · {clock(elapsed)} elapsed{eta !== null ? ` · about ${clock(eta)} left` : ''}
          </span>
          <button bind:this={cancelBtn} type="button" class="btn cancel" onclick={() => ctrl?.abort()}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="go">
        <button bind:this={goBtn} type="button" class="btn btn-primary" disabled={!canMerge || deviceFit?.level === 'block'} onclick={merge}>
          {ready.length > 1 ? `Merge ${plural(ready.length, 'clip')}` : 'Export video'}
        </button>
        <span class="mono">
          {#if busy}
            Reading your clips…
          {:else if waitingForDecoder.length}
            Download the decoder above to use every clip.
          {:else if clips.some((c) => c.status === 'error')}
            Remove the clips that couldn't be read to continue.
          {:else if audioMode === 'music' && !musicReady}
            Choose a music file, or pick another sound option.
          {:else if ready.length === 1}
            Add another clip to join it with this one.
          {:else}
            {formatTime(total, 1)} · nothing leaves your device
          {/if}
        </span>
      </div>
    {/if}
    {#if !job}<DeviceNote verdict={deviceFit} />{/if}
    {#if mergeError}
      <p class="error" role="alert">{mergeError}</p>
    {/if}
  {/if}

  {#if errors.length}
    <div class="errors" role="alert">
      <ul>
        {#each errors as msg, i (i)}
          <li>{msg}</li>
        {/each}
      </ul>
      <button type="button" class="mono link" onclick={() => (errors = [])}>Dismiss</button>
    </div>
  {/if}

  <p class="sr-only" aria-live="polite">{message}</p>
</div>

<style>
  .merge {
    position: relative;
    border-radius: 18px;
    outline: 1.5px dashed transparent;
    outline-offset: 6px;
    transition: outline-color 0.2s;
    &.over {
      outline-color: var(--color-sun);
    }
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    & .btn {
      padding: 10px 14px;
      font-size: 14px;
    }
  }
  .add {
    border-style: dashed;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.sm {
    padding: 7px 11px;
    font-size: 13px;
  }

  /* ---------- sequence: every clip as a share of the total ---------- */
  .seq {
    display: flex;
    gap: 3px;
    height: 22px;
    margin-bottom: 14px;
    & span {
      flex: 1 1 0;
      min-width: 6px;
      display: flex;
      align-items: center;
      padding-left: 6px;
      overflow: hidden;
      border-radius: 6px;
      background: color-mix(in srgb, var(--c) 30%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent);
      transition: flex-grow 0.35s ease-out, border-radius 0.5s, margin 0.5s var(--ease-spring);
    }
    & b {
      font: 500 11px var(--font-mono);
      color: var(--color-chalk);
    }
  }
  /* done: the pieces butt together into one strip */
  .seq.joined {
    gap: 0;
    animation: join 0.7s var(--ease-spring) backwards 0.1s;
    & span {
      border-radius: 0;
    }
    & span:first-child {
      border-radius: 6px 0 0 6px;
    }
    & span:last-child {
      border-radius: 0 6px 6px 0;
    }
  }
  @keyframes join {
    from {
      gap: 10px;
    }
  }

  /* ---------- fallback decoder ---------- */
  .decoder {
    display: grid;
    gap: 10px;
    margin-bottom: 14px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid #ffd25e55;
    background: #ffd25e0d;
    font-size: 14px;
    overflow-wrap: anywhere;
    & .btn {
      justify-self: start;
      padding: 9px 14px;
      font-size: 14px;
    }
  }

  /* ---------- clip list ---------- */
  .editor {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .clips {
    position: relative; /* rows' offsetParent, for hitRow() */
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .dragging {
    cursor: grabbing;
    user-select: none;
  }
  .row {
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    transition: border-color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-spring);
    &.lifted {
      border-color: var(--color-sun);
      box-shadow: 0 14px 30px -12px #000c, 0 0 0 1px var(--color-sun);
      transform: scale(1.015);
      position: relative;
      z-index: 1;
    }
    &.open {
      border-color: #ffd25e66;
    }
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 72px;
    padding: 8px 10px 8px 4px;
  }
  .handle {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 48px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--color-muted);
    cursor: grab;
    touch-action: none;
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
    }
    &:hover {
      color: var(--color-chalk);
      background: #f2ede40d;
    }
  }
  .dragging .handle {
    cursor: grabbing;
  }
  .thumb {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 96px;
    height: 54px;
    border-radius: 8px;
    overflow: hidden;
    background: #0e0d0c;
    color: var(--color-muted);
    box-shadow: inset 0 -3px 0 var(--c);
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      animation: arrive 0.35s ease-out;
    }
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
    }
    & i {
      position: absolute;
      font-style: normal;
      font-size: 10.5px;
      line-height: 1;
      padding: 3px 5px;
      border-radius: 5px;
      color: var(--color-chalk);
      background: #000b;
    }
    & .num {
      top: 4px;
      left: 4px;
      color: var(--color-bg);
      background: var(--c);
      font-weight: 600;
    }
    & .dur {
      right: 4px;
      bottom: 6px;
    }
  }
  .shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, #1d1c1a 30%, #2c2b28 50%, #1d1c1a 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .file-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 15px;
  }
  .meta {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .trimmed {
    color: var(--color-sun);
  }
  .bad {
    color: var(--color-bad);
    white-space: normal;
  }
  .ctrl {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .trim-btn {
    padding: 7px 10px;
    margin-right: 4px;
    font-size: 13px;
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
    }
    &[aria-expanded='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .nudge {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    & svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      border-color: var(--color-line-2);
    }
    &.del:hover:not(:disabled) {
      color: var(--color-bad);
      border-color: #ff7a6b55;
    }
    &:disabled {
      opacity: 0.3;
      cursor: default;
    }
  }
  .trim {
    display: grid;
    gap: 12px;
    padding: 4px 14px 14px;
    animation: arrive 0.3s ease-out;
  }
  .player {
    width: 100%;
    max-height: 340px;
    border-radius: 12px;
    background: #000;
  }
  .trim-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }
  @media (max-width: 560px) {
    .hide-sm {
      display: none;
    }
    .thumb {
      width: 72px;
      height: 44px;
    }
    .trim-btn span {
      display: none;
    }
    .line {
      gap: 8px;
    }
    .trim {
      padding: 4px 10px 12px;
    }
  }

  /* ---------- options ---------- */
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 24px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--color-line);
  }
  .opt {
    min-width: 0;
    &.wide {
      grid-column: 1 / -1;
    }
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .swatch {
    width: 30px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--color-line-2);
    border-radius: 6px;
    background: none;
    cursor: pointer;
  }
  .music {
    display: grid;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .note {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: #ffd25e1f;
    color: var(--color-sun);
    font-size: 18px;
  }
  .volume {
    display: grid;
    grid-template-columns: auto 1fr 3.5em;
    align-items: center;
    gap: 12px;
    & input {
      accent-color: var(--color-sun);
      width: 100%;
    }
  }
  .num-out {
    text-align: right;
    color: var(--color-chalk);
  }
  @media (max-width: 760px) {
    .options {
      grid-template-columns: 1fr;
    }
  }

  /* ---------- action, progress, result ---------- */
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    margin-top: 22px;
  }
  .progress {
    display: grid;
    gap: 10px;
    margin-top: 22px;
  }
  .track {
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--color-sun) 30%, #fff3c9 50%, var(--color-sun) 70%) 0 0 / 300% 100%;
      animation: shimmer 1.6s linear infinite;
      transition: width 0.3s ease-out;
    }
  }
  .cancel {
    flex: none;
    padding: 8px 12px;
    font-size: 13px;
  }
  .result {
    display: grid;
    gap: 16px;
    padding: 20px;
    border-radius: 18px;
    border: 1px solid #9be58f55;
    background: linear-gradient(120deg, #9be58f12, transparent 60%), var(--color-panel-2);
    animation: arrive 0.4s var(--ease-spring);
    & .seq {
      margin: 0;
    }
  }
  .result-head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .tick {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--color-ok);
    animation: pop 0.5s var(--ease-spring) backwards 0.15s;
    & svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 24;
      animation: draw 0.4s ease-out backwards 0.35s;
    }
  }
  .out {
    max-height: 460px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
    margin: 0;
    & div {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--color-line);
      background: #0000001f;
    }
    & dd {
      margin: 2px 0 0;
      font-size: 16px;
    }
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 24;
    }
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .error,
  .errors {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b12;
    color: var(--color-bad);
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .errors {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    & ul {
      flex: 1;
      min-width: 0;
    }
  }
  .link {
    flex: none;
    background: none;
    border: 0;
    padding: 4px 6px;
    border-radius: 6px;
    color: var(--color-soft);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
