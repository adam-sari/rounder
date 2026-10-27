<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CompareSlider from '@/components/tool/CompareSlider.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { detectDevice } from '@/engines/ai/device';
  import { toAiError } from '@/engines/ai/errors';
  import { pickVariant, totalDownloadSize, type Device, type ModelKey } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { decodeImage, resizeImage } from '@/engines/image/client';
  import { canvas, compose, cutout, encode, frameSource, maskCanvas, onChecker, paintStroke, subjectBox, type Backdrop, type Look, type SaveFormat } from '@/tools/lib/background-remover/compose';
  import { fitSize, type Stroke } from '@/tools/lib/background-remover/matte';
  import type { RemoverWorker } from '@/tools/lib/background-remover/remover.worker';
  import { downloadBlob, withExtension, withSuffix, zipFiles } from '@/tools/lib/files';

  type Mode = 'best' | 'fast';
  const MODELS: Record<Mode, ModelKey> = { best: 'birefnet-lite', fast: 'modnet' };
  const MODE_KEY = 'rounder:background-remover:mode';
  /** longest side of the on-screen preview; downloads always use the full image */
  const PREVIEW_MAX = 1400;
  const SWATCHES = ['#ffffff', '#f2ede4', '#000000', '#ffd25e', '#c8a6ff', '#7cc4ff', '#9be58f', '#ff8fb8'];
  const BACKDROPS: [Backdrop, string][] = [['none', 'transparent'], ['color', 'color'], ['blur', 'blur'], ['image', 'image']];
  /** when the mask isn't a usable cut-out (see maskVerdict) */
  const NO_CUTOUT = {
    empty: "Couldn't find a subject in this photo.",
    everything: "Couldn't tell the subject from the background in this photo.",
    noise: 'The model gave an unclear result for this photo, so nothing was cut out.',
  };
  const FORMATS: Record<SaveFormat, { label: string; ext: string }> = { png: { label: 'PNG', ext: 'png' }, webp: { label: 'WebP', ext: 'webp' }, jpeg: { label: 'JPG', ext: 'jpg' } };

  /** big per-image data, kept out of Svelte's deep reactivity */
  class Heavy {
    preview: ImageBitmap | null = null;
    alpha: Uint8Array | null = null;
    strokes: Stroke[] = [];
  }

  interface Item {
    id: number;
    file: File;
    status: 'queued' | 'working' | 'done' | 'error';
    error: string;
    /** size the mask is made at (the original, unless it was too big for this device) */
    w: number;
    h: number;
    note: string;
    thumb: string;
    model: ModelKey | null;
    /** bumped when the mask must be rebuilt (new result, undo, reset) */
    rev: number;
    /** brush strokes, for display and to refresh previews */
    edits: number;
    heavy: Heavy;
  }

  const worker = modelWorker<RemoverWorker>(() => new Worker(new URL('../lib/background-remover/remover.worker.ts', import.meta.url), { type: 'module' }));

  let mode = $state<Mode | null>(null);
  let gpu = $state(true);
  let sizes = $state<Record<Mode, string>>({ best: '', fast: '' });
  let maxPixels = 50e6;
  /** the model the worker has loaded, as the gate chose it */
  let active = $state<{ key: ModelKey; variant: string; device: Device } | null>(null);
  let runs = new AbortController();

  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let paused = $state(false);
  let running = false;
  let generation = 0;
  let nextId = 0;

  let view = $state<'compare' | 'touch'>('compare');
  let look = $state<Look>({ backdrop: 'none', color: '#ffffff', blur: 40, image: null, shadow: false, crop: false });
  let bgName = $state('');
  let bgError = $state('');
  let bgInput = $state<HTMLInputElement>();
  let format = $state<SaveFormat>('png');
  let saving = $state('');
  let saveError = $state('');
  let urls = $state<{ id: number; before: string; after: string } | null>(null);

  const current = $derived(items.find((i) => i.id === selected));
  const done = $derived(items.filter((i) => i.status === 'done'));
  const pending = $derived(items.filter((i) => i.status === 'queued' || i.status === 'working').length);
  const formats = $derived<SaveFormat[]>(look.backdrop === 'none' ? ['png', 'webp'] : ['png', 'webp', 'jpeg']);
  const outFormat = $derived(formats.includes(format) ? format : 'png');

  onMount(() => {
    detectDevice().then((info) => {
      gpu = info.webgpu;
      if (info.isMobile) maxPixels = 16e6;
      for (const m of ['best', 'fast'] as const) {
        const c = pickVariant(MODELS[m], info);
        if (c) sizes[m] = formatMB(totalDownloadSize(MODELS[m], c.variant));
      }
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(MODE_KEY);
      } catch {}
      // phones and browsers without WebGPU start with the small model
      mode = info.webgpu && (saved === 'best' || (!saved && !info.isMobile)) ? 'best' : 'fast';
    });
    return () => {
      runs.abort();
      worker.terminate();
      for (const item of items) release(item);
      if (urls) revokeUrls(urls);
      look.image?.close();
    };
  });

  function setMode(m: Mode) {
    if (m === mode) return;
    // stop work on the old model; the gate loads the new one and everything is redone with it
    runs.abort();
    runs = new AbortController();
    active = null;
    mode = m;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  }

  async function loadModel({ key, variant, device, onProgress, signal }: GateLoadContext) {
    const r = await worker.call((api) => api.load(key, { variant, device }, proxy(onProgress)), signal);
    active = { key, variant: r.variant, device: r.device };
    return r;
  }

  // a newly loaded model redoes images made with the other one
  $effect(() => {
    const key = active?.key;
    if (!key) return;
    untrack(() => {
      for (const item of items) if (item.status !== 'working' && item.model !== key) item.status = 'queued';
      pump();
    });
  });

  // ── queue ──

  function add(files: File[]) {
    const fresh: Item[] = files.map((file) => ({ id: nextId++, file, status: 'queued', error: '', w: 0, h: 0, note: '', thumb: '', model: null, rev: 0, edits: 0, heavy: new Heavy() }));
    items.push(...fresh);
    selected ??= fresh[0]?.id ?? null;
    pump();
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (let item = items.find((i) => i.status === 'queued'); item && active && !paused; item = items.find((i) => i.status === 'queued')) await run(item, active);
    } finally {
      running = false;
    }
  }

  async function run(item: Item, model: NonNullable<typeof active>) {
    const gen = generation;
    const signal = runs.signal;
    const stale = () => gen !== generation || !items.includes(item);
    item.status = 'working';
    item.error = '';
    let img: ImageData;
    try {
      img = await decodeImage(item.file);
      if (img.width * img.height > maxPixels) {
        const s = Math.sqrt(maxPixels / (img.width * img.height));
        img = await resizeImage(img, { width: Math.round(img.width * s), height: Math.round(img.height * s) });
        item.note = `scaled to ${img.width}×${img.height} to fit this device's memory`;
      }
      if (!item.heavy.preview) {
        const [pw, ph] = fitSize(img.width, img.height, PREVIEW_MAX);
        item.heavy.preview = await createImageBitmap(pw === img.width ? img : await resizeImage(img, { width: pw, height: ph }));
        item.w = img.width;
        item.h = img.height;
        if (!stale()) setThumb(item, frameSource(item.heavy.preview, item.w, item.h, null, 120 / Math.max(item.w, item.h)));
      }
    } catch {
      if (stale()) return;
      item.status = 'error';
      item.error = "Couldn't read this image. Try a JPG, PNG, WebP or HEIC file.";
      return;
    }
    if (stale()) return item.heavy.preview?.close();
    try {
      // a cancelled or crashed worker starts fresh, so make sure the model is (re)loaded
      await worker.call((api) => api.load(model.key, { variant: model.variant, device: model.device }), signal);
      const { alpha, verdict } = await worker.call((api) => api.run(transfer(img, [img.data.buffer])), signal);
      if (stale()) return;
      if (!alpha) {
        item.status = 'error';
        item.error = NO_CUTOUT[verdict as keyof typeof NO_CUTOUT] + (mode === 'fast' ? ' Fast mode is made for people; Best mode handles any subject.' : '');
        return;
      }
      item.heavy.alpha = alpha;
      item.model = model.key;
      item.rev++;
      const s = 120 / Math.max(item.w, item.h);
      setThumb(item, cutout(item.heavy.preview!, maskCanvas(alpha, item.w, item.h, [], s), item.w, item.h, null, s));
      // a model switch while this ran sends it round again
      item.status = active?.key === model.key ? 'done' : 'queued';
    } catch (err) {
      if (stale()) return;
      const e = toAiError(err);
      if (e.code === 'aborted') item.status = 'queued';
      else {
        item.status = 'error';
        item.error = e.code === 'out-of-memory' ? `Ran out of memory on this photo. Try ${mode === 'best' ? 'Fast mode or ' : ''}a smaller image.` : e.message;
      }
    }
  }

  async function setThumb(item: Item, c: HTMLCanvasElement) {
    const blob = await encode(c, 'png');
    if (!items.includes(item)) return;
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    item.thumb = URL.createObjectURL(blob);
  }

  function release(item: Item) {
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    item.heavy.preview?.close();
  }

  function remove(item: Item) {
    release(item);
    items.splice(items.indexOf(item), 1);
    if (selected === item.id) selected = items[0]?.id ?? null;
  }

  function clear() {
    generation++;
    for (const item of items) release(item);
    items = [];
    selected = null;
    paused = false;
    saveError = '';
  }

  function resume() {
    paused = false;
    pump();
  }

  // ── preview masks: one live canvas for the selected image, at preview size ──

  let live: { id: number; rev: number; scale: number; canvas: HTMLCanvasElement } | null = null;

  function liveMask(item: Item) {
    if (live?.id !== item.id || live.rev !== item.rev) {
      const scale = item.heavy.preview!.width / item.w;
      live = { id: item.id, rev: item.rev, scale, canvas: maskCanvas(item.heavy.alpha!, item.w, item.h, item.heavy.strokes, scale) };
    }
    return live;
  }

  function revokeUrls(u: { before: string; after: string }) {
    URL.revokeObjectURL(u.before);
    URL.revokeObjectURL(u.after);
  }

  // before/after images for the compare slider, redrawn when the look or the mask changes
  $effect(() => {
    const item = current;
    if (!item || item.status !== 'done' || view !== 'compare') return;
    void item.rev;
    void item.edits;
    const l = { ...look };
    let stale = false;
    const t = setTimeout(async () => {
      const m = liveMask(item);
      const src = item.heavy.preview!;
      const box = l.crop ? subjectBox(m.canvas, item.w, item.h) : null;
      const [before, after] = await Promise.all([encode(frameSource(src, item.w, item.h, box, m.scale), 'png'), encode(onChecker(compose(src, m.canvas, item.w, item.h, l, box, m.scale)), 'png')]);
      const next = { id: item.id, before: URL.createObjectURL(before), after: URL.createObjectURL(after) };
      if (stale) return revokeUrls(next);
      if (urls) revokeUrls(urls);
      urls = next;
    }, 60);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  // ── touch up ──

  let editCanvas = $state<HTMLCanvasElement>();
  let scratch: HTMLCanvasElement | null = null;
  let brush = $state(48);
  let erase = $state(true);
  let ring = $state<{ x: number; y: number } | null>(null);
  let stroke: Stroke | null = null;
  let frame = 0;

  function drawEditor() {
    frame = 0;
    const item = current;
    if (!item?.heavy.alpha || !editCanvas) return;
    const m = liveMask(item);
    const src = item.heavy.preview!;
    const { width: pw, height: ph } = m.canvas;
    if (editCanvas.width !== pw || editCanvas.height !== ph) Object.assign(editCanvas, { width: pw, height: ph });
    if (!scratch || scratch.width !== pw || scratch.height !== ph) scratch = canvas(pw, ph);
    const sctx = scratch.getContext('2d')!;
    sctx.globalCompositeOperation = 'copy';
    sctx.drawImage(src, 0, 0, pw, ph);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(m.canvas, 0, 0);
    // what was removed stays faintly visible, so you can see what to bring back
    const ctx = editCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, pw, ph);
    ctx.globalAlpha = 0.22;
    ctx.drawImage(src, 0, 0, pw, ph);
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0);
  }

  const schedule = () => (frame ||= requestAnimationFrame(drawEditor));

  $effect(() => {
    if (view !== 'touch' || !editCanvas || current?.status !== 'done') return;
    void current.rev;
    drawEditor();
  });

  function at(e: PointerEvent, item: Item) {
    const r = editCanvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * item.w, y: ((e.clientY - r.top) / r.height) * item.h, k: item.w / r.width, cx: e.clientX - r.left, cy: e.clientY - r.top };
  }

  function down(e: PointerEvent) {
    const item = current;
    if (e.button !== 0 || !item?.heavy.alpha) return;
    e.preventDefault();
    editCanvas!.setPointerCapture(e.pointerId);
    const m = liveMask(item);
    const p = at(e, item);
    stroke = { erase, r: (brush / 2) * p.k, pts: [p.x, p.y] };
    item.heavy.strokes.push(stroke);
    paintStroke(m.canvas.getContext('2d')!, stroke, m.scale);
    schedule();
  }

  function move(e: PointerEvent) {
    const item = current;
    if (!item) return;
    const p = at(e, item);
    ring = { x: p.cx, y: p.cy };
    if (!stroke) return;
    const from = stroke.pts.length / 2;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const q = at(ev, item);
      stroke.pts.push(q.x, q.y);
    }
    const m = liveMask(item);
    paintStroke(m.canvas.getContext('2d')!, stroke, m.scale, from);
    schedule();
  }

  function up() {
    if (!stroke || !current) return;
    stroke = null;
    current.edits = current.heavy.strokes.length;
  }

  function undo() {
    const item = current;
    if (!item?.heavy.strokes.length) return;
    item.heavy.strokes.pop();
    item.edits = item.heavy.strokes.length;
    item.rev++;
  }

  function resetEdits() {
    const item = current;
    if (!item) return;
    item.heavy.strokes = [];
    item.edits = 0;
    item.rev++;
  }

  function onKey(e: KeyboardEvent) {
    if (view !== 'touch' || (e.target as HTMLElement).closest('input, textarea, select')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') undo();
    else if (e.key === '[') brush = Math.max(6, brush - 6);
    else if (e.key === ']') brush = Math.min(200, brush + 6);
    else return;
    e.preventDefault();
  }

  // ── backdrop image and export ──

  async function pickBackdrop(file: File | undefined) {
    if (!file) return;
    bgError = '';
    try {
      let img = await decodeImage(file);
      const [w, h] = fitSize(img.width, img.height, 4096);
      if (w !== img.width) img = await resizeImage(img, { width: w, height: h });
      look.image?.close();
      look.image = await createImageBitmap(img);
      look.backdrop = 'image';
      bgName = file.name;
    } catch {
      bgError = "Couldn't read that image. Try a JPG, PNG, WebP or HEIC file.";
    }
  }

  async function render(item: Item, l: Look, fmt: SaveFormat): Promise<Blob> {
    let img = await decodeImage(item.file);
    if (img.width !== item.w || img.height !== item.h) img = await resizeImage(img, { width: item.w, height: item.h });
    const src = await createImageBitmap(img);
    try {
      const mask = maskCanvas(item.heavy.alpha!, item.w, item.h, item.heavy.strokes, 1);
      const box = l.crop ? subjectBox(mask, item.w, item.h) : null;
      return await encode(compose(src, mask, item.w, item.h, l, box, 1), fmt);
    } finally {
      src.close();
    }
  }

  const outName = (item: Item) => withSuffix(withExtension(item.file.name, FORMATS[outFormat].ext), look.backdrop === 'none' ? '-no-bg' : '-new-bg');

  async function save(list: Item[]) {
    const l = { ...look };
    const fmt = outFormat;
    saveError = '';
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const [i, item] of list.entries()) {
        saving = list.length > 1 ? `Saving ${i + 1} of ${list.length}…` : 'Saving…';
        files.push({ name: outName(item), blob: await render(item, l, fmt) });
      }
      if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
      else {
        saving = 'Zipping…';
        downloadBlob(await zipFiles(files), 'rounder-cutouts.zip');
      }
    } catch (err) {
      console.error(err);
      saveError = "Couldn't save at full size, probably for lack of memory. Try PNG, or fewer or smaller photos.";
    } finally {
      saving = '';
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="grid gap-5">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div class="seg" role="group" aria-label="Model">
      <button type="button" aria-pressed={mode === 'best'} disabled={!gpu} onclick={() => setMode('best')}>Best · any subject</button>
      <button type="button" aria-pressed={mode === 'fast'} onclick={() => setMode('fast')}>Fast · people</button>
    </div>
    <p class="mono">
      {#if mode === 'best'}BiRefNet lite · {sizes.best} · people, products, pets, objects · needs WebGPU
      {:else if mode === 'fast'}MODNet · {sizes.fast} · made for people, not objects · {gpu ? 'quick on any device' : 'Best needs WebGPU, which this browser lacks'}
      {:else}checking your device…{/if}
    </p>
  </div>

  {#if mode}
    {#key mode}
      <ModelGate model={MODELS[mode]} light={null} load={loadModel}>
        {#snippet children()}
          <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div class="grid min-w-0 content-start gap-4">
              {#if !items.length}
                <Dropzone accept="image/*,.heic,.heif,.avif" multiple title="Drop photos here" hint="or click to choose · batches welcome" onfiles={add} />
              {:else}
                {#if current}
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="seg" role="group" aria-label="View">
                      <button type="button" aria-pressed={view === 'compare'} onclick={() => (view = 'compare')}>compare</button>
                      <button type="button" aria-pressed={view === 'touch'} onclick={() => (view = 'touch')}>touch up</button>
                    </div>
                    {#if view === 'touch' && current.status === 'done'}
                      <div class="seg" role="group" aria-label="Brush">
                        <button type="button" aria-pressed={erase} onclick={() => (erase = true)}>erase</button>
                        <button type="button" aria-pressed={!erase} onclick={() => (erase = false)}>restore</button>
                      </div>
                      <label class="flex items-center gap-2 mono">
                        size
                        <input type="range" min="6" max="200" bind:value={brush} class="w-24 accent-(--color-ai)" aria-label="Brush size" />
                      </label>
                      <button type="button" class="btn ml-auto px-3! py-2! text-sm!" disabled={!current.edits} onclick={undo}>Undo</button>
                      <button type="button" class="btn px-3! py-2! text-sm!" disabled={!current.edits} onclick={resetEdits}>Reset</button>
                    {/if}
                  </div>

                  {#if current.status === 'done'}
                    {#if view === 'compare'}
                      {#if urls?.id === current.id}<CompareSlider before={urls.before} after={urls.after} beforeLabel="original" afterLabel="result" />{/if}
                    {:else}
                      <div class="stage" style={`max-width: min(100%, ${((current.w / current.h) * 70).toFixed(2)}vh)`}>
                        <canvas
                          bind:this={editCanvas}
                          class="block h-auto w-full"
                          aria-label={`Touch-up canvas. Drag to ${erase ? 'erase leftover background' : 'restore parts of the subject'}. Ctrl+Z undoes, [ and ] change the brush size.`}
                          onpointerdown={down}
                          onpointermove={move}
                          onpointerup={up}
                          onpointercancel={up}
                          onpointerleave={() => (ring = null)}
                        ></canvas>
                        {#if ring}<span class="ring" class:restore={!erase} style={`left:${ring.x}px; top:${ring.y}px; width:${brush}px; height:${brush}px`} aria-hidden="true"></span>{/if}
                      </div>
                      <p class="mono">faded areas are removed · paint with “restore” to bring them back, or “erase” to remove leftovers</p>
                    {/if}
                  {:else if current.status === 'error'}
                    <p class="card p-5 text-sm text-bad" role="alert">{current.error}</p>
                  {:else}
                    <div class="scan" aria-live="polite">
                      {#if current.thumb}<img src={current.thumb} alt="" />{/if}
                      <span class="beam" aria-hidden="true"></span>
                      <p class="mono">{current.status === 'working' ? `finding the subject on ${active?.device === 'webgpu' ? 'your graphics card' : 'your processor'}…` : paused ? 'paused' : 'waiting its turn…'}</p>
                    </div>
                  {/if}
                {/if}

                <ul class="grid gap-2" aria-label="Photos">
                  {#each items as item (item.id)}
                    <li class="row" class:sel={item.id === selected}>
                      <button type="button" class="thumb" onclick={() => (selected = item.id)} aria-label={`Show ${item.file.name}`}>
                        {#if item.thumb}<img src={item.thumb} alt="" />{/if}
                      </button>
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm">{item.file.name}</p>
                        <p class="mono">
                          {#if item.status === 'done'}
                            <span class="text-ok">background removed</span> · {item.w}×{item.h}{item.edits ? ` · ${item.edits} touch-up${item.edits === 1 ? '' : 's'}` : ''}
                          {:else if item.status === 'error'}<span class="text-bad">{item.error}</span>
                          {:else if item.status === 'working'}<span class="working">working…</span>
                          {:else}{paused ? 'paused' : 'waiting…'}{/if}
                          {#if item.note}· {item.note}{/if}
                        </p>
                      </div>
                      {#if item.status === 'done'}
                        <button type="button" class="btn px-3! py-2!" disabled={!!saving} onclick={() => save([item])} aria-label={`Download ${item.file.name} without background`}>↓</button>
                      {/if}
                      <button type="button" class="btn px-3! py-2!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
                    </li>
                  {/each}
                </ul>
                <Dropzone accept="image/*,.heic,.heif,.avif" multiple title="Add more" hint="drop, click or paste" onfiles={add} />
              {/if}
            </div>

            <aside class="grid content-start gap-5">
              <div>
                <span class="label">background</span>
                <div class="seg" role="group" aria-label="Background">
                  {#each BACKDROPS as [b, label]}
                    <button type="button" aria-pressed={look.backdrop === b} onclick={() => (b === 'image' && !look.image ? bgInput?.click() : (look.backdrop = b))}>{label}</button>
                  {/each}
                </div>
              </div>

              {#if look.backdrop === 'color'}
                <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Background color">
                  {#each SWATCHES as c}
                    <button type="button" class="swatch" style={`background:${c}`} aria-pressed={look.color === c} aria-label={c} onclick={() => (look.color = c)}></button>
                  {/each}
                  <label class="swatch custom" title="Any color">
                    <input type="color" bind:value={look.color} aria-label="Pick any color" />
                  </label>
                </div>
              {:else if look.backdrop === 'blur'}
                <label>
                  <span class="label">blur · {look.blur}</span>
                  <input type="range" min="5" max="100" bind:value={look.blur} class="w-full accent-(--color-sun)" />
                </label>
              {:else if look.backdrop === 'image'}
                <div class="grid gap-2">
                  <button type="button" class="btn py-2! text-sm!" onclick={() => bgInput?.click()}>{look.image ? 'Change image…' : 'Choose image…'}</button>
                  {#if bgName && look.image}<p class="mono truncate">{bgName} · fills the frame</p>{/if}
                  {#if bgError}<p class="text-sm text-bad" role="alert">{bgError}</p>{/if}
                </div>
              {/if}
              <input bind:this={bgInput} type="file" accept="image/*,.heic,.heif,.avif" hidden onchange={(e) => pickBackdrop(e.currentTarget.files?.[0])} />

              <div class="grid gap-2">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={look.shadow} class="accent-(--color-sun)" /> soft shadow</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={look.crop} class="accent-(--color-sun)" /> crop to the subject</label>
              </div>

              {#if items.length}
                <div class="grid gap-3 border-t border-line pt-5">
                  {#if pending}
                    <div class="grid gap-2" aria-live="polite">
                      <div class="bar" role="progressbar" aria-label="Photos done" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done.length}>
                        <span style={`width:${(done.length / items.length) * 100}%`}></span>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <p class="mono">{done.length} of {items.length} done{paused ? ' · paused' : ''}</p>
                        {#if paused}<button type="button" class="btn px-3! py-2! text-sm!" onclick={resume}>Resume</button>
                        {:else}<button type="button" class="btn px-3! py-2! text-sm!" onclick={() => (paused = true)}>Pause</button>{/if}
                      </div>
                    </div>
                  {/if}
                  <div>
                    <span class="label">save as</span>
                    <div class="seg" role="group" aria-label="Output format">
                      {#each formats as f}
                        <button type="button" aria-pressed={outFormat === f} onclick={() => (format = f)}>{FORMATS[f].label}</button>
                      {/each}
                    </div>
                  </div>
                  {#if current?.status === 'done' && done.length > 1}
                    <button type="button" class="btn" disabled={!!saving} onclick={() => save([current])}>Download this one</button>
                  {/if}
                  <button type="button" class="btn btn-primary" disabled={!done.length || !!saving} onclick={() => save(done)}>
                    {saving || (done.length > 1 ? `Download all (${done.length}) as .zip` : 'Download')}
                  </button>
                  {#if saveError}<p class="text-sm text-bad" role="alert">{saveError}</p>{/if}
                  <p class="mono">full resolution · {outFormat === 'jpeg' ? 'JPG has no transparency' : 'transparent where the background was'}</p>
                  <button type="button" class="btn" onclick={clear}>Start over</button>
                </div>
              {/if}
            </aside>
          </div>
        {/snippet}
      </ModelGate>
    {/key}
  {/if}
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    margin-inline: auto;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    & canvas {
      touch-action: none;
      cursor: crosshair;
    }
  }
  .ring {
    position: absolute;
    translate: -50% -50%;
    border-radius: 99px;
    border: 1.5px solid var(--color-ai);
    box-shadow: 0 0 0 1px #0008;
    pointer-events: none;
    &.restore {
      border-color: var(--color-sun);
    }
  }
  .scan {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 260px;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--color-ai) 35%, var(--color-line-2));
    background: var(--color-panel);
    & img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: blur(14px) saturate(0.7);
      opacity: 0.45;
      transform: scale(1.1);
    }
    & p {
      position: relative;
      padding: 6px 12px;
      border-radius: 8px;
      background: #131211cc;
      color: var(--color-chalk);
    }
  }
  .beam {
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-ai) 28%, transparent), transparent);
    animation: sweep 1.8s ease-in-out infinite;
  }
  @keyframes sweep {
    from {
      translate: -100% 0;
    }
    to {
      translate: 340% 0;
    }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    &.sel {
      border-color: var(--color-ai);
    }
  }
  .thumb {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 10px;
    overflow: hidden;
    border: 0;
    padding: 0;
    cursor: pointer;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 12px 12px;
    & img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }
  .working {
    color: var(--color-ai);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  .swatch {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    &[aria-pressed='true'] {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
    &.custom {
      overflow: hidden;
      background: conic-gradient(#ff7a6b, #ffd25e, #9be58f, #7cc4ff, #c8a6ff, #ff8fb8, #ff7a6b);
      &:focus-within {
        outline: 2px solid var(--color-sun);
        outline-offset: 2px;
      }
      & input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      background: var(--color-ai);
      transition: width 0.3s ease-out;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam,
    .working {
      animation: none;
    }
    .beam {
      display: none;
    }
  }
</style>
