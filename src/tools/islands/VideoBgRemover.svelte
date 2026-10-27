<script lang="ts">
  import type { ImageSegmenter } from '@mediapipe/tasks-vision';
  import { onMount } from 'svelte';
  import ModelGate from '@/components/tool/ModelGate.svelte';
  import { formatMB, totalDownloadSize } from '@/engines/ai';
  import { capabilities, downloadName, transcode } from '@/engines/media';
  import { Compositor, type BgMode, type BgSettings } from '@/tools/lib/video-bg/compositor';
  import { ENGINE_BYTES, exportSize } from '@/tools/lib/video-bg/matte';
  import VideoBgControls from './VideoBgControls.svelte';
  import VideoBgLive from './VideoBgLive.svelte';
  import VideoBgPreview from './VideoBgPreview.svelte';
  import VideoRetouchShell, { type RetouchJob } from './VideoRetouchShell.svelte';
  import VideoRetouchTransport from './VideoRetouchTransport.svelte';

  let source = $state<'file' | 'camera'>('file');
  let segmenter = $state.raw<ImageSegmenter | null>(null);
  let mode = $state<BgMode>('blur');
  let color = $state('#00b140');
  let image = $state.raw<ImageBitmap | null>(null);
  let blur = $state(0.5);
  let feather = $state(0.35);
  let smoothing = $state(0.6);
  let maxShort = $state(1080);
  /** why transparent output can't be made here, or true when it can */
  let alpha = $state<true | string>(true);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let unplayable = $state(false);

  const settings = $derived<BgSettings>({ mode, color, image, blur, feather, smoothing });
  const firstRun = formatMB(ENGINE_BYTES.simd + totalDownloadSize('selfie-segmenter', 'fp16'));
  const sizes = [
    { value: 0, label: 'Original' },
    { value: 1080, label: '1080p' },
    { value: 720, label: '720p' },
  ];

  onMount(() => {
    capabilities()
      .then((c) => (alpha = c.video.encode.includes('vp9') ? true : "This browser can't encode VP9, which transparent video needs"))
      .catch(() => {});
    return () => image?.close();
  });

  function useCamera(on: boolean) {
    source = on ? 'camera' : 'file';
    if (on && mode === 'transparent') mode = 'blur';
  }

  async function run({ source: src, container, signal, onProgress, onStatus }: RetouchJob) {
    const v = src.info.video!;
    const size = exportSize(v.displayWidth, v.displayHeight, maxShort);
    const compositor = new Compositor(segmenter!);
    const s = settings;
    // the preview shares the main thread (and the segmenter) with the export
    videoEl?.pause();
    if (s.mode === 'transparent') {
      onStatus('Removing the background…');
      const { exportTransparent } = await import('@/tools/lib/video-bg/transparent');
      return exportTransparent(src.file, size, compositor, s, { signal, onProgress });
    }
    return transcode(
      src.file,
      { container, video: { ...size, quality: 'high', render: (ctx, sample) => compositor.render(ctx, (c, x, y, w, h) => sample.draw(c, x, y, w, h), size.width, size.height, s) } },
      { signal, onProgress, onStatus: (text) => onStatus(text === 'Converting…' ? 'Removing the background…' : text) },
    );
  }
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="seg" role="group" aria-label="Source">
      <button type="button" aria-pressed={source === 'file'} onclick={() => useCamera(false)}>Video file</button>
      <button type="button" aria-pressed={source === 'camera'} onclick={() => useCamera(true)}>Webcam (live)</button>
    </div>
    <p class="mono">AI · works best with people · first use downloads {firstRun} once</p>
  </div>

  <ModelGate
    model="selfie-segmenter"
    light={null}
    load={async ({ onProgress, signal }) => {
      // MediaPipe's runtime loads only once the visitor agrees, not with the page
      const { loadSegmenter } = await import('@/tools/lib/video-bg/segmenter');
      segmenter = await loadSegmenter({ onProgress, signal });
      return { device: 'wasm' };
    }}
  >
    {#snippet children()}
      {#if segmenter}
        {@const seg = segmenter}
        {#snippet controls(live: boolean)}
          <VideoBgControls bind:mode bind:color bind:image bind:blur bind:feather bind:smoothing transparent={live ? false : alpha} />
        {/snippet}
        {#if source === 'camera'}
          <VideoBgLive segmenter={seg} {settings} {controls} />
        {:else}
          <VideoRetouchShell
            action="Remove background"
            {run}
            onsource={() => (unplayable = false)}
            outputName={(name, c) => downloadName(name, mode === 'transparent' ? 'webm' : c, '-no-background')}
          >
            {#snippet editor(src)}
              <div class="layout">
                <div class="grid content-start gap-3">
                  {#if unplayable}
                    <p class="panel text-soft">
                      This browser can't play this file as a preview, so there's nothing to show here. Removing the background still works: pick your settings and
                      press the button below.
                    </p>
                  {:else}
                    <VideoBgPreview segmenter={seg} {settings} src={src.url} bind:video={videoEl} onfail={() => (unplayable = true)} />
                    <VideoRetouchTransport video={videoEl} />
                    <p class="mono">Preview shown at reduced size. The saved video is made from every full-size frame.</p>
                  {/if}
                </div>
                <div class="grid content-start gap-5">
                  {@render controls(false)}
                  <div>
                    <span class="label" id="vbg-size">output size</span>
                    <div class="seg" role="group" aria-labelledby="vbg-size">
                      {#each sizes as o}
                        <button type="button" aria-pressed={maxShort === o.value} onclick={() => (maxShort = o.value)}>{o.label}</button>
                      {/each}
                    </div>
                    {#if src.info.video}
                      {@const out = exportSize(src.info.video.displayWidth, src.info.video.displayHeight, maxShort)}
                      <p class="mono mt-1">{out.width}×{out.height} · smaller is faster</p>
                    {/if}
                  </div>
                </div>
              </div>
            {/snippet}
          </VideoRetouchShell>
        {/if}
      {/if}
    {/snippet}
  </ModelGate>
</div>

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
</style>
