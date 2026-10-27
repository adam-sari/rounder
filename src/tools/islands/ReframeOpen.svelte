<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { ensureDecodable, FALLBACK_DOWNLOAD_MB, isAbort, MediaError, probe } from '@/engines/media';
  import { errorText, type Opened } from '@/tools/lib/crop-video/job';

  /* Picks and probes a video; offers the one-time fallback decoder for formats the browser can't read. */
  interface Props {
    title: string;
    hint?: string;
    onready: (video: Opened) => void;
  }

  let { title, hint = 'MP4, MOV, WebM, MKV, AVI and more · stays on your device', onready }: Props = $props();

  let phase = $state<'pick' | 'probing' | 'ask' | 'converting'>('pick');
  let pending = $state.raw<File | null>(null);
  let error = $state('');
  let status = $state('');
  let progress = $state(0);
  let ctrl: AbortController | null = null;

  const noVideo = () => new MediaError('no-tracks', 'This file has no video track.');

  async function open(files: File[]) {
    ctrl?.abort();
    const job = (ctrl = new AbortController());
    const file = files[0];
    phase = 'probing';
    error = '';
    try {
      const info = await probe(file, { signal: job.signal });
      if (job !== ctrl) return;
      if (info.needsFallback) {
        pending = file;
        phase = 'ask';
        return;
      }
      if (!info.video) throw noVideo();
      onready({ file, playable: file, info });
    } catch (e) {
      if (job !== ctrl) return;
      if (!isAbort(e)) error = errorText(e);
      phase = 'pick';
    }
  }

  async function convert() {
    if (!pending) return;
    const job = (ctrl = new AbortController());
    const file = pending;
    phase = 'converting';
    status = 'Downloading decoder…';
    progress = 0;
    try {
      const r = await ensureDecodable(file, { signal: job.signal, onStatus: (s) => (status = s), onProgress: (p) => (progress = p) });
      if (job !== ctrl) return;
      if (!r.info.video) throw noVideo();
      onready({ file, playable: r.file, info: r.info });
    } catch (e) {
      if (job !== ctrl) return;
      if (!isAbort(e)) error = errorText(e);
      phase = 'pick';
    }
  }

  function cancel() {
    ctrl?.abort();
    ctrl = null;
    pending = null;
    phase = 'pick';
  }

  onDestroy(() => ctrl?.abort());
</script>

{#if phase === 'pick'}
  <Dropzone accept="video/*,.mkv,.avi,.wmv,.flv,.mov,.m4v,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv" {title} {hint} onfiles={open} />
{:else if phase === 'probing'}
  <div class="panel">
    <p class="font-serif text-3xl">Reading your video…</p>
    <p class="mono">checking its size, length and codecs, on your device</p>
  </div>
{:else if phase === 'ask'}
  <div class="panel" role="alertdialog" aria-labelledby="fallback-title" aria-describedby="fallback-body">
    <p id="fallback-title" class="font-serif text-3xl">This one needs a <em>decoder</em></p>
    <p id="fallback-body" class="max-w-[52ch] text-soft">
      Your browser can't play <span class="text-chalk">{pending?.name}</span> on its own. Rounder can convert it right here with a free
      one-time decoder download of about {FALLBACK_DOWNLOAD_MB} MB. Your video still never leaves your device.
    </p>
    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary" onclick={convert}>Download decoder and open</button>
      <button type="button" class="btn" onclick={cancel}>Choose another file</button>
    </div>
  </div>
{:else}
  <div class="panel">
    <p class="font-serif text-3xl">Opening your video…</p>
    <div class="bar" role="progressbar" aria-label="Preparing the video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <i style:width={`${progress * 100}%`}></i>
    </div>
    <p class="mono" aria-live="polite">{status}</p>
    <button type="button" class="btn" onclick={cancel}>Cancel</button>
  </div>
{/if}
{#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}

<style>
  .panel {
    display: grid;
    justify-items: center;
    gap: 14px;
    padding: 56px 20px;
    text-align: center;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .bar {
    width: min(360px, 100%);
    height: 6px;
    border-radius: 6px;
    background: var(--color-line);
    overflow: hidden;
    & i {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.3s ease-out;
    }
  }
</style>
