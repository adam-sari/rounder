import type { Rect } from '@/engines/image/types';

/*
 * The crop box lives in "display" space: the image as the user sees it, after
 * rotating and flipping, at full resolution. The engine crops in source space
 * first and orients afterwards, so rects are mapped back with toSource on export.
 */

export type Turn = 0 | 90 | 180 | 270;

/** same order as the engine: flip in source space, then rotate clockwise */
export interface Orientation {
  rotate: Turn;
  flipX: boolean;
  flipY: boolean;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

export const turn = (deg: number) => ((((deg % 360) + 360) % 360) as Turn);

export function orientedSize(w: number, h: number, rotate: Turn) {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h };
}

/** flips as seen on screen, whatever the current rotation */
export const flipHorizontal = (o: Orientation): Orientation => ({ rotate: turn(-o.rotate), flipX: !o.flipX, flipY: o.flipY });
export const flipVertical = (o: Orientation): Orientation => ({ rotate: turn(-o.rotate), flipX: o.flipX, flipY: !o.flipY });

// clockwise rotation in y-down coordinates, as canvas rotate() does
function rot(x: number, y: number, deg: number): [number, number] {
  switch (turn(deg)) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

function fromCorners(a: [number, number], b: [number, number]): Rect {
  const x = Math.round(Math.min(a[0], b[0]));
  const y = Math.round(Math.min(a[1], b[1]));
  return { x, y, width: Math.round(Math.max(a[0], b[0])) - x, height: Math.round(Math.max(a[1], b[1])) - y };
}

/** display-space rect → the same pixels in the unrotated source (w × h) */
export function toSource(r: Rect, w: number, h: number, o: Orientation): Rect {
  const d = orientedSize(w, h, o.rotate);
  const map = (X: number, Y: number): [number, number] => {
    const [x, y] = rot(X - d.width / 2, Y - d.height / 2, -o.rotate);
    return [(o.flipX ? -x : x) + w / 2, (o.flipY ? -y : y) + h / 2];
  };
  return fromCorners(map(r.x, r.y), map(r.x + r.width, r.y + r.height));
}

/** source-space rect → where it appears on screen under orientation o */
export function toDisplay(r: Rect, w: number, h: number, o: Orientation): Rect {
  const d = orientedSize(w, h, o.rotate);
  const map = (x: number, y: number): [number, number] => {
    const [X, Y] = rot(o.flipX ? -(x - w / 2) : x - w / 2, o.flipY ? -(y - h / 2) : y - h / 2, o.rotate);
    return [X + d.width / 2, Y + d.height / 2];
  };
  return fromCorners(map(r.x, r.y), map(r.x + r.width, r.y + r.height));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** largest box of this aspect ratio (width / height) that fits in W × H */
export function maxBox(aspect: number, W: number, H: number) {
  return W / H > aspect ? { width: H * aspect, height: H } : { width: W, height: W / aspect };
}

/**
 * Centres a w × h box on (cx, cy) inside W × H, shrinking it to fit if needed
 * (uniformly when an aspect ratio is locked) and sliding it off the edges.
 */
export function placeBox(cx: number, cy: number, w: number, h: number, W: number, H: number, aspect: number | null): Rect {
  if (aspect) {
    const s = Math.min(1, W / w, H / h);
    w *= s;
    h *= s;
  } else {
    w = Math.min(w, W);
    h = Math.min(h, H);
  }
  const width = clamp(Math.round(w), 1, W);
  const height = clamp(Math.round(h), 1, H);
  return {
    x: clamp(Math.round(cx - width / 2), 0, W - width),
    y: clamp(Math.round(cy - height / 2), 0, H - height),
    width,
    height,
  };
}

/**
 * Resizes or moves `start` by a pointer delta (display pixels), keeping it inside
 * W × H, at least `min` pixels, and at the aspect ratio if one is locked.
 * Dragging a handle past the opposite side flips the box, like most editors.
 */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, W: number, H: number, aspect: number | null, min = 1): Rect {
  if (handle === 'move') {
    return { ...start, x: clamp(Math.round(start.x + dx), 0, W - start.width), y: clamp(Math.round(start.y + dy), 0, H - start.height) };
  }
  const east = handle.includes('e');
  const west = handle.includes('w');
  const south = handle.includes('s');
  const north = handle.includes('n');
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  // the fixed side(s) and where the dragged side(s) went
  const ax = west ? right : start.x;
  const ay = north ? bottom : start.y;
  const px = east ? right + dx : west ? start.x + dx : right;
  const py = south ? bottom + dy : north ? start.y + dy : bottom;
  const dirX = px >= ax ? 1 : -1;
  const dirY = py >= ay ? 1 : -1;
  const roomX = dirX > 0 ? W - ax : ax;
  const roomY = dirY > 0 ? H - ay : ay;

  // edge handles keep the other axis centred on the box
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  const sideOnly = (east || west) !== (north || south);

  let w = Math.abs(px - ax);
  let h = Math.abs(py - ay);
  if (aspect) {
    if (sideOnly && (east || west)) {
      w = clamp(w, min, Math.min(roomX, H * aspect));
      h = w / aspect;
    } else if (sideOnly) {
      h = clamp(h, min, Math.min(roomY, W / aspect));
      w = h * aspect;
    } else {
      // corners follow the pointer projected onto the box's diagonal
      let t = (w * aspect + h) / (aspect * aspect + 1);
      t = clamp(t, min / Math.min(aspect, 1), Math.min(roomX / aspect, roomY));
      w = t * aspect;
      h = t;
    }
  } else {
    w = clamp(w, min, roomX);
    h = clamp(h, min, roomY);
  }

  const width = clamp(Math.round(w), 1, W);
  const height = clamp(Math.round(h), 1, H);
  const x = sideOnly && !(east || west) ? cx - width / 2 : dirX > 0 ? ax : ax - width;
  const y = sideOnly && (east || west) ? cy - height / 2 : dirY > 0 ? ay : ay - height;
  return { x: clamp(Math.round(x), 0, W - width), y: clamp(Math.round(y), 0, H - height), width, height };
}

/** applies a typed width or height, keeping the box's top-left where possible */
export function resizeTo(r: Rect, field: 'width' | 'height', value: number, W: number, H: number, aspect: number | null): Rect {
  let w = field === 'width' ? value : aspect ? value * aspect : r.width;
  let h = field === 'height' ? value : aspect ? value / aspect : r.height;
  if (aspect) {
    const s = Math.min(1, W / w, H / h);
    w *= s;
    h *= s;
  }
  const width = clamp(Math.round(w), 1, W);
  const height = clamp(Math.round(h), 1, H);
  return { x: clamp(r.x, 0, W - width), y: clamp(r.y, 0, H - height), width, height };
}

/** "16:9" → 1.777…; anything unusable → null (free) */
export function parseRatio(w: number, h: number): number | null {
  return w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : null;
}
