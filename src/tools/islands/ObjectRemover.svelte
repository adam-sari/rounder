<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CompareSlider from '@/components/tool/CompareSlider.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { deviceLabel } from '@/engines/ai/device';
  import { toAiError } from '@/engines/ai/errors';
  import { totalDownloadSize } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { decodeImage, encodeImage, formatInfo, imageKind, outputFormatFor, type ImageKind, type OutputFormat } from '@/engines/image/client';
  import { deviceMessage, guard } from '@/tools/lib/device-guard';
  import { downloadBlob, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import { cropAround, groupStrokes, shiftStrokes, SIDE, type Rect, type Stroke } from '@/tools/lib/object-remover/geometry';
  import type { InpaintModel, InpaintWorker, ModelChoice } from '@/tools/lib/object-remover/inpaint.worker';
  import { cropPixels, pastePixels } from '@/tools/lib/object-remover/pixels';
  import { traceStroke } from '@/tools/lib/object-remover/raster';

  /** canvas caps: iOS refuses canvases over 16.7 MP, and the paint overlay can be coarser */
  const VIEW_PIXELS = 16e6;
  const MASK_PIXELS = 4e6;
  const MASK_COLOR = '#c8a6ff';

  interface Patch extends Rect {
    before: ImageData;
    after: ImageData;
  }
  /** one undo step: the marks before and after it, plus the pixels a Remove pass changed */
  interface Edit {
    strokes: [before: Stroke[], after: Stroke[]];
    patches?: Patch[];
  }

  const MODES: { key: InpaintModel; label: string; hint: string }[] = [
    { key: 'migan', label: 'Standard', hint: 'MI-GAN · fast, works on phones' },
    { key: 'lama', label: 'High quality', hint: 'Big LaMa · better on large areas · best on a computer' },
  ];

  const worker = modelWorker<InpaintWorker>(() => new Worker(new URL('../lib/object-remover/inpaint.worker.ts', import.meta.url), { type: 'module' }));
  let choice: ModelChoice = { key: 'migan' };
  let model = $state<InpaintModel>('migan');

  let file = $state<File | null>(null);
  let kind = $state<ImageKind>('unknown');
  /** the working photo at full size; Remove passes and undo write into it in place */
  let image = $state.raw<ImageData | null>(null);
  let loading = $state(false);
  let error = $state('');
  let note = $state('');

  let strokes = $state.raw<Stroke[]>([]);
  let done = $state.raw<Edit[]>([]);
  let undone = $state.raw<Edit[]>([]);
  let tool = $state<'brush' | 'eraser'>('brush');
  let brush = $state(40);
  let busy = $state('');
  let controller: AbortController | null = null;

  let view = $state<'edit' | 'compare'>('edit');
  let beforeUrl = $state('');
  let afterUrl = $state('');

  let format = $state<OutputFormat>('jpeg');
  let quality = $state(92);
  let saving = $state(false);
  let saved = $state('');

  let viewport = $state<HTMLDivElement>();
  let world = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let maskCanvas = $state<HTMLCanvasElement>();
  let vw = $state(0);
  let vh = $state(0);
  let zoom = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let hover = $state<{ x: number; y: number } | null>(null);
  let space = $state(false);

  const W = $derived(image?.width ?? 1);
  const H = $derived(image?.height ?? 1);
  const viewScale = $derived(Math.min(1, Math.sqrt(VIEW_PIXELS / (W * H))));
  const maskScale = $derived(Math.min(1, Math.sqrt(MASK_PIXELS / (W * H))));
  /** screen pixels per image pixel at zoom 1 */
  const fit = $derived(vw / W || 1);
  /** up to 4 screen pixels per image pixel */
  const maxZoom = $derived(Math.min(32, Math.max(4, 4 / fit)));
  const marked = $derived(strokes.some((s) => !s.erase));
  const edited = $derived(done.some((e) => e.patches));
  const lastPass = $derived(done.at(-1)?.patches && !strokes.length ? done.at(-1) : undefined);
  const formats = $derived<OutputFormat[]>(kind === 'avif' ? ['jpeg', 'png', 'webp', 'avif'] : ['jpeg', 'png', 'webp']);

  onMount(() => () => {
    worker.terminate();
    URL.revokeObjectURL(beforeUrl);
    URL.revokeObjectURL(afterUrl);
  });

  async function load({ key, variant, device, onProgress, signal }: GateLoadContext) {
    choice = { key: key as InpaintModel, variant, device };
    return worker.call((api) => api.load(choice, proxy(onProgress)), signal);
  }

  // ── opening ──

  let opening = 0;

  async function open(files: File[]) {
    const f = files[0];
    const ticket = ++opening;
    loading = true;
    error = '';
    try {
      const [data, k] = await Promise.all([decodeImage(f), imageKind(f)]);
      if (ticket !== opening) return;
      // low-end devices: the photo, its preview and undo history stay in memory at full size
      guard('image-ai', { width: data.width, height: data.height });
      clear();
      image = data;
      kind = k;
      format = outputFormatFor(k);
      file = f;
    } catch (err) {
      if (ticket === opening) error = deviceMessage('image-ai', err) ?? "Couldn't read that image. Try a JPG, PNG, WebP, AVIF or HEIC file.";
    } finally {
      if (ticket === opening) loading = false;
    }
  }

  function clear() {
    strokes = [];
    done = undone = [];
    zoom = 1;
    tx = ty = 0;
    view = 'edit';
    note = saved = error = '';
    URL.revokeObjectURL(beforeUrl);
    URL.revokeObjectURL(afterUrl);
    beforeUrl = afterUrl = '';
  }

  function reset() {
    opening++;
    loading = false;
    clear();
    file = null;
    image = null;
  }

  // ── drawing the photo and the marks ──

  /** draws the whole photo, or one rect of it, onto the on-screen canvas */
  async function paintView(r?: Rect) {
    const img = image;
    const ctx = canvas?.getContext('2d');
    if (!img || !ctx) return;
    const area = r ?? { x: 0, y: 0, w: img.width, h: img.height };
    const bitmap = await createImageBitmap(r ? new ImageData(cropPixels(img, r), r.w, r.h) : img);
    ctx.drawImage(bitmap, area.x * viewScale, area.y * viewScale, area.w * viewScale, area.h * viewScale);
    bitmap.close();
  }

  /** a JPEG of what's on screen, for the before/after slider */
  async function snapshot() {
    const s = Math.min(1, 2048 / Math.max(canvas!.width, canvas!.height));
    const c = new OffscreenCanvas(Math.round(canvas!.width * s), Math.round(canvas!.height * s));
    c.getContext('2d')!.drawImage(canvas!, 0, 0, c.width, c.height);
    return URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
  }

  // the canvas is new whenever a photo opens or the editor comes back from the compare view
  $effect(() => {
    if (!canvas || !image) return;
    untrack(async () => {
      await paintView();
      if (!beforeUrl && canvas) beforeUrl = await snapshot();
    });
  });

  function maskContext() {
    const ctx = maskCanvas!.getContext('2d')!;
    ctx.setTransform(maskScale, 0, 0, maskScale, 0, 0);
    ctx.fillStyle = ctx.strokeStyle = MASK_COLOR;
    return ctx;
  }

  function redrawMask() {
    if (!maskCanvas) return;
    const ctx = maskContext();
    ctx.clearRect(0, 0, W, H);
    for (const s of strokes) traceStroke(ctx, s);
  }

  $effect(() => {
    void strokes;
    if (maskCanvas && image) untrack(redrawMask);
  });

  // ── history ──

  function commit(e: Edit) {
    done = [...done, e];
    undone = [];
    strokes = e.strokes[1];
    note = '';
  }

  /** pastes every patch at once (so a Remove started meanwhile never reads a half-restored photo), then repaints */
  async function applyPatches(list: Patch[], key: 'before' | 'after') {
    for (const p of list) pastePixels(image!, p[key], p.x, p.y);
    for (const p of list) await paintView(p);
  }

  async function undo() {
    const e = done.at(-1);
    if (!e || busy) return;
    done = done.slice(0, -1);
    undone = [...undone, e];
    strokes = e.strokes[0];
    note = '';
    if (e.patches) await applyPatches([...e.patches].reverse(), 'before');
  }

  async function redo() {
    const e = undone.at(-1);
    if (!e || busy) return;
    undone = undone.slice(0, -1);
    done = [...done, e];
    strokes = e.strokes[1];
    note = '';
    if (e.patches) await applyPatches(e.patches, 'after');
  }

  // ── zoom and pan ──

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  function clampPan() {
    tx = clamp(tx, vw - vw * zoom, 0);
    ty = clamp(ty, vh - vh * zoom, 0);
  }

  $effect(() => {
    void [vw, vh];
    untrack(clampPan);
  });

  /** zooms keeping the point at (cx, cy) in the viewport still */
  function zoomTo(z: number, cx = vw / 2, cy = vh / 2) {
    const next = clamp(z, 1, maxZoom);
    tx = cx - ((cx - tx) * next) / zoom;
    ty = cy - ((cy - ty) * next) / zoom;
    zoom = next;
    clampPan();
  }

  function local(e: { clientX: number; clientY: number }) {
    const r = viewport!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function wheel(e: WheelEvent) {
    // ctrl + wheel is also what a trackpad pinch sends
    if (e.ctrlKey || e.metaKey) {
      const p = local(e);
      zoomTo(zoom * Math.exp(-e.deltaY * 0.01), p.x, p.y);
    } else if (zoom > 1) {
      tx -= e.deltaX;
      ty -= e.deltaY;
      clampPan();
    } else return;
    e.preventDefault();
  }

  // ── pointer: one finger or the mouse paints, two fingers zoom and pan, space or the middle button pans ──

  type Gesture =
    | { kind: 'draw'; stroke: Stroke; at: number }
    | { kind: 'pan'; x: number; y: number; tx: number; ty: number }
    | { kind: 'pinch'; d: number; mx: number; my: number; zoom: number; tx: number; ty: number };

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | null = null;

  function toImage(e: PointerEvent) {
    const r = world!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  function pinch(): Gesture {
    const [a, b] = [...pointers.values()];
    return { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, zoom, tx, ty };
  }

  function addStroke(s: Stroke) {
    commit({ strokes: [strokes, [...strokes, s]] });
  }

  function down(e: PointerEvent) {
    if (busy || (e.pointerType === 'mouse' && e.button > 1)) return;
    e.preventDefault();
    viewport!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      // a second finger: zoom instead, dropping a stroke the first finger only just began
      if (gesture?.kind === 'draw') {
        if (performance.now() - gesture.at < 300) redrawMask();
        else addStroke(gesture.stroke);
      }
      gesture = pinch();
    } else if (pointers.size === 1) {
      if (e.button === 1 || space) {
        gesture = { kind: 'pan', ...local(e), tx, ty };
      } else {
        const stroke: Stroke = { erase: tool === 'eraser', r: brush / 2 / (fit * zoom), points: [toImage(e)] };
        gesture = { kind: 'draw', stroke, at: performance.now() };
        traceStroke(maskContext(), stroke);
      }
    }
  }

  function move(e: PointerEvent) {
    hover = e.pointerType === 'touch' ? null : local(e);
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    const g = gesture;
    if (g.kind === 'draw') {
      const ctx = maskContext();
      for (const c of e.getCoalescedEvents?.() ?? [e]) {
        const p = toImage(c);
        const last = g.stroke.points.at(-1)!;
        if (Math.hypot(p.x - last.x, p.y - last.y) < g.stroke.r * 0.2) continue;
        g.stroke.points.push(p);
        traceStroke(ctx, g.stroke, 0, g.stroke.points.length - 2);
      }
    } else if (g.kind === 'pan') {
      const p = local(e);
      tx = g.tx + p.x - g.x;
      ty = g.ty + p.y - g.y;
      clampPan();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const next = clamp((g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.d, 1, maxZoom);
      tx = (a.x + b.x) / 2 - ((g.mx - g.tx) / g.zoom) * next;
      ty = (a.y + b.y) / 2 - ((g.my - g.ty) / g.zoom) * next;
      zoom = next;
      clampPan();
    }
  }

  function up(e: PointerEvent) {
    if (!pointers.delete(e.pointerId)) return;
    if (gesture?.kind === 'draw' && e.type === 'pointerup') addStroke(gesture.stroke);
    else if (gesture?.kind === 'draw') redrawMask();
    // after a pinch, wait for every finger to lift before painting again
    if (gesture?.kind !== 'pinch' || !pointers.size) gesture = null;
  }

  function onKey(e: KeyboardEvent) {
    if (!image || view !== 'edit' || (e.target instanceof Element && e.target.closest('input:not([type=range]), textarea, select, [contenteditable]'))) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      if (!hover && !space) return;
      space = e.type === 'keydown';
    } else if (e.type !== 'keydown') return;
    else if (mod && k === 'z') e.shiftKey ? redo() : undo();
    else if (mod && k === 'y') redo();
    else if (mod) return;
    else if (k === '[') brush = Math.max(6, Math.round(brush / 1.2));
    else if (k === ']') brush = Math.min(160, Math.round(brush * 1.2));
    else if (k === 'b') tool = 'brush';
    else if (k === 'e') tool = 'eraser';
    else return;
    e.preventDefault();
  }

  // ── removing ──

  async function removeMarked() {
    const src = image;
    if (!src || !marked || busy) return;
    const ctl = (controller = new AbortController());
    const areas = groupStrokes(strokes, Math.max(24, Math.round(Math.max(W, H) * 0.02)));
    const patches: Patch[] = [];
    const start = performance.now();
    let device = choice.device;
    error = note = '';
    view = 'edit';
    try {
      for (const [i, area] of areas.entries()) {
        busy = areas.length > 1 ? `Removing area ${i + 1} of ${areas.length}…` : 'Removing…';
        const rect = cropAround(area.bounds, W, H, SIDE);
        const before = new ImageData(cropPixels(src, rect), rect.w, rect.h);
        const input = new ImageData(before.data.slice(), rect.w, rect.h);
        const strokesHere = shiftStrokes(area.strokes, -rect.x, -rect.y);
        const out = await worker.call((api) => api.erase(choice, transfer(input, [input.data.buffer]), strokesHere), ctl.signal);
        if (!out) continue;
        device = out.device;
        pastePixels(src, out.image, rect.x, rect.y);
        patches.push({ ...rect, before, after: out.image });
        await paintView(rect);
      }
      if (patches.length) {
        commit({ strokes: [strokes, []], patches });
        note = `Done in ${((performance.now() - start) / 1000).toFixed(1)} s on ${deviceLabel(device ?? 'wasm')}. Paint over anything left and press Remove again, or undo.`;
      } else {
        note = 'Nothing to remove: the eraser took all the paint back.';
      }
    } catch (err) {
      // all or nothing: put back what this pass already changed
      await applyPatches([...patches].reverse(), 'before');
      const e = toAiError(err);
      if (e.code !== 'aborted') {
        error = e.message + (e.code === 'out-of-memory' ? (model === 'lama' ? ' Try Standard mode, or paint a smaller area at a time.' : ' Try painting a smaller area at a time.') : '');
      }
    } finally {
      busy = '';
      controller = null;
    }
  }

  /** paints the last pass's marks again, for a second go at leftovers */
  function again() {
    if (lastPass) commit({ strokes: [[], lastPass.strokes[0]] });
  }

  async function compare() {
    if (!canvas) return;
    URL.revokeObjectURL(afterUrl);
    afterUrl = await snapshot();
    view = 'compare';
  }

  // ── saving ──

  async function save() {
    const img = image;
    if (!img || !file) return;
    saving = true;
    saved = error = '';
    try {
      const blob = await encodeImage(img, { format, quality, background: '#ffffff' });
      if (img !== image) return;
      const name = withSuffix(withExtension(file.name, formatInfo[format].ext), '-cleaned');
      downloadBlob(blob, name);
      saved = `${name} · ${formatBytes(blob.size)}`;
    } catch {
      error = 'Something went wrong while saving. Try PNG, or a smaller image.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} />

{#if !file || !image}
  <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Opening…' : 'Drop a photo here'} hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={open} />
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div class="grid min-w-0 content-start gap-3">
      {#if view === 'compare'}
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn py-2! text-sm!" onclick={() => (view = 'edit')}>← Back to editing</button>
          <span class="mono">drag the slider to compare</span>
        </div>
        <CompareSlider before={beforeUrl} after={afterUrl} beforeLabel="original" afterLabel="cleaned" />
      {:else}
        <div class="flex flex-wrap items-center gap-2">
          <div class="seg" role="group" aria-label="Tool">
            <button type="button" aria-pressed={tool === 'brush'} onclick={() => (tool = 'brush')} title="Brush (B)">brush</button>
            <button type="button" aria-pressed={tool === 'eraser'} onclick={() => (tool = 'eraser')} title="Eraser: takes paint back (E)">eraser</button>
          </div>
          <label class="flex min-w-36 flex-1 items-center gap-2 sm:max-w-52">
            <span class="mono shrink-0">size</span>
            <input type="range" min="6" max="160" bind:value={brush} class="w-full accent-(--color-ai)" aria-label="Brush size ([ and ] keys)" />
          </label>
          <div class="flex items-center gap-1">
            <button type="button" class="btn icon" disabled={!done.length || !!busy} onclick={undo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
            <button type="button" class="btn icon" disabled={!undone.length || !!busy} onclick={redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
          </div>
          <div class="ml-auto flex items-center gap-1">
            <button type="button" class="btn icon" disabled={zoom <= 1} onclick={() => zoomTo(zoom / 1.5)} aria-label="Zoom out">−</button>
            <button type="button" class="btn icon mono w-auto! px-2!" disabled={zoom === 1} onclick={() => zoomTo(1)} title="Fit the photo">{Math.round(zoom * 100)}%</button>
            <button type="button" class="btn icon" disabled={zoom >= maxZoom} onclick={() => zoomTo(zoom * 1.5)} aria-label="Zoom in">+</button>
          </div>
        </div>

        <div
          bind:this={viewport}
          bind:clientWidth={vw}
          bind:clientHeight={vh}
          class="viewport"
          class:busy={!!busy}
          class:grab={space}
          style={`aspect-ratio: ${W} / ${H}; max-width: min(100%, ${((W / H) * 70).toFixed(2)}vh)`}
          role="application"
          aria-label="Photo. Paint over what you want removed. Two fingers or Ctrl with the mouse wheel zoom; space and drag pans."
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onpointerleave={() => (hover = null)}
          onwheel={wheel}
        >
          <div bind:this={world} class="world" style={`transform: translate(${tx}px, ${ty}px) scale(${zoom})`}>
            <canvas bind:this={canvas} width={Math.round(W * viewScale)} height={Math.round(H * viewScale)}></canvas>
            <canvas bind:this={maskCanvas} class="mask" width={Math.round(W * maskScale)} height={Math.round(H * maskScale)}></canvas>
          </div>
          {#if hover && !busy && !space}
            <span class="cursor" class:eraser={tool === 'eraser'} style={`left: ${hover.x}px; top: ${hover.y}px; width: ${brush}px; height: ${brush}px`} aria-hidden="true"></span>
          {/if}
        </div>

        <p class="mono" aria-live="polite">
          {#if busy}{busy}
          {:else if marked}paint everything that belongs to the object, shadows too · then press Remove
          {:else}paint over what you want gone · two fingers or Ctrl + wheel to zoom · [ ] brush size
          {/if}
        </p>
      {/if}

      <div class="grid gap-3 border-t border-line pt-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="seg" role="group" aria-label="AI model">
            {#each MODES as m (m.key)}
              <button type="button" aria-pressed={model === m.key} disabled={!!busy} onclick={() => (model = m.key)}>
                {m.label} · {formatMB(totalDownloadSize(m.key, 'fp32'))}
              </button>
            {/each}
          </div>
          <span class="mono">{MODES.find((m) => m.key === model)!.hint}</span>
        </div>

        {#key model}
          <ModelGate {model} light={null} {load}>
            {#snippet children()}
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn btn-primary" disabled={!marked || !!busy} aria-busy={!!busy} onclick={removeMarked}>
                  {#if busy}<span class="pulse" aria-hidden="true"></span>{/if}
                  {busy ? 'Removing…' : 'Remove'}
                </button>
                {#if busy}
                  <button type="button" class="btn" onclick={() => controller?.abort()}>Cancel</button>
                {:else if lastPass}
                  <button type="button" class="btn" onclick={again}>Paint the same area again</button>
                {/if}
                {#if strokes.length && !busy}
                  <button type="button" class="mono underline decoration-dotted underline-offset-4 hover:text-chalk" onclick={() => commit({ strokes: [strokes, []] })}>clear paint</button>
                {/if}
              </div>
            {/snippet}
          </ModelGate>
        {/key}
        {#if note}<p class="mono text-ok!" role="status">{note}</p>{/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      </div>
    </div>

    <div class="grid content-start gap-5">
      <div>
        <span class="label">view</span>
        <div class="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'edit'} onclick={() => (view = 'edit')}>edit</button>
          <button type="button" aria-pressed={view === 'compare'} disabled={!edited || !!busy} onclick={compare}>before / after</button>
        </div>
      </div>

      <div class="grid gap-4 border-t border-line pt-5">
        <div>
          <span class="label">save as</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each formats as f (f)}
              <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{formatInfo[f].label}</button>
            {/each}
          </div>
        </div>
        {#if formatInfo[format].lossy}
          <label>
            <span class="label">quality · {quality}</span>
            <input type="range" min="50" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
          </label>
        {/if}
        <button type="button" class="btn btn-primary" disabled={!edited || saving || !!busy} onclick={save}>
          {saving ? 'Saving…' : `Download ${formatInfo[format].label}`}
        </button>
        {#if saved}<p class="mono text-ok!" role="status">{saved}</p>{/if}
        <p class="mono">full resolution · only painted areas change · metadata such as GPS is removed</p>
        <button type="button" class="btn py-2! text-sm!" disabled={!!busy} onclick={reset}>Use another photo</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .viewport {
    position: relative;
    width: 100%;
    margin-inline: auto;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    touch-action: none;
    user-select: none;
    cursor: none;
    &.grab {
      cursor: grab;
    }
    &.busy {
      cursor: progress;
    }
  }
  .world {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    & canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  }
  .mask {
    opacity: 0.55;
  }
  .busy .mask {
    animation: think 0.9s ease-in-out infinite alternate;
  }
  @keyframes think {
    to {
      opacity: 0.2;
    }
  }
  .cursor {
    position: absolute;
    translate: -50% -50%;
    border-radius: 99px;
    border: 1.5px solid var(--color-chalk);
    box-shadow: 0 0 0 1px #131211aa;
    background: color-mix(in srgb, var(--color-ai) 18%, transparent);
    pointer-events: none;
    &.eraser {
      border-style: dashed;
      background: none;
    }
  }
  .icon {
    width: 38px;
    padding: 8px 0;
    font-size: 16px;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--color-ai);
    animation: think 0.9s ease-in-out infinite alternate;
  }
</style>
