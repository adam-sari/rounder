import { coverCrop, type Box, type View } from './layout';

/** draws one photo cover-fitted into its cell, clipped to rounded corners */
export function drawCell(ctx: CanvasRenderingContext2D, box: Box, radius: number, img: CanvasImageSource, iw: number, ih: number, view: View) {
  const { sx, sy, sw, sh } = coverCrop(iw, ih, box.w, box.h, view);
  ctx.save();
  const r = Math.min(radius, box.w / 2, box.h / 2);
  if (r > 0) {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, r);
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}
