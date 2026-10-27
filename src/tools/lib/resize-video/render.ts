import type { VideoOptions } from '@/engines/media/types';
import { fitRect } from './layout';

type Render = NonNullable<VideoOptions['render']>;

/**
 * Render hook for "fit" modes: the whole video, centred, over a solid color or a blurred,
 * darkened copy of itself. The blur shrinks the frame hard and scales it back up in steps,
 * which is much cheaper per frame than a canvas blur filter and looks the same at this strength.
 */
export function backdropRender(W: number, H: number, backdrop: { color: string } | 'blur'): Render {
  let mid: OffscreenCanvas | null = null;
  let tiny: OffscreenCanvas | null = null;

  return (ctx, src) => {
    const sw = src.displayWidth;
    const sh = src.displayHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (backdrop === 'blur') {
      mid ??= new OffscreenCanvas(Math.max(2, Math.round(W / 4)), Math.max(2, Math.round(H / 4)));
      tiny ??= new OffscreenCanvas(Math.max(2, Math.round(W / 32)), Math.max(2, Math.round(H / 32)));
      const m = mid.getContext('2d')!;
      const t = tiny.getContext('2d')!;
      m.imageSmoothingQuality = t.imageSmoothingQuality = 'high';
      const c = fitRect(sw, sh, mid.width, mid.height, 'cover');
      src.draw(m, c.x, c.y, c.width, c.height);
      t.drawImage(mid, 0, 0, tiny.width, tiny.height);
      m.drawImage(tiny, 0, 0, mid.width, mid.height);
      ctx.drawImage(mid, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    } else {
      ctx.fillStyle = backdrop.color;
    }
    ctx.fillRect(0, 0, W, H);
    const r = fitRect(sw, sh, W, H, 'contain');
    src.draw(ctx, r.x, r.y, r.width, r.height);
  };
}
