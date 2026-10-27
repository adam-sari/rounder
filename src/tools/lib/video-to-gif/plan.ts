/*
 * Timing, sizing and estimates for the video → GIF tool. Pure, so the numbers shown in the
 * UI and the ones used for the export come from the same place (and are unit-tested).
 */
import { clamp, evenize, suggestedBitrate } from '@/engines/media/math';

export const WIDTH_MIN = 240;
export const WIDTH_MAX = 800;
export const FPS_MIN = 5;
export const FPS_MAX = 30;
/** ranges longer than this get a "this will be big" nudge */
export const LONG_GIF_SEC = 15;
export const DEFAULT_RANGE_SEC = 5;

export type Dither = 'none' | 'pattern' | 'diffuse';
/** plays: 0 = forever */
export type Loop = number;

/** source timestamps to sample, one per output frame; `speed` source seconds pass per output second */
export function frameTimes(start: number, end: number, fps: number, speed = 1): number[] {
  const step = speed / fps;
  const count = Math.max(1, Math.ceil((end - start) / step - 1e-6));
  return Array.from({ length: count }, (_, i) => start + i * step);
}

export const outputDuration = (start: number, end: number, speed = 1) => Math.max(0, end - start) / speed;

/** GIF delays are whole centiseconds; spreading the rounding keeps the overall speed exact */
export function gifDelays(count: number, fps: number): number[] {
  return Array.from({ length: count }, (_, i) => (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10);
}

/** plays → the NETSCAPE loop field gifenc writes: 0 = forever, -1 = no loop block (play once), n = n extra plays */
export const gifRepeat = (plays: Loop) => (plays === 0 ? 0 : plays <= 1 ? -1 : plays - 1);

/** never upscales; GIF sides can be odd, videos get even sides */
export function outputSize(srcW: number, srcH: number, width: number, even = false) {
  const w = Math.max(1, Math.min(Math.round(width), srcW));
  const h = Math.max(1, Math.round((w * srcH) / srcW));
  return even ? { width: evenize(w), height: evenize(h) } : { width: w, height: h };
}

/** slider bounds for a source of this width (small clips can't go up to 240) */
export function widthRange(srcW: number) {
  const max = Math.max(1, Math.min(WIDTH_MAX, srcW));
  return { min: Math.min(WIDTH_MIN, max), max };
}

export const defaultWidth = (srcW: number) => clamp(480, widthRange(srcW).min, widthRange(srcW).max);

/**
 * Whole-GIF size from sample encodes: the first frame is stored in full, later ones only
 * hold what changed, so they cost about as much as the sampled "diff" frames.
 */
export function estimateGifBytes(frames: number, firstBytes: number, diffBytes: number[]): number {
  const diff = diffBytes.length ? diffBytes.reduce((a, b) => a + b, 0) / diffBytes.length : firstBytes;
  return Math.round(firstBytes + Math.max(0, frames - 1) * diff);
}

/** bitrate for the "GIF-like" MP4/WebM: generous for its size, still a fraction of a GIF */
export const loopBitrate = (width: number, height: number, fps: number) => Math.max(100_000, suggestedBitrate(width, height, fps, 'high'));

/** bitrate × duration; the encoder lands close to it, containers add a little */
export const estimateVideoBytes = (bitrate: number, durationSec: number) => Math.round(((bitrate * durationSec) / 8) * 1.03 + 2_000);

/** remaining seconds from progress so far, or null until there's enough to go on */
export function eta(progress: number, elapsedMs: number): number | null {
  if (progress < 0.03 || elapsedMs < 1500) return null;
  return ((elapsedMs / progress) * (1 - progress)) / 1000;
}

/** "3 s", "1 min 05 s" */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
