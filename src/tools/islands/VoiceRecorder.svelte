<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import { FALLBACK_DOWNLOAD_MB, capabilities, containers, formatBytes, formatTime, probe, transcode, waveform, type Capabilities, type Peaks, type TranscodeOptions } from '@/engines/media';
  import { errorText } from '@/tools/lib/audio-cutter/edit';
  import { downloadBlob } from '@/tools/lib/files';
  import {
    DEFAULT_RATE,
    LOSSY_RATES,
    estimateBytes,
    exportChoices,
    exportFileName,
    isLossy,
    isTrimmed,
    nextRecordingName,
    pickAudioMime,
    recordedFormat,
    targetContainer,
    type ExportFormat,
    type RecContainer,
  } from '@/tools/lib/voice-recorder/format';
  import { RecordingClock, Trail, formatTimer, meterPosition, signalLevel, smoothLevel, toDb } from '@/tools/lib/voice-recorder/live';
  import {
    BLOCKED_TEXT,
    PROCESSING,
    ignoredProcessing,
    isPermissionError,
    micChoices,
    micConstraints,
    micErrorText,
    micSupport,
    unsupportedText,
    type DeviceChoice,
    type MicUnsupported,
    type Processing,
    type ProcessingOptions,
  } from '@/tools/lib/voice-recorder/mic';
  import { RecordingStore, isLiveElsewhere, liveRecordingIds, lockName, type StoredMeta } from '@/tools/lib/voice-recorder/store';
  import MediaJobProgress from './MediaJobProgress.svelte';

  interface Rec {
    id: string;
    name: string;
    createdAt: number;
    blob: Blob;
    url: string;
    mime: string;
    container: RecContainer;
    codec: string;
    durationSec: number;
    sampleRate?: number;
    channels?: number;
    peaks: Peaks | null;
    /** being made seekable and measured */
    finishing: boolean;
    /** WebCodecs can't decode it here, so conversions need the ffmpeg fallback */
    needsDecoder: boolean;
    /** the browser's storage holds the finished, seekable copy */
    ready: boolean;
    /** came back from this browser's storage; 'interrupted' = the tab closed mid-recording */
    restored?: 'saved' | 'interrupted';
    start: number;
    end: number;
  }

  type Phase = 'idle' | 'starting' | 'armed' | 'recording' | 'paused' | 'stopping';

  /** one waveform column per 40 ms, 4 CSS px wide: 10 s of history across 1000 px */
  const COL_MS = 40;
  const COL_W = 4;
  const uid = $props.id();

  let unsupported = $state<MicUnsupported | null>(null);
  let phase = $state<Phase>('idle');
  let permission = $state<PermissionState | 'unknown'>('unknown');
  let micError = $state('');
  let devices = $state<DeviceChoice[]>([]);
  let deviceId = $state('');
  let opts = $state<ProcessingOptions>({ noiseSuppression: true, echoCancellation: true, autoGainControl: true });
  let supported = $state<Record<Processing, boolean>>({ noiseSuppression: true, echoCancellation: true, autoGainControl: true });
  let ignored = $state<Processing[]>([]);
  let trackLabel = $state('');
  let level = $state(0);
  let peakHold = $state(0);
  let clipping = $state(false);
  let elapsed = $state(0);
  let bytes = $state(0);
  let backup = $state(false);
  let restoredCount = $state(0);
  let caps = $state.raw<Capabilities | null>(null);

  let recs = $state<Rec[]>([]);
  let selectedId = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let playingId = $state<string | null>(null);
  let playPos = $state(0);

  let format = $state<ExportFormat>('mp3');
  let bitrate = $state(DEFAULT_RATE);
  let job = $state<{ progress: number; status: string; started: number; label: string } | null>(null);
  let result = $state.raw<{ id: string; key: string; name: string; blob: Blob; url: string; durationSec: number } | null>(null);
  let exportError = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let waveW = $state(0);
  let waveH = $state(0);
  let editorAudio = $state<HTMLAudioElement | null>(null);

  // live plumbing: not reactive
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let recorder: MediaRecorder | null = null;
  let store: RecordingStore | null = null;
  let player: HTMLAudioElement | null = null;
  let controller: AbortController | null = null;
  /** background work (making recordings seekable, waveforms) stops when the page goes away */
  const life = new AbortController();
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const clock = new RecordingClock();
  const trail = new Trail(1024);
  const samples = new Float32Array(2048);

  const live = $derived(phase === 'recording' || phase === 'paused');
  const sel = $derived(recs.find((r) => r.id === selectedId) ?? null);
  const choices = $derived(sel ? exportChoices(sel.container, caps) : []);
  const fmt = $derived<ExportFormat>(choices.some((c) => c.id === format && c.ok) ? format : 'mp3');
  const trimmed = $derived(!!sel && isTrimmed(sel.start, sel.end, sel.durationSec));
  const keptSec = $derived(sel ? (trimmed ? sel.end - sel.start : sel.durationSec) : 0);
  const outExt = $derived(sel ? containers[targetContainer(fmt, sel.container)].ext : '');
  const outName = $derived(sel ? exportFileName(sel.name, outExt, trimmed) : '');
  const needsDecoder = $derived(!!sel?.needsDecoder && !(fmt === 'original' && !trimmed));
  const exportKey = $derived(sel ? JSON.stringify([sel.id, sel.blob.size, fmt, isLossy(fmt) ? bitrate : 0, trimmed ? [sel.start, sel.end] : 0]) : '');
  const stale = $derived(!!result && result.key !== exportKey);
  const estimate = $derived(
    sel
      ? estimateBytes(fmt, keptSec, {
          bitrate,
          sampleRate: sel.sampleRate,
          channels: sel.channels,
          sourceBytesPerSec: sel.durationSec ? sel.blob.size / sel.durationSec : undefined,
        })
      : 0,
  );

  onMount(() => {
    const md = navigator.mediaDevices;
    unsupported = micSupport({ secure: window.isSecureContext, userMedia: typeof md?.getUserMedia === 'function', recorder: typeof MediaRecorder !== 'undefined' });
    if (unsupported) return;
    const sc = md.getSupportedConstraints?.() ?? {};
    supported = { noiseSuppression: !!sc.noiseSuppression, echoCancellation: !!sc.echoCancellation, autoGainControl: !!sc.autoGainControl };
    capabilities().then((c) => (caps = c), () => {});
    // Firefox doesn't know the "microphone" permission name: then we simply find out on click
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((st) => {
        permission = st.state;
        if (st.state === 'granted') void refreshDevices();
        st.onchange = () => {
          permission = st.state;
          if (st.state === 'granted') void refreshDevices();
        };
      })
      .catch(() => {});
    md.addEventListener('devicechange', refreshDevices);
    addEventListener('beforeunload', guard);
    void restore();
    return () => {
      md.removeEventListener('devicechange', refreshDevices);
      removeEventListener('beforeunload', guard);
    };
  });

  onDestroy(() => {
    destroyed = true;
    controller?.abort();
    life.abort();
    // stopping saves the last chunk to the browser's storage, so the recording survives leaving the page
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    closeMic();
    void ctx?.close();
    player?.pause();
    clearTimeout(deleteTimer);
    recs.forEach((r) => URL.revokeObjectURL(r.url));
    if (result) URL.revokeObjectURL(result.url);
  });

  function guard(e: BeforeUnloadEvent) {
    if (phase !== 'recording' && phase !== 'paused') return;
    e.preventDefault();
    e.returnValue = '';
  }

  // ---------------------------------------------------------------- microphone

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      // labels only appear once the site may use the mic
      devices = list.some((d) => d.kind === 'audioinput' && d.label) ? micChoices(list) : [];
      if (deviceId && !devices.some((d) => d.id === deviceId)) deviceId = '';
    } catch {
      devices = [];
    }
  }

  async function openMic(): Promise<boolean> {
    micError = '';
    phase = 'starting';
    try {
      // made during the click, so autoplay rules don't leave it suspended
      ctx ??= new AudioContext();
      void ctx.resume();
      const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId, opts) });
      if (destroyed) {
        s.getTracks().forEach((t) => t.stop());
        return false;
      }
      stream = s;
      const track = s.getAudioTracks()[0];
      trackLabel = track?.label ?? '';
      ignored = track ? ignoredProcessing(opts, track.getSettings() as Partial<Record<Processing, unknown>>) : [];
      track?.addEventListener('ended', onTrackEnded);
      analyser ??= Object.assign(ctx.createAnalyser(), { fftSize: samples.length });
      source = ctx.createMediaStreamSource(s);
      source.connect(analyser);
      permission = 'granted';
      phase = 'armed';
      void refreshDevices();
      startLoop();
      return true;
    } catch (e) {
      micError = micErrorText(e);
      if (isPermissionError(e)) permission = 'denied';
      phase = 'idle';
      return false;
    }
  }

  function closeMic() {
    stopLoop();
    source?.disconnect();
    source = null;
    stream?.getTracks().forEach((t) => {
      t.removeEventListener('ended', onTrackEnded);
      t.stop();
    });
    stream = null;
    if (ctx?.state === 'running') void ctx.suspend();
    trackLabel = '';
    level = peakHold = 0;
    clipping = false;
    if (phase === 'armed' || phase === 'starting') phase = 'idle';
  }

  function onTrackEnded() {
    if (recorder) {
      micError = 'The microphone was disconnected, so recording stopped. Everything up to that point is saved below.';
      stop();
    } else {
      micError = 'The microphone was disconnected.';
      closeMic();
    }
  }

  /** a new device or processing option while the mic is open takes effect straight away */
  async function reopen() {
    if (phase !== 'armed') return;
    closeMic();
    await openMic();
  }

  function pickDevice(id: string) {
    deviceId = id;
    void reopen();
  }

  function toggleOption(k: Processing) {
    opts[k] = !opts[k];
    void reopen();
  }

  // ---------------------------------------------------------------- live meter & waveform

  let raf = 0;
  let lastFrame = 0;
  let lastCol = 0;
  let colPeak = 0;
  let peakAt = 0;
  let clipAt = -1e9;
  let colors: Record<'live' | 'idle' | 'line', string> | null = null;

  function startLoop() {
    cancelAnimationFrame(raf);
    lastFrame = lastCol = 0;
    raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    if (!analyser) return;
    analyser.getFloatTimeDomainData(samples);
    const { rms, peak } = signalLevel(samples);
    const dt = lastFrame ? t - lastFrame : 16;
    lastFrame = t;
    level = smoothLevel(level, meterPosition(toDb(rms)), dt);
    const p = meterPosition(toDb(peak));
    if (p >= peakHold || t - peakAt > 1200) {
      peakHold = p;
      peakAt = t;
    }
    if (peak >= 0.99) clipAt = t;
    clipping = t - clipAt < 1500;

    if (phase === 'armed' || phase === 'recording') {
      colPeak = Math.max(colPeak, p);
      // after a hidden tab or a pause, start fresh instead of replaying the gap
      if (!lastCol || t - lastCol > 1000) lastCol = t - COL_MS;
      const n = Math.floor((t - lastCol) / COL_MS);
      for (let i = 0; i < n; i++) trail.push(colPeak);
      if (n) {
        lastCol += n * COL_MS;
        colPeak = 0;
      }
    }
    if (live) elapsed = clock.elapsedMs;
    draw();
  }

  /** canvas can't read CSS variables, so let the browser resolve them once */
  function resolveColors(el: HTMLCanvasElement) {
    const read = (c: string) => {
      el.style.color = c;
      return getComputedStyle(el).color;
    };
    return { live: read('var(--color-sun, #ffd25e)'), idle: read('var(--color-muted, #9a948a)'), line: read('var(--color-line-2, #f2ede433)') };
  }

  function draw() {
    const el = canvas;
    if (!el || !waveW || !waveH) return;
    colors ??= resolveColors(el);
    const dpr = devicePixelRatio || 1;
    const W = Math.round(waveW * dpr);
    const H = Math.round(waveH * dpr);
    if (el.width !== W || el.height !== H) {
      el.width = W;
      el.height = H;
    }
    const g = el.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const mid = H / 2;
    g.fillStyle = colors.line;
    g.fillRect(0, Math.round(mid), W, Math.max(1, Math.round(dpr)));
    const col = COL_W * dpr;
    const bar = Math.max(1, Math.round(col * 0.55));
    const vals = trail.last(Math.ceil(W / col));
    g.fillStyle = phase === 'recording' ? colors.live : colors.idle;
    for (let i = 0; i < vals.length; i++) {
      const h = Math.max(dpr, vals[i] * (mid - 4 * dpr));
      const x = W - (vals.length - i) * col;
      g.beginPath();
      g.roundRect(x, mid - h, bar, h * 2, bar / 2);
      g.fill();
    }
  }

  // redraw the frozen trail when the canvas resizes with no mic open
  $effect(() => {
    void waveW;
    void waveH;
    if (!raf) draw();
  });

  // ---------------------------------------------------------------- recording

  async function record() {
    if (!stream && !(await openMic())) return;
    if (!stream) return;
    const mime = pickAudioMime((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 128_000 });
    } catch {
      micError = "This browser couldn't start recording. Try again, or try a recent Chrome, Edge, Firefox or Safari.";
      return;
    }
    const now = Date.now();
    const meta: StoredMeta = { id: crypto.randomUUID(), name: nextRecordingName(recs.map((r) => r.name)), mime: rec.mimeType || mime || 'audio/webm', createdAt: now, updatedAt: now, durationSec: 0, finished: false };
    const chunks: Blob[] = [];
    let seq = 0;
    // all chunks or none: a backup that starts late would be missing the file header
    const db = store;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      bytes += e.data.size;
      db?.addChunk(meta, seq++, e.data).catch(() => (backup = false));
    };
    // the recorder stops itself on errors; whatever it captured is kept
    rec.onerror = () => (micError = 'Recording stopped unexpectedly. What was captured so far is kept below.');
    // held while recording, so other tabs (and this one after a reload) can tell live from interrupted
    let unlock!: () => void;
    const released = new Promise<void>((done) => (unlock = done));
    navigator.locks?.request(lockName(meta.id), () => released).catch(() => {});
    rec.onstop = () => void finish(meta, chunks, rec.mimeType).finally(() => unlock());
    try {
      rec.start(1000);
    } catch {
      unlock();
      micError = "This browser couldn't start recording. Try again, or try a recent Chrome, Edge, Firefox or Safari.";
      return;
    }
    recorder = rec;
    clock.start();
    trail.clear();
    lastCol = 0;
    bytes = 0;
    elapsed = 0;
    micError = '';
    backup = !!db;
    phase = 'recording';
    db?.save(meta).catch(() => (backup = false));
  }

  function pause() {
    if (recorder?.state !== 'recording') return;
    recorder.pause();
    clock.pause();
    phase = 'paused';
  }

  function resume() {
    if (recorder?.state !== 'paused') return;
    recorder.resume();
    clock.resume();
    lastCol = 0;
    phase = 'recording';
  }

  function stop() {
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    clock.stop();
    elapsed = clock.elapsedMs;
    phase = 'stopping';
  }

  async function finish(meta: StoredMeta, chunks: Blob[], mimeType: string) {
    recorder = null;
    clock.stop();
    const durationSec = clock.elapsedMs / 1000;
    const blob = new Blob(chunks, { type: recordedFormat(mimeType || meta.mime).mime });
    if (!blob.size) {
      void store?.remove(meta.id).catch(() => {});
      if (destroyed) return;
      micError ||= 'Nothing was recorded. Check that the right microphone is selected and try again.';
      closeMic();
      phase = 'idle';
      return;
    }
    await store?.save({ ...meta, durationSec, finished: true, updatedAt: Date.now() }).catch(() => {});
    if (destroyed) return;
    // turn the mic (and the browser's recording light) off between takes
    closeMic();
    phase = 'idle';
    addRec({ ...meta, durationSec }, blob);
    // switching would cancel a save that's still running
    if (!job) select(meta.id);
    await prepare(meta.id);
  }

  function addRec(meta: StoredMeta, blob: Blob, restored?: Rec['restored']) {
    const f = recordedFormat(meta.mime);
    recs.push({
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      blob,
      url: URL.createObjectURL(blob),
      mime: f.mime,
      container: f.container,
      codec: f.codec,
      durationSec: meta.durationSec,
      sampleRate: meta.sampleRate,
      channels: meta.channels,
      peaks: meta.peaks ?? null,
      finishing: !meta.ready,
      needsDecoder: false,
      ready: !!meta.ready,
      restored,
      start: 0,
      end: meta.durationSec,
    });
  }

  /**
   * MediaRecorder files carry no duration or seek index, which makes players and the trimmer
   * stumble; a quick stream copy (no re-encoding) adds both. Then measure and draw it.
   */
  async function prepare(id: string) {
    const get = () => recs.find((x) => x.id === id);
    const signal = life.signal;
    let remuxed = false;
    try {
      const raw = get()?.blob;
      if (!raw) return;
      const info = await probe(raw, { signal });
      let r = get();
      if (!r) return;
      r.sampleRate = info.audio?.sampleRate;
      r.channels = info.audio?.channels;
      if (info.readable && info.audio?.canDecode) {
        const out = await transcode(raw, { container: r.container, video: false }, { signal });
        r = get();
        if (r && out.durationSec > 0) {
          setBlob(r, new Blob([out.blob], { type: r.mime }));
          r.durationSec = out.durationSec;
          remuxed = true;
        }
      } else {
        // no waveform either: drawing one would fetch the fallback decoder without asking
        r.needsDecoder = true;
        if (info.durationSec > 0) r.durationSec = info.durationSec;
        return;
      }
      const blob = get()?.blob;
      const peaks = blob ? await waveform(blob, 240, {}, { signal }) : null;
      r = get();
      if (r) r.peaks = peaks;
    } catch {
      // the recording as captured still plays and downloads
    } finally {
      const r = get();
      if (r && !signal.aborted) {
        r.finishing = false;
        r.start = 0;
        r.end = r.durationSec;
        // keep the seekable copy, so the next visit doesn't redo this
        if (remuxed) r.ready = true;
        const meta = metaOf(r);
        void (remuxed ? store?.replace(meta, r.blob) : store?.save(meta))?.catch(() => {});
      }
    }
  }

  function setBlob(r: Rec, blob: Blob) {
    if (playingId === r.id) stopPlayback();
    URL.revokeObjectURL(r.url);
    r.blob = blob;
    r.url = URL.createObjectURL(blob);
  }

  const metaOf = (r: Rec): StoredMeta => ({
    id: r.id,
    name: r.name,
    mime: r.mime,
    createdAt: r.createdAt,
    updatedAt: Date.now(),
    durationSec: r.durationSec,
    finished: true,
    ready: r.ready,
    sampleRate: r.sampleRate,
    channels: r.channels,
    // IndexedDB can't store Svelte's state proxies
    peaks: $state.snapshot(r.peaks),
  });

  async function restore() {
    store = await RecordingStore.open();
    if (!store || destroyed) return;
    let live = await liveRecordingIds();
    let saved = await store.list(live).catch(() => []);
    // right after a reload, the old page's lock can take a moment to be let go
    if (live && saved.some(({ meta }) => isLiveElsewhere(meta, live, Date.now()))) {
      await new Promise((r) => setTimeout(r, 1500));
      live = await liveRecordingIds();
      saved = await store.list(live).catch(() => []);
    }
    const found = saved.filter(({ meta }) => !isLiveElsewhere(meta, live, Date.now()) && !recs.some((r) => r.id === meta.id));
    if (!found.length || destroyed) return;
    for (const { meta, blob } of found) addRec(meta, blob, meta.finished ? 'saved' : 'interrupted');
    restoredCount = found.length;
    selectedId ??= found.at(-1)!.meta.id;
    for (const { meta } of found) if (!meta.ready && !destroyed) await prepare(meta.id);
  }

  // ---------------------------------------------------------------- the list

  function select(id: string) {
    if (selectedId === id) return;
    cancelExport();
    clearResult();
    exportError = '';
    selectedId = id;
  }

  function rename(r: Rec) {
    r.name = r.name.trim() || 'Recording';
    void store?.save(metaOf(r)).catch(() => {});
  }

  function askDelete(id: string) {
    clearTimeout(deleteTimer);
    if (confirmDelete !== id) {
      confirmDelete = id;
      deleteTimer = setTimeout(() => (confirmDelete = null), 4000);
      return;
    }
    confirmDelete = null;
    remove(id);
  }

  function remove(id: string) {
    const r = recs.find((x) => x.id === id);
    if (!r) return;
    if (playingId === id) stopPlayback();
    URL.revokeObjectURL(r.url);
    recs = recs.filter((x) => x.id !== id);
    void store?.remove(id).catch(() => {});
    if (selectedId === id) {
      cancelExport();
      clearResult();
      selectedId = recs.at(-1)?.id ?? null;
    }
  }

  function togglePlay(r: Rec) {
    editorAudio?.pause();
    if (playingId === r.id) return stopPlayback();
    player ??= new Audio();
    player.src = r.url;
    player.ontimeupdate = () => (playPos = r.durationSec ? player!.currentTime / r.durationSec : 0);
    player.onended = stopPlayback;
    playingId = r.id;
    playPos = 0;
    player.play().catch(stopPlayback);
  }

  function stopPlayback() {
    player?.pause();
    playingId = null;
    playPos = 0;
  }

  // ---------------------------------------------------------------- export

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function cancelExport() {
    controller?.abort();
    controller = null;
    job = null;
  }

  async function save() {
    const r = sel;
    if (!r || job) return;
    const name = outName;
    if (fmt === 'original' && !trimmed) return downloadBlob(r.blob, name);
    const key = exportKey;
    const container = targetContainer(fmt, r.container);
    const o: TranscodeOptions = {
      container,
      video: false,
      ...(trimmed ? { trim: { start: r.start, end: r.end } } : {}),
      ...(isLossy(fmt) ? { audio: { bitrate } } : {}),
    };
    clearResult();
    exportError = '';
    const ctl = (controller = new AbortController());
    job = { progress: 0, status: '', started: performance.now(), label: `Saving ${name}` };
    try {
      const out = await transcode(r.blob, o, {
        signal: ctl.signal,
        onProgress: (p) => job && controller === ctl && (job.progress = Math.max(job.progress, Math.min(1, p))),
        onStatus: (s) => job && controller === ctl && (job.status = s),
      });
      if (controller !== ctl) return;
      result = { id: r.id, key, name, blob: out.blob, url: URL.createObjectURL(out.blob), durationSec: out.durationSec };
    } catch (e) {
      if (controller === ctl) exportError = errorText(e);
    } finally {
      if (controller === ctl) {
        controller = null;
        job = null;
      }
    }
  }

  const chips = (r: Rec) => [
    r.durationSec ? formatTime(r.durationSec, 1) : 'length unknown',
    r.codec,
    ...(r.sampleRate ? [`${(r.sampleRate / 1000).toFixed(r.sampleRate % 1000 ? 1 : 0)} kHz`] : []),
    ...(r.channels ? [r.channels === 1 ? 'mono' : r.channels === 2 ? 'stereo' : `${r.channels} ch`] : []),
    formatBytes(r.blob.size),
  ];
  const short = (s: number) => (s ? formatTime(s, 0) : '–');
  const badge = $derived(
    phase === 'recording' ? 'REC' : phase === 'paused' ? 'paused' : phase === 'armed' ? 'mic on · not recording' : phase === 'starting' ? 'starting mic…' : phase === 'stopping' ? 'saving…' : 'ready',
  );
</script>

{#if unsupported}
  <div class="card p-6 grid gap-2">
    <p class="font-serif text-2xl leading-tight">Recording isn't available here</p>
    <p class="text-soft text-sm">{unsupportedText[unsupported]}</p>
  </div>
{:else}
  <div class="vr">
    <section class="deck card" aria-label="Recorder">
      <div class="setup">
        <div class="mic">
          <label class="label" for="{uid}-mic">microphone</label>
          <select id="{uid}-mic" class="field" value={deviceId} onchange={(e) => pickDevice(e.currentTarget.value)} disabled={live || phase === 'starting' || phase === 'stopping'}>
            <option value="">System default</option>
            {#each devices as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
          </select>
          <p class="mono mt-1 truncate" title={trackLabel}>
            {trackLabel ? `using ${trackLabel}` : devices.length ? `${devices.length} found` : 'the list fills in once the mic is allowed'}
          </p>
        </div>
        <div>
          <span class="label">voice processing</span>
          <div class="toggles" role="group" aria-label="Voice processing">
            {#each PROCESSING as p (p.key)}
              <button
                type="button"
                class="toggle"
                aria-pressed={opts[p.key]}
                disabled={!supported[p.key] || live || phase === 'starting' || phase === 'stopping'}
                title={supported[p.key] ? p.hint : 'Not supported in this browser'}
                onclick={() => toggleOption(p.key)}><span class="dot" aria-hidden="true"></span>{p.label}</button
              >
            {/each}
          </div>
          <p class="mono mt-1">
            {#if ignored.length}
              this mic or browser ignored: {ignored.map((k) => PROCESSING.find((p) => p.key === k)?.label).join(', ')}
            {:else}
              on for speech · turn off for music and instruments
            {/if}
          </p>
        </div>
      </div>

      <div class="screen" class:rec={phase === 'recording'}>
        <div class="screen-top">
          <span class="badge mono" class:on={phase === 'recording'}><span class="led" aria-hidden="true"></span>{badge}</span>
          <span class="mono">{live || bytes ? formatBytes(bytes) : ''}</span>
        </div>
        <div class="live" bind:clientWidth={waveW} bind:clientHeight={waveH}>
          <canvas bind:this={canvas} aria-hidden="true"></canvas>
          {#if phase === 'idle' && !trail.length}
            <p class="empty">
              {permission === 'denied' ? 'Microphone blocked' : permission === 'granted' ? 'Ready when you are' : 'Press Record and start talking'}
            </p>
          {/if}
        </div>
        <p class="timer font-serif" role="timer" aria-label="Recording time">{formatTimer(elapsed)}</p>
      </div>

      <div class="meter-row">
        <div
          class="meter"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span class="cover" style:transform="scaleX({1 - level})"></span>
          {#if peakHold > 0.01}<span class="hold" style:left="{peakHold * 100}%"></span>{/if}
        </div>
        <span class="clip mono" class:on={clipping}>{clipping ? 'too loud' : 'level'}</span>
      </div>
      <div class="scale mono" aria-hidden="true">
        {#each [-60, -40, -20, -6, 0] as db (db)}<span style:left="{meterPosition(db) * 100}%">{db}</span>{/each}
      </div>

      <div class="controls">
        {#if live || phase === 'stopping'}
          <button type="button" class="ctl" onclick={phase === 'paused' ? resume : pause} disabled={phase === 'stopping'}>
            {#if phase === 'paused'}
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="var(--color-bad)" /></svg>Resume
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>Pause
            {/if}
          </button>
          <button type="button" class="big stop" onclick={stop} disabled={phase === 'stopping'} aria-label="Stop and save">
            <span class="square" aria-hidden="true"></span>
          </button>
          <span class="ctl-label mono">{phase === 'stopping' ? 'saving…' : 'stop'}</span>
        {:else}
          <button type="button" class="ctl" onclick={phase === 'armed' ? closeMic : openMic} disabled={phase === 'starting'}>
            {phase === 'armed' ? 'Mic off' : 'Test mic'}
          </button>
          <button type="button" class="big" onclick={record} disabled={phase === 'starting'} aria-label="Start recording">
            <span class="core" aria-hidden="true"></span>
          </button>
          <span class="ctl-label mono">{phase === 'starting' ? 'allow the mic…' : 'record'}</span>
        {/if}
      </div>

      {#if micError}
        <p class="err" role="alert">{micError}</p>
      {:else if permission === 'denied' && !live}
        <p class="err" role="alert">{BLOCKED_TEXT}</p>
      {/if}
      {#if live}
        <p class="mono text-center">{backup ? 'saved to this browser every second, so a reload or crash won’t lose it' : 'keep this tab open until you press stop'}</p>
      {/if}
    </section>

    {#if recs.length}
      <div class="lower">
        <section class="list" aria-label="Your recordings">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="text-2xl">Recordings</h2>
            <span class="mono">{recs.length}</span>
          </div>
          <p class="mono">
            {restoredCount ? `${restoredCount} restored from your last visit · ` : ''}kept in this browser until you delete them, never uploaded
          </p>
          <ul>
            {#each recs as r (r.id)}
              <li class="row" class:active={r.id === selectedId}>
                <button type="button" class="play" onclick={() => togglePlay(r)} aria-label="{playingId === r.id ? 'Pause' : 'Play'} {r.name}">
                  {#if playingId === r.id}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
                  {/if}
                </button>
                <button type="button" class="pick" onclick={() => select(r.id)} aria-current={r.id === selectedId}>
                  <span class="title">{r.name}</span>
                  <span class="mono">
                    {short(r.durationSec)} · {formatBytes(r.blob.size)}{r.restored === 'interrupted' ? ' · recovered' : ''}{r.finishing ? ' · finishing…' : ''}
                  </span>
                  <span class="mini"><Waveform peaks={r.peaks} progress={playingId === r.id ? playPos : 0} /></span>
                </button>
                <button type="button" class="del" class:confirm={confirmDelete === r.id} onclick={() => askDelete(r.id)} aria-label={confirmDelete === r.id ? `Confirm deleting ${r.name}` : `Delete ${r.name}`}>
                  {#if confirmDelete === r.id}
                    delete?
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>

        {#if sel}
          <section class="editor card" aria-label="Edit and save {sel.name}">
            <div>
              <label class="sr-only" for="{uid}-name">Recording name</label>
              <input id="{uid}-name" class="name" bind:value={sel.name} onchange={() => rename(sel)} maxlength="80" spellcheck="false" />
              <p class="chips">{#each chips(sel) as c}<span class="mono">{c}</span>{/each}</p>
              {#if sel.restored === 'interrupted'}
                <p class="mono mt-1">Recovered after the page closed mid-recording; the last second or so may be missing.</p>
              {/if}
            </div>

            <audio bind:this={editorAudio} src={sel.url} controls preload="metadata" class="player" aria-label="Play {sel.name}" onplay={() => playingId && stopPlayback()}></audio>

            {#if sel.finishing}
              <p class="mono" aria-live="polite">finishing the recording…</p>
            {:else if sel.durationSec > 0}
              {#key sel.id}
                <TrimTimeline file={sel.needsDecoder ? null : sel.blob} peaks={sel.needsDecoder ? sel.peaks : undefined} kind="audio" duration={sel.durationSec} media={editorAudio} step={0.01} bind:start={sel.start} bind:end={sel.end} disabled={!!job} />
              {/key}
              <p class="mono">Drag the handles to cut silence or mistakes from the start and end. The original recording stays as it is.</p>
            {/if}

            <div class="save">
              <div>
                <span class="label">save as</span>
                <div class="seg" role="group" aria-label="File format">
                  {#each choices as c (c.id)}
                    <button type="button" aria-pressed={fmt === c.id} disabled={!c.ok || !!job} title={c.note} onclick={() => (format = c.id)}>{c.label}</button>
                  {/each}
                </div>
                {#each choices.filter((c) => !c.ok && c.note && caps) as c (c.id)}
                  <p class="mono mt-1">{c.label}: {c.note}</p>
                {/each}
              </div>
              {#if isLossy(fmt)}
                <div>
                  <span class="label">quality</span>
                  <div class="seg" role="group" aria-label="Bitrate">
                    {#each LOSSY_RATES as rate (rate)}
                      <button type="button" aria-pressed={bitrate === rate} disabled={!!job} onclick={() => (bitrate = rate)}>{rate / 1000} kbps</button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>

            {#if needsDecoder && !job}
              <p class="note">
                Your browser can't decode this recording by itself, so saving it in another format uses a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download. It's cached afterwards, and
                the audio still never leaves your device.
              </p>
            {/if}

            {#if job}
              <div class="card p-4">
                <MediaJobProgress progress={job.progress} startedAt={job.started} label={job.label} status={job.status} oncancel={cancelExport} />
              </div>
            {:else}
              <div class="go">
                <button type="button" class="btn btn-primary" onclick={save} disabled={sel.finishing}>
                  {fmt === 'original' && !trimmed ? `Download ${outExt.toUpperCase()}` : needsDecoder ? `Get decoder & save ${outExt.toUpperCase()}` : `Save as ${outExt.toUpperCase()}`}
                </button>
                <span class="mono">
                  {fmt === 'original' && !trimmed
                    ? `${formatBytes(sel.blob.size)} · exactly as recorded`
                    : `${trimmed ? `${formatTime(keptSec, 1)} selected · ` : ''}about ${formatBytes(estimate)}`}
                </span>
              </div>
            {/if}

            {#if exportError}<p class="err" role="alert">{exportError}</p>{/if}

            {#if result && result.id === sel.id}
              <div class="result" class:stale>
                <div class="flex items-center gap-3">
                  <svg class="tick" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" /><path d="M9.5 16.5l4.5 4.5 8.5-9" /></svg>
                  <div class="min-w-0">
                    <p class="font-serif text-2xl leading-tight">{stale ? 'Settings changed' : 'Ready'}</p>
                    <p class="mono truncate">{stale ? 'save again to update · this is the previous file' : result.name}</p>
                  </div>
                </div>
                <audio src={result.url} controls class="player" aria-label="Play the saved file"></audio>
                <p class="stats mono">
                  <span>{formatTime(result.durationSec, 1)}</span>
                  <span>recording {formatBytes(sel.blob.size)} → <b>{formatBytes(result.blob.size)}</b></span>
                </p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn btn-primary" onclick={() => result && downloadBlob(result.blob, result.name)}>Download</button>
                  <button type="button" class="btn" onclick={clearResult}>Done</button>
                </div>
              </div>
            {/if}
            <p class="sr-only" aria-live="polite">{result && !stale ? `${result.name} is ready to download.` : ''}</p>
          </section>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .vr {
    display: grid;
    gap: 18px;
    container-type: inline-size;
  }
  .deck {
    display: grid;
    gap: 16px;
    padding: 18px;
  }
  .setup {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px 24px;
    align-items: start;
  }
  @container (max-width: 720px) {
    .setup {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  select.field {
    padding-block: 9px;
  }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 400 13px var(--font-mono);
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-line-2);
    border-radius: 99px;
    padding: 8px 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    & .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1px solid currentColor;
      transition: background 0.2s;
    }
    &[aria-pressed='true'] {
      color: var(--color-chalk);
      border-color: var(--color-muted);
      & .dot {
        background: var(--color-sun);
        border-color: var(--color-sun);
      }
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  .screen {
    position: relative;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background:
      linear-gradient(var(--color-line) 1px, transparent 1px) 0 0 / 24px 24px,
      linear-gradient(90deg, var(--color-line) 1px, transparent 1px) 0 0 / 24px 24px,
      #100f0e;
    padding: 12px 14px 14px;
    transition: border-color 0.3s;
    &.rec {
      border-color: #ff7a6b66;
    }
  }
  .screen-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    & .led {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-muted);
    }
    &.on {
      color: var(--color-bad);
      & .led {
        background: var(--color-bad);
        animation: blink 1.2s ease-in-out infinite;
      }
    }
  }
  .live {
    position: relative;
    height: 132px;
    margin-top: 6px;
    & canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      /* older columns fade out to the left */
      mask-image: linear-gradient(90deg, transparent, #000 22%);
    }
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 400 22px var(--font-serif);
    color: var(--color-muted);
  }
  .timer {
    font-size: clamp(40px, 9cqi, 60px);
    line-height: 1;
    text-align: center;
    font-variant-numeric: tabular-nums;
    margin-top: 4px;
  }

  .meter-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .meter {
    position: relative;
    flex: 1;
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: linear-gradient(90deg, var(--color-ok) 0 70%, var(--color-sun) 80%, var(--color-bad) 95%);
    outline: 1px solid var(--color-line);
    & .cover {
      position: absolute;
      inset: 0;
      background: var(--color-panel-2);
      transform-origin: right;
    }
    & .hold {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      margin-left: -1px;
      background: var(--color-chalk);
    }
  }
  .clip {
    width: 64px;
    text-align: right;
    &.on {
      color: var(--color-bad);
    }
  }
  .scale {
    position: relative;
    height: 14px;
    margin: -12px 76px 0 0;
    font-size: 11px;
    & span {
      position: absolute;
      transform: translateX(-50%);
    }
    & span:first-child {
      transform: none;
    }
    & span:last-child {
      transform: translateX(-100%);
    }
  }

  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 6px 16px;
    & .ctl {
      justify-self: end;
    }
    & .ctl-label {
      grid-column: 2;
      text-align: center;
    }
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 500 14px var(--font-sans);
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 99px;
    padding: 9px 16px;
    cursor: pointer;
    & svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
  .big {
    grid-column: 2;
    grid-row: 1;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    border: 2px solid var(--color-chalk);
    background: #100f0e;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.25s var(--ease-spring), box-shadow 0.3s;
    &:hover {
      box-shadow: 0 0 0 6px #ff7a6b22;
    }
    &:active {
      transform: scale(0.94);
    }
    &:disabled {
      opacity: 0.5;
      cursor: progress;
    }
    & .core {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--color-bad);
      transition: transform 0.25s var(--ease-spring);
    }
    &:hover .core {
      transform: scale(1.08);
    }
    &.stop {
      border-color: var(--color-bad);
      animation: pulse 1.6s ease-out infinite;
    }
    & .square {
      width: 24px;
      height: 24px;
      border-radius: 5px;
      background: var(--color-chalk);
    }
  }
  .controls > .ctl:first-child {
    grid-column: 1;
    grid-row: 1;
  }

  .err {
    color: var(--color-bad);
    font-size: 14.5px;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    border-left: 2px solid var(--color-sun);
    padding-left: 12px;
  }

  .lower {
    display: grid;
    gap: 18px;
    align-items: start;
  }
  @container (min-width: 860px) {
    .lower {
      grid-template-columns: 300px minmax(0, 1fr);
    }
  }
  .list {
    display: grid;
    gap: 8px;
    & ul {
      display: grid;
      gap: 8px;
      margin-top: 6px;
    }
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel);
    animation: rise 0.45s var(--ease-spring);
    transition: border-color 0.2s;
    &.active {
      border-color: var(--color-sun);
    }
  }
  .play,
  .del {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-chalk);
    cursor: pointer;
    & svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
  }
  .del {
    border-color: transparent;
    background: transparent;
    color: var(--color-muted);
    font: 400 12px var(--font-mono);
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    &:hover {
      color: var(--color-bad);
    }
    &.confirm {
      width: auto;
      padding: 0 10px;
      border-radius: 99px;
      color: var(--color-bad);
      border-color: #ff7a6b66;
    }
  }
  .pick {
    display: grid;
    gap: 2px;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    color: inherit;
    padding: 4px 8px;
    border-radius: 10px;
    cursor: pointer;
    & .title {
      font-size: 15px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    & .mini {
      display: block;
      height: 24px;
      margin-top: 2px;
    }
  }

  .editor {
    display: grid;
    gap: 16px;
    padding: 18px;
    min-width: 0;
  }
  .name {
    width: 100%;
    font: 400 28px/1.15 var(--font-serif);
    color: var(--color-chalk);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 2px 8px;
    margin-left: -9px;
    &:hover {
      border-color: var(--color-line-2);
    }
    &:focus {
      outline: none;
      border-color: var(--color-sun);
    }
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 2px;
  }
  .player {
    width: 100%;
    height: 40px;
    color-scheme: dark;
  }
  .save {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    & .btn {
      min-width: 180px;
    }
  }
  .result {
    display: grid;
    gap: 14px;
    padding: 16px;
    border: 1px solid #9be58f55;
    border-radius: 14px;
    background: var(--color-panel-2);
    animation: rise 0.45s var(--ease-spring);
    &.stale {
      border-color: var(--color-line-2);
      & .tick {
        opacity: 0.35;
      }
    }
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    & b {
      font-weight: 500;
      color: var(--color-ok);
    }
  }
  .tick {
    width: 40px;
    height: 40px;
    flex: none;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 88;
      stroke-dashoffset: 88;
      animation: draw 0.6s ease-out forwards;
    }
    & path {
      stroke-dasharray: 22;
      stroke-dashoffset: 22;
      animation: draw 0.35s 0.45s ease-out forwards;
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
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 #ff7a6b55;
    }
    100% {
      box-shadow: 0 0 0 14px #ff7a6b00;
    }
  }
</style>
