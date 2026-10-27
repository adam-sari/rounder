<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas, formatInfo, imageKind, outputFormatFor, processImage, type Rect } from '@/engines/image/client';
  import { downloadBlob, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import { dragRect, flipHorizontal, flipVertical, orientedSize, parseRatio, placeBox, resizeTo, toDisplay, toSource, turn, type Handle, type Orientation } from '@/tools/lib/crop-image/geometry';

  type Format = 'jpeg' | 'png' | 'webp';
  interface Loaded {
    file: File;
    /** full resolution, already EXIF-oriented by the decoder */
    bitmap: ImageBitmap;
    width: number;
    height: number;
  }

  // longest side of the on-screen canvas; the export always uses the full image
  const PREVIEW = 1600;
  const ratios: [string, number | null][] = [
    ['free', null], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3],
    ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3],
  ];
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let image = $state.raw<Loaded | null>(null);
  let loading = $state(false);
  let error = $state('');

  let o = $state<Orientation>({ rotate: 0, flipX: false, flipY: false });
  let rect = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let ratio = $state('free');
  let custom = $state({ w: 1, h: 1 });
  let shape = $state<'rect' | 'circle'>('rect');
  let format = $state<Format>('jpeg');
  let quality = $state(92);
  let saving = $state(false);
  let saved = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let box = $state<HTMLButtonElement>();
  let picker = $state<HTMLInputElement>();
  let drag = $state<{ id: number; handle: Handle; start: Rect; x: number; y: number; min: number } | null>(null);

  const size = $derived(image ? orientedSize(image.width, image.height, o.rotate) : { width: 1, height: 1 });
  const aspect = $derived(ratio === 'custom' ? parseRatio(custom.w, custom.h) : (ratios.find(([k]) => k === ratio)?.[1] ?? null));
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const boxStyle = $derived(`left:${pct(rect.x, size.width)};top:${pct(rect.y, size.height)};width:${pct(rect.width, size.width)};height:${pct(rect.height, size.height)}`);

  // a newer open() wins, so a slow HEIC can't replace a picture chosen after it
  let opens = 0;
  async function open(files: File[]) {
    const file = files[0];
    const id = ++opens;
    loading = true;
    error = '';
    saved = '';
    try {
      const [pixels, kind] = await Promise.all([decodeImage(file), imageKind(file)]);
      const bitmap = await createImageBitmap(pixels);
      if (id !== opens) return bitmap.close();
      const { width, height } = pixels;
      image = { file, bitmap, width, height };
      o = { rotate: 0, flipX: false, flipY: false };
      ratio = 'free';
      shape = 'rect';
      const out = outputFormatFor(kind);
      format = out === 'avif' ? 'webp' : out;
      rect = placeBox(width / 2, height / 2, width * 0.8, height * 0.8, width, height, null);
    } catch (e) {
      console.error(e);
      if (id === opens) error = (e as Error)?.message || "Couldn't open this image.";
    } finally {
      if (id === opens) loading = false;
    }
  }

  // free the old full-size bitmap when a new image replaces it
  $effect(() => {
    const bitmap = image?.bitmap;
    return () => bitmap?.close();
  });

  /** draws the whole image in display space (rotated and flipped) at 1 unit per pixel */
  function paint(ctx: CanvasRenderingContext2D, img: Loaded, or: Orientation) {
    const d = orientedSize(img.width, img.height, or.rotate);
    ctx.translate(d.width / 2, d.height / 2);
    ctx.rotate((or.rotate * Math.PI) / 180);
    ctx.scale(or.flipX ? -1 : 1, or.flipY ? -1 : 1);
    ctx.drawImage(img.bitmap, -img.width / 2, -img.height / 2);
  }

  $effect(() => {
    if (!canvas || !image) return;
    const k = Math.min(1, PREVIEW / Math.max(size.width, size.height));
    canvas.width = Math.max(1, Math.round(size.width * k));
    canvas.height = Math.max(1, Math.round(size.height * k));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(canvas.width / size.width, canvas.height / size.height);
    paint(ctx, image, o);
  });

  /** pointer position in full-resolution display pixels */
  function point(e: PointerEvent) {
    const b = stage!.getBoundingClientRect();
    const scale = size.width / b.width;
    return { x: (e.clientX - b.left) * scale, y: (e.clientY - b.top) * scale, scale };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !image || drag) return;
    e.preventDefault();
    const p = point(e);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    // outside the box: start a fresh box from this point, sized by dragging
    const start = handle ? rect : { x: Math.round(p.x), y: Math.round(p.y), width: 0, height: 0 };
    drag = { id: e.pointerId, handle: handle ?? 'se', start, x: p.x, y: p.y, min: Math.max(1, Math.round(16 * p.scale)) };
    stage!.setPointerCapture(e.pointerId);
    box?.focus({ preventScroll: true });
  }

  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const p = point(e);
    rect = dragRect(drag.start, drag.handle, p.x - drag.x, p.y - drag.y, size.width, size.height, aspect, drag.min);
  }

  function up(e: PointerEvent) {
    if (drag?.id === e.pointerId) drag = null;
  }

  function key(e: KeyboardEvent) {
    const dir = arrows[e.key];
    if (!dir) return;
    e.preventDefault();
    const step = e.shiftKey ? Math.max(10, Math.round(Math.max(size.width, size.height) / 100)) : 1;
    const [dx, dy] = [dir[0] * step, dir[1] * step];
    const handle: Handle = e.ctrlKey || e.metaKey ? (dx ? 'e' : 's') : 'move';
    rect = dragRect(rect, handle, dx, dy, size.width, size.height, aspect);
  }

  /** re-shapes the box to the locked ratio, keeping its centre and roughly its area */
  function applyAspect() {
    if (!aspect) return;
    const w = Math.sqrt(rect.width * rect.height * aspect);
    rect = placeBox(rect.x + rect.width / 2, rect.y + rect.height / 2, w, w / aspect, size.width, size.height, aspect);
  }

  function setRatio(key: string) {
    if (key === 'custom' && ratio !== 'custom') custom = { w: rect.width, h: rect.height };
    ratio = key;
    applyAspect();
  }

  function setShape(next: 'rect' | 'circle') {
    shape = next;
    if (next === 'circle') {
      setRatio('1:1');
      if (format === 'jpeg') format = 'png';
    }
  }

  // keeps the box over the same part of the picture when it turns or flips
  function reorient(next: Orientation) {
    if (!image) return;
    const moved = toDisplay(toSource(rect, image.width, image.height, o), image.width, image.height, next);
    const d = orientedSize(image.width, image.height, next.rotate);
    rect = aspect ? placeBox(moved.x + moved.width / 2, moved.y + moved.height / 2, rect.width, rect.height, d.width, d.height, aspect) : moved;
    o = next;
  }

  function setField(field: keyof Rect, input: HTMLInputElement) {
    const v = Math.round(Number(input.value));
    if (input.value !== '' && Number.isFinite(v)) {
      rect =
        field === 'width' || field === 'height'
          ? resizeTo(rect, field, Math.max(1, v), size.width, size.height, aspect)
          : dragRect(rect, 'move', field === 'x' ? v - rect.x : 0, field === 'y' ? v - rect.y : 0, size.width, size.height, aspect);
    }
    input.value = String(rect[field]); // show the clamped value even when the box didn't change
  }

  function selectAll() {
    rect = { x: 0, y: 0, width: size.width, height: size.height };
    applyAspect();
  }

  async function save() {
    if (!image) return;
    saving = true;
    error = '';
    // named now: another image or format may be picked while this one encodes
    const name = withSuffix(withExtension(image.file.name, formatInfo[format].ext), '-cropped');
    try {
      const encode = { format, quality };
      let blob: Blob;
      if (shape === 'circle') {
        const c = Object.assign(document.createElement('canvas'), { width: rect.width, height: rect.height });
        const ctx = c.getContext('2d');
        // browsers cap canvas size (iPhones at about 16.7 megapixels)
        if (!ctx) throw new Error('This circle is too large for your browser to draw. Try a smaller crop.');
        ctx.translate(-rect.x, -rect.y);
        paint(ctx, image, o);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // cut the circle with an antialiased fill rather than a hard clip
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.ellipse(rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        blob = await encodeCanvas(c, encode);
        c.width = c.height = 0;
      } else {
        const crop = toSource(rect, image.width, image.height, o);
        ({ blob } = await processImage(image.file, { crop, rotate: o.rotate, flipX: o.flipX, flipY: o.flipY, encode }));
      }
      downloadBlob(blob, name);
      saved = `${name} · ${formatBytes(blob.size)}`;
    } catch (e) {
      console.error(e);
      error = (e as Error)?.message || 'Something went wrong while saving.';
    } finally {
      saving = false;
    }
  }

  // tiny ratio swatch for the preset buttons
  function swatch(a: number | null) {
    if (!a) return 'width:18px;height:14px';
    return a >= 1 ? `width:18px;height:${18 / a}px` : `width:${18 * a}px;height:18px`;
  }
</script>

{#if !image}
  {#if loading}
    <div class="grid place-items-center gap-2 rounded-[18px] border border-line-2 px-5 py-16 text-center">
      <p class="font-serif text-3xl">Opening your image…</p>
      <p class="mono">decoding on your device</p>
    </div>
  {:else}
    <Dropzone accept="image/*,.heic,.heif,.avif" title="Drop an image to crop" hint="JPG, PNG, WebP, HEIC, AVIF or SVG" onfiles={open} />
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div class="grid min-w-0 content-start gap-3">
      <div class="frame">
        <div
          class="stage"
          style:--r={size.width / size.height}
          bind:this={stage}
          role="presentation"
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onlostpointercapture={up}
        >
          <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
          <canvas bind:this={canvas} role="img" aria-label={`Your image, ${size.width} by ${size.height} pixels`}></canvas>
          <div class="shade" aria-hidden="true"><div class="hole" class:round={shape === 'circle'} style={boxStyle}></div></div>
          <button
            type="button"
            class="box"
            class:round={shape === 'circle'}
            class:active={!!drag}
            style={boxStyle}
            bind:this={box}
            data-handle="move"
            onkeydown={key}
            aria-label={`Crop area ${rect.width} by ${rect.height} pixels at ${rect.x}, ${rect.y}. Arrow keys move it, Shift moves further, Ctrl or Command with arrows resizes.`}
          >
            <span class="thirds" aria-hidden="true"></span>
            {#each handles as h}<span class="h {h}" data-handle={h} aria-hidden="true"></span>{/each}
          </button>
        </div>
      </div>
      <p class="mono flex flex-wrap justify-between gap-x-4 gap-y-1">
        <span>crop <span class="text-sun">{rect.width} × {rect.height}</span> px · original {image.width} × {image.height}</span>
        <span>drag outside the box to draw a new one · arrows nudge</span>
      </p>
    </div>

    <aside class="grid content-start gap-5">
      <div>
        <span class="label">aspect ratio</span>
        <div class="ratios" role="group" aria-label="Aspect ratio">
          {#each ratios as [key, a]}
            <button type="button" aria-pressed={ratio === key} onclick={() => setRatio(key)}>
              <i class:free={!a} style={swatch(a)}></i>{key}
            </button>
          {/each}
          <button type="button" aria-pressed={ratio === 'custom'} onclick={() => setRatio('custom')}><i class="free" style={swatch(null)}></i>custom</button>
        </div>
        {#if ratio === 'custom'}
          <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label><span class="label">ratio width</span><input class="field" type="number" min="1" bind:value={custom.w} onchange={applyAspect} /></label>
            <span class="pb-3 text-muted">:</span>
            <label><span class="label">ratio height</span><input class="field" type="number" min="1" bind:value={custom.h} onchange={applyAspect} /></label>
          </div>
        {/if}
      </div>

      <div>
        <span class="label">shape</span>
        <div class="seg" role="group" aria-label="Shape">
          <button type="button" aria-pressed={shape === 'rect'} onclick={() => setShape('rect')}>rectangle</button>
          <button type="button" aria-pressed={shape === 'circle'} onclick={() => setShape('circle')}>circle</button>
        </div>
        {#if shape === 'circle'}<p class="mono mt-2">transparent corners · pick a ratio other than 1:1 for an oval</p>{/if}
      </div>

      <div>
        <span class="label">rotate & flip</span>
        <div class="grid grid-cols-4 gap-2">
          <button type="button" class="btn px-0!" title="Rotate left" aria-label="Rotate 90° left" onclick={() => reorient({ ...o, rotate: turn(o.rotate - 90) })}>↺</button>
          <button type="button" class="btn px-0!" title="Rotate right" aria-label="Rotate 90° right" onclick={() => reorient({ ...o, rotate: turn(o.rotate + 90) })}>↻</button>
          <button type="button" class="btn px-0!" title="Flip horizontally" aria-label="Flip horizontally" onclick={() => reorient(flipHorizontal(o))}>⇆</button>
          <button type="button" class="btn px-0!" title="Flip vertically" aria-label="Flip vertically" onclick={() => reorient(flipVertical(o))}>⇅</button>
        </div>
      </div>

      <div>
        <span class="label">exact size & position (px)</span>
        <div class="grid grid-cols-2 gap-2">
          {#each [['width', 'W'], ['height', 'H'], ['x', 'X'], ['y', 'Y']] as const as [field, tag]}
            <label class="num">
              <span aria-hidden="true">{tag}</span>
              <input class="field" type="number" min={field === 'width' || field === 'height' ? 1 : 0} value={rect[field]} aria-label={field} onchange={(e) => setField(field, e.currentTarget)} />
            </label>
          {/each}
        </div>
        <button type="button" class="mono mt-2 cursor-pointer underline decoration-line-2 underline-offset-4 hover:text-chalk" onclick={selectAll}>select whole image</button>
      </div>

      <div class="grid gap-3 border-t border-line pt-5">
        <div>
          <span class="label">format</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each ['jpeg', 'png', 'webp'] as const as f}
              <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{formatInfo[f].label}</button>
            {/each}
          </div>
          {#if shape === 'circle' && format === 'jpeg'}<p class="mono mt-2">JPG has no transparency, so the corners will be white</p>{/if}
        </div>
        {#if format !== 'png'}
          <label>
            <span class="label">quality · {quality}</span>
            <input type="range" min="40" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
          </label>
        {/if}
        <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : `Download ${formatInfo[format].label}`}</button>
        {#if saved}<p class="mono text-ok!">saved {saved}</p>{/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
        <button type="button" class="btn" disabled={loading} onclick={() => picker?.click()}>{loading ? 'Opening…' : 'Crop another image'}</button>
        <input
          bind:this={picker}
          type="file"
          accept="image/*,.heic,.heif,.avif"
          class="hidden"
          onchange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length) open(files);
          }}
        />
      </div>
    </aside>
  </div>
{/if}

<style>
  .frame {
    display: flex;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
  /* sized from the image ratio so the overlay lines up with the canvas exactly */
  .stage {
    position: relative;
    flex: none;
    width: min(100%, calc(min(64vh, 620px) * var(--r)));
    aspect-ratio: var(--r);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: crosshair;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .shade {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .hole {
    position: absolute;
    box-shadow: 0 0 0 100vmax #0b0a09b3;
  }
  .round {
    border-radius: 50%;
  }
  .box {
    position: absolute;
    padding: 0;
    background: none;
    border: 0;
    outline: 1.5px solid var(--color-sun);
    outline-offset: 0;
    cursor: move;
    color: inherit;
    &:focus-visible {
      outline-width: 2.5px;
    }
    &.round::before {
      /* the circle itself, inside the square handles frame */
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1.5px solid var(--color-sun);
    }
    &.round {
      border-radius: 0;
      outline-style: dashed;
      outline-color: #ffd25e66;
    }
  }
  .thirds {
    position: absolute;
    inset: 0;
    opacity: 0.35;
    background:
      linear-gradient(90deg, transparent calc(33.33% - 0.5px), #f2ede4 calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent 0),
      linear-gradient(90deg, transparent calc(66.66% - 0.5px), #f2ede4 calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent 0),
      linear-gradient(transparent calc(33.33% - 0.5px), #f2ede4 calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent 0),
      linear-gradient(transparent calc(66.66% - 0.5px), #f2ede4 calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent 0);
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .box.active .thirds {
    opacity: 0.7;
  }
  .h {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    background: var(--color-sun);
    border: 2px solid var(--color-bg);
    border-radius: 4px;
    /* a bigger invisible target for fingers */
    &::after {
      content: '';
      position: absolute;
      inset: -12px;
    }
  }
  .n, .s { left: 50%; width: 22px; margin-left: -11px; height: 10px; margin-top: -5px; }
  .e, .w { top: 50%; height: 22px; margin-top: -11px; width: 10px; margin-left: -5px; }
  .nw, .n, .ne { top: 0; }
  .sw, .s, .se { top: 100%; }
  .nw, .w, .sw { left: 0; }
  .ne, .e, .se { left: 100%; }
  .nw, .se { cursor: nwse-resize; }
  .ne, .sw { cursor: nesw-resize; }
  .n, .s { cursor: ns-resize; }
  .e, .w { cursor: ew-resize; }

  .ratios {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    & button {
      display: grid;
      justify-items: center;
      align-content: center;
      gap: 6px;
      min-height: 52px;
      padding: 6px 0;
      font: 400 12px var(--font-mono);
      color: var(--color-muted);
      background: #141312;
      border: 1px solid var(--color-line-2);
      border-radius: 10px;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
      &:hover {
        border-color: var(--color-muted);
      }
      &[aria-pressed='true'] {
        color: var(--color-chalk);
        border-color: var(--color-sun);
        & i {
          border-color: var(--color-sun);
          background: #ffd25e22;
        }
      }
    }
    & i {
      display: block;
      border: 1.5px solid currentColor;
      border-radius: 3px;
      &.free {
        border-style: dashed;
      }
    }
  }
  .num {
    position: relative;
    & span {
      position: absolute;
      left: 12px;
      top: 50%;
      translate: 0 -50%;
      font: 400 12px var(--font-mono);
      color: var(--color-sun);
      pointer-events: none;
    }
    & input {
      padding-left: 30px;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
