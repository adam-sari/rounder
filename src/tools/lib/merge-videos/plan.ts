import { evenize } from '@/engines/media/math';
import type { MediaErrorCode } from '@/engines/media/types';

export type SizeMode = 'first' | 'largest' | '1080p' | '720p' | 'vertical' | 'square';
export type FitMode = 'letterbox' | 'fill';
export type AudioMode = 'keep' | 'mute' | 'music';

export interface Size {
  width: number;
  height: number;
}

export interface ClipPlan {
  width: number;
  height: number;
  duration: number;
  start: number;
  end: number;
}

export const SIZE_PRESETS: Record<Exclude<SizeMode, 'first' | 'largest'>, Size & { label: string }> = {
  '1080p': { width: 1920, height: 1080, label: '1080p' },
  '720p': { width: 1280, height: 720, label: '720p' },
  vertical: { width: 1080, height: 1920, label: '9:16' },
  square: { width: 1080, height: 1080, label: '1:1' },
};

/** the output frame: first clip's size, the biggest clip's, or a preset (always even, as H.264 needs) */
export function resolveSize(mode: SizeMode, clips: Size[]): Size | null {
  if (mode !== 'first' && mode !== 'largest') return SIZE_PRESETS[mode];
  if (!clips.length) return null;
  const pick = mode === 'first' ? clips[0] : clips.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  return { width: evenize(pick.width), height: evenize(pick.height) };
}

// handles land on frame steps, so anything closer than this to the edge counts as untouched
const EDGE = 0.02;

export const isTrimmed = (c: ClipPlan) => c.start > EDGE || c.end < c.duration - EDGE;

export const clipLength = (c: ClipPlan) => (isTrimmed(c) ? Math.max(0, c.end - c.start) : c.duration);

export const totalLength = (clips: ClipPlan[]) => clips.reduce((s, c) => s + clipLength(c), 0);

export const sameAspect = (a: Size, b: Size) => Math.abs(a.width / a.height - b.width / b.height) < 0.01;

/**
 * The engine's concat only letterboxes and can't trim, so trimmed clips and (for "fill")
 * clips of another shape get their own encode first.
 */
export const needsPrepass = (c: ClipPlan, target: Size, fit: FitMode) => isTrimmed(c) || (fit === 'fill' && !sameAspect(c, target));

/**
 * Size for a clip's prepass: crop-to-fill clips land exactly on the target; others only shrink to
 * fit inside it (concat adds the bars), so a trimmed 4K clip isn't re-encoded at 4K for a 720p join.
 */
export function prepSize(c: Size, target: Size, fit: FitMode): { width?: number; height?: number; fit?: 'cover' } {
  if (fit === 'fill' && !sameAspect(c, target)) return { width: target.width, height: target.height, fit: 'cover' };
  const scale = Math.min(target.width / c.width, target.height / c.height);
  return scale < 1 ? { width: evenize(c.width * scale) } : {};
}

export interface Stage {
  kind: 'prepare' | 'join' | 'mute' | 'music';
  /** clip index for 'prepare' */
  clip?: number;
  /** share of the whole job, 0–1 */
  weight: number;
}

/** stages in order, weighted by roughly how many seconds of video each one encodes */
export function planStages(clips: ClipPlan[], target: Size, fit: FitMode, audio: AudioMode): Stage[] {
  const total = totalLength(clips);
  const raw: Omit<Stage, 'weight'>[] = [];
  const costs: number[] = [];
  clips.forEach((c, i) => {
    if (!needsPrepass(c, target, fit)) return;
    raw.push({ kind: 'prepare', clip: i });
    costs.push(clipLength(c));
  });
  raw.push({ kind: 'join' });
  costs.push(total);
  // the last pass copies the video stream, so it is quick: only the audio is touched
  if (audio !== 'keep') {
    raw.push({ kind: audio });
    costs.push(total * (audio === 'music' ? 0.12 : 0.04));
  }
  const sum = costs.reduce((a, b) => a + b, 0) || 1;
  return raw.map((s, i) => ({ ...s, weight: costs[i] / sum }));
}

/** overall 0–1 progress while stage `index` is at `p` */
export function overallProgress(stages: Stage[], index: number, p: number) {
  const done = stages.slice(0, index).reduce((s, x) => s + x.weight, 0);
  return Math.min(1, done + (stages[index]?.weight ?? 0) * Math.min(1, Math.max(0, p)));
}

/** seconds left, or null until there is enough progress to guess */
export function etaSeconds(elapsedSec: number, progress: number) {
  if (progress < 0.03 || elapsedSec < 1.5) return null;
  return Math.max(0, (elapsedSec * (1 - progress)) / progress);
}

/** "3:05", "1:02:03": a clock for elapsed/ETA readouts */
export function clock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** volume slider percent → gain in dB (100% = 0 dB) */
export const percentToDb = (pct: number) => 20 * Math.log10(Math.max(1, pct) / 100);

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** what to say about background music that is shorter or longer than the video */
export function musicFit(musicSec: number, videoSec: number): string {
  if (!musicSec || !videoSec) return '';
  const diff = musicSec - videoSec;
  if (Math.abs(diff) < 0.5) return 'The music is about as long as the video.';
  if (diff > 0) return `The music is cut off when the video ends (${clock(diff)} of it goes unused).`;
  return `The music ends ${clock(-diff)} before the video does; the rest is silent.`;
}

export function friendlyError(code: MediaErrorCode | undefined, message: string): string {
  switch (code) {
    case 'aborted':
      return 'Cancelled.';
    case 'no-webcodecs':
      return 'This browser is missing WebCodecs, which merging needs. Try a recent Chrome, Edge, Safari or Firefox.';
    case 'unsupported-codec':
      return "This browser can't encode video in that format. Try MP4 or WebM instead.";
    case 'out-of-memory':
      return 'Your browser ran out of memory. Try fewer or shorter clips, or a smaller output size.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't convert one of the clips. It may be damaged or use a very unusual codec.";
    case 'unsupported-input':
    case 'no-tracks':
    case 'invalid-options':
      return message;
    default:
      return `Something went wrong while merging. ${message}`.trim();
  }
}
