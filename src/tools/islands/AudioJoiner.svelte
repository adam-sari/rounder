<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import {
    audioCodecLabel,
    capabilities,
    decodeAudio,
    downloadName,
    encodeAudio,
    FALLBACK_DOWNLOAD_MB,
    formatBitrate,
    formatBytes,
    formatTime,
    isAbort,
    preloadFallback,
    probe,
    throwIfAborted,
    toMediaError,
    transcode,
    waveform,
    type AudioCodec,
    type Capabilities,
    type MediaInfo,
    type Peaks,
  } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import { disposeJoiner, joiner, transferChannels } from '@/tools/lib/audio-joiner/client';
  import { estimateJoinBytes, joinFormatList, joinFormats, type JoinFormat } from '@/tools/lib/audio-joiner/formats';
  import { framePlan, LONG_JOIN_SEC, mixBytes, outputLayout, planJoin, type TransitionKind } from '@/tools/lib/audio-joiner/mix';

  interface Track {
    key: string;
    file: File;
    /** what gets decoded: the file itself, or a WAV made by the fallback decoder */
    src: Blob;
    converted: boolean;
    url: string;
    status: 'probing' | 'needs-decoder' | 'converting' | 'ready';
    note: string;
    info: MediaInfo | null;
    duration: number;
    start: number;
    end: number;
    gainDb: number;
    peaks: Peaks | null;
  }

  interface Result {
    blob: Blob;
    url: string;
    name: string;
    duration: number;
    inputBytes: number;
    notes: string[];
    key: string;
  }

  const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.wma,.aif,.aiff,.amr,.webm,.mkv,.mov,.mp4,.m4v,.avi,.wmv,.flv,.3gp';
  const MEDIA_EXT = /\.(mp3|wav|m4a|m4b|aac|flac|ogg|oga|opus|wma|aiff?|amr|ac3|ape|wv|mka|webm|mkv|mov|mp4|m4v|avi|wmv|flv|3gp|ts|mts|mpe?g)$/i;
  const PEAK_BUCKETS = 1000;

  let tracks = $state<Track[]>([]);
  let errors = $state<string[]>([]);
  let message = $state('');
  let open = $state<string | null>(null);
  let player = $state<HTMLAudioElement | null>(null);
  let caps = $state<Capabilities | null>(null);
  let decoder = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  let decoderProgress = $state(0);

  let transition = $state<TransitionKind>('none');
  let seconds = $state(2);
  let matchLoudness = $state(false);
  let format = $state<JoinFormat>('mp3');
  let bitrate = $state(joinFormats.mp3.defaultBitrate);

  let job = $state<{ progress: number; status: string; startedAt: number } | null>(null);
  let now = $state(0);
  let result = $state<Result | null>(null);
  let error = $state('');

  let reduceMotion = $state(false);
  let over = $state(false);
  let picker = $state<HTMLInputElement>();
  let listEl = $state<HTMLOListElement>();
  let downloadBtn = $state<HTMLButtonElement>();
  let ctrl: AbortController | undefined;
  const life = new AbortController();
  /** running fallback conversions, so removing a track stops its work */
  const conversions = new Map<string, AbortController>();
  let nextKey = 0;
  let probeChain = Promise.resolve();
  let peakChain = Promise.resolve();
  const uid = $props.id();

  const ready = $derived(tracks.filter((t) => t.status === 'ready'));
  const waiting = $derived(tracks.filter((t) => t.status === 'needs-decoder'));
  const busyTracks = $derived(tracks.some((t) => t.status === 'probing' || t.status === 'converting'));
  const lengths = $derived(ready.map((t) => Math.max(0, t.end - t.start)));
  const plan = $derived(planJoin(lengths, { kind: transition, seconds }));
  const layout = $derived(outputLayout(ready.map((t) => ({ sampleRate: t.info!.audio!.sampleRate, channels: t.info!.audio!.channels }))));
  const seams = $derived(new Map(ready.slice(1).map((t, i) => [t.key, plan.overlaps[i]])));
  const choice = $derived(joinFormats[format]);
  const estimate = $derived(estimateJoinBytes(format, plan.total, bitrate, layout.sampleRate, layout.channels));
  const tooLong = $derived(plan.total > LONG_JOIN_SEC);
  const flacDownload = $derived(format === 'flac' && !!caps && !caps.audio.encode.includes('flac') && decoder !== 'ready');
  const canJoin = $derived(ready.length >= 2 && !busyTracks && !waiting.length && !job);
  const planKey = $derived(JSON.stringify([tracks.map((t) => [t.key, t.status, t.start, t.end, t.gainDb]), transition, seconds, matchLoudness, format, bitrate]));
  const done = $derived(result && result.key === planKey ? result : null);
  const elapsed = $derived(job ? Math.max(0, (now - job.startedAt) / 1000) : 0);
  const eta = $derived(job && job.progress > 0.03 ? (elapsed * (1 - job.progress)) / job.progress : null);

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const khz = (rate: number) => `${(rate / 1000).toFixed(rate % 1000 ? 1 : 0)} kHz`;
  const chLabel = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} ch`);
  const extOf = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'file').toUpperCase();
  const codecName = (c: string | null) => (c ? (audioCodecLabel[c as AudioCodec] ?? c.toUpperCase()) : 'audio');
  const signed = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
  const isTrimmed = (t: Track) => t.start > 0.005 || t.end < t.duration - 0.005;

  onMount(() => {
    reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const onPaste = (e: ClipboardEvent) => {
      if (tracks.length && e.clipboardData?.files.length) addFiles(Array.from(e.clipboardData.files));
    };
    addEventListener('paste', onPaste);
    return () => {
      removeEventListener('paste', onPaste);
      endDrag();
      ctrl?.abort();
      life.abort();
      for (const c of conversions.values()) c.abort();
      disposeJoiner();
      for (const t of tracks) if (t.url) URL.revokeObjectURL(t.url);
      if (result) URL.revokeObjectURL(result.url);
    };
  });

  // the elapsed/ETA clock only ticks while a job runs
  $effect(() => {
    if (!job) return;
    const id = setInterval(() => (now = performance.now()), 250);
    return () => clearInterval(id);
  });

  // once capabilities are known, step off a format this browser can't write
  $effect(() => {
    if (formatBlocked(format)) setFormat('mp3');
  });

  /* ---------- adding files ---------- */

  function addFiles(files: File[]) {
    if (!files.length || job) return;
    if (!caps) capabilities().then((c) => (caps = c), () => {});
    for (const file of files) {
      if (!/^(audio|video)\//.test(file.type) && !MEDIA_EXT.test(file.name)) {
        errors.push(`${file.name} isn't an audio or video file.`);
        continue;
      }
      tracks.push({ key: `t${++nextKey}`, file, src: file, converted: false, url: '', status: 'probing', note: '', info: null, duration: 0, start: 0, end: 0, gainDb: 0, peaks: null });
      const t = tracks[tracks.length - 1]; // the reactive proxy, not the plain object
      probeChain = probeChain.then(() => inspect(t));
    }
  }

  async function inspect(t: Track) {
    if (!tracks.includes(t)) return;
    try {
      const info = await probe(t.file, { signal: life.signal });
      // only the sound matters here: a video the browser can't decode is fine if its audio is
      if (!info.readable || (info.audio && !info.audio.canDecode)) {
        t.status = 'needs-decoder';
        if (decoder === 'ready') await convert(t);
      } else accept(t, info, t.file);
    } catch (e) {
      if (!isAbort(e)) reject(t, `${t.file.name}: ${friendly(e)}`);
    }
  }

  function accept(t: Track, info: MediaInfo, src: Blob, converted = false) {
    if (!tracks.includes(t)) return;
    if (!info.audio) return reject(t, `${t.file.name} has no audio track.`);
    if (!(info.durationSec > 0)) return reject(t, `Couldn't read how long ${t.file.name} is.`);
    Object.assign(t, { info, src, converted, url: URL.createObjectURL(src), duration: info.durationSec, start: 0, end: info.durationSec, status: 'ready', note: '' });
    peakChain = peakChain.then(() => loadPeaks(t));
  }

  async function loadPeaks(t: Track) {
    if (!tracks.includes(t)) return;
    try {
      t.peaks = await waveform(t.src, PEAK_BUCKETS, {}, { signal: life.signal });
    } catch {
      // the row just shows no waveform; joining doesn't depend on it
    }
  }

  function reject(t: Track, msg: string) {
    errors.push(msg);
    removeTrack(t);
  }

  function removeTrack(t: Track) {
    conversions.get(t.key)?.abort();
    if (t.url) URL.revokeObjectURL(t.url);
    tracks = tracks.filter((x) => x !== t);
    if (open === t.key) open = null;
  }

  /* ---------- the ffmpeg fallback for WMA, AVI, AC-3 … (asked for, never automatic) ---------- */

  async function approveDecoder() {
    decoder = 'loading';
    try {
      await preloadFallback((p) => (decoderProgress = p));
      decoder = 'ready';
    } catch (e) {
      decoder = 'failed';
      errors.push(`The decoder didn't download: ${friendly(e)}`);
      return;
    }
    for (const t of waiting) await convert(t);
  }

  /** decodes the file once with ffmpeg.wasm and keeps a WAV copy every later step can read */
  async function convert(t: Track) {
    if (!tracks.includes(t) || t.status !== 'needs-decoder') return;
    t.status = 'converting';
    t.note = 'Converting…';
    const stop = new AbortController();
    conversions.set(t.key, stop);
    try {
      const pcm = await decodeAudio(t.file, {}, { signal: stop.signal, onProgress: (p) => (t.note = `Converting… ${Math.round(p * 100)}%`) });
      const wav = await joiner().toWav(transferChannels(pcm.channels), pcm.sampleRate);
      accept(t, await probe(wav), wav, true);
    } catch (e) {
      if (!isAbort(e)) reject(t, `${t.file.name}: ${friendly(e)}`);
    } finally {
      conversions.delete(t.key);
    }
  }

  /* ---------- order: drag the handle, arrow keys on it, or the nudge buttons ---------- */

  function moveTrack(from: number, to: number, announce = true) {
    if (to < 0 || to >= tracks.length || to === from) return;
    const next = [...tracks];
    const [t] = next.splice(from, 1);
    next.splice(to, 0, t);
    tracks = next;
    if (announce) message = `${t.file.name} moved to position ${to + 1} of ${next.length}.`;
  }

  async function focusHandle(key: string) {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-key="${key}"] .handle`)?.focus();
  }

  function onHandleKey(e: KeyboardEvent, i: number) {
    const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: tracks.length - 1 }[e.key];
    if (to === undefined || job) return;
    e.preventDefault();
    const key = tracks[i].key;
    moveTrack(i, Math.max(0, Math.min(tracks.length - 1, to)));
    void focusHandle(key);
  }

  let dragKey = $state<string | null>(null);
  let dragFrom = -1;
  let dragPointer = -1;
  let dragY = 0;
  let scrollFrame = 0;

  function startDrag(e: PointerEvent, t: Track) {
    if (e.button !== 0 || dragKey || job) return;
    e.preventDefault();
    dragKey = t.key;
    dragPointer = e.pointerId;
    dragFrom = tracks.indexOf(t);
    dragY = e.clientY;
    // on window: the row moves in the DOM while dragged, which can drop pointer capture
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
    const from = tracks.findIndex((t) => t.key === dragKey);
    let to = 0;
    for (const [i, row] of [...listEl.children].entries()) {
      const r = row as HTMLElement;
      if (i !== from && r.offsetTop + r.offsetHeight / 2 < y) to++;
    }
    moveTrack(from, to, false);
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
    const to = tracks.findIndex((t) => t.key === dragKey);
    if (to !== dragFrom && to >= 0) message = `${tracks[to].file.name} moved to position ${to + 1} of ${tracks.length}.`;
    dragKey = null;
  }

  function sortByName() {
    tracks = [...tracks].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
    message = 'Tracks sorted by name.';
  }

  /* ---------- output ---------- */

  function formatBlocked(f: JoinFormat): string {
    if (!caps || f === 'wav' || f === 'flac') return '';
    return caps.audio.encode.includes(joinFormats[f].codec) && caps.containers[f] ? '' : `This browser can't encode ${joinFormats[f].label}`;
  }

  function setFormat(f: JoinFormat) {
    format = f;
    bitrate = joinFormats[f].defaultBitrate;
  }

  function friendly(e: unknown): string {
    const err = toMediaError(e);
    if ((e as Error)?.name === 'RangeError') return 'Your browser ran out of memory for a mix this long. Try fewer or shorter tracks, then join the results.';
    switch (err.code) {
      case 'out-of-memory':
        return 'Your browser ran out of memory for a mix this long. Try fewer or shorter tracks, then join the results.';
      case 'unsupported-input':
        return "This browser can't read that file's audio.";
      case 'unsupported-codec':
        return `This browser can't encode ${choice.label}. Pick another format.`;
      case 'no-tracks':
        return 'There is no audio track in it.';
      case 'no-webcodecs':
        return 'This browser is missing audio features the joiner needs. Try a recent Chrome, Edge, Safari or Firefox.';
      case 'ffmpeg-failed':
        return "The fallback decoder couldn't read it.";
      default:
        return err.message || 'Something went wrong while joining.';
    }
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  async function join() {
    const list = [...ready];
    const lens = [...lengths];
    const { sampleRate, channels } = layout;
    const frames = framePlan(plan, lens, sampleRate);
    const fmt = format;
    const spec = choice;
    const rate = bitrate;
    const key = planKey;
    const name = downloadName(list[0].file.name, fmt, '-joined');
    const fetchesEncoder = flacDownload;
    const level = matchLoudness;
    const duration = plan.total;
    const share = fmt === 'wav' ? 0.95 : 0.6; // decoding + mixing vs encoding, of the progress bar
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let current = '';

    open = null;
    clearResult();
    error = '';
    ctrl = new AbortController();
    const signal = ctrl.signal;
    now = performance.now();
    job = { progress: 0, status: 'Preparing…', startedAt: now };
    const set = (p: number) => job && (job.progress = Math.max(job.progress, Math.min(1, p)));
    const w = joiner();
    try {
      await w.start(frames.total, channels, sampleRate);
      let doneSec = 0;
      // one track at a time: only the current track's audio sits next to the mix
      for (const [i, t] of list.entries()) {
        job.status = `Decoding ${i + 1} of ${list.length} · ${t.file.name}`;
        current = t.file.name;
        const pcm = await decodeAudio(t.src, { start: t.start, end: t.end, sampleRate }, { signal, onProgress: (p) => set((share * (doneSec + p * lens[i])) / total) });
        throwIfAborted(signal);
        await w.add(transferChannels(pcm.channels), frames.tracks[i], t.gainDb, level);
        current = '';
        doneSec += lens[i];
        set((share * doneSec) / total);
      }
      job.status = fmt === 'wav' ? 'Writing WAV…' : `Encoding ${spec.label}…`;
      // FLAC is made from the same 16-bit PCM as WAV, so it really is about half that size
      const mix = await w.finish(fmt === 'wav' || fmt === 'flac' ? 'wav' : 'pcm');
      throwIfAborted(signal);
      const enc = { signal, onProgress: (p: number) => set(share + (1 - share) * p) };
      let blob: Blob;
      const notes: string[] = [];
      if (fmt === 'wav') blob = mix.wav!;
      else if (fmt === 'flac') {
        const out = await transcode(mix.wav!, { container: 'flac' }, { ...enc, onStatus: (s) => job && (job.status = s) });
        blob = out.blob;
      } else blob = await encodeAudio({ sampleRate, channels: mix.channels }, { format: fmt, codec: spec.codec, bitrate: rate }, enc);
      if (fetchesEncoder) decoder = 'ready';
      if (mix.safetyDb) notes.push(`The whole mix was lowered by ${Math.abs(mix.safetyDb).toFixed(1)} dB so loud overlaps don't clip.`);
      result = { blob, url: URL.createObjectURL(blob), name, duration, inputBytes: list.reduce((s, t) => s + t.file.size, 0), notes, key };
      message = `Joined ${plural(list.length, 'track')} into ${name}.`;
      job = null; // the result card (and its Download button) only renders once the job is gone
      await tick();
      downloadBtn?.focus();
    } catch (e) {
      void w.reset();
      if (!signal.aborted && !isAbort(e)) error = current ? `${current}: ${friendly(e)}` : friendly(e);
    } finally {
      job = null;
      ctrl = undefined;
    }
  }

  function startOver() {
    ctrl?.abort();
    for (const c of conversions.values()) c.abort();
    for (const t of tracks) if (t.url) URL.revokeObjectURL(t.url);
    tracks = [];
    errors = [];
    error = '';
    open = null;
    clearResult();
  }
</script>

<div
  class="joiner"
  class:over
  role="region"
  aria-label="Audio joiner"
  ondragover={(e) => {
    if (!tracks.length || job || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    over = true;
  }}
  ondragleave={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) over = false;
  }}
  ondrop={(e) => {
    over = false;
    // the empty-state Dropzone handles its own drops
    if (e.defaultPrevented || !tracks.length) return;
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer?.files ?? []));
  }}
>
  {#if !tracks.length}
    <Dropzone accept={ACCEPT} multiple title="Drop songs, clips or videos here" hint="MP3, WAV, M4A, FLAC, OGG or the sound from any video · or click to choose" onfiles={addFiles} />
  {:else}
    <div class="head">
      <div class="min-w-0">
        <p class="total font-serif">{formatTime(plan.total, 1)}</p>
        <p class="mono mt-1">
          {plural(tracks.length, 'track')}{ready.length ? ` · ${khz(layout.sampleRate)} ${chLabel(layout.channels)}` : ''}{busyTracks ? ' · reading…' : ''}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn sm add" onclick={() => picker?.click()} disabled={!!job}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          Add files
        </button>
        {#if tracks.length > 1}
          <button type="button" class="btn sm" onclick={sortByName} disabled={!!job}>Sort A–Z</button>
        {/if}
      </div>
      <input bind:this={picker} type="file" accept={ACCEPT} multiple hidden onchange={(e) => (addFiles(Array.from(e.currentTarget.files ?? [])), (e.currentTarget.value = ''))} />
    </div>

    {#if waiting.length || decoder === 'loading'}
      <div class="notice" role="status">
        {#if decoder === 'loading'}
          <p>Downloading the decoder… {Math.round(decoderProgress * 100)}%</p>
          <div class="track"><span style:width="{decoderProgress * 100}%"></span></div>
        {:else}
          <p>
            {waiting.length === 1 ? `${waiting[0].file.name} is in a format` : `${waiting.length} files are in formats`} your browser can't play by itself
            ({[...new Set(waiting.map((t) => extOf(t.file.name)))].join(', ')}). A one-time {FALLBACK_DOWNLOAD_MB} MB decoder can convert {waiting.length === 1 ? 'it' : 'them'}, right here on your device.
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn sm btn-primary" onclick={approveDecoder}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB)</button>
            <button type="button" class="btn sm" onclick={() => waiting.forEach(removeTrack)}>Remove {waiting.length === 1 ? 'it' : 'them'}</button>
          </div>
        {/if}
      </div>
    {/if}

    <p id="{uid}-keys" class="sr-only">Drag the handle, or focus it and press the up and down arrow keys, to change the order.</p>
    <ol bind:this={listEl} class="tracks" class:dragging={!!dragKey} class:seamed={transition !== 'none'} aria-label="Tracks, in play order">
      {#each tracks as t, i (t.key)}
        {@const seam = seams.get(t.key)}
        <li class="item" class:lifted={dragKey === t.key} class:expanded={open === t.key} data-key={t.key} animate:flip={{ duration: reduceMotion ? 0 : 220 }}>
          {#if seam !== undefined && transition !== 'none'}
            <span class="seam mono" aria-hidden="true">
              {transition === 'crossfade' ? `⤫ ${seam.toFixed(1)} s crossfade` : `${seconds.toFixed(1)} s silence`}
            </span>
          {/if}
          <div class="row">
            <button
              type="button"
              class="handle"
              aria-label="Move {t.file.name}, position {i + 1} of {tracks.length}"
              aria-describedby="{uid}-keys"
              disabled={!!job}
              onpointerdown={(e) => startDrag(e, t)}
              onkeydown={(e) => onHandleKey(e, i)}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" /></svg>
            </button>
            <span class="order mono" aria-hidden="true">{i + 1}</span>
            <span class="mini" class:loading={t.status !== 'ready' || !t.peaks} aria-hidden="true">
              {#if t.peaks}
                <Waveform peaks={t.peaks} />
                <i class="cut" style:left="0" style:width="{(t.start / t.duration) * 100}%"></i>
                <i class="cut" style:right="0" style:width="{(1 - t.end / t.duration) * 100}%"></i>
              {/if}
            </span>
            <span class="info">
              <span class="file-name" title={t.file.name}>{t.file.name}</span>
              <span class="mono meta">
                {#if t.status === 'probing'}
                  Reading…
                {:else if t.status === 'needs-decoder'}
                  Needs the extra decoder
                {:else if t.status === 'converting'}
                  {t.note}
                {:else}
                  {formatTime(t.end - t.start, 1)} · {t.converted ? `converted from ${extOf(t.file.name)}` : codecName(t.info!.audio!.codec)} · {khz(t.info!.audio!.sampleRate)} {chLabel(t.info!.audio!.channels)}{t.info!.video ? ' · from video' : ''} · {formatBytes(t.file.size)}
                {/if}
              </span>
              {#if t.status === 'ready' && (isTrimmed(t) || t.gainDb)}
                <span class="chips">
                  {#if isTrimmed(t)}<span class="chip">trimmed</span>{/if}
                  {#if t.gainDb}<span class="chip">{signed(t.gainDb)}</span>{/if}
                </span>
              {/if}
            </span>
            {#if t.status === 'ready'}
              <button type="button" class="btn sm edit" aria-expanded={open === t.key} aria-controls="{uid}-{t.key}" disabled={!!job} onclick={() => (open = open === t.key ? null : t.key)}>
                {open === t.key ? 'Done' : 'Trim & volume'}
              </button>
            {/if}
            <span class="ctrl">
              <button type="button" tabindex="-1" class="nudge" aria-label="Move up" disabled={i === 0 || !!job} onclick={() => moveTrack(i, i - 1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
              </button>
              <button type="button" tabindex="-1" class="nudge" aria-label="Move down" disabled={i === tracks.length - 1 || !!job} onclick={() => moveTrack(i, i + 1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
              </button>
              <button
                type="button"
                class="nudge del"
                aria-label="Remove {t.file.name}"
                disabled={!!job}
                onclick={() => {
                  // keep keyboard focus in the list instead of losing it with the removed row
                  const next = tracks[i + 1] ?? tracks[i - 1];
                  removeTrack(t);
                  if (next) void focusHandle(next.key);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
              </button>
            </span>
          </div>

          {#if open === t.key && t.status === 'ready'}
            <div class="panel" id="{uid}-{t.key}">
              <audio bind:this={player} src={t.url} controls preload="metadata" class="w-full" aria-label="Preview of {t.file.name}"></audio>
              <TrimTimeline duration={t.duration} bind:start={t.start} bind:end={t.end} media={player} peaks={t.peaks} file={t.peaks ? null : t.src} kind="audio" step={0.01} />
              <div class="gain">
                <label class="min-w-0 flex-1">
                  <span class="label">volume · {signed(t.gainDb)}</span>
                  <input type="range" min="-12" max="12" step="0.5" bind:value={t.gainDb} class="w-full accent-(--color-sun)" />
                  <span class="mono flex justify-between"><span>quieter</span><span>applied when joining</span><span>louder</span></span>
                </label>
                <button
                  type="button"
                  class="btn sm"
                  disabled={!isTrimmed(t) && !t.gainDb}
                  onclick={() => {
                    t.start = 0;
                    t.end = t.duration;
                    t.gainDb = 0;
                  }}>Reset</button
                >
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <div class="options">
      <div>
        <span class="label">between tracks</span>
        <div class="seg" role="group" aria-label="Between tracks">
          <button type="button" aria-pressed={transition === 'none'} disabled={!!job} onclick={() => (transition = 'none')}>Back to back</button>
          <button type="button" aria-pressed={transition === 'crossfade'} disabled={!!job} onclick={() => (transition = 'crossfade')}>Crossfade</button>
          <button type="button" aria-pressed={transition === 'gap'} disabled={!!job} onclick={() => (transition = 'gap')}>Silence</button>
        </div>
        {#if transition !== 'none'}
          <label class="mt-3 block">
            <span class="label">{transition === 'crossfade' ? 'crossfade length' : 'silence'} · {seconds.toFixed(1)} s</span>
            <input type="range" min="0.5" max="10" step="0.5" bind:value={seconds} disabled={!!job} class="w-full accent-(--color-sun)" />
            <span class="mono block">
              {transition === 'crossfade' ? 'equal-power fade, so the level stays steady through the overlap' : 'a pause of pure silence between tracks'}
            </span>
          </label>
        {/if}
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={matchLoudness} disabled={!!job} />
        <span>Match loudness<span class="mono block">levels every track to about −16 LUFS, so nothing jumps out</span></span>
      </label>

      <div>
        <span class="label">format</span>
        <div class="seg" role="group" aria-label="Output format">
          {#each joinFormatList as f (f)}
            {@const blocked = formatBlocked(f)}
            <button type="button" aria-pressed={format === f} disabled={!!blocked || !!job} title={blocked || joinFormats[f].note} onclick={() => setFormat(f)}>{joinFormats[f].label}</button>
          {/each}
        </div>
        <span class="mono mt-1 block">
          {choice.note}{flacDownload ? ` · written by a one-time ${FALLBACK_DOWNLOAD_MB} MB encoder download` : ''}
        </span>
      </div>

      {#if choice.bitrates.length}
        <div>
          <span class="label">quality</span>
          <div class="seg" role="group" aria-label="Bitrate">
            {#each choice.bitrates as b (b)}
              <button type="button" aria-pressed={bitrate === b} disabled={!!job} onclick={() => (bitrate = b)}>{Math.round(b / 1000)}k</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    {#if tooLong}
      <p class="warn" role="note">
        That's over an hour of audio. The mix is built in your browser's memory (about {formatBytes(mixBytes(plan.total, layout.sampleRate, layout.channels))} here), which some
        browsers and phones can't spare. If it fails, join it in smaller batches.
      </p>
    {/if}

    {#if job}
      <div class="progress">
        <div class="bar-row">
          <div class="track"><span style:width="{job.progress * 100}%"></span></div>
          <span class="pct mono">{Math.round(job.progress * 100)}%</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="mono min-w-0 truncate" role="status">{job.status}</span>
          <span class="mono flex-none">{formatTime(elapsed, 0)}{eta !== null ? ` · ~${formatTime(eta, 0)} left` : ''}</span>
        </div>
        <button type="button" class="btn sm cancel" onclick={() => ctrl?.abort()}>Cancel</button>
      </div>
    {:else if done}
      <div class="result" role="status">
        <div class="result-head">
          <span class="joined" aria-hidden="true"><i></i><i></i></span>
          <div class="min-w-0 flex-1">
            <p class="font-serif text-[26px] leading-tight">Joined, start to finish</p>
            <p class="mono break-all">
              {done.name} · {formatTime(done.duration, 1)} · {formatBytes(done.blob.size)}
              <span class="whitespace-nowrap">(from {formatBytes(done.inputBytes)} of input)</span>
            </p>
          </div>
        </div>
        <audio src={done.url} controls preload="metadata" class="w-full" aria-label="Preview of the joined audio"></audio>
        {#each done.notes as note, n (n)}
          <p class="mono">{note}</p>
        {/each}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" bind:this={downloadBtn} onclick={() => downloadBlob(done.blob, done.name)}>Download {choice.label}</button>
          <button type="button" class="btn" onclick={startOver}>Start over</button>
        </div>
      </div>
    {:else}
      <div class="go">
        <button type="button" class="btn btn-primary" disabled={!canJoin} onclick={join}>
          {ready.length > 1 ? `Join ${ready.length} tracks` : 'Join tracks'}{flacDownload ? ` · ${FALLBACK_DOWNLOAD_MB} MB download` : ''}
        </button>
        <span class="mono">
          {#if busyTracks}
            Reading files…
          {:else if waiting.length}
            Convert or remove the files above first.
          {:else if ready.length < 2}
            Add another file to join it with this one.
          {:else}
            {choice.label}{choice.bitrates.length ? ` · ${formatBitrate(bitrate)}` : ''} · about {formatBytes(estimate)} · nothing leaves your device
          {/if}
        </span>
        <button type="button" class="btn sm ml-auto" onclick={startOver}>Start over</button>
      </div>
    {/if}
    {#if error}
      <p class="error" role="alert">{error}</p>
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
  .joiner {
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
  }
  .total {
    font-size: 40px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .btn.sm {
    padding: 9px 13px;
    font-size: 14px;
  }
  .add {
    border-style: dashed;
  }

  .notice {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid #ffd25e55;
    background: #ffd25e0d;
    font-size: 14px;
  }

  /* ---------- track list ---------- */
  .tracks {
    position: relative; /* rows' offsetParent, for hitRow() */
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
    &.seamed {
      gap: 26px;
    }
  }
  .dragging {
    cursor: grabbing;
    user-select: none;
  }
  .item {
    position: relative;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    transition: border-color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-spring);
    &.lifted {
      border-color: var(--color-sun);
      box-shadow: 0 14px 30px -12px #000c, 0 0 0 1px var(--color-sun);
      transform: scale(1.015);
      z-index: 1;
    }
    &.expanded {
      border-color: var(--color-muted);
    }
  }
  .seam {
    position: absolute;
    top: -21px;
    left: 64px;
    font-size: 11px;
    color: var(--color-audio);
    white-space: nowrap;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 66px;
    padding: 8px 10px 8px 4px;
  }
  .handle {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
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
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      background: #f2ede40d;
    }
    &:disabled {
      cursor: default;
      opacity: 0.4;
    }
  }
  .dragging .handle {
    cursor: grabbing;
  }
  .order {
    flex: none;
    width: 18px;
    text-align: right;
    font-size: 12px;
  }
  .mini {
    position: relative;
    flex: none;
    width: 112px;
    height: 40px;
    border-radius: 8px;
    overflow: hidden;
    background: #141312;
    border: 1px solid var(--color-line);
    &.loading {
      background: linear-gradient(100deg, #1a1917 30%, #26251f 50%, #1a1917 70%) 0 0 / 300% 100%;
      animation: shimmer 1.4s linear infinite;
    }
  }
  .cut {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #131211cc;
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
  .chips {
    display: flex;
    gap: 6px;
    margin-top: 3px;
  }
  .chip {
    font: 400 11px var(--font-mono);
    padding: 1px 7px;
    border-radius: 99px;
    border: 1px solid #ffd25e55;
    color: var(--color-sun);
  }
  .edit {
    flex: none;
  }
  .ctrl {
    flex: none;
    display: flex;
    gap: 2px;
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
  .panel {
    display: grid;
    gap: 14px;
    padding: 4px 14px 16px;
    border-top: 1px solid var(--color-line);
    padding-top: 14px;
    animation: arrive 0.3s ease-out;
  }
  .gain {
    display: flex;
    align-items: flex-end;
    gap: 14px;
  }
  @media (max-width: 640px) {
    .seam {
      left: 44px;
    }
    .order,
    .nudge:not(.del) {
      display: none;
    }
    .row {
      flex-wrap: wrap;
    }
    .mini {
      width: 72px;
    }
    .edit {
      order: 5;
      margin-left: 42px;
    }
  }

  /* ---------- options & action ---------- */
  .options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 28px;
    margin-top: 22px;
    padding-top: 22px;
    border-top: 1px solid var(--color-line);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    align-self: start;
    padding-top: 22px;
    & input {
      margin-top: 4px;
      accent-color: var(--color-sun);
    }
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  @media (max-width: 760px) {
    .options {
      grid-template-columns: 1fr;
    }
    .check {
      padding-top: 0;
    }
  }
  .warn {
    margin-top: 18px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ffa55255;
    background: #ffa5520d;
    font-size: 14px;
  }
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
    padding: 16px 18px;
    border-radius: 16px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pct {
    width: 40px;
    text-align: right;
    color: var(--color-chalk);
    font-variant-numeric: tabular-nums;
  }
  .track {
    flex: 1;
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: #141312;
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
    justify-self: start;
  }

  .result {
    display: grid;
    gap: 14px;
    margin-top: 22px;
    padding: 18px 20px;
    border-radius: 16px;
    border: 1px solid #9be58f55;
    background: linear-gradient(120deg, #9be58f12, transparent 60%), var(--color-panel-2);
    animation: arrive 0.4s var(--ease-spring);
  }
  .result-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  /* two sound bars that slide together into one */
  .joined {
    position: relative;
    flex: none;
    width: 52px;
    height: 40px;
    & i {
      position: absolute;
      top: 8px;
      width: 30px;
      height: 24px;
      border-radius: 99px;
      background: repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 5px);
      mask: radial-gradient(ellipse at center, #000 55%, transparent 72%);
      animation: meet 0.7s var(--ease-spring) backwards;
    }
    & i:first-child {
      left: 0;
      color: var(--color-audio);
    }
    & i:last-child {
      right: 0;
      color: var(--color-ok);
      animation-name: meet-r;
    }
  }
  @keyframes meet {
    from {
      translate: -14px 0;
      opacity: 0;
    }
  }
  @keyframes meet-r {
    from {
      translate: 14px 0;
      opacity: 0;
    }
  }

  .error {
    margin-top: 14px;
    color: var(--color-bad);
    font-size: 14px;
  }
  .errors {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b0d;
    font-size: 14px;
    & ul {
      margin: 0;
      padding-left: 18px;
    }
  }
  .link {
    flex: none;
    background: none;
    border: 0;
    padding: 2px 4px;
    color: var(--color-sun);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }
  @keyframes shimmer {
    to {
      background-position: -300% 0;
    }
  }
</style>
