<script lang="ts">
  import { onMount } from 'svelte';
  import { downloadName, formatBytes, formatTime, isAbort, type StatusControl, type TranscodeResult } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import { errorText, sizeChange, timing } from '@/tools/lib/crop-video/job';

  /* Runs one export with progress, ETA and cancel, then shows the result with a download. */
  interface Props {
    run: (ctl: StatusControl) => Promise<TranscodeResult>;
    /** the original file name, for the download name */
    name: string;
    suffix: string;
    sourceSize: number;
    /** "Cropping", "Resizing" … */
    verb: string;
    onback: () => void;
    onreset: () => void;
  }

  let { run, name, suffix, sourceSize, verb, onback, onreset }: Props = $props();

  const ctrl = new AbortController();
  let progress = $state(0);
  let status = $state('');
  let started = 0;
  let now = $state(0);
  let result = $state.raw<TranscodeResult | null>(null);
  let url = $state('');
  let error = $state('');
  const fileName = $derived(result ? downloadName(name, result.container, suffix) : '');

  const pct = $derived(Math.floor(progress * 100));
  const clock = $derived(timing(progress, now - started));

  onMount(() => {
    started = now = performance.now();
    const tick = setInterval(() => (now = performance.now()), 250);
    run({ signal: ctrl.signal, onProgress: (p) => (progress = p), onStatus: (s) => (status = s) })
      .then((r) => {
        // finished just as the user left: don't create a URL nobody will revoke
        if (ctrl.signal.aborted) return;
        result = r;
        url = URL.createObjectURL(r.blob);
      })
      .catch((e) => {
        if (!isAbort(e) && !ctrl.signal.aborted) {
          console.error(e);
          error = errorText(e);
        }
      })
      .finally(() => {
        clearInterval(tick);
        now = performance.now();
      });
    return () => {
      clearInterval(tick);
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  });

  function cancel() {
    ctrl.abort();
    onback();
  }
</script>

{#if result}
  <div class="panel done">
    <div class="head">
      <svg class="tick" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" /><path d="M12.5 20.5l5 5 10-11" /></svg>
      <div>
        <p class="font-serif text-3xl leading-tight">Your video is <em>ready</em></p>
        <p class="mono">done in {clock.elapsed} · made on your device</p>
      </div>
    </div>
    <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div class="player" style:--r={`${result.width ?? 16} / ${result.height ?? 9}`}>
        <video src={url} controls playsinline><track kind="captions" /></video>
      </div>
      <div class="grid content-start gap-4">
        <dl class="stats">
          <div><dt>size</dt><dd>{formatBytes(sourceSize)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span> <span class="text-sun">{sizeChange(sourceSize, result.blob.size)}</span></dd></div>
          {#if result.width && result.height}<div><dt>frame</dt><dd class="text-chalk">{result.width} × {result.height}</dd></div>{/if}
          <div><dt>length</dt><dd class="text-chalk">{formatTime(result.durationSec, 1)}</dd></div>
          <div><dt>file</dt><dd class="break-all text-chalk">{fileName}</dd></div>
        </dl>
        {#each result.notes as note}<p class="mono">{note}</p>{/each}
        <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob, fileName)}>Download {result.container.toUpperCase()}</button>
        <button type="button" class="btn" onclick={onback}>Adjust and export again</button>
        <button type="button" class="btn" onclick={onreset}>Start over with another video</button>
      </div>
    </div>
  </div>
{:else if error}
  <div class="panel center">
    <p class="font-serif text-3xl">That didn't work</p>
    <p class="max-w-[56ch] text-soft" role="alert">{error}</p>
    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary" onclick={onback}>Back to the editor</button>
      <button type="button" class="btn" onclick={onreset}>Try another video</button>
    </div>
  </div>
{:else}
  <div class="panel center">
    <p class="font-serif text-3xl">{verb} your video…</p>
    <p class="pct font-serif tabular-nums" aria-hidden="true">{pct}<small>%</small></p>
    <div class="bar" role="progressbar" aria-label={`${verb} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style:width={`${progress * 100}%`}></i>
    </div>
    <p class="mono" aria-live="polite">
      {status || 'Starting…'} · {clock.elapsed} elapsed{#if clock.left} · about {clock.left} left{/if}
    </p>
    <p class="mono">You can keep using other tabs; this page does the work on your device.</p>
    <button type="button" class="btn" onclick={cancel}>Cancel</button>
  </div>
{/if}

<style>
  .panel {
    display: grid;
    gap: 18px;
    padding: clamp(20px, 4vw, 32px);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .center {
    justify-items: center;
    text-align: center;
    padding-block: 48px;
  }
  .pct {
    font-size: 64px;
    line-height: 1;
    color: var(--color-sun);
    & small {
      font-size: 0.45em;
      color: var(--color-muted);
    }
  }
  .bar {
    width: min(420px, 100%);
    height: 6px;
    border-radius: 6px;
    background: var(--color-line);
    overflow: hidden;
    & i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ffb84d, var(--color-sun));
      transition: width 0.3s ease-out;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .tick {
    flex: none;
    width: 44px;
    height: 44px;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke: var(--color-ok);
      stroke-width: 2;
      stroke-dasharray: 114;
      stroke-dashoffset: 114;
      animation: draw 0.6s ease-out forwards;
    }
    & path {
      stroke: var(--color-ok);
      stroke-width: 2.5;
      stroke-dasharray: 26;
      stroke-dashoffset: 26;
      animation: draw 0.35s 0.45s ease-out forwards;
    }
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  .player {
    display: grid;
    place-items: center;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #0d0c0b;
    & video {
      display: block;
      aspect-ratio: var(--r);
      max-width: 100%;
      max-height: min(60vh, 560px);
      border-radius: 8px;
      background: #000;
    }
  }
  .stats {
    display: grid;
    gap: 10px;
    & div {
      display: grid;
      gap: 2px;
    }
    & dt {
      font: 400 12px var(--font-mono);
      color: var(--color-muted);
    }
    & dd {
      font-size: 15px;
      color: var(--color-soft);
    }
  }
</style>
