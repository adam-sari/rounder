import type { Rect } from '@/engines/image/types';

type Ctx = CanvasRenderingContext2D;

export function surface(w: number, h: number) {
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
  return [canvas, canvas.getContext('2d')!] as const;
}

/** iOS counts canvas memory until garbage collection, so give it back right away */
export function free(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 0;
}

let filterSupport: boolean | undefined;

/** Safari before 18 ignores ctx.filter without complaint, so test that a blur actually spreads */
function filterWorks() {
  if (filterSupport === undefined) {
    const [dot, dctx] = surface(5, 1);
    dctx.fillStyle = '#fff';
    dctx.fillRect(2, 0, 1, 1);
    const probe = Object.assign(document.createElement('canvas'), { width: 5, height: 1 });
    const ctx = probe.getContext('2d', { willReadFrequently: true })!;
    ctx.filter = 'blur(1px)';
    ctx.drawImage(dot, 0, 0);
    filterSupport = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
    free(dot);
    free(probe);
  }
  return filterSupport;
}

/**
 * Draws the src region over the whole W × H frame, blurred by radius px. The image is
 * drawn a little past the frame (at least 2.5 × radius each side) so the blur never
 * fades to transparent at the edges.
 */
export function drawBlurred(ctx: Ctx, src: CanvasImageSource, crop: Rect, W: number, H: number, radius: number) {
  ctx.imageSmoothingQuality = 'high';
  if (radius < 0.5) {
    ctx.drawImage(src, crop.x, crop.y, crop.width, crop.height, 0, 0, W, H);
    return;
  }
  if (filterWorks()) {
    // grow both sides by the same factor so the picture isn't stretched out of shape
    const k = 1 + (radius * 5) / Math.min(W, H);
    ctx.save();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, crop.x, crop.y, crop.width, crop.height, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k);
    ctx.restore();
    return;
  }
  // no canvas filter: shrinking and stretching back gives a soft, even blur
  const k = Math.max(1, radius / 1.5);
  const [tiny, tctx] = surface(W / k, H / k);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(src, crop.x, crop.y, crop.width, crop.height, 0, 0, tiny.width, tiny.height);
  ctx.drawImage(tiny, 0, 0, W, H);
  free(tiny);
}
