<script lang="ts">
  import { tick } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeImage, formatInfo, imageKind, outputFormatFor, resizeImage, type ImageKind, type OutputFormat } from '@/engines/image/client';
  import { downloadBlob, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import { HANDLES, iou, moveBox, resizeBox, spanBox, type Box, type Effect, type Handle, type Region, type Shape } from '@/tools/lib/blur-image/regions';
  import { applyRegions } from '@/tools/lib/blur-image/render';

  /** longest side of the on-screen preview; the export always uses the full image */
  const PREVIEW_MAX = 1600;

  let file = $state<File | null>(null);
  let kind = $state<ImageKind>('unknown');
  let full = $state.raw<ImageData | null>(null);
  let preview = $state.raw<ImageData | null>(null);
  let loading = $state(false);
  let error = $state('');

  let regions = $state<Region[]>([]);
  let selectedId = $state<number | null>(null);
  let tool = $state<Shape>('ellipse');
  let allEffect = $state<Effect>('blur');
  let strength = $state(60);
  let outlines = $state(true);

  let format = $state<OutputFormat>('jpeg');
  let quality = $state(90);
  let saving = $state(false);
  let saved = $state('');

  let detecting = $state<string | null>(null);
  let detectNote = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let svg = $state<SVGSVGElement>();
  let stageWidth = $state(0);
  let nextId = 1;

  const W = $derived(full?.width ?? 1);
  const H = $derived(full?.height ?? 1);
  /** screen pixels per image pixel, for handle sizes and keyboard nudges */
  const zoom = $derived(stageWidth / W || 1);
  const selected = $derived(regions.find((r) => r.id === selectedId));
  const formats = $derived<OutputFormat[]>(kind === 'avif' ? ['jpeg', 'png', 'webp', 'avif'] : ['jpeg', 'png', 'webp']);
  const usesStrength = $derived(allEffect !== 'box' || regions.some((r) => r.effect && r.effect !== 'box'));

  const effects: [Effect, string][] = [['blur', 'blur'], ['pixelate', 'pixelate'], ['box', 'black box']];
  const effectName = (e: Effect) => effects.find(([k]) => k === e)![1];

  let opening = 0;

  async function open(files: File[]) {
    const f = files[0];
    const ticket = ++opening;
    loading = true;
    error = '';
    try {
      const [data, k] = await Promise.all([decodeImage(f), imageKind(f)]);
      const s = Math.min(1, PREVIEW_MAX / Math.max(data.width, data.height));
      const small = s < 1 ? await resizeImage(data, { width: Math.max(1, Math.round(data.width * s)), height: Math.max(1, Math.round(data.height * s)) }) : data;
      // a newer drop (or paste) wins
      if (ticket !== opening) return;
      preview = small;
      full = data;
      kind = k;
      format = outputFormatFor(k);
      file = f;
      regions = [];
      selectedId = null;
      detectNote = saved = '';
    } catch {
      if (ticket === opening) error = "Couldn't read that image. Try a JPG, PNG, WebP, AVIF or HEIC file.";
    } finally {
      if (ticket === opening) loading = false;
    }
  }

  function reset() {
    opening++;
    loading = false;
    file = null;
    full = preview = null;
    regions = [];
    selectedId = null;
    detectNote = saved = error = '';
  }

  // live preview: repaint on the next frame whenever regions or settings change
  $effect(() => {
    const src = preview;
    if (!src || !canvas) return;
    const s = src.width / W;
    const paints = regions.map((r) => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s, shape: r.shape, effect: r.effect ?? allEffect }));
    const amount = strength;
    const frame = requestAnimationFrame(() => {
      canvas!.width = src.width;
      canvas!.height = src.height;
      canvas!.getContext('2d')!.putImageData(applyRegions(src, paints, amount), 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  });

  // ── drawing, moving and resizing on the overlay ──

  type Drag =
    | { kind: 'draw'; x: number; y: number }
    | { kind: 'move' | 'resize'; region: Region; start: Box; x: number; y: number; handle?: Handle };

  let drag: Drag | null = null;
  let draft = $state<Box | null>(null);

  function point(e: PointerEvent) {
    const rect = svg!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }

  async function focusRegion(id: number) {
    await tick();
    svg?.querySelector<SVGGElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = point(e);
    const target = e.target as Element;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    const id = Number(target.closest('[data-id]')?.getAttribute('data-id'));
    if (handle && selected) {
      drag = { kind: 'resize', region: selected, start: { ...selected }, handle: HANDLES[Number(handle)], ...p };
    } else if (id) {
      const region = regions.find((r) => r.id === id)!;
      selectedId = id;
      drag = { kind: 'move', region, start: { ...region }, ...p };
      focusRegion(id);
    } else {
      selectedId = null;
      drag = { kind: 'draw', ...p };
    }
    svg!.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const p = point(e);
    if (drag.kind === 'draw') {
      draft = spanBox(drag.x, drag.y, p.x, p.y, W, H);
      return;
    }
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    Object.assign(drag.region, drag.kind === 'move' ? moveBox(drag.start, dx, dy, W, H) : resizeBox(drag.start, drag.handle!, dx, dy, W, H));
  }

  function up(e: PointerEvent) {
    if (e.type === 'pointerup' && drag?.kind === 'draw' && draft && draft.w * zoom >= 6 && draft.h * zoom >= 6) {
      const region: Region = { id: nextId++, ...draft, shape: tool, effect: null };
      regions.push(region);
      selectedId = region.id;
      focusRegion(region.id);
    }
    drag = null;
    draft = null;
  }

  /** for keyboard and touch users: a shape in the middle of the photo to move into place */
  function addRegion() {
    const side = Math.min(W, H) / 4;
    const region: Region = { id: nextId++, x: (W - side) / 2, y: (H - side) / 2, w: side, h: side, shape: tool, effect: null };
    regions.push(region);
    selectedId = region.id;
    focusRegion(region.id);
  }

  function remove(id: number) {
    regions = regions.filter((r) => r.id !== id);
    if (selectedId === id) selectedId = null;
  }

  function onKey(e: KeyboardEvent, r: Region) {
    const step = (e.shiftKey ? 10 : 1) / zoom;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Delete' || e.key === 'Backspace') remove(r.id);
    else if (e.key === 'Escape') {
      selectedId = null;
      (e.currentTarget as SVGGElement).blur();
    } else if (arrows[e.key]) {
      const [dx, dy] = arrows[e.key];
      // Alt drags the right and bottom edges instead
      Object.assign(r, e.altKey ? resizeBox(r, [1, 1], dx, dy, W, H) : moveBox(r, dx, dy, W, H));
    }
    else return;
    e.preventDefault();
  }

  function setShape(s: Shape) {
    tool = s;
    if (selected) selected.shape = s;
  }

  // ── face detection (loaded only when asked for) ──

  async function detect() {
    const src = full;
    if (!src) return;
    detecting = 'Loading detector…';
    detectNote = '';
    try {
      const [{ findFaces }, bitmap] = await Promise.all([import('@/tools/lib/blur-image/faces'), createImageBitmap(src)]);
      detecting = 'Finding faces…';
      const faces = await findFaces(bitmap, (f) => (detecting = `Finding faces… ${Math.round(f * 100)}%`)).finally(() => bitmap.close());
      // the photo was swapped while we looked
      if (src !== full) return;
      // don't stack a second region on a face that's already covered
      const fresh = faces.filter((f) => !regions.some((r) => iou(r, f) > 0.3));
      regions.push(...fresh.map((f) => ({ id: nextId++, ...f, shape: 'ellipse' as const, effect: null })));
      detectNote = faces.length
        ? `Found ${faces.length} face${faces.length === 1 ? '' : 's'}${fresh.length < faces.length ? ` (${faces.length - fresh.length} already covered)` : ''}. Check for any it missed, like faces in profile or far away.`
        : 'No faces found. Drag over them by hand instead.';
    } catch {
      if (src === full) detectNote = "Face detection couldn't start in this browser. You can still drag over faces by hand.";
    } finally {
      detecting = null;
    }
  }

  // ── export ──

  async function save() {
    const src = full;
    if (!src || !file) return;
    saving = true;
    saved = error = '';
    try {
      // let "Saving…" paint before the full-size work blocks the page
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
      const out = applyRegions(src, regions.map((r) => ({ ...r, effect: r.effect ?? allEffect })), strength);
      const blob = await encodeImage(out, { format, quality, background: '#ffffff' });
      if (src !== full) return;
      const name = withSuffix(withExtension(file.name, formatInfo[format].ext), '-blurred');
      downloadBlob(blob, name);
      saved = `${name} · ${formatBytes(blob.size)}`;
    } catch {
      error = 'Something went wrong while saving. Try PNG, or a smaller image.';
    } finally {
      saving = false;
    }
  }

  const handlePoint = ([hx, hy]: Handle, b: Box) => [b.x + ((hx + 1) / 2) * b.w, b.y + ((hy + 1) / 2) * b.h];
</script>

{#if !file || !preview}
  <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Opening…' : 'Drop a photo here'} hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={open} />
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div class="grid content-start gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label={selected ? 'Shape of the selected region' : 'Shape to draw'}>
          {#each [['ellipse', '◯ ellipse'], ['rect', '▭ rectangle']] as const as [s, label]}
            <button type="button" aria-pressed={(selected?.shape ?? tool) === s} onclick={() => setShape(s)}>{label}</button>
          {/each}
        </div>
        <button type="button" class="btn py-2! text-sm!" onclick={addRegion}>+ add shape</button>
        <button type="button" class="btn ml-auto py-2! text-sm!" disabled={!!detecting} aria-busy={!!detecting} onclick={detect}>
          {#if detecting}<span class="pulse" aria-hidden="true"></span>{/if}
          {detecting ?? 'Auto-detect faces'}
        </button>
      </div>

      <div class="stage" style={`max-width: min(100%, ${((W / H) * 72).toFixed(2)}vh)`} bind:clientWidth={stageWidth}>
        <canvas bind:this={canvas} class="block h-auto w-full" aria-hidden="true"></canvas>
        <svg
          bind:this={svg}
          viewBox={`0 0 ${W} ${H}`}
          class="overlay"
          class:quiet={!outlines}
          role="application"
          aria-label="Photo preview. Drag on it to cover an area."
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
        >
          {#each regions as r, i (r.id)}
            <g
              data-id={r.id}
              class="region"
              class:on={r.id === selectedId}
              tabindex="0"
              role="button"
              aria-label={`Region ${i + 1}: ${r.shape === 'rect' ? 'rectangle' : 'ellipse'}, ${effectName(r.effect ?? allEffect)}. Arrow keys move it, Alt with arrow keys resizes it, Delete removes it.`}
              onfocus={() => (selectedId = r.id)}
              onkeydown={(e) => onKey(e, r)}
            >
              {#if r.shape === 'ellipse'}
                <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} vector-effect="non-scaling-stroke" />
              {:else}
                <rect x={r.x} y={r.y} width={r.w} height={r.h} vector-effect="non-scaling-stroke" />
              {/if}
            </g>
          {/each}

          {#if selected && outlines}
            {@const hs = 10 / zoom}
            {#if selected.shape === 'ellipse'}
              <rect class="frame" x={selected.x} y={selected.y} width={selected.w} height={selected.h} vector-effect="non-scaling-stroke" />
            {/if}
            {#each HANDLES as h, i}
              {@const [hx, hy] = handlePoint(h, selected)}
              <g data-handle={i} class="handle" style={`cursor: ${h[0] * h[1] === 0 ? (h[0] ? 'ew' : 'ns') : h[0] * h[1] > 0 ? 'nwse' : 'nesw'}-resize`}>
                <rect x={hx - hs * 1.4} y={hy - hs * 1.4} width={hs * 2.8} height={hs * 2.8} fill="transparent" />
                <rect class="knob" x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} rx={hs / 4} vector-effect="non-scaling-stroke" />
              </g>
            {/each}
          {/if}

          {#if draft}
            {#if tool === 'ellipse'}
              <ellipse class="draft" cx={draft.x + draft.w / 2} cy={draft.y + draft.h / 2} rx={draft.w / 2} ry={draft.h / 2} vector-effect="non-scaling-stroke" />
            {:else}
              <rect class="draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} vector-effect="non-scaling-stroke" />
            {/if}
          {/if}
        </svg>
      </div>

      <p class="mono" aria-live="polite">
        {#if detectNote}{detectNote}
        {:else if regions.length}{regions.length} region{regions.length === 1 ? '' : 's'} · click one to move or resize it · Delete removes it
        {:else}drag over a face, plate, name or screen to hide it
        {/if}
      </p>
    </div>

    <div class="grid content-start gap-5">
      <div>
        <span class="label">effect for all regions</span>
        <div class="seg" role="group" aria-label="Effect for all regions">
          {#each effects as [e, label]}
            <button type="button" aria-pressed={allEffect === e} onclick={() => (allEffect = e)}>{label}</button>
          {/each}
        </div>
      </div>

      {#if usesStrength}
        <label>
          <span class="label">strength · {strength}</span>
          <input type="range" min="10" max="100" bind:value={strength} class="w-full accent-(--color-sun)" />
        </label>
      {/if}

      {#if selected}
        <div class="grid gap-3 rounded-xl border border-line-2 bg-panel-2 p-3">
          <div>
            <span class="label">this region</span>
            <div class="seg" role="group" aria-label="Effect for the selected region">
              <button type="button" aria-pressed={selected.effect === null} onclick={() => (selected.effect = null)}>same</button>
              {#each effects as [e, label]}
                <button type="button" aria-pressed={selected.effect === e} onclick={() => (selected.effect = e)}>{label}</button>
              {/each}
            </div>
          </div>
          <button type="button" class="btn py-2! text-sm!" onclick={() => remove(selected.id)}>Delete region</button>
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={outlines} class="accent-(--color-sun)" /> show outlines</label>
        {#if regions.length}
          <button type="button" class="mono underline decoration-dotted underline-offset-4 hover:text-chalk" onclick={() => ((regions = []), (selectedId = null))}>clear all</button>
        {/if}
      </div>

      <div class="grid gap-4 border-t border-line pt-5">
        <div>
          <span class="label">save as</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each formats as f}
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
        <button type="button" class="btn btn-primary" disabled={!regions.length || saving} onclick={save}>
          {saving ? 'Saving…' : `Download ${formatInfo[format].label}`}
        </button>
        {#if saved}<p class="mono text-ok!" role="status">{saved}</p>{/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
        <p class="mono">full resolution · re-encoded, so EXIF, GPS and other metadata are removed</p>
        <button type="button" class="btn py-2! text-sm!" onclick={reset}>Use another photo</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .stage {
    position: relative;
    width: 100%;
    margin-inline: auto;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
    user-select: none;
  }
  .region {
    cursor: move;
    outline: none;
    & :is(rect, ellipse) {
      fill: transparent;
      stroke: var(--color-chalk);
      stroke-width: 1.5;
      stroke-dasharray: 5 4;
    }
    &.on :is(rect, ellipse),
    &:focus-visible :is(rect, ellipse) {
      stroke: var(--color-sun);
      stroke-width: 2;
      stroke-dasharray: none;
    }
  }
  .quiet .region :is(rect, ellipse) {
    stroke: transparent;
  }
  .frame {
    fill: none;
    stroke: var(--color-sun);
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 3 3;
    pointer-events: none;
  }
  .knob {
    fill: var(--color-sun);
    stroke: var(--color-bg);
    stroke-width: 1.5;
  }
  .draft {
    fill: #ffd25e1a;
    stroke: var(--color-sun);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    pointer-events: none;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--color-sun);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
</style>
