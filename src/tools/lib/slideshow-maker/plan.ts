import type { MediaErrorCode } from '@/engines/media/types';

export const aspects = [
  { id: '16:9', w: 16, h: 9, label: 'YouTube, TV' },
  { id: '9:16', w: 9, h: 16, label: 'Reels, TikTok, Shorts' },
  { id: '1:1', w: 1, h: 1, label: 'Square posts' },
  { id: '4:5', w: 4, h: 5, label: 'Instagram feed' },
] as const;
export type AspectId = (typeof aspects)[number]['id'];

/** output quality by the short side, like "720p" */
export const resolutions = [480, 720, 1080] as const;

export type Transition = 'none' | 'fade' | 'slide';
export type FitMode = 'cover' | 'contain' | 'blur';

export const MIN_SLIDE_SEC = 0.5;
export const MAX_SLIDE_SEC = 30;
export const TRANSITION_SEC = 0.7;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** frame size for an aspect at a given short side (both even, as encoders need) */
export function outputSize(aspect: AspectId, short: number) {
  const a = aspects.find((x) => x.id === aspect) ?? aspects[0];
  return a.w >= a.h ? { w: even((short * a.w) / a.h), h: even(short) } : { w: even(short), h: even((short * a.h) / a.w) };
}

/** per-slide durations: each slide's own value, or the global one */
export const resolveDurations = (overrides: (number | null)[], global: number) => overrides.map((d) => d ?? global);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Durations that make the photos last `target` seconds in total. Slides with their own duration
 * keep it and the rest share what's left; when that would leave under MIN_SLIDE_SEC each, all
 * slides share the time evenly instead (`overridesKept: false`).
 */
export function fitDurations(overrides: (number | null)[], target: number): { durations: number[]; overridesKept: boolean } {
  const n = overrides.length;
  if (!n) return { durations: [], overridesKept: true };
  const fixed = overrides.reduce<number>((s, d) => s + (d ?? 0), 0);
  const free = overrides.filter((d) => d === null).length;
  const share = free ? (target - fixed) / free : 0;
  if (free && share >= MIN_SLIDE_SEC) return { durations: overrides.map((d) => d ?? share), overridesKept: true };
  const each = Math.max(MIN_SLIDE_SEC, target / n);
  return { durations: overrides.map(() => each), overridesKept: free === n };
}

export const total = (durations: number[]) => durations.reduce((a, b) => a + b, 0);

/** the cross-over length the engine uses: never more than half the shortest slide */
export const transitionLength = (durations: number[], transition: Transition, wanted = TRANSITION_SEC) =>
  transition === 'none' || !durations.length ? 0 : Math.min(wanted, ...durations.map((d) => d / 2));

export interface FrameState {
  slot: number;
  /** 0–1 through the current slide (drives the Ken Burns zoom) */
  local: number;
  /** eased 0–1 progress of the transition into the next slide, when one is running */
  mix: number | null;
}

/** which slide(s) show at time t: mirrors imagesToVideo so the preview matches the export */
export function frameState(t: number, durations: number[], T: number): FrameState {
  let slot = 0;
  let start = 0;
  while (slot < durations.length - 1 && t >= start + durations[slot]) start += durations[slot++];
  const d = durations[slot] ?? 1;
  const local = Math.min(1, Math.max(0, (t - start) / d));
  const into = t - (start + d - T);
  if (T > 0 && slot < durations.length - 1 && into > 0) {
    const k = Math.min(1, into / T);
    return { slot, local, mix: k * k * (3 - 2 * k) };
  }
  return { slot, local, mix: null };
}

/** start time of each slide, for seeking to one */
export function slideStarts(durations: number[]) {
  const out: number[] = [];
  let t = 0;
  for (const d of durations) {
    out.push(round2(t));
    t += d;
  }
  return out;
}

/** music volume (0–1) at time t of a clip `length` seconds long with fades at both ends */
export function fadeGain(t: number, length: number, fadeIn: number, fadeOut: number) {
  if (t < 0 || t > length) return 0;
  const a = fadeIn > 0 ? t / fadeIn : 1;
  const b = fadeOut > 0 ? (length - t) / fadeOut : 1;
  return Math.max(0, Math.min(1, a, b));
}

/** "Summer in Lisbon!" → "summer-in-lisbon"; empty titles give "slideshow" */
export function fileBase(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'slideshow';
}

/** greedy word wrap; words longer than a line are kept whole and shrink with the font instead */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** dark text on light backgrounds, white otherwise */
export function inkFor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#131211' : '#ffffff';
}

/** "1m 05s" style remaining time for the progress readout */
export function formatEta(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '…';
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** what to tell people when the export fails */
export function errorText(code: MediaErrorCode | undefined, message: string) {
  switch (code) {
    case 'no-webcodecs':
      return "This browser can't encode video. Try a recent Chrome, Edge, Safari or Firefox.";
    case 'unsupported-codec':
      return "This browser can't encode that format. Try the other format, or a lower resolution.";
    case 'out-of-memory':
      return 'Your device ran out of memory. Try 720p, fewer photos or a shorter slideshow.';
    case 'unsupported-input':
    case 'no-tracks':
      return "The music file couldn't be read. Try an MP3, M4A, WAV or OGG file.";
    case 'invalid-options':
      return message;
    default:
      return `Something went wrong while making the video. ${message}`;
  }
}
