<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage, encodeCanvas, processImage, resizeImage, type EncodeOptions } from '@/engines/image/client';
  import { downloadResult, formatBytes, zipFiles } from '@/tools/lib/files';
  import { drawBlurred, free, surface } from '@/tools/lib/social-media-image-resizer/canvas';
  import {
    containRect, defaultSelection, focalCrop, outputName, panFocus, pixelCrop, platforms, sizes, upscaled,
    type Fit, type Focus, type Platform, type SocialSize,
  } from '@/tools/lib/social-media-image-resizer/sizes';

  interface Source {
    name: string;
    /** working copy, capped so a 50 MP photo doesn't eat memory 14 times over */
    full: ImageData;
    preview: ImageBitmap;
  }

  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const FULL_MAX = 4096;
  const PREVIEW_MAX = 1024;
  /** long side of each preview canvas */
  const CARD_PX = 520;
  const fits: [Fit, string][] = [['crop', 'crop'], ['blur', 'blur fill'], ['solid', 'color fill']];
  const platformIds = Object.keys(platforms) as Platform[];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let src = $state.raw<Source | null>(null);
  let loading = $state(false);
  let error = $state('');
  let chosen = $state<string[]>([...defaultSelection]);
  let focus = $state<Focus>({ x: 0.5, y: 0.5 });
  let defaultFit = $state<Fit>('crop');
  /** per-size changes made on a preview card */
  let overrides = $state<Record<string, { fit?: Fit; focus?: Focus }>>({});
  let solid = $state('#ffffff');
  let format = $state<'jpeg' | 'png'>('jpeg');
  let busy = $state<string | null>(null);
  let done = $state(0);
  let total = $state(0);
  let saved = $state<{ name: string; size: number } | null>(null);

  let sourceCanvas = $state<HTMLCanvasElement>();

  const picked = $derived(sizes.filter((s) => chosen.includes(s.id)));
  const fitOf = (s: SocialSize) => overrides[s.id]?.fit ?? defaultFit;
  const focusOf = (s: SocialSize) => overrides[s.id]?.focus ?? focus;

  function release() {
    src?.preview.close();
  }
  onDestroy(release);

  let loadSeq = 0;

  async function load(file: File) {
    const seq = ++loadSeq;
    loading = true;
    error = '';
    saved = null;
    try {
      let full = await decodeImage(file);
      const s = FULL_MAX / Math.max(full.width, full.height);
      if (s < 1) full = await resizeImage(full, { width: Math.round(full.width * s), height: Math.round(full.height * s), method: 'lanczos3' });
      const p = Math.min(1, PREVIEW_MAX / Math.max(full.width, full.height));
      const small = p < 1 ? await resizeImage(full, { width: Math.round(full.width * p), height: Math.round(full.height * p), method: 'triangle' }) : full;
      const preview = await createImageBitmap(small);
      if (seq !== loadSeq) return preview.close();
      release();
      src = { name: file.name, full, preview };
      focus = { x: 0.5, y: 0.5 };
      overrides = {};
    } catch {
      if (seq === loadSeq) error = `Couldn't open ${file.name}. Try a JPG, PNG, WebP, HEIC or GIF.`;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function startOver() {
    loadSeq++;
    release();
    src = null;
    saved = null;
    error = '';
  }

  function toggle(id: string, on: boolean) {
    chosen = on ? [...chosen, id] : chosen.filter((c) => c !== id);
    saved = null;
  }

  function setFit(s: SocialSize, fit: Fit) {
    overrides[s.id] = { ...overrides[s.id], fit };
  }

  function setDefaultFit(fit: Fit) {
    defaultFit = fit;
    // a new default applies everywhere; keep only the hand-placed crops
    for (const o of Object.values(overrides)) delete o.fit;
  }

  // ---- drawing (previews from the small copy, downloads from the full one)

  /** blur strength as a share of the frame's long side */
  const BLUR = 0.035;

  function paintFill(ctx: CanvasRenderingContext2D, fit: Fit, preview: ImageBitmap, W: number, H: number, color: string) {
    if (fit === 'blur') {
      drawBlurred(ctx, preview, focalCrop(preview.width, preview.height, W, H, { x: 0.5, y: 0.5 }), W, H, BLUR * Math.max(W, H));
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
    } else ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  }

  interface PreviewParams {
    size: SocialSize;
    fit: Fit;
    focus: Focus;
    solid: string;
    src: Source;
  }

  function drawPreview(canvas: HTMLCanvasElement, p: PreviewParams) {
    const k = CARD_PX / Math.max(p.size.width, p.size.height);
    const W = Math.round(p.size.width * k);
    const H = Math.round(p.size.height * k);
    if (canvas.width !== W || canvas.height !== H) Object.assign(canvas, { width: W, height: H });
    const ctx = canvas.getContext('2d')!;
    const img = p.src.preview;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, W, H);
    if (p.fit === 'crop') {
      const r = focalCrop(img.width, img.height, W, H, p.focus);
      ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, W, H);
    } else {
      paintFill(ctx, p.fit, img, W, H, p.solid);
      const r = containRect(img.width, img.height, W, H);
      ctx.drawImage(img, r.x, r.y, r.width, r.height);
    }
  }

  /** redraws a card on the next frame whenever anything it shows changes */
  function preview(canvas: HTMLCanvasElement, params: PreviewParams) {
    let frame = 0;
    const run = (p: PreviewParams) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => drawPreview(canvas, p));
    };
    run(params);
    return { update: run, destroy: () => cancelAnimationFrame(frame) };
  }

  /** what a size looks like when its download starts, so later clicks can't change a file mid-way */
  interface Settings {
    fit: Fit;
    focus: Focus;
    format: 'jpeg' | 'png';
    solid: string;
  }
  const settingsFor = (s: SocialSize): Settings => ({ fit: fitOf(s), focus: { ...focusOf(s) }, format, solid });
  const extOf = (o: Settings) => (o.format === 'png' ? 'png' : 'jpg');

  async function render(s: SocialSize, source: Source, o: Settings): Promise<Blob> {
    const { width: W, height: H } = s;
    const { full } = source;
    const encode: EncodeOptions = o.format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 90, background: o.solid };
    if (o.fit === 'crop') {
      const crop = pixelCrop(focalCrop(full.width, full.height, W, H, o.focus), full.width, full.height);
      return (await processImage(full, { crop, resize: { mode: 'stretch', width: W, height: H, method: 'lanczos3' }, encode })).blob;
    }
    const r = containRect(full.width, full.height, W, H);
    const fitted = await createImageBitmap(await resizeImage(full, { width: r.width, height: r.height, method: 'lanczos3' }));
    const [canvas, ctx] = surface(W, H);
    try {
      paintFill(ctx, o.fit, source.preview, W, H, o.solid);
      ctx.drawImage(fitted, r.x, r.y);
      return await encodeCanvas(canvas, encode);
    } finally {
      fitted.close();
      free(canvas);
    }
  }

  async function downloadOne(s: SocialSize) {
    if (!src || busy) return;
    busy = s.id;
    error = '';
    try {
      const o = settingsFor(s);
      const blob = await render(s, src, o);
      downloadResult(blob, outputName(src.name, s, extOf(o)));
    } catch {
      error = `Couldn't create the ${platforms[s.platform].name} ${s.label.toLowerCase()}. Please try again.`;
    } finally {
      busy = null;
    }
  }

  async function downloadAll() {
    if (!src || busy || !picked.length) return;
    const source = src;
    const list = picked.map((s) => ({ s, o: settingsFor(s) }));
    busy = 'all';
    error = '';
    saved = null;
    done = 0;
    total = list.length;
    try {
      const files: { name: string; blob: Blob }[] = new Array(list.length);
      // two at a time: fast, without holding a dozen full-size copies in memory at once
      let next = 0;
      const lane = async () => {
        while (next < list.length) {
          const i = next++;
          const { s, o } = list[i];
          files[i] = { name: outputName(source.name, s, extOf(o)), blob: await render(s, source, o) };
          done++;
        }
      };
      await Promise.all([lane(), lane()]);
      if (files.length === 1) {
        downloadResult(files[0].blob, files[0].name);
        saved = { name: files[0].name, size: files[0].blob.size };
      } else {
        const zip = await zipFiles(files);
        const name = `${source.name.replace(/\.[^.]+$/, '') || 'image'}-social-sizes.zip`;
        downloadResult(zip, name);
        saved = { name, size: zip.size };
      }
    } catch {
      error = 'Something went wrong while creating the images. Please try again.';
    } finally {
      busy = null;
    }
  }

  // ---- focus point: on the source for every size, or dragged on one preview for just that size

  $effect(() => {
    const canvas = sourceCanvas;
    const img = src?.preview;
    if (!canvas || !img) return;
    Object.assign(canvas, { width: img.width, height: img.height });
    canvas.getContext('2d')!.drawImage(img, 0, 0);
  });

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  let aiming = false;

  function aim(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    focus = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    for (const o of Object.values(overrides)) delete o.focus;
  }

  function aimKey(e: KeyboardEvent) {
    const d = arrows[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.02;
    focus = { x: clamp01(focus.x + d[0] * step), y: clamp01(focus.y + d[1] * step) };
    for (const o of Object.values(overrides)) delete o.focus;
  }

  let pan: { id: string; px: number; py: number; focus: Focus } | null = null;

  function panStart(e: PointerEvent, s: SocialSize) {
    if (fitOf(s) !== 'crop' || e.button !== 0) return;
    pan = { id: s.id, px: e.clientX, py: e.clientY, focus: focusOf(s) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function panMove(e: PointerEvent, s: SocialSize) {
    if (!pan || pan.id !== s.id || !src) return;
    const canvas = (e.currentTarget as HTMLElement).querySelector('canvas')!;
    const k = s.width / canvas.getBoundingClientRect().width;
    const f = panFocus(src.full.width, src.full.height, s.width, s.height, pan.focus, (e.clientX - pan.px) * k, (e.clientY - pan.py) * k);
    overrides[s.id] = { ...overrides[s.id], focus: f };
  }

  function panKey(e: KeyboardEvent, s: SocialSize) {
    const d = arrows[e.key];
    if (!d || !src || fitOf(s) !== 'crop') return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.1 : 0.02) * Math.max(s.width, s.height);
    // arrows move the frame, which is the opposite of dragging the picture
    const f = panFocus(src.full.width, src.full.height, s.width, s.height, focusOf(s), -d[0] * step, -d[1] * step);
    overrides[s.id] = { ...overrides[s.id], focus: f };
  }

  /** a crop only moves along one axis, so phones can still scroll the page along the other */
  function touchFor(s: SocialSize, fit: Fit, source: Source) {
    if (fit !== 'crop') return 'auto';
    const d = source.full.width / source.full.height - s.width / s.height;
    return Math.abs(d) < 0.01 ? 'auto' : d > 0 ? 'pan-y' : 'pan-x';
  }

  const pct = (n: number) => `${n * 100}%`;
</script>

{#if !src}
  <div class="grid gap-4">
    <Dropzone accept={ACCEPT} title="Drop one image" hint="JPG, PNG, WebP, HEIC or GIF, or click to choose" onfiles={(f) => load(f[0])} />
    {#if loading}<p class="mono" aria-live="polite">opening your image…</p>{/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
    <p class="mono">{sizes.length} sizes for {platformIds.map((p) => platforms[p].name).join(', ')}</p>
  </div>
{:else}
  <div class="grid gap-8 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
    <aside class="grid content-start gap-6">
      <section class="grid gap-2">
        <span class="label mb-0!">focus point · click what must stay in frame</span>
        <button
          type="button"
          class="aim"
          aria-label={`Focus point at ${Math.round(focus.x * 100)}% across, ${Math.round(focus.y * 100)}% down. Click the image or use the arrow keys to move it.`}
          onpointerdown={(e) => {
            if (e.button !== 0) return;
            aiming = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            aim(e);
          }}
          onpointermove={(e) => aiming && aim(e)}
          onpointerup={() => (aiming = false)}
          onpointercancel={() => (aiming = false)}
          onkeydown={aimKey}
        >
          <canvas bind:this={sourceCanvas} aria-hidden="true"></canvas>
          <span class="dot" style:left={pct(focus.x)} style:top={pct(focus.y)} aria-hidden="true"></span>
        </button>
        <p class="mono truncate">{src.name} · {src.full.width} × {src.full.height}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn py-2! text-sm!" disabled={loading || !!busy} onclick={() => document.getElementById('social-replace')?.click()}>{loading ? 'Opening…' : 'Change image'}</button>
          <button type="button" class="btn py-2! text-sm!" disabled={!!busy} onclick={startOver}>Start over</button>
        </div>
        <input id="social-replace" type="file" accept={ACCEPT} hidden onchange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) load(f);
          e.currentTarget.value = '';
        }} />
      </section>

      <section class="grid gap-4 border-t border-line pt-5">
        <div>
          <span class="label">when the shape differs</span>
          <div class="seg" role="group" aria-label="Fit for every size">
            {#each fits as [id, name]}
              <button type="button" aria-pressed={defaultFit === id} onclick={() => setDefaultFit(id)}>{name}</button>
            {/each}
          </div>
          <p class="mono mt-2">{defaultFit === 'crop' ? 'fills the frame, trimming the edges' : defaultFit === 'blur' ? 'whole image on a blurred copy of itself' : 'whole image on a solid color'}</p>
        </div>
        <label class="flex items-center gap-2">
          <input type="color" bind:value={solid} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" />
          <span class="mono">fill color{format === 'png' ? '' : ' · also behind transparency'}</span>
        </label>
        <div>
          <span class="label">format</span>
          <div class="seg" role="group" aria-label="File format">
            <button type="button" aria-pressed={format === 'jpeg'} onclick={() => (format = 'jpeg')}>JPG</button>
            <button type="button" aria-pressed={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
          </div>
        </div>
      </section>

      <section class="grid gap-3 border-t border-line pt-5">
        <div class="flex items-center justify-between">
          <span class="label mb-0!">sizes · {picked.length} of {sizes.length}</span>
          <span class="flex gap-3 text-sm">
            <button type="button" class="link" onclick={() => (chosen = sizes.map((s) => s.id))}>all</button>
            <button type="button" class="link" onclick={() => (chosen = [])}>none</button>
          </span>
        </div>
        {#each platformIds as p}
          <fieldset class="grid gap-1">
            <legend class="plat"><span class="pdot" style:background={platforms[p].color}></span>{platforms[p].name}</legend>
            {#each sizes.filter((s) => s.platform === p) as s (s.id)}
              <label class="check">
                <input type="checkbox" class="accent-(--color-sun)" checked={chosen.includes(s.id)} onchange={(e) => toggle(s.id, e.currentTarget.checked)} />
                <span class="grow">{s.label}</span>
                <span class="mono">{s.width}×{s.height}</span>
              </label>
            {/each}
          </fieldset>
        {/each}
      </section>
    </aside>

    <div class="grid content-start gap-5">
      <div class="bar">
        <button type="button" class="btn btn-primary grow" disabled={!!busy || !picked.length} onclick={downloadAll}>
          {busy === 'all' ? `Creating ${done} of ${total}…` : picked.length > 1 ? `Download ${picked.length} images (zip)` : picked.length ? 'Download image' : 'Pick at least one size'}
        </button>
        {#if busy === 'all'}
          <div class="progress" role="progressbar" aria-label="Creating images" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <span style:width={pct(total ? done / total : 0)}></span>
          </div>
        {/if}
        {#if saved}<p class="saved mono text-ok" aria-live="polite">✓ {saved.name} · {formatBytes(saved.size)}</p>{/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      </div>

      {#if picked.length}
        <div class="cards">
          {#each picked as s (s.id)}
            {@const fit = fitOf(s)}
            <article class="card-s">
              <button
                type="button"
                class="pv"
                class:draggable={fit === 'crop'}
                style:touch-action={touchFor(s, fit, src)}
                aria-label={fit === 'crop' ? `${platforms[s.platform].name} ${s.label} preview. Drag or use the arrow keys to move the crop.` : `${platforms[s.platform].name} ${s.label} preview`}
                onpointerdown={(e) => panStart(e, s)}
                onpointermove={(e) => panMove(e, s)}
                onpointerup={() => (pan = null)}
                onpointercancel={() => (pan = null)}
                onkeydown={(e) => panKey(e, s)}
              >
                <span class="pv-box"><span class="pv-in" style:--r={s.width / s.height}>
                  <canvas use:preview={{ size: s, fit, focus: focusOf(s), solid, src }} aria-hidden="true"></canvas>
                  {#if s.safe}
                    <span class="safe" aria-hidden="true" style:width={pct(s.safe.width / s.width)} style:height={pct(s.safe.height / s.height)}></span>
                  {/if}
                </span></span>
              </button>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="name"><span class="pdot" style:background={platforms[s.platform].color}></span>{platforms[s.platform].name} · {s.label}</p>
                  <p class="mono">{s.width} × {s.height}</p>
                </div>
                <button type="button" class="btn icon" aria-label={`Download ${platforms[s.platform].name} ${s.label}`} title="Download this size" disabled={!!busy} onclick={() => downloadOne(s)}>{busy === s.id ? '…' : '↓'}</button>
              </div>
              <div class="seg mini" role="group" aria-label={`Fit for ${platforms[s.platform].name} ${s.label}`}>
                {#each fits as [id, name]}
                  <button type="button" aria-pressed={fit === id} onclick={() => setFit(s, id)}>{name}</button>
                {/each}
              </div>
              {#if upscaled(src.full.width, src.full.height, s, fit)}
                <p class="mono warn">your image is smaller than this, so it will be enlarged</p>
              {/if}
              {#if s.note}<p class="mono note">{s.note}</p>{/if}
            </article>
          {/each}
        </div>
      {:else}
        <p class="empty">Tick a size on the left to see it here.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .aim {
    position: relative;
    display: block;
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
    padding: 0;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    overflow: hidden;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    cursor: crosshair;
    touch-action: none;
    & canvas {
      display: block;
      max-width: 100%;
      max-height: 340px;
    }
  }
  .dot {
    position: absolute;
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    border-radius: 50%;
    border: 2px solid var(--color-sun);
    box-shadow: 0 0 0 2px #0009, inset 0 0 0 2px #0009;
    pointer-events: none;
    transition: left 0.08s, top 0.08s;
    &::after {
      content: '';
      position: absolute;
      inset: 6px;
      border-radius: 50%;
      background: var(--color-sun);
    }
  }
  .link {
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    &:hover {
      color: var(--color-chalk);
    }
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .plat {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
    margin-bottom: 2px;
  }
  .pdot {
    display: inline-block;
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
  }
  .plat .pdot {
    margin-right: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    &:hover {
      background: var(--color-panel-2);
    }
  }
  .bar {
    display: grid;
    gap: 10px;
  }
  .progress {
    height: 4px;
    border-radius: 4px;
    background: var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.25s;
    }
  }
  .saved {
    animation: rise 0.45s var(--ease-spring);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .card-s {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 16px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel);
    animation: card-in 0.35s var(--ease-spring) both;
  }
  @keyframes card-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }
  .pv {
    display: block;
    width: 100%;
    height: 210px;
    padding: 10px;
    border: 0;
    border-radius: 10px;
    background: var(--color-panel-2);
    cursor: default;
    &.draggable {
      cursor: grab;
      &:active {
        cursor: grabbing;
      }
    }
  }
  /* sizes each preview to fit the box whatever its shape, from a 3:1 banner to a 9:16 story */
  .pv-box {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    container-type: size;
  }
  .pv-in {
    position: relative;
    display: block;
    width: min(100cqw, 100cqh * var(--r));
    aspect-ratio: var(--r);
    box-shadow: 0 6px 20px #0006;
    border-radius: 3px;
    overflow: hidden;
    & canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .safe {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    border: 1.5px dashed #ffffffcc;
    box-shadow: 0 0 0 999px #0000004d;
    pointer-events: none;
  }
  .name {
    display: flex;
    align-items: center;
    font-size: 14px;
    line-height: 1.3;
  }
  .icon {
    padding: 8px 12px;
    font-size: 14px;
  }
  .mini button {
    padding: 6px 9px;
    font-size: 12px;
  }
  .warn {
    color: var(--color-sun);
    font-size: 12px;
  }
  .note {
    font-size: 12px;
  }
  .empty {
    padding: 48px 16px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 16px;
    font: 400 24px/1.2 var(--font-serif);
    color: var(--color-soft);
  }
</style>
