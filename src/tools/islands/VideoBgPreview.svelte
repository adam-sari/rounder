<script lang="ts">
  /*
   * Live preview of the background removal: the <video> plays underneath (so the browser keeps
   * decoding it), and every new frame is segmented and composited onto the canvas on top.
   * Plays a file (src) or a camera (stream).
   */
  import type { ImageSegmenter } from '@mediapipe/tasks-vision';
  import { untrack } from 'svelte';
  import { Compositor, type BgSettings } from '@/tools/lib/video-bg/compositor';
  import { fitSize } from '@/tools/lib/video-bg/matte';

  interface Props {
    segmenter: ImageSegmenter;
    settings: BgSettings;
    src?: string;
    stream?: MediaStream;
    video?: HTMLVideoElement | null;
    canvas?: HTMLCanvasElement | null;
    /** long side of the preview canvas; export always uses the full size */
    maxSide?: number;
    onfail?: () => void;
  }

  let { segmenter, settings, src, stream, video = $bindable(null), canvas = $bindable(null), maxSide = 960, onfail }: Props = $props();

  let ratio = $state(16 / 9);
  let failed = $state(false);
  const compositor = $derived(new Compositor(segmenter));

  function paint() {
    const v = video;
    const c = canvas;
    if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
    const { width, height } = fitSize(v.videoWidth, v.videoHeight, maxSide);
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
      ratio = width / height;
    }
    try {
      compositor.render(c.getContext('2d')!, (ctx, x, y, w, h) => ctx.drawImage(v, x, y, w, h), width, height, settings);
    } catch (e) {
      // e.g. a GPU context lost mid-frame: say so once instead of throwing every frame
      if (!failed) console.error(e);
      failed = true;
    }
  }

  $effect(() => {
    const v = video;
    if (!v) return;
    if (stream) v.srcObject = stream;
    let stop = false;
    let id = 0;
    let last = -1;
    // a new decoded frame (requestVideoFrameCallback), or a changed time where that's missing
    const rvfc = typeof v.requestVideoFrameCallback === 'function';
    const tick = () => {
      if (stop) return;
      if (rvfc || v.currentTime !== last || stream) paint();
      last = v.currentTime;
      id = rvfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    // untracked: settings changes repaint below instead of restarting the frame loop
    untrack(tick);
    // a jump in time or a new file: don't blend the old mask into it
    const fresh = () => {
      compositor.reset();
      paint();
    };
    v.addEventListener('seeked', fresh);
    v.addEventListener('loadeddata', fresh);
    return () => {
      stop = true;
      if (rvfc) v.cancelVideoFrameCallback(id);
      else cancelAnimationFrame(id);
      v.removeEventListener('seeked', fresh);
      v.removeEventListener('loadeddata', fresh);
    };
  });

  // repaint a paused frame when a setting changes
  $effect(() => {
    void [settings.mode, settings.color, settings.image, settings.blur, settings.feather, settings.smoothing];
    if (video?.paused) paint();
  });
</script>

<div class="stage" style="aspect-ratio:{ratio};width:min(100%, calc(62vh * {ratio}))">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    src={stream ? undefined : src}
    muted={!!stream}
    autoplay={!!stream}
    playsinline
    loop={!stream}
    preload="auto"
    disablepictureinpicture
    aria-hidden="true"
    tabindex="-1"
    onerror={() => onfail?.()}
  ></video>
  <div class="backdrop" class:checker={settings.mode === 'transparent'}></div>
  <canvas bind:this={canvas} aria-label="Preview with the background replaced"></canvas>
</div>
{#if failed}
  <p class="mono text-bad!" role="alert">The preview stopped drawing. Reload the page, or try a smaller video.</p>
{/if}

<style>
  .stage {
    position: relative;
    width: 100%;
    margin-inline: auto;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    background: #0d0c0b;
    & > * {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  }
  video {
    object-fit: contain;
  }
  .backdrop {
    background: #0d0c0b;
    &.checker {
      background: repeating-conic-gradient(#2a2926 0% 25%, #1c1b19 0% 50%) 0 0 / 22px 22px;
    }
  }
  canvas {
    object-fit: contain;
  }
</style>
