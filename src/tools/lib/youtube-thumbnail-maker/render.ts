import { drawBlurred, free, surface } from '@/tools/lib/social-media-image-resizer/canvas';
import { focalCrop } from '@/tools/lib/social-media-image-resizer/sizes';
import { fontCss } from './fonts';
import { alphaBounds } from './pixels';
import { H, W, gradientLine, type Background, type ImageLayer, type Layer, type Shadow, type ShapeLayer, type TextLayer } from './scene';
import { shapes, type ShapeId } from './shapes';
import type { TextLayout } from './text';

type Ctx = CanvasRenderingContext2D;
export type Source = CanvasImageSource & { width: number; height: number };

export function paintBackground(ctx: Ctx, bg: Background, photo: Source | null) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (bg.kind === 'photo' && photo) {
    drawBlurred(ctx, photo, focalCrop(photo.width, photo.height, W, H, bg.focus, bg.zoom), W, H, bg.blur);
  } else if (bg.kind === 'gradient') {
    const g = ctx.createLinearGradient(...gradientLine(bg.angle, W, H));
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = bg.kind === 'photo' ? '#1f1e1b' : bg.color;
    ctx.fillRect(0, 0, W, H);
  }
  if (bg.darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bg.darken})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** shadows scale with the layer; text size is the reference, pictures count as a third of their width */
function shadowOn(ctx: Ctx, shadow: Shadow, base: number) {
  if (shadow === 'hard') {
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(3, base * 0.055);
    ctx.shadowBlur = 0;
  } else if (shadow === 'soft') {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = base * 0.04;
    ctx.shadowBlur = Math.max(8, base * 0.25);
  }
}

function shadowOff(ctx: Ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
}

function paintText(ctx: Ctx, l: TextLayer, layout: TextLayout) {
  ctx.font = fontCss(l.font, l.size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  // only the first pass casts a shadow, so outlines and fills don't double it up
  let shadowPending = l.shadow !== 'none';
  const firstPass = () => {
    if (shadowPending) shadowOn(ctx, l.shadow, l.size);
    shadowPending = false;
  };

  if (layout.pills.length) {
    firstPass();
    ctx.fillStyle = l.highlightColor;
    for (const p of layout.pills) {
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.width, p.height, layout.radius);
      ctx.fill();
    }
    shadowOff(ctx);
  }
  if (l.outline > 0) {
    firstPass();
    ctx.lineWidth = l.outline * l.size * 2;
    ctx.strokeStyle = l.outlineColor;
    for (const line of layout.lines) for (const r of line.runs) ctx.strokeText(r.text, r.x, line.baseline);
    shadowOff(ctx);
  }
  firstPass();
  for (const line of layout.lines) {
    for (const r of line.runs) {
      ctx.fillStyle = r.mark ? l.accent : l.color;
      ctx.fillText(r.text, r.x, line.baseline);
    }
  }
  shadowOff(ctx);
}

/** a few bordered copies per image, so duplicated stickers at different sizes don't rebuild every frame */
const outlineCache = new WeakMap<Source, Map<string, HTMLCanvasElement>>();
const OUTLINE_KEEP = 4;

/** The image with a solid sticker border following its transparent edges */
function outlined(src: Source, w: number, h: number, t: number, color: string) {
  const key = `${Math.round(w)}|${Math.round(t)}|${color}`;
  let cache = outlineCache.get(src);
  if (!cache) outlineCache.set(src, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= OUTLINE_KEEP) {
    const [oldest, old] = cache.entries().next().value!;
    free(old);
    cache.delete(oldest);
  }
  const [canvas, ctx] = surface(w + t * 2, h + t * 2);
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.drawImage(src, t + Math.cos(a) * t, t + Math.sin(a) * t, w, h);
  }
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, t, t, w, h);
  cache.set(key, canvas);
  return canvas;
}

function paintImage(ctx: Ctx, l: ImageLayer, src: Source) {
  const w = l.size;
  const h = w * l.aspect;
  const t = l.outline * w;
  shadowOn(ctx, l.shadow, w / 3);
  ctx.imageSmoothingQuality = 'high';
  if (t >= 1) ctx.drawImage(outlined(src, w, h, t, l.outlineColor), -w / 2 - t, -h / 2 - t);
  else ctx.drawImage(src, -w / 2, -h / 2, w, h);
  shadowOff(ctx);
}

const paths = new Map<ShapeId, Path2D>();

function paintShape(ctx: Ctx, l: ShapeLayer) {
  const shape = shapes[l.shape];
  let path = paths.get(l.shape);
  if (!path) paths.set(l.shape, (path = new Path2D(shape.d)));
  const s = l.size / shape.w;
  ctx.translate((-shape.w * s) / 2, (-shape.h * s) / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  shadowOn(ctx, l.shadow, l.size / 3);
  if (l.outline > 0) {
    ctx.lineWidth = (l.outline * l.size * 2) / s;
    ctx.strokeStyle = l.outlineColor;
    ctx.stroke(path);
    shadowOff(ctx);
  }
  ctx.fillStyle = l.color;
  ctx.fill(path);
  shadowOff(ctx);
}

/** Paints the finished thumbnail at 1280 × 720 */
export function paintScene(ctx: Ctx, background: CanvasImageSource, layers: Layer[], layouts: Map<number, TextLayout>, sources: Map<number, Source>) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(background, 0, 0, W, H);
  for (const l of layers) {
    ctx.save();
    ctx.translate(l.x, l.y);
    if (l.rot) ctx.rotate((l.rot * Math.PI) / 180);
    if (l.kind === 'text') {
      const layout = layouts.get(l.id);
      if (layout) paintText(ctx, l, layout);
    } else if (l.kind === 'image') {
      const src = sources.get(l.src);
      if (src) paintImage(ctx, l, src);
    } else paintShape(ctx, l);
    ctx.restore();
  }
}

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** Draws an emoji with the device's emoji font and trims it, so it can be used like a sticker image */
export function rasterEmoji(emoji: string): HTMLCanvasElement | null {
  const S = 640;
  const font = `480px ${EMOJI_FONT}`;
  const big = document.createElement('canvas');
  const ctx = big.getContext('2d', { willReadFrequently: true })!;
  ctx.font = font;
  // a pasted row of emoji is wider than one, so make room instead of clipping it
  const width = Math.min(4096, Math.max(S, Math.ceil(ctx.measureText(emoji).width) + 160));
  Object.assign(big, { width, height: S });
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, width / 2, S / 2);
  const box = alphaBounds(ctx.getImageData(0, 0, width, S).data, width, S);
  if (!box) {
    free(big);
    return null;
  }
  const [out, octx] = surface(box.width, box.height);
  octx.drawImage(big, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  free(big);
  return out;
}
