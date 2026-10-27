/*
 * 4× oversampled peak detection (ITU-R BS.1770-4 Annex 2): the three in-between points of each
 * sample interval are rebuilt with a windowed-sinc interpolator, so peaks that land between
 * samples (and clip after a DAC or a lossy encoder) are seen too.
 */

/** taps per phase; the value at m + f reads x[m - 7] … x[m + 8] (flat within 0.05 dB up to 0.4 × the sample rate) */
export const TAPS = 16;
const HALF = TAPS / 2 - 1;
const PHASES = [0.25, 0.5, 0.75];

const besselI0 = (x: number) => {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
};

/** one row of TAPS coefficients per phase, Kaiser-windowed sinc, each normalised to unity DC gain */
export const PHASE_TAPS: Float64Array[] = PHASES.map((f) => {
  const beta = 6;
  const width = TAPS / 2 + 1;
  const row = Float64Array.from({ length: TAPS }, (_, i) => {
    const t = f - (i - HALF);
    const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
    return (sinc * besselI0(beta * Math.sqrt(1 - (t / width) ** 2))) / besselI0(beta);
  });
  const sum = row.reduce((a, b) => a + b, 0);
  return row.map((v) => v / sum);
});

/** largest |value| among the three points interpolated between x[n] and x[n + 1] */
export function intervalPeak(x: Float32Array, n: number): number {
  const start = n - HALF;
  let peak = 0;
  if (start >= 0 && start + TAPS <= x.length) {
    for (const h of PHASE_TAPS) {
      let v = 0;
      for (let k = 0; k < TAPS; k++) v += x[start + k] * h[k];
      if (v > peak) peak = v;
      else if (-v > peak) peak = -v;
    }
    return peak;
  }
  // near the edges, samples outside the buffer count as silence
  for (const h of PHASE_TAPS) {
    let v = 0;
    for (let k = 0; k < TAPS; k++) {
      const i = start + k;
      if (i >= 0 && i < x.length) v += x[i] * h[k];
    }
    peak = Math.max(peak, Math.abs(v));
  }
  return peak;
}

/** Streaming true-peak meter for one channel; chunks can be any length. */
export class TruePeakMeter {
  /** last TAPS samples, written twice so a full window is always contiguous */
  private ring = new Float64Array(TAPS * 2);
  private pos = 0;
  /** largest |sample| */
  sample = 0;
  /** largest |sample| or in-between point */
  peak = 0;

  push(x: Float32Array) {
    const ring = this.ring;
    let pos = this.pos;
    let peak = this.peak;
    let sample = this.sample;
    for (let i = 0; i < x.length; i++) {
      const s = x[i];
      if (s > sample) sample = s;
      else if (-s > sample) sample = -s;
      ring[pos] = ring[pos + TAPS] = s;
      pos = (pos + 1) % TAPS;
      // ring[pos … pos + TAPS) is now the window for the interval that starts TAPS - HALF - 1 samples back
      for (const h of PHASE_TAPS) {
        let v = 0;
        for (let k = 0; k < TAPS; k++) v += ring[pos + k] * h[k];
        if (v > peak) peak = v;
        else if (-v > peak) peak = -v;
      }
    }
    this.pos = pos;
    this.sample = sample;
    this.peak = Math.max(peak, sample);
  }

  /** feeds silence through so the last few intervals are measured too */
  flush() {
    this.push(new Float32Array(TAPS));
  }
}
