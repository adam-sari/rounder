import { Fft, Framer, hann } from './fft';

/*
 * Tempo and beats. An onset-strength envelope (spectral flux of log magnitudes) is
 * autocorrelated; a comb over its first four multiples scores every tempo from 40 to 240 BPM, a
 * gentle preference for ~130 BPM settles half/double-time ties, and dynamic programming
 * (Ellis 2007) then places beats that agree with both the onsets and that tempo.
 */

const SIZE = 512;
const HOP = 128;
const MIN_BPM = 40;
const MAX_BPM = 240;
const BPM_STEP = 0.05;
const HARMONICS = 4;

/** streaming onset-strength envelope; feed it audio at the analysis rate */
export class OnsetEnvelope {
  readonly fps: number;
  /** seconds from frame start to the moment an onset registers, measured on click tracks */
  readonly latency: number;
  private readonly values: number[] = [];
  private readonly framer: Framer;

  constructor(readonly rate: number) {
    this.fps = rate / HOP;
    this.latency = (SIZE * 0.75) / rate;
    const fft = new Fft(SIZE);
    const win = hann(SIZE);
    const bins = SIZE / 2;
    const mag = new Float32Array(bins + 1);
    let prev = new Float32Array(bins + 1);
    let cur = new Float32Array(bins + 1);
    let first = true;
    this.framer = new Framer(SIZE, HOP, (frame) => {
      fft.magnitudes(frame, win, mag);
      let flux = 0;
      for (let k = 1; k <= bins; k++) {
        cur[k] = Math.log1p(100 * mag[k]);
        const d = cur[k] - prev[k];
        if (d > 0) flux += d;
      }
      this.values.push(first ? 0 : flux / bins);
      first = false;
      [prev, cur] = [cur, prev];
    });
  }

  push(x: Float32Array) {
    this.framer.push(x);
  }

  /** time in seconds of envelope frame i */
  time(i: number) {
    return (i * HOP) / this.rate + this.latency;
  }

  values32() {
    return Float32Array.from(this.values);
  }
}

/** subtract a moving average, keep the rises, scale to unit standard deviation */
export function normalizeEnvelope(env: Float32Array, fps: number): Float32Array {
  const n = env.length;
  const r = Math.max(1, Math.round(fps * 0.25));
  const out = new Float32Array(n);
  // prefix sums keep the moving average O(n)
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + env[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    out[i] = Math.max(0, env[i] - (sums[b] - sums[a]) / (b - a));
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += out[i] * out[i];
  const sd = Math.sqrt(sq / Math.max(1, n));
  if (sd > 0) for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/** unbiased autocorrelation of the mean-removed signal for lags 0…maxLag, scaled so lag 0 is 1 */
export function autocorrelate(x: Float32Array, maxLag: number): Float64Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= Math.max(1, n);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = x[i] - mean;
  const lags = Math.min(maxLag, n - 1);
  const acf = new Float64Array(lags + 1);
  for (let lag = 0; lag <= lags; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    acf[lag] = s / (n - lag);
  }
  const zero = acf[0] || 1;
  for (let lag = 0; lag <= lags; lag++) acf[lag] /= zero;
  return acf;
}

function at(acf: Float64Array, lag: number) {
  const i = Math.floor(lag);
  if (i + 1 >= acf.length) return 0;
  const f = lag - i;
  return acf[i] * (1 - f) + acf[i + 1] * f;
}

/**
 * log-normal preference about an octave wide. The comb scores half time as high as the real
 * tempo (every other beat still lines up), so the centre sits a little above 120 to land dance
 * music on 128 or 174 rather than 64 or 87.
 */
const prior = (bpm: number) => Math.exp(-0.5 * Math.log2(bpm / 130) ** 2);

/** comb-filter strength of each tempo, before the prior */
export function combScores(acf: Float64Array, fps: number): { bpm: Float64Array; score: Float64Array } {
  const count = Math.round((MAX_BPM - MIN_BPM) / BPM_STEP) + 1;
  const bpm = new Float64Array(count);
  const score = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const b = MIN_BPM + i * BPM_STEP;
    const period = (60 * fps) / b;
    let s = 0;
    for (let k = 1; k <= HARMONICS; k++) s += at(acf, k * period);
    bpm[i] = b;
    score[i] = Math.max(0, s / HARMONICS);
  }
  return { bpm, score };
}

export interface Tempo {
  bpm: number;
  /** 0–1: how much the winning tempo stands out from the rest */
  confidence: number;
  /** beat times in seconds */
  beats: Float64Array;
}

/** tempo and beats from a raw onset envelope; null when there is nothing rhythmic to go on */
export function estimateTempo(raw: Float32Array, fps: number, frameTime: (i: number) => number): Tempo | null {
  const env = normalizeEnvelope(raw, fps);
  if (env.length < fps * 4 || !env.some((v) => v > 0)) return null;
  const acf = autocorrelate(env, Math.ceil(((60 * fps) / MIN_BPM) * HARMONICS) + 2);
  const comb = combScores(acf, fps);
  let best = -1;
  let bestWeighted = 0;
  for (let i = 0; i < comb.score.length; i++) {
    const w = comb.score[i] * prior(comb.bpm[i]);
    if (w > bestWeighted) {
      bestWeighted = w;
      best = i;
    }
  }
  if (best < 0) return null;
  const coarse = comb.bpm[best];
  const peak = comb.score[best];
  const sorted = Float64Array.from(comb.score).sort();
  const median = sorted[sorted.length >> 1];
  const confidence = Math.min(1, Math.max(0, (peak - median) / peak) * Math.min(1, peak / 0.25));

  const beats = trackBeats(env, (60 * fps) / coarse);
  // the beats pin the tempo down more finely than the comb, unless the tracker lost its way
  const refined = refineBpm(beats, fps);
  const bpm = refined && Math.abs(refined - coarse) < coarse * 0.04 ? refined : coarse;
  return { bpm, confidence, beats: Float64Array.from(beats, frameTime) };
}

/** average beat spacing (in BPM) over runs of steady beats; skips gaps and doubled beats */
function refineBpm(beats: number[], fps: number): number | null {
  if (beats.length < 8) return null;
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  const typical = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
  const steady = gaps.filter((g) => Math.abs(g - typical) < typical * 0.15);
  if (steady.length < 4) return null;
  return (60 * fps) / (steady.reduce((s, g) => s + g, 0) / steady.length);
}

/**
 * Ellis-style dynamic-programming beat tracker: each beat's score is its onset strength plus the
 * best earlier beat, penalised by how far the gap strays (in log time) from `period` frames.
 */
export function trackBeats(env: Float32Array, period: number, tightness = 100): number[] {
  const n = env.length;
  // smooth with a narrow Gaussian so beats land on onset peaks, not single noisy frames
  const sigma = Math.max(1, period / 32);
  const r = Math.ceil(sigma * 3);
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) {
      const k = i + j;
      if (k >= 0 && k < n) s += env[k] * Math.exp(-0.5 * (j / sigma) ** 2);
    }
    local[i] = s;
  }
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const v = cum[tau] - tightness * Math.log((t - tau) / period) ** 2;
      if (from < 0 || v > best) {
        best = v;
        from = tau;
      }
    }
    cum[t] = local[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  // end on the strongest beat within the final period
  let end = n - 1;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) if (cum[t] > cum[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  return trimQuiet(beats, local);
}

/** drop beats in the silent lead-in and tail, where the tracker only extrapolates */
function trimQuiet(beats: number[], local: Float64Array): number[] {
  if (beats.length < 3) return beats;
  const strengths = beats.map((b) => local[b]).sort((a, b) => a - b);
  const floor = strengths[strengths.length >> 1] * 0.1;
  let a = 0;
  let b = beats.length;
  while (a < b && local[beats[a]] < floor) a++;
  while (b > a && local[beats[b - 1]] < floor) b--;
  return beats.slice(a, b);
}
