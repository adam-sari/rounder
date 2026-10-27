<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { decodeImage, encodeImage, resizeImage } from '@/engines/image/client';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { free, surface } from '@/tools/lib/social-media-image-resizer/canvas';
  import { panFocus } from '@/tools/lib/social-media-image-resizer/sizes';
  import { capRatio, fontCss, fontIds, fonts, loadFonts } from '@/tools/lib/youtube-thumbnail-maker/fonts';
  import { SIZE_LIMIT, fitUnder, hasTransparency } from '@/tools/lib/youtube-thumbnail-maker/pixels';
  import { paintBackground, paintScene, rasterEmoji, type Source } from '@/tools/lib/youtube-thumbnail-maker/render';
  import {
    H, W, boxOf, clamp, defaultBackground, fitSize, newImage, newShape, newText, outlineMax, resized, sizeLimits, snapCenter,
    type Background, type Layer, type Shadow,
  } from '@/tools/lib/youtube-thumbnail-maker/scene';
  import { shapeIds, shapes, type ShapeId } from '@/tools/lib/youtube-thumbnail-maker/shapes';
  import { fileNameFor, layoutText, type Highlight, type TextLayout } from '@/tools/lib/youtube-thumbnail-maker/text';

  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const BG_MAX = 2560;
  const STICKER_MAX = 1600;
  const FEED_W = 246;
  const swatches = ['#ffffff', '#000000', '#ffd25e', '#ff3b30', '#ff8a00', '#3dff8b', '#22d3ff', '#ff4fd8'];
  const gradients: [string, string][] = [
    ['#ff512f', '#2a0845'], ['#f7971e', '#ffd200'], ['#00c6ff', '#0052d4'], ['#11998e', '#38ef7d'],
    ['#8e2de2', '#4a00e0'], ['#141e30', '#243b55'], ['#ff0844', '#ffb199'], ['#0f0c29', '#302b63'],
  ];
  const emojis = ['😱', '🤯', '🔥', '😂', '😍', '🤔', '👀', '💰', '✅', '❌', '⭐', '🚀', '👉', '⚠️', '💯', '🏆'];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let bg = $state<Background>(structuredClone(defaultBackground));
  let layers = $state<Layer[]>([newText(1)]);
  let nextId = 2;
  /** null selects the background */
  let selectedId = $state<number | null>(1);
  let photo = $state.raw<{ bmp: ImageBitmap; name: string } | null>(null);
  /** decoded stickers and emoji, keyed by ImageLayer.src */
  const sources = new Map<number, Source>();
  let nextSrc = 1;
  let sourcesVersion = $state(0);
  let fontsVersion = $state(0);
  let mounted = $state(false);

  /** images still decoding */
  let pending = $state(0);
  const loading = $derived(pending > 0);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let format = $state<'jpeg' | 'png'>('jpeg');
  let result = $state<{ name: string; size: number; quality?: number } | null>(null);
  let safeZone = $state(true);
  let feedTheme = $state<'dark' | 'light'>('dark');
  let videoTitle = $state('');
  let customEmoji = $state('');
  let guides = $state({ x: false, y: false });

  let view = $state<HTMLCanvasElement>();
  let feed = $state<HTMLCanvasElement>();
  let overlay = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();
  let pickAs: 'background' | 'sticker' = 'background';

  const selected = $derived(layers.find((l) => l.id === selectedId));
  const selectedIndex = $derived(layers.findIndex((l) => l.id === selectedId));

  let measureCtx: CanvasRenderingContext2D | undefined;

  // text is measured with the real fonts, so it waits for the browser (and re-runs once fonts arrive)
  const layouts = $derived.by(() => {
    const map = new Map<number, TextLayout>();
    if (!mounted) return map;
    void fontsVersion;
    measureCtx ??= document.createElement('canvas').getContext('2d')!;
    const ctx = measureCtx;
    for (const l of layers) {
      if (l.kind !== 'text') continue;
      const measure = (s: string, px: number) => {
        ctx.font = fontCss(l.font, px);
        return ctx.measureText(s).width;
      };
      const style = { size: l.size, lineHeight: fonts[l.font].lineHeight, outline: l.outline, highlight: l.highlight, upper: l.upper, align: l.align };
      map.set(l.id, layoutText(l.text, style, measure, capRatio(ctx, l.font)));
    }
    return map;
  });

  const boxes = $derived(
    layers.map((l) => {
      const b = l.kind === 'text' ? layouts.get(l.id) : boxOf(l);
      return { id: l.id, x: l.x, y: l.y, w: b?.width ?? 0, h: b?.height ?? 0, rot: l.rot, label: labelOf(l) };
    }),
  );

  function labelOf(l: Layer) {
    if (l.kind === 'text') return l.text.replace(/\*/g, '').split('\n').find((s) => s.trim())?.trim() || 'Empty text';
    if (l.kind === 'image') return l.name;
    return shapes[l.shape].name;
  }

  // ---- painting: one frame at most per change, background cached until it changes

  let bgCanvas: HTMLCanvasElement | undefined;
  let bgDirty = true;
  let frame = 0;

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = 0;
    if (!view) return;
    bgCanvas ??= surface(W, H)[0];
    if (bgDirty) {
      paintBackground(bgCanvas.getContext('2d')!, bg, photo?.bmp ?? null);
      bgDirty = false;
    }
    paintScene(view.getContext('2d')!, bgCanvas, layers, layouts, sources);
    if (feed) {
      const ctx = feed.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(view, 0, 0, feed.width, feed.height);
    }
  }

  $effect(() => {
    $state.snapshot(bg);
    void photo;
    bgDirty = true;
    schedule();
  });

  $effect(() => {
    $state.snapshot(layers);
    void layouts;
    void sourcesVersion;
    void view;
    void feed;
    schedule();
  });

  // ---- adding things

  function select(id: number | null) {
    selectedId = id;
  }

  function add(layer: Layer) {
    layers.push(layer);
    select(layer.id);
  }

  async function addText() {
    const id = nextId++;
    add(newText(id, { text: 'New *text*', size: 96, y: H / 2 + ((id * 37) % 160) - 80 }));
    await tick();
    (document.getElementById('thumb-text') as HTMLTextAreaElement | null)?.select();
  }

  function addShape(shape: ShapeId) {
    add(newShape(nextId++, shape));
  }

  function addEmoji(emoji: string) {
    const canvas = rasterEmoji(emoji.trim());
    if (!canvas) {
      error = "Your device couldn't draw that emoji. Try another one.";
      return;
    }
    error = '';
    const src = nextSrc++;
    sources.set(src, canvas);
    sourcesVersion++;
    const aspect = canvas.height / canvas.width;
    add(newImage(nextId++, src, emoji.trim(), aspect, Math.min(fitSize(aspect), Math.round(220 / aspect))));
  }

  /** Decodes off the main thread and scales big photos down to what a 1280 × 720 canvas can use */
  async function decodeCapped(file: File, max: number) {
    let data = await decodeImage(file);
    const s = max / Math.max(data.width, data.height);
    if (s < 1) data = await resizeImage(data, { width: Math.round(data.width * s), height: Math.round(data.height * s), method: 'lanczos3' });
    return data;
  }

  let loadSeq = 0;
  /** load number of the photo now in the background, so a slow older decode can't replace a newer one */
  let bgSeq = 0;

  async function addFile(file: File, as: 'background' | 'sticker' | 'auto') {
    const seq = ++loadSeq;
    pending++;
    error = '';
    notice = '';
    try {
      const data = await decodeCapped(file, as === 'sticker' ? STICKER_MAX : BG_MAX);
      const sticker = as === 'sticker' || (as === 'auto' && hasTransparency(data.data));
      if (sticker) {
        let img = data;
        // a dropped file was decoded at background size; stickers need less
        const s = STICKER_MAX / Math.max(img.width, img.height);
        if (s < 1) img = await resizeImage(img, { width: Math.round(img.width * s), height: Math.round(img.height * s), method: 'lanczos3' });
        const bmp = await createImageBitmap(img);
        const src = nextSrc++;
        sources.set(src, bmp);
        sourcesVersion++;
        const aspect = bmp.height / bmp.width;
        add(newImage(nextId++, src, file.name, aspect, fitSize(aspect)));
        if (as === 'auto') notice = `${file.name} has transparency, so it was added as a sticker.`;
      } else {
        const bmp = await createImageBitmap(data);
        if (seq < bgSeq) return bmp.close();
        bgSeq = seq;
        photo?.bmp.close();
        photo = { bmp, name: file.name };
        Object.assign(bg, { kind: 'photo', zoom: 1, focus: { x: 0.5, y: 0.5 } });
        select(null);
        if (as === 'auto') notice = `${file.name} is now the background. Drag the canvas to reposition it.`;
      }
    } catch {
      error = `Couldn't open ${file.name}. Try a JPG, PNG, WebP, HEIC or GIF.`;
    } finally {
      pending--;
    }
  }

  function pick(as: 'background' | 'sticker') {
    pickAs = as;
    fileInput?.click();
  }

  function onPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) addFile(f, pickAs);
    input.value = '';
  }

  // ---- editing layers

  function remove(id: number) {
    const i = layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [gone] = layers.splice(i, 1);
    if (gone.kind === 'image' && !layers.some((l) => l.kind === 'image' && l.src === gone.src)) {
      const src = sources.get(gone.src);
      if (src instanceof ImageBitmap) src.close();
      else if (src instanceof HTMLCanvasElement) free(src);
      sources.delete(gone.src);
    }
    select(layers[Math.min(i, layers.length - 1)]?.id ?? null);
  }

  function duplicate(l: Layer) {
    const copy = { ...$state.snapshot(l), id: nextId++, x: clamp(l.x + 40, 0, W), y: clamp(l.y + 40, 0, H) } as Layer;
    layers.splice(layers.indexOf(l) + 1, 0, copy);
    select(copy.id);
  }

  function reorder(by: number) {
    const i = selectedIndex;
    const j = i + by;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const [l] = layers.splice(i, 1);
    layers.splice(j, 0, l);
  }

  function startOver() {
    for (const s of sources.values()) {
      if (s instanceof ImageBitmap) s.close();
      else if (s instanceof HTMLCanvasElement) free(s);
    }
    sources.clear();
    bgSeq = ++loadSeq;
    photo?.bmp.close();
    photo = null;
    bg = structuredClone(defaultBackground);
    layers = [newText(nextId)];
    select(nextId++);
    error = notice = '';
    result = null;
  }

  // ---- pointer editing on the canvas

  type Drag =
    | { mode: 'move'; id: number; px: number; py: number; x: number; y: number }
    | { mode: 'resize'; id: number; size: number; cx: number; cy: number; d0: number }
    | { mode: 'pan'; px: number; py: number; focus: { x: number; y: number } };
  let drag: Drag | null = null;

  const toCanvas = () => W / overlay!.getBoundingClientRect().width;

  function onBoxDown(e: PointerEvent, id: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    select(id);
    const l = layers.find((x) => x.id === id)!;
    drag = { mode: 'move', id, px: e.clientX, py: e.clientY, x: l.x, y: l.y };
    overlay?.setPointerCapture(e.pointerId);
  }

  function onHandleDown(e: PointerEvent, id: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const l = layers.find((x) => x.id === id)!;
    const r = overlay!.getBoundingClientRect();
    const cx = r.left + (l.x / W) * r.width;
    const cy = r.top + (l.y / H) * r.height;
    drag = { mode: 'resize', id, size: l.size, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) };
    overlay?.setPointerCapture(e.pointerId);
  }

  function onStageDown(e: PointerEvent) {
    if (e.button !== 0) return;
    select(null);
    if (bg.kind === 'photo' && photo) {
      drag = { mode: 'pan', px: e.clientX, py: e.clientY, focus: { ...bg.focus } };
      overlay?.setPointerCapture(e.pointerId);
    }
  }

  function onMove(e: PointerEvent) {
    if (!drag || !overlay) return;
    const k = toCanvas();
    if (drag.mode === 'pan') {
      if (photo) bg.focus = panFocus(photo.bmp.width, photo.bmp.height, W, H, drag.focus, (e.clientX - drag.px) * k, (e.clientY - drag.py) * k, bg.zoom);
      return;
    }
    const d = drag;
    const l = layers.find((x) => x.id === d.id);
    if (!l) return;
    if (d.mode === 'move') {
      const s = snapCenter(d.x + (e.clientX - d.px) * k, d.y + (e.clientY - d.py) * k);
      l.x = Math.round(clamp(s.x, 0, W));
      l.y = Math.round(clamp(s.y, 0, H));
      guides = { x: s.sx, y: s.sy };
    } else {
      l.size = resized(d.size, l.kind, d.d0, Math.hypot(e.clientX - d.cx, e.clientY - d.cy));
    }
  }

  function onUp() {
    drag = null;
    guides = { x: false, y: false };
  }

  function onBoxKey(e: KeyboardEvent, id: number) {
    const l = layers.find((x) => x.id === id);
    if (!l) return;
    const dir = arrows[e.key];
    if (dir) {
      e.preventDefault();
      const step = e.shiftKey ? 40 : 4;
      l.x = clamp(l.x + dir[0] * step, 0, W);
      l.y = clamp(l.y + dir[1] * step, 0, H);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(id);
    } else if (e.key === 'Enter' && l.kind === 'text') {
      e.preventDefault();
      document.getElementById('thumb-text')?.focus();
    }
  }

  // ---- export

  async function download() {
    busy = true;
    error = '';
    result = null;
    const [back, bctx] = surface(W, H);
    const [out, ctx] = surface(W, H);
    try {
      paintBackground(bctx, bg, photo?.bmp ?? null);
      paintScene(ctx, back, layers, layouts, sources);
      const img = ctx.getImageData(0, 0, W, H);
      const firstText = layers.find((l) => l.kind === 'text');
      const name = fileNameFor(firstText?.kind === 'text' ? firstText.text : undefined, format === 'png' ? 'png' : 'jpg');
      if (format === 'png') {
        const blob = await encodeImage(img, { format: 'png' });
        downloadBlob(blob, name);
        result = { name, size: blob.size };
      } else {
        const { blob, quality } = await fitUnder(SIZE_LIMIT, (q) => encodeImage(img, { format: 'jpeg', quality: q }));
        downloadBlob(blob, name);
        result = { name, size: blob.size, quality };
      }
    } catch {
      error = 'Something went wrong while saving. Please try again.';
    } finally {
      free(back);
      free(out);
      busy = false;
    }
  }

  // ---- lifecycle

  onMount(() => {
    mounted = true;
    const bump = () => fontsVersion++;
    loadFonts().then(bump);
    // characters outside the first subset load later; measure again when they do
    document.fonts.addEventListener('loadingdone', bump);

    const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name);
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files[0];
      if (f && isImage(f)) addFile(f, 'auto');
    };
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      if (isImage(f)) addFile(f, 'auto');
      else error = `${f.name} isn't an image. Try a JPG, PNG, WebP or HEIC.`;
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      document.fonts.removeEventListener('loadingdone', bump);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      cancelAnimationFrame(frame);
      for (const s of sources.values()) {
        if (s instanceof ImageBitmap) s.close();
        else if (s instanceof HTMLCanvasElement) free(s);
      }
      if (bgCanvas) free(bgCanvas);
      photo?.bmp.close();
    };
  });

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const shadows: Shadow[] = ['none', 'soft', 'hard'];
  const highlights: [Highlight, string][] = [['none', 'none'], ['lines', 'behind lines'], ['marked', 'behind *words*']];
</script>

{#snippet colorRow(label: string, value: string, set: (c: string) => void)}
  <div>
    <span class="label">{label}</span>
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {#each swatches as c}
        <button type="button" class="swatch" style:background={c} aria-label={c} title={c} aria-pressed={value.toLowerCase() === c} onclick={() => set(c)}></button>
      {/each}
      <label class="swatch picker" title="Pick any color" class:custom={!swatches.includes(value.toLowerCase())} style:background={swatches.includes(value.toLowerCase()) ? undefined : value}>
        <input type="color" {value} oninput={(e) => set(e.currentTarget.value)} aria-label={`${label}: pick any color`} />
      </label>
    </div>
  </div>
{/snippet}

{#snippet slider(label: string, shown: string, value: number, min: number, max: number, step: number, set: (n: number) => void)}
  <label class="block">
    <span class="label flex justify-between">{label} <span>{shown}</span></span>
    <input type="range" {min} {max} {step} {value} oninput={(e) => set(+e.currentTarget.value)} class="w-full accent-(--color-sun)" />
  </label>
{/snippet}

<div class="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
  <div class="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
    <div class="stage">
      <div class="frame">
        <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
        <canvas bind:this={view} width={W} height={H} role="img" aria-label="Thumbnail preview, 1280 by 720 pixels"></canvas>
        {#if mounted}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="overlay" class:pan={bg.kind === 'photo' && !!photo} bind:this={overlay} onpointerdown={onStageDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} ondblclick={() => selected?.kind === 'text' && document.getElementById('thumb-text')?.focus()}>
            {#if safeZone}
              <div class="safe" aria-hidden="true"><span>12:34</span></div>
            {/if}
            {#if guides.x}<div class="guide gx" aria-hidden="true"></div>{/if}
            {#if guides.y}<div class="guide gy" aria-hidden="true"></div>{/if}
            {#each boxes as b (b.id)}
              <div
                class="box"
                class:on={selectedId === b.id}
                style:left={pct(b.x, W)}
                style:top={pct(b.y, H)}
                style:width={pct(b.w, W)}
                style:height={pct(b.h, H)}
                style:transform={`translate(-50%, -50%) rotate(${b.rot}deg)`}
              >
                <button
                  type="button"
                  class="hit"
                  aria-label={`${b.label}: drag or use the arrow keys to move, Delete to remove`}
                  onpointerdown={(e) => onBoxDown(e, b.id)}
                  onkeydown={(e) => onBoxKey(e, b.id)}
                  onfocus={() => select(b.id)}
                ></button>
                {#if selectedId === b.id}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="handle" title="Drag to resize" onpointerdown={(e) => onHandleDown(e, b.id)}></span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p class="mono" aria-live="polite">{loading ? 'opening your image…' : 'drop or paste a photo for the background, or a transparent PNG for a sticker'}</p>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={safeZone} class="accent-(--color-sun)" /> timestamp zone</label>
    </div>
    {#if notice}<p class="mono text-ok" aria-live="polite">{notice}</p>{/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

    <div class="grid gap-3 rounded-2xl border border-line-2 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label="File format">
          <button type="button" aria-pressed={format === 'jpeg'} onclick={() => ((format = 'jpeg'), (result = null))}>JPG</button>
          <button type="button" aria-pressed={format === 'png'} onclick={() => ((format = 'png'), (result = null))}>PNG</button>
        </div>
        <button type="button" class="btn btn-primary grow" disabled={busy} onclick={download}>{busy ? 'Saving…' : 'Download 1280 × 720'}</button>
      </div>
      {#if result}
        <p class="result mono" class:text-ok={result.size <= SIZE_LIMIT} class:text-bad={result.size > SIZE_LIMIT} aria-live="polite">
          {result.name} · {formatBytes(result.size)}{result.quality ? ` · quality ${result.quality}` : ''}
          {result.size <= SIZE_LIMIT ? '· under YouTube’s 2 MB limit ✓' : '· over 2 MB, which YouTube won’t accept. Choose JPG instead.'}
        </p>
      {:else}
        <p class="mono">{format === 'jpeg' ? 'JPG picks the highest quality that stays under 2 MB' : 'PNG is lossless, but photos can go over YouTube’s 2 MB limit'}</p>
      {/if}
    </div>

    <section class="grid gap-3 rounded-2xl border border-line-2 p-4" aria-labelledby="feed-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="feed-title" class="label mb-0!">how it looks in the feed · {FEED_W} px wide</h3>
        <div class="seg" role="group" aria-label="Feed theme">
          <button type="button" aria-pressed={feedTheme === 'dark'} onclick={() => (feedTheme = 'dark')}>dark</button>
          <button type="button" aria-pressed={feedTheme === 'light'} onclick={() => (feedTheme = 'light')}>light</button>
        </div>
      </div>
      <div class="feed" class:light={feedTheme === 'light'}>
        <div class="card-mock">
          <div class="thumb">
            <canvas bind:this={feed} width={FEED_W * 2} height={Math.round((FEED_W * 2 * H) / W)} aria-hidden="true"></canvas>
            <span class="time">12:34</span>
          </div>
          <div class="meta">
            <span class="avatar" aria-hidden="true"></span>
            <div class="min-w-0">
              <p class="vt">{videoTitle.trim() || 'Your video title shows up here, and it can run to two lines'}</p>
              <p class="vs">Your channel</p>
              <p class="vs">1.2K views · 2 hours ago</p>
            </div>
          </div>
        </div>
      </div>
      <label><span class="label">video title (preview only)</span><input class="field" bind:value={videoTitle} maxlength="100" placeholder="Type your title to see it beside the thumbnail" /></label>
    </section>
  </div>

  <div class="grid content-start gap-6">
    <section class="grid gap-3" aria-label="Add to the thumbnail">
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn" onclick={addText}>+ Text</button>
        <button type="button" class="btn" disabled={loading} onclick={() => pick('sticker')}>+ Image</button>
      </div>
      <div class="grid grid-cols-4 gap-2" role="group" aria-label="Add a shape">
        {#each shapeIds as id}
          <button type="button" class="btn shape-btn" title={shapes[id].name} aria-label={`Add ${shapes[id].name.toLowerCase()}`} onclick={() => addShape(id)}>
            <svg viewBox={`-6 -6 ${shapes[id].w + 12} ${shapes[id].h + 12}`} aria-hidden="true"><path d={shapes[id].d} /></svg>
          </button>
        {/each}
      </div>
      <details class="emoji">
        <summary class="btn w-full">Emoji</summary>
        <div class="grid gap-2 pt-2">
          <div class="grid grid-cols-8 gap-1" role="group" aria-label="Add an emoji">
            {#each emojis as e}
              <button type="button" class="emo" aria-label={`Add ${e}`} onclick={() => addEmoji(e)}>{e}</button>
            {/each}
          </div>
          <form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), customEmoji.trim() && addEmoji(customEmoji))}>
            <input class="field" bind:value={customEmoji} maxlength="16" placeholder="or paste any emoji" aria-label="Any emoji" />
            <button type="submit" class="btn" disabled={!customEmoji.trim()}>Add</button>
          </form>
        </div>
      </details>
    </section>

    <section class="grid gap-2 border-t border-line pt-5" aria-label="Layers">
      <span class="label mb-0!">layers · top first</span>
      <ol class="layers">
        {#each [...layers].reverse() as l (l.id)}
          <li>
            <button type="button" class="row" aria-pressed={selectedId === l.id} onclick={() => select(l.id)}>
              <span class="kind mono">{l.kind === 'text' ? 'T' : l.kind === 'image' ? 'img' : '◆'}</span>
              <span class="truncate">{labelOf(l)}</span>
            </button>
          </li>
        {/each}
        <li>
          <button type="button" class="row" aria-pressed={selectedId === null} onclick={() => select(null)}>
            <span class="kind mono">bg</span>
            <span class="truncate">Background · {bg.kind === 'photo' ? (photo?.name ?? 'photo') : bg.kind}</span>
          </button>
        </li>
      </ol>
    </section>

    {#if selected}
      {@const l = selected}
      <section class="grid gap-4 border-t border-line pt-5" aria-label="Selected layer">
        <div class="flex flex-wrap items-center gap-2">
          <span class="label mb-0! mr-auto">editing <span class="text-sun">{labelOf(l)}</span></span>
          <button type="button" class="btn icon" aria-label="Bring forward" title="Bring forward" disabled={selectedIndex >= layers.length - 1} onclick={() => reorder(1)}>↑</button>
          <button type="button" class="btn icon" aria-label="Send backward" title="Send backward" disabled={selectedIndex <= 0} onclick={() => reorder(-1)}>↓</button>
          <button type="button" class="btn icon" aria-label="Duplicate" title="Duplicate" onclick={() => duplicate(l)}>⧉</button>
          <button type="button" class="btn icon" aria-label="Delete layer" title="Delete" onclick={() => remove(l.id)}>✕</button>
        </div>

        {#if l.kind === 'text'}
          {@const t = l}
          <label>
            <span class="label">text · wrap words in *stars* for the accent color</span>
            <textarea id="thumb-text" class="field min-h-[88px]! font-sans!" rows="3" bind:value={t.text}></textarea>
          </label>
          <div>
            <span class="label">font</span>
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Font">
              {#each fontIds as id}
                <button type="button" class="font-btn" aria-pressed={t.font === id} style:font-family={fonts[id].family} style:font-weight={fonts[id].weight} onclick={() => (t.font = id)}>{fonts[id].name}</button>
              {/each}
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            {@render colorRow('text color', t.color, (c) => (t.color = c))}
            {@render colorRow('*accent* color', t.accent, (c) => (t.accent = c))}
          </div>
          <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
            <div>
              <span class="label">highlight box</span>
              <div class="seg" role="group" aria-label="Highlight box">
                {#each highlights as [id, name]}
                  <button type="button" aria-pressed={t.highlight === id} onclick={() => (t.highlight = id)}>{name}</button>
                {/each}
              </div>
            </div>
          </div>
          {#if t.highlight !== 'none'}
            {@render colorRow('highlight color', t.highlightColor, (c) => (t.highlightColor = c))}
          {/if}
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div class="seg" role="group" aria-label="Text alignment">
              {#each ['left', 'center', 'right'] as const as a}
                <button type="button" aria-pressed={t.align === a} onclick={() => (t.align = a)}>{a}</button>
              {/each}
            </div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={t.upper} class="accent-(--color-sun)" /> ALL CAPS</label>
          </div>
        {:else if l.kind === 'shape'}
          {@const s = l}
          {@render colorRow('fill', s.color, (c) => (s.color = c))}
        {/if}

        <div class="grid gap-4 sm:grid-cols-2">
          {@render slider(l.kind === 'text' ? 'size' : 'width', `${l.size}px`, l.size, sizeLimits[l.kind][0], sizeLimits[l.kind][1], 1, (n) => (l.size = n))}
          {@render slider('rotate', `${l.rot}°`, l.rot, -180, 180, 1, (n) => (l.rot = Math.abs(n) <= 2 ? 0 : n))}
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {@render slider(l.kind === 'image' ? 'sticker border' : 'outline', l.outline ? `${Math.round(l.outline * l.size)}px` : 'off', l.outline, 0, outlineMax[l.kind], 0.002, (n) => (l.outline = n))}
          <div>
            <span class="label">shadow</span>
            <div class="seg" role="group" aria-label="Shadow">
              {#each shadows as s}
                <button type="button" aria-pressed={l.shadow === s} onclick={() => (l.shadow = s)}>{s}</button>
              {/each}
            </div>
          </div>
        </div>
        {#if l.outline > 0}
          {@render colorRow(l.kind === 'image' ? 'border color' : 'outline color', l.outlineColor, (c) => (l.outlineColor = c))}
        {/if}
        <p class="mono">drag to move · corner handle to resize · arrow keys nudge · snaps to the center</p>
      </section>
    {:else}
      <section class="grid gap-4 border-t border-line pt-5" aria-label="Background">
        <div>
          <span class="label">background</span>
          <div class="seg" role="group" aria-label="Background type">
            <button type="button" aria-pressed={bg.kind === 'photo'} onclick={() => (photo ? (bg.kind = 'photo') : pick('background'))}>photo</button>
            <button type="button" aria-pressed={bg.kind === 'gradient'} onclick={() => (bg.kind = 'gradient')}>gradient</button>
            <button type="button" aria-pressed={bg.kind === 'color'} onclick={() => (bg.kind = 'color')}>color</button>
          </div>
        </div>
        {#if bg.kind === 'photo' && photo}
          <p class="mono truncate">{photo.name} · drag the canvas to reposition</p>
          {@render slider('zoom', `${Math.round(bg.zoom * 100)}%`, bg.zoom, 1, 3, 0.01, (n) => (bg.zoom = n))}
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn" disabled={loading} onclick={() => pick('background')}>Change photo</button>
            <button type="button" class="btn" onclick={() => Object.assign(bg, { zoom: 1, focus: { x: 0.5, y: 0.5 } })}>Recenter</button>
          </div>
        {:else if bg.kind === 'gradient'}
          <div class="grid grid-cols-8 gap-1.5" role="group" aria-label="Gradient presets">
            {#each gradients as [from, to]}
              <button
                type="button"
                class="swatch w-full!"
                style:background={`linear-gradient(135deg, ${from}, ${to})`}
                aria-label={`Gradient from ${from} to ${to}`}
                aria-pressed={bg.from === from && bg.to === to}
                onclick={() => Object.assign(bg, { from, to })}
              ></button>
            {/each}
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            {@render colorRow('from', bg.from, (c) => (bg.from = c))}
            {@render colorRow('to', bg.to, (c) => (bg.to = c))}
          </div>
          {@render slider('angle', `${bg.angle}°`, bg.angle, 0, 360, 5, (n) => (bg.angle = n))}
        {:else if bg.kind === 'color'}
          {@render colorRow('color', bg.color, (c) => (bg.color = c))}
        {/if}
        <div class="grid gap-4 sm:grid-cols-2">
          <!-- blurring a flat color or a smooth gradient changes nothing, so it's a photo-only control -->
          {#if bg.kind === 'photo' && photo}
            {@render slider('blur', bg.blur ? `${bg.blur}px` : 'off', bg.blur, 0, 40, 1, (n) => (bg.blur = n))}
          {/if}
          {@render slider('darken', `${Math.round(bg.darken * 100)}%`, bg.darken, 0, 0.8, 0.02, (n) => (bg.darken = n))}
        </div>
        {#if bg.kind !== 'photo'}
          <button type="button" class="btn justify-self-start" disabled={loading} onclick={() => pick('background')}>{loading ? 'Opening…' : 'Use a photo'}</button>
        {/if}
      </section>
    {/if}

    <div class="border-t border-line pt-5">
      <button type="button" class="btn" onclick={startOver}>Start over</button>
    </div>
  </div>
</div>
<input bind:this={fileInput} type="file" accept={ACCEPT} hidden onchange={onPicked} />

<style>
  .stage {
    padding: 12px;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .frame {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 6px;
    overflow: hidden;
    background: #000;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .overlay {
    position: absolute;
    inset: 0;
    /* pages still scroll over the canvas on phones, except while there's a photo to pan */
    &.pan {
      cursor: move;
      touch-action: none;
    }
  }
  .box {
    position: absolute;
    border: 1.5px dashed transparent;
    border-radius: 6px;
    transition: border-color 0.15s;
    &:hover {
      border-color: #ffffff99;
    }
    &.on {
      border: 1.5px solid var(--color-sun);
      box-shadow: 0 0 0 1px #13121166;
    }
  }
  .hit {
    position: absolute;
    inset: 0;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: none;
    &:active {
      cursor: grabbing;
    }
    &:focus-visible {
      outline-offset: 3px;
    }
  }
  .handle {
    position: absolute;
    right: -9px;
    bottom: -9px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-sun);
    border: 2px solid var(--color-bg);
    cursor: nwse-resize;
    touch-action: none;
    animation: pop 0.25s var(--ease-spring);
    /* a bigger invisible target for fingers */
    &::after {
      content: '';
      position: absolute;
      inset: -12px;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
  }
  .guide {
    position: absolute;
    background: var(--color-sun);
    opacity: 0.9;
    pointer-events: none;
  }
  .gx {
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .gy {
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
  }
  /* where YouTube's video length badge sits, scaled up from the feed */
  .safe {
    position: absolute;
    right: 1.25%;
    bottom: 2.2%;
    width: 17%;
    height: 15%;
    border: 1.5px dashed #ffffffb3;
    border-radius: 6px;
    background: #00000033;
    pointer-events: none;
    display: grid;
    place-items: end;
    padding: 4%;
    & span {
      font: 600 clamp(9px, 1.6vw, 15px) / 1 var(--font-mono);
      color: #fff;
      background: #000000cc;
      padding: 3px 5px;
      border-radius: 4px;
    }
  }
  .result {
    animation: rise 0.45s var(--ease-spring);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  .feed {
    --bg: #0f0f0f;
    --fg: #f1f1f1;
    --sub: #aaaaaa;
    display: flex;
    justify-content: center;
    padding: 18px 12px;
    border-radius: 12px;
    background: var(--bg);
    font-family: Roboto, Arial, sans-serif;
    transition: background 0.2s;
    &.light {
      --bg: #ffffff;
      --fg: #0f0f0f;
      --sub: #606060;
    }
  }
  .card-mock {
    width: 246px;
    max-width: 100%;
  }
  .thumb {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    & canvas {
      background: #222;
    }
  }
  .time {
    position: absolute;
    right: 4px;
    bottom: 4px;
    font: 500 12px/1 Roboto, Arial, sans-serif;
    color: #fff;
    background: #000000cc;
    padding: 3px 4px;
    border-radius: 4px;
  }
  .meta {
    display: flex;
    gap: 10px;
    padding-top: 10px;
  }
  .avatar {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--color-sun), var(--color-video));
  }
  .vt {
    color: var(--fg);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 2px;
  }
  .vs {
    color: var(--sub);
    font-size: 12px;
    line-height: 18px;
  }

  .shape-btn {
    padding: 10px;
    & svg {
      width: 100%;
      height: 26px;
      fill: var(--color-chalk);
    }
  }
  .emoji summary {
    list-style: none;
    &::-webkit-details-marker {
      display: none;
    }
  }
  .emo {
    font-size: 22px;
    line-height: 1;
    aspect-ratio: 1;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), background 0.15s;
    &:hover {
      background: var(--color-panel-2);
      transform: scale(1.15);
    }
  }
  .layers {
    display: grid;
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    text-align: left;
    color: var(--color-soft);
    background: transparent;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    cursor: pointer;
    &:hover {
      border-color: var(--color-line-2);
    }
    &[aria-pressed='true'] {
      color: var(--color-chalk);
      border-color: var(--color-sun);
      background: #ffd25e0f;
    }
  }
  .kind {
    flex: none;
    width: 28px;
    text-align: center;
    font-size: 11px;
  }
  .icon {
    padding: 8px 11px;
    font-size: 14px;
  }
  .font-btn {
    font-size: 18px;
    line-height: 1;
    padding: 9px 12px;
    color: var(--color-soft);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    cursor: pointer;
    &[aria-pressed='true'] {
      color: var(--color-bg);
      background: var(--color-chalk);
      border-color: var(--color-chalk);
    }
  }
  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:hover {
      transform: scale(1.08);
    }
    &[aria-pressed='true'],
    &.custom {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .picker {
    position: relative;
    background: conic-gradient(#ff3b30, #ffd25e, #3dff8b, #22d3ff, #ff4fd8, #ff3b30);
    & input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
</style>
