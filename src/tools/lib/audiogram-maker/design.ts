/** Shapes, presets and small pure helpers for the audiogram maker. */

export type Aspect = '1:1' | '9:16' | '16:9' | '4:5';
export type Resolution = 1080 | 720;
export type VisualStyle = 'bars' | 'wave' | 'line' | 'circle';
export type Backdrop = 'solid' | 'gradient' | 'image';

export const FPS = 30;
/** longest section one video can cover */
export const MAX_SECTION = 600;
export const MIN_SECTION = 1;
/** a fresh file starts with this much selected */
export const DEFAULT_SECTION = 60;

export const ASPECTS: { id: Aspect; label: string; hint: string; w: number; h: number }[] = [
  { id: '1:1', label: '1:1', hint: 'feeds, X, LinkedIn', w: 1, h: 1 },
  { id: '9:16', label: '9:16', hint: 'Reels, Shorts, TikTok, Stories', w: 9, h: 16 },
  { id: '16:9', label: '16:9', hint: 'YouTube, websites', w: 16, h: 9 },
  { id: '4:5', label: '4:5', hint: 'Instagram and Facebook feeds', w: 4, h: 5 },
];

export const STYLES: { id: VisualStyle; label: string }[] = [
  { id: 'bars', label: 'Bars' },
  { id: 'wave', label: 'Mirrored wave' },
  { id: 'line', label: 'Line' },
  { id: 'circle', label: 'Circle' },
];

/** short side is `res`; the long side follows the aspect ratio (kept even for H.264) */
export function outputSize(aspect: Aspect, res: Resolution): { width: number; height: number } {
  const a = ASPECTS.find((x) => x.id === aspect)!;
  const even = (n: number) => Math.round(n / 2) * 2;
  return a.w >= a.h ? { width: even((res * a.w) / a.h), height: res } : { width: res, height: even((res * a.h) / a.w) };
}

/** a tiny frame of the same shape, used as the timing track the renderer draws over */
export function carrierSize(aspect: Aspect): { width: number; height: number } {
  const { width, height } = outputSize(aspect, 1080);
  const k = 240 / Math.max(width, height);
  const even = (n: number) => Math.max(16, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export interface Palette {
  name: string;
  bg1: string;
  bg2: string;
  accent: string;
}

export const PALETTES: Palette[] = [
  { name: 'Night', bg1: '#191613', bg2: '#2c2216', accent: '#ffd25e' },
  { name: 'Ink', bg1: '#0f1a2b', bg2: '#27325a', accent: '#8fd3ff' },
  { name: 'Forest', bg1: '#0f2119', bg2: '#244a35', accent: '#9be58f' },
  { name: 'Berry', bg1: '#2a0f2b', bg2: '#5b1d4a', accent: '#ff8fb8' },
  { name: 'Ember', bg1: '#2b100b', bg2: '#7a2e12', accent: '#ffb35e' },
  { name: 'Paper', bg1: '#f4efe6', bg2: '#e2d6c2', accent: '#1d1a17' },
];

const HEX = /^#?([0-9a-f]{6})$/i;

export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** dark or light text for a background made of these colors */
export function inkFor(...colors: string[]): string {
  const rgb = colors.map(parseHex).filter((c): c is [number, number, number] => !!c);
  if (!rgb.length) return '#ffffff';
  const lum = rgb.reduce((s, c) => s + luminance(c), 0) / rgb.length;
  return lum > 150 ? '#141210' : '#ffffff';
}

/** "#ffd25e" + 0.3 → "rgba(255, 210, 94, 0.3)" */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex) ?? [255, 255, 255];
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/**
 * Keeps a section between MIN_SECTION and MAX_SECTION long. The edge that moved stays where it
 * was put and the other one follows it, like a sliding window.
 */
export function clampSection(start: number, end: number, duration: number, moved: 'start' | 'end'): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, duration));
  let e = Math.max(0, Math.min(end, duration));
  const min = Math.min(MIN_SECTION, duration);
  if (e - s > MAX_SECTION) {
    if (moved === 'start') e = s + MAX_SECTION;
    else s = e - MAX_SECTION;
  }
  if (e - s < min) {
    if (moved === 'start') s = Math.max(0, e - min);
    else e = Math.min(duration, s + min);
    if (e - s < min) s = Math.max(0, e - min);
  }
  return { start: s, end: e };
}

/** "Episode 12 - Interview.mp3" → "Episode 12 - Interview" */
export const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/** 65 → "1:05" for the on-video timer */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const AUDIO_BITRATE = 192_000;

/** 0.1 bit per pixel per frame: crisp edges on the moving visualizer without bloating flat backgrounds */
export const videoBitrate = (width: number, height: number) => Math.round((width * height * FPS * 0.1) / 1000) * 1000;

/** the encoder may land under this on calm frames, rarely over */
export const estimateBytes = (durationSec: number, width: number, height: number) => Math.round(((videoBitrate(width, height) + AUDIO_BITRATE) * durationSec) / 8);
