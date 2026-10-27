import { parseGif } from '@/engines/media/gif';

export interface GifStats {
  width: number;
  height: number;
  frames: number;
  durationMs: number;
}

/** size, frame count and running time from the GIF's frame table (no pixels decoded) */
export function gifStats(bytes: Uint8Array): GifStats {
  const gif = parseGif(bytes);
  if (!gif.frames.length) throw new Error('This GIF has no frames.');
  return { width: gif.width, height: gif.height, frames: gif.frames.length, durationMs: gif.frames.reduce((t, f) => t + f.delayMs, 0) };
}

/** repeat choices; 0 means "enough plays to last at least MIN_SECONDS" */
export const REPEATS: [number, string][] = [[1, '1×'], [2, '2×'], [3, '3×'], [5, '5×'], [0, '≥ 3 s']];
export const MIN_SECONDS = 3;

export function playsFor(durationMs: number, choice: number): number {
  if (choice > 0) return choice;
  return Math.max(1, Math.ceil((MIN_SECONDS * 1000 - 1) / Math.max(1, durationMs)));
}

/** positive = smaller; negative when the video came out bigger */
export const savedPercent = (before: number, after: number) => (before > 0 ? Math.round((1 - after / before) * 100) : 0);

export function describeSaving(before: number, after: number) {
  const p = savedPercent(before, after);
  return p > 0 ? `${p}% smaller` : p < 0 ? `${-p}% bigger` : 'same size';
}
