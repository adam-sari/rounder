import type { Box, FontFamily, InkObj, LineObj, MarkObj } from './model';

/* ---------------- page space → PDF user space ---------------- */

export type Matrix = [number, number, number, number, number, number];

const quarter = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/** displayed page size in points: the view box, turned by /Rotate */
export function displaySize(view: number[], rotate: number) {
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  return quarter(rotate) % 180 ? { w: h, h: w } : { w, h };
}

/**
 * The `cm` matrix that lets us draw in display space (bottom-left origin, y up,
 * the page as the reader sees it) and land in the right spot of PDF user space,
 * whatever the page's /Rotate and however its crop box is offset.
 */
export function displayMatrix(view: number[], rotate: number): Matrix {
  const [x1, y1, x2, y2] = view;
  switch (quarter(rotate)) {
    case 90:
      return [0, 1, -1, 0, x2, y1];
    case 180:
      return [-1, 0, 0, -1, x2, y2];
    case 270:
      return [0, -1, 1, 0, x1, y2];
    default:
      return [1, 0, 0, 1, x1, y1];
  }
}

/** a point on screen (points from the displayed page's top-left) in PDF user space */
export function toUserSpace(view: number[], rotate: number, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = displayMatrix(view, rotate);
  const dy = displaySize(view, rotate).h - y;
  return [a * x + c * dy + e, b * x + d * dy + f];
}

/* ---------------- boxes ---------------- */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const cornerHandles: Handle[] = ['nw', 'ne', 'se', 'sw'];

/** drags one handle of a box; corners keep the shape when `keepAspect` */
export function resizeBox(s: Box, handle: Handle, dx: number, dy: number, { keepAspect = false, min = 4 } = {}): Box {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let w = s.w + (east ? dx : west ? -dx : 0);
  let h = s.h + (south ? dy : north ? -dy : 0);
  if (keepAspect && (east || west) && (north || south)) {
    const k = Math.max(w / s.w, h / s.h, min / Math.min(s.w, s.h));
    w = s.w * k;
    h = s.h * k;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }
  return { x: west ? s.x + s.w - w : s.x, y: north ? s.y + s.h - h : s.y, w, h };
}

/** keeps a box on the page (or covering it, when it's bigger than the page) */
export function clampBox(b: Box, pageW: number, pageH: number): Box {
  const clamp = (v: number, size: number, max: number) => (size <= max ? Math.min(Math.max(v, 0), max - size) : Math.min(Math.max(v, max - size), 0));
  return { ...b, x: clamp(b.x, b.w, pageW), y: clamp(b.y, b.h, pageH) };
}

/** a w × h shape scaled down to fit inside maxW × maxH */
export function fitInside(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: w * k, h: h * k };
}

function nearest(edges: number[], targets: number[], tol: number) {
  let best: { d: number; at: number } | null = null;
  for (const e of edges)
    for (const t of targets) {
      const d = t - e;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
  return best;
}

/**
 * Snaps a box's edges or centre to nearby guide lines (page edges and centre,
 * other objects). Returns the snapped position and the guides it locked onto.
 */
export function snapBox(b: Box, xs: number[], ys: number[], tol: number) {
  const fx = nearest([b.x, b.x + b.w / 2, b.x + b.w], xs, tol);
  const fy = nearest([b.y, b.y + b.h / 2, b.y + b.h], ys, tol);
  return { x: b.x + (fx?.d ?? 0), y: b.y + (fy?.d ?? 0), gx: fx?.at ?? null, gy: fy?.at ?? null };
}

/** guide lines for snapping: page edges and centre, plus every other box's edges and centre */
export function snapTargets(pageW: number, pageH: number, others: Box[]) {
  const xs = [0, pageW / 2, pageW];
  const ys = [0, pageH / 2, pageH];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys };
}

/** the end point moved onto the nearest 45° direction from the start (Shift while drawing lines) */
export function snapAngle(x1: number, y1: number, x2: number, y2: number): [number, number] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
  return [x1 + Math.cos(a) * len, y1 + Math.sin(a) * len];
}

/* ---------------- text ---------------- */

export const LINE_HEIGHT = 1.2;

// ascent / descent per 1000 units of the PDF standard fonts; used on screen and in the
// PDF alike so every line sits on the same baseline in both
const METRICS: Record<FontFamily, [number, number]> = { sans: [718, -207], serif: [683, -217], mono: [629, -157] };

/** tabs become spaces: the standard PDF fonts can't encode a tab */
export function textLines(text: string) {
  return text.replace(/\t/g, '    ').split(/\r\n|\r|\n/);
}

/** distance from the text box's top to line i's baseline */
export function baseline(i: number, size: number, font: FontFamily) {
  const [a, d] = METRICS[font];
  return size * (i * LINE_HEIGHT + (LINE_HEIGHT - (a - d) / 1000) / 2 + a / 1000);
}

/* ---------------- paths (shared by the screen and the PDF) ---------------- */

const r = (n: number) => Math.round(n * 100) / 100;

/** drops points closer than `min` to the previous kept one (always keeps the last) */
export function simplify(pts: number[], min: number): number[] {
  if (pts.length <= 4) return pts.slice();
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    if (Math.hypot(pts[i] - out[out.length - 2], pts[i + 1] - out[out.length - 1]) >= min) out.push(pts[i], pts[i + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

/** a smooth path through flat x,y pairs: quadratic curves via the midpoints */
export function smoothPath(pts: number[]): string {
  const n = pts.length / 2;
  if (n === 0) return '';
  const [x0, y0] = [r(pts[0]), r(pts[1])];
  if (n === 1) return `M${x0} ${y0}L${r(pts[0] + 0.01)} ${y0}`; // a dot: round caps draw it
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < n - 1; i++) {
    const [x, y, nx, ny] = [pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]];
    d += `Q${r(x)} ${r(y)} ${r((x + nx) / 2)} ${r((y + ny) / 2)}`;
  }
  return d + `L${r(pts[2 * n - 2])} ${r(pts[2 * n - 1])}`;
}

/** wraps absolute stroke points in a box (padded by half the pen width) with 0–1 coordinates */
export function normalizeInk(pts: number[], width: number): { box: Box; points: number[] } {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const pad = Math.max(width / 2, 0.5);
  const box = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  const points = pts.map((v, i) => (i % 2 ? (v - box.y) / box.h : (v - box.x) / box.w));
  return { box, points };
}

export function inkPath(o: Pick<InkObj, 'x' | 'y' | 'w' | 'h' | 'points'>) {
  return smoothPath(o.points.map((v, i) => (i % 2 ? o.y + v * o.h : o.x + v * o.w)));
}

/** check marks and crosses, stroked with round caps */
export function markPath(o: Pick<MarkObj, 'x' | 'y' | 'w' | 'h' | 'mark'>) {
  const p = (fx: number, fy: number) => `${r(o.x + fx * o.w)} ${r(o.y + fy * o.h)}`;
  const d = o.mark === 'check' ? `M${p(0.14, 0.54)}L${p(0.4, 0.8)}L${p(0.88, 0.2)}` : `M${p(0.2, 0.2)}L${p(0.8, 0.8)}M${p(0.8, 0.2)}L${p(0.2, 0.8)}`;
  return { d, width: Math.min(o.w, o.h) * 0.13 };
}

/** a line, plus a filled arrowhead at its end when it's an arrow */
export function linePaths(o: Pick<LineObj, 'x1' | 'y1' | 'x2' | 'y2' | 'width' | 'arrow'>) {
  const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  const head = Math.max(7, o.width * 3.5);
  if (!o.arrow || len < head) return { line: `M${r(o.x1)} ${r(o.y1)}L${r(o.x2)} ${r(o.y2)}`, head: null };
  const [ux, uy] = [(o.x2 - o.x1) / len, (o.y2 - o.y1) / len];
  const [bx, by] = [o.x2 - ux * head, o.y2 - uy * head];
  const half = head * 0.45;
  // the shaft stops inside the head so its round cap doesn't poke out of the tip
  const [ex, ey] = [o.x2 - ux * head * 0.6, o.y2 - uy * head * 0.6];
  return {
    line: `M${r(o.x1)} ${r(o.y1)}L${r(ex)} ${r(ey)}`,
    head: `M${r(o.x2)} ${r(o.y2)}L${r(bx - uy * half)} ${r(by + ux * half)}L${r(bx + uy * half)} ${r(by - ux * half)}Z`,
  };
}
