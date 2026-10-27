<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { decodeImage, resizeImage } from '@/engines/image/client';
  import { downloadBlob, formatBytes, withExtension } from '@/tools/lib/files';
  import { MAX_TRACE, matchPreset, presetLabels, presets, type PresetId, type TraceResult, type TraceSettings } from '@/tools/lib/trace/settings';
  import { closeTracer, stopTracing, trace } from '@/tools/lib/trace/client';

  let file = $state<File | null>(null);
  let source = $state.raw<ImageData | null>(null);
  let original = $state.raw({ width: 0, height: 0 });
  let loading = $state(false);
  let tracing = $state(false);
  let error = $state('');
  let result = $state.raw<TraceResult | null>(null);
  let svgUrl = $state('');
  let s = $state<TraceSettings>({ ...presets.logo, removeBg: false });

  let canvas = $state<HTMLCanvasElement>();
  let latest = 0;

  const preset = $derived(matchPreset(s));
  const svgBlob = $derived(result ? new Blob([result.svg], { type: 'image/svg+xml' }) : null);
  const scaled = $derived(source && source.width < original.width);

  function applyPreset(id: PresetId) {
    Object.assign(s, presets[id]);
    // signatures and line art are nearly always wanted without the paper
    if (id === 'bw') s.removeBg = true;
  }

  async function load(files: File[]) {
    reset();
    const picked = (file = files[0]);
    loading = true;
    try {
      let img = await decodeImage(picked);
      const size = { width: img.width, height: img.height };
      const k = MAX_TRACE / Math.max(img.width, img.height);
      if (k < 1) img = await resizeImage(img, { width: Math.max(1, Math.round(img.width * k)), height: Math.max(1, Math.round(img.height * k)) });
      // another image may have been picked while this one decoded
      if (file !== picked) return;
      original = size;
      source = img;
    } catch (e) {
      console.error(e);
      if (file === picked) error = "Couldn't open this image. Try a PNG, JPG or WebP.";
    } finally {
      if (file === picked) loading = false;
    }
  }

  function reset() {
    stopTracing();
    file = null;
    source = null;
    result = null;
    error = '';
    tracing = false;
    loading = false;
  }

  async function run(img: ImageData, settings: TraceSettings) {
    const id = ++latest;
    tracing = true;
    try {
      result = await trace(img, settings, original);
      error = '';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      console.error(e);
      error = 'Tracing failed. Try fewer colors or less detail.';
    } finally {
      if (id === latest) tracing = false;
    }
  }

  // retrace once the sliders settle
  $effect(() => {
    const img = source;
    const settings = $state.snapshot(s);
    if (!img) return;
    const t = setTimeout(() => run(img, settings), 150);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d')!.putImageData(source, 0, 0);
  });

  $effect(() => {
    if (!svgBlob) {
      svgUrl = '';
      return;
    }
    const url = URL.createObjectURL(svgBlob);
    svgUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  $effect(() => () => closeTracer());

  function download() {
    if (svgBlob && file) downloadBlob(svgBlob, withExtension(file.name, 'svg'));
  }
</script>

{#if !file}
  <Dropzone accept="image/*,.heic,.heif,.avif" title="Drop an image to vectorize" hint="PNG, JPG, WebP · logos and line art work best" onfiles={load} />
{:else}
  <div class="grid gap-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="seg" role="group" aria-label="Preset">
        {#each presetLabels as [id, label]}
          <button type="button" aria-pressed={preset === id} onclick={() => applyPreset(id)}>{label}</button>
        {/each}
      </div>
      <button type="button" class="btn px-3! py-2! text-sm!" onclick={reset}>Choose another image</button>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <figure class="pane">
        <figcaption class="tag mono">original</figcaption>
        {#if source}
          <canvas bind:this={canvas} aria-label={`Original image: ${file.name}`}></canvas>
        {:else if loading}
          <p class="mono working m-auto">opening…</p>
        {/if}
      </figure>
      <figure class="pane">
        <figcaption class="tag mono">svg</figcaption>
        {#if svgUrl}
          <img src={svgUrl} alt={`Vector trace of ${file.name}`} class:dim={tracing} />
        {/if}
        {#if tracing}<p class="mono working status">tracing…</p>{/if}
      </figure>
    </div>

    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}

    <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
      {#if result && svgBlob}
        <p class="mono flex-1 basis-60" aria-live="polite">
          <span class="text-chalk">{result.paths.toLocaleString('en-US')}</span> paths · {result.colors} colors · <span class="text-chalk">{formatBytes(svgBlob.size)}</span>
          {#if result.removed}· removed <span class="swatch" style={`background:${result.removed}`}></span>{result.removed}{/if}
          {#if result.paths > 5000}<span class="block text-soft">That's a lot of paths. Fewer colors or less detail gives a lighter file.</span>{/if}
        </p>
        <div class="flex gap-2">
          <CopyButton text={() => result?.svg ?? ''} label="Copy SVG code" />
          <button type="button" class="btn btn-primary" onclick={download}>Download SVG</button>
        </div>
      {/if}
    </div>

    <div class="grid gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
      {#if s.mode === 'bw'}
        <label>
          <span class="label">threshold · {s.threshold}</span>
          <input type="range" min="10" max="245" bind:value={s.threshold} class="w-full accent-(--color-sun)" />
          <span class="mono flex justify-between"><span>thinner</span><span>bolder</span></span>
        </label>
      {:else}
        <label>
          <span class="label">colors · {s.colors}</span>
          <input type="range" min="2" max="64" bind:value={s.colors} class="w-full accent-(--color-sun)" />
          <span class="mono flex justify-between"><span>flat</span><span>rich</span></span>
        </label>
      {/if}
      <label>
        <span class="label">detail · {s.detail + 1}</span>
        <input type="range" min="0" max="9" bind:value={s.detail} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>drop specks</span><span>keep all</span></span>
      </label>
      <label>
        <span class="label">smoothing · {s.smoothing + 1}</span>
        <input type="range" min="0" max="9" bind:value={s.smoothing} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>exact</span><span>smooth</span></span>
      </label>
      <label>
        <span class="label">blur · {s.blur}</span>
        <input type="range" min="0" max="5" bind:value={s.blur} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>off</span><span>cleans noise</span></span>
      </label>
      <label class="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" bind:checked={s.removeBg} class="mt-1" />
        <span>Remove background<span class="mono block">clears the color touching the edges, like white paper</span></span>
      </label>
      {#if scaled}
        <p class="mono sm:col-span-2">
          Traced at {source?.width}×{source?.height} to keep it quick (your image is {original.width}×{original.height}). The SVG keeps the full size and stays sharp at any scale.
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pane {
    position: relative;
    display: grid;
    min-height: 220px;
    margin: 0;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    & canvas,
    & img {
      display: block;
      width: 100%;
      height: 100%;
      max-height: 480px;
      object-fit: contain;
      transition: opacity 0.2s;
    }
  }
  .dim {
    opacity: 0.45;
  }
  .tag {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 1;
    padding: 3px 8px;
    border-radius: 6px;
    background: #131211cc;
    color: var(--color-chalk);
  }
  .status {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #131211cc;
  }
  .working {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin: 0 4px 0 2px;
    border-radius: 3px;
    border: 1px solid var(--color-line-2);
    vertical-align: -1px;
  }
</style>
