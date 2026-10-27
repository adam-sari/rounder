import { cryptoRand32, randBelow, type Rand32 } from './rng';

export interface Entry {
  label: string;
  weight: number;
  /** line in the source text, so a winner can be removed exactly */
  line: number;
}

export interface Segment {
  /** start and end as fractions of a turn, clockwise from the pointer */
  start: number;
  end: number;
}

export const MAX_WEIGHT = 1000;

// "Alice *3" or "Bob*0.5": a trailing *number sets the weight
const WEIGHT = /^(.*?)\s*\*\s*(\d+(?:\.\d+)?)$/;

/** one entry per non-empty line; "*0" leaves an entry off the wheel without deleting it */
export function parseEntries(text: string): Entry[] {
  const out: Entry[] = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const s = raw.trim();
    if (!s) return;
    const m = WEIGHT.exec(s);
    if (m && m[1]) {
      const typed = Number(m[2]);
      // any weight above zero keeps at least the smallest step, so "*0.001" doesn't vanish
      if (typed > 0) out.push({ label: m[1], weight: Math.min(MAX_WEIGHT, Math.max(0.01, Math.round(typed * 100) / 100)), line });
    } else out.push({ label: s, weight: 1, line });
  });
  return out;
}

/** picks an index with probability proportional to its weight, unbiased */
export function pickWeighted(weights: number[], next: Rand32 = cryptoRand32): number {
  // weights have at most two decimals, so hundredths make them exact integers
  const ticks = weights.map((w) => Math.max(1, Math.round(w * 100)));
  let r = randBelow(ticks.reduce((a, b) => a + b, 0), next);
  for (let i = 0; i < ticks.length; i++) {
    if (r < ticks[i]) return i;
    r -= ticks[i];
  }
  return ticks.length - 1;
}

/** slices sized by weight, laid out clockwise from the pointer */
export function layout(weights: number[]): Segment[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return weights.map((w) => {
    const start = at;
    at += w / total;
    return { start, end: at };
  });
}

const mod1 = (x: number) => ((x % 1) + 1) % 1;

/**
 * Wheel rotation (in turns, clockwise) at which the pointer sits `fraction` of the
 * way through `segment`, at least `spins` full turns past `current`.
 */
export function landingRotation(current: number, segment: Segment, spins: number, fraction: number): number {
  const target = segment.start + fraction * (segment.end - segment.start);
  // a wheel turned by R shows its angle -R under the pointer
  return current + spins + mod1(-target - current);
}

/** index of the segment under the pointer at this rotation */
export function indexAt(rotation: number, segments: Segment[]): number {
  const a = mod1(-rotation);
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= a) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Ease-out that feels like friction: fast at first, then a long, slow crawl
 * past the last few slices. Monotonic, so the pointer never ticks backwards.
 */
export const spinEase = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 4;

/** color index per slice so neighbours never match, including last-to-first */
export function sliceColors(n: number, paletteSize: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i % paletteSize);
  if (n > 1 && out[n - 1] === out[0]) {
    for (let c = 0; c < paletteSize; c++) {
      if (c !== out[0] && c !== out[n - 2]) {
        out[n - 1] = c;
        break;
      }
    }
  }
  return out;
}

/** removes one line from the text, leaving the rest untouched */
export const removeLine = (text: string, line: number) => text.split(/\r?\n/).filter((_, i) => i !== line).join('\n');
