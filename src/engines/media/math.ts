import type { Fit, QualityLevel, Rect, Rotation, Segment } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 75.5 → "01:15.50"; hours appear only when needed ("1:02:03.00") */
export function formatTime(sec: number, decimals = 2): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const scale = 10 ** decimals;
  const total = Math.round(sec * scale);
  const frac = total % scale;
  const whole = (total - frac) / scale;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const tail = decimals > 0 ? `.${pad(frac, decimals)}` : '';
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}${tail}` : `${pad(m)}:${pad(s)}${tail}`;
}

/** Accepts "75.5", "1:15.5", "01:15,50", "1:02:03" → seconds, or null for nonsense */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === '' || p === '.')) return null;
  const nums = parts.map(Number);
  // only the last part may carry a fraction; minutes/seconds above the top unit stay < 60
  if (nums.slice(0, -1).some((n) => !Number.isInteger(n))) return null;
  if (nums.length > 1 && nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SizePlan {
  /** size after rotation and crop, before scaling */
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  fit: Fit;
}

/**
 * Works out the encoded size for a video of display size w × h: rotation swaps the sides,
 * crop cuts a region, then width/height/scale resize. Results are even, as H.264 requires.
 */
export function planVideoSize(
  w: number,
  h: number,
  o: { width?: number; height?: number; scale?: number; fit?: Fit; crop?: Rect; rotate?: Rotation },
): SizePlan {
  let sw = o.rotate === 90 || o.rotate === 270 ? h : w;
  let sh = o.rotate === 90 || o.rotate === 270 ? w : h;
  if (o.crop) {
    const x = clamp(Math.round(o.crop.x), 0, sw - 1);
    const y = clamp(Math.round(o.crop.y), 0, sh - 1);
    sw = clamp(Math.round(o.crop.width), 1, sw - x);
    sh = clamp(Math.round(o.crop.height), 1, sh - y);
  }
  let width: number;
  let height: number;
  let fit: Fit = o.fit ?? 'contain';
  if (o.width && o.height) {
    width = o.width;
    height = o.height;
  } else if (o.width) {
    width = o.width;
    height = (o.width * sh) / sw;
    fit = 'fill';
  } else if (o.height) {
    height = o.height;
    width = (o.height * sw) / sh;
    fit = 'fill';
  } else {
    const s = o.scale && o.scale > 0 ? o.scale : 1;
    width = sw * s;
    height = sh * s;
    fit = 'fill';
  }
  return { sourceWidth: sw, sourceHeight: sh, width: evenize(width), height: evenize(height), fit };
}

/**
 * Video bitrate that lands a file near `targetBytes`. `overhead` reserves room for container
 * headers and encoder overshoot. `feasible` is false when even the minimum bitrate is too big.
 */
export function bitrateForTargetSize(
  targetBytes: number,
  durationSec: number,
  { audioBitrate = 0, overhead = 0.05, minVideoBitrate = 50_000, snapAudio = (b: number) => b } = {},
): { videoBitrate: number; audioBitrate: number; feasible: boolean } {
  if (!(durationSec > 0) || !(targetBytes > 0)) return { videoBitrate: minVideoBitrate, audioBitrate, feasible: false };
  const totalBits = (targetBytes * 8 * (1 - overhead)) / durationSec;
  let audio = audioBitrate;
  // starve audio before video: below 4× the audio rate, drop audio to a third of the budget
  if (audio > 0 && totalBits < audio * 4) audio = Math.max(24_000, Math.round(totalBits / 3 / 1000) * 1000);
  // the encoder may only accept certain rates (AAC: 96–192k); the video gets whatever is left
  if (audio > 0) audio = snapAudio(audio);
  const video = Math.floor(totalBits - audio);
  return { videoBitrate: Math.max(minVideoBitrate, video), audioBitrate: audio, feasible: video >= minVideoBitrate };
}

const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/**
 * Rounds an audio bitrate to one the encoders accept. Native AAC encoders (Windows Media
 * Foundation in particular) only take 96/128/160/192 kbps; MP3 has a fixed ladder; Opus and
 * Vorbis take anything from 6 kbps. Lossless codecs return undefined (no bitrate applies).
 */
export function snapAudioBitrate(codec: string, bitrate: number): number | undefined {
  if (codec === 'aac') return nearest([96_000, 128_000, 160_000, 192_000], bitrate);
  if (codec === 'mp3') return nearest([32_000, 40_000, 48_000, 64_000, 80_000, 96_000, 112_000, 128_000, 160_000, 192_000, 224_000, 256_000, 320_000], bitrate);
  if (codec === 'opus') return clamp(Math.round(bitrate / 1000) * 1000, 6_000, 510_000);
  if (codec === 'vorbis') return clamp(Math.round(bitrate / 1000) * 1000, 32_000, 500_000);
  return undefined;
}

/** rough output size for a bitrate pair, for UI estimates */
export const estimateSizeBytes = (durationSec: number, videoBitrate: number, audioBitrate = 0) =>
  Math.round(((videoBitrate + audioBitrate) * durationSec) / 8 * 1.02);

/** typical bitrates (bits/s) for H.264 at a given pixel count, per quality level */
export function suggestedBitrate(width: number, height: number, fps = 30, quality: QualityLevel = 'medium'): number {
  const bpp = { 'very-low': 0.03, low: 0.05, medium: 0.08, high: 0.12, 'very-high': 0.18 }[quality];
  return Math.round(width * height * Math.min(fps, 60) * bpp);
}

/** sorts, clamps to [0, duration], merges overlaps and drops slivers shorter than minLength */
export function normalizeSegments(segments: Segment[], duration: number, minLength = 0.01): Segment[] {
  const sorted = segments
    .map((s) => ({ start: clamp(Math.min(s.start, s.end), 0, duration), end: clamp(Math.max(s.start, s.end), 0, duration) }))
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out.filter((s) => s.end - s.start >= minLength);
}

/** the gaps between segments: turns "cut these" into "keep these" and back */
export function invertSegments(segments: Segment[], duration: number, minLength = 0.01): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const s of normalizeSegments(segments, duration, 0)) {
    if (s.start - cursor >= minLength) out.push({ start: cursor, end: s.start });
    cursor = s.end;
  }
  if (duration - cursor >= minLength) out.push({ start: cursor, end: duration });
  return out;
}

export const segmentsDuration = (segments: Segment[]) => segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);

/** maps a time in the joined output of `segments` back to the source timeline */
export function outputToSourceTime(segments: Segment[], t: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (t <= acc + len) return s.start + (t - acc);
    acc += len;
  }
  return segments.length ? segments[segments.length - 1].end : t;
}

/** evenly spaced sample times across [start, end), centred in each slot (for thumbnails) */
export function spreadTimes(count: number, start: number, end: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => start + step * (i + 0.5));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const formatBitrate = (bps: number) => (bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`);
