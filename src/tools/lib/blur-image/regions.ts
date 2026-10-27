export type Shape = 'rect' | 'ellipse';
export type Effect = 'blur' | 'pixelate' | 'box';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region extends Box {
  id: number;
  shape: Shape;
  /** null follows the effect chosen for all regions */
  effect: Effect | null;
}

/** which edges a handle drags: -1 left/top, 1 right/bottom, 0 neither */
export type Handle = readonly [-1 | 0 | 1, -1 | 0 | 1];
export const HANDLES: Handle[] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The box spanned by two corner points, kept inside a W × H image */
export function spanBox(x0: number, y0: number, x1: number, y1: number, W: number, H: number): Box {
  const [ax, bx] = [clamp(Math.min(x0, x1), 0, W), clamp(Math.max(x0, x1), 0, W)];
  const [ay, by] = [clamp(Math.min(y0, y1), 0, H), clamp(Math.max(y0, y1), 0, H)];
  return { x: ax, y: ay, w: bx - ax, h: by - ay };
}

export function moveBox(b: Box, dx: number, dy: number, W: number, H: number): Box {
  return { x: clamp(b.x + dx, 0, Math.max(0, W - b.w)), y: clamp(b.y + dy, 0, Math.max(0, H - b.h)), w: b.w, h: b.h };
}

/** Drags the edges a handle controls; dragging past the opposite edge flips the box */
export function resizeBox(b: Box, [hx, hy]: Handle, dx: number, dy: number, W: number, H: number): Box {
  const x0 = b.x + (hx === -1 ? dx : 0);
  const x1 = b.x + b.w + (hx === 1 ? dx : 0);
  const y0 = b.y + (hy === -1 ? dy : 0);
  const y1 = b.y + b.h + (hy === 1 ? dy : 0);
  return spanBox(x0, y0, x1, y1, W, H);
}

function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: Box, b: Box) {
  const i = overlap(a, b);
  return i ? i / (a.w * a.h + b.w * b.h - i) : 0;
}

/** True when two boxes overlap heavily, or one sits mostly inside the other */
export function sameThing(a: Box, b: Box) {
  const i = overlap(a, b);
  return iou(a, b) > 0.3 || i / Math.min(a.w * a.h, b.w * b.h) > 0.6;
}

/**
 * Square tiles at a few zoom levels, half-overlapping, so a face smaller than half
 * a tile always sits whole inside one of them. Short-range face models only see
 * faces that fill a decent part of the frame, so small faces in group photos need this.
 */
export function detectionTiles(W: number, H: number, { minTile = 400, levels = 3 } = {}): Box[] {
  const starts = (len: number, side: number) => {
    if (side >= len) return [0];
    const out: number[] = [];
    for (let p = 0; p + side < len; p += side / 2) out.push(Math.round(p));
    out.push(Math.round(len - side));
    return out;
  };
  const tiles: Box[] = [];
  let side = Math.min(W, H);
  for (let level = 0; level < levels && side >= minTile; level++, side /= 2) {
    const s = Math.round(side);
    const xs = starts(W, s);
    const ys = starts(H, s);
    // a single tile covering everything just repeats the whole-image pass
    if (xs.length * ys.length === 1) continue;
    for (const y of ys) for (const x of xs) tiles.push({ x, y, w: s, h: s });
  }
  return tiles;
}

/** A detection clipped by a tile edge that isn't the image edge; a neighbouring tile sees it whole */
export function cutByTile(b: Box, t: Box, W: number, H: number) {
  const m = t.w * 0.02;
  return (
    (t.x > 0 && b.x < t.x + m) ||
    (t.y > 0 && b.y < t.y + m) ||
    (t.x + t.w < W && b.x + b.w > t.x + t.w - m) ||
    (t.y + t.h < H && b.y + b.h > t.y + t.h - m)
  );
}

/** Folds duplicate detections (from overlapping tiles) into one box each, best score first */
export function mergeDetections(found: (Box & { score: number })[]): Box[] {
  const kept: Box[] = [];
  for (const d of [...found].sort((a, b) => b.score - a.score)) {
    const twin = kept.find((k) => sameThing(k, d));
    if (!twin) {
      kept.push({ x: d.x, y: d.y, w: d.w, h: d.h });
      continue;
    }
    // grow to cover both: over-covering a face is safer than missing an ear
    const x1 = Math.max(twin.x + twin.w, d.x + d.w);
    const y1 = Math.max(twin.y + twin.h, d.y + d.h);
    twin.x = Math.min(twin.x, d.x);
    twin.y = Math.min(twin.y, d.y);
    twin.w = x1 - twin.x;
    twin.h = y1 - twin.y;
  }
  return kept;
}

/**
 * Face detectors box the eyes-to-chin area. Grow it (more upwards, for forehead
 * and hair) so the ellipse drawn inside the box still covers the whole face.
 */
export function padFace(b: Box, W: number, H: number): Box {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 - b.h * 0.1;
  const w = b.w * 1.5;
  const h = b.h * 1.8;
  return spanBox(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, W, H);
}

/**
 * Effect size follows the region's size, so the preview matches the full-size export
 * and a big face gets as unreadable as a small one. Strength runs 1–100.
 */
export function effectParams(b: Pick<Box, 'w' | 'h'>, strength: number) {
  const size = Math.sqrt(b.w * b.h) * (strength / 100);
  const sigma = Math.max(0.5, size * 0.15);
  const block = Math.max(1, size * 0.2);
  return { sigma, cols: Math.max(1, Math.round(b.w / block)), rows: Math.max(1, Math.round(b.h / block)) };
}

/**
 * Three box-blur passes, close to a gaussian with σ ≈ radius. Fallback for browsers
 * without canvas filters (Safari before 18). Edges repeat their outer pixels.
 */
export function boxBlur(data: Uint8ClampedArray, w: number, h: number, radius: number, passes = 3) {
  const r = Math.round(radius);
  if (r < 1) return;
  const tmp = new Uint8ClampedArray(data.length);
  for (let p = 0; p < passes; p++) {
    blurLines(data, tmp, w, h, r, 4, w * 4);
    blurLines(tmp, data, h, w, r, w * 4, 4);
  }
}

/** Sliding-window average along `lines` lines of `len` pixels; `step` between pixels, `stride` between lines */
function blurLines(src: Uint8ClampedArray, dst: Uint8ClampedArray, len: number, lines: number, r: number, step: number, stride: number) {
  const div = 2 * r + 1;
  const last = len - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * stride;
    for (let c = 0; c < 4; c++) {
      const o = base + c;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[o + Math.min(last, Math.max(0, i)) * step];
      for (let i = 0; i < len; i++) {
        dst[o + i * step] = sum / div;
        sum += src[o + Math.min(last, i + r + 1) * step] - src[o + Math.max(0, i - r) * step];
      }
    }
  }
}
