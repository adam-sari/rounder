export type Background =
  | { kind: 'preset'; id: string }
  | { kind: 'solid'; color: string }
  | { kind: 'custom'; from: string; to: string; angle: number }
  | { kind: 'none' };

export type Frame = 'none' | 'mac' | 'browser';
export type Shadow = 'none' | 'soft' | 'strong';
export type Aspect = 'auto' | '1:1' | '4:5' | '16:9' | '9:16';

export interface Settings {
  background: Background;
  /** design units: scaled with the screenshot so the look is the same at any size */
  padding: number;
  radius: number;
  shadow: Shadow;
  border: boolean;
  frame: Frame;
  theme: 'light' | 'dark';
  url: string;
  aspect: Aspect;
  caption: string;
}

export interface Gradient {
  angle: number;
  stops: string[];
}

export const presets: { id: string; name: string; gradient: Gradient }[] = [
  { id: 'sunrise', name: 'Sunrise', gradient: { angle: 135, stops: ['#ffd25e', '#ff8a5c', '#ff6b8b'] } },
  { id: 'peach', name: 'Peach', gradient: { angle: 135, stops: ['#ffecd2', '#fcb69f'] } },
  { id: 'lagoon', name: 'Lagoon', gradient: { angle: 135, stops: ['#5fe0d0', '#3b82f6'] } },
  { id: 'dusk', name: 'Dusk', gradient: { angle: 150, stops: ['#c8a6ff', '#8b5cf6', '#4c1d95'] } },
  { id: 'candy', name: 'Candy', gradient: { angle: 120, stops: ['#ff8fb8', '#a78bfa', '#8fa2ff'] } },
  { id: 'mint', name: 'Mint', gradient: { angle: 135, stops: ['#d4fc79', '#96e6a1'] } },
  { id: 'ocean', name: 'Ocean', gradient: { angle: 160, stops: ['#7cc4ff', '#2563eb', '#1e1b4b'] } },
  { id: 'ember', name: 'Ember', gradient: { angle: 135, stops: ['#fb923c', '#e11d48', '#4c0519'] } },
  { id: 'forest', name: 'Forest', gradient: { angle: 160, stops: ['#9be58f', '#15803d', '#052e16'] } },
  { id: 'paper', name: 'Paper', gradient: { angle: 180, stops: ['#f7f3ec', '#ded5c6'] } },
  { id: 'graphite', name: 'Graphite', gradient: { angle: 160, stops: ['#4b5563', '#1f2937', '#0b0f14'] } },
  { id: 'night', name: 'Night', gradient: { angle: 145, stops: ['#1e293b', '#312e81', '#131211'] } },
];

export const solids = ['#ffffff', '#f2ede4', '#ffd25e', '#7cc4ff', '#ff8fb8', '#9be58f', '#22211e', '#000000'];

/** the background as a gradient (a solid is a one-stop gradient), or null when transparent */
export function backgroundGradient(bg: Background): Gradient | null {
  switch (bg.kind) {
    case 'preset': return (presets.find((p) => p.id === bg.id) ?? presets[0]).gradient;
    case 'solid': return { angle: 0, stops: [bg.color] };
    case 'custom': return { angle: bg.angle, stops: [bg.from, bg.to] };
    case 'none': return null;
  }
}

export const cssGradient = (g: Gradient) => (g.stops.length === 1 ? g.stops[0] : `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`);

/** start and end points of a CSS-style linear-gradient(angle) line across a w × h box */
export function gradientLine(w: number, h: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return { x0: w / 2 - dx * half, y0: h / 2 - dy * half, x1: w / 2 + dx * half, y1: h / 2 + dy * half };
}

/** WCAG relative luminance of a #rrggbb color, 0–1 */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** caption color that reads on the background; transparent output usually lands on white pages */
export function captionColor(g: Gradient | null) {
  if (!g) return '#1c1b19';
  const avg = g.stops.reduce((sum, c) => sum + luminance(c), 0) / g.stops.length;
  return avg > 0.35 ? '#1c1b19' : '#ffffff';
}

export const aspectRatio: Record<Exclude<Aspect, 'auto'>, number> = { '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '9:16': 9 / 16 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  /** design units → layout px */
  k: number;
  /** the window: bar + screenshot */
  frame: Box;
  bar: number;
  shot: Box;
  radius: number;
  caption?: { x: number; y: number; size: number; maxWidth: number };
}

/** the screenshot's longest side in layout px; bigger images are drawn smaller (export is 2× this) */
export const BASE_SIDE = 1440;

export function computeLayout(imgW: number, imgH: number, s: Settings): Layout {
  const fit = Math.min(1, BASE_SIDE / Math.max(imgW, imgH));
  const w = imgW * fit;
  const h = imgH * fit;
  // chrome, padding and type scale with the screenshot, within limits so tiny or huge shots still look right
  const k = Math.min(1.2, Math.max(0.4, Math.max(w, h) / 1200));

  const bar = s.frame === 'mac' ? 36 * k : s.frame === 'browser' ? 50 * k : 0;
  const pad = s.padding * k;
  const text = s.caption.trim();
  const size = 28 * k;
  const captionH = text ? 30 * k + size * 1.3 : 0;
  const contentW = w;
  const contentH = h + bar + captionH;

  let width = contentW + 2 * pad;
  let height = contentH + 2 * pad;
  if (s.aspect !== 'auto') {
    const r = aspectRatio[s.aspect];
    if (width / height > r) height = width / r;
    else width = height * r;
  }

  const frame = { x: (width - w) / 2, y: (height - contentH) / 2, w, h: h + bar };
  return {
    width: Math.round(width),
    height: Math.round(height),
    k,
    frame,
    bar,
    shot: { x: frame.x, y: frame.y + bar, w, h },
    radius: Math.min(s.radius * k, frame.w / 2, frame.h / 2),
    caption: text ? { x: width / 2, y: frame.y + frame.h + 30 * k + (size * 1.3) / 2, size, maxWidth: width - 2 * Math.max(pad, 16 * k) } : undefined,
  };
}

/** iOS Safari refuses canvases above 16.7 megapixels */
export const MAX_PIXELS = 16_777_216;

export function exportScale(width: number, height: number, want: number) {
  return Math.min(want, Math.sqrt(MAX_PIXELS / (width * height)));
}

/** "Screen Shot 2024.png" → "Screen Shot 2024-beautified.png"; clipboard pastes arrive as "image.png" */
export function outputName(fileName: string, ext: string) {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${!base || /^image$/i.test(base) ? 'screenshot' : base}-beautified.${ext}`;
}
