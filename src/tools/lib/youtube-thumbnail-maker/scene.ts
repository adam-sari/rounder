import type { Focus } from '@/tools/lib/social-media-image-resizer/sizes';
import type { FontId } from './fonts';
import { shapes, type ShapeId } from './shapes';
import type { Align, Highlight } from './text';

export const W = 1280;
export const H = 720;

export type Shadow = 'none' | 'soft' | 'hard';

interface Base {
  id: number;
  /** center, in canvas px */
  x: number;
  y: number;
  /** text: font size; image and shape: width (px) */
  size: number;
  /** degrees clockwise */
  rot: number;
  shadow: Shadow;
  /** outline thickness as a share of the size */
  outline: number;
  outlineColor: string;
}

export interface TextLayer extends Base {
  kind: 'text';
  text: string;
  font: FontId;
  color: string;
  /** color for *marked* words */
  accent: string;
  highlight: Highlight;
  highlightColor: string;
  upper: boolean;
  align: Align;
}

export interface ImageLayer extends Base {
  kind: 'image';
  /** key of the decoded image or emoji in the editor's source map */
  src: number;
  name: string;
  /** height / width */
  aspect: number;
}

export interface ShapeLayer extends Base {
  kind: 'shape';
  shape: ShapeId;
  color: string;
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;

export interface Background {
  kind: 'photo' | 'color' | 'gradient';
  color: string;
  from: string;
  to: string;
  /** css-style angle: 0 points up, 90 points right */
  angle: number;
  zoom: number;
  focus: Focus;
  /** blur radius in px */
  blur: number;
  /** 0–1 black overlay */
  darken: number;
}

export const sizeLimits: Record<Layer['kind'], [number, number]> = {
  text: [20, 420],
  image: [40, 2400],
  shape: [30, 1600],
};

/** outline slider range per kind (a share of the size) */
export const outlineMax: Record<Layer['kind'], number> = { text: 0.16, image: 0.06, shape: 0.08 };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Width and height of a non-text layer's box */
export function boxOf(layer: ImageLayer | ShapeLayer) {
  const w = layer.size;
  const h = layer.kind === 'image' ? w * layer.aspect : (w * shapes[layer.shape].h) / shapes[layer.shape].w;
  const pad = layer.outline * w;
  return { width: w + pad * 2, height: h + pad * 2 };
}

/** Start and end of a linear gradient that covers the whole w × h frame at a css angle */
export function gradientLine(angle: number, w: number, h: number) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half] as const;
}

/** distance (canvas px) within which a dragged layer snaps to the center lines */
export const SNAP = 10;

/** Snaps a dragged center to the middle of the canvas when close */
export function snapCenter(x: number, y: number) {
  const sx = Math.abs(x - W / 2) < SNAP;
  const sy = Math.abs(y - H / 2) < SNAP;
  return { x: sx ? W / 2 : x, y: sy ? H / 2 : y, sx, sy };
}

/** New size when a resize handle is dragged: scales with the pointer's distance from the center */
export function resized(size: number, kind: Layer['kind'], startDist: number, dist: number) {
  const [lo, hi] = sizeLimits[kind];
  return clamp(Math.round(size * (dist / Math.max(1, startDist))), lo, hi);
}

export const defaultBackground: Background = {
  kind: 'gradient',
  color: '#151515',
  from: '#ff512f',
  to: '#2a0845',
  angle: 135,
  zoom: 1,
  focus: { x: 0.5, y: 0.5 },
  blur: 0,
  darken: 0,
};

export function newText(id: number, over: Partial<TextLayer> = {}): TextLayer {
  return {
    id, kind: 'text', x: W / 2, y: H / 2, size: 128, rot: 0, shadow: 'hard', outline: 0.07, outlineColor: '#000000',
    text: 'This changed\n*everything*', font: 'anton', color: '#ffffff', accent: '#ffd25e', highlight: 'none', highlightColor: '#ff3b30',
    upper: true, align: 'center', ...over,
  };
}

export function newShape(id: number, shape: ShapeId): ShapeLayer {
  const size = shape === 'ring' ? 300 : shape === 'burst' ? 240 : 260;
  return { id, kind: 'shape', shape, x: W / 2, y: H / 2, size, rot: 0, shadow: 'soft', outline: shape === 'burst' ? 0 : 0.03, outlineColor: '#ffffff', color: shape === 'burst' ? '#ffd25e' : '#ff3b30' };
}

export function newImage(id: number, src: number, name: string, aspect: number, size: number): ImageLayer {
  return { id, kind: 'image', src, name, aspect, x: W / 2, y: H / 2, size, rot: 0, shadow: 'soft', outline: 0, outlineColor: '#ffffff' };
}

/** Size that keeps a new sticker comfortably inside the canvas */
export function fitSize(aspect: number, maxW = W * 0.45, maxH = H * 0.7) {
  return Math.round(Math.min(maxW, maxH / aspect));
}
