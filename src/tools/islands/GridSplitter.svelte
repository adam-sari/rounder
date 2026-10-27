<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeImage, formatInfo, resizeImage } from '@/engines/image/client';
  import { downloadBlob, zipFiles } from '@/tools/lib/files';
  import {
    cropPixels, extractTile, gridSize, hexToRgb, panBy, placeImage, postingOrder, tileName, visibleRegion,
    type Fit, type Layout, type Shape,
  } from '@/tools/lib/instagram-grid/grid';

  let file = $state<File | null>(null);
  let src = $state.raw<ImageData | null>(null);
  let loading = $state(false);
  let error = $state('');

  let layout = $state<Layout>('grid');
  let rows = $state(3);
  let slides = $state(3);
  let gridShape = $state<Shape>('3:4');
  let carouselShape = $state<Shape>('4:5');
  let fit = $state<Fit>('fill');
  let zoom = $state(1);
  let px = $state(0.5);
  let py = $state(0.5);
  let bg = $state('#ffffff');
  let tileWidth = $state(1080);
  let format = $state<'jpeg' | 'png'>('jpeg');
  let guides = $state(true);
  let busy = $state('');

  const shape = $derived(layout === 'grid' ? gridShape : carouselShape);
  const size = $derived(gridSize(layout, layout === 'grid' ? rows : slides, shape, tileWidth));
  const place = $derived(src && placeImage(src.width, src.height, size.width, size.height, fit, zoom, px, py));
  const total = $derived(size.cols * size.rows);
  const tiles = $derived(
    Array.from({ length: total }, (_, i) => ({ i, r: Math.floor(i / size.cols), c: i % size.cols, order: postingOrder(i, total, layout) })),
  );
  const byOrder = $derived([...tiles].sort((a, b) => a.order - b.order));
  // the source is stretched past its own pixels, so tiles will look soft
  const upscaled = $derived(!!place && place.s > 1.05);
  const base = $derived(file ? file.name.replace(/\.[^.]+$/, '') : 'image');

  let loadId = 0;
  async function load(files: File[]) {
    const id = ++loadId;
    loading = true;
    error = '';
    try {
      const img = await decodeImage(files[0]);
      if (id !== loadId) return; // a newer file was dropped meanwhile
      src = img;
      file = files[0];
      zoom = 1;
      px = py = 0.5;
      cache = undefined;
    } catch (e) {
      if (id !== loadId) return;
      console.error(e);
      error = "Couldn't read that image. Try a JPG, PNG, WebP, AVIF or HEIC file.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  function reset() {
    file = null;
    src = null;
    cache = undefined;
  }

  // a downscaled copy for the stage; the full-size pixels are only touched on export
  const PREVIEW = 2400;
  let canvas = $state<HTMLCanvasElement>();
  $effect(() => {
    if (!src || !canvas) return;
    const img = src;
    const c = canvas;
    const k = Math.min(1, PREVIEW / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    let live = true;
    createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      .then((bmp) => {
        if (live) {
          c.width = w;
          c.height = h;
          // explicit size, in case a browser ignores the resize options
          c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
        }
        bmp.close();
      })
      .catch((e) => {
        console.error(e);
        if (live) error = "Couldn't draw the preview for this image.";
      });
    return () => (live = false);
  });

  // drag (or arrow keys) to slide the image inside the grid
  let frame = $state<HTMLDivElement>();
  let drag: { x: number; y: number; px: number; py: number } | null = null;

  function onDown(e: PointerEvent) {
    if (!frame || e.button !== 0) return;
    frame.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, px, py };
  }
  function onMove(e: PointerEvent) {
    if (!drag || !place || !frame) return;
    const k = size.width / frame.clientWidth;
    ({ px, py } = panBy(place, size.width, size.height, drag.px, drag.py, (e.clientX - drag.x) * k, (e.clientY - drag.y) * k));
  }
  function onKey(e: KeyboardEvent) {
    const step = size.width * (e.shiftKey ? 0.05 : 0.01);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || !place) return;
    e.preventDefault();
    ({ px, py } = panBy(place, size.width, size.height, px, py, d[0], d[1]));
  }

  /*
   * Export: crop the visible part of the full-size image, resize it once with a
   * lanczos filter in the worker, then cut tiles from that. Cached so single-tile
   * downloads don't redo the resize.
   */
  interface Job {
    size: typeof size;
    fit: Fit;
    zoom: number;
    px: number;
    py: number;
    bg: string;
    format: 'jpeg' | 'png';
    layout: Layout;
    base: string;
  }
  // keyed on the source too, so a slow export of the previous photo can't fill it
  let cache: { of: ImageData; key: string; img: ImageData; at: { x: number; y: number } } | undefined;

  const snapshot = (): Job => ({ size, fit, zoom, px, py, bg, format, layout, base });

  async function composite(job: Job, img: ImageData) {
    const { width: W, height: H } = job.size;
    const key = JSON.stringify([W, H, job.fit, job.zoom, job.px, job.py]);
    if (cache?.of === img && cache.key === key) return cache;
    const p = placeImage(img.width, img.height, W, H, job.fit, job.zoom, job.px, job.py);
    const { src: s, dst } = visibleRegion(img.width, img.height, W, H, p);
    const crop = new ImageData(cropPixels(img, s), s.width, s.height);
    const resized = s.width === dst.width && s.height === dst.height ? crop : await resizeImage(crop, { width: dst.width, height: dst.height, method: 'lanczos3' });
    const comp = { of: img, key, img: resized, at: { x: dst.x, y: dst.y } };
    if (img === src) cache = comp;
    return comp;
  }

  function encodeTile(job: Job, comp: NonNullable<typeof cache>, i: number) {
    const { tw, th, cols } = job.size;
    const rect = { x: (i % cols) * tw, y: Math.floor(i / cols) * th, width: tw, height: th };
    const data = extractTile(comp.img, comp.at, rect, hexToRgb(job.bg));
    return encodeImage(new ImageData(data, tw, th), { format: job.format, quality: 92 });
  }

  async function downloadAll() {
    if (!src) return;
    const job = snapshot();
    const n = job.size.cols * job.size.rows;
    const ext = formatInfo[job.format].ext;
    error = '';
    busy = 'Preparing…';
    try {
      const comp = await composite(job, src);
      const out: { name: string; blob: Blob }[] = [];
      const pending: Promise<void>[] = [];
      for (let i = 0; i < n; i++) {
        const order = postingOrder(i, n, job.layout);
        pending.push(encodeTile(job, comp, i).then((blob) => {
          out.push({ name: tileName(order, n, job.layout, ext), blob });
          busy = `Making tiles ${out.length}/${n}…`;
        }));
        // let the page breathe between tiles
        await new Promise((r) => setTimeout(r));
      }
      await Promise.all(pending);
      busy = 'Zipping…';
      out.sort((a, b) => a.name.localeCompare(b.name));
      downloadBlob(await zipFiles(out), `${job.base}-instagram-${job.layout}.zip`);
    } catch (e) {
      console.error(e);
      error = 'Something went wrong making the tiles. A smaller tile width may help on low-memory devices.';
    } finally {
      busy = '';
    }
  }

  async function downloadOne(i: number, order: number) {
    if (!src) return;
    const job = snapshot();
    error = '';
    busy = `Making tile ${order}…`;
    try {
      const blob = await encodeTile(job, await composite(job, src), i);
      downloadBlob(blob, tileName(order, job.size.cols * job.size.rows, job.layout, formatInfo[job.format].ext));
    } catch (e) {
      console.error(e);
      error = 'Something went wrong making that tile.';
    } finally {
      busy = '';
    }
  }

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const two = (n: number) => String(n).padStart(2, '0');
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if !src}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Reading image…' : 'Drop a photo to split'} hint="or click to choose · one image" onfiles={load} />
    {:else if place}
      <div class="stage">
        <div
          bind:this={frame}
          class="frame"
          style={`aspect-ratio:${size.width}/${size.height}; width:min(100%, calc(min(64vh, 640px) * ${size.width / size.height})); background:${bg}`}
          role="button"
          aria-roledescription="draggable image"
          tabindex="0"
          aria-label="Image position. Drag, or use the arrow keys, to move the image inside the grid."
          onpointerdown={onDown}
          onpointermove={onMove}
          onpointerup={() => (drag = null)}
          onpointercancel={() => (drag = null)}
          onkeydown={onKey}
        >
          <canvas
            bind:this={canvas}
            class="pic"
            style={`left:${pct(place.ox, size.width)}; top:${pct(place.oy, size.height)}; width:${pct(place.iw, size.width)}; height:${pct(place.ih, size.height)}`}
            aria-label={`Preview of ${file?.name}`}
          ></canvas>
          {#if guides}
            {#each { length: size.cols - 1 } as _, c}
              <span class="line v" style={`left:${pct(c + 1, size.cols)}`}></span>
            {/each}
            {#each { length: size.rows - 1 } as _, r}
              <span class="line h" style={`top:${pct(r + 1, size.rows)}`}></span>
            {/each}
            {#each tiles as t (t.i)}
              <span
                class="num"
                style={`left:${pct(t.c, size.cols)}; top:${pct(t.r, size.rows)}; width:${pct(1, size.cols)}; height:${pct(1, size.rows)}; font-size:min(15px, ${36 / size.cols}cqw)`}
              >
                <b class:first={t.order === 1}>{two(t.order)}</b>
              </span>
            {/each}
          {/if}
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="mono">{file?.name} · {src.width}×{src.height} · drag to reposition</p>
        <button type="button" class="btn px-3! py-2! text-sm!" aria-pressed={guides} onclick={() => (guides = !guides)}>
          {guides ? 'Hide guides' : 'Show guides'}
        </button>
      </div>

      <div class="note">
        {#if layout === 'grid'}
          <p><strong class="text-sun">Post tile 01 first and {two(total)} last.</strong> Instagram puts each new post at the top-left of your profile, so the bottom-right tile has to go up first for the picture to build up in place.</p>
        {:else}
          <p><strong class="text-sun">Add all {total} slides to one carousel post, 01 first.</strong> When people swipe, the edges line up into one long picture.</p>
        {/if}
      </div>
      {#if upscaled}
        <p class="text-sm text-soft">Heads up: your photo has fewer pixels than these tiles, so they'll be enlarged and may look a little soft. A smaller grid or zoom keeps them sharper.</p>
      {/if}
    {/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
  </div>

  <aside class="grid content-start gap-5">
    <div>
      <span class="label">post as</span>
      <div class="seg" role="group" aria-label="Post as">
        <button type="button" aria-pressed={layout === 'grid'} onclick={() => (layout = 'grid')}>profile grid</button>
        <button type="button" aria-pressed={layout === 'carousel'} onclick={() => (layout = 'carousel')}>carousel</button>
      </div>
    </div>

    {#if layout === 'grid'}
      <div>
        <span class="label">grid</span>
        <div class="seg" role="group" aria-label="Grid size">
          {#each [1, 2, 3, 4] as n}
            <button type="button" aria-pressed={rows === n} onclick={() => (rows = n)}>3×{n}</button>
          {/each}
        </div>
      </div>
    {:else}
      <label>
        <span class="label">slides · {slides}</span>
        <input type="range" min="2" max="10" bind:value={slides} class="w-full accent-(--color-sun)" />
      </label>
    {/if}

    <div>
      <span class="label">tile shape · {size.tw}×{size.th} each</span>
      <div class="seg" role="group" aria-label="Tile shape">
        {#if layout === 'grid'}
          <button type="button" aria-pressed={gridShape === '3:4'} onclick={() => (gridShape = '3:4')}>3:4 portrait</button>
          <button type="button" aria-pressed={gridShape === '1:1'} onclick={() => (gridShape = '1:1')}>1:1 square</button>
        {:else}
          <button type="button" aria-pressed={carouselShape === '4:5'} onclick={() => (carouselShape = '4:5')}>4:5 portrait</button>
          <button type="button" aria-pressed={carouselShape === '1:1'} onclick={() => (carouselShape = '1:1')}>1:1 square</button>
        {/if}
      </div>
    </div>

    <div class="grid gap-3">
      <div>
        <span class="label">image</span>
        <div class="seg" role="group" aria-label="How the image fills the grid">
          <button type="button" aria-pressed={fit === 'fill'} onclick={() => (fit = 'fill')}>crop to fill</button>
          <button type="button" aria-pressed={fit === 'fit'} onclick={() => (fit = 'fit')}>fit whole</button>
        </div>
      </div>
      <label>
        <span class="label">zoom · {zoom.toFixed(2)}×</span>
        <input type="range" min="1" max="4" step="0.01" bind:value={zoom} class="w-full accent-(--color-sun)" />
      </label>
      {#if fit === 'fit'}
        <label class="flex items-center gap-3">
          <input type="color" bind:value={bg} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
          <span class="mono">background {bg}</span>
        </label>
      {/if}
      <button type="button" class="btn px-3! py-2! text-sm! justify-self-start" onclick={() => ((px = py = 0.5), (zoom = 1))}>Re-center</button>
    </div>

    <div>
      <span class="label">tile width</span>
      <div class="seg" role="group" aria-label="Tile width">
        {#each [1080, 1440, 2160] as w}
          <button type="button" aria-pressed={tileWidth === w} onclick={() => (tileWidth = w)}>{w}</button>
        {/each}
      </div>
      <span class="mono mt-1 block">Instagram displays 1080 px</span>
    </div>

    <div>
      <span class="label">format</span>
      <div class="seg" role="group" aria-label="Output format">
        <button type="button" aria-pressed={format === 'jpeg'} onclick={() => (format = 'jpeg')}>JPG</button>
        <button type="button" aria-pressed={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
      </div>
    </div>

    {#if src}
      <div class="grid gap-3 border-t border-line pt-5">
        <p class="mono">{total} tiles · {size.tw}×{size.th} · {formatInfo[format].label}</p>
        <button type="button" class="btn btn-primary" disabled={!!busy} onclick={downloadAll}>
          {busy || `Download all ${total} as .zip`}
        </button>
        <div>
          <span class="label">or one at a time, in posting order</span>
          <div class="flex flex-wrap gap-1.5">
            {#each byOrder as t (t.i)}
              <button type="button" class="chip" disabled={!!busy} onclick={() => downloadOne(t.i, t.order)} aria-label={`Download tile ${t.order}`}>{two(t.order)}</button>
            {/each}
          </div>
        </div>
        <button type="button" class="btn" disabled={!!busy} onclick={reset}>Choose another image</button>
      </div>
    {/if}
  </aside>
</div>

<style>
  .stage {
    display: grid;
    place-items: center;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  .frame {
    position: relative;
    overflow: hidden;
    container-type: inline-size;
    border-radius: 4px;
    cursor: grab;
    touch-action: none;
    user-select: none;
    box-shadow: 0 0 0 1px #0006, 0 12px 40px -12px #000c;
    &:active {
      cursor: grabbing;
    }
  }
  .pic {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }
  .line {
    position: absolute;
    background: var(--color-sun);
    box-shadow: 0 0 0 1px #13121180;
    pointer-events: none;
    &.v {
      top: 0;
      bottom: 0;
      width: 1.5px;
      translate: -50% 0;
    }
    &.h {
      left: 0;
      right: 0;
      height: 1.5px;
      translate: 0 -50%;
    }
  }
  .num {
    position: absolute;
    display: grid;
    place-items: center;
    pointer-events: none;
    & b {
      font: 500 1em/1 var(--font-mono);
      padding: 0.45em 0.6em;
      border-radius: 99px;
      background: #131211d9;
      color: var(--color-chalk);
      border: 1px solid #f2ede433;
    }
    & b.first {
      background: var(--color-sun);
      color: var(--color-bg);
      border-color: var(--color-sun);
    }
  }
  .note {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    font-size: 14px;
    color: var(--color-soft);
    & strong {
      font-weight: 500;
    }
  }
  .chip {
    font: 400 12.5px var(--font-mono);
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 8px;
    padding: 6px 9px;
    cursor: pointer;
    &:hover {
      border-color: var(--color-sun);
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
</style>
