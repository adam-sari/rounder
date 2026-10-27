import type { Stroke } from './geometry';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws one stroke (from point `from` on, for live drawing) in the context's current transform
 * and fill/stroke style. `grow` widens paint and narrows erase strokes, in stroke units.
 */
export function traceStroke(ctx: Ctx, s: Stroke, grow = 0, from = 0) {
  const r = Math.max(0.5, s.r + (s.erase ? -grow : grow));
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  const pts = s.points.slice(Math.max(0, from));
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = r * 2;
    ctx.lineCap = ctx.lineJoin = 'round';
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * The marks as a one-channel mask of width × height (0 = keep, 255 = remove), with strokes
 * scaled by sx, sy from their own coordinates.
 */
export function strokeMask(strokes: Stroke[], width: number, height: number, sx: number, sy: number, grow = 0): Uint8Array {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  for (const s of strokes) traceStroke(ctx, s, grow);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3];
  return out;
}
