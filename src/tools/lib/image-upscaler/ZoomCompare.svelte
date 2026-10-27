<!--
  Before/after viewer for upscaled images: a split you drag, plus real zoom (fit, 100%, 200% of the
  result's pixels) with panning, so the detail the model added can be checked up close. "Before" is
  drawn with the browser's own smooth enlargement, which is what an ordinary resize gives you.
  Without `after` it shows the original alone; `live` paints the result over it as tiles arrive.
-->
<script lang="ts">
  interface Props {
    before: CanvasImageSource;
    after?: CanvasImageSource | null;
    /** size of the result in pixels */
    width: number;
    height: number;
    /** bump to repaint after `after` changed */
    version?: number;
    live?: boolean;
    afterLabel?: string;
  }

  let { before, after = null, width, height, version = 0, live = false, afterLabel = 'upscaled' }: Props = $props();

  const ZOOMS = [
    ['fit', 'fit'],
    [1, '100%'],
    [2, '200%'],
  ] as const;

  let zoom = $state<'fit' | 1 | 2>('fit');
  /** the view's centre, as a fraction of the image */
  let fx = $state(0.5);
  let fy = $state(0.5);
  /** where the split sits, as a fraction of the view's width */
  let split = $state(0.5);
  let viewW = $state(0);
  let viewH = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();

  const compare = $derived(!!after && !live);
  const fitScale = $derived(viewW / width || 1);
  /** CSS pixels per result pixel */
  const s = $derived(zoom === 'fit' ? fitScale : zoom);
  const zoomed = $derived(s > fitScale + 1e-6);

  /** top-left of the view in result pixels: clamped inside the image, centred when the image is smaller */
  function origin(f: number, size: number, view: number) {
    const span = view / s;
    return span >= size ? (size - span) / 2 : Math.min(size - span, Math.max(0, f * size - span / 2));
  }

  $effect(() => {
    // everything the picture depends on, read up front so the effect re-runs on any of them
    const deps = { before, after, width, height, version, compare, s, fx, fy, split, viewW, viewH };
    if (!canvas || !deps.viewW) return;
    const frame = requestAnimationFrame(() => draw(deps.compare));
    return () => cancelAnimationFrame(frame);
  });

  function draw(sideBySide: boolean) {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(viewW * dpr);
    const ph = Math.round(viewH * dpr);
    if (canvas!.width !== pw || canvas!.height !== ph) Object.assign(canvas!, { width: pw, height: ph });
    const ctx = canvas!.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const left = origin(fx, width, viewW);
    const top = origin(fy, height, viewH);
    const k = dpr * s;
    ctx.setTransform(k, 0, 0, k, -left * k, -top * k);
    const cut = left + (split * viewW) / s;
    const span = { w: viewW / s, h: viewH / s };
    const layer = (img: CanvasImageSource, x0: number, x1: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, top, x1 - x0, span.h);
      ctx.clip();
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
    };
    // past 1:1 the result's own pixels are shown as they are, not smoothed a second time
    const smoothAfter = zoom === 'fit' || k < 1;
    if (sideBySide) {
      layer(before, left, cut);
      ctx.imageSmoothingEnabled = smoothAfter;
      layer(after!, cut, left + span.w);
    } else {
      ctx.drawImage(before, 0, 0, width, height);
      ctx.imageSmoothingEnabled = smoothAfter;
      if (after) ctx.drawImage(after, 0, 0, width, height);
    }
  }

  // ── panning, the split and zoom ──

  let drag = $state<{ kind: 'pan' | 'split'; x: number; y: number; fx: number; fy: number } | null>(null);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const onSplit = !!(e.target as Element).closest('[data-split]');
    if (!onSplit && !zoomed) return;
    e.preventDefault();
    drag = { kind: onSplit ? 'split' : 'pan', x: e.clientX, y: e.clientY, fx, fy };
    stage!.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === 'split') {
      const rect = stage!.getBoundingClientRect();
      split = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    } else {
      fx = Math.min(1, Math.max(0, drag.fx - (e.clientX - drag.x) / s / width));
      fy = Math.min(1, Math.max(0, drag.fy - (e.clientY - drag.y) / s / height));
    }
  }

  function up() {
    drag = null;
  }

  /** double-click: zoom to 100% on that spot, or back out */
  function dblclick(e: MouseEvent) {
    if ((e.target as Element).closest('[data-split]')) return;
    if (zoomed) {
      zoom = 'fit';
      return;
    }
    const rect = stage!.getBoundingClientRect();
    fx = (origin(fx, width, viewW) + (e.clientX - rect.left) / s) / width;
    fy = (origin(fy, height, viewH) + (e.clientY - rect.top) / s) / height;
    zoom = 1;
  }

  function onKey(e: KeyboardEvent) {
    const step = (e.shiftKey ? 0.5 : 0.1) * (viewW / s / width);
    const stepY = (e.shiftKey ? 0.5 : 0.1) * (viewH / s / height);
    const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -stepY], ArrowDown: [0, stepY] };
    if (pan[e.key] && zoomed) {
      fx = Math.min(1, Math.max(0, fx + pan[e.key][0]));
      fy = Math.min(1, Math.max(0, fy + pan[e.key][1]));
    } else if (e.key === '+' || e.key === '=') zoom = zoom === 'fit' ? 1 : 2;
    else if (e.key === '-') zoom = zoom === 2 ? 1 : 'fit';
    else return;
    e.preventDefault();
  }

  function onSplitKey(e: KeyboardEvent) {
    const d = { ArrowLeft: -0.05, ArrowRight: 0.05, Home: -1, End: 1 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    split = Math.min(1, Math.max(0, split + d));
  }
</script>

<div class="grid gap-2">
  <!-- an application region: it owns pointer and arrow-key input for zoom, pan and the split -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={stage}
    bind:clientWidth={viewW}
    bind:clientHeight={viewH}
    class="stage"
    class:zoomed
    class:panning={drag?.kind === 'pan'}
    style={`aspect-ratio: ${width} / ${height}; max-width: min(100%, ${((width / height) * 70).toFixed(2)}vh)`}
    role="application"
    aria-label={`${compare ? 'Before and after comparison' : 'Preview'}. Plus and minus zoom; arrow keys pan when zoomed.`}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    ondblclick={dblclick}
    onkeydown={onKey}
  >
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#if compare}
      <span class="tag mono left-3">original</span>
      <span class="tag mono right-3">{afterLabel}</span>
      <div class="split" data-split style={`left: ${split * 100}%`}>
        <button
          type="button"
          class="knob"
          role="slider"
          aria-label="Before and after divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          aria-valuetext={`${Math.round(split * 100)}% original`}
          onkeydown={onSplitKey}>⟷</button
        >
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="seg" role="group" aria-label="Zoom">
      {#each ZOOMS as [z, label]}
        <button type="button" aria-pressed={zoom === z} onclick={() => (zoom = z)}>{label}</button>
      {/each}
    </div>
    <p class="mono">{zoomed ? 'drag to look around · double-click to zoom out' : 'double-click a spot to zoom in'}</p>
  </div>
</div>

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
    user-select: none;
    touch-action: pan-y;
    &.zoomed {
      cursor: grab;
      touch-action: none;
    }
    &.panning {
      cursor: grabbing;
    }
    &:focus-visible {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .tag {
    position: absolute;
    top: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #131211cc;
    color: var(--color-chalk);
    pointer-events: none;
  }
  .split {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    translate: -50% 0;
    cursor: ew-resize;
    touch-action: none;
    &::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 50%;
      width: 2px;
      translate: -1px 0;
      background: var(--color-sun);
    }
  }
  .knob {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 99px;
    background: var(--color-sun);
    color: var(--color-bg);
    font-size: 15px;
    cursor: ew-resize;
    &:focus-visible {
      outline: 2px solid var(--color-chalk);
      outline-offset: 2px;
    }
  }
</style>
