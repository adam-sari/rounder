<script lang="ts">
  import ImageBatch from '@/components/tool/ImageBatch.svelte';
  import { decodeImage, encodeImage, formatInfo, imageKind, outputFormatFor, toDecodable, type OutputFormat } from '@/engines/image/client';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import { isDark, placeMark, sizeSvg, tileCenters, type Point, type Position } from '@/tools/lib/watermark-image/layout';

  type Font = 'serif' | 'sans' | 'mono' | 'system';
  interface Logo {
    img: HTMLImageElement;
    url: string;
    name: string;
    aspect: number;
    id: number;
  }

  let mode = $state<'text' | 'logo'>('text');
  let text = $state('© Your name');
  let font = $state<Font>('sans');
  let color = $state('#ffffff');
  let shadow = $state(true);
  let logo = $state.raw<Logo | null>(null);
  let logoError = $state('');
  let size = $state(25);
  let opacity = $state(70);
  let rotation = $state(0);
  let position = $state<Position | 'tile'>('br');
  let margin = $state(4);
  let target = $state<'original' | OutputFormat>('original');
  let quality = $state(90);

  const fonts: Record<Font, [weight: number, family: string]> = {
    serif: [400, '"Instrument Serif", Georgia, serif'],
    sans: [600, '"Geist Variable", system-ui, sans-serif'],
    mono: [500, '"Geist Mono Variable", ui-monospace, monospace'],
    system: [600, 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  };
  const fontNames = Object.keys(fonts) as Font[];
  const positions: [Position, string][] = [
    ['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'],
    ['ml', 'Middle left'], ['mc', 'Center'], ['mr', 'Middle right'],
    ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right'],
  ];
  const formats: ['original' | OutputFormat, string][] = [['original', 'same'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']];

  const cfg = $derived({ mode, text: text.trim(), font, color, shadow, logo, size, opacity, rotation, position, margin });
  type Cfg = typeof cfg;
  type Ctx = CanvasRenderingContext2D;
  interface Mark {
    aspect: number;
    draw: (ctx: Ctx, w: number) => void;
  }

  let measurer: Ctx | undefined;

  /** Loads fonts and measures the text once, so drawing afterwards is synchronous */
  async function prepare(c: Cfg): Promise<Mark | null> {
    if (c.mode === 'logo') {
      const l = c.logo;
      return l && { aspect: l.aspect, draw: (ctx, w) => ctx.drawImage(l.img, -w / 2, -w / l.aspect / 2, w, w / l.aspect) };
    }
    if (!c.text) return null;
    const [weight, family] = fonts[c.font];
    await document.fonts.load(`${weight} 100px ${family}`, c.text);
    measurer ??= document.createElement('canvas').getContext('2d')!;
    measurer.font = `${weight} 100px ${family}`;
    const m = measurer.measureText(c.text);
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(inkW > 0 && inkH > 0)) return null;
    const shade = isDark(c.color) ? '#ffffff59' : '#00000059';
    return {
      aspect: inkW / inkH,
      draw(ctx, w) {
        // measured at 100px; scale the font so the ink is exactly w wide, centred on the origin
        const k = w / inkW;
        ctx.font = `${weight} ${100 * k}px ${family}`;
        ctx.fillStyle = c.color;
        if (c.shadow) {
          ctx.shadowColor = shade;
          ctx.shadowBlur = 10 * k;
          ctx.shadowOffsetY = 3 * k;
        }
        ctx.fillText(c.text, ((m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2) * k, ((m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2) * k);
      },
    };
  }

  /** Size and margin are shares of the image, so a mixed batch gets matching marks */
  function stamp(ctx: Ctx, W: number, H: number, c: Cfg, mark: Mark) {
    const angle = (c.rotation * Math.PI) / 180;
    const gap = (Math.min(W, H) * c.margin) / 100;
    let w = (W * c.size) / 100;
    let centers: Point[];
    if (c.position === 'tile') {
      centers = tileCenters(W, H, w, w / mark.aspect, angle, gap);
    } else {
      const p = placeMark(W, H, w, w / mark.aspect, angle, c.position, gap);
      w = p.width;
      centers = [p];
    }
    ctx.save();
    ctx.globalAlpha = c.opacity / 100;
    ctx.imageSmoothingQuality = 'high'; // logos are usually scaled down a lot
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const { x, y } of centers) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      mark.draw(ctx, w);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The browser decoder is fast and EXIF-aware; the engine covers HEIC, TIFF and the rest */
  async function loadBitmap(file: Blob): Promise<ImageBitmap> {
    const src = await toDecodable(file);
    if (src instanceof ImageBitmap) return src;
    try {
      return await createImageBitmap(src);
    } catch {
      return createImageBitmap(await decodeImage(file));
    }
  }

  // full-size canvases are memory hungry, so stamp one photo at a time; encoding still runs in parallel in the workers
  let queue: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  async function process(file: File) {
    const c = cfg;
    const q = quality;
    const want = target;
    const format = want === 'original' ? outputFormatFor(await imageKind(file)) : want;
    let stamped = false;
    const pixels = await oneAtATime(async () => {
      const [bmp, mark] = await Promise.all([loadBitmap(file), prepare(c)]);
      const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bmp.close();
        throw new Error(`At ${bmp.width}×${bmp.height} this photo is too large for this browser to draw`);
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      if (mark) stamp(ctx, canvas.width, canvas.height, c, mark);
      stamped = !!mark;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.height = 0; // frees the backing store now rather than at GC
      return data;
    });
    const blob = await encodeImage(pixels, { format, quality: q, background: '#ffffff' });
    return {
      blob,
      name: withSuffix(withExtension(file.name, formatInfo[format].ext), '-watermarked'),
      width: pixels.width,
      height: pixels.height,
      note: stamped ? undefined : c.mode === 'logo' ? 'no logo yet' : 'no text yet',
    };
  }

  // the preview shows the file selected in ImageBatch's list (null once the list is empty)
  let previewFile = $state.raw<File | null>(null);

  const PREVIEW = 720;
  let base = $state.raw<HTMLCanvasElement | null>(null);
  let unreadable = $state(false);
  let view = $state<HTMLCanvasElement>();

  // decode the preview photo once, downscaled; the live redraws only touch this small copy
  $effect(() => {
    const file = previewFile;
    if (!file) {
      base = null;
      unreadable = false;
      return;
    }
    let cancelled = false;
    loadBitmap(file)
      .then((bmp) => {
        const k = Math.min(1, PREVIEW / Math.max(bmp.width, bmp.height));
        const small = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(bmp.width * k)), height: Math.max(1, Math.round(bmp.height * k)) });
        const ctx = small.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, small.width, small.height);
        bmp.close();
        if (cancelled) return;
        base = small;
        unreadable = false;
      })
      .catch(() => {
        // the file's row in the list shows the error; just don't leave the last photo on screen
        if (cancelled) return;
        base = null;
        unreadable = true;
      });
    return () => {
      cancelled = true;
    };
  });

  // redraw once the sliders pause, like the QR preview
  $effect(() => {
    const c = cfg;
    const src = base;
    const canvas = view;
    if (!src || !canvas) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const mark = await prepare(c);
      if (cancelled) return;
      canvas.width = src.width;
      canvas.height = src.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(src, 0, 0);
      if (mark) stamp(ctx, src.width, src.height, c, mark);
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  let logoId = 0;
  async function onLogo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    logoError = '';
    let blob: Blob = file;
    let aspect = 0;
    if ((await imageKind(file)) === 'svg') {
      const text = await file.text();
      const sized = sizeSvg(text);
      blob = new Blob([sized?.svg ?? text], { type: 'image/svg+xml' });
      aspect = sized?.aspect ?? 0;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      logoError = "That logo couldn't be read. Try a PNG or SVG.";
      return;
    }
    aspect ||= img.naturalWidth / img.naturalHeight;
    removeLogo();
    logo = { img, url, name: file.name, aspect: aspect > 0 && Number.isFinite(aspect) ? aspect : 1, id: ++logoId };
  }

  function removeLogo() {
    if (logo) URL.revokeObjectURL(logo.url);
    logo = null;
  }

  $effect(() => () => {
    if (logo) URL.revokeObjectURL(logo.url);
  });

  function pick(p: Position | 'tile') {
    // a straight tiled pattern looks like a stripe; start diagonal unless the user already tilted it
    if (p === 'tile' && position !== 'tile' && rotation === 0) rotation = -30;
    position = p;
  }

  const settingsKey = $derived(JSON.stringify([mode, text, font, color, shadow, logo?.id, size, opacity, rotation, position, margin, target, quality]));
</script>

<ImageBatch {process} {settingsKey} zipName="watermarked-images.zip" onselect={(file) => (previewFile = file)}>
  {#if previewFile}
    <figure class="grid gap-2">
      <div class="stage">
        {#if unreadable}
          <p class="mono px-4 py-10 text-center">can't preview this file</p>
        {:else}
          <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
          <canvas bind:this={view} role="img" aria-label={`Watermark preview on ${previewFile.name}`}></canvas>
        {/if}
      </div>
      <figcaption class="mono truncate text-center">preview · {previewFile.name}</figcaption>
    </figure>
  {/if}

  <div class="seg" role="group" aria-label="Watermark type">
    <button type="button" aria-pressed={mode === 'text'} onclick={() => (mode = 'text')}>Text</button>
    <button type="button" aria-pressed={mode === 'logo'} onclick={() => (mode = 'logo')}>Logo</button>
  </div>

  {#if mode === 'text'}
    <label><span class="label">text</span><input class="field" bind:value={text} placeholder="© Your name" /></label>
    <div>
      <span class="label">font</span>
      <div class="seg" role="group" aria-label="Font">
        {#each fontNames as f}
          <button type="button" aria-pressed={font === f} onclick={() => (font = f)} style:font-family={fonts[f][1]}>{f}</button>
        {/each}
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <label class="flex items-center gap-3">
        <input type="color" bind:value={color} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
        <span class="mono">color {color}</span>
      </label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={shadow} /> soft shadow</label>
    </div>
  {:else}
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <label class="btn upload cursor-pointer">
          {logo ? 'Change logo' : 'Upload a logo'}
          <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif,.svg" class="sr-only" onchange={onLogo} />
        </label>
        {#if logo}<button type="button" class="btn" onclick={removeLogo}>Remove</button>{/if}
      </div>
      {#if logoError}
        <p class="text-sm text-bad" role="alert">{logoError}</p>
      {:else}
        <p class="mono truncate">{logo ? logo.name : 'a PNG with transparency or an SVG works best'}</p>
      {/if}
    </div>
  {/if}

  <div>
    <span class="label">position</span>
    <div class="flex gap-2">
      <div class="pos" role="group" aria-label="Position">
        {#each positions as [p, label]}
          <button type="button" aria-pressed={position === p} aria-label={label} title={label} onclick={() => pick(p)}></button>
        {/each}
      </div>
      <button type="button" class="tile" aria-pressed={position === 'tile'} onclick={() => pick('tile')}>tiled<span class="mono">repeat across</span></button>
    </div>
  </div>

  <div class="grid gap-3">
    <label>
      <span class="label">size · {size}% of width</span>
      <input type="range" min="5" max="90" bind:value={size} class="w-full accent-(--color-sun)" />
    </label>
    <label>
      <span class="label">opacity · {opacity}%</span>
      <input type="range" min="5" max="100" bind:value={opacity} class="w-full accent-(--color-sun)" />
    </label>
    <label>
      <span class="label">rotation · {rotation}°</span>
      <input type="range" min="-90" max="90" bind:value={rotation} class="w-full accent-(--color-sun)" />
    </label>
    <label>
      <span class="label">{position === 'tile' ? 'spacing' : 'margin'} · {margin}%</span>
      <input type="range" min="0" max="20" bind:value={margin} class="w-full accent-(--color-sun)" />
    </label>
  </div>

  <div class="grid gap-3 border-t border-line pt-5">
    <div>
      <span class="label">save as</span>
      <div class="seg" role="group" aria-label="Output format">
        {#each formats as [value, label]}
          <button type="button" aria-pressed={target === value} onclick={() => (target = value)}>{label}</button>
        {/each}
      </div>
    </div>
    {#if target !== 'png'}
      <label>
        <span class="label">quality · {quality}{target === 'original' ? ' (JPG, WebP, AVIF)' : ''}</span>
        <input type="range" min="50" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
      </label>
    {/if}
  </div>
</ImageBatch>

<style>
  .stage {
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    & canvas {
      display: block;
      max-width: 100%;
      max-height: 360px;
      width: auto;
      height: auto;
    }
  }
  .pos {
    flex: none;
    display: grid;
    grid-template-columns: repeat(3, 28px);
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: #141312;
    & button {
      height: 28px;
      border-radius: 7px;
      border: 1px solid var(--color-line);
      background: var(--color-panel-2);
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s;
      &:hover {
        border-color: var(--color-muted);
      }
      &[aria-pressed='true'] {
        background: var(--color-sun);
        border-color: var(--color-sun);
      }
    }
  }
  .tile {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 2px;
    font: 500 15px/1 var(--font-sans);
    color: var(--color-chalk);
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    cursor: pointer;
    background: repeating-linear-gradient(-30deg, transparent 0 10px, #f2ede40d 10px 11px), #141312;
    transition: border-color 0.15s, color 0.15s;
    &:hover {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .upload:focus-within {
    outline: 2px solid var(--color-sun);
    outline-offset: 2px;
  }
</style>
