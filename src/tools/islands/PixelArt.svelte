<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas, resizeImage } from '@/engines/image/client';
  import { downloadBlob, withExtension, withSuffix } from '@/tools/lib/files';
  import { RETRO, applyPalette, autoPalette, downsample, grayPalette, gridHeight, hardAlpha, maxScale, usedColors, type Dither, type PaletteId, type Pixels } from '@/tools/lib/pixel';

  // the grid tops out at 256 cells, so a 1200px working copy is plenty
  const WORK = 1200;

  let src = $state.raw<{ img: ImageData; name: string; width: number; height: number } | null>(null);
  let loading = $state(false);
  let error = $state('');

  let sizeBy = $state<'grid' | 'pixel'>('grid');
  let gridWidth = $state(64);
  let pixelSize = $state(16);
  let palette = $state<PaletteId>('auto');
  let colors = $state(16);
  let dither = $state<Dither>('none');
  let scale = $state(8);

  let result = $state.raw<Pixels | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let saving = $state(false);

  // a slow decode must not land on top of a newer image
  let loadId = 0;

  async function load(file: File) {
    const id = ++loadId;
    loading = true;
    error = '';
    try {
      const full = await decodeImage(file);
      const s = Math.min(1, WORK / Math.max(full.width, full.height));
      const img = s < 1 ? await resizeImage(full, { width: Math.round(full.width * s), height: Math.round(full.height * s) }) : full;
      if (id === loadId) src = { img, name: file.name, width: full.width, height: full.height };
    } catch (e) {
      console.error(e);
      if (id === loadId) error = "Couldn't read that image. Try a JPG, PNG, WebP or HEIC file.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  /** cells across: picked directly, or worked out from a pixel size in the original photo */
  const cells = $derived(sizeBy === 'grid' || !src ? gridWidth : Math.min(256, Math.max(16, Math.round(src.width / pixelSize))));

  $effect(() => {
    const s = src;
    const o = { cells, palette, colors, dither };
    if (!s) return;
    const t = setTimeout(() => {
      const grid = downsample(s.img, o.cells, gridHeight(s.img.width, s.img.height, o.cells));
      const pal = o.palette === 'original' ? null
        : o.palette === 'auto' ? autoPalette(grid, o.colors)
        : o.palette === 'gray' ? grayPalette(o.colors)
        : RETRO[o.palette].colors;
      result = pal ? applyPalette(grid, pal, o.dither) : hardAlpha(grid);
    }, 100);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!canvas || !result) return;
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext('2d')!.putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
  });

  const swatches = $derived(result ? usedColors(result) : []);
  // "original size" scales the grid back up to roughly the photo's own width; either way the file must fit in a canvas
  const factor = $derived(result ? maxScale(result.width, result.height, scale || (src ? Math.max(1, Math.round(src.width / result.width)) : 1)) : 1);

  async function download() {
    if (!result || !src || !canvas) return;
    saving = true;
    error = '';
    try {
      const out = Object.assign(document.createElement('canvas'), { width: result.width * factor, height: result.height * factor });
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      downloadBlob(await encodeCanvas(out, { format: 'png' }), withSuffix(withExtension(src.name, 'png'), '-pixel-art'));
    } catch (e) {
      console.error(e);
      error = "Couldn't save the PNG. Try a smaller export size.";
    } finally {
      saving = false;
    }
  }

  const palettes: [PaletteId, string][] = [
    ['auto', 'auto'], ['gray', 'grayscale'], ['gameboy', 'Game Boy'], ['pico8', 'PICO-8'], ['nes', 'NES'], ['cga', 'CGA'], ['original', 'original'],
  ];
  const dithers: [Dither, string][] = [['none', 'off'], ['bayer', 'ordered'], ['floyd', 'Floyd–Steinberg']];
  const scales: [number, string][] = [[1, '1×'], [4, '4×'], [8, '8×'], [16, '16×'], [0, 'original size']];
  const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if src}
      <div class="stage">
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={canvas} style:width={result ? `min(100%, ${(560 * result.width) / result.height}px)` : undefined} role="img" aria-label={`Pixel art made from ${src.name}`}></canvas>
      </div>
      {#if result}
        <p class="mono">{src.name} · {result.width} × {result.height} pixels · {swatches.length} colors</p>
        {#if swatches.length <= 64}
          <ul class="flex flex-wrap gap-1.5" aria-label="Colors used">
            {#each swatches as c}
              <li class="swatch" style:background={hex(c)} title={hex(c)}><span class="sr-only">{hex(c)}</span></li>
            {/each}
          </ul>
        {/if}
      {/if}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Reading image…' : 'Try another image'} hint="drop, click or paste" onfiles={(f) => load(f[0])} />
    {:else}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Reading image…' : 'Drop an image here'} hint="or click to choose" onfiles={(f) => load(f[0])} />
    {/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
  </div>

  <aside class="grid content-start gap-5">
    <div class="grid gap-3">
      <div class="seg" role="group" aria-label="Size by">
        <button type="button" aria-pressed={sizeBy === 'grid'} onclick={() => (sizeBy = 'grid')}>grid width</button>
        <button type="button" aria-pressed={sizeBy === 'pixel'} onclick={() => (sizeBy = 'pixel')}>pixel size</button>
      </div>
      {#if sizeBy === 'grid'}
        <label>
          <span class="label">{gridWidth} pixels across</span>
          <input type="range" min="16" max="256" bind:value={gridWidth} class="w-full accent-(--color-sun)" />
        </label>
      {:else}
        <label>
          <span class="label">each pixel covers {pixelSize} × {pixelSize} of the photo{src ? ` · ${cells} across` : ''}</span>
          <input type="range" min="2" max="64" bind:value={pixelSize} class="w-full accent-(--color-sun)" />
        </label>
      {/if}
      <span class="mono -mt-2 flex justify-between"><span>chunky</span><span>detailed</span></span>
    </div>

    <div>
      <span class="label">palette</span>
      <div class="seg" role="group" aria-label="Palette">
        {#each palettes as [value, label]}
          <button type="button" aria-pressed={palette === value} onclick={() => (palette = value)}>{label}</button>
        {/each}
      </div>
    </div>

    {#if palette === 'auto' || palette === 'gray'}
      <label>
        <span class="label">{palette === 'gray' ? 'shades' : 'colors'} · {colors}</span>
        <input type="range" min="2" max="64" bind:value={colors} class="w-full accent-(--color-sun)" />
      </label>
    {/if}

    {#if palette !== 'original'}
      <div>
        <span class="label">dithering</span>
        <div class="seg" role="group" aria-label="Dithering">
          {#each dithers as [value, label]}
            <button type="button" aria-pressed={dither === value} onclick={() => (dither = value)}>{label}</button>
          {/each}
        </div>
      </div>
    {/if}

    <div>
      <span class="label">export size{result ? ` · ${result.width * factor} × ${result.height * factor} px` : ''}</span>
      <div class="seg" role="group" aria-label="Export size">
        {#each scales as [value, label]}
          <button type="button" aria-pressed={scale === value} onclick={() => (scale = value)}>{label}</button>
        {/each}
      </div>
    </div>

    <div class="grid gap-2 border-t border-line pt-5">
      <button type="button" class="btn btn-primary" disabled={!result || saving} onclick={download}>{saving ? 'Saving…' : 'Download PNG'}</button>
      <p class="mono">crisp nearest-neighbor scaling · transparency kept</p>
    </div>
  </aside>
</div>

<style>
  .stage {
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  /* sized to the art (no letterboxing), so the checkerboard only ever means transparency */
  canvas {
    display: block;
    width: 100%;
    height: auto;
    max-height: 560px;
    image-rendering: pixelated;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid var(--color-line-2);
  }
</style>
