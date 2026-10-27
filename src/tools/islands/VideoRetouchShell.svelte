<script lang="ts" module>
  import type { MediaInfo } from '@/engines/media/types';
  import type { VideoContainer } from '@/tools/lib/video-retouch/job';

  /** a file the browser can decode, ready for the tool to preview and process */
  export interface RetouchSource {
    file: Blob;
    name: string;
    info: MediaInfo;
    url: string;
  }

  export interface RetouchJob {
    source: RetouchSource;
    container: VideoContainer;
    signal: AbortSignal;
    onProgress: (p: number) => void;
    onStatus: (s: string) => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { capabilities, containers, ensureDecodable, FALLBACK_DOWNLOAD_MB, probe, type Capabilities, type Container, type TranscodeResult } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import { clock, containerBlock, defaultContainer, errorText, eta, infoChips, sizeChange, VIDEO_ACCEPT, VIDEO_CONTAINERS } from '@/tools/lib/video-retouch/job';

  interface Props {
    /** primary button text, e.g. "Rotate video" */
    action: string;
    /** why the button is disabled, or null when the job can run */
    blocked?: string | null;
    editor: Snippet<[RetouchSource]>;
    run: (job: RetouchJob) => Promise<TranscodeResult>;
    outputName: (name: string, container: Container) => string;
    /** called with each new file so the tool can reset its settings */
    onsource?: (source: RetouchSource) => void;
  }

  let { action, blocked = null, editor, run, outputName, onsource }: Props = $props();

  type Phase = 'empty' | 'probing' | 'fallback' | 'decoding' | 'ready' | 'running' | 'done' | 'error';
  let phase = $state<Phase>('empty');
  let original = $state.raw<File | null>(null);
  let pending = $state.raw<MediaInfo | null>(null);
  let source = $state.raw<RetouchSource | null>(null);
  let caps = $state.raw<Capabilities | null>(null);
  let container = $state<VideoContainer>('mp4');
  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let result = $state.raw<{ res: TranscodeResult; url: string } | null>(null);
  let error = $state('');
  let ctrl: AbortController | null = null;

  const elapsedMs = $derived(Math.max(0, now - startedAt));
  const left = $derived(eta(elapsedMs, progress));
  const fallbackOnly = $derived(!!caps && !caps.webCodecs.videoEncoder);

  function revoke() {
    if (source) URL.revokeObjectURL(source.url);
    if (result) URL.revokeObjectURL(result.url);
    source = null;
    result = null;
  }

  function startOver() {
    // dropping ctrl first means the aborted job can't move the phase back once it settles
    ctrl?.abort();
    ctrl = null;
    revoke();
    original = null;
    pending = null;
    phase = 'empty';
  }

  $effect(() => () => {
    ctrl?.abort();
    revoke();
  });

  function fail(e: unknown, back: Phase) {
    const text = errorText(e);
    if (text === null) {
      phase = back;
      return;
    }
    error = text;
    phase = 'error';
  }

  async function load(file: File) {
    startOver();
    original = file;
    phase = 'probing';
    const job = (ctrl = new AbortController());
    try {
      caps ??= await capabilities().catch(() => null);
      const info = await probe(file, { signal: job.signal });
      if (job !== ctrl) return;
      if (info.needsFallback) {
        pending = info;
        phase = 'fallback';
      } else ready(file, info);
    } catch (e) {
      if (job === ctrl) fail(e, 'empty');
    }
  }

  async function decodeWithFallback() {
    if (!original) return;
    phase = 'decoding';
    progress = 0;
    status = `Downloading the decoder (${FALLBACK_DOWNLOAD_MB} MB)…`;
    const job = (ctrl = new AbortController());
    try {
      const out = await ensureDecodable(original, { signal: job.signal, onStatus: (s) => (status = s), onProgress: (p) => (progress = p) });
      // the converted copy is Matroska; the default format should follow the file the user dropped
      if (job === ctrl) ready(out.file, out.info, pending?.container);
    } catch (e) {
      if (job === ctrl) fail(e, 'fallback');
    }
  }

  function ready(file: Blob, info: MediaInfo, inputContainer = info.container) {
    if (!info.video) {
      error = "This file doesn't contain any video. Drop in a video file instead.";
      phase = 'error';
      return;
    }
    source = { file, name: original?.name ?? 'video', info, url: URL.createObjectURL(file) };
    container = defaultContainer(inputContainer, caps);
    onsource?.(source);
    phase = 'ready';
  }

  async function start() {
    if (!source || blocked) return;
    phase = 'running';
    progress = 0;
    status = 'Starting…';
    startedAt = now = performance.now();
    const tick = setInterval(() => (now = performance.now()), 250);
    const job = (ctrl = new AbortController());
    try {
      const res = await run({ source, container, signal: job.signal, onProgress: (p) => (progress = Math.max(progress, Math.min(1, p))), onStatus: (s) => (status = s) });
      if (job !== ctrl) return;
      result = { res, url: URL.createObjectURL(res.blob) };
      now = performance.now();
      progress = 1;
      phase = 'done';
    } catch (e) {
      if (job === ctrl) fail(e, 'ready');
    } finally {
      clearInterval(tick);
      if (job === ctrl) ctrl = null;
    }
  }

  function again() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
    phase = source ? 'ready' : 'empty';
  }

  const chips = $derived(source ? infoChips(source.info) : pending?.readable ? infoChips(pending) : []);
  const change = $derived(result && original ? sizeChange(original.size, result.res.blob.size) : null);
</script>

{#if phase === 'empty'}
  <Dropzone accept={VIDEO_ACCEPT} title="Drop a video here" hint="MP4, MOV, WebM, MKV, AVI and more" onfiles={([f]) => load(f)} />
{:else}
  <div class="grid gap-4">
    <header class="head">
      <div class="min-w-0">
        <p class="name" title={original?.name}>{original?.name}</p>
        {#if chips.length}
          <ul class="chips mono" aria-label="File details">
            {#each chips as chip}<li>{chip}</li>{/each}
          </ul>
        {/if}
      </div>
      <button type="button" class="btn shrink-0" onclick={startOver} disabled={phase === 'running'}>Change file</button>
    </header>

    {#if phase === 'probing'}
      <div class="panel center mono" aria-busy="true">Reading the file…</div>
    {:else if phase === 'fallback'}
      <div class="panel grid gap-3">
        <p class="font-serif text-2xl leading-tight">This one needs an extra decoder</p>
        <p class="text-soft">
          Your browser can't read this {pending?.container && pending.container !== 'unknown' ? pending.container.toUpperCase() : ''} file on its own. We can convert it right here on your
          device with a fallback decoder, which is a one-time download of about {FALLBACK_DOWNLOAD_MB} MB. The video itself still never leaves your device.
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" onclick={decodeWithFallback}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB) and continue</button>
          <button type="button" class="btn" onclick={startOver}>Choose another file</button>
        </div>
      </div>
    {:else if phase === 'decoding'}
      <div class="panel grid gap-3" aria-live="polite">
        <p class="mono">{status}</p>
        <div class="bar" role="progressbar" aria-label="Preparing the file" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
          <span style="width:{progress * 100}%"></span>
        </div>
        <div><button type="button" class="btn" onclick={() => ctrl?.abort()}>Cancel</button></div>
      </div>
    {:else if phase === 'error'}
      <div class="panel grid gap-3" role="alert">
        <p class="text-bad">{error}</p>
        <div class="flex flex-wrap gap-2">
          {#if source}<button type="button" class="btn" onclick={() => (phase = 'ready')}>Back to settings</button>{/if}
          <button type="button" class="btn" onclick={startOver}>Start over</button>
        </div>
      </div>
    {:else if source && result && phase === 'done'}
      <div class="panel done grid gap-4">
        <div class="flex items-center gap-3">
          <svg class="tick" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" /><path d="M12 20.5l5.5 5.5L28.5 14.5" /></svg>
          <div>
            <p class="font-serif text-2xl leading-tight">Done in {clock(elapsedMs / 1000)}</p>
            {#if change}<p class="mono {change.smaller ? 'text-ok!' : ''}">{change.text}</p>{/if}
          </div>
        </div>
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="result" src={result.url} controls playsinline aria-label="Your finished video"></video>
        <p class="mono">
          {containers[result.res.container].label}{result.res.width ? ` · ${result.res.width}×${result.res.height}` : ''} · {clock(result.res.durationSec)}
        </p>
        {#if result.res.notes.length}
          <ul class="notes mono">
            {#each result.res.notes as note}<li>{note}</li>{/each}
          </ul>
        {/if}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary" onclick={() => result && source && downloadBlob(result.res.blob, outputName(source.name, result.res.container))}>
            Download {containers[result.res.container].label}
          </button>
          <button type="button" class="btn" onclick={again}>Adjust and save again</button>
          <button type="button" class="btn" onclick={startOver}>Start over</button>
        </div>
      </div>
    {:else if source}
      <div class="editor" class:busy={phase === 'running'} inert={phase === 'running'}>
        {@render editor(source)}
      </div>

      {#if phase === 'running'}
        <div class="panel grid gap-3" aria-live="polite">
          <div class="flex items-baseline justify-between gap-3">
            <p class="mono">{status}</p>
            <p class="pct">{Math.floor(progress * 100)}%</p>
          </div>
          <div class="bar" role="progressbar" aria-label="Processing" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.floor(progress * 100)}>
            <span style="width:{progress * 100}%"></span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="mono">{clock(elapsedMs / 1000)} elapsed{left !== null ? ` · about ${clock(left)} left` : ''}</p>
            <button type="button" class="btn" onclick={() => ctrl?.abort()}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="foot">
          <div>
            <span class="label" id="retouch-format">save as</span>
            <div class="seg" role="group" aria-labelledby="retouch-format">
              {#each VIDEO_CONTAINERS as c}
                {@const why = containerBlock(c, caps)}
                <button type="button" aria-pressed={container === c} disabled={!!why} title={why ?? undefined} onclick={() => (container = c)}>{containers[c].label}</button>
              {/each}
            </div>
            {#if fallbackOnly}
              <p class="mono mt-1">No WebCodecs in this browser, so saving uses the slower fallback encoder ({FALLBACK_DOWNLOAD_MB} MB one-time download).</p>
            {/if}
          </div>
          <div class="grid justify-items-end gap-1">
            <button type="button" class="btn btn-primary" onclick={start} disabled={!!blocked}>{action}</button>
            {#if blocked}<p class="mono text-right">{blocked}</p>{/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    & li + li::before {
      content: '·';
      margin-right: 12px;
      color: var(--color-line-2);
    }
  }
  .panel {
    padding: 20px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
    &.center {
      display: grid;
      place-items: center;
      min-height: 200px;
    }
  }
  .editor {
    transition: opacity 0.2s;
    &.busy {
      opacity: 0.55;
    }
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--color-line);
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .bar {
    height: 10px;
    border-radius: 99px;
    background: #141312;
    border: 1px solid var(--color-line-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ffd25ecc, var(--color-sun));
      transition: width 0.3s linear;
    }
  }
  .pct {
    font: 400 28px/1 var(--font-serif);
    font-variant-numeric: tabular-nums;
  }
  .result {
    width: 100%;
    max-height: 60vh;
    border-radius: 12px;
    background: #000;
  }
  .notes li::before {
    content: '› ';
    color: var(--color-sun);
  }
  .tick {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke: var(--color-sun);
      stroke-width: 2;
      stroke-dasharray: 114;
      stroke-dashoffset: 114;
      animation: draw 0.5s ease-out forwards;
    }
    & path {
      stroke: var(--color-chalk);
      stroke-width: 3;
      stroke-dasharray: 26;
      stroke-dashoffset: 26;
      animation: draw 0.35s 0.35s ease-out forwards;
    }
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
</style>
