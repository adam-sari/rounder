/**
 * Draws audiogram frames. Everything scales from the frame's short side, so the small live
 * preview and the 1080p export are the same picture. `layout` measures text once; the static
 * layer (background, cover, titles) is drawn once and reused, `drawFrame` adds the moving parts.
 */
import { wrapLines } from '../subtitles/layout';
import { clock, inkFor, withAlpha, type Backdrop, type VisualStyle } from './design';
import { frameBands, frameLevel, type Spectrum } from './spectrum';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Img = CanvasImageSource & { width: number; height: number };

export interface Design {
  style: VisualStyle;
  backdrop: Backdrop;
  bg1: string;
  bg2: string;
  image: Img | null;
  /** 0–1 */
  blur: number;
  /** 0–1 */
  darken: number;
  accent: string;
  title: string;
  subtitle: string;
  cover: Img | null;
  progress: boolean;
  /** reserve room for caption lines */
  captions: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Block {
  h: number;
  place: (b: Box) => void;
}

interface TextBlock {
  lines: string[];
  font: string;
  size: number;
  box: Box;
}

export interface Scene {
  W: number;
  H: number;
  u: number;
  d: Design;
  ink: string;
  align: 'center' | 'left';
  /** square cover art (not used by the circle style, which puts it inside the ring) */
  cover: Box | null;
  title: TextBlock | null;
  subtitle: TextBlock | null;
  visual: Box;
  progress: Box | null;
  caption: Box | null;
  bars: Float32Array;
  captionCache: Map<string, { lines: string[]; size: number }>;
}

export const SERIF = '"Instrument Serif", Georgia, serif';
export const SANS = '"Geist Variable", system-ui, sans-serif';

const BAR_COUNT: Record<VisualStyle, number> = { bars: 48, wave: 40, line: 64, circle: 48 };

/** wraps to at most `max` lines, ending the last with an ellipsis when text is cut */
function wrap(ctx: Ctx, text: string, font: string, width: number, max: number): string[] {
  ctx.font = font;
  const measure = (s: string) => ctx.measureText(s).width;
  const lines = wrapLines(text, width, measure);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** shrinks the title until it fits two lines (down to 60% of the starting size) */
function fitTitle(ctx: Ctx, text: string, start: number, width: number): { lines: string[]; size: number; font: string } {
  let size = start;
  for (;;) {
    const font = `400 ${size}px ${SERIF}`;
    ctx.font = font;
    const n = wrapLines(text, width, (s) => ctx.measureText(s).width).length;
    if (n <= 2 || size <= start * 0.6) return { lines: wrap(ctx, text, font, width, 2), size, font };
    size *= 0.9;
  }
}

export function layout(ctx: Ctx, W: number, H: number, d: Design): Scene {
  const u = Math.min(W, H);
  const pad = u * 0.075;
  const gap = u * 0.045;
  const landscape = W / H > 1.2;
  const circle = d.style === 'circle';
  const side = landscape && (!!d.cover || circle);
  const ink = d.backdrop === 'image' && d.image ? '#ffffff' : inkFor(d.bg1, d.backdrop === 'gradient' ? d.bg2 : d.bg1);
  const progressH = d.progress ? u * 0.055 : 0;
  const captionH = d.captions ? u * 0.17 : 0;
  const titleText = d.title.trim();
  const subText = d.subtitle.trim();

  const text = (colW: number, titleSize: number) => {
    const t = titleText ? fitTitle(ctx, titleText, titleSize, colW) : null;
    const subSize = u * 0.04;
    const subFont = `500 ${subSize}px ${SANS}`;
    const s = subText ? wrap(ctx, subText, subFont, colW, 2) : null;
    return {
      title: t && { lines: t.lines, font: t.font, size: t.size, box: { x: 0, y: 0, w: colW, h: t.lines.length * t.size * 1.08 } },
      subtitle: s && { lines: s, font: subFont, size: subSize, box: { x: 0, y: 0, w: colW, h: s.length * subSize * 1.35 } },
    };
  };

  /** stacks blocks top to bottom, centred in the column as a group */
  const stack = (x: number, colW: number, top: number, bottom: number, list: (Block | null)[]) => {
    const blocks = list.filter((b): b is Block => !!b);
    const total = blocks.reduce((s, b) => s + b.h, 0) + gap * (blocks.length - 1);
    let y = top + Math.max(0, (bottom - top - total) / 2);
    for (const b of blocks) {
      b.place({ x, y, w: colW, h: b.h });
      y += b.h + gap;
    }
  };

  const scene: Scene = {
    W, H, u, d, ink,
    align: side ? 'left' : 'center',
    cover: null,
    title: null,
    subtitle: null,
    visual: { x: 0, y: 0, w: 0, h: 0 },
    progress: null,
    caption: null,
    bars: new Float32Array(BAR_COUNT[d.style]),
    captionCache: new Map(),
  };
  const place = (key: 'title' | 'subtitle', block: TextBlock | null): Block | null =>
    block && { h: block.box.h, place: (b) => (scene[key] = { ...block, box: b }) };

  if (side) {
    const L = Math.min(H - 2 * pad, W * 0.4);
    const left: Box = { x: pad, y: (H - L) / 2, w: L, h: L };
    if (circle) scene.visual = left;
    else scene.cover = left;
    const x = pad + L + gap * 1.6;
    const colW = W - x - pad;
    const { title, subtitle } = text(colW, u * 0.095);
    const blocks: (Block | null)[] = [place('title', title), place('subtitle', subtitle)];
    if (d.progress) blocks.push({ h: progressH, place: (b) => (scene.progress = b) });
    if (d.captions) blocks.push({ h: captionH, place: (b) => (scene.caption = b) });
    if (!circle) {
      // the visualizer takes what the text leaves, up to a fifth of the height
      const used = blocks.reduce((sum, b) => sum + (b ? b.h + gap : 0), 0);
      blocks.splice(2, 0, { h: Math.max(H * 0.1, Math.min(H * 0.22, H - 2 * pad - used)), place: (b) => (scene.visual = b) });
    }
    stack(x, colW, pad, H - pad, blocks);
    return scene;
  }

  const colW = W - 2 * pad;
  const { title, subtitle } = text(colW, u * (landscape ? 0.08 : 0.085));
  const fixed = (title?.box.h ?? 0) + (subtitle?.box.h ?? 0) + progressH + captionH;
  const count = [!!d.cover && !circle, !!title, !!subtitle, true, d.progress, d.captions].filter(Boolean).length;
  // what's left for the picture parts once text and gaps are in
  const room = H - 2 * pad - fixed - gap * (count - 1);
  let coverS = d.cover && !circle ? Math.min(colW * 0.62, H * 0.32) : 0;
  let visualH = circle ? Math.min(colW * 0.8, H * 0.42) : landscape ? H * 0.26 : Math.min(H * 0.2, colW * 0.45);
  const want = coverS + visualH;
  if (want > room) {
    const k = Math.max(0.45, room / want);
    coverS *= k;
    visualH *= k;
  }
  stack(pad, colW, pad, H - pad, [
    coverS ? { h: coverS, place: (b: Box) => (scene.cover = { x: b.x + (b.w - coverS) / 2, y: b.y, w: coverS, h: coverS }) } : null,
    place('title', title),
    place('subtitle', subtitle),
    { h: visualH, place: (b: Box) => (scene.visual = circle ? { x: b.x + (b.w - visualH) / 2, y: b.y, w: visualH, h: visualH } : b) },
    d.progress ? { h: progressH, place: (b: Box) => (scene.progress = b) } : null,
    d.captions ? { h: captionH, place: (b: Box) => (scene.caption = b) } : null,
  ]);
  return scene;
}

// ---------------------------------------------------------------- static layer

function drawCover(ctx: Ctx, img: Img, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

function roundRect(ctx: Ctx, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

function drawBackground(ctx: Ctx, s: Scene) {
  const { W, H, u, d } = s;
  ctx.fillStyle = d.bg1;
  ctx.fillRect(0, 0, W, H);
  if (d.backdrop === 'image' && d.image) {
    const px = Math.round(d.blur * u * 0.05);
    if (px > 0 && typeof (ctx as { filter?: unknown }).filter === 'string') {
      ctx.filter = `blur(${px}px)`;
      // overscan, so the blur doesn't pull dark edges in
      const o = px * 2;
      drawCover(ctx, d.image, -o, -o, W + 2 * o, H + 2 * o);
      ctx.filter = 'none';
    } else if (px > 0) {
      // no canvas filters (older Safari): a tiny copy stretched back up reads as a blur
      const k = Math.max(4, px * 1.5);
      const small = new OffscreenCanvas(Math.max(1, Math.round(W / k)), Math.max(1, Math.round(H / k)));
      drawCover(small.getContext('2d')!, d.image, 0, 0, small.width, small.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
    } else {
      drawCover(ctx, d.image, 0, 0, W, H);
    }
    ctx.fillStyle = `rgba(0, 0, 0, ${d.darken})`;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (d.backdrop === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, d.bg1);
    g.addColorStop(1, d.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // a soft pool of the accent color behind the visualizer
  const v = s.visual;
  const glow = ctx.createRadialGradient(v.x + v.w / 2, v.y + v.h / 2, 0, v.x + v.w / 2, v.y + v.h / 2, Math.max(v.w, v.h) * 0.75);
  glow.addColorStop(0, withAlpha(d.accent, 0.13));
  glow.addColorStop(1, withAlpha(d.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawText(ctx: Ctx, s: Scene, t: TextBlock, color: string, lineHeight: number) {
  ctx.font = t.font;
  ctx.fillStyle = color;
  ctx.textAlign = s.align;
  ctx.textBaseline = 'top';
  const x = s.align === 'center' ? t.box.x + t.box.w / 2 : t.box.x;
  t.lines.forEach((line, i) => ctx.fillText(line, x, t.box.y + i * t.size * lineHeight));
}

/** background, cover art, title and subtitle: everything that doesn't move */
export function drawStatic(ctx: Ctx, s: Scene) {
  ctx.save();
  drawBackground(ctx, s);
  const { u, d } = s;
  if (s.cover && d.cover) {
    const r = s.cover.w * 0.05;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = u * 0.04;
    ctx.shadowOffsetY = u * 0.012;
    ctx.fillStyle = '#000';
    roundRect(ctx, s.cover, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, s.cover, r);
    ctx.clip();
    drawCover(ctx, d.cover, s.cover.x, s.cover.y, s.cover.w, s.cover.h);
    ctx.restore();
  }
  if (s.title) drawText(ctx, s, s.title, s.ink, 1.08);
  if (s.subtitle) drawText(ctx, s, s.subtitle, withAlpha(s.ink, 0.72), 1.35);
  if (s.progress) {
    const p = s.progress;
    ctx.fillStyle = withAlpha(s.ink, 0.18);
    roundRect(ctx, { x: p.x, y: p.y, w: p.w, h: u * 0.008 }, u * 0.004);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- moving parts

/** a smooth path through points, using midpoints as quadratic anchors */
function smooth(ctx: Ctx, xs: number[], ys: number[], move: boolean) {
  if (move) ctx.moveTo(xs[0], ys[0]);
  else ctx.lineTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length - 1; i++) ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  ctx.lineTo(xs[xs.length - 1], ys[ys.length - 1]);
}

function drawBars(ctx: Ctx, s: Scene, v: Float32Array) {
  const b = s.visual;
  const n = v.length;
  const step = b.w / n;
  const bw = step * 0.62;
  ctx.fillStyle = s.d.accent;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const h = Math.max(bw, v[i] * b.h);
    ctx.roundRect(b.x + i * step + (step - bw) / 2, b.y + b.h - h, bw, h, bw / 2);
  }
  ctx.fill();
}

function drawWave(ctx: Ctx, s: Scene, v: Float32Array) {
  const b = s.visual;
  const n = v.length;
  // bass in the middle, mirrored out to both edges
  const vals = [...Array.from(v).reverse(), ...v];
  const xs = vals.map((_, i) => b.x + (i / (vals.length - 1)) * b.w);
  const mid = b.y + b.h / 2;
  const amp = (x: number, i: number) => {
    const edge = Math.min(i, vals.length - 1 - i) / n;
    // taper to the centre line at the ends
    return (b.h / 2) * (0.02 + 0.98 * x) * Math.min(1, edge * 4);
  };
  const top = vals.map((x, i) => mid - amp(x, i));
  const bottom = vals.map((x, i) => mid + amp(x, i));
  ctx.fillStyle = s.d.accent;
  ctx.beginPath();
  smooth(ctx, xs, top, true);
  smooth(ctx, [...xs].reverse(), [...bottom].reverse(), false);
  ctx.closePath();
  ctx.fill();
}

function drawLine(ctx: Ctx, s: Scene, v: Float32Array) {
  const b = s.visual;
  const base = b.y + b.h * 0.92;
  const xs = Array.from(v, (_, i) => b.x + (i / (v.length - 1)) * b.w);
  const ys = Array.from(v, (x) => base - x * b.h * 0.86);
  const g = ctx.createLinearGradient(0, b.y, 0, base);
  g.addColorStop(0, withAlpha(s.d.accent, 0.32));
  g.addColorStop(1, withAlpha(s.d.accent, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  smooth(ctx, xs, ys, true);
  ctx.lineTo(b.x + b.w, base);
  ctx.lineTo(b.x, base);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = s.d.accent;
  ctx.lineWidth = s.u * 0.008;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  smooth(ctx, xs, ys, true);
  ctx.stroke();
}

function drawCircle(ctx: Ctx, s: Scene, v: Float32Array, level: number) {
  const b = s.visual;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const R = b.w / 2;
  const r0 = R * 0.62;
  const n = v.length;
  const spokes = n * 2;
  ctx.strokeStyle = s.d.accent;
  ctx.lineCap = 'round';
  ctx.lineWidth = ((2 * Math.PI * r0) / spokes) * 0.5;
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) {
    // mirrored left/right, bass at the top
    const val = v[i < n ? i : spokes - 1 - i];
    const a = -Math.PI / 2 + ((i + 0.5) / spokes) * Math.PI * 2;
    const len = R * 0.04 + val * (R - r0 - R * 0.06);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    ctx.moveTo(cx + c * (r0 + R * 0.04), cy + sn * (r0 + R * 0.04));
    ctx.lineTo(cx + c * (r0 + R * 0.04 + len), cy + sn * (r0 + R * 0.04 + len));
  }
  ctx.stroke();
  const rc = r0 * (1 + 0.03 * level);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rc, 0, Math.PI * 2);
  if (s.d.cover) {
    ctx.clip();
    drawCover(ctx, s.d.cover, cx - rc, cy - rc, rc * 2, rc * 2);
  } else {
    ctx.fillStyle = withAlpha(s.d.accent, 0.14 + 0.1 * level);
    ctx.fill();
    ctx.lineWidth = s.u * 0.004;
    ctx.strokeStyle = withAlpha(s.d.accent, 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProgress(ctx: Ctx, s: Scene, t: number, duration: number) {
  const p = s.progress!;
  const { u } = s;
  const k = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
  const th = u * 0.008;
  ctx.fillStyle = s.d.accent;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, Math.max(th, p.w * k), th, th / 2);
  ctx.arc(p.x + p.w * k, p.y + th / 2, u * 0.013, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `500 ${u * 0.026}px ${SANS}`;
  ctx.fillStyle = withAlpha(s.ink, 0.66);
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(clock(t), p.x, p.y + p.h);
  ctx.textAlign = 'right';
  ctx.fillText(clock(duration), p.x + p.w, p.y + p.h);
}

function drawCaption(ctx: Ctx, s: Scene, text: string) {
  const area = s.caption!;
  const { u } = s;
  let fit = s.captionCache.get(text);
  if (!fit) {
    // two lines at full size, or three a little smaller
    const maxW = area.w * 0.9;
    let size = u * 0.046;
    let lines = wrap(ctx, text, `600 ${size}px ${SANS}`, maxW, 3);
    if (lines.length > 2) {
      size *= 0.8;
      lines = wrap(ctx, text, `600 ${size}px ${SANS}`, maxW, 3);
    }
    fit = { lines, size };
    s.captionCache.set(text, fit);
  }
  const { lines, size } = fit;
  ctx.font = `600 ${size}px ${SANS}`;
  const lh = size * 1.3;
  const padX = size * 0.6;
  const padY = size * 0.35;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const h = lines.length * lh + padY * 2;
  const x = s.align === 'center' ? area.x + (area.w - w) / 2 : area.x;
  const y = area.y + (area.h - h) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, size * 0.4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + padY + lh * (i + 0.5)));
}

export interface FrameState {
  /** seconds from the start of the clip */
  time: number;
  duration: number;
  spectrum: Spectrum | null;
  /** where to read the spectrum when it was analysed from a different start (defaults to time) */
  spectrumTime?: number;
  caption: string;
}

/** visualizer, progress and caption on top of the static layer */
export function drawFrame(ctx: Ctx, s: Scene, f: FrameState) {
  const at = f.spectrumTime ?? f.time;
  const v = frameBands(f.spectrum, at, s.bars.length, s.bars);
  ctx.save();
  if (s.d.style === 'bars') drawBars(ctx, s, v);
  else if (s.d.style === 'wave') drawWave(ctx, s, v);
  else if (s.d.style === 'line') drawLine(ctx, s, v);
  else drawCircle(ctx, s, v, frameLevel(f.spectrum, at));
  if (s.progress) drawProgress(ctx, s, f.time, f.duration);
  if (s.caption && f.caption) drawCaption(ctx, s, f.caption);
  ctx.restore();
}
