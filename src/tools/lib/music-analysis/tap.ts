/** Tap tempo: steady taps averaged, stray ones (a double tap, a missed beat) ignored. */

/** a pause this long starts a fresh count */
export const TAP_RESET_MS = 2000;
/** only the most recent taps count, so a drifting tempo is followed */
const WINDOW = 16;

export interface TapTempo {
  bpm: number;
  /** taps that agreed with the tempo */
  used: number;
  /** spread of the kept intervals in BPM, smaller is steadier */
  spread: number;
}

/** adds a tap time (ms) to the list, restarting after a long pause */
export function addTap(taps: number[], now: number): number[] {
  const last = taps[taps.length - 1];
  if (last === undefined || now - last > TAP_RESET_MS || now <= last) return [now];
  return [...taps, now].slice(-(WINDOW + 1));
}

export function tapTempo(taps: number[]): TapTempo | null {
  if (taps.length < 3) return null;
  const gaps = taps.slice(1).map((t, i) => t - taps[i]);
  const median = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
  const kept = gaps.filter((g) => Math.abs(g - median) <= median * 0.2);
  if (kept.length < 2) return null;
  const mean = kept.reduce((s, g) => s + g, 0) / kept.length;
  const bpms = kept.map((g) => 60000 / g);
  return { bpm: 60000 / mean, used: kept.length + 1, spread: Math.max(...bpms) - Math.min(...bpms) };
}

/**
 * How a tapped tempo relates to a detected one: the same, or half/double time (people often tap
 * every other beat). Null when they don't match.
 */
export function tapRelation(tapped: number, detected: number): 'same' | 'half' | 'double' | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= b * 0.04;
  if (near(tapped, detected)) return 'same';
  if (near(tapped, detected / 2)) return 'half';
  if (near(tapped, detected * 2)) return 'double';
  return null;
}
