import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { backgroundBlurPx, coverRect, edgeRamp, featherPx, MASK_PAD, maskSize, smoothMask, writeAlpha } from './matte';

export type BgMode = 'blur' | 'color' | 'image' | 'transparent';

export interface BgSettings {
  mode: BgMode;
  color: string;
  /** used when mode is 'image'; falls back to the color while none is picked */
  image: ImageBitmap | null;
  /** 0–1 */
  blur: number;
  /** 0–1: softer, wider edges */
  feather: number;
  /** 0–1: temporal smoothing of the mask, against flicker */
  smoothing: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** draws the current video frame into ctx at (x, y, w, h) */
export type DrawFrame = (ctx: Ctx, x: number, y: number, w: number, h: number) => void;

function surface(): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(1, 1);
  return [canvas, canvas.getContext('2d')!];
}

function resize(canvas: OffscreenCanvas, w: number, h: number): boolean {
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

// Safari before 18 has no canvas filters: blur then falls back to scaling down and back up
const hasFilter = (ctx: Ctx) => typeof ctx.filter === 'string';

/**
 * Cuts the person out of each frame and puts them on a new background. Keep one per video:
 * it carries the smoothed mask from frame to frame (reset() after a seek).
 */
export class Compositor {
  private readonly seg = surface();
  private readonly mask = surface();
  private readonly person = surface();
  private readonly small = surface();
  private acc: Float32Array | null = null;
  private pixels: ImageData | null = null;
  private ramp = edgeRamp(0);
  private rampFor = 0;

  constructor(private readonly segmenter: ImageSegmenter) {}

  /** forgets the previous frames' mask, so a jump in time doesn't blend two scenes */
  reset() {
    this.acc = null;
  }

  render(ctx: Ctx, draw: DrawFrame, W: number, H: number, s: BgSettings) {
    this.updateMask(draw, W, H, s);

    // the person: the frame, kept only where the (feathered) mask is
    const [pc, p] = this.person;
    resize(pc, W, H);
    p.globalCompositeOperation = 'copy';
    draw(p, 0, 0, W, H);
    p.globalCompositeOperation = 'destination-in';
    const blur = featherPx(s.feather, W, H);
    if (blur >= 0.5 && hasFilter(p)) p.filter = `blur(${blur.toFixed(1)}px)`;
    p.imageSmoothingQuality = 'high';
    const [mc] = this.mask;
    const sx = W / (mc.width - 2 * MASK_PAD);
    const sy = H / (mc.height - 2 * MASK_PAD);
    p.drawImage(mc, -MASK_PAD * sx, -MASK_PAD * sy, mc.width * sx, mc.height * sy);
    p.filter = 'none';
    p.globalCompositeOperation = 'source-over';

    this.background(ctx, draw, W, H, s);
    ctx.drawImage(pc, 0, 0);
  }

  private updateMask(draw: DrawFrame, W: number, H: number, s: BgSettings) {
    const { width: w, height: h } = maskSize(W, H);
    const [sc, sctx] = this.seg;
    const [mc, mctx] = this.mask;
    if (resize(sc, w, h) || !this.pixels) {
      resize(mc, w + 2 * MASK_PAD, h + 2 * MASK_PAD);
      this.pixels = new ImageData(mc.width, mc.height);
      this.pixels.data.fill(255);
      this.acc = null;
    }
    sctx.imageSmoothingQuality = 'high';
    draw(sctx, 0, 0, w, h);
    this.segmenter.segment(sc, (result) => {
      // one mask (person) or two (background, person): the person is always last
      const masks = result.confidenceMasks;
      const next = masks?.[masks.length - 1]?.getAsFloat32Array();
      if (!next || next.length !== w * h) return;
      if (this.acc) smoothMask(this.acc, next, s.smoothing);
      else this.acc = next.slice();
    });
    if (!this.acc) return;
    if (this.rampFor !== s.feather) {
      this.ramp = edgeRamp(s.feather);
      this.rampFor = s.feather;
    }
    writeAlpha(this.acc, w, h, this.ramp, this.pixels.data);
    mctx.putImageData(this.pixels, 0, 0);
  }

  private background(ctx: Ctx, draw: DrawFrame, W: number, H: number, s: BgSettings) {
    const mode = s.mode === 'image' && !s.image ? 'color' : s.mode;
    if (mode === 'transparent') {
      ctx.clearRect(0, 0, W, H);
    } else if (mode === 'color') {
      ctx.fillStyle = s.color;
      ctx.fillRect(0, 0, W, H);
    } else if (mode === 'image') {
      const img = s.image!;
      const r = coverRect(img.width, img.height, W, H);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, r.x, r.y, r.width, r.height);
    } else {
      const px = backgroundBlurPx(s.blur, W, H);
      if (hasFilter(ctx)) {
        // drawn a little larger, so the blur doesn't pull dark edges in from outside the frame
        const m = px * 2;
        ctx.filter = `blur(${px.toFixed(1)}px)`;
        draw(ctx, -m, -m, W + 2 * m, H + 2 * m);
        ctx.filter = 'none';
      } else {
        const [tc, t] = this.small;
        const f = Math.max(2, px / 2);
        resize(tc, Math.max(1, Math.round(W / f)), Math.max(1, Math.round(H / f)));
        draw(t, 0, 0, tc.width, tc.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tc, 0, 0, W, H);
      }
    }
  }
}
