/**
 * A box in points (1/72 inch) from the page's top-left corner. Redaction marks
 * are stored unrotated (ignoring the page's /Rotate), the same space getText()
 * uses, so they line up with the text and with the page as it's rasterized.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** unrotated box → as the page is displayed with /Rotate (clockwise). W × H is the unrotated page size */
export function toDisplayed(b: Box, rotate: number, W: number, H: number): Box {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return { x: H - b.y - b.height, y: b.x, width: b.height, height: b.width };
    case 180:
      return { x: W - b.x - b.width, y: H - b.y - b.height, width: b.width, height: b.height };
    case 270:
      return { x: b.y, y: W - b.x - b.width, width: b.height, height: b.width };
    default:
      return { ...b };
  }
}

/** displayed box → unrotated; W × H is still the unrotated page size */
export function toUnrotated(b: Box, rotate: number, W: number, H: number): Box {
  const r = ((rotate % 360) + 360) % 360;
  // the inverse turn, applied to the displayed page (whose sides swap at 90 and 270)
  return r % 180 ? toDisplayed(b, 360 - r, H, W) : toDisplayed(b, r, W, H);
}

/** the box spanned by two corner points */
export function boxFrom(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function clampBox(b: Box, W: number, H: number): Box {
  const x = Math.max(0, Math.min(W, b.x));
  const y = Math.max(0, Math.min(H, b.y));
  return { x, y, width: Math.max(0, Math.min(W, b.x + b.width) - x), height: Math.max(0, Math.min(H, b.y + b.height) - y) };
}

export function unionBox(a: Box, b: Box): Box {
  return boxFrom(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x + a.width, b.x + b.width), Math.max(a.y + a.height, b.y + b.height));
}

export function containsPoint(b: Box, x: number, y: number) {
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

/**
 * Joins boxes that sit on the same line and touch or nearly touch, so a match
 * split over several text pieces becomes one clean bar.
 */
export function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of [...boxes].sort((p, q) => p.y - q.y || p.x - q.x)) {
    const hit = out.findIndex((o) => {
      const overlapY = Math.min(o.y + o.height, b.y + b.height) - Math.max(o.y, b.y);
      const gapX = Math.max(o.x, b.x) - Math.min(o.x + o.width, b.x + b.width);
      return overlapY >= 0.5 * Math.min(o.height, b.height) && gapX <= 0.5 * Math.max(o.height, b.height);
    });
    if (hit < 0) out.push({ ...b });
    else out[hit] = unionBox(out[hit], b);
  }
  return out;
}
