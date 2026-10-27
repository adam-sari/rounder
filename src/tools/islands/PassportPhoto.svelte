<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas, encodeImage, resizeImage } from '@/engines/image/client';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { DPI, SPECS, formatLength, guideFor, sizeLabel } from '@/tools/lib/passport/specs';
  import { PAPERS, cutLines, layoutSheet, type SheetLayout } from '@/tools/lib/passport/sheet';
  import { backgroundHints, backgroundStats, coversFrame, type Hint, type Placement } from '@/tools/lib/passport/check';
  import { withDpi } from '@/tools/lib/passport/dpi';

  /** longest side of the downscaled copy used while editing; the full photo is only drawn on export */
  const PREVIEW_MAX = 2048;
  /** zoom limits, relative to the size that just covers the frame */
  const ZOOM: [number, number] = [0.35, 10];
  const TILT = 20;
  const SHEET_PREVIEW = 440;
  const ACCEPT = 'image/*,.heic,.heif,.avif';

  let specId = $state('us');
  const spec = $derived(SPECS.find((s) => s.id === specId)!);
  const guide = $derived(guideFor(spec));

  let full = $state.raw<ImageBitmap>();
  let preview = $state.raw<ImageBitmap>();
  let name = 'photo';
  let loading = $state(false);
  let error = $state('');
  let place = $state<Placement>({ cx: 0, cy: 0, scale: 1, rotation: 0 });
  let showGuide = $state(true);
  let hints = $state<Hint[]>([]);
  let paperId = $state('4x6');
  let sheetFormat = $state<'jpeg' | 'png'>('jpeg');
  let busy = $state<'' | 'photo' | 'sheet'>('');
  let saved = $state('');

  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let sheetCanvas = $state<HTMLCanvasElement>();
  let picker = $state<HTMLInputElement>();

  const mid = ([a, b]: [number, number]) => (a + b) / 2;
  const paper = $derived(PAPERS.find((p) => p.id === paperId)!);
  const layout = $derived(layoutSheet(paper, guide.width, guide.height));
  const cover = $derived(full ? Math.max(guide.width / full.width, guide.height / full.height) : 1);
  const covered = $derived(!full || coversFrame(place, full, guide));
  // more than 1.25 output px per source px and the print starts to look soft
  const soft = $derived(place.scale > 1.25);
  // zoom and tilt turn around the middle of the head oval, so a lined-up face stays put
  const pivot = $derived({ x: guide.width / 2, y: (mid(guide.crown) + mid(guide.chin)) / 2 });
  const oval = $derived({ ...pivot, rx: guide.head * 0.39, ry: (mid(guide.chin) - mid(guide.crown)) / 2 });
  const shade = $derived(
    `M0 0H${guide.width}V${guide.height}H0Z M${oval.x - oval.rx} ${oval.y}a${oval.rx} ${oval.ry} 0 1 0 ${2 * oval.rx} 0a${oval.rx} ${oval.ry} 0 1 0 ${-2 * oval.rx} 0Z`,
  );
  const fs = $derived(guide.width * 0.036);
  const range = (a: number, b: number) => `${formatLength(a, spec.unit).replace(/ \w+$/, '')}–${formatLength(b, spec.unit)}`;

  /** only the most recent pick may replace the photo, however long older decodes take */
  let loadId = 0;

  async function load(files: File[]) {
    const id = ++loadId;
    loading = true;
    error = '';
    let bitmap: ImageBitmap | undefined;
    let small: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(await decodeImage(files[0]));
      const r = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
      small = r < 1
        ? await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(bitmap.width * r)), resizeHeight: Math.max(1, Math.round(bitmap.height * r)), resizeQuality: 'high' })
        : bitmap;
      if (id !== loadId) throw new Error('superseded');
      release();
      full = bitmap;
      preview = small;
      name = files[0].name.replace(/\.[^.]+$/, '') || 'photo';
      saved = '';
      reset();
    } catch {
      if (small !== bitmap) small?.close();
      bitmap?.close();
      if (id === loadId) error = "Couldn't read that image. Try a JPG, PNG or HEIC photo.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  function release() {
    if (preview !== full) preview?.close();
    full?.close();
  }
  onDestroy(release);

  function reset() {
    place = { cx: guide.width / 2, cy: guide.height / 2, scale: cover, rotation: 0 };
  }

  /** switching documents keeps the face lined up with the new guide */
  function pickSpec(id: string) {
    const from = guide;
    specId = id;
    saved = '';
    const k = guide.head / from.head;
    place = {
      cx: guide.width / 2 + (place.cx - from.width / 2) * k,
      cy: mid(guide.crown) + (place.cy - mid(from.crown)) * k,
      scale: place.scale * k,
      rotation: place.rotation,
    };
  }

  function pan(dx: number, dy: number) {
    place = { ...place, cx: place.cx + dx, cy: place.cy + dy };
  }

  function zoomBy(f: number, x = pivot.x, y = pivot.y) {
    const scale = Math.min(cover * ZOOM[1], Math.max(cover * ZOOM[0], place.scale * f));
    const k = scale / place.scale;
    place = { ...place, cx: x + (place.cx - x) * k, cy: y + (place.cy - y) * k, scale };
  }

  function rotateTo(deg: number, x = pivot.x, y = pivot.y) {
    const rotation = Math.max(-TILT, Math.min(TILT, deg));
    const a = ((rotation - place.rotation) * Math.PI) / 180;
    const dx = place.cx - x;
    const dy = place.cy - y;
    place = { cx: x + dx * Math.cos(a) - dy * Math.sin(a), cy: y + dx * Math.sin(a) + dy * Math.cos(a), scale: place.scale, rotation };
  }

  // ---- pointer, wheel and keyboard ----
  const pointers = new Map<number, { x: number; y: number }>();

  /** client coordinates → output px */
  function toFrame(e: { clientX: number; clientY: number }) {
    const r = stage!.getBoundingClientRect();
    const u = guide.width / r.width;
    return { x: (e.clientX - r.left) * u, y: (e.clientY - r.top) * u };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    stage!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toFrame(e));
  }

  function move(e: PointerEvent) {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = toFrame(e);
    const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      // pinch: follow the midpoint, scale by the change in finger spread and turn with the twist
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const mx = (now.x + other.x) / 2;
      const my = (now.y + other.y) / 2;
      const turn = Math.atan2(now.y - other.y, now.x - other.x) - Math.atan2(last.y - other.y, last.x - other.x);
      pan(mx - (last.x + other.x) / 2, my - (last.y + other.y) / 2);
      if (before > 0) zoomBy(Math.hypot(now.x - other.x, now.y - other.y) / before, mx, my);
      // wrap to ±180° so crossing the atan2 seam isn't read as a full turn
      if (turn) rotateTo(place.rotation + (Math.atan2(Math.sin(turn), Math.cos(turn)) * 180) / Math.PI, mx, my);
    } else {
      pan(now.x - last.x, now.y - last.y);
    }
    pointers.set(e.pointerId, now);
  }

  const up = (e: PointerEvent) => pointers.delete(e.pointerId);

  // wheel needs a non-passive listener to stop the page scrolling
  $effect(() => {
    const el = stage;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toFrame(e);
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.002), p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 4;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(-step, 0),
      ArrowRight: () => pan(step, 0),
      ArrowUp: () => pan(0, -step),
      ArrowDown: () => pan(0, step),
      '+': () => zoomBy(1.03),
      '=': () => zoomBy(1.03),
      '-': () => zoomBy(1 / 1.03),
      '[': () => rotateTo(place.rotation - 0.5),
      ']': () => rotateTo(place.rotation + 0.5),
    };
    const act = actions[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  }

  // ---- drawing ----
  function paint(ctx: CanvasRenderingContext2D, img: ImageBitmap, k: number) {
    const { width, height } = full!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(place.cx, place.cy);
    ctx.rotate((place.rotation * Math.PI) / 180);
    ctx.scale(place.scale, place.scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function drawSheet(target: HTMLCanvasElement, photo: CanvasImageSource, l: SheetLayout, q: number) {
    const { width: w, height: h } = guide;
    target.width = Math.round(l.width * q);
    target.height = Math.round(l.height * q);
    const ctx = target.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.imageSmoothingQuality = 'high';
    for (const s of l.slots) ctx.drawImage(photo, s.x * q, s.y * q, w * q, h * q);

    // cut lines run along every photo edge and a little past the grid, like crop marks
    const first = l.slots[0];
    const last = l.slots[l.slots.length - 1];
    const ext = Math.round((4 / 25.4) * DPI);
    const top = Math.max(0, first.y - ext);
    const bottom = Math.min(l.height, last.y + h + ext);
    const left = Math.max(0, first.x - ext);
    const right = Math.min(l.width, last.x + w + ext);
    const { xs, ys } = cutLines(l, w, h);
    ctx.strokeStyle = '#b4b4b4';
    ctx.lineWidth = Math.max(1, 2 * q);
    ctx.beginPath();
    for (const x of xs) {
      ctx.moveTo(x * q, top * q);
      ctx.lineTo(x * q, bottom * q);
    }
    for (const y of ys) {
      ctx.moveTo(left * q, y * q);
      ctx.lineTo(right * q, y * q);
    }
    ctx.stroke();

    const size = 26;
    if (l.height - bottom >= size * 2.5) {
      ctx.fillStyle = '#8a8a8a';
      ctx.font = `${size * q}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const note = `${sizeLabel(spec)} · ${spec.country} ${spec.document} · print at 100% (actual size), not “fit to page”`;
      ctx.fillText(note, (l.width / 2) * q, (bottom + size * 1.6) * q, (l.width - 2 * size) * q);
    }
  }

  const context = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

  // repaint immediately while dragging; check the background and redraw the sheet once it settles
  $effect(() => {
    const src = canvas;
    if (!src || !preview) return;
    const { width, height } = guide;
    if (src.width !== width || src.height !== height) Object.assign(src, { width, height });
    paint(context(src), preview, 1);

    const sheet = sheetCanvas;
    const l = layout;
    const need = spec.bright;
    const t = setTimeout(() => {
      hints = backgroundHints(backgroundStats(context(src).getImageData(0, 0, width, height).data, width, height), need);
      if (sheet) drawSheet(sheet, src, l, SHEET_PREVIEW / Math.max(l.width, l.height));
    }, 120);
    return () => clearTimeout(t);
  });

  // ---- export ----
  /** draws the full-resolution photo at 2× and scales down with Lanczos for a crisp result */
  async function renderPhoto(): Promise<ImageData> {
    const { width, height } = guide;
    const c = Object.assign(document.createElement('canvas'), { width: width * 2, height: height * 2 });
    const ctx = c.getContext('2d')!;
    paint(ctx, full!, 2);
    return resizeImage(ctx.getImageData(0, 0, c.width, c.height), { width, height, method: 'lanczos3' });
  }

  async function run(kind: 'photo' | 'sheet', job: () => Promise<void>) {
    busy = kind;
    error = '';
    try {
      await job();
    } catch {
      error = 'Something went wrong while saving. Please try again.';
    } finally {
      busy = '';
    }
  }

  const downloadPhoto = () =>
    run('photo', async () => {
      const blob = await withDpi(await encodeImage(await renderPhoto(), { format: 'jpeg', quality: 92 }), DPI);
      downloadBlob(blob, `${name}-${spec.id}-photo.jpg`);
      saved = `${guide.width} × ${guide.height} px · ${formatBytes(blob.size)}`;
    });

  const downloadSheet = () =>
    run('sheet', async () => {
      const img = await renderPhoto();
      const photo = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      photo.getContext('2d')!.putImageData(img, 0, 0);
      const sheet = document.createElement('canvas');
      drawSheet(sheet, photo, layout, 1);
      const blob = await withDpi(await encodeCanvas(sheet, { format: sheetFormat, quality: 92 }), DPI);
      downloadBlob(blob, `${name}-${spec.id}-${paper.id}-sheet.${sheetFormat === 'jpeg' ? 'jpg' : 'png'}`);
    });

  function onPick(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    if (files.length) load(files);
  }
</script>

{#if !preview}
  <div class="grid gap-4">
    <Dropzone accept={ACCEPT} title="Drop a portrait photo" hint="or click to choose · JPG, PNG, HEIC" onfiles={load} />
    {#if loading}<p class="mono" role="status">reading your photo…</p>{/if}
    {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
    <ul class="tips grid gap-2 sm:grid-cols-3">
      <li><b>Plain, light wall</b><span class="mono">white or light grey, nothing behind you</span></li>
      <li><b>Soft, even light</b><span class="mono">face a window; no shadows on face or wall</span></li>
      <li><b>Straight on</b><span class="mono">camera at eye level, neutral face, eyes open</span></li>
    </ul>
  </div>
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="desk">
        <!-- a custom 2D widget with its own key handling, which is what role="application" is for -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          bind:this={stage}
          class="stage"
          style:aspect-ratio={`${guide.width} / ${guide.height}`}
          style:max-width={`calc(min(62vh, 540px) * ${guide.width / guide.height})`}
          tabindex="0"
          role="application"
          aria-label="Photo position. Drag to move, scroll or pinch to zoom, twist two fingers to straighten."
          aria-describedby="pp-keys"
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onkeydown={key}
        >
          <canvas bind:this={canvas}>Your {spec.country} {spec.document} photo, as it will be saved</canvas>
          {#if showGuide}
            <svg viewBox={`0 0 ${guide.width} ${guide.height}`} aria-hidden="true">
              <path d={shade} class="shade" fill-rule="evenodd" />
              <rect x="0" y={guide.eyes[0]} width={guide.width} height={guide.eyes[1] - guide.eyes[0]} class="band eyes" />
              <rect x="0" y={guide.chin[0]} width={guide.width} height={guide.chin[1] - guide.chin[0]} class="band" />
              {#if guide.crown[1] > guide.crown[0]}
                <rect x="0" y={guide.crown[0]} width={guide.width} height={guide.crown[1] - guide.crown[0]} class="band" />
              {/if}
              <line x1={guide.width / 2} x2={guide.width / 2} y1="0" y2={guide.height} class="axis" />
              {#each [...new Set([...guide.crown, ...guide.chin])] as y}
                <line x1="0" x2={guide.width} y1={y} y2={y} class="rule" />
              {/each}
              <ellipse cx={oval.x} cy={oval.y} rx={oval.rx} ry={oval.ry} class="oval" />
              <text x={fs * 0.5} y={guide.crown[0] - fs * 0.4} font-size={fs}>top of head</text>
              <text x={fs * 0.5} y={guide.eyes[0] - fs * 0.4} font-size={fs} class="eyes">eyes</text>
              <text x={fs * 0.5} y={guide.chin[1] + fs * 1.1} font-size={fs}>chin</text>
            </svg>
          {/if}
        </div>
      </div>

      <p class="text-soft text-sm">
        Put the top of your head on the <span class="key">top line</span>, your chin in the <span class="key">yellow band</span> and
        your eyes in the <span class="key eyes">green band</span>.
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label>
          <span class="label">zoom · {(place.scale / cover).toFixed(2)}×</span>
          <input
            type="range"
            min={Math.log2(ZOOM[0])}
            max={Math.log2(ZOOM[1])}
            step="0.01"
            value={Math.log2(place.scale / cover)}
            oninput={(e) => zoomBy((2 ** +e.currentTarget.value * cover) / place.scale)}
            class="w-full accent-(--color-sun)"
          />
        </label>
        <label>
          <span class="label">straighten · {place.rotation.toFixed(1)}°</span>
          <input type="range" min={-TILT} max={TILT} step="0.1" value={place.rotation} oninput={(e) => rotateTo(+e.currentTarget.value)} class="w-full accent-(--color-sun)" />
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label class="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={showGuide} /> show guide</label>
        <button type="button" class="btn px-3! py-2!" onclick={reset}>Reset</button>
        <!-- a real button so the keyboard can reach it; disabled mid-export because loading closes the bitmap being saved -->
        <button type="button" class="btn px-3! py-2!" disabled={!!busy || loading} onclick={() => picker?.click()}>Change photo</button>
        <input bind:this={picker} type="file" accept={ACCEPT} hidden onchange={onPick} />
      </div>
      <p id="pp-keys" class="mono">keyboard: arrows move (shift for bigger steps) · + and − zoom · [ and ] straighten</p>
      {#if loading}<p class="mono" role="status">reading your photo…</p>{/if}
    </div>

    <aside class="grid content-start gap-5">
      <label>
        <span class="label">document</span>
        <select class="field" value={specId} onchange={(e) => pickSpec(e.currentTarget.value)}>
          {#each SPECS as s}
            <option value={s.id}>{s.country} · {s.document} ({sizeLabel(s)})</option>
          {/each}
        </select>
      </label>

      <dl class="specs">
        <dt>size</dt><dd>{sizeLabel(spec)}{spec.unit === 'in' ? ` (${Math.round(spec.widthMm)} × ${Math.round(spec.heightMm)} mm)` : ''}</dd>
        <dt>digital</dt><dd>{guide.width} × {guide.height} px at {DPI} dpi</dd>
        <dt>head</dt><dd>{range(spec.head[0], spec.head[1])}, chin to top of head</dd>
        {#if spec.eyes}<dt>eyes</dt><dd>{range(spec.eyes[0], spec.eyes[1])} up from the bottom</dd>{/if}
        {#if spec.top}<dt>above head</dt><dd>{range(spec.top[0], spec.top[1])}</dd>{/if}
        <dt>background</dt><dd>{spec.background}</dd>
        <dt>rules</dt><dd>{spec.source}</dd>
      </dl>

      <div class="grid gap-2 border-t border-line pt-5">
        <span class="label">checks</span>
        <ul class="grid gap-2 text-sm" aria-live="polite">
          {#if !covered}<li class="bad">The photo doesn't fill the frame, so an edge will be blank. Zoom in or move it.</li>{/if}
          {#if soft}<li class="bad">Your photo is lower resolution than this crop needs, so the print may look soft.</li>{/if}
          {#each hints as h}<li class={h.ok ? 'ok' : 'bad'}>{h.text}</li>{/each}
        </ul>
        <p class="mono">No automatic background removal yet: the check only reads the corners beside your head.</p>
      </div>

      <div class="grid gap-2 border-t border-line pt-5">
        <span class="label">digital photo</span>
        <button type="button" class="btn btn-primary" disabled={!!busy} onclick={downloadPhoto}>
          {busy === 'photo' ? 'Saving…' : 'Download JPG'}
        </button>
        <p class="mono">{saved ? `saved · ${saved}` : `${guide.width} × ${guide.height} px, for online forms or a print shop`}</p>
      </div>

      <div class="grid gap-3 border-t border-line pt-5">
        <span class="label">print sheet</span>
        <div class="flex flex-wrap gap-2">
          <div class="seg" role="group" aria-label="Paper size">
            {#each PAPERS as p}
              <button type="button" aria-pressed={paperId === p.id} onclick={() => (paperId = p.id)}>{p.label}</button>
            {/each}
          </div>
          <div class="seg" role="group" aria-label="Sheet format">
            {#each [['jpeg', 'JPG'], ['png', 'PNG']] as const as [f, label]}
              <button type="button" aria-pressed={sheetFormat === f} onclick={() => (sheetFormat = f)}>{label}</button>
            {/each}
          </div>
        </div>
        <canvas bind:this={sheetCanvas} class="sheet">{layout.slots.length} photos laid out on {paper.label} paper</canvas>
        <p class="mono">
          {layout.slots.length} photos on {paper.label} ·
          {paper.id === '4x6' ? 'order a standard 4×6 print at any photo lab' : 'print at 100% (actual size), not "fit to page"'}
        </p>
        <button type="button" class="btn" disabled={!!busy} onclick={downloadSheet}>
          {busy === 'sheet' ? 'Building sheet…' : `Download ${paper.label} sheet`}
        </button>
      </div>

      {#if error}<p class="text-bad text-sm" role="alert">{error}</p>{/if}
    </aside>
  </div>
{/if}

<style>
  .tips li {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-panel);
    & b {
      font-weight: 500;
      font-size: 14px;
    }
  }
  .desk {
    display: grid;
    place-items: center;
    padding: clamp(12px, 3vw, 28px);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background:
      radial-gradient(circle at 50% 40%, #ffd25e0a, transparent 70%),
      var(--color-panel-2);
  }
  .stage {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 1px 0 #ffffff14 inset, 0 18px 40px -18px #000c;
    cursor: grab;
    touch-action: none;
    user-select: none;
    &:active {
      cursor: grabbing;
    }
    & canvas,
    & svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    & svg {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
  }
  .shade {
    fill: #131211;
    fill-opacity: 0.38;
  }
  .band {
    fill: var(--color-sun);
    fill-opacity: 0.16;
    &.eyes {
      fill: var(--color-ok);
    }
  }
  .rule,
  .oval,
  .axis {
    fill: none;
    stroke: var(--color-sun);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .oval {
    stroke-dasharray: 6 5;
  }
  .axis {
    stroke-opacity: 0.35;
    stroke-dasharray: 2 6;
  }
  text {
    font-family: var(--font-mono);
    fill: var(--color-sun);
    paint-order: stroke;
    stroke: #131211b3;
    stroke-width: 3px;
    &.eyes {
      fill: var(--color-ok);
    }
  }
  .key {
    color: var(--color-sun);
    &.eyes {
      color: var(--color-ok);
    }
  }
  .specs {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 14px;
    & dt {
      font: 400 12.5px/1.6 var(--font-mono);
      color: var(--color-muted);
    }
    & dd {
      margin: 0;
      color: var(--color-soft);
    }
  }
  li.ok,
  li.bad {
    position: relative;
    padding-left: 18px;
    &::before {
      content: '';
      position: absolute;
      left: 2px;
      top: 0.55em;
      width: 8px;
      height: 8px;
      border-radius: 99px;
      background: var(--color-ok);
    }
  }
  li.bad::before {
    background: var(--color-bad);
  }
  .sheet {
    display: block;
    max-width: 100%;
    max-height: 240px;
    justify-self: center;
    border-radius: 3px;
    box-shadow: 0 10px 30px -14px #000;
  }
</style>
