import { clamp, evenize } from '@/engines/media/math';
import type { Rect } from '@/engines/media/types';

/*
 * Crop boxes live in the video's display pixels: the frame as a player shows it, with
 * phone rotation already applied. The engine crops in that same space (rotate → flip →
 * crop → resize), so a box drawn over the preview goes to transcode() unchanged.
 */

export interface AspectPreset {
  key: string;
  ratio: number | null;
  hint: string;
}

export const cropAspects: AspectPreset[] = [
  { key: 'free', ratio: null, hint: 'any shape' },
  { key: '9:16', ratio: 9 / 16, hint: 'TikTok · Reels · Shorts' },
  { key: '1:1', ratio: 1, hint: 'square post' },
  { key: '4:5', ratio: 4 / 5, hint: 'Instagram portrait' },
  { key: '16:9', ratio: 16 / 9, hint: 'YouTube · widescreen' },
  { key: '4:3', ratio: 4 / 3, hint: 'classic TV' },
];

const evenFloor = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** H.264 wants even sizes: trims an odd side by a pixel and keeps the box inside the frame */
export function evenCrop(r: Rect, W: number, H: number): Rect {
  const width = Math.min(evenFloor(r.width), evenFloor(W));
  const height = Math.min(evenFloor(r.height), evenFloor(H));
  return { x: clamp(Math.round(r.x), 0, W - width), y: clamp(Math.round(r.y), 0, H - height), width, height };
}

/** w × h scaled so its shorter side is `side` px (1080p, 720p …), both sides even */
export function scaleToShortSide(w: number, h: number, side: number) {
  const k = side / Math.min(w, h);
  return { width: evenize(w * k), height: evenize(h * k) };
}

/** the standard resolutions that would actually shrink a w × h frame */
export function scaleChoices(w: number, h: number, sides = [1080, 720, 480]) {
  return sides.filter((s) => s < Math.min(w, h)).map((side) => ({ side, ...scaleToShortSide(w, h, side) }));
}

/** "1080 × 1920" → "9:16"; falls back to a decimal ratio for odd sizes */
export function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  const a = Math.round(w) / g;
  const b = Math.round(h) / g;
  return a <= 32 && b <= 32 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
}
