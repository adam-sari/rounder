<script module lang="ts">
  export interface MadeSignature {
    /** transparent PNG, trimmed to the ink */
    blob: Blob;
    width: number;
    height: number;
    remember: boolean;
    /** what was typed, if anything: reused for the Name tool */
    name: string;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { decodeImage } from '@/engines/image/client';
  import { INK, SIGN_BLUE } from './model';
  import type { SigRole } from './saved';
  import { alphaBounds, initialsOf, removeLight, strokeWidths, type PenPoint } from './signature';
  import { loadSigFont, sigFamily, sigFonts, type SigFont } from './sigfonts';

  interface Props {
    role: SigRole;
    /** the signer's name, if known */
    name?: string;
    oncreate: (s: MadeSignature) => void;
    oncancel: () => void;
  }

  let { role, name = '', oncreate, oncancel }: Props = $props();

  type Tab = 'draw' | 'type' | 'upload';
  const inks = [
    [INK, 'Black'],
    [SIGN_BLUE, 'Blue'],
  ] as const;
  const pens = [
    ['Fine', 1.7],
    ['Medium', 2.6],
    ['Bold', 3.8],
  ] as const;
  // the drawing is exported at this multiple of its on-screen size, so it stays crisp in print
  const EXPORT_SCALE = 4;

  const id = $props.id();
  const noun = $derived(role === 'initials' ? 'initials' : 'signature');

  let dialog = $state<HTMLDialogElement>();
  let tab = $state<Tab>('draw');
  let color = $state<string>(INK);
  let remember = $state(false);
  let error = $state('');
  let busy = $state(false);
  let finished = false;

  // draw
  let pad = $state<HTMLCanvasElement>();
  let strokes = $state.raw<PenPoint[][]>([]);
  let live: PenPoint[] | null = null;
  let pen = $state(2.6);
  let frame = 0;

  // type
  // svelte-ignore state_referenced_locally
  let typed = $state(role === 'initials' ? initialsOf(name) : name);
  let font = $state<SigFont>(sigFonts[0]);
  let fontsReady = $state(false);

  // upload
  let picture = $state.raw<ImageData | null>(null);
  let clean = $state(true);
  let threshold = $state(210);
  let preview = $state<HTMLCanvasElement>();

  onMount(() => {
    dialog?.showModal();
    return () => cancelAnimationFrame(frame);
  });

  const empty = $derived(tab === 'draw' ? !strokes.length : tab === 'type' ? !typed.trim() || !fontsReady : !picture);

  /* ---------- drawing ---------- */

  function paint(ctx: CanvasRenderingContext2D, list: PenPoint[][], base: number) {
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of list) {
      const w = strokeWidths(s, base);
      if (s.length === 1) {
        ctx.beginPath();
        ctx.arc(s[0].x, s[0].y, w[0] / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // each segment runs midpoint to midpoint with its own width: smooth curves, varying ink
      let [x, y] = [s[0].x, s[0].y];
      for (let i = 1; i < s.length; i++) {
        const a = s[i];
        const b = s[i + 1];
        const [mx, my] = b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [a.x, a.y];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(a.x, a.y, mx, my);
        ctx.lineWidth = w[i];
        ctx.stroke();
        [x, y] = [mx, my];
      }
    }
  }

  function redraw() {
    frame = 0;
    if (!pad) return;
    const dpr = devicePixelRatio || 1;
    const [w, h] = [Math.round(pad.clientWidth * dpr), Math.round(pad.clientHeight * dpr)];
    if (pad.width !== w || pad.height !== h) Object.assign(pad, { width: w, height: h });
    const ctx = pad.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pad.clientWidth, pad.clientHeight);
    paint(ctx, live ? [...strokes, live] : strokes, pen);
  }

  const schedule = () => (frame ||= requestAnimationFrame(redraw));

  $effect(() => {
    // repaint when the colour, pen or strokes change, and when the pad is resized
    void [color, pen, strokes];
    if (!pad) return;
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(pad);
    return () => ro.disconnect();
  });

  function penPoint(e: PointerEvent): PenPoint {
    const b = pad!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top, t: e.timeStamp, p: e.pointerType === 'pen' ? e.pressure : -1 };
  }

  function padDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    pad!.setPointerCapture(e.pointerId);
    live = [penPoint(e)];
    schedule();
  }

  function padMove(e: PointerEvent) {
    if (!live) return;
    const evs = e.getCoalescedEvents?.();
    for (const ev of evs?.length ? evs : [e]) {
      const p = penPoint(ev);
      const last = live[live.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) live.push(p);
    }
    schedule();
  }

  function padUp() {
    if (!live) return;
    strokes = [...strokes, live];
    live = null;
  }

  /* ---------- typing ---------- */

  $effect(() => {
    if (tab !== 'type' || fontsReady) return;
    Promise.all(sigFonts.map(loadSigFont)).then(
      () => (fontsReady = true),
      () => (error = "The handwriting fonts couldn't be loaded. Check your connection, or draw your signature instead."),
    );
  });

  /* ---------- upload ---------- */

  async function take(files: File[]) {
    error = '';
    busy = true;
    try {
      const px = await decodeImage(files[0]);
      // a signature never needs more than this; it keeps the background removal instant
      const k = Math.min(1, 1400 / Math.max(px.width, px.height));
      const [w, h] = [Math.max(1, Math.round(px.width * k)), Math.max(1, Math.round(px.height * k))];
      const full = Object.assign(document.createElement('canvas'), { width: px.width, height: px.height });
      full.getContext('2d')!.putImageData(px, 0, 0);
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, 0, 0, w, h);
      full.width = 0;
      picture = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      error = (e as Error)?.message || "This image couldn't be opened. Try a PNG or JPG.";
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (!preview || !picture) return;
    const [src, on, level, canvas] = [picture, clean, threshold, preview];
    const raf = requestAnimationFrame(() => {
      const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      if (on) removeLight(copy.data, level);
      Object.assign(canvas, { width: src.width, height: src.height });
      canvas.getContext('2d')!.putImageData(copy, 0, 0);
    });
    return () => cancelAnimationFrame(raf);
  });

  /* ---------- result ---------- */

  /** trims a canvas to its ink and encodes it as a transparent PNG */
  async function trimmed(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const b = alphaBounds(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (!b) throw new Error(`There's nothing to use yet. Add your ${noun} first.`);
    const out = Object.assign(document.createElement('canvas'), { width: b.w, height: b.h });
    out.getContext('2d')!.drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    c.width = out.width = 0;
    if (!blob) throw new Error(`Your ${noun} couldn't be saved as an image. Please try again.`);
    return { blob, width: b.w, height: b.h };
  }

  function drawnCanvas() {
    const pts = strokes.flat();
    const m = pen * 1.6;
    const x0 = Math.min(...pts.map((p) => p.x)) - m;
    const y0 = Math.min(...pts.map((p) => p.y)) - m;
    const w = Math.max(...pts.map((p) => p.x)) + m - x0;
    const h = Math.max(...pts.map((p) => p.y)) + m - y0;
    const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(w * EXPORT_SCALE), height: Math.ceil(h * EXPORT_SCALE) });
    const ctx = c.getContext('2d')!;
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
    ctx.translate(-x0, -y0);
    paint(ctx, strokes, pen);
    return c;
  }

  function typedCanvas() {
    const size = 150 * font.scale;
    const css = `${size}px "${sigFamily(font)}"`;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = css;
    const m = probe.measureText(typed.trim());
    // script fonts swing outside their advance width, so size the canvas from the ink box
    const margin = size * 0.25;
    const c = Object.assign(document.createElement('canvas'), {
      width: Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + margin * 2),
      height: Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + margin * 2),
    });
    const ctx = c.getContext('2d')!;
    ctx.font = css;
    ctx.fillStyle = color;
    ctx.fillText(typed.trim(), margin + m.actualBoundingBoxLeft, margin + m.actualBoundingBoxAscent);
    return c;
  }

  async function use() {
    error = '';
    busy = true;
    try {
      if (tab === 'type') await loadSigFont(font);
      const canvas = tab === 'draw' ? drawnCanvas() : tab === 'type' ? typedCanvas() : preview!;
      const made = await trimmed(canvas);
      finished = true;
      oncreate({ ...made, remember, name: tab === 'type' && role === 'signature' ? typed.trim() : '' });
      dialog?.close();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} class="maker" aria-labelledby="{id}-title" onclose={() => finished || oncancel()}>
  <div class="head">
    <h2 id="{id}-title" class="text-[28px] leading-none">{role === 'initials' ? 'Your initials' : 'Your signature'}</h2>
    <button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
    </button>
  </div>

  <div class="tabs seg" role="group" aria-label="How to create it">
    {#each [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']] as const as [t, label] (t)}
      <button type="button" aria-pressed={tab === t} onclick={() => ((tab = t), (error = ''))}>{label}</button>
    {/each}
  </div>

  {#if tab !== 'upload'}
    <div class="options">
      <div class="seg" role="group" aria-label="Ink color">
        {#each inks as [c, label] (c)}
          <button type="button" aria-pressed={color === c} onclick={() => (color = c)}><i class="dot" style:background={c}></i>{label}</button>
        {/each}
      </div>
      {#if tab === 'draw'}
        <div class="seg" role="group" aria-label="Pen width">
          {#each pens as [label, w] (label)}
            <button type="button" aria-pressed={pen === w} onclick={() => (pen = w)}>{label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if tab === 'draw'}
    <div class="pad-wrap" class:initials={role === 'initials'}>
      <canvas
        bind:this={pad}
        class="pad"
        aria-label="Drawing area for your {noun}. Use a mouse, finger or stylus. To use the keyboard, choose Type instead."
        onpointerdown={padDown}
        onpointermove={padMove}
        onpointerup={padUp}
        onpointercancel={padUp}
      ></canvas>
      <div class="baseline" aria-hidden="true"><span>×</span></div>
      {#if !strokes.length}<p class="hint" aria-hidden="true">{role === 'initials' ? 'Draw your initials' : 'Sign here'}</p>{/if}
    </div>
    <div class="row">
      <span class="mono">mouse, finger or stylus · a stylus's pressure is used</span>
      <span class="flex gap-2">
        <button type="button" class="link" disabled={!strokes.length} onclick={() => (strokes = strokes.slice(0, -1))}>Undo stroke</button>
        <button type="button" class="link" disabled={!strokes.length} onclick={() => (strokes = [])}>Clear</button>
      </span>
    </div>
  {:else if tab === 'type'}
    <label class="label mt-1" for="{id}-typed">{role === 'initials' ? 'Your initials' : 'Your full name'}</label>
    <input id="{id}-typed" class="field" bind:value={typed} maxlength="60" autocomplete="name" placeholder={role === 'initials' ? 'JD' : 'Jane Doe'} />
    <div class="fonts" role="group" aria-label="Handwriting style">
      {#each sigFonts as f (f.id)}
        <button type="button" class="font" aria-pressed={font.id === f.id} aria-label={f.label} onclick={() => (font = f)}>
          <span class="sample" class:ready={fontsReady} style:font-family={`"${sigFamily(f)}", cursive`} style:font-size="{30 * f.scale}px" style:color={color}>{typed.trim() || (role === 'initials' ? 'JD' : 'Jane Doe')}</span>
          <span class="mono">{f.label}</span>
        </button>
      {/each}
    </div>
  {:else}
    {#if picture}
      <div class="shot">
        <canvas bind:this={preview} aria-label="Your {noun} image, as it will look on the page"></canvas>
      </div>
      <label class="check mt-3"><input type="checkbox" bind:checked={clean} class="accent-(--color-sun)" /> Remove the white background</label>
      {#if clean}
        <label class="mt-2 block">
          <span class="label">background cut-off · {threshold}</span>
          <input type="range" min="140" max="250" bind:value={threshold} class="w-full accent-(--color-sun)" />
        </label>
        <p class="mono">Raise it if paper shows around the ink, lower it if faint strokes disappear.</p>
      {/if}
      <button type="button" class="link mt-2" onclick={() => (picture = null)}>Choose a different image</button>
    {:else}
      <Dropzone accept="image/*,.heic,.heif" title="Drop a photo of your {noun}" hint="sign on white paper, then snap or scan it" paste={false} onfiles={take} />
      {#if busy}<p class="mono mt-2" role="status">Opening the image…</p>{/if}
    {/if}
  {/if}

  <label class="check mt-4">
    <input type="checkbox" bind:checked={remember} class="accent-(--color-sun)" />
    <span>Remember on this device <span class="mono">· stays in this browser, never uploaded</span></span>
  </label>

  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}

  <div class="actions">
    <button type="button" class="btn" onclick={() => dialog?.close()}>Cancel</button>
    <button type="button" class="btn btn-primary" disabled={empty || busy} onclick={use}>Use {noun}</button>
  </div>
</dialog>

<style>
  .maker {
    width: min(620px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    margin: auto;
    padding: 20px;
    color: var(--color-chalk);
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    box-shadow: 0 30px 80px -20px #000;
    overscroll-behavior: contain;
    &::backdrop {
      background: #0b0a09b8;
      backdrop-filter: blur(3px);
    }
    &[open] {
      animation: rise 0.28s var(--ease-spring);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    color: var(--color-soft);
    background: none;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .tabs {
    display: flex;
    width: 100%;
    margin-bottom: 12px;
    & button {
      flex: 1;
    }
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 50%;
    vertical-align: -1px;
    box-shadow: 0 0 0 1.5px #f2ede455;
  }
  .pad-wrap {
    position: relative;
    aspect-ratio: 3 / 1;
    min-height: 150px;
    max-height: 240px;
    width: 100%;
    background: #fbfaf7;
    border-radius: 14px;
    box-shadow: inset 0 0 0 1px #0000001a;
    &.initials {
      aspect-ratio: 2 / 1;
    }
  }
  .pad {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  .baseline {
    position: absolute;
    left: 7%;
    right: 7%;
    top: 70%;
    border-top: 1.5px dashed #c9c2b6;
    & span {
      position: absolute;
      left: -2px;
      top: -26px;
      font: 400 20px var(--font-sans);
      color: #9a948a;
    }
  }
  .hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: italic 400 30px var(--font-serif);
    color: #c9c2b6;
    pointer-events: none;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px 12px;
    margin-top: 8px;
  }
  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--color-line-2);
    text-underline-offset: 4px;
    &:hover:not(:disabled) {
      color: var(--color-chalk);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .fonts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
  }
  .font {
    display: grid;
    gap: 2px;
    justify-items: start;
    min-width: 0;
    padding: 10px 12px 8px;
    text-align: left;
    background: #fbfaf7;
    border: 2px solid transparent;
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s var(--ease-spring);
    &:hover {
      border-color: #c9c2b6;
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
    }
    &:active {
      transform: scale(0.98);
    }
    & .mono {
      color: #8a8478;
      font-size: 11px;
    }
  }
  .sample {
    display: block;
    max-width: 100%;
    height: 52px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    line-height: 52px;
    opacity: 0;
    transition: opacity 0.3s;
    &.ready {
      opacity: 1;
    }
  }
  .shot {
    display: grid;
    place-items: center;
    padding: 12px;
    border-radius: 14px;
    background: repeating-conic-gradient(#e9e6e0 0 25%, #fbfaf7 0 50%) 0 0 / 16px 16px;
    & canvas {
      max-width: 100%;
      max-height: 200px;
    }
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
    & input {
      margin-top: 4px;
    }
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
