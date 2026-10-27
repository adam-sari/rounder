<script module lang="ts">
  import type { MediaInfo, StatusControl } from '@/engines/media';

  export interface AudioSource {
    /** what the person dropped in; names the download */
    file: File;
    /** what gets edited: the file itself, or a WAV copy made by the fallback decoder */
    blob: Blob;
    info: MediaInfo;
    converted: boolean;
  }
  export interface AudioOutput {
    blob: Blob;
    name: string;
    /** a copy the <audio> element can play, if `blob` carries an unusual MIME type */
    preview?: Blob;
    durationSec: number;
    note?: string;
  }
  /** snapshots the settings and returns the export job */
  export type AudioJob = (ctl: StatusControl) => Promise<AudioOutput>;
</script>

<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { FALLBACK_DOWNLOAD_MB, audioCodecLabel, formatBitrate, formatBytes, formatTime, preloadFallback, probe, transcode, type AudioCodec } from '@/engines/media';
  import { errorText, etaSeconds } from '@/tools/lib/audio-cutter/edit';
  import { downloadBlob } from '@/tools/lib/files';

  interface Props {
    /** primary button, e.g. "Cut audio" */
    action: string;
    /** serialized settings: a result made with other settings is out of date */
    settingsKey: string;
    /** why the export can't run yet */
    blocker?: string;
    /** a line under the export button (estimated size, "no re-encoding"…) */
    hint?: string;
    begin: (src: AudioSource) => AudioJob;
    /** timeline and settings, once a file is loaded */
    editor: Snippet<[AudioSource, HTMLAudioElement | null]>;
    /** extra content under a finished result */
    done?: Snippet<[AudioOutput]>;
    onsource?: (src: AudioSource | null) => void;
  }

  let { action, settingsKey, blocker = '', hint = '', begin, editor, done, onsource }: Props = $props();

  const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.m4r,.aac,.wav,.ogg,.oga,.opus,.flac,.wma,.amr,.aif,.aiff,.mka,.mkv,.webm';

  let source = $state.raw<AudioSource | null>(null);
  /** a file only the fallback decoder can read, waiting for the go-ahead */
  let pending = $state.raw<{ file: File; info: MediaInfo } | null>(null);
  let probing = $state(false);
  let error = $state('');
  let url = $state('');
  let audioEl = $state<HTMLAudioElement | null>(null);
  let cantPlay = $state(false);

  let job = $state<{ label: string; progress: number; status: string; started: number } | null>(null);
  let now = $state(0);
  let controller: AbortController | null = null;
  let result = $state.raw<(AudioOutput & { url: string; key: string }) | null>(null);

  const elapsed = $derived(job ? Math.max(0, (now - job.started) / 1000) : 0);
  const eta = $derived(job ? etaSeconds(job.progress, elapsed) : null);
  const stale = $derived(!!result && result.key !== settingsKey);

  $effect(() => {
    if (!job) return;
    now = performance.now();
    const t = setInterval(() => (now = performance.now()), 250);
    return () => clearInterval(t);
  });

  function setSource(s: AudioSource | null) {
    if (url) URL.revokeObjectURL(url);
    url = s ? URL.createObjectURL(s.blob) : '';
    cantPlay = false;
    source = s;
    onsource?.(s);
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  let opens = 0;
  async function open(files: File[]) {
    const file = files[0];
    const id = ++opens;
    cancel();
    clearResult();
    setSource(null);
    pending = null;
    error = '';
    probing = true;
    try {
      const info = await probe(file);
      if (id !== opens) return;
      // only the sound matters here: a video codec the browser can't decode doesn't need the fallback
      if (info.readable && !info.audio) error = "This file doesn't have an audio track.";
      else if (!info.readable || !info.audio?.canDecode) pending = { file, info };
      else setSource({ file, blob: file, info, converted: false });
    } catch (e) {
      if (id === opens) error = errorText(e);
    } finally {
      if (id === opens) probing = false;
    }
  }

  /** runs a job with progress, cancel and friendly errors; resolves undefined on failure */
  async function run<T>(label: string, fn: (ctl: StatusControl) => Promise<T>): Promise<T | undefined> {
    controller = new AbortController();
    const ctl = controller;
    job = { label, progress: 0, status: '', started: performance.now() };
    error = '';
    try {
      return await fn({
        signal: ctl.signal,
        onProgress: (p) => job && controller === ctl && (job.progress = Math.max(job.progress, Math.min(1, p))),
        onStatus: (s) => job && controller === ctl && (job.status = s),
      });
    } catch (e) {
      if (controller === ctl) error = errorText(e);
    } finally {
      if (controller === ctl) {
        job = null;
        controller = null;
      }
    }
  }

  function cancel() {
    controller?.abort();
    controller = null;
    job = null;
  }

  async function decodeWithFallback() {
    if (!pending) return;
    const { file, info } = pending;
    const out = await run('Preparing file', async (ctl) => {
      // the download is the slow, one-off part: give it its own share of the bar
      await preloadFallback((p) => {
        ctl.onStatus?.(`Downloading decoder… ${Math.round(p * 100)}%`);
        ctl.onProgress?.(p * 0.4);
      });
      // straight to WAV in ffmpeg: the default route would first remux (and maybe re-encode) the video
      const wav = await transcode(file, { container: 'wav', video: false }, { ...ctl, engine: 'ffmpeg', onProgress: (p) => ctl.onProgress?.(0.4 + p * 0.6) });
      return { wav: wav.blob, info: await probe(wav.blob, { signal: ctl.signal }) };
    });
    if (!out) return;
    pending = null;
    if (!out.info.audio) error = "This file doesn't have an audio track.";
    else setSource({ file, blob: out.wav, info: { ...out.info, sizeBytes: info.sizeBytes }, converted: true });
  }

  async function exportNow() {
    if (!source || blocker) return;
    const key = settingsKey;
    const jobFn = begin(source);
    clearResult();
    const out = await run(action, jobFn);
    if (out) result = { ...out, url: URL.createObjectURL(out.preview ?? out.blob), key };
  }

  function startOver() {
    opens++;
    probing = false;
    cancel();
    clearResult();
    setSource(null);
    pending = null;
    error = '';
  }

  onDestroy(() => {
    opens++;
    controller?.abort();
    if (url) URL.revokeObjectURL(url);
    if (result) URL.revokeObjectURL(result.url);
  });

  const codecName = (c: string | null | undefined) => (c ? (audioCodecLabel[c as AudioCodec] ?? c.toUpperCase()) : 'unknown codec');
  const channelName = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} ch`);
  const chips = $derived.by(() => {
    const i = source?.info;
    if (!i?.audio) return [];
    const a = i.audio;
    return [
      formatTime(i.durationSec),
      source!.converted ? `${codecName(a.codec)} (converted)` : codecName(a.codec),
      `${(a.sampleRate / 1000).toFixed(a.sampleRate % 1000 ? 1 : 0)} kHz`,
      channelName(a.channels),
      ...(a.bitrate ? [formatBitrate(a.bitrate)] : []),
      formatBytes(source!.file.size),
    ];
  });
  const fmtSec = (s: number) => (s < 60 ? `${Math.round(s)} s` : formatTime(s, 0));
</script>

<div class="shell">
  {#if !source && !pending}
    <Dropzone accept={ACCEPT} title="Drop an audio file" hint="MP3, M4A, WAV, OGG, FLAC… or a video" onfiles={open} />
    {#if probing}<p class="mono mt-3" aria-live="polite">reading file…</p>{/if}
  {:else if pending && !source}
    <div class="card p-5 grid gap-3">
      <p class="font-serif text-2xl leading-tight">This format needs an extra decoder</p>
      <p class="text-soft text-sm">
        Your browser can't read <b class="text-chalk">{pending.file.name}</b>{pending.info.container !== 'unknown' ? ` (${pending.info.container.toUpperCase()})` : ''} by itself. We can convert it on your device with a
        one-time {FALLBACK_DOWNLOAD_MB} MB decoder download. It's cached afterwards, and your file still never leaves your device.
      </p>
      {#if !job}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" onclick={decodeWithFallback}>Download decoder &amp; open</button>
          <button type="button" class="btn" onclick={startOver}>Choose another file</button>
        </div>
      {/if}
    </div>
  {:else if source}
    <div class="head">
      <div class="min-w-0">
        <p class="name" title={source.file.name}>{source.file.name}</p>
        <p class="chips">
          {#each chips as c}<span class="mono">{c}</span>{/each}
        </p>
      </div>
      <button type="button" class="btn small" onclick={startOver} disabled={!!job}>Change file</button>
    </div>

    <audio bind:this={audioEl} src={url} controls preload="metadata" class="player" onerror={() => (cantPlay = true)} aria-label="Original audio"></audio>
    {#if cantPlay}
      <p class="mono">Your browser can't play this format, so there's no live preview. Processing and downloads still work.</p>
    {/if}

    {@render editor(source, audioEl)}

    {#if !job}
      <div class="go">
        <button type="button" class="btn btn-primary" onclick={exportNow} disabled={!!blocker}>{result && !stale ? `${action} again` : action}</button>
        <span class="mono">{blocker || hint}</span>
      </div>
    {/if}
  {/if}

  {#if job}
    <div class="job card" role="group" aria-label={job.label}>
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm">{job.status || `${job.label}…`}</span>
        <span class="mono tabular-nums">{Math.round(job.progress * 100)}%</span>
      </div>
      <div class="track" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
        <span class="fill" style:transform={`scaleX(${job.progress})`}></span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="mono tabular-nums">{fmtSec(elapsed)} elapsed{eta !== null ? ` · about ${fmtSec(eta)} left` : ''}</span>
        <button type="button" class="btn small" onclick={cancel}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="err" role="alert">{error}</p>
  {/if}

  {#if result && source}
    <div class="result card" class:stale>
      <div class="flex items-center gap-3">
        <svg class="tick" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" /><path d="M9.5 16.5l4.5 4.5 8.5-9" /></svg>
        <div class="min-w-0">
          <p class="font-serif text-2xl leading-tight">{stale ? 'Settings changed' : 'Ready'}</p>
          <p class="mono">{stale ? `press "${action}" to update · this is the previous result` : result.name}</p>
        </div>
      </div>
      <audio src={result.url} controls class="player" aria-label="Result"></audio>
      <p class="stats mono">
        <span>{formatTime(result.durationSec)}</span>
        <span>{formatBytes(source.file.size)} → <b>{formatBytes(result.blob.size)}</b></span>
        {#if result.note}<span>{result.note}</span>{/if}
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob, result!.name)}>Download</button>
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
      {@render done?.(result)}
    </div>
  {/if}

  <p class="sr-only" aria-live="polite">{job ? '' : result && !stale ? `${result.name} is ready to download.` : ''}</p>
</div>

<style>
  .shell {
    display: grid;
    gap: 18px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .name {
    font: 400 26px/1.15 var(--font-serif);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 4px;
  }
  .small {
    padding: 8px 12px;
    font-size: 13.5px;
    flex: none;
  }
  .player {
    width: 100%;
    height: 40px;
    color-scheme: dark;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding-top: 4px;
    & .btn {
      min-width: 180px;
    }
  }
  .job {
    display: grid;
    gap: 12px;
    padding: 18px;
  }
  .track {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    outline: 1px solid var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, #ffd25e99, var(--color-sun));
    transition: transform 0.3s ease-out;
  }
  .err {
    color: var(--color-bad);
    font-size: 14.5px;
  }
  .result {
    display: grid;
    gap: 14px;
    padding: 18px;
    border-color: #9be58f55;
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
</style>
