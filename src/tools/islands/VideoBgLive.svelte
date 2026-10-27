<script lang="ts">
  /* Webcam mode: the background is replaced live, and the composited picture can be recorded. */
  import type { ImageSegmenter } from '@mediapipe/tasks-vision';
  import { onDestroy, type Snippet } from 'svelte';
  import { captureError } from '@/tools/lib/recorder/capture';
  import { Recording, stopStreams, type Recorded } from '@/tools/lib/recorder/session';
  import { clock } from '@/tools/lib/video-retouch/job';
  import type { BgSettings } from '@/tools/lib/video-bg/compositor';
  import RecorderResult from './RecorderResult.svelte';
  import VideoBgPreview from './VideoBgPreview.svelte';

  interface Props {
    segmenter: ImageSegmenter;
    settings: BgSettings;
    /** the settings panel; called with true (live mode) */
    controls: Snippet<[boolean]>;
  }

  let { segmenter, settings, controls }: Props = $props();

  const FPS = 30;
  let camera = $state.raw<MediaStream | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let recording = $state.raw<Recording | null>(null);
  let result = $state.raw<Recorded | null>(null);
  let error = $state('');
  let starting = $state(false);
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | undefined;

  async function start() {
    error = '';
    starting = true;
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: FPS } };
    try {
      // with sound when allowed; a refused microphone shouldn't block the camera
      camera = await navigator.mediaDevices.getUserMedia({ video, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video }));
    } catch (e) {
      error = captureError(e, 'camera');
    } finally {
      starting = false;
    }
  }

  function record() {
    if (!canvas || !camera) return;
    const stream = canvas.captureStream(FPS);
    for (const t of camera.getAudioTracks()) stream.addTrack(t);
    const r = new Recording(stream, { width: canvas.width, height: canvas.height, fps: FPS, onfail: () => void finish() });
    r.start();
    recording = r;
    ticker = setInterval(() => (elapsed = r.clock.elapsedMs / 1000), 250);
  }

  async function finish() {
    const r = recording;
    if (!r) return;
    clearInterval(ticker);
    result = await r.stop();
    recording = null;
    stopCamera();
  }

  function stopCamera() {
    stopStreams(camera);
    camera = null;
  }

  onDestroy(() => {
    clearInterval(ticker);
    void recording?.stop();
    stopCamera();
  });
</script>

{#if result}
  <RecorderResult
    blob={result.blob}
    durationSec={result.durationSec}
    baseName="rounder-background"
    title="Your clip is ready"
    restartLabel="Record another"
    onrestart={() => {
      result = null;
      elapsed = 0;
      start();
    }}
  />
{:else if camera}
  <div class="layout">
    <div class="grid content-start gap-3">
      <VideoBgPreview {segmenter} {settings} stream={camera} bind:canvas maxSide={1280} />
      <div class="flex flex-wrap items-center gap-2">
        {#if recording}
          <button type="button" class="btn btn-primary" onclick={finish}><span class="dot" aria-hidden="true"></span>Stop recording</button>
          <span class="mono" aria-live="polite">{clock(elapsed)}</span>
        {:else}
          <button type="button" class="btn btn-primary" onclick={record} disabled={!canvas}>Start recording</button>
          <button type="button" class="btn" onclick={stopCamera}>Turn camera off</button>
        {/if}
      </div>
      <p class="mono">Keep this tab in front while recording: browsers pause the effect in background tabs.</p>
    </div>
    {@render controls(true)}
  </div>
{:else}
  <div class="panel grid justify-items-start gap-3">
    <p class="font-serif text-2xl leading-tight">Live from your camera</p>
    <p class="text-soft">See the new background as you move, then record a clip. The camera feed stays on your device.</p>
    <button type="button" class="btn btn-primary" onclick={start} disabled={starting}>{starting ? 'Asking for the camera…' : 'Turn on camera'}</button>
    {#if error}<p class="text-bad" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .layout {
    display: grid;
    gap: 20px;
    @media (min-width: 760px) {
      grid-template-columns: minmax(0, 1fr) 280px;
    }
  }
  .panel {
    padding: 20px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
  }
  .dot {
    width: 10px;
    height: 10px;
    margin-right: 8px;
    border-radius: 99px;
    background: var(--color-bad);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
