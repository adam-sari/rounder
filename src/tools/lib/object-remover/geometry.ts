/** both models work on a 512 × 512 square (MI-GAN takes any size but resizes to this inside) */
export const SIDE = 512;

/** A brush stroke in image pixels: paint marks what to remove, erase strokes take marks back */
export interface Stroke {
  erase: boolean;
  /** brush radius */
  r: number;
  points: { x: number; y: number }[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function strokeBounds({ r, points }: Stroke): Rect {
  // a loop, not Math.min(...xs): a long scribble can have more points than call arguments allow
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** true when the rects overlap or come within `gap` of each other */
export function near(a: Rect, b: Rect, gap = 0) {
  return a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
}

/**
 * Splits the marks into separate areas, so two objects far apart are each filled from a close,
 * sharp crop instead of one big blurry one. Paint strokes within `gap` px join one area; every
 * area keeps its strokes in drawing order, plus the erase strokes that touch it.
 */
export function groupStrokes(strokes: Stroke[], gap: number): { bounds: Rect; strokes: Stroke[] }[] {
  const groups = strokes.filter((s) => !s.erase).map((s) => ({ bounds: strokeBounds(s), members: new Set([s]) }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++)
        if (near(groups[i].bounds, groups[j].bounds, gap)) {
          groups[i] = { bounds: union(groups[i].bounds, groups[j].bounds), members: new Set([...groups[i].members, ...groups[j].members]) };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
  }
  return groups.map(({ bounds, members }) => ({
    bounds,
    strokes: strokes.filter((s) => members.has(s) || (s.erase && near(strokeBounds(s), bounds))),
  }));
}

/**
 * The crop handed to the model for one area: the marks plus surrounding context (about half
 * their size on each side, at least `min` px across), moved to stay inside the image.
 */
export function cropAround(b: Rect, width: number, height: number, min: number): Rect {
  const side = Math.max(min, Math.ceil(Math.max(b.w, b.h) * 1.5) + 128);
  const w = Math.min(width, side);
  const h = Math.min(height, side);
  return {
    x: clamp(Math.round(b.x + b.w / 2 - w / 2), 0, width - w),
    y: clamp(Math.round(b.y + b.h / 2 - h / 2), 0, height - h),
    w,
    h,
  };
}

export function shiftStrokes(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }));
}
