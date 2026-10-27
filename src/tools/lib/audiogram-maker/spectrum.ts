/**
 * Per-frame spectrum for the audiogram visualizer: a Hann-windowed FFT every video frame,
 * folded into log-spaced bands, normalised against the clip's own loudness and smoothed so
 * bars rise fast and fall gently. Pure maths, so the preview and the export read the same data.
 */

export const BANDS = 64;
export const FFT_SIZE = 2048;
/** the rate audio is decoded at for analysis; plenty for a picture of the sound */
export const ANALYSIS_RATE = 22050;
const LOW_HZ = 40;
const HIGH_HZ = 10500;
/** dB below the loud reference that maps to zero height */
const RANGE_DB = 45;
/** per-octave lift so cymbals and voices register next to the bass */
const TILT_DB = 3;
const ATTACK = 0.75;
const RELEASE = 0.22;

export interface Spectrum {
  fps: number;
  frames: number;
  /** frames × BANDS, 0–1 */
  bands: Float32Array;
  /** per-frame loudness, 0–1 */
  level: Float32Array;
}

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** BANDS + 1 log-spaced edges in Hz between LOW_HZ and HIGH_HZ (capped below Nyquist) */
export function bandEdges(sampleRate: number, count = BANDS): Float64Array {
  const hi = Math.min(HIGH_HZ, sampleRate * 0.475);
  const edges = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) edges[i] = LOW_HZ * (hi / LOW_HZ) ** (i / count);
  return edges;
}

const dB = (power: number) => 10 * Math.log10(power + 1e-14);

/** dB value below which `q` of the values fall, via a 0.25 dB histogram */
function percentile(values: Float32Array, q: number): number {
  const lo = -140;
  const hist = new Uint32Array(4 * 200);
  for (const v of values) hist[Math.min(hist.length - 1, Math.max(0, Math.floor((v - lo) * 4)))]++;
  let want = values.length * q;
  for (let i = 0; i < hist.length; i++) {
    want -= hist[i];
    if (want <= 0) return lo + i / 4;
  }
  return lo + hist.length / 4;
}

export interface AnalyzeControl {
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
}

const pause = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Analyses mono `samples` into one spectrum frame per video frame. Yields to the event loop
 * between chunks so the page stays responsive on a ten-minute clip.
 */
export async function analyze(samples: Float32Array, sampleRate: number, fps: number, ctl: AnalyzeControl = {}): Promise<Spectrum> {
  const frames = Math.max(1, Math.round((samples.length / sampleRate) * fps));
  const raw = new Float32Array(frames * BANDS);
  const rawLevel = new Float32Array(frames);
  const window = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2);
  const binHz = sampleRate / FFT_SIZE;
  const edges = bandEdges(sampleRate);
  const tilt = Array.from({ length: BANDS }, (_, b) => TILT_DB * Math.log2(Math.sqrt(edges[b] * edges[b + 1]) / 1000));
  const hop = sampleRate / fps;
  const rmsSpan = Math.max(1, Math.round(hop));

  for (let f = 0; f < frames; f++) {
    if (f % 400 === 0) {
      if (ctl.signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
      ctl.onProgress?.(f / frames);
      if (f) await pause();
    }
    const centre = Math.round(f * hop + hop / 2);
    const from = centre - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[from + i];
      re[i] = s === undefined ? 0 : s * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < power.length; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BANDS; b++) {
      const k0 = edges[b] / binHz;
      const k1 = edges[b + 1] / binHz;
      let p: number;
      if (k1 - k0 < 1) {
        // narrower than a bin (the low end): interpolate at the band centre
        const c = (k0 + k1) / 2;
        const i = Math.floor(c);
        p = power[i] + (power[Math.min(i + 1, power.length - 1)] - power[i]) * (c - i);
      } else {
        let sum = 0;
        const a = Math.floor(k0);
        const z = Math.min(power.length, Math.ceil(k1));
        for (let k = a; k < z; k++) sum += power[k];
        p = sum / (z - a);
      }
      raw[f * BANDS + b] = dB(p) + tilt[b];
    }
    let sq = 0;
    const start = Math.round(f * hop);
    for (let i = 0; i < rmsSpan; i++) {
      const s = samples[start + i] ?? 0;
      sq += s * s;
    }
    rawLevel[f] = dB(sq / rmsSpan);
  }
  ctl.onProgress?.(1);
  return { fps, frames, bands: normalise(raw, BANDS, RANGE_DB), level: normalise(rawLevel, 1, 36) };
}

/** maps dB to 0–1 against the clip's loud end, then applies attack/release smoothing per column */
export function normalise(raw: Float32Array, columns: number, rangeDb: number): Float32Array {
  const out = new Float32Array(raw.length);
  const ref = percentile(raw, 0.995);
  // near-silent clips stay flat instead of amplifying the noise floor
  if (ref < -90) return out;
  const floor = ref - rangeDb;
  const rows = raw.length / columns;
  for (let c = 0; c < columns; c++) {
    let prev = 0;
    for (let r = 0; r < rows; r++) {
      const i = r * columns + c;
      const v = Math.min(1, Math.max(0, (raw[i] - floor) / rangeDb)) ** 1.6;
      prev += (v - prev) * (v > prev ? ATTACK : RELEASE);
      out[i] = prev;
    }
  }
  return out;
}

/** Spectrum frame for clip time `t`, resampled to `count` values (zeros outside the clip). */
export function frameBands(s: Spectrum | null, t: number, count: number, out: Float32Array = new Float32Array(count)): Float32Array {
  out.fill(0);
  if (!s) return out;
  const f = Math.floor(t * s.fps + 1e-6);
  if (f < 0 || f >= s.frames) return out;
  const base = f * BANDS;
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : (i / (count - 1)) * (BANDS - 1);
    const a = Math.floor(x);
    const b = Math.min(BANDS - 1, a + 1);
    out[i] = s.bands[base + a] + (s.bands[base + b] - s.bands[base + a]) * (x - a);
  }
  return out;
}

export function frameLevel(s: Spectrum | null, t: number): number {
  if (!s) return 0;
  const f = Math.floor(t * s.fps + 1e-6);
  return f >= 0 && f < s.frames ? s.level[f] : 0;
}
