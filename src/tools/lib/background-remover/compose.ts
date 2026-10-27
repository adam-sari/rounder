// Canvas side of the background remover: masks with brush edits, new backgrounds, shadow, crop, export.
import { encodeCanvas } from '@/engines/image/client';
import { alphaBounds, downsample, padBox, segmentStamps, type Box, type Stroke } from './matte';

export type Backdrop = 'none' | 'color' | 'blur' | 'image';
export type SaveFormat = 'png' | 'webp' | 'jpeg';

export interface Look {
  backdrop: Backdrop;
  color: string;
  /** 0–100 */
  blur: number;
  image: ImageBitmap | null;
  shadow: boolean;
  crop: boolean;
}

/** inner part of a brush dab that is fully opaque */
const HARDNESS = 0.55;
/** dab spacing as a share of the brush radius */
const SPACING = 0.3;

export const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!;

/** Paints a stroke's dabs from point `from` on (the whole stroke by default), at `scale` of full size */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, from = 0) {
  const r = s.r * scale;
  const dab = (x: number, y: number) => {
    const g = ctx.createRadialGradient(x * scale, y * scale, r * HARDNESS, x * scale, y * scale, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  const p = s.pts;
  if (from === 0) dab(p[0], p[1]);
  for (let k = Math.max(1, from); k < p.length / 2; k++) {
    const dabs = segmentStamps(p[2 * k - 2], p[2 * k - 1], p[2 * k], p[2 * k + 1], s.r * SPACING);
    for (let i = 0; i < dabs.length; i += 2) dab(dabs[i], dabs[i + 1]);
  }
  ctx.restore();
}

/** The mask (white, subject in alpha) at `scale` of the full w × h: the model's alpha plus brush edits */
export function maskCanvas(alpha: Uint8Array, w: number, h: number, strokes: Stroke[], scale: number): HTMLCanvasElement {
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const a = tw === w && th === h ? alpha : downsample(alpha, w, h, tw, th, 1);
  const img = new ImageData(tw, th);
  const d = img.data;
  d.fill(255);
  for (let i = 0; i < a.length; i++) d[i * 4 + 3] = a[i];
  const c = canvas(tw, th);
  const ctx = ctx2d(c);
  ctx.putImageData(img, 0, 0);
  for (const s of strokes) paintStroke(ctx, s, tw / w);
  return c;
}

/** The subject's bounding box in full-size pixels, with a little breathing room; null for an empty mask */
export function subjectBox(mask: HTMLCanvasElement, w: number, h: number): Box | null {
  const s = Math.min(1, 512 / Math.max(mask.width, mask.height));
  const c = canvas(Math.max(1, Math.round(mask.width * s)), Math.max(1, Math.round(mask.height * s)));
  const ctx = ctx2d(c);
  ctx.drawImage(mask, 0, 0, c.width, c.height);
  const b = alphaBounds(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 4, 3, 24);
  if (!b) return null;
  const kx = w / c.width;
  const ky = h / c.height;
  const full = { x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky };
  return padBox(full, Math.max(full.w, full.h) * 0.05, w, h);
}

/** Draws something that covers the full w × h image into the output frame (box at scale), overscanned by m px */
type Place = (ctx: CanvasRenderingContext2D, img: CanvasImageSource, m?: number) => void;

function placer(w: number, h: number, box: Box, scale: number): Place {
  return (ctx, img, m = 0) => ctx.drawImage(img, -box.x * scale - m, -box.y * scale - m, w * scale + 2 * m, h * scale + 2 * m);
}

/** The original photo in the output frame, for the "before" side of the compare slider */
export function frameSource(src: CanvasImageSource, w: number, h: number, box: Box | null, scale: number): HTMLCanvasElement {
  const b = box ?? { x: 0, y: 0, w, h };
  const out = canvas(Math.max(1, Math.round(b.w * scale)), Math.max(1, Math.round(b.h * scale)));
  placer(w, h, b, scale)(ctx2d(out), src);
  return out;
}

/** The subject alone: the photo with the mask as its alpha */
export function cutout(src: CanvasImageSource, mask: CanvasImageSource, w: number, h: number, box: Box | null, scale: number): HTMLCanvasElement {
  const out = frameSource(src, w, h, box, scale);
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = 'destination-in';
  placer(w, h, box ?? { x: 0, y: 0, w, h }, scale)(ctx, mask);
  return out;
}

/**
 * The finished picture: backdrop, optional soft shadow, the cut-out subject, optionally cropped
 * to `box`. Coordinates are full-size pixels; `scale` renders a smaller preview of the same thing.
 */
export function compose(src: CanvasImageSource, mask: CanvasImageSource, w: number, h: number, look: Look, box: Box | null, scale: number): HTMLCanvasElement {
  const subject = cutout(src, mask, w, h, box, scale);
  const out = canvas(subject.width, subject.height);
  const ctx = ctx2d(out);
  const long = Math.max(w, h) * scale;

  if (look.backdrop === 'color') {
    ctx.fillStyle = look.color;
    ctx.fillRect(0, 0, out.width, out.height);
  } else if (look.backdrop === 'image' && look.image) {
    const { width: iw, height: ih } = look.image;
    const s = Math.max(out.width / iw, out.height / ih);
    ctx.drawImage(look.image, (out.width - iw * s) / 2, (out.height - ih * s) / 2, iw * s, ih * s);
  } else if (look.backdrop === 'blur') {
    const r = 1 + (look.blur / 100) * 0.03 * long;
    const place = placer(w, h, box ?? { x: 0, y: 0, w, h }, scale);
    if (typeof ctx.filter === 'string') {
      // overscan so the blur doesn't pull transparency in from outside the edges
      ctx.filter = `blur(${r.toFixed(1)}px)`;
      place(ctx, src, r * 2);
      ctx.filter = 'none';
    } else {
      // older Safari: shrink and stretch back, which blurs well enough
      const k = Math.max(1, r / 2);
      const small = canvas(Math.ceil(out.width / k), Math.ceil(out.height / k));
      const sctx = ctx2d(small);
      sctx.scale(1 / k, 1 / k);
      place(sctx, src);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, out.width, out.height);
    }
  }

  if (look.shadow) {
    ctx.shadowColor = 'rgb(0 0 0 / 0.38)';
    ctx.shadowBlur = long * 0.025;
    ctx.shadowOffsetY = long * 0.012;
  }
  ctx.drawImage(subject, 0, 0);
  return out;
}

/**
 * The picture over a checkerboard, for on-screen previews: the compare slider lays the result
 * over the full original, which would show through anything transparent.
 */
export function onChecker(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(c.width, c.height);
  const ctx = ctx2d(out);
  const cell = Math.max(6, Math.round(Math.max(c.width, c.height) / 64));
  ctx.fillStyle = '#1f1e1b';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = '#2a2926';
  for (let y = 0, row = 0; y < out.height; y += cell, row++) for (let x = (row % 2) * cell; x < out.width; x += 2 * cell) ctx.fillRect(x, y, cell, cell);
  ctx.drawImage(c, 0, 0);
  return out;
}

export async function encode(c: HTMLCanvasElement, format: SaveFormat): Promise<Blob> {
  // the browser's PNG encoder is much faster than oxipng on big photos
  if (format === 'png') return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  return encodeCanvas(c, { format, quality: 90 });
}
