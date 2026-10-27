<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas } from '@/engines/image/client';
  import { downloadResult, withExtension, withSuffix } from '@/tools/lib/files';
  import { layoutBox, layoutCaption, lineX, type Align, type BoxLayout, type CaptionLayout, type Measure, type TextBox } from '@/tools/lib/meme-generator/layout';

  type Role = 'top' | 'bottom' | 'extra';
  interface Layer extends TextBox {
    id: number;
    role: Role;
  }
  interface Photo {
    name: string;
    width: number;
    height: number;
    full: ImageBitmap;
    preview: HTMLCanvasElement | ImageBitmap;
  }
  interface SceneBox extends Pick<TextBox, 'color' | 'stroke' | 'strokeColor' | 'align'> {
    id: number;
    name: string;
    l: BoxLayout;
  }
  interface Scene {
    width: number;
    height: number;
    imgW: number;
    imgH: number;
    capH: number;
    cap: CaptionLayout | null;
    capAlign: Align;
    boxes: SceneBox[];
    background: string;
  }

  const PREVIEW_MAX = 1600;
  const COPY_MAX = 4096;
  // iOS Safari refuses canvases above 16.7 megapixels
  const SAFE_AREA = 16_777_216;
  const CAPTION_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  const aspects = { '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080], '9:16': [1080, 1920] } as const;
  type Aspect = keyof typeof aspects;
  const aspectList = Object.keys(aspects) as Aspect[];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let photo = $state.raw<Photo | null>(null);
  let blank = $state(false);
  let aspect = $state<Aspect>('1:1');
  let blankColor = $state('#ffffff');
  let loading = $state(false);
  let error = $state('');

  let style = $state<'classic' | 'caption'>('classic');
  let caption = $state({ text: '', size: 0.055, align: 'left' as Align });

  const classicBox = (id: number, role: 'top' | 'bottom'): Layer => ({
    id, role, text: '', anchor: role, x: 0.5, y: role === 'top' ? 0.1 : 0.9, width: 0.94, size: 0.1,
    color: '#ffffff', stroke: true, strokeColor: '#000000', align: 'center', upper: true,
  });
  let layers = $state<Layer[]>([classicBox(1, 'top'), classicBox(2, 'bottom')]);
  let nextId = 3;
  let selectedId = $state<number | null>(1);

  // Impact isn't on every device; fall back to the heaviest sans the browser has
  let memeFont = $state({ family: 'Impact, sans-serif', weight: 400 });
  let format = $state<'png' | 'jpeg'>('png');
  let busy = $state<'' | 'download' | 'copy'>('');
  let copied = $state(false);
  let canCopy = $state(false);

  let view = $state<HTMLCanvasElement>();
  let overlay = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();

  const started = $derived(!!photo || blank);
  const imgW = $derived(photo?.width ?? aspects[aspect][0]);
  const imgH = $derived(photo?.height ?? aspects[aspect][1]);
  const visible = $derived(style === 'classic' ? layers : layers.filter((l) => l.role === 'extra'));
  const selected = $derived(visible.find((l) => l.id === selectedId));

  let measureCtx: CanvasRenderingContext2D | undefined;
  const measureWith = (font: (px: number) => string): Measure => (text, px) => {
    measureCtx ??= document.createElement('canvas').getContext('2d')!;
    measureCtx.font = font(px);
    return measureCtx.measureText(text).width;
  };
  const memeFontAt = (px: number) => `${memeFont.weight} ${px}px ${memeFont.family}`;
  const captionFontAt = (px: number) => `500 ${px}px ${CAPTION_FONT}`;

  function nameOf(l: Layer) {
    return l.role === 'extra' ? `text ${layers.filter((x) => x.role === 'extra').indexOf(l) + 1}` : `${l.role} text`;
  }

  // full-resolution layout; the preview and the export both paint from this
  const scene = $derived.by((): Scene | null => {
    if (!started) return null;
    const cap = style === 'caption' ? layoutCaption(caption.text, caption.size, imgW, measureWith(captionFontAt)) : null;
    const capH = cap?.height ?? 0;
    const measure = measureWith(memeFontAt);
    return {
      width: imgW,
      height: imgH + capH,
      imgW,
      imgH,
      capH,
      cap,
      capAlign: caption.align,
      boxes: visible.map((b) => ({
        id: b.id, name: nameOf(b), color: b.color, stroke: b.stroke, strokeColor: b.strokeColor, align: b.align,
        l: layoutBox(b, imgW, imgH, measure),
      })),
      background: blankColor,
    };
  });

  function paint(ctx: CanvasRenderingContext2D, sc: Scene, scale: number, img: CanvasImageSource | null) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, sc.width, sc.height);
    ctx.textBaseline = 'middle';
    if (sc.cap) {
      const { lines, px, lineHeight, pad } = sc.cap;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sc.width, sc.capH);
      ctx.fillStyle = '#000000';
      ctx.font = captionFontAt(px);
      ctx.textAlign = sc.capAlign;
      const x = lineX(sc.capAlign, pad, sc.imgW - pad * 2, 0);
      lines.forEach((line, i) => ctx.fillText(line, x, pad + (i + 0.5) * lineHeight));
    }
    if (img) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, sc.capH, sc.imgW, sc.imgH);
    } else {
      ctx.fillStyle = sc.background;
      ctx.fillRect(0, sc.capH, sc.imgW, sc.imgH);
    }
    ctx.translate(0, sc.capH);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (const b of sc.boxes) {
      const { l } = b;
      ctx.font = memeFontAt(l.px);
      ctx.textAlign = b.align;
      const x = lineX(b.align, l.left, l.width, l.strokeWidth / 2);
      l.lines.forEach((line, i) => {
        const y = l.top + (i + 0.5) * l.lineHeight;
        if (b.stroke) {
          ctx.lineWidth = l.strokeWidth;
          ctx.strokeStyle = b.strokeColor;
          ctx.strokeText(line, x, y);
        }
        ctx.fillStyle = b.color;
        ctx.fillText(line, x, y);
      });
    }
  }

  // painting the downscaled preview is cheap, so redraw once per frame and keep dragging smooth
  $effect(() => {
    const sc = scene;
    const img = photo?.preview ?? null;
    const canvas = view;
    if (!sc || !canvas) return;
    const frame = requestAnimationFrame(() => {
      const s = Math.min(1, PREVIEW_MAX / Math.max(sc.width, sc.height));
      const w = Math.round(sc.width * s);
      const h = Math.round(sc.height * s);
      if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
      paint(canvas.getContext('2d')!, sc, s, img);
    });
    return () => cancelAnimationFrame(frame);
  });

  function release(p: Photo | null) {
    if (!p) return;
    p.full.close();
    if (p.preview instanceof HTMLCanvasElement) p.preview.width = 0;
  }

  // a newer load (or Start over) wins over a slow decode that finishes later
  let loadSeq = 0;

  async function load(file: File) {
    const seq = ++loadSeq;
    loading = true;
    error = '';
    try {
      const full = await createImageBitmap(await decodeImage(file));
      if (seq !== loadSeq) return full.close();
      const s = Math.min(1, PREVIEW_MAX / Math.max(full.width, full.height));
      let preview: Photo['preview'] = full;
      if (s < 1) {
        preview = Object.assign(document.createElement('canvas'), { width: Math.round(full.width * s), height: Math.round(full.height * s) });
        const ctx = preview.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(full, 0, 0, preview.width, preview.height);
      }
      release(photo);
      photo = { name: file.name, width: full.width, height: full.height, full, preview };
      blank = false;
    } catch {
      if (seq === loadSeq) error = `Couldn't open ${file.name}. Try a JPG, PNG, WebP, HEIC or GIF.`;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function startBlank() {
    loadSeq++;
    loading = false;
    release(photo);
    photo = null;
    blank = true;
  }

  function startOver() {
    loadSeq++;
    loading = false;
    release(photo);
    photo = null;
    blank = false;
    error = '';
  }

  function pickFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) load(f);
    (e.currentTarget as HTMLInputElement).value = '';
  }

  async function addBox() {
    const id = nextId++;
    layers.push({
      id, role: 'extra', text: 'Your text', anchor: 'free', x: 0.5, y: 0.5, width: 0.7, size: 0.07,
      color: '#ffffff', stroke: true, strokeColor: '#000000', align: 'center', upper: true,
    });
    selectedId = id;
    await tick();
    (document.getElementById(`meme-text-${id}`) as HTMLInputElement | null)?.select();
  }

  function removeBox(id: number) {
    layers = layers.filter((l) => l.id !== id);
    if (selectedId === id) selectedId = visible[0]?.id ?? null;
  }

  function setStyle(next: typeof style) {
    style = next;
    if (!selected) selectedId = visible[0]?.id ?? null;
  }

  /** top/bottom text becomes freely placed the moment it's moved */
  function freeUp(layer: Layer, l: BoxLayout) {
    if (layer.anchor === 'free') return;
    layer.y = (l.top + l.height / 2) / imgH;
    layer.anchor = 'free';
  }

  function resetPosition(layer: Layer) {
    layer.anchor = layer.role === 'top' ? 'top' : 'bottom';
    layer.x = 0.5;
  }

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  let drag: { id: number; px: number; py: number; x: number; y: number; l: BoxLayout } | null = null;

  function onDown(e: PointerEvent, b: SceneBox) {
    selectedId = b.id;
    const layer = layers.find((l) => l.id === b.id);
    if (!layer || e.button !== 0) return;
    drag = { id: b.id, px: e.clientX, py: e.clientY, x: layer.x, y: (b.l.top + b.l.height / 2) / imgH, l: b.l };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag || !overlay || !scene) return;
    const layer = layers.find((l) => l.id === drag!.id);
    if (!layer) return;
    const dxPx = e.clientX - drag.px;
    const dyPx = e.clientY - drag.py;
    // a plain click shouldn't unpin classic top/bottom text
    if (layer.anchor !== 'free' && Math.hypot(dxPx, dyPx) < 4) return;
    freeUp(layer, drag.l);
    const r = overlay.getBoundingClientRect();
    const x = drag.x + dxPx / r.width;
    layer.x = Math.abs(x - 0.5) < 0.012 ? 0.5 : clamp01(x); // gentle snap to the centre line
    layer.y = clamp01(drag.y + ((dyPx / r.height) * scene.height) / scene.imgH);
  }

  function onKey(e: KeyboardEvent, b: SceneBox) {
    const dir = arrows[e.key];
    const layer = layers.find((l) => l.id === b.id);
    if (!dir || !layer) return;
    e.preventDefault();
    selectedId = b.id;
    freeUp(layer, b.l);
    const step = e.shiftKey ? 0.05 : 0.01;
    layer.x = clamp01(layer.x + dir[0] * step);
    layer.y = clamp01(layer.y + dir[1] * step);
  }

  function focusText(id: number) {
    document.getElementById(`meme-text-${id}`)?.focus();
  }

  /** Renders the meme at full size (or capped to maxSide) on a fresh canvas */
  function render(maxSide = Infinity): HTMLCanvasElement {
    const sc = scene!;
    let s = Math.min(1, maxSide / Math.max(sc.width, sc.height));
    for (const attempt of [0, 1]) {
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(sc.width * s), height: Math.round(sc.height * s) });
      const ctx = canvas.getContext('2d');
      if (ctx) {
        paint(ctx, sc, s, photo?.full ?? null);
        return canvas;
      }
      if (attempt === 0) s = Math.min(s, Math.sqrt(SAFE_AREA / (sc.width * sc.height)) * 0.99);
    }
    throw new Error('canvas too large');
  }

  const toPng = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));

  const fileName = $derived(photo ? withSuffix(withExtension(photo.name, format === 'png' ? 'png' : 'jpg'), '-meme') : `meme.${format === 'png' ? 'png' : 'jpg'}`);

  async function download() {
    busy = 'download';
    error = '';
    try {
      const canvas = render();
      // the browser's own PNG encoder is fast on huge images; JPG goes through mozjpeg for smaller files
      const blob = format === 'png' ? await toPng(canvas) : await encodeCanvas(canvas, { format: 'jpeg', quality: 90 });
      canvas.width = 0;
      downloadResult(blob, fileName);
    } catch {
      error = 'Something went wrong while saving. Try JPG, or a smaller image.';
    } finally {
      busy = '';
    }
  }

  async function copy() {
    busy = 'copy';
    error = '';
    try {
      // ClipboardItem gets a promise so Safari still counts this as part of the click
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(render(COPY_MAX)) })]);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      error = "Your browser didn't allow copying the image. Use Download instead.";
    } finally {
      busy = '';
    }
  }

  function detectFont() {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const probe = 'MEME wmIl 0123';
    ctx.font = '40px monospace';
    const base = ctx.measureText(probe).width;
    for (const name of ['Impact', 'Anton', 'Arial Black']) {
      ctx.font = `40px "${name}", monospace`;
      if (ctx.measureText(probe).width !== base) return { family: `"${name}", sans-serif`, weight: 400 };
    }
    return { family: 'sans-serif', weight: 800 };
  }

  onMount(() => {
    memeFont = detectFont();
    canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
    // once editing, pasting or dropping an image swaps it in (the dropzone handles both before that)
    const isImage = (f?: File): f is File => !!f && (f.type.startsWith('image/') || /.(heic|heif|avif)$/i.test(f.name));
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files[0];
      if (started && isImage(f)) load(f);
    };
    // stops the browser opening a file dropped beside the dropzone or onto the editor (text drops still work)
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (started && isImage(f)) load(f);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      release(photo);
    };
  });

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
</script>

{#if !started}
  <div class="grid gap-5">
    <Dropzone accept="image/*,.heic,.heif,.avif" title="Drop an image to meme" hint="JPG, PNG, WebP, HEIC or GIF, or click to choose" onfiles={(f) => load(f[0])} />
    {#if loading}<p class="mono" aria-live="polite">opening your image…</p>{/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
    <div class="flex flex-wrap items-end gap-4 rounded-2xl border border-line-2 p-4">
      <div>
        <span class="label">or start from a blank canvas</span>
        <div class="seg" role="group" aria-label="Canvas shape">
          {#each aspectList as a}
            <button type="button" aria-pressed={aspect === a} onclick={() => (aspect = a)}>{a}</button>
          {/each}
        </div>
      </div>
      <label class="flex items-center gap-2">
        <input type="color" bind:value={blankColor} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
        <span class="mono">background</span>
      </label>
      <button type="button" class="btn" onclick={startBlank}>Start blank</button>
    </div>
  </div>
{:else if scene}
  <div class="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
    <div class="grid content-start gap-4">
      <div class="stage">
        <div class="frame" style={`aspect-ratio:${scene.width}/${scene.height};width:min(100%, calc(min(70vh, 760px) * ${scene.width / scene.height}))`}>
          <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
          <canvas bind:this={view} role="img" aria-label="Meme preview"></canvas>
          <div class="overlay" bind:this={overlay}>
            {#each scene.boxes as b (b.id)}
              <button
                type="button"
                class="box"
                class:on={selectedId === b.id}
                style={`left:${pct(b.l.left, scene.width)};top:${pct(scene.capH + b.l.top, scene.height)};width:${pct(b.l.width, scene.width)};height:${pct(b.l.height, scene.height)}`}
                aria-label={`${b.name}: drag or use the arrow keys to move`}
                onpointerdown={(e) => onDown(e, b)}
                onpointermove={onMove}
                onpointerup={() => (drag = null)}
                onpointercancel={() => (drag = null)}
                onkeydown={(e) => onKey(e, b)}
                ondblclick={() => focusText(b.id)}
              ></button>
            {/each}
          </div>
        </div>
      </div>
      <p class="mono -mt-1">drag text to move it · double-click to edit · drop or paste to swap the image · {scene.width} × {scene.height}px</p>

      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label="File format">
          <button type="button" aria-pressed={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
          <button type="button" aria-pressed={format === 'jpeg'} onclick={() => (format = 'jpeg')}>JPG</button>
        </div>
        <button type="button" class="btn btn-primary grow" disabled={!!busy} onclick={download}>{busy === 'download' ? 'Saving…' : 'Download'}</button>
        {#if canCopy}
          <button type="button" class="btn grow" disabled={!!busy} onclick={copy} aria-live="polite">{copied ? 'Copied ✓' : busy === 'copy' ? 'Copying…' : 'Copy image'}</button>
        {/if}
      </div>
      {#if canCopy && Math.max(scene.width, scene.height) > COPY_MAX}<p class="mono -mt-2">copies are capped at {COPY_MAX}px · download for full size</p>{/if}
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      <p class="mono text-ok">no watermark · full resolution</p>
    </div>

    <div class="grid content-start gap-5">
      <div>
        <span class="label">style</span>
        <div class="seg" role="group" aria-label="Meme style">
          <button type="button" aria-pressed={style === 'classic'} onclick={() => setStyle('classic')}>top / bottom</button>
          <button type="button" aria-pressed={style === 'caption'} onclick={() => setStyle('caption')}>caption bar</button>
        </div>
      </div>

      {#if style === 'caption'}
        <div class="grid gap-3">
          <label><span class="label">caption</span><textarea class="field min-h-[96px]! font-sans!" bind:value={caption.text} placeholder="when the code works on the first try"></textarea></label>
          <div class="flex flex-wrap items-end gap-4">
            <label class="min-w-40 flex-1"><span class="label">caption size · {Math.round(caption.size * imgW)}px</span>
              <input type="range" min="0.03" max="0.1" step="0.0025" bind:value={caption.size} class="w-full accent-(--color-sun)" />
            </label>
            <div class="seg" role="group" aria-label="Caption alignment">
              {#each ['left', 'center'] as const as a}
                <button type="button" aria-pressed={caption.align === a} onclick={() => (caption.align = a)}>{a}</button>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      <div class="grid gap-2">
        {#each visible as layer (layer.id)}
          <div class="flex items-end gap-2">
            <label class="flex-1">
              <span class="label" class:text-sun={selectedId === layer.id}>{nameOf(layer)}</span>
              <input
                id={`meme-text-${layer.id}`}
                class="field"
                class:sel={selectedId === layer.id}
                bind:value={layer.text}
                placeholder={layer.role === 'extra' ? 'text' : layer.role === 'top' ? 'TOP TEXT' : 'BOTTOM TEXT'}
                onfocus={() => (selectedId = layer.id)}
              />
            </label>
            {#if layer.role === 'extra'}
              <button type="button" class="btn px-3!" aria-label={`Remove ${nameOf(layer)}`} onclick={() => removeBox(layer.id)}>✕</button>
            {/if}
          </div>
        {/each}
        <button type="button" class="btn mt-1 justify-self-start" onclick={addBox}>+ Add text box</button>
      </div>

      {#if selected}
        <div class="grid gap-4 border-t border-line pt-5">
          <span class="label -mb-2">style for <span class="text-sun">{nameOf(selected)}</span></span>
          <div class="grid gap-4 sm:grid-cols-2">
            <label><span class="label">size · {Math.round(selected.size * imgW)}px</span>
              <input type="range" min="0.03" max="0.2" step="0.005" bind:value={selected.size} class="w-full accent-(--color-sun)" />
            </label>
            <label><span class="label">box width · {Math.round(selected.width * 100)}%</span>
              <input type="range" min="0.2" max="1" step="0.01" bind:value={selected.width} class="w-full accent-(--color-sun)" />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label class="flex items-center gap-2">
              <input type="color" bind:value={selected.color} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
              <span class="mono">text</span>
            </label>
            <div class="flex items-center gap-2">
              <input type="color" bind:value={selected.strokeColor} disabled={!selected.stroke} aria-label="Outline color" class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent disabled:opacity-40" />
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={selected.stroke} class="accent-(--color-sun)" /> outline</label>
            </div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={selected.upper} class="accent-(--color-sun)" /> ALL CAPS</label>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <div class="seg" role="group" aria-label="Text alignment">
              {#each ['left', 'center', 'right'] as const as a}
                <button type="button" aria-pressed={selected.align === a} onclick={() => (selected!.align = a)}>{a}</button>
              {/each}
            </div>
            {#if selected.role !== 'extra' && selected.anchor === 'free'}
              <button type="button" class="btn" onclick={() => resetPosition(selected!)}>Snap back to {selected.role}</button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="grid gap-3 border-t border-line pt-5">
        {#if photo}
          <p class="mono truncate">{photo.name} · {photo.width} × {photo.height}</p>
        {:else}
          <div class="flex flex-wrap items-center gap-4">
            <div class="seg" role="group" aria-label="Canvas shape">
              {#each aspectList as a}
                <button type="button" aria-pressed={aspect === a} onclick={() => (aspect = a)}>{a}</button>
              {/each}
            </div>
            <label class="flex items-center gap-2">
              <input type="color" bind:value={blankColor} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
              <span class="mono">background</span>
            </label>
          </div>
        {/if}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn" disabled={loading} onclick={() => fileInput?.click()}>{loading ? 'Opening…' : photo ? 'Change image' : 'Use an image'}</button>
          <button type="button" class="btn" onclick={startOver}>Start over</button>
        </div>
        <input bind:this={fileInput} type="file" accept="image/*,.heic,.heif,.avif" hidden onchange={pickFile} />
      </div>
    </div>
  </div>
{/if}

<style>
  .stage {
    display: grid;
    place-items: center;
    padding: 14px;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .frame {
    position: relative;
    max-width: 100%;
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    border-radius: 4px;
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .overlay {
    position: absolute;
    inset: 0;
  }
  .box {
    position: absolute;
    padding: 0;
    background: transparent;
    border: 1.5px dashed transparent;
    border-radius: 6px;
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: border-color 0.15s;
    &:hover,
    &:focus-visible {
      border-color: #ffffffb3;
      outline: none;
    }
    &:active {
      cursor: grabbing;
    }
    &.on {
      border-color: var(--color-sun);
      box-shadow: 0 0 0 1px #13121166;
    }
  }
  .field.sel {
    border-color: #ffd25e80;
  }
</style>
