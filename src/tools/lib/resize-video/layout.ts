import { clamp, evenize } from '@/engines/media/math';
import type { Rect } from '@/engines/media/types';

export interface Platform {
  key: string;
  label: string;
  width: number;
  height: number;
}

/** common upload sizes; all three short-video apps use the same 1080 × 1920 frame */
export const platforms: Platform[] = [
  { key: 'tiktok', label: 'TikTok', width: 1080, height: 1920 },
  { key: 'reels', label: 'Instagram Reels', width: 1080, height: 1920 },
  { key: 'shorts', label: 'YouTube Shorts', width: 1080, height: 1920 },
  { key: 'youtube', label: 'YouTube', width: 1920, height: 1080 },
  { key: 'ig-post', label: 'Instagram post', width: 1080, height: 1080 },
  { key: 'ig-portrait', label: 'Instagram portrait', width: 1080, height: 1350 },
  { key: 'x', label: 'X (Twitter)', width: 1280, height: 720 },
];

/** fit = whole video with a backdrop, fill = crop to cover the frame */
export type FitMode = 'blur' | 'color' | 'fill';

export const MIN_SIDE = 16;
export const MAX_SIDE = 4096;

/** a typed custom side → an even number the encoders accept */
export const customSide = (n: number) => evenize(clamp(Number.isFinite(n) ? n : MIN_SIDE, MIN_SIDE, MAX_SIDE));

/** within 1%, a frame change is just a resize: no bars and nothing cropped worth mentioning */
export const sameAspect = (sw: number, sh: number, W: number, H: number) => Math.abs(sw / sh / (W / H) - 1) < 0.01;

/** which way a cover crop has room to slide: 'x' when the source is wider than the frame */
export function overflowAxis(sw: number, sh: number, W: number, H: number): 'x' | 'y' | null {
  if (sameAspect(sw, sh, W, H)) return null;
  return sw / sh > W / H ? 'x' : 'y';
}

/** where an sw × sh picture lands in a W × H frame: centred, letterboxed (contain) or overflowing (cover) */
export function fitRect(sw: number, sh: number, W: number, H: number, fit: 'contain' | 'cover'): Rect {
  const k = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const width = sw * k;
  const height = sh * k;
  return { x: (W - width) / 2, y: (H - height) / 2, width, height };
}

/**
 * The largest region of the source with the frame's shape, slid along the overflowing axis by
 * `focus` (0 = left/top, 1 = right/bottom), like CSS object-position. Source display pixels.
 */
export function coverCrop(sw: number, sh: number, W: number, H: number, focus: { x: number; y: number }): Rect {
  const aspect = W / H;
  const width = Math.min(sw, Math.round(sh * aspect));
  const height = Math.min(sh, Math.round(sw / aspect));
  return {
    x: Math.round((sw - width) * clamp(focus.x, 0, 1)),
    y: Math.round((sh - height) * clamp(focus.y, 0, 1)),
    width,
    height,
  };
}

export interface ResizePlan {
  width: number;
  height: number;
  fit?: 'fill' | 'cover';
  crop?: Rect;
  /** fit modes draw the frame themselves, through the engine's render hook */
  backdrop?: 'blur' | 'color';
}

/** turns the chosen size and mode into transcode() video options (minus the render hook) */
export function resizePlan(sw: number, sh: number, W: number, H: number, mode: FitMode, focus: { x: number; y: number }): ResizePlan {
  if (sameAspect(sw, sh, W, H)) return { width: W, height: H, fit: 'fill' };
  if (mode === 'fill') return { width: W, height: H, fit: 'cover', crop: coverCrop(sw, sh, W, H, focus) };
  return { width: W, height: H, backdrop: mode };
}

/** how much the picture gets enlarged; above 1 it can look softer */
export function upscaleFactor(sw: number, sh: number, W: number, H: number, mode: FitMode): number {
  return mode === 'fill' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
}
