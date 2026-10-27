<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { decodeImage } from '@/engines/image/client';
  import { downloadBlob, withExtension, withSuffix } from '@/tools/lib/files';
  import { extractPalette, type Swatch } from '@/tools/lib/palette';
  import { describe, isLight, parseColor, toHex, type Rgba } from '@/tools/lib/image-color-picker/color';
  import { codeFormats, paletteCode, percent, type CodeFormat } from '@/tools/lib/image-color-picker/export';

  type EyeDropperApi = new () => { open(): Promise<{ sRGBHex: string }> };

  /** largest side of the on-screen copy; picking always reads the full-size pixels */
  const DISPLAY_MAX = 2000;
  /** tiny images (icons, pixel art) are blown up to at least this, with crisp pixels */
  const DISPLAY_MIN = 480;
  /** the palette is worked out on a copy this small, which is plenty to find the main colors */
  const PALETTE_SIDE = 200;
  const CELLS = 15;
  const CELL = 10;
  const LOUPE = CELLS * CELL;

  let file = $state<File | null>(null);
  let image = $state.raw<ImageData | null>(null);
  let sample = $state.raw<ImageData | null>(null);
  let loading = $state(false);
  let error = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let loupe = $state<HTMLCanvasElement>();

  /** the inspected pixel (image coordinates) and where it sits on the stage */
  let point = $state<{ x: number; y: number; sx: number; sy: number } | null>(null);
  let touching = false;

  let picked = $state<Rgba[]>([]);
  let active = $state<Rgba | null>(null);
  let count = $state(6);
  /** null while it is being worked out; empty when the image has no opaque pixels */
  let palette = $state.raw<Swatch[] | null>(null);
  let changeInput = $state<HTMLInputElement>();
  let codeFormat = $state<CodeFormat>('css');
  let eyeDropper = $state<EyeDropperApi>();

  onMount(() => {
    eyeDropper = (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper;
    // the dropzone handles paste until an image is open; after that, a paste swaps it
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files[0];
      if (image && f && (f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name))) load([f]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  function pixelAt(img: ImageData, x: number, y: number): Rgba {
    const i = (y * img.width + x) * 4;
    const d = img.data;
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  }

  const live = $derived(point && image ? pixelAt(image, point.x, point.y) : null);
  const shown = $derived(live ?? active);
  const info = $derived(shown ? describe(shown) : null);
  const activeHex = $derived(active ? toHex(active) : '');
  const activeIsPicked = $derived(picked.some((p) => toHex(p) === activeHex));
  const code = $derived(palette?.length ? paletteCode(palette, codeFormat) : '');

  /** bumped on every load and close, so a slow decode can't replace a newer image */
  let loadId = 0;

  async function load(files: File[]) {
    const f = files[0];
    if (!f) return;
    const id = ++loadId;
    loading = true;
    error = '';
    try {
      const img = await decodeImage(f);
      if (id !== loadId) return;
      image = img;
      sample = null;
      palette = null;
      point = null;
      file = f;
    } catch {
      if (id === loadId) error = "Couldn't read that image. Try a JPG, PNG, WebP, AVIF, HEIC, GIF or SVG.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  // draw the on-screen copy and the small palette copy whenever a new image arrives
  $effect(() => {
    const img = image;
    const cv = canvas;
    if (!img || !cv) return;
    let cancelled = false;
    createImageBitmap(img).then((bmp) => {
      if (cancelled) return bmp.close();
      const side = Math.max(img.width, img.height);
      const scale = side > DISPLAY_MAX ? DISPLAY_MAX / side : Math.max(1, Math.floor(DISPLAY_MIN / side));
      // a 1px-wide strip would otherwise round to a 0px canvas that can't be pointed at
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);

      const ps = Math.min(1, PALETTE_SIDE / side);
      const small = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.width * ps)), height: Math.max(1, Math.round(img.height * ps)) });
      const sctx = small.getContext('2d', { willReadFrequently: true })!;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(bmp, 0, 0, small.width, small.height);
      sample = sctx.getImageData(0, 0, small.width, small.height);
      bmp.close();
    }).catch(() => {
      if (!cancelled) error = "This image is too large for your browser to display. Try a smaller copy.";
    });
    return () => (cancelled = true);
  });

  $effect(() => {
    const s = sample;
    const k = count;
    if (!s) return;
    const t = setTimeout(() => (palette = extractPalette(s.data, k)), 100);
    return () => clearTimeout(t);
  });

  /** image pixel → its centre on the stage, so the loupe snaps to whole pixels */
  function place(x: number, y: number) {
    if (!canvas || !stage || !image) return null;
    const r = canvas.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x, y, sx: r.left - s.left + ((x + 0.5) / image.width) * r.width, sy: r.top - s.top + ((y + 0.5) / image.height) * r.height };
  }

  function fromEvent(e: MouseEvent) {
    if (!canvas || !image) return null;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * image.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * image.height);
    return place(Math.max(0, Math.min(image.width - 1, x)), Math.max(0, Math.min(image.height - 1, y)));
  }

  function pick(c: Rgba) {
    const hex = toHex(c);
    picked = [c, ...picked.filter((p) => toHex(p) !== hex)].slice(0, 32);
    active = c;
  }

  function remove(hex: string) {
    picked = picked.filter((p) => toHex(p) !== hex);
    active = picked[0] ?? null;
  }

  function onPointerDown(e: PointerEvent) {
    // on touch the loupe shows while the finger is down; a pan cancels it and scrolls as usual
    if (e.pointerType !== 'touch') return;
    touching = true;
    point = fromEvent(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && !touching) return;
    point = fromEvent(e);
  }

  function onPointerEnd(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    touching = false;
    point = null;
  }

  function onClick(e: MouseEvent) {
    const p = fromEvent(e);
    if (p && image) pick(pixelAt(image, p.x, p.y));
  }

  function onKey(e: KeyboardEvent) {
    if (!image) return;
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = steps[e.key];
    if (move) {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      const x = point ? point.x + move[0] * n : image.width >> 1;
      const y = point ? point.y + move[1] * n : image.height >> 1;
      point = place(Math.max(0, Math.min(image.width - 1, x)), Math.max(0, Math.min(image.height - 1, y)));
    } else if ((e.key === 'Enter' || e.key === ' ') && point) {
      e.preventDefault();
      pick(pixelAt(image, point.x, point.y));
    } else if (e.key === 'Escape') {
      point = null;
    }
  }

  // redraw the loupe at most once a frame
  $effect(() => {
    const img = image;
    const cv = loupe;
    if (!point || !img || !cv) return;
    const { x, y } = point;
    const raf = requestAnimationFrame(() => drawLoupe(cv, img, x, y));
    return () => cancelAnimationFrame(raf);
  });

  function drawLoupe(cv: HTMLCanvasElement, img: ImageData, x: number, y: number) {
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const half = CELLS >> 1;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = x + dx;
        const py = y + dy;
        const cx = (dx + half) * CELL;
        const cy = (dy + half) * CELL;
        const inside = px >= 0 && py >= 0 && px < img.width && py < img.height;
        const c = inside ? pixelAt(img, px, py) : null;
        if (!c || c.a < 255) {
          ctx.fillStyle = (dx + dy) & 1 ? '#2a2926' : '#1f1e1b';
          ctx.fillRect(cx, cy, CELL, CELL);
        }
        if (c) {
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
          ctx.fillRect(cx, cy, CELL, CELL);
        }
      }
    }
    ctx.strokeStyle = 'rgba(19,18,17,0.22)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 1; i < CELLS; i++) {
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, LOUPE);
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(LOUPE, i * CELL);
    }
    ctx.stroke();
    const m = half * CELL;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#131211';
    ctx.strokeRect(m - 0.5, m - 0.5, CELL + 1, CELL + 1);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(m - 0.5, m - 0.5, CELL + 1, CELL + 1);
  }

  /** keep the loupe beside the pointer (above it, so a finger doesn't hide it) and inside the stage */
  const loupeAt = $derived.by(() => {
    if (!point || !stage) return null;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const h = LOUPE + 30;
    const gap = 22;
    let left = point.sx + gap;
    if (left + LOUPE > W - 6) left = point.sx - gap - LOUPE;
    let top = point.sy - gap - h;
    if (top < 6) top = point.sy + gap;
    return { left: Math.max(6, Math.min(W - LOUPE - 6, left)), top: Math.max(6, Math.min(H - h - 6, top)) };
  });

  async function pickFromScreen() {
    if (!eyeDropper) return;
    try {
      const { sRGBHex } = await new eyeDropper().open();
      const c = parseColor(sRGBHex);
      if (c) pick(c);
    } catch {
      // closed with Escape
    }
  }

  function reset() {
    loadId++;
    loading = false;
    error = '';
    image = null;
    sample = null;
    palette = null;
    file = null;
    point = null;
  }

  function downloadStrip() {
    if (!palette?.length) return;
    const W = 240;
    const H = 320;
    const colors = palette;
    const cv = Object.assign(document.createElement('canvas'), { width: W * colors.length, height: H });
    const ctx = cv.getContext('2d')!;
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace';
    colors.forEach((c, i) => {
      ctx.fillStyle = toHex(c);
      ctx.fillRect(i * W, 0, W, H);
      ctx.fillStyle = isLight(c) ? '#131211' : '#f2ede4';
      ctx.font = `500 26px ${mono}`;
      ctx.fillText(toHex(c).toUpperCase(), i * W + 22, H - 52);
      ctx.font = `400 18px ${mono}`;
      ctx.globalAlpha = 0.7;
      ctx.fillText(percent(c.share), i * W + 22, H - 24);
      ctx.globalAlpha = 1;
    });
    const name = file ? withSuffix(withExtension(file.name, 'png'), '-palette') : 'palette.png';
    cv.toBlob((blob) => blob && downloadBlob(blob, name), 'image/png');
  }

  const rows = $derived(info ? ([['HEX', info.hex], ['RGB', info.rgb], ['HSL', info.hsl], ['OKLCH', info.oklch], ['CSS name', info.named.name]] as const) : []);
</script>

{#snippet eyeDropperButton()}
  {#if eyeDropper}
    <button type="button" class="btn" onclick={pickFromScreen}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
      Pick from screen
    </button>
  {/if}
{/snippet}

{#if !image && !picked.length}
  <div class="grid gap-4">
    <Dropzone accept="image/*,.heic,.heif,.avif" title="Drop an image to pick colors" hint="or click to choose" onfiles={load} />
    {#if loading}<p class="mono" aria-live="polite">reading image…</p>{/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
    {#if eyeDropper}
      <div class="flex flex-wrap items-center gap-3">
        {@render eyeDropperButton()}
        <span class="mono">grab a color from anywhere on your screen, no image needed</span>
      </div>
    {/if}
  </div>
{:else}
  <div class="grid gap-8">
    <div class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div class="grid min-w-0 content-start gap-3">
        {#if image}
          <div class="stage" bind:this={stage}>
            <canvas
              bind:this={canvas}
              class="pic"
              tabindex="0"
              aria-label="Image. Hover or use the arrow keys to inspect a pixel, click or press Enter to pick its color."
              onpointerdown={onPointerDown}
              onpointermove={onPointerMove}
              onpointerup={onPointerEnd}
              onpointercancel={onPointerEnd}
              onpointerleave={(e) => e.pointerType !== 'touch' && (point = null)}
              onclick={onClick}
              onkeydown={onKey}
              onblur={() => (point = null)}
            ></canvas>
            {#if point && loupeAt && live}
              <div class="loupe" style:left="{loupeAt.left}px" style:top="{loupeAt.top}px" aria-hidden="true">
                <canvas bind:this={loupe} width={LOUPE * 2} height={LOUPE * 2}></canvas>
                <span class="mono">{toHex(live)} · {point.x}, {point.y}</span>
              </div>
            {/if}
          </div>
        {:else}
          <Dropzone accept="image/*,.heic,.heif,.avif" title="Drop an image to pick colors" hint="or click to choose" onfiles={load} />
          {#if loading}<p class="mono" aria-live="polite">reading image…</p>{/if}
        {/if}
        {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
        <div class="flex flex-wrap items-center gap-3">
          {#if image}
            <button type="button" class="btn" disabled={loading} onclick={() => changeInput?.click()}>{loading ? 'Reading…' : 'Change image'}</button>
            <input
              bind:this={changeInput}
              type="file"
              accept="image/*,.heic,.heif,.avif"
              hidden
              onchange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = ''; // so choosing the same file again still fires
                if (files.length) load(files);
              }}
            />
          {/if}
          {@render eyeDropperButton()}
          {#if image}
            <button type="button" class="btn" onclick={reset}>Close image</button>
            <span class="mono ml-auto hidden sm:inline">{image.width} × {image.height} · arrows + Enter work too</span>
          {/if}
        </div>
      </div>

      <div class="grid min-w-0 content-start gap-5">
        {#if info && shown}
          <div class="flex items-center gap-4">
            <div class="chip big" style:--c={info.hex} role="img" aria-label="Color {info.hex}"></div>
            <div class="min-w-0">
              <p class="mono">{live ? 'under the cursor' : 'selected'}</p>
              <p class="font-serif text-4xl leading-tight">{info.hex}</p>
              <p class="text-soft text-sm">{info.named.exact ? '' : '≈ '}{info.named.name}</p>
            </div>
          </div>
          <dl class="grid gap-2">
            {#each rows as [label, value] (label)}
              <div class="row">
                <dt class="label mb-0!">{label}</dt>
                <dd class="mono truncate text-chalk!">{value}</dd>
                <CopyButton text={value} class="px-3! py-2! text-[13px]!" />
              </div>
            {/each}
          </dl>
        {:else}
          <div class="hint">
            <p class="font-serif text-2xl">Point at any pixel</p>
            <p class="text-soft text-sm">Hover over the image to see its exact color through the magnifier. Click (or tap) to pick it.</p>
          </div>
        {/if}

        <div class="grid gap-3 border-t border-line pt-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="label mb-0!">picked · {picked.length}</span>
            {#if picked.length}
              <div class="flex flex-wrap gap-2">
                {#if active && activeIsPicked}
                  <button type="button" class="btn px-3! py-2! text-[13px]!" onclick={() => remove(activeHex)}>Remove</button>
                {/if}
                <CopyButton text={() => picked.map((p) => toHex(p)).join('\n')} label="Copy all" class="px-3! py-2! text-[13px]!" />
                <button type="button" class="btn px-3! py-2! text-[13px]!" onclick={() => ((picked = []), (active = null))}>Clear</button>
              </div>
            {/if}
          </div>
          {#if picked.length}
            <div class="flex flex-wrap gap-2">
              {#each picked as p (toHex(p))}
                {@const hex = toHex(p)}
                <button type="button" class="chip" style:--c={hex} aria-pressed={hex === activeHex} aria-label="Show {hex}" title={hex} onclick={() => (active = p)}></button>
              {/each}
            </div>
          {:else}
            <p class="mono">colors you click on are kept here</p>
          {/if}
        </div>
      </div>
    </div>

    {#if image}
      <section class="grid gap-5 border-t border-line pt-6" aria-label="Dominant palette">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 class="text-3xl">Dominant palette</h3>
            <p class="mono">the main colors in this image and how much of it each covers</p>
          </div>
          <label class="w-full sm:w-60">
            <span class="label">colors · {count}</span>
            <input type="range" min="5" max="10" bind:value={count} class="w-full accent-(--color-sun)" />
          </label>
        </div>

        {#if palette?.length}
          <div class="bar" aria-hidden="true">
            {#each palette as c}<span style:flex-grow={c.share} style:background={toHex(c)}></span>{/each}
          </div>
          <div class="swatches">
            {#each palette as c}
              {@const hex = toHex(c)}
              <button type="button" class="swatch" aria-pressed={hex === activeHex} onclick={() => (active = { ...c, a: 255 })}>
                <span class="fill" style:background={hex}></span>
                <span class="flex items-baseline justify-between gap-2 px-3 py-2.5">
                  <span class="mono text-chalk!">{hex}</span>
                  <span class="mono">{percent(c.share)}</span>
                </span>
              </button>
            {/each}
          </div>

          <div class="grid gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="seg" role="group" aria-label="Export format">
                {#each codeFormats as [value, label]}
                  <button type="button" aria-pressed={codeFormat === value} onclick={() => (codeFormat = value)}>{label}</button>
                {/each}
              </div>
              <div class="flex flex-wrap gap-2">
                <CopyButton text={code} label="Copy code" />
                <button type="button" class="btn btn-primary" onclick={downloadStrip}>Download PNG</button>
              </div>
            </div>
            <pre class="code mono" aria-label="Palette code">{code}</pre>
          </div>
        {:else if palette}
          <p class="mono">this image is fully transparent, so there are no colors to group</p>
        {:else}
          <p class="mono" aria-live="polite">finding the main colors…</p>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 300px;
    padding: 12px;
    overflow: hidden;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .pic {
    display: block;
    max-width: 100%;
    max-height: min(70vh, 640px);
    width: auto;
    height: auto;
    border-radius: 6px;
    cursor: crosshair;
    touch-action: manipulation;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  .loupe {
    position: absolute;
    display: grid;
    justify-items: center;
    gap: 6px;
    pointer-events: none;
    & canvas {
      width: 150px;
      height: 150px;
      border-radius: 50%;
      border: 2px solid var(--color-sun);
      box-shadow: 0 10px 30px #0009;
    }
    & span {
      padding: 2px 8px;
      border-radius: 6px;
      background: #131211e6;
      color: var(--color-chalk);
      white-space: nowrap;
    }
  }
  .chip {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background:
      linear-gradient(var(--c), var(--c)),
      repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 12px 12px;
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:hover { transform: translateY(-2px); }
    &[aria-pressed='true'] { outline: 2px solid var(--color-sun); outline-offset: 2px; }
    &.big {
      flex: none;
      width: 84px;
      height: 84px;
      border-radius: 16px;
      cursor: default;
      &:hover { transform: none; }
    }
  }
  .row {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: #141312;
  }
  .hint {
    display: grid;
    gap: 6px;
    padding: 20px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 16px;
  }
  .bar {
    display: flex;
    height: 44px;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    & span { min-width: 3px; }
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 10px;
  }
  .swatch {
    display: grid;
    overflow: hidden;
    padding: 0;
    text-align: left;
    color: inherit;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), border-color 0.2s;
    &:hover { transform: translateY(-2px); border-color: var(--color-muted); }
    &[aria-pressed='true'] { border-color: var(--color-sun); }
    & .fill { height: 72px; }
  }
  .code {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    color: var(--color-soft);
    white-space: pre;
  }
</style>
