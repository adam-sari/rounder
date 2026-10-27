<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas, formatInfo, toDecodable } from '@/engines/image/client';
  import { downloadBlob } from '@/tools/lib/files';
  import {
    aspects, canvasSize, cellBoxes, coverCrop, DEFAULT_VIEW, layouts, layoutsFor, MAX_PHOTOS, MAX_ZOOM, MIN_PHOTOS, panView,
    type Layout, type View,
  } from '@/tools/lib/collage-maker/layout';
  import { drawCell } from '@/tools/lib/collage-maker/render';

  interface Photo {
    id: number;
    name: string;
    file: File;
    /** downscaled copy for the preview; the file is decoded again at full size on export if needed */
    bmp: ImageBitmap;
    w: number;
    h: number;
    view: View;
  }

  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const KEEP = 1600; // long side of the in-memory copy of each photo
  const PREVIEW = 1400; // long side of the preview canvas

  let photos = $state<Photo[]>([]);
  /** photo id shown in each cell of the layout */
  let slots = $state<(number | null)[]>([]);
  let layoutId = $state(layouts[0].id);
  let aspectId = $state<(typeof aspects)[number]['id']>('1:1');
  let longSide = $state(2160);
  // spacing, padding and corners are stored per 1000 px of the long side, so the look holds at any size
  let gap = $state(10);
  let pad = $state(10);
  let radius = $state(0);
  let background = $state('#ffffff');
  let transparent = $state(false);
  let format = $state<'jpeg' | 'png' | 'webp'>('jpeg');
  let selected = $state<number | null>(null);
  let decoding = $state(0);
  let exporting = $state(false);
  let notice = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let picker: HTMLInputElement;
  let pickInto: number | undefined;
  let nextId = 0;
  let generation = 0; // bumped by "start over" so photos still being read are dropped

  const layout = $derived(layouts.find((l) => l.id === layoutId)!);
  const aspect = $derived(aspects.find((a) => a.id === aspectId)!);
  const size = $derived(canvasSize(aspect.w, aspect.h, longSide));
  const view = $derived(canvasSize(aspect.w, aspect.h, PREVIEW));
  const px = (perMille: number, long: number) => (perMille * long) / 1000;
  const boxes = $derived(cellBoxes(layout, view.w, view.h, px(gap, PREVIEW), px(pad, PREVIEW)));
  const byId = (id: number | null | undefined) => (id == null ? undefined : photos.find((p) => p.id === id));
  const unplaced = $derived(photos.filter((p) => !slots.includes(p.id)));
  const current = $derived(selected === null ? undefined : byId(slots[selected]));
  const emptyCells = $derived(slots.filter((id) => id === null).length);
  const placedCount = $derived(slots.length - emptyCells);

  const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name);

  async function decodeFull(file: File): Promise<ImageBitmap> {
    const src = await toDecodable(file);
    if (src instanceof ImageBitmap) return src;
    try {
      return await createImageBitmap(src, { imageOrientation: 'from-image' });
    } catch {
      // formats the browser can't read itself go through the wasm codecs
      return createImageBitmap(await decodeImage(file));
    }
  }

  async function shrink(src: ImageBitmap, w: number, h: number) {
    try {
      const out = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      if (out.width === w && out.height === h) return out;
      out.close();
    } catch {
      // some browsers ignore or reject the resize options
    }
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    try {
      return await createImageBitmap(c);
    } finally {
      c.width = c.height = 0; // Safari counts canvas memory until GC, so free it now
    }
  }

  async function load(file: File): Promise<Photo> {
    const full = await decodeFull(file);
    const { width: w, height: h } = full;
    const s = KEEP / Math.max(w, h);
    let bmp = full;
    if (s < 1) {
      bmp = await shrink(full, Math.round(w * s), Math.round(h * s));
      full.close();
    }
    return { id: nextId++, name: file.name, file, bmp, w, h, view: { ...DEFAULT_VIEW } };
  }

  /** fills a layout from the photos already placed (in cell order), then the rest */
  function arrange(next: Layout) {
    const order = [...slots.filter((id): id is number => id !== null), ...unplaced.map((p) => p.id)];
    layoutId = next.id;
    slots = next.cells.map((_, i) => order[i] ?? null);
    if (selected !== null && selected >= slots.length) selected = null;
  }

  async function add(files: File[], into?: number) {
    files = files.filter(isImage);
    if (!files.length) return;
    // replacing a cell frees that photo's place first; photos still being read count as taken
    const replaced = into === undefined ? undefined : slots[into];
    const room = MAX_PHOTOS - photos.length - decoding + (replaced == null ? 0 : 1);
    const left = files.length - Math.max(0, room);
    notice = left > 0 ? `A collage holds up to ${MAX_PHOTOS} photos, so ${left} ${left === 1 ? 'was' : 'were'} left out.` : '';
    files = files.slice(0, Math.max(0, room));
    if (!files.length) return;

    const gen = generation;
    const fresh: Photo[] = [];
    let failed = 0;
    decoding += files.length;
    // one at a time: several 24 MP photos decoded at once can run a phone out of memory
    for (const file of files) {
      if (gen === generation) {
        try {
          fresh.push(await load(file));
        } catch {
          failed++;
        }
      }
      decoding--;
    }
    // "start over" (or leaving the page) while these were being read
    if (gen !== generation) return fresh.forEach((p) => p.bmp.close());
    if (failed) notice = `Couldn't read ${failed} ${failed === 1 ? 'file' : 'files'}. Try JPG, PNG, WebP or HEIC.`;
    if (!fresh.length) return;

    // the layout or that cell may have changed while reading; then just fill empty cells
    if (into !== undefined && (into >= slots.length || slots[into] !== replaced)) into = undefined;
    if (into !== undefined && replaced != null) removePhoto(replaced, false);
    for (const p of fresh.splice(MAX_PHOTOS - photos.length)) p.bmp.close();
    if (!fresh.length) return;
    photos.push(...fresh);
    const ids = fresh.map((p) => p.id);
    if (!slots.length) slots = layout.cells.map(() => null);
    if (into !== undefined) {
      slots[into] = ids.shift()!;
      selected = into;
    }
    for (let i = 0; i < slots.length && ids.length; i++) if (slots[i] === null) slots[i] = ids.shift()!;
    // more photos than cells: move up to a layout that fits them all
    const want = Math.min(MAX_PHOTOS, Math.max(MIN_PHOTOS, photos.length));
    if (ids.length && slots.length < want) arrange(layoutsFor(want)[0]);
  }

  function removePhoto(id: number, refill = true) {
    const i = photos.findIndex((p) => p.id === id);
    if (i < 0) return;
    photos[i].bmp.close();
    photos.splice(i, 1);
    const cell = slots.indexOf(id);
    if (cell >= 0) slots[cell] = refill ? (unplaced[0]?.id ?? null) : null;
  }

  function startOver() {
    generation++;
    for (const p of photos) p.bmp.close();
    photos = [];
    slots = [];
    selected = null;
    notice = '';
  }

  function swap(a: number, b: number) {
    if (a === b) return;
    [slots[a], slots[b]] = [slots[b], slots[a]];
    selected = b;
  }

  /** puts a photo into a cell, swapping places if it's already in another one */
  function place(id: number, cell: number) {
    const from = slots.indexOf(id);
    if (from >= 0) swap(from, cell);
    else {
      slots[cell] = id;
      selected = cell;
    }
  }

  function pick(cell?: number) {
    pickInto = cell;
    picker.click();
  }

  // ---- panning a photo inside its cell
  let pan: { cell: number; x: number; y: number } | null = null;

  function panStart(e: PointerEvent, cell: number) {
    selected = cell;
    if (slots[cell] == null || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan = { cell, x: e.clientX, y: e.clientY };
  }

  function panMove(e: PointerEvent) {
    const p = pan && byId(slots[pan.cell]);
    if (!pan || !p) return;
    const box = boxes[pan.cell];
    const k = box.w / (e.currentTarget as HTMLElement).getBoundingClientRect().width; // css px → preview px
    p.view = panView(p.view, p.bmp.width, p.bmp.height, box.w, box.h, (e.clientX - pan.x) * k, (e.clientY - pan.y) * k);
    pan.x = e.clientX;
    pan.y = e.clientY;
  }

  const zoomTo = (p: Photo, z: number) => (p.view.zoom = Math.min(MAX_ZOOM, Math.max(1, z)));

  function cellKey(e: KeyboardEvent, cell: number) {
    const p = byId(slots[cell]);
    if (!p) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick(cell);
      }
      return;
    }
    const box = boxes[cell];
    const step = e.shiftKey ? 0.2 : 0.05;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-box.w * step, 0], ArrowRight: [box.w * step, 0], ArrowUp: [0, -box.h * step], ArrowDown: [0, box.h * step],
    };
    const d = moves[e.key];
    if (d) p.view = panView(p.view, p.bmp.width, p.bmp.height, box.w, box.h, d[0], d[1]);
    else if (e.key === '+' || e.key === '=') zoomTo(p, p.view.zoom + 0.1);
    else if (e.key === '-') zoomTo(p, p.view.zoom - 0.1);
    else return;
    e.preventDefault();
  }

  // ---- moving photos between cells (grip on a cell, or a photo from the tray)
  let moving = $state<{ cell?: number; photo?: number; x: number; y: number; over: number | null; travelled: boolean } | null>(null);
  let justMoved = false;

  function moveStart(e: PointerEvent, from: { cell?: number; photo?: number }) {
    if (e.button !== 0) return;
    e.stopPropagation();
    justMoved = false; // a drag that ended without a click mustn't swallow the next one
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moving ={ ...from, x: e.clientX, y: e.clientY, over: null, travelled: false };
  }

  function moveMove(e: PointerEvent) {
    if (!moving) return;
    if (Math.hypot(e.clientX - moving.x, e.clientY - moving.y) > 4) moving.travelled = true;
    moving.x = e.clientX;
    moving.y = e.clientY;
    // look through the grips that sit on top of the cells
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.cell !== undefined);
    moving.over = el ? Number(el.dataset.cell) : null;
  }

  function moveEnd() {
    if (!moving) return;
    const { cell, photo, over, travelled } = moving;
    if (travelled && over !== null) {
      if (cell !== undefined) swap(cell, over);
      else if (photo !== undefined) place(photo, over);
    }
    justMoved = travelled;
    moving = null;
  }

  const movingPhoto = $derived(moving && byId(moving.photo ?? slots[moving.cell ?? -1]));

  // ---- drawing
  // the preview redraws at most once a frame, from the small copies kept in memory
  $effect(() => {
    const c = canvas;
    if (!c) return;
    const job = {
      w: view.w,
      h: view.h,
      r: px(radius, PREVIEW),
      fill: transparent ? null : background,
      cells: boxes.map((box, i) => {
        const p = byId(slots[i]);
        return p && { box, bmp: p.bmp, view: { ...p.view } };
      }),
    };
    const frame = requestAnimationFrame(() => {
      if (c.width !== job.w || c.height !== job.h) Object.assign(c, { width: job.w, height: job.h });
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, job.w, job.h);
      if (job.fill) {
        ctx.fillStyle = job.fill;
        ctx.fillRect(0, 0, job.w, job.h);
      }
      for (const cell of job.cells) if (cell) drawCell(ctx, cell.box, job.r, cell.bmp, cell.bmp.width, cell.bmp.height, cell.view);
    });
    return () => cancelAnimationFrame(frame);
  });

  async function download() {
    exporting = true;
    notice = '';
    // read the settings up front: saving waits on decodes, and edits made meanwhile shouldn't leak into this file
    const { w, h } = size;
    const fmt = format;
    // jpg can't hold transparency, so "none" becomes white there
    const fill = transparent ? (fmt === 'jpeg' ? '#ffffff' : null) : background;
    const cells = cellBoxes(layout, w, h, px(gap, longSide), px(pad, longSide));
    const r = px(radius, longSide);
    const items = slots.map((id) => {
      const p = byId(id);
      return p && { bmp: p.bmp, file: p.file, w: p.w, view: { ...p.view } };
    });
    const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
    try {
      const ctx = out.getContext('2d')!;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, w, h);
      }
      for (const [i, p] of items.entries()) {
        if (!p) continue;
        const box = cells[i];
        // the preview copy is enough unless this cell needs more pixels than it holds
        const { sw } = coverCrop(p.bmp.width, p.bmp.height, box.w, box.h, p.view);
        const full = sw < box.w && p.bmp.width < p.w ? await decodeFull(p.file) : null;
        const img = full ?? p.bmp;
        drawCell(ctx, box, r, img, img.width, img.height, p.view);
        full?.close();
      }
      const blob = await encodeCanvas(out, { format: fmt, quality: 90 });
      downloadBlob(blob, `collage.${formatInfo[fmt].ext}`);
    } catch (e) {
      console.error(e);
      notice = 'Something went wrong while saving. Try a smaller size.';
    } finally {
      out.width = out.height = 0;
      exporting = false;
    }
  }

  // small square previews for the tray and the drag ghost
  const thumb = (bmp: ImageBitmap) => (c: HTMLCanvasElement) => {
    c.width = c.height = 96;
    const { sx, sy, sw, sh } = coverCrop(bmp.width, bmp.height, 96, 96, DEFAULT_VIEW);
    c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, 96, 96);
  };

  function fileDrop(e: DragEvent, cell?: number) {
    e.preventDefault();
    e.stopPropagation();
    fileOver = null;
    add(Array.from(e.dataTransfer?.files ?? []), cell);
  }
  let fileOver = $state<number | null>(null);

  onMount(() => {
    // the dropzone handles pasting until the editor takes over
    const onPaste = (e: ClipboardEvent) => {
      if (photos.length && e.clipboardData?.files.length) add(Array.from(e.clipboardData.files));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
  onDestroy(() => {
    generation++;
    for (const p of photos) p.bmp.close();
  });

  const counts = [2, 3, 4, 5, 6, 7, 8, 9];
  const sizes: [number, string][] = [[1080, '1080'], [2160, '2160'], [3840, '3840']];
  const swatches = ['#ffffff', '#f2ede4', '#131211', '#000000', '#ffd25e'];
  const formats = ['jpeg', 'png', 'webp'] as const;
  const mini = $derived(canvasSize(aspect.w, aspect.h, 60));
</script>

<input
  bind:this={picker}
  type="file"
  accept={ACCEPT}
  multiple
  hidden
  onchange={(e) => {
    add(Array.from(e.currentTarget.files ?? []), pickInto);
    e.currentTarget.value = '';
  }}
/>

{#if !photos.length}
  {#if decoding}
    <div class="loading mono" aria-busy="true">reading {decoding} {decoding === 1 ? 'photo' : 'photos'}…</div>
  {:else}
    <Dropzone accept={ACCEPT} multiple title="Drop 2 to 9 photos" hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={(f) => add(f)} />
  {/if}
  {#if notice}<p class="text-bad mt-3 text-sm" role="alert">{notice}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <div
        class="stage"
        style:--ar={view.w / view.h}
        role="region"
        aria-label="Collage preview"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => fileDrop(e)}
      >
        <canvas bind:this={canvas} aria-hidden="true"></canvas>
        {#each boxes as box, i (i)}
          {@const p = byId(slots[i])}
          {@const r = px(radius, PREVIEW)}
          <div
            class="cell"
            class:filled={!!p}
            class:sel={selected === i}
            class:over={moving?.over === i || fileOver === i}
            data-cell={i}
            style:left="{(box.x / view.w) * 100}%"
            style:top="{(box.y / view.h) * 100}%"
            style:width="{(box.w / view.w) * 100}%"
            style:height="{(box.h / view.h) * 100}%"
            style:border-radius="{(Math.min(r, box.w / 2, box.h / 2) / box.w) * 100}% / {(Math.min(r, box.w / 2, box.h / 2) / box.h) * 100}%"
            role="button"
            tabindex="0"
            aria-pressed={selected === i}
            aria-label={p ? `Cell ${i + 1}: ${p.name}. Drag or use the arrow keys to reposition, plus and minus to zoom.` : `Cell ${i + 1}: empty. Add a photo.`}
            onpointerdown={(e) => panStart(e, i)}
            onpointermove={panMove}
            onpointerup={() => (pan = null)}
            onpointercancel={() => (pan = null)}
            onclick={() => !p && pick(i)}
            onkeydown={(e) => cellKey(e, i)}
            onfocus={() => (selected = i)}
            ondragover={(e) => {
              e.preventDefault();
              fileOver = i;
            }}
            ondragleave={() => (fileOver = null)}
            ondrop={(e) => fileDrop(e, i)}
          >
            {#if !p}<span class="mono add">+ add photo</span>{/if}
          </div>
          {#if p}
            <span
              class="grip"
              class:show={selected === i}
              style:left="calc({(box.x / view.w) * 100}% + 8px)"
              style:top="calc({(box.y / view.h) * 100}% + 8px)"
              title="Drag onto another cell to swap"
              aria-hidden="true"
              onpointerdown={(e) => moveStart(e, { cell: i })}
              onpointermove={moveMove}
              onpointerup={moveEnd}
              onpointercancel={() => (moving = null)}>⇄</span
            >
          {/if}
        {/each}
      </div>

      {#if current && selected !== null}
        {@const cell = selected}
        <div class="toolbar">
          <label class="min-w-[180px] flex-1">
            <span class="label">zoom · {Math.round(current.view.zoom * 100)}%</span>
            <input type="range" min="1" max={MAX_ZOOM} step="0.01" bind:value={current.view.zoom} class="w-full accent-(--color-sun)" />
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn sm" disabled={cell === 0} onclick={() => swap(cell, cell - 1)} aria-label="Swap with the previous cell">←</button>
            <button type="button" class="btn sm" disabled={cell === slots.length - 1} onclick={() => swap(cell, cell + 1)} aria-label="Swap with the next cell">→</button>
            <button type="button" class="btn sm" onclick={() => (current.view = { ...DEFAULT_VIEW })}>Reset</button>
            <button type="button" class="btn sm" onclick={() => pick(cell)}>Replace</button>
            <button type="button" class="btn sm" onclick={() => removePhoto(current.id)}>Remove</button>
          </div>
        </div>
      {:else}
        <p class="mono">drag a photo to reposition it · drag ⇄ onto another cell to swap · click a cell for zoom</p>
      {/if}

      <div>
        <span class="label">photos · {photos.length}/{MAX_PHOTOS}{unplaced.length ? ` · ${unplaced.length} not in this layout` : ''}</span>
        <ul class="tray" aria-label="Photos">
          {#each photos as p (p.id)}
            {@const cell = slots.indexOf(p.id)}
            <li class="slot" class:unused={cell < 0}>
              <button
                type="button"
                class="pic"
                aria-label={selected !== null ? `Put ${p.name} in cell ${selected + 1}` : p.name}
                onpointerdown={(e) => moveStart(e, { photo: p.id })}
                onpointermove={moveMove}
                onpointerup={moveEnd}
                onpointercancel={() => (moving = null)}
                onclick={() => {
                  if (justMoved) return (justMoved = false);
                  if (selected !== null) place(p.id, selected);
                }}
              >
                <canvas {@attach thumb(p.bmp)}></canvas>
                {#if cell >= 0}<span class="num">{cell + 1}</span>{/if}
              </button>
              <button type="button" class="x" onclick={() => removePhoto(p.id)} aria-label={`Remove ${p.name}`}>✕</button>
            </li>
          {/each}
          {#if photos.length < MAX_PHOTOS}
            <li><button type="button" class="pic more" onclick={() => pick()} aria-label="Add photos">+</button></li>
          {/if}
        </ul>
      </div>
      {#if decoding}<p class="mono working">reading {decoding} {decoding === 1 ? 'photo' : 'photos'}…</p>{/if}
      {#if notice}<p class="text-bad text-sm" role="alert">{notice}</p>{/if}
    </div>

    <aside class="grid content-start gap-5">
      <div>
        <span class="label">layout · {layout.label.toLowerCase()}</span>
        <div class="seg mb-3" role="group" aria-label="Number of photos">
          {#each counts as n (n)}
            <button type="button" aria-pressed={layout.cells.length === n} onclick={() => layout.cells.length !== n && arrange(layoutsFor(n)[0])}>{n}</button>
          {/each}
        </div>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Layout">
          {#each layoutsFor(layout.cells.length) as l (l.id)}
            <button type="button" class="lt" aria-pressed={l.id === layoutId} aria-label={l.label} title={l.label} onclick={() => arrange(l)}>
              <svg viewBox="0 0 {mini.w} {mini.h}" style:aspect-ratio="{mini.w} / {mini.h}" aria-hidden="true">
                {#each cellBoxes(l, mini.w, mini.h, 3, 3) as b, i (i)}<rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" />{/each}
              </svg>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">shape</span>
        <div class="seg" role="group" aria-label="Canvas shape">
          {#each aspects as a (a.id)}
            <button type="button" aria-pressed={aspectId === a.id} onclick={() => (aspectId = a.id)}>{a.id}</button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">size · {size.w} × {size.h} px</span>
        <div class="seg" role="group" aria-label="Long side in pixels">
          {#each sizes as [value, label] (value)}
            <button type="button" aria-pressed={longSide === value} onclick={() => (longSide = value)}>{label}</button>
          {/each}
        </div>
      </div>

      <div class="grid gap-3">
        <label>
          <span class="label">spacing · {Math.round(px(gap, longSide))} px</span>
          <input type="range" min="0" max="50" bind:value={gap} class="w-full accent-(--color-sun)" />
        </label>
        <label>
          <span class="label">border · {Math.round(px(pad, longSide))} px</span>
          <input type="range" min="0" max="80" bind:value={pad} class="w-full accent-(--color-sun)" />
        </label>
        <label>
          <span class="label">corners · {Math.round(px(radius, longSide))} px</span>
          <input type="range" min="0" max="80" bind:value={radius} class="w-full accent-(--color-sun)" />
        </label>
      </div>

      <div>
        <span class="label">background</span>
        <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Background color">
          {#each swatches as c (c)}
            <button type="button" class="sw" style:background={c} aria-pressed={!transparent && background === c} aria-label={`Background ${c}`} onclick={() => ((background = c), (transparent = false))}></button>
          {/each}
          <button type="button" class="sw none" aria-pressed={transparent} aria-label="Transparent background" onclick={() => (transparent = true)}></button>
          <label class="sw pickr" aria-label="Custom background color">
            <input type="color" value={background} oninput={(e) => ((background = e.currentTarget.value), (transparent = false))} />
          </label>
        </div>
        {#if transparent && format === 'jpeg'}<p class="mono mt-2">JPG can't be transparent, so it saves with white</p>{/if}
      </div>

      <div class="grid gap-2 border-t border-line pt-5">
        <div class="seg" role="group" aria-label="File format">
          {#each formats as f (f)}
            <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{formatInfo[f].label}</button>
          {/each}
        </div>
        <button type="button" class="btn btn-primary" disabled={!placedCount || exporting || decoding > 0} onclick={download}>
          {exporting ? 'Saving…' : `Download ${formatInfo[format].label}`}
        </button>
        {#if emptyCells}<p class="mono">{emptyCells} empty {emptyCells === 1 ? 'cell' : 'cells'} will show the background</p>{/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

{#if moving?.travelled && movingPhoto}
  <canvas class="ghost" style:translate="{moving.x}px {moving.y}px" {@attach thumb(movingPhoto.bmp)} aria-hidden="true"></canvas>
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    min-height: 240px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .stage {
    position: relative;
    aspect-ratio: var(--ar);
    width: min(100%, calc(min(68vh, 640px) * var(--ar)));
    margin-inline: auto;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    /* checkerboard so a transparent background is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    user-select: none;
    & canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  }
  .cell {
    position: absolute;
    display: grid;
    place-items: center;
    cursor: pointer;
    outline: none;
    transition: box-shadow 0.15s;
    &:hover {
      box-shadow: inset 0 0 0 1px #f2ede499;
    }
    &.filled {
      cursor: grab;
      touch-action: none;
      &:active {
        cursor: grabbing;
      }
    }
    &:not(.filled) {
      background: #22211ecc;
      box-shadow: inset 0 0 0 1.5px #f2ede444;
    }
    &.sel,
    &:focus-visible {
      box-shadow: inset 0 0 0 2px var(--color-sun);
    }
    &.over {
      box-shadow: inset 0 0 0 3px var(--color-sun);
      background: #ffd25e22;
    }
  }
  .add {
    color: var(--color-soft);
    pointer-events: none;
  }
  .grip {
    position: absolute;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 99px;
    background: #131211cc;
    color: var(--color-chalk);
    font-size: 15px;
    cursor: move;
    touch-action: none;
    opacity: 0;
    transition: opacity 0.15s;
    &.show {
      opacity: 1;
      background: var(--color-sun);
      color: var(--color-bg);
    }
  }
  .stage:hover .grip {
    opacity: 1;
  }
  @media (hover: none) {
    .grip {
      opacity: 1;
    }
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px 16px;
    padding: 12px 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
  }
  .btn.sm {
    padding: 8px 12px;
    font-size: 14px;
  }
  .tray {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .slot {
    position: relative;
    &.unused .pic {
      opacity: 0.45;
      border-style: dashed;
    }
  }
  .pic {
    position: relative;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    padding: 0;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    overflow: hidden;
    background: var(--color-panel-2);
    color: var(--color-muted);
    font-size: 22px;
    cursor: grab;
    touch-action: none;
    & canvas {
      width: 100%;
      height: 100%;
    }
    &.more {
      cursor: pointer;
      border-style: dashed;
      &:hover {
        color: var(--color-chalk);
        border-color: var(--color-sun);
      }
    }
  }
  .num {
    position: absolute;
    left: 3px;
    bottom: 3px;
    min-width: 16px;
    padding: 0 3px;
    border-radius: 5px;
    background: #131211cc;
    font: 400 10.5px/16px var(--font-mono);
    color: var(--color-chalk);
  }
  .x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-soft);
    font-size: 10px;
    cursor: pointer;
    &:hover {
      color: var(--color-bad);
    }
  }
  .lt {
    width: 48px;
    padding: 5px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: transparent;
    cursor: pointer;
    & svg {
      display: block;
      width: 100%;
      max-height: 56px;
      margin-inline: auto;
      fill: var(--color-muted);
    }
    &:hover svg {
      fill: var(--color-soft);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      & svg {
        fill: var(--color-sun);
      }
    }
  }
  .sw {
    width: 30px;
    height: 30px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    &[aria-pressed='true'] {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .none {
    background: repeating-conic-gradient(#3a3935 0 25%, #1f1e1b 0 50%) 0 0 / 10px 10px;
  }
  .pickr {
    position: relative;
    overflow: hidden;
    background: conic-gradient(#ff7a6b, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff7a6b);
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
  }
  .ghost {
    position: fixed;
    left: -28px;
    top: -28px;
    width: 56px;
    height: 56px;
    border-radius: 12px;
    border: 2px solid var(--color-sun);
    box-shadow: 0 10px 30px #0008;
    pointer-events: none;
    z-index: 50;
  }
  .working {
    color: var(--color-sun);
  }
</style>
