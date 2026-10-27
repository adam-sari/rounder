import { inkFor, wrapLines, type FitMode, type FrameState, type Transition } from './plan';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Img = CanvasImageSource & { width: number; height: number };
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface TitleCard {
  text: string;
  sub: string;
  font: 'serif' | 'sans';
}

export function newCanvas(w: number, h: number): AnyCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export const context = (c: AnyCanvas) => c.getContext('2d') as Ctx;

export function toJpeg(c: AnyCanvas, quality = 0.92): Promise<Blob> {
  if (c instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode a slide.'))), 'image/jpeg', quality));
  }
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

/** draws img centred, scaled to cover or fit W×H, times `zoom` */
function drawFit(ctx: Ctx, img: Img, W: number, H: number, mode: 'cover' | 'contain', zoom = 1) {
  const s = (mode === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min(W / img.width, H / img.height)) * zoom;
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** the photo itself, heavily blurred and dimmed, filling the frame */
function drawBackdrop(ctx: Ctx, img: Img, W: number, H: number, dim = 0.3) {
  if (typeof (ctx as { filter?: unknown }).filter === 'string') {
    ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px)`;
    // overscan, so the blur doesn't pull transparent edges in
    drawFit(ctx, img, W, H, 'cover', 1.15);
    ctx.filter = 'none';
  } else {
    // no canvas filters (older Safari): a tiny copy stretched back up reads as a blur
    const small = newCanvas(Math.max(1, Math.round(W / 28)), Math.max(1, Math.round(H / 28)));
    drawFit(context(small), img, small.width, small.height, 'cover');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }
  ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
  ctx.fillRect(0, 0, W, H);
}

/**
 * One finished slide at the output size. `backdrop` is any copy of the same photo (a small one is
 * plenty, it gets blurred).
 */
export function composeSlide(ctx: Ctx, img: Img, W: number, H: number, fit: FitMode, background: string, backdrop: Img = img) {
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  if (fit === 'blur') drawBackdrop(ctx, backdrop, W, H);
  drawFit(ctx, img, W, H, fit === 'cover' ? 'cover' : 'contain');
}

const families = { serif: '"Instrument Serif", Georgia, serif', sans: '"Geist Variable", system-ui, sans-serif' };

/** title card: big centred title, optional smaller line under it, over a blurred photo or a plain color */
export function composeTitle(ctx: Ctx, W: number, H: number, card: TitleCard, backdrop: Img | null, background: string) {
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  if (backdrop) drawBackdrop(ctx, backdrop, W, H, 0.45);
  const ink = backdrop ? '#ffffff' : inkFor(background);
  const maxW = W * 0.84;
  const measure = (s: string) => ctx.measureText(s).width;
  const weight = card.font === 'serif' ? 400 : 600;

  // shrink until the title fits in three lines
  let size = Math.min(W, H) * (card.font === 'serif' ? 0.15 : 0.11);
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${weight} ${size}px ${families[card.font]}`;
    lines = wrapLines(card.text, maxW, measure);
    if (size < 12 || (lines.length <= 3 && lines.every((l) => measure(l) <= maxW))) break;
    size *= 0.9;
  }
  const subSize = Math.max(10, Math.min(W, H) * 0.045);
  ctx.font = `400 ${subSize}px ${families.sans}`;
  const subLines = wrapLines(card.sub, maxW, measure).slice(0, 2);

  const lead = size * 1.08;
  const subLead = subSize * 1.35;
  const gap = lines.length && subLines.length ? size * 0.45 : 0;
  let y = (H - (lines.length * lead + gap + subLines.length * subLead)) / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.shadowColor = ink === '#ffffff' ? 'rgba(0, 0, 0, 0.35)' : 'transparent';
  ctx.shadowBlur = size * 0.25;
  ctx.font = `${weight} ${size}px ${families[card.font]}`;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y + lead / 2, maxW);
    y += lead;
  }
  y += gap;
  ctx.globalAlpha = 0.82;
  ctx.font = `400 ${subSize}px ${families.sans}`;
  for (const l of subLines) {
    ctx.fillText(l, W / 2, y + subLead / 2, maxW);
    y += subLead;
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

/** composite placed like imagesToVideo does: zoomed from the centre, shifted, faded */
function place(ctx: Ctx, img: Img, W: number, H: number, zoom: number, dx = 0, alpha = 1) {
  const w = W * zoom;
  const h = H * zoom;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

/** one preview frame from ready-made slide composites (same math as the export) */
export function drawFrame(ctx: Ctx, W: number, H: number, s: FrameState, slide: (i: number) => Img, transition: Transition, kenBurns: boolean) {
  const zoom = (p: number) => (kenBurns ? 1 + 0.08 * p : 1);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (s.mix === null) return place(ctx, slide(s.slot), W, H, zoom(s.local));
  if (transition === 'slide') {
    place(ctx, slide(s.slot), W, H, zoom(s.local), -W * s.mix);
    place(ctx, slide(s.slot + 1), W, H, zoom(0), W * (1 - s.mix));
  } else {
    place(ctx, slide(s.slot), W, H, zoom(s.local));
    place(ctx, slide(s.slot + 1), W, H, zoom(0), 0, s.mix);
  }
}
