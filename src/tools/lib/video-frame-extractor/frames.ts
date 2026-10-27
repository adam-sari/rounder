import { clamp, spreadTimes } from '@/engines/media/math';

/** most frames one batch may produce; full-size stills add up fast */
export const FRAME_CAP = 500;

export type BatchMode = 'count' | 'interval' | 'all';

export interface BatchPlan {
  /** times to grab, at most FRAME_CAP */
  times: number[];
  /** how many the settings asked for before the cap */
  wanted: number;
}

const EPS = 1e-6;

/**
 * Times for a batch over [start, end]. "count" centres each frame in its slot (no black first
 * frame, never past the end); "interval" starts at `start`; "all" lands mid-frame at `fps`, so
 * each source frame is decoded once.
 */
export function planFrameTimes(mode: BatchMode, o: { start: number; end: number; count?: number; interval?: number; fps?: number | null }): BatchPlan {
  const { start, end } = o;
  if (!(end > start)) return { times: [], wanted: 0 };
  const known = o.fps && o.fps > 0 ? o.fps : null;
  if (mode === 'count') {
    // a short range holds only so many distinct frames; more would just repeat them
    const frames = known ? Math.max(1, Math.round((end - start) * known)) : Infinity;
    const wanted = Math.min(frames, Math.max(1, Math.floor(o.count ?? 10)));
    // over the cap, the capped count still covers the whole range
    return { times: spreadTimes(Math.min(wanted, FRAME_CAP), start, end), wanted };
  }
  let wanted: number;
  let at: (i: number) => number;
  if (mode === 'interval') {
    // never closer than one frame apart, or the same frame is saved twice
    const step = Math.max(0.01, known ? 1 / known : 0, o.interval ?? 1);
    wanted = Math.floor((end - start) / step - EPS) + 1;
    at = (i) => start + i * step;
  } else {
    const fps = known ?? 30;
    const first = Math.floor(start * fps + EPS);
    const last = Math.ceil(end * fps - EPS) - 1;
    wanted = Math.max(0, last - first + 1);
    at = (i) => (first + i + 0.5) / fps;
  }
  const n = Math.min(wanted, FRAME_CAP);
  return { times: Array.from({ length: n }, (_, i) => at(i)), wanted };
}

/** frame number shown at `time` */
export const frameNumber = (time: number, fps: number) => Math.floor(time * fps + EPS);

/** middle of the next/previous frame, so the player lands squarely on it */
export const stepTime = (time: number, fps: number, dir: number, duration: number) =>
  clamp((frameNumber(time, fps) + dir + 0.5) / fps, 0, Math.max(0, duration - 0.5 / fps));

/** "holiday.mp4" at 75.5 s → "holiday_01-15.500.png"; hours are added for long videos so names still sort */
export function frameFileName(original: string, time: number, ext: string, withHours = false): string {
  const base = original.replace(/\.[^.]+$/, '') || 'video';
  const ms = Math.round(Math.max(0, time) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const stamp = `${withHours ? `${pad(h)}-${pad(m)}` : pad(h * 60 + m)}-${pad(s)}.${pad(ms % 1000, 3)}`;
  return `${base}_${stamp}.${ext}`;
}

export interface SheetLayout {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  /** top-left of each tile */
  cells: { x: number; y: number }[];
}

export interface SheetOptions {
  columns: number;
  /** target sheet width before limits */
  width?: number;
  gap?: number;
  pad?: number;
  /** space reserved above the grid for a title line */
  header?: number;
  /** canvas limits: longest side and total pixels (iOS Safari caps canvases near 16.7 MP) */
  maxSide?: number;
  maxArea?: number;
}

/** Grid of n frames (each frameW × frameH) for a contact sheet; tiles never upscale, and shrink to fit canvas limits. */
export function contactSheetLayout(n: number, frameW: number, frameH: number, o: SheetOptions): SheetLayout {
  const { width = 2400, gap = 12, pad = 32, header = 0, maxSide = 16_384, maxArea = 16_000_000 } = o;
  const columns = clamp(Math.floor(o.columns), 1, Math.max(1, n));
  const rows = Math.max(1, Math.ceil(n / columns));
  const size = (tw: number) => {
    const th = Math.max(1, Math.round((tw * frameH) / frameW));
    return { tw, th, w: pad * 2 + columns * tw + (columns - 1) * gap, h: pad * 2 + header + rows * th + (rows - 1) * gap };
  };
  let tw = Math.max(16, Math.min(frameW, Math.floor((width - pad * 2 - (columns - 1) * gap) / columns)));
  let s = size(tw);
  while (tw > 16 && (s.w > maxSide || s.h > maxSide || s.w * s.h > maxArea)) {
    tw = Math.max(16, Math.floor(tw * 0.92));
    s = size(tw);
  }
  const cells = Array.from({ length: n }, (_, i) => ({
    x: pad + (i % columns) * (s.tw + gap),
    y: pad + header + Math.floor(i / columns) * (s.th + gap),
  }));
  return { width: s.w, height: s.h, tileWidth: s.tw, tileHeight: s.th, columns, rows, cells };
}
