/**
 * Pitch detection with the McLeod pitch method (McLeod & Wyvill, "A Smarter Way to Find Pitch",
 * 2005): the normalised square difference function (NSDF) of a block of samples, its first
 * strong peak, refined with a parabola. Pure functions, so they run the same in tests and live.
 */

export interface Pitch {
  freq: number;
  /** height of the chosen NSDF peak, 0–1; how periodic the block is */
  clarity: number;
}

export interface DetectOptions {
  sampleRate: number;
  minFreq?: number;
  maxFreq?: number;
  /** a peak counts once it reaches this share of the highest one; 0.9 dodges octave-down errors */
  threshold?: number;
  /** blocks less periodic than this give no pitch */
  minClarity?: number;
  /** blocks quieter than this RMS give no pitch */
  minRms?: number;
}

export function rms(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return x.length ? Math.sqrt(sum / x.length) : 0;
}

/** NSDF for lags 0..maxLag; `out` can be reused between calls to spare the garbage collector */
export function nsdf(x: Float32Array, maxLag: number, out = new Float32Array(maxLag + 1)) {
  const n = x.length;
  // m(τ) = Σ x[j]² + x[j+τ]² over the overlap, kept as a running total as the overlap shrinks
  let m = 0;
  for (let j = 0; j < n; j++) m += 2 * x[j] * x[j];
  for (let tau = 0; tau <= maxLag; tau++) {
    if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
    let acf = 0;
    for (let j = 0, end = n - tau; j < end; j++) acf += x[j] * x[j + tau];
    out[tau] = m > 1e-12 ? (2 * acf) / m : 0;
  }
  return out;
}

/** vertex of the parabola through (-1, a), (0, b), (1, c): [offset, height] */
function parabola(a: number, b: number, c: number): [number, number] {
  const den = a - 2 * b + c;
  if (den >= 0) return [0, b];
  const shift = (a - c) / (2 * den);
  return [shift, b - ((a - c) * shift) / 4];
}

const scratch = new Map<number, Float32Array<ArrayBuffer>>();

export function detectPitch(x: Float32Array, opts: DetectOptions): Pitch | null {
  const { sampleRate, minFreq = 30, maxFreq = 2000, threshold = 0.9, minClarity = 0.8, minRms = 0.004 } = opts;
  if (rms(x) < minRms) return null;
  // keep at least ~40% of the block overlapping at the longest lag
  const maxLag = Math.min(Math.ceil(sampleRate / minFreq) + 1, Math.floor(x.length * 0.6));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  let buf = scratch.get(maxLag);
  if (!buf) scratch.set(maxLag, (buf = new Float32Array(maxLag + 1)));
  const r = nsdf(x, maxLag, buf);

  // the highest point of each positive lobe after the one around lag 0
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && r[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && r[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxLag && r[tau] > 0) {
      if (best < 0 || r[tau] > r[best]) best = tau;
      tau++;
    }
    if (best >= minLag && best < maxLag) peaks.push(best);
  }
  if (!peaks.length) return null;

  let top = 0;
  for (const p of peaks) top = Math.max(top, r[p]);
  const pick = peaks.find((p) => r[p] >= threshold * top)!;
  const [shift, clarity] = parabola(r[pick - 1], r[pick], r[pick + 1]);
  if (clarity < minClarity) return null;
  const freq = sampleRate / (pick + shift);
  return freq >= minFreq && freq <= maxFreq ? { freq, clarity: Math.min(1, clarity) } : null;
}
