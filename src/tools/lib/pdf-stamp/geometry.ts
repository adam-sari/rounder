/*
 * Page geometry shared by the page-number and watermark tools. Everything is
 * laid out in "visual" points: the page as people see it (CropBox, /Rotate
 * applied), origin bottom-left, y up. pageFrame() maps that back to PDF user
 * space, and the live preview uses the very same numbers on a canvas.
 */

/** [x0, y0, x1, y1] */
export type Box = [number, number, number, number];
/** PDF matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number];
export interface Point {
  x: number;
  y: number;
}

export interface Frame {
  /** visual size in points */
  width: number;
  height: number;
  /** visual space → PDF user space */
  matrix: Matrix;
}

export const normalizeAngle = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/** The part of the page viewers show: CropBox clipped to the MediaBox, like pdf.js does */
export function visibleBox(media: Box, crop?: Box): Box {
  const m: Box = [Math.min(media[0], media[2]), Math.min(media[1], media[3]), Math.max(media[0], media[2]), Math.max(media[1], media[3])];
  if (!crop) return m;
  const c: Box = [Math.max(m[0], Math.min(crop[0], crop[2])), Math.max(m[1], Math.min(crop[1], crop[3])), Math.min(m[2], Math.max(crop[0], crop[2])), Math.min(m[3], Math.max(crop[1], crop[3]))];
  return c[2] > c[0] && c[3] > c[1] ? c : m;
}

/** Visual size and transform for a page box shown with /Rotate (clockwise degrees) */
export function pageFrame([x0, y0, x1, y1]: Box, rotation: number): Frame {
  const w = x1 - x0;
  const h = y1 - y0;
  switch (normalizeAngle(rotation)) {
    case 90:
      return { width: h, height: w, matrix: [0, 1, -1, 0, x1, y0] };
    case 180:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, x1, y1] };
    case 270:
      return { width: h, height: w, matrix: [0, -1, 1, 0, x0, y1] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, x0, y0] };
  }
}

export function applyMatrix([a, b, c, d, e, f]: Matrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

/** Bounding box of a w×h rectangle turned by `deg` */
export function rotatedSize(w: number, h: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return { width: w * cos + h * sin, height: w * sin + h * cos };
}

/** Centre of a bw×bh box pinned to an anchor, `margin` points in from the edges */
export function anchorCenter(W: number, H: number, bw: number, bh: number, anchor: Anchor, margin: number): Point {
  const col = anchor[1];
  const row = anchor[0];
  return {
    x: col === 'l' ? margin + bw / 2 : col === 'r' ? W - margin - bw / 2 : W / 2,
    y: row === 'b' ? margin + bh / 2 : row === 't' ? H - margin - bh / 2 : H / 2,
  };
}

/** Centres for a repeating pattern of bw×bh boxes with `gap` between them, every other row shifted half a step */
export function tileCenters(W: number, H: number, bw: number, bh: number, gap: number, max = 600): Point[] {
  const sx = Math.max(bw + gap, 1);
  const sy = Math.max(bh + gap, 1);
  const rows = Math.ceil(H / sy) + 1;
  const cols = Math.ceil(W / sx) + 2;
  const out: Point[] = [];
  for (let r = 0; r < rows; r++) {
    const y = H / 2 + (r - (rows - 1) / 2) * sy;
    const shift = r % 2 ? sx / 2 : 0;
    for (let c = 0; c < cols; c++) {
      const x = W / 2 + (c - (cols - 1) / 2) * sx + shift;
      if (x + bw / 2 <= 0 || x - bw / 2 >= W || y + bh / 2 <= 0 || y - bh / 2 >= H) continue;
      out.push({ x, y });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Matrix drawing a w×h box (local origin bottom-left) centred on `c`, turned
 * `deg` counter-clockwise. `unit` is for images, whose local box is 1×1.
 */
export function markMatrix(c: Point, w: number, h: number, deg: number, unit = false): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const kx = unit ? w : 1;
  const ky = unit ? h : 1;
  return [cos * kx, sin * kx, -sin * ky, cos * ky, c.x - (cos * w) / 2 + (sin * h) / 2, c.y - (sin * w) / 2 - (cos * h) / 2];
}

export type Placement = Anchor | 'tile';
export type AngleMode = 'diagonal' | 'level' | 'custom';

/** Diagonal runs corner to corner on each page, so portrait and landscape pages both look right */
export function resolveAngle(mode: AngleMode, custom: number, W: number, H: number) {
  if (mode === 'diagonal') return (Math.atan2(H, W) * 180) / Math.PI;
  return mode === 'level' ? 0 : custom;
}

/** Every copy of a w×h mark on a W×H page, as matrices in visual space */
export function markPlacements(W: number, H: number, w: number, h: number, o: { angle: number; placement: Placement; margin: number; unit?: boolean }): Matrix[] {
  const box = rotatedSize(w, h, o.angle);
  const centers = o.placement === 'tile' ? tileCenters(W, H, box.width, box.height, o.margin) : [anchorCenter(W, H, box.width, box.height, o.placement, o.margin)];
  return centers.map((c) => markMatrix(c, w, h, o.angle, o.unit));
}

/** "#ff8800" or "#f80" → [1, 0.53, 0]; anything else is black */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/* ---------------- page numbers ---------------- */

export const NUMBER_FORMATS = [
  ['{n}', '1'],
  ['Page {n}', 'Page 1'],
  ['Page {n} of {total}', 'Page 1 of N'],
  ['{n}/{total}', '1/N'],
] as const;

export function formatPageLabel(template: string, n: number, total: number) {
  return template.replace(/\{\s*(n|total)\s*\}/gi, (_, key: string) => String(key.toLowerCase() === 'n' ? n : total));
}

export interface NumberedPage {
  pageIndex: number;
  n: number;
}

/**
 * Which pages get a number and which number: `pages` are 0-based indices to
 * number (any order, repeats ignored), counted from `start` in document order.
 * `total` is the last number printed, so "Page N of N" ends on the last page.
 */
export function numberingPlan(pages: number[], { skipFirst = false, start = 1 } = {}): { pages: NumberedPage[]; total: number } {
  const sorted = [...new Set(pages)].filter((i) => !(skipFirst && i === 0)).sort((a, b) => a - b);
  return { pages: sorted.map((pageIndex, k) => ({ pageIndex, n: start + k })), total: start + sorted.length - 1 };
}

/** Bottom-left of the text's baseline for a w×h label (descent below the baseline) pinned to an anchor */
export function labelOrigin(W: number, H: number, box: { width: number; height: number; descent: number }, anchor: Anchor, margin: number): Point {
  const c = anchorCenter(W, H, box.width, box.height, anchor, margin);
  return { x: c.x - box.width / 2, y: c.y - box.height / 2 + box.descent };
}
