// Compress a PDF to a size: estimate from a few sample images, then as few full passes as it takes.
import { partsFor, sizeText } from '@/tools/lib/exact-size/target';

export interface Rung {
  dpi: number;
  quality: number;
}

/** image resolution and JPEG quality, sharpest first; each rung is smaller than the one before */
export const LADDER: Rung[] = [
  { dpi: 200, quality: 80 },
  { dpi: 150, quality: 75 },
  { dpi: 150, quality: 60 },
  { dpi: 120, quality: 55 },
  { dpi: 100, quality: 50 },
  { dpi: 85, quality: 45 },
  { dpi: 72, quality: 40 },
  { dpi: 60, quality: 35 },
  { dpi: 50, quality: 30 },
];

/** what the sample tells us about a file's images */
export interface ImageSample {
  /** image XObjects in the file */
  found: number;
  /** the ones we can recompress, and their bytes as stored */
  candidates: number;
  candidateBytes: number;
  /** each sampled image: its bytes now, and at each rung (unchanged where a rung wouldn't shrink it) */
  samples: { before: number; after: number[] }[];
  /** sampled images this browser failed to decode or redraw at some rung (a broken codec, not a big photo) */
  unreadable?: number;
}

const sum = (list: number[]) => list.reduce((s, n) => s + n, 0);

/**
 * Expected output size at each rung: everything that isn't a recompressible image stays as the lossless pass left it,
 * and the images shrink by the same share as the sampled ones (weighted by bytes, so big photos count most).
 */
export function estimateSizes(s: ImageSample, lossless: number, rungs = LADDER.length): number[] {
  const fixed = Math.max(0, lossless - s.candidateBytes);
  const before = sum(s.samples.map((x) => x.before));
  return Array.from({ length: rungs }, (_, i) =>
    before ? Math.round(fixed + (s.candidateBytes * sum(s.samples.map((x) => x.after[i] ?? x.before))) / before) : lossless,
  );
}

export interface Attempt<T> {
  rung: number;
  size: number;
  out: T;
}

/** aim a little under the target: real passes land within a few percent of the estimate */
const AIM = 0.97;

/**
 * Finds the sharpest rung whose full pass fits `target` bytes, in at most `maxPasses` passes. Each pass rescales the
 * remaining estimates by how far off the last one was. When nothing fits, the smallest attempt is returned.
 */
export async function searchLadder<T>(
  target: number,
  estimates: number[],
  pass: (rung: number, attempt: number) => Promise<{ size: number; out: T }>,
  maxPasses = 3,
): Promise<{ best: Attempt<T>; fits: boolean; tries: Omit<Attempt<T>, 'out'>[] }> {
  // only the best output is kept: each one is a whole PDF, and a big file can't afford three in memory
  const tries: Omit<Attempt<T>, 'out'>[] = [];
  let best: Attempt<T> | undefined;
  const better = (a: Attempt<T>, b: Attempt<T>) => {
    const [fa, fb] = [a.size <= target, b.size <= target];
    return fa !== fb ? fa : fa ? a.rung < b.rung : a.size < b.size;
  };
  let over = -1; // the smallest rung known to overshoot
  let fit = estimates.length; // the sharpest rung known to fit
  let scale = 1;
  const pick = () => {
    for (let i = over + 1; i < fit; i++) if (estimates[i] * scale <= target * AIM) return i;
    // nothing is expected to fit: the smallest rung is the last hope, unless something already fits
    return fit === estimates.length && over < estimates.length - 1 ? estimates.length - 1 : -1;
  };
  for (let i = pick(); i >= 0 && tries.length < maxPasses; i = pick()) {
    const { size, out } = await pass(i, tries.length + 1);
    tries.push({ rung: i, size });
    const now = { rung: i, size, out };
    if (!best || better(now, best)) best = now;
    if (estimates[i] > 0) scale = size / estimates[i];
    if (size <= target) fit = i;
    else over = i;
    if (fit === over + 1) break;
  }
  return { best: best!, fits: best!.size <= target, tries };
}

/** why a PDF couldn't get under the target, and how many parts a split would need */
export function missReason(o: { target: number; size: number; lossless: number; candidateBytes: number; candidates: number; grayscale: boolean; unreadable?: boolean }) {
  const fixed = Math.max(0, o.lossless - o.candidateBytes);
  const parts = partsFor(o.size, o.target);
  let why: string;
  if (o.unreadable) why = `This browser couldn't recompress the photos in this PDF, so it stays at ${sizeText(o.size)}. Try a current Chrome, Edge, Firefox or Safari.`;
  else if (!o.candidates) why = `It has no photos we can shrink: its ${sizeText(o.size)} is text, fonts, drawings or images in formats we keep as they are.`;
  else if (fixed > o.target * 0.8) why = `Text, fonts and drawings alone take about ${sizeText(fixed)}. Only the photos can be shrunk without turning pages into pictures.`;
  else why = `Even with photos at ${LADDER.at(-1)!.dpi} dpi${o.grayscale ? ' in grayscale' : ''}, it comes to ${sizeText(o.size)}.`;
  return { why, parts };
}
