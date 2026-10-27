<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { decodeImage, encodeCanvas, imageKind, resizeImage, resolveSize } from '@/engines/image/client';
  import { downloadResult, withExtension, zipFiles } from '@/tools/lib/files';
  import { buildIco, ICO_SIZES, type IcoSet } from '@/tools/lib/favicon/ico';
  import { firstGraphemes, linkTags, nestSvg, shapeRadius, textSvg, webManifest, type Shape } from '@/tools/lib/favicon/markup';

  // output 'ico' (/png-to-ico) makes the single .ico file the main download, with a choice of sizes up to 256
  let { output = 'pack' }: { output?: 'pack' | 'ico' } = $props();
  let icoSet = $state<IcoSet>('favicon');

  // system font stacks, so the favicon.svg looks the same on your site as it does here
  const fonts = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", Times, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };
  type Font = keyof typeof fonts;
  // HEIC and AVIF often arrive without a MIME type on Windows, so list them by extension too
  const accept = 'image/*,.svg,.heic,.heif,.avif';
  const emoji = ['⚡', '🚀', '🌱', '🍕', '✨', '🎯', '🦊'];

  let mode = $state<'image' | 'text'>('image');
  const img = $state({ shape: 'square' as Shape, bgOn: false, bg: '#ffffff', pad: 0, fit: 'fit' as 'fit' | 'fill' });
  const txt = $state({ shape: 'rounded' as Shape, bgOn: true, bg: '#ffd25e', pad: 14, text: 'R', font: 'serif' as Font, bold: false, color: '#131211' });
  const look = $derived(mode === 'image' ? img : txt);
  let siteName = $state('My website');

  /** the source image, pre-shrunk to BASE so each size renders quickly from the same pixels */
  let source = $state.raw<{ name: string; pixels: ImageData; svg?: string; width: number; height: number } | null>(null);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');

  // the source keeps at least BASE px on its short side (so a wide logo can still fill a 512 icon) and at most MAX on its long side
  const BASE = 1024;
  const MAX = 2048;
  const baseScale = (w: number, h: number) => Math.min(BASE / Math.min(w, h), MAX / Math.max(w, h));

  const design = $derived({
    mode,
    source,
    shape: look.shape,
    bg: look.bgOn ? look.bg : undefined,
    pad: look.pad,
    fit: img.fit,
    text: firstGraphemes(txt.text, 2),
    font: fonts[txt.font],
    weight: txt.bold ? 700 : 400,
    color: txt.color,
  });
  type Design = typeof design;
  const ready = $derived(mode === 'image' ? !!source : !!design.text);

  async function rasterizeSvg(file: File, text: string) {
    const url = URL.createObjectURL(file);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      // an svg without width/height reports 0 in some browsers; fall back to its viewBox, then to a square
      const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i);
      const width = el.naturalWidth || Number(vb?.[1]) || BASE;
      const height = el.naturalHeight || Number(vb?.[2]) || BASE;
      const s = baseScale(width, height);
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(width * s), height: Math.round(height * s) });
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let loads = 0;
  async function load(file: File) {
    const id = ++loads;
    loading = true;
    error = '';
    try {
      let next: typeof source;
      if ((await imageKind(file)) === 'svg') {
        const svg = await file.text();
        next = { name: file.name, svg, ...(await rasterizeSvg(file, svg)) };
      } else {
        let pixels = await decodeImage(file);
        const { width, height } = pixels;
        const s = baseScale(width, height);
        if (s < 1) pixels = await resizeImage(pixels, { width: width * s, height: height * s });
        next = { name: file.name, pixels, width, height };
      }
      // a file picked later wins, however long this one took
      if (id !== loads) return;
      source = next;
      mode = 'image';
    } catch {
      if (id === loads) error = "Couldn't read that image. Try a PNG, JPG, WebP or SVG file.";
    } finally {
      if (id === loads) loading = false;
    }
  }
  let picker = $state<HTMLInputElement>();

  let scratch: CanvasRenderingContext2D | undefined;

  /** where to put the text so its visible glyphs fill a box of 1 × 1, centred */
  function textLayout(d: Design) {
    scratch ??= document.createElement('canvas').getContext('2d')!;
    scratch.font = `${d.weight} 100px ${d.font}`;
    const m = scratch.measureText(d.text);
    const k = 1 / Math.max(m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 1);
    return {
      size: 100 * k,
      x: 0.5 + ((m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2) * k,
      y: 0.5 + ((m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2) * k,
    };
  }

  /** draws the icon at size × size; the apple icon is a solid square because iOS rounds it itself */
  async function render(d: Design, size: number, apple = false) {
    const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d')!;
    if (apple) {
      ctx.fillStyle = d.bg ?? '#ffffff';
      ctx.fillRect(0, 0, size, size);
    } else {
      if (d.shape !== 'square') {
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, shapeRadius[d.shape] * size);
        ctx.clip();
      }
      if (d.bg) {
        ctx.fillStyle = d.bg;
        ctx.fillRect(0, 0, size, size);
      }
    }
    const pad = Math.round((size * d.pad) / 100);
    const box = size - 2 * pad;
    if (d.mode === 'image' && d.source) {
      const { pixels } = d.source;
      const { width, height } = resolveSize(pixels.width, pixels.height, { mode: d.fit, width: box, height: box, enlarge: true });
      const bitmap = await createImageBitmap(await resizeImage(pixels, { width, height, method: 'lanczos3' }));
      ctx.beginPath();
      ctx.rect(pad, pad, box, box);
      ctx.clip();
      // drawn 1:1, so the browser never resamples the high-quality resize
      ctx.drawImage(bitmap, pad + Math.round((box - width) / 2), pad + Math.round((box - height) / 2));
      bitmap.close();
    } else if (d.mode === 'text' && d.text) {
      const t = textLayout(d);
      ctx.font = `${d.weight} ${t.size * box}px ${d.font}`;
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, pad + t.x * box, pad + t.y * box);
    }
    return canvas;
  }

  const svg = $derived.by(() => {
    const d = design;
    const box = 100 - 2 * d.pad;
    if (d.mode === 'text') {
      if (!d.text) return;
      const t = textLayout(d);
      return textSvg({ ...d, background: d.bg, fontFamily: d.font, fontWeight: d.weight, fontSize: t.size * box, x: d.pad + t.x * box, y: d.pad + t.y * box });
    }
    if (!d.source?.svg) return;
    // nothing to add, so keep the original file exactly
    if (!d.pad && !d.bg && d.shape === 'square' && d.fit === 'fit') return d.source.svg;
    try {
      return nestSvg(d.source.svg, { padding: d.pad, fit: d.fit, shape: d.shape, background: d.bg, fallbackWidth: d.source.width, fallbackHeight: d.source.height });
    } catch {
      return;
    }
  });

  // preview images: [16, 32, apple 180, large 256]
  let previews = $state.raw<string[]>([]);
  function swap(next: string[]) {
    previews.forEach((u) => URL.revokeObjectURL(u));
    previews = next;
  }
  onDestroy(() => previews.forEach((u) => URL.revokeObjectURL(u)));

  const objectUrl = (c: HTMLCanvasElement) =>
    new Promise<string>((resolve, reject) => c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('encode failed'))), 'image/png'));

  // redraw once the sliders settle rather than on every input event
  $effect(() => {
    const d = design;
    if (!ready) {
      untrack(() => swap([]));
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const urls = await Promise.all([render(d, 16), render(d, 32), render(d, 180, true), render(d, 256)].map(async (c) => objectUrl(await c)));
        if (stale) urls.forEach((u) => URL.revokeObjectURL(u));
        else swap(urls);
      } catch {
        if (!stale) error = "Couldn't draw this icon. Try another image or setting.";
      }
    }, 100);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  const themeColor = $derived(design.bg ?? '#ffffff');
  const tags = $derived(linkTags(!!svg));

  async function download(icoOnly: boolean) {
    busy = true;
    error = '';
    // everything this download needs, as it was when the button was pressed
    const d = design;
    const svgFile = svg;
    const manifest = webManifest(title, themeColor);
    try {
      const png = async (size: number, apple = false) => encodeCanvas(await render(d, size, apple), { format: 'png' });
      // the pack's favicon.ico always holds 16–48; small[0] and small[1] double as the 16 and 32 px PNGs
      const sizes = icoOnly ? ICO_SIZES[icoSet] : ICO_SIZES.favicon;
      const small = await Promise.all(sizes.map((s) => png(s)));
      const entries = await Promise.all(small.map(async (b, i) => ({ size: sizes[i], png: new Uint8Array(await b.arrayBuffer()) })));
      const ico = new Blob([buildIco(entries) as Uint8Array<ArrayBuffer>], { type: 'image/x-icon' });
      // logo.png → logo.ico on the converter page; the favicon page keeps the name browsers look for
      if (icoOnly) return downloadResult(ico, output === 'ico' && d.mode === 'image' && d.source ? withExtension(d.source.name, 'ico') : 'favicon.ico');

      const [apple, a192, a512] = await Promise.all([png(180, true), png(192), png(512)]);
      const files = [
        { name: 'favicon.ico', blob: ico },
        { name: 'favicon-16x16.png', blob: small[0] },
        { name: 'favicon-32x32.png', blob: small[1] },
        { name: 'apple-touch-icon.png', blob: apple },
        { name: 'android-chrome-192x192.png', blob: a192 },
        { name: 'android-chrome-512x512.png', blob: a512 },
        { name: 'site.webmanifest', blob: new Blob([manifest], { type: 'application/manifest+json' }) },
      ];
      if (svgFile) files.splice(1, 0, { name: 'favicon.svg', blob: new Blob([svgFile], { type: 'image/svg+xml' }) });
      downloadResult(await zipFiles(files), 'favicon.zip');
    } catch {
      error = 'Something went wrong while making the files. Please try again.';
    } finally {
      busy = false;
    }
  }

  function onText(e: Event & { currentTarget: HTMLInputElement }) {
    const v = firstGraphemes(e.currentTarget.value, 2);
    e.currentTarget.value = v;
    txt.text = v;
  }

  const title = $derived(siteName.trim() || 'My website');
  const [p16, p32, pApple, pBig] = $derived(previews);
</script>

<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
  <div class="grid content-start gap-5">
    <div class="seg" role="group" aria-label="Icon source">
      <button type="button" aria-pressed={mode === 'image'} onclick={() => (mode = 'image')}>from an image</button>
      <button type="button" aria-pressed={mode === 'text'} onclick={() => (mode = 'text')}>from text or emoji</button>
    </div>

    {#if mode === 'image'}
      {#if source}
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-2 bg-panel-2 px-4 py-3">
          <span class="min-w-0 truncate text-sm">{source.name}<span class="mono block">{source.width} × {source.height}{source.svg ? ' · vector' : ''}</span></span>
          <button type="button" class="btn py-2!" disabled={loading} onclick={() => picker?.click()}>{loading ? 'Reading…' : 'Change'}</button>
          <input
            bind:this={picker}
            type="file"
            {accept}
            hidden
            onchange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = ''; // so picking the same file again still fires
              if (file) load(file);
            }}
          />
        </div>
        <div>
          <span class="label">framing</span>
          <div class="seg" role="group" aria-label="Framing">
            <button type="button" aria-pressed={img.fit === 'fit'} onclick={() => (img.fit = 'fit')}>fit whole image</button>
            <button type="button" aria-pressed={img.fit === 'fill'} onclick={() => (img.fit = 'fill')}>fill (crop to square)</button>
          </div>
        </div>
      {:else}
        <Dropzone {accept} title={output === 'ico' ? 'Drop a PNG to turn into an .ico' : 'Drop your logo here'} hint="PNG, JPG, WebP or SVG · square works best" onfiles={(f) => load(f[0])} />
        {#if loading}<p class="mono" aria-live="polite">reading image…</p>{/if}
      {/if}
    {:else}
      <div class="grid gap-3">
        <label>
          <span class="label">letters or emoji · up to 2</span>
          <input class="field text-2xl! font-serif!" value={txt.text} oninput={onText} placeholder="R" />
        </label>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="Quick emoji">
          {#each emoji as e}
            <button type="button" class="emoji" onclick={() => (txt.text = e)} aria-label={`Use ${e}`}>{e}</button>
          {/each}
        </div>
        <p class="mono">Win + . or Ctrl + Cmd + Space opens your emoji picker</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <span class="label">font</span>
          <div class="seg" role="group" aria-label="Font">
            {#each Object.keys(fonts) as Font[] as f}
              <button type="button" aria-pressed={txt.font === f} onclick={() => (txt.font = f)}>{f}</button>
            {/each}
          </div>
        </div>
        <div>
          <span class="label">weight</span>
          <div class="seg" role="group" aria-label="Font weight">
            <button type="button" aria-pressed={!txt.bold} onclick={() => (txt.bold = false)}>regular</button>
            <button type="button" aria-pressed={txt.bold} onclick={() => (txt.bold = true)}>bold</button>
          </div>
        </div>
        <label class="flex items-center gap-3">
          <input type="color" bind:value={txt.color} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
          <span class="mono">text {txt.color}</span>
        </label>
      </div>
    {/if}

    {#if ready}
      <div class="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <div>
          <span class="label">shape</span>
          <div class="seg" role="group" aria-label="Shape">
            {#each ['square', 'rounded', 'circle'] as const as s}
              <button type="button" aria-pressed={look.shape === s} onclick={() => (look.shape = s)}>{s}</button>
            {/each}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={look.bgOn} /> background</label>
          <input type="color" bind:value={look.bg} disabled={!look.bgOn} aria-label="Background color" class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent disabled:opacity-40" />
          <span class="mono">{look.bgOn ? look.bg : 'transparent'}</span>
        </div>
        <label class="sm:col-span-2">
          <span class="label">padding · {look.pad}%</span>
          <input type="range" min="0" max="30" bind:value={look.pad} class="w-full accent-(--color-sun)" />
        </label>
        <label class="sm:col-span-2">
          <span class="label">site name · for the tab preview and web manifest</span>
          <input class="field" bind:value={siteName} maxlength="60" />
        </label>
      </div>

      {#if output === 'ico'}
        <div>
          <span class="label">sizes inside the .ico</span>
          <div class="seg" role="group" aria-label="ICO sizes">
            <button type="button" aria-pressed={icoSet === 'favicon'} onclick={() => (icoSet = 'favicon')}>website favicon</button>
            <button type="button" aria-pressed={icoSet === 'windows'} onclick={() => (icoSet = 'windows')}>Windows icon</button>
          </div>
          <p class="mono mt-2">{ICO_SIZES[icoSet].join(', ')} px</p>
        </div>
        <div class="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
          <button type="button" class="btn btn-primary" disabled={busy} onclick={() => download(true)}>{busy ? 'Making…' : 'Download .ico'}</button>
          <button type="button" class="btn" disabled={busy} onclick={() => download(false)}>full favicon pack (.zip)</button>
        </div>
      {:else}
        <div class="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
          <button type="button" class="btn btn-primary" disabled={busy} onclick={() => download(false)}>{busy ? 'Packing…' : 'Download favicon pack (.zip)'}</button>
          <button type="button" class="btn" disabled={busy} onclick={() => download(true)}>favicon.ico only</button>
        </div>
        <p class="mono">ico (16, 32, 48){svg ? ' · svg' : ''} · 16 & 32 png · apple-touch 180 · android 192 & 512 · webmanifest</p>
      {/if}
    {/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
  </div>

  <div class="grid content-start gap-4" class:dim={!ready} role="group" aria-label="Previews">
    <div class="grid gap-4 sm:grid-cols-2">
      <figure class="tile grid content-between gap-4">
        <div class="checker mx-auto grid size-36 place-items-center rounded-xl">
          {#if pBig}<img src={pBig} alt="Your favicon, enlarged" class="size-32" />{/if}
        </div>
        <figcaption class="grid gap-2">
          <span class="label mb-0!">actual size</span>
          <div class="flex gap-2">
            {#each [['#131211', 'dark'], ['#ffffff', 'light']] as [color, name]}
              <div class="flex flex-1 items-center justify-center gap-3 rounded-lg border border-line-2 py-2.5" style:background={color}>
                {#if p16}
                  <img src={p16} alt={`16 pixel favicon on ${name}`} width="16" height="16" />
                  <img src={p32} alt={`32 pixel favicon on ${name}`} width="32" height="32" />
                {/if}
              </div>
            {/each}
          </div>
        </figcaption>
      </figure>

      <figure class="tile phone" aria-label="Phone home screen preview">
        <div class="screen">
          <div class="app">
            <span class="icon ours">{#if pApple}<img src={pApple} alt="Your apple-touch icon on a home screen" />{/if}</span>
            <span class="name">{title}</span>
          </div>
          {#each ['#ff8f6b', '#7cc4ff', '#9be58f', '#c8a6ff', '#ffd25e', '#5fe0d0', '#ff8fb8'] as tint}
            <div class="app" aria-hidden="true">
              <span class="icon" style:--tint={tint}></span>
              <span class="name bar"></span>
            </div>
          {/each}
        </div>
      </figure>
    </div>

    {#each ['dark', 'light'] as theme}
      <div class={`browser ${theme}`} role="group" aria-label={`Browser tab preview, ${theme} theme`}>
        <div class="tabs">
          <div class="tab active">
            {#if p16}<img src={p16} srcset={`${p16} 1x, ${p32} 2x`} alt="" width="16" height="16" />{/if}
            <span class="truncate">{title}</span>
            <span class="x" aria-hidden="true">×</span>
          </div>
          <div class="tab" aria-hidden="true"><span class="dot"></span><span class="truncate">New tab</span></div>
        </div>
        <div class="address" aria-hidden="true"><span>yoursite.com</span></div>
      </div>
    {/each}
    {#if !ready}<p class="mono -mt-1">{mode === 'image' ? 'add an image' : 'type a letter or pick an emoji'} to see your icon here</p>{/if}
  </div>
</div>

{#if ready}
  <div class="mt-8 grid gap-3 border-t border-line pt-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-2xl">Add it to your site</h3>
        <p class="text-sm text-soft">Unzip the files into your site's root folder, then paste these tags inside <code class="mono">&lt;head&gt;</code>.</p>
      </div>
      <CopyButton text={tags} label="Copy HTML" />
    </div>
    <pre class="snippet mono"><code>{tags}</code></pre>
  </div>
{/if}

<style>
  .dim {
    opacity: 0.4;
  }
  .tile {
    margin: 0;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
  }
  .checker {
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
  }
  .emoji {
    font-size: 20px;
    line-height: 1;
    padding: 8px;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    background: transparent;
    cursor: pointer;
    &:hover {
      border-color: var(--color-sun);
    }
  }

  /* phone home screen */
  .phone {
    display: grid;
    padding: 10px;
  }
  .screen {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    align-content: start;
    gap: 14px 8px;
    min-height: 196px;
    padding: 22px 12px;
    border-radius: 24px;
    background: radial-gradient(120% 90% at 20% 0%, #5a3f7a, transparent 60%), radial-gradient(120% 100% at 100% 100%, #b4573c, transparent 60%), #1d1a2b;
  }
  .app {
    display: grid;
    justify-items: center;
    gap: 5px;
    min-width: 0;
  }
  .icon {
    width: 100%;
    max-width: 52px;
    aspect-ratio: 1;
    /* the mask iOS puts on home screen icons */
    border-radius: 23%;
    overflow: hidden;
    background: linear-gradient(160deg, color-mix(in srgb, var(--tint) 85%, white), var(--tint));
    opacity: 0.85;
    & img {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .icon.ours {
    opacity: 1;
    background: #fff;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    font: 500 10px/1.2 var(--font-sans);
    color: #fff;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .name.bar {
    width: 70%;
    height: 6px;
    margin-top: 3px;
    border-radius: 3px;
    background: #ffffff40;
  }

  /* browser tab strip */
  .browser {
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    font: 400 12.5px/1 var(--font-sans);
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 8px 0;
    background: var(--strip);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 220px;
    min-width: 0;
    padding: 9px 12px;
    border-radius: 9px 9px 0 0;
    color: var(--dim);
    & img {
      flex: none;
    }
  }
  .tab.active {
    background: var(--active);
    color: var(--ink);
  }
  .x {
    margin-left: auto;
    color: var(--dim);
  }
  .dot {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dim);
    opacity: 0.4;
  }
  .address {
    padding: 7px 10px 9px;
    background: var(--active);
    color: var(--dim);
    & span {
      display: block;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--strip);
    }
  }
  .dark {
    --strip: #1f2023;
    --active: #35363a;
    --ink: #e8eaed;
    --dim: #9aa0a6;
  }
  .light {
    --strip: #dee1e6;
    --active: #ffffff;
    --ink: #202124;
    --dim: #5f6368;
  }

  .snippet {
    margin: 0;
    overflow-x: auto;
    padding: 16px 18px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
    color: var(--color-soft);
    line-height: 1.7;
    white-space: pre;
  }
</style>
