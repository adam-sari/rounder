<script lang="ts">
  import ImageBatch from '@/components/tool/ImageBatch.svelte';
  import { decodeImage, encodeCanvas, formatInfo, imageKind, outputFormatFor, processImage, type EncodeOptions, type OutputFormat } from '@/engines/image/client';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import { boundingSize, flipOnScreen, innerCropSize, outputSuffix, quarter, turnedSize, type Orientation } from '@/tools/lib/rotate-image/geometry';

  type Edges = 'crop' | 'fill' | 'transparent';

  // whole quarter turns, kept cumulative so the preview always spins the short way
  let turns = $state(0);
  let flipX = $state(false);
  let flipY = $state(false);
  let fine = $state(0);
  let edges = $state<Edges>('crop');
  let fill = $state('#ffffff');
  let target = $state<'same' | OutputFormat>('same');

  const QUALITY = 92;

  const orientation = $derived<Orientation>({ rotate: quarter(turns * 90), flipX, flipY });
  const tilt = $derived(Math.round(Math.max(-45, Math.min(45, Number(fine) || 0)) * 10) / 10);
  const settingsKey = $derived(JSON.stringify([orientation, tilt, edges, fill, target]));

  function flip(axis: 'horizontal' | 'vertical') {
    const next = flipOnScreen(orientation, axis);
    flipX = next.flipX;
    flipY = next.flipY;
    // a mirrored picture leans the other way, so a level photo stays level
    fine = -tilt || 0;
  }

  function reset() {
    turns = 0;
    flipX = flipY = false;
    fine = 0;
  }

  const summary = $derived.by(() => {
    // flipping both ways is the same picture as a half turn
    const deg = (orientation.rotate + (flipX && flipY ? 180 : 0)) % 360;
    const parts = [deg ? `${deg}° clockwise` : 'upright'];
    if (flipX !== flipY) parts.push('mirrored');
    if (tilt) parts.push(`${tilt > 0 ? '+' : ''}${tilt}° tilt`);
    return parts.join(' · ');
  });

  // canvas renders hold a few full-size copies of the photo, so run them one at a time
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }

  // desktop browsers allow 16384px sides / 268MP; iOS Safari only 16.7MP, and fails by
  // returning no context or a canvas that silently doesn't draw, so check before using one
  function makeCanvas(w: number, h: number) {
    for (const area of [268_435_456, 16_777_216]) {
      const scale = Math.min(1, Math.sqrt(area / (w * h)), 16384 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
        if (ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data[3]) {
          ctx.clearRect(canvas.width - 1, canvas.height - 1, 1, 1);
          return { canvas, ctx, scale };
        }
      }
      canvas.width = canvas.height = 0;
    }
    throw new Error('This image is too big for your browser to straighten.');
  }

  async function straighten(file: File, o: Orientation, deg: number, mode: Edges, color: string, encode: EncodeOptions) {
    const img = await decodeImage(file);
    const turned = turnedSize(img.width, img.height, o.rotate);
    const size = mode === 'crop' ? innerCropSize(turned.width, turned.height, deg) : boundingSize(turned.width, turned.height, deg);
    const { canvas, ctx, scale } = makeCanvas(size.width, size.height);
    const bitmap = await createImageBitmap(img);
    try {
      ctx.imageSmoothingQuality = 'high';
      if (mode === 'fill') {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.rotate(((o.rotate + deg) * Math.PI) / 180);
      ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
      ctx.drawImage(bitmap, -img.width / 2, -img.height / 2);
      const blob = await encodeCanvas(canvas, encode);
      return { blob, width: canvas.width, height: canvas.height, note: scale < 1 ? 'scaled to fit browser limit' : undefined };
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }

  async function process(file: File) {
    // read the settings before any await so a mid-run change can't mix them
    const o = orientation;
    const deg = tilt;
    const mode = edges;
    const color = fill;
    const wanted = target;
    const key = settingsKey;

    const kind = await imageKind(file);
    let format = wanted === 'same' ? outputFormatFor(kind) : wanted;
    let note: string | undefined;
    if (deg && mode === 'transparent' && !formatInfo[format].alpha) {
      format = 'png';
      note = 'PNG keeps the transparent corners';
    }
    const encode: EncodeOptions = { format, quality: QUALITY, background: format === 'jpeg' ? '#ffffff' : undefined };
    const name = withSuffix(withExtension(file.name, formatInfo[format].ext), outputSuffix(o, deg));

    if (!deg) {
      const out = await processImage(file, { rotate: o.rotate, flipX: o.flipX, flipY: o.flipY, encode });
      return { blob: out.blob, name, width: out.width, height: out.height, note };
    }
    // renders queue one at a time; skip one whose settings changed while it waited
    const out = await serial(() => (key === settingsKey ? straighten(file, o, deg, mode, color, encode) : Promise.resolve(null)));
    if (!out) {
      // ImageBatch restarts the batch ~300ms after the last change, which makes it ignore this error
      await settled();
      throw new Error('Settings changed, please try again.');
    }
    return { ...out, name, note: out.note ?? note };
  }

  async function settled() {
    for (let key = ''; key !== settingsKey; ) {
      key = settingsKey;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  // ---- live preview: the selected image, transformed with CSS ----
  const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#2b2a27"/><circle cx="110" cy="92" r="40" fill="#FFD25E"/><path d="M0 320 L150 150 L240 250 L330 120 L480 300 L480 320Z" fill="#5d5a53"/><path d="M0 320 L150 150 L190 196 L120 320Z" fill="#7a766d"/><path d="M0 286 H480" stroke="#FFD25E" stroke-opacity=".5" stroke-width="2" stroke-dasharray="8 8"/></svg>`;
  const placeholder = { url: `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`, w: 480, h: 320, real: false };

  const PREVIEW = 720;

  let selectedFile = $state.raw<File | null>(null);
  let sample = $state.raw(placeholder);
  // the object URL behind sample; a plain variable so the preview effect doesn't depend on it
  let sampleUrl = '';

  function show(next: typeof placeholder) {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    sampleUrl = next.real ? next.url : '';
    sample = next;
  }

  /** An object URL the <img> can show; files it can't (HEIC outside Safari) are decoded to a small PNG */
  async function previewOf(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
      return { url, w: img.naturalWidth, h: img.naturalHeight, real: true };
    } catch {
      URL.revokeObjectURL(url);
    }
    const data = await decodeImage(file);
    const k = Math.min(1, PREVIEW / Math.max(data.width, data.height));
    const w = Math.max(1, Math.round(data.width * k));
    const h = Math.max(1, Math.round(data.height * k));
    const bitmap = await createImageBitmap(data, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    try {
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
      if (!blob) throw new Error('No preview');
      return { url: URL.createObjectURL(blob), w, h, real: true };
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }

  // follows the file selected in the list; back to the sample picture when the list empties
  $effect(() => {
    const file = selectedFile;
    if (!file) return show(placeholder);
    let cancelled = false;
    previewOf(file)
      .then((next) => (cancelled ? URL.revokeObjectURL(next.url) : show(next)))
      // the file's row in the list shows the error, so don't leave the last photo on screen
      .catch(() => !cancelled && show(placeholder));
    return () => {
      cancelled = true;
    };
  });

  $effect(() => () => {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
  });

  let boxW = $state(268);
  const preview = $derived.by(() => {
    const boxH = boxW * 0.75;
    const turned = turnedSize(sample.w, sample.h, orientation.rotate);
    const out = tilt && edges !== 'crop' ? boundingSize(turned.width, turned.height, tilt) : innerCropSize(turned.width, turned.height, tilt, 0);
    const k = Math.min((boxW - 24) / out.width, (boxH - 24) / out.height);
    return {
      frame: `width:${out.width * k}px;height:${out.height * k}px;${tilt && edges === 'fill' ? `background:${fill};` : ''}`,
      img: `width:${sample.w * k}px;height:${sample.h * k}px;transform:translate(-50%,-50%) rotate(${turns * 90 + tilt}deg) scale(${flipX ? -1 : 1},${flipY ? -1 : 1})`,
    };
  });

  const formats: ['same' | OutputFormat, string][] = [['same', 'same'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']];
  const edgeModes: [Edges, string][] = [['crop', 'crop'], ['fill', 'fill'], ['transparent', 'transparent']];
</script>

<ImageBatch {process} {settingsKey} zipName="rotated-images.zip" onselect={(file) => (selectedFile = file)}>
  <div class="grid gap-2">
    <div class="box" bind:clientWidth={boxW}>
      <div class="frame" class:checker={!!tilt && edges === 'transparent'} style={preview.frame}>
        <img src={sample.url} alt={sample.real ? 'Preview of your image with the current rotation' : 'Sample picture showing the current rotation'} style={preview.img} draggable="false" />
        {#if tilt}<div class="grid-lines" aria-hidden="true"></div>{/if}
      </div>
    </div>
    <p class="mono flex items-center justify-between gap-2">
      <span aria-live="polite">{summary}</span>
      <button type="button" class="reset" onclick={reset} disabled={!turns && !flipX && !flipY && !tilt}>reset</button>
    </p>
  </div>

  <div>
    <span class="label">rotate & flip</span>
    <div class="grid grid-cols-5 gap-2">
      <button type="button" class="btn icon" onclick={() => turns--} aria-label="Rotate left 90°" title="Rotate left 90°">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
      </button>
      <button type="button" class="btn icon" onclick={() => turns++} aria-label="Rotate right 90°" title="Rotate right 90°">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
      </button>
      <button type="button" class="btn icon mono text-chalk!" onclick={() => (turns += 2)} aria-label="Rotate 180°" title="Rotate 180°">180°</button>
      <button type="button" class="btn icon" onclick={() => flip('horizontal')} aria-label="Flip horizontally" title="Flip horizontally">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 5 5-5 5V7" /><path d="m21 7-5 5 5 5V7" /><path d="M12 2v2M12 8v2M12 14v2M12 20v2" /></svg>
      </button>
      <button type="button" class="btn icon" onclick={() => flip('vertical')} aria-label="Flip vertically" title="Flip vertically">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 3-5 5-5-5h10" /><path d="m17 21-5-5-5 5h10" /><path d="M2 12h2M8 12h2M14 12h2M20 12h2" /></svg>
      </button>
    </div>
  </div>

  <div>
    <div class="flex items-center justify-between gap-2">
      <label class="label mb-0!" for="straighten">straighten</label>
      <span class="mono flex items-center gap-1">
        <input type="number" class="field num" min="-45" max="45" step="0.1" bind:value={fine} onchange={() => (fine = tilt)} aria-label="Straighten angle in degrees" />°
      </span>
    </div>
    <input id="straighten" type="range" min="-45" max="45" step="0.1" bind:value={fine} class="mt-2 w-full accent-(--color-sun)" />
    <span class="mono flex justify-between"><span>−45°</span><span>0</span><span>45°</span></span>
  </div>

  {#if tilt}
    <div>
      <span class="label">tilted corners</span>
      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label="Tilted corners">
          {#each edgeModes as [value, label]}
            <button type="button" aria-pressed={edges === value} onclick={() => (edges = value)}>{label}</button>
          {/each}
        </div>
        {#if edges === 'fill'}
          <input type="color" class="swatch" bind:value={fill} aria-label="Corner fill color" />
        {/if}
      </div>
      <span class="mono mt-1 block">
        {edges === 'crop' ? 'trims to the largest clean rectangle' : edges === 'fill' ? 'keeps every pixel, paints the corners' : 'keeps every pixel, saves as PNG if needed'}
      </span>
    </div>
  {/if}

  <div>
    <span class="label">output format</span>
    <div class="seg" role="group" aria-label="Output format">
      {#each formats as [value, label]}
        <button type="button" aria-pressed={target === value} onclick={() => (target = value)}>{label}</button>
      {/each}
    </div>
  </div>
</ImageBatch>

<style>
  .box {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
    overflow: hidden;
  }
  .frame {
    position: relative;
    overflow: hidden;
    border-radius: 2px;
    outline: 1px solid var(--color-sun);
    transition: width 0.25s ease, height 0.25s ease;
    &.checker {
      background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 12px 12px;
    }
    & img {
      position: absolute;
      left: 50%;
      top: 50%;
      max-width: none;
      transition: transform 0.25s ease;
      user-select: none;
    }
  }
  .grid-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgb(255 255 255 / 0.28) 1px, transparent 1px),
      linear-gradient(to bottom, rgb(255 255 255 / 0.28) 1px, transparent 1px);
    background-size: calc(100% / 6) calc(100% / 6);
  }
  .icon {
    padding: 0;
    height: 44px;
    font-size: 12.5px;
    & svg {
      width: 19px;
      height: 19px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
  .num {
    width: 72px;
    padding: 4px 8px;
    font: 400 13px var(--font-mono);
    text-align: right;
  }
  .swatch {
    width: 36px;
    height: 34px;
    padding: 2px;
    border: 1px solid var(--color-line-2);
    border-radius: 8px;
    background: #141312;
    cursor: pointer;
  }
  .reset {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--color-sun);
    cursor: pointer;
    &:disabled {
      color: var(--color-muted);
      opacity: 0.5;
      cursor: default;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .frame,
    .frame img {
      transition: none;
    }
  }
</style>
