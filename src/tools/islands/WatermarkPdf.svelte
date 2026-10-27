<script lang="ts">
  import type { PDFFont } from 'pdf-lib';
  import PdfStampShell, { type Stamp, type StampItem } from './PdfStampShell.svelte';
  import PdfStampPreview, { type Paint } from './PdfStampPreview.svelte';
  import { canvasToBlob, isWinAnsi, loadEditablePdf, missingGlyphs, parsePageRanges, pdfName, savePdf } from '@/engines/pdf';
  import { markPlacements, resolveAngle, type Anchor, type AngleMode, type Placement } from '@/tools/lib/pdf-stamp/geometry';
  import { addWatermark, imageType, previewFont, textBox, type FontFamily, type WatermarkMark } from '@/tools/lib/pdf-stamp/stamp';
  import { cssFont, drawImageBox, drawTextBox } from '@/tools/lib/pdf-stamp/canvas';

  interface Picture {
    id: number;
    name: string;
    bytes: Uint8Array;
    type: 'png' | 'jpg';
    img: HTMLImageElement;
    url: string;
    /** height / width */
    aspect: number;
  }

  let mode = $state<'text' | 'image'>('text');
  let text = $state('CONFIDENTIAL');
  let family = $state<FontFamily>('sans');
  let bold = $state(true);
  let size = $state(64);
  let color = $state('#e5484d');
  let picture = $state.raw<Picture | null>(null);
  let pictureError = $state('');
  let scale = $state(40);
  let opacity = $state(25);
  let angleMode = $state<AngleMode>('diagonal');
  let angle = $state(30);
  let placement = $state<Placement>('mc');
  let margin = $state(36);
  let layer = $state<'over' | 'under'>('over');
  let scope = $state<'all' | 'range'>('all');
  let range = $state('');

  const positions: [Anchor, string][] = [
    ['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'],
    ['ml', 'Middle left'], ['mc', 'Center'], ['mr', 'Middle right'],
    ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right'],
  ];
  const families: [FontFamily, string, string][] = [
    ['sans', 'Sans', 'Helvetica, Arial, sans-serif'],
    ['serif', 'Serif', '"Times New Roman", Times, serif'],
    ['mono', 'Mono', '"Courier New", Courier, monospace'],
  ];
  const angles: [AngleMode, string][] = [['diagonal', 'Diagonal'], ['level', 'Level'], ['custom', 'Custom']];

  // one line: tabs and other breaks can't be drawn by the PDF fonts
  const cfg = $derived({ mode, text: text.replace(/\s+/g, ' ').trim(), family, bold, size, color, picture: picture?.id ?? 0, scale, opacity, angleMode, angle, placement, margin, layer, scope, range });
  type Cfg = typeof cfg;

  const pagesFor = (c: Cfg, numPages: number) => (c.scope === 'all' ? Array.from({ length: numPages }, (_, i) => i) : parsePageRanges(c.range, numPages, { unique: true }));

  let previewItem = $state.raw<StampItem | null>(null);

  const rangeError = $derived.by(() => {
    if (scope !== 'range') return '';
    try {
      parsePageRanges(range, previewItem?.doc.numPages ?? 1e6);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  });

  let missing = $state<string[]>([]);
  $effect(() => {
    const t = mode === 'text' ? text : '';
    const b = bold;
    if (isWinAnsi(t)) {
      missing = [];
      return;
    }
    let cancelled = false;
    missingGlyphs(t, { bold: b })
      .then((m) => !cancelled && (missing = m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const blocker = $derived.by(() => {
    if (mode === 'text' && !text.trim()) return 'Type the watermark text.';
    if (mode === 'image' && !picture) return 'Choose a PNG or JPG for the watermark.';
    if (mode === 'text' && missing.length) return `The PDF font can't draw ${missing.join(' ')}. Remove ${missing.length === 1 ? 'it' : 'them'} to continue.`;
    return rangeError;
  });

  function begin(): Stamp {
    const c = cfg;
    const pic = picture;
    const mark: WatermarkMark = c.mode === 'image' && pic ? { kind: 'image', bytes: pic.bytes, type: pic.type, scale: c.scale } : { kind: 'text', text: c.text, family: c.family, bold: c.bold, size: c.size, color: c.color };
    return async (item, onprogress) => {
      const pages = pagesFor(c, item.doc.numPages);
      const { doc, decrypted } = await loadEditablePdf(item.file, { password: item.password });
      onprogress(0.15);
      const count = await addWatermark(doc, { mark, pages, opacity: c.opacity / 100, angleMode: c.angleMode, angle: c.angle, placement: c.placement, margin: c.margin, under: c.layer === 'under' }, (f) => onprogress(0.15 + f * 0.6));
      onprogress(0.8);
      const blob = await savePdf(doc, { updateFieldAppearances: false });
      const note = [`${count} page${count === 1 ? '' : 's'} watermarked`, decrypted && 'saved without its password'].filter(Boolean).join(' · ');
      return { blob, name: pdfName(item.file.name, '-watermarked'), note };
    };
  }

  /* ---------------- image ---------------- */

  let pictureId = 0;
  async function onPicture(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // a quick second pick wins, even if the first one finishes later
    const id = ++pictureId;
    pictureError = '';
    let bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type) {
      if (id === pictureId) pictureError = `${file.name} isn't a PNG or JPG. Save it as one of those and try again.`;
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      if (id === pictureId) pictureError = `${file.name} couldn't be read. It may be damaged.`;
      return;
    }
    // pdf-lib embeds JPEG bytes as they are and ignores the EXIF rotation the browser (and so the preview) applies
    if (type === 'jpg' && ((await orientationOf(file)) ?? 1) !== 1) bytes = (await uprightJpeg(img)) ?? bytes;
    if (id !== pictureId) {
      URL.revokeObjectURL(url);
      return;
    }
    removePicture();
    picture = { id, name: file.name, bytes, type, img, url, aspect: img.naturalHeight / img.naturalWidth || 1 };
  }

  async function orientationOf(file: File) {
    const { default: exifr } = await import('exifr');
    return exifr.orientation(file).catch(() => undefined);
  }

  /** Re-encodes a photo the way the browser shows it, upright */
  async function uprightJpeg(img: HTMLImageElement) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    try {
      return new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
    } catch {
      return null;
    } finally {
      canvas.width = 0;
    }
  }

  function removePicture() {
    if (picture) URL.revokeObjectURL(picture.url);
    picture = null;
  }

  $effect(() => () => {
    if (picture) URL.revokeObjectURL(picture.url);
  });

  /* ---------------- preview ---------------- */

  let look = $state.raw<{ c: Cfg; font: PDFFont | null; pic: Picture | null } | null>(null);
  $effect(() => {
    const c = cfg;
    const pic = picture;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const font = c.mode === 'text' && c.text ? await previewFont(c.family, c.bold, c.text) : null;
        if (!cancelled) look = { c, font, pic };
      } catch {
        // the Unicode font didn't load; keep the last preview
      }
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  function paintFor(numPages: number): Paint | null {
    if (!look) return null;
    const { c, font, pic } = look;
    let pages: Set<number>;
    try {
      pages = new Set(pagesFor(c, numPages));
    } catch {
      return null;
    }
    const box = c.mode === 'text' && font ? textBox(font, c.text, c.size) : null;
    const img = c.mode === 'image' ? pic : null;
    if (!box && !img) return null;
    const css = cssFont(c.family, c.bold, !isWinAnsi(c.text), c.size);
    return (ctx, page, which) => {
      if (which !== c.layer || !pages.has(page.index)) return;
      const w = box ? box.width : (page.width * c.scale) / 100;
      const h = box ? box.height : w * img!.aspect;
      const a = resolveAngle(c.angleMode, c.angle, page.width, page.height);
      ctx.globalAlpha = c.opacity / 100;
      ctx.fillStyle = c.color;
      for (const m of markPlacements(page.width, page.height, w, h, { angle: a, placement: c.placement, margin: c.margin, unit: !box })) {
        ctx.save();
        ctx.transform(...m);
        if (box) drawTextBox(ctx, c.text, css, box);
        else drawImageBox(ctx, img!.img);
        ctx.restore();
      }
    };
  }

  function captionFor(numPages: number) {
    const c = look?.c ?? cfg;
    let pages: Set<number> | null = null;
    try {
      pages = new Set(pagesFor(c, numPages));
    } catch {
      // the settings panel shows the range error
    }
    return (i: number) => `p. ${i + 1}${pages && !pages.has(i) ? ' · left as is' : ''}`;
  }

  function pick(p: Placement) {
    // a level tiled pattern reads as stripes; tilt it unless the user already chose an angle
    if (p === 'tile' && placement !== 'tile' && angleMode === 'level') angleMode = 'diagonal';
    placement = p;
  }

  const settingsKey = $derived(JSON.stringify(cfg));
</script>

<PdfStampShell action="Add watermark" verb="Watermarking" zipName="watermarked-pdfs.zip" {settingsKey} {blocker} {begin} onselect={(i) => (previewItem = i)}>
  {#snippet preview(item)}
    <PdfStampPreview doc={item.doc} paint={paintFor(item.doc.numPages)} caption={captionFor(item.doc.numPages)} label="Watermark preview" />
  {/snippet}

  <div class="seg" role="group" aria-label="Watermark type">
    <button type="button" aria-pressed={mode === 'text'} onclick={() => (mode = 'text')}>Text</button>
    <button type="button" aria-pressed={mode === 'image'} onclick={() => (mode = 'image')}>Image</button>
  </div>

  {#if mode === 'text'}
    <div class="grid gap-3">
      <label><span class="label">text</span><input class="field" bind:value={text} placeholder="CONFIDENTIAL" /></label>
      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label="Font">
          {#each families as [f, name, css] (f)}
            <button type="button" aria-pressed={family === f} onclick={() => (family = f)} style:font-family={css}>{name}</button>
          {/each}
        </div>
        <div class="seg" role="group" aria-label="Weight">
          <button type="button" aria-pressed={bold} onclick={() => (bold = !bold)} aria-label="Bold"><b>B</b></button>
        </div>
      </div>
      <label>
        <span class="label">size · {size} pt</span>
        <input type="range" min="8" max="200" bind:value={size} class="w-full accent-(--color-sun)" />
      </label>
      <label class="flex items-center gap-3">
        <input type="color" bind:value={color} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
        <span class="mono">color {color}</span>
      </label>
    </div>
  {:else}
    <div class="grid gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="btn upload cursor-pointer">
          {picture ? 'Change image' : 'Choose an image'}
          <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" class="sr-only" onchange={onPicture} />
        </label>
        {#if picture}<button type="button" class="btn" onclick={removePicture}>Remove</button>{/if}
      </div>
      {#if pictureError}
        <p class="text-sm text-bad" role="alert">{pictureError}</p>
      {:else}
        <p class="mono truncate">{picture ? picture.name : 'PNG or JPG · a PNG with transparency works best'}</p>
      {/if}
      <label>
        <span class="label">size · {scale}% of page width</span>
        <input type="range" min="5" max="100" bind:value={scale} class="w-full accent-(--color-sun)" />
      </label>
    </div>
  {/if}

  <label>
    <span class="label">opacity · {opacity}%</span>
    <input type="range" min="5" max="100" bind:value={opacity} class="w-full accent-(--color-sun)" />
  </label>

  <div class="grid gap-2">
    <span class="label" id="wm-angle">rotation</span>
    <div class="seg" role="group" aria-labelledby="wm-angle">
      {#each angles as [value, name] (value)}
        <button type="button" aria-pressed={angleMode === value} onclick={() => (angleMode = value)}>{name}</button>
      {/each}
    </div>
    {#if angleMode === 'custom'}
      <label>
        <span class="label">angle · {angle}°</span>
        <input type="range" min="-90" max="90" bind:value={angle} class="w-full accent-(--color-sun)" />
      </label>
    {:else if angleMode === 'diagonal'}
      <p class="mono">corner to corner on every page</p>
    {/if}
  </div>

  <div>
    <span class="label" id="wm-pos">position</span>
    <div class="flex gap-2">
      <div class="pos" role="group" aria-labelledby="wm-pos">
        {#each positions as [p, name] (p)}
          <button type="button" aria-pressed={placement === p} aria-label={name} title={name} onclick={() => pick(p)}></button>
        {/each}
      </div>
      <button type="button" class="tile" aria-pressed={placement === 'tile'} onclick={() => pick('tile')}>tiled<span class="mono">repeat across</span></button>
    </div>
  </div>

  {#if placement !== 'mc'}
    <label>
      <span class="label">{placement === 'tile' ? 'spacing' : 'margin from edge'} · {margin} pt</span>
      <input type="range" min="0" max="144" step="4" bind:value={margin} class="w-full accent-(--color-sun)" />
    </label>
  {/if}

  <div class="grid gap-2">
    <span class="label" id="wm-layer">layer</span>
    <div class="seg" role="group" aria-labelledby="wm-layer">
      <button type="button" aria-pressed={layer === 'over'} onclick={() => (layer = 'over')}>Over content</button>
      <button type="button" aria-pressed={layer === 'under'} onclick={() => (layer = 'under')}>Under content</button>
    </div>
    {#if layer === 'under'}
      <p class="mono">the page's text stays on top · photos and solid backgrounds hide it, so it won't show on scans</p>
    {/if}
  </div>

  <div class="grid gap-2 border-t border-line pt-5">
    <span class="label" id="wm-pages">pages</span>
    <div class="seg" role="group" aria-labelledby="wm-pages">
      <button type="button" aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>All</button>
      <button type="button" aria-pressed={scope === 'range'} onclick={() => (scope = 'range')}>Choose pages</button>
    </div>
    {#if scope === 'range'}
      <label>
        <span class="sr-only">Pages to watermark</span>
        <input class="field" bind:value={range} placeholder="e.g. 1-3, 8, odd" spellcheck="false" aria-invalid={!!rangeError} />
      </label>
    {/if}
  </div>
</PdfStampShell>

<style>
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
