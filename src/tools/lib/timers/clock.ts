/**
 * A clock is just timestamps: elapsed time is worked out from Date.now() whenever it is
 * needed, so it stays exact when the tab sleeps in the background or the page is reloaded.
 */
export interface Clock {
  /** when the current run started (ms since epoch), or null while stopped */
  startedAt: number | null;
  /** time banked by earlier runs */
  banked: number;
}

export const idle = (): Clock => ({ startedAt: null, banked: 0 });
export const elapsed = (c: Clock, now: number) => c.banked + (c.startedAt === null ? 0 : Math.max(0, now - c.startedAt));
export const isRunning = (c: Clock) => c.startedAt !== null;
export const start = (c: Clock, now: number): Clock => (isRunning(c) ? c : { startedAt: now, banked: c.banked });
export const pause = (c: Clock, now: number): Clock => (isRunning(c) ? { startedAt: null, banked: elapsed(c, now) } : c);

export interface Parts {
  h: number;
  m: number;
  s: number;
  /** hundredths of a second */
  cs: number;
}

export function split(ms: number): Parts {
  const t = Math.max(0, Math.floor(ms));
  return { h: Math.floor(t / 3_600_000), m: Math.floor(t / 60_000) % 60, s: Math.floor(t / 1000) % 60, cs: Math.floor(t / 10) % 100 };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 83_456 → "01:23", 3_723_000 → "1:02:03"; with centis, "01:23.45" */
export function formatClock(ms: number, { centis = false } = {}) {
  const { h, m, s, cs } = split(ms);
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return centis ? `${base}.${pad(cs)}` : base;
}

/** what a countdown shows: rounds up, so a 5 minute timer reads 05:00 until a full second has gone */
export const formatCountdown = (remaining: number) => formatClock(Math.ceil(Math.max(0, remaining) / 1000) * 1000);

/** 90_000 → "1 min 30 s", 5_400_000 → "1 h 30 min" */
export function formatHuman(ms: number) {
  const { h, m, s } = split(Math.round(ms / 1000) * 1000);
  const out = [h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean).join(' ');
  return out || '0 s';
}

export const toMs = ({ h = 0, m = 0, s = 0 }: Partial<Parts>) => ((h * 60 + m) * 60 + s) * 1000;

/** whole, non-negative numbers from a number input, which may hand back '' or NaN */
export const wholeOr0 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** split times (total elapsed at each lap) → lap lengths plus the fastest and slowest lap */
export function lapStats(splits: number[]) {
  const laps = splits.map((t, i) => t - (i ? splits[i - 1] : 0));
  let fastest = -1;
  let slowest = -1;
  // with a single lap there is nothing to compare
  if (laps.length > 1) {
    fastest = slowest = 0;
    laps.forEach((l, i) => {
      if (l < laps[fastest]) fastest = i;
      if (l > laps[slowest]) slowest = i;
    });
    // all laps the same length: nothing stands out
    if (laps[fastest] === laps[slowest]) fastest = slowest = -1;
  }
  return { laps, fastest, slowest };
}

export function lapsCsv(splits: number[]) {
  const { laps } = lapStats(splits);
  const rows = laps.map((l, i) => `${i + 1},${formatClock(l, { centis: true })},${formatClock(splits[i], { centis: true })}`);
  return ['Lap,Lap time,Total time', ...rows].join('\r\n') + '\r\n';
}

/** local calendar day, e.g. "2026-10-26" */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
