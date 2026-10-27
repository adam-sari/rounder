import { TruePeakMeter } from './truepeak';

/*
 * Loudness metering, pure and streaming: ITU-R BS.1770-4 integrated loudness (K-weighting,
 * 400 ms blocks with 75% overlap, −70 LUFS absolute and −10 LU relative gates), EBU Tech 3342
 * loudness range, and sample/true peak. Push planar chunks of any size, then read result().
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The two K-weighting stages (head-related high shelf, then the RLB high-pass) for any sample
 * rate. Derived from the analog prototypes as libebur128 does, so at 48 kHz they match the
 * coefficient table in BS.1770 and other rates aren't approximations of it.
 */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highPass = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highPass];
}

/** BS.1770 channel weights: surrounds count 1.41×, the LFE of a 5.1 mix (L R C LFE Ls Rs) not at all */
export function channelWeights(count: number): number[] {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (count === 5) return [1, 1, 1, 1.41, 1.41];
  return Array(count).fill(1);
}

export interface Loudness {
  /** integrated loudness in LUFS; -Infinity for silence or clips under 0.4 s */
  integrated: number;
  /** loudness range in LU (0 when too short to tell) */
  range: number;
  /** dBTP */
  truePeak: number;
  /** dBFS */
  samplePeak: number;
  channels: number;
  durationSec: number;
}

const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
const toDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

/** gated mean of block loudness: blocks under the absolute gate, then under (mean − offset), are dropped */
function gatedMean(energies: number[], relativeOffset: number): { mean: number; kept: number[] } {
  const ABS = 10 ** ((-70 + 0.691) / 10);
  const loud = energies.filter((z) => z > ABS);
  if (!loud.length) return { mean: 0, kept: [] };
  const rel = (loud.reduce((a, b) => a + b, 0) / loud.length) * 10 ** (-relativeOffset / 10);
  const kept = loud.filter((z) => z > rel);
  return { mean: kept.reduce((a, b) => a + b, 0) / kept.length, kept };
}

export class LoudnessMeter {
  /** samples per 100 ms sub-block; gating blocks are 4 of these, short-term windows 30 */
  private readonly step: number;
  private readonly weights: number[];
  private readonly filters: [Biquad, Biquad];
  /** direct-form II transposed state, 4 values per channel */
  private readonly state: Float64Array;
  private readonly peaks: TruePeakMeter[];
  /** weighted sum of squares of each finished sub-block */
  private readonly subs: number[] = [];
  private acc = 0;
  private filled = 0;
  private frames = 0;

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    this.step = Math.max(1, Math.round(sampleRate / 10));
    this.weights = channelWeights(channels);
    this.filters = kWeighting(sampleRate);
    this.state = new Float64Array(channels * 4);
    this.peaks = Array.from({ length: channels }, () => new TruePeakMeter());
  }

  push(chunk: Float32Array[]) {
    const n = chunk[0]?.length ?? 0;
    const [s, h] = this.filters;
    for (let c = 0; c < this.channels; c++) this.peaks[c].push(chunk[c]);
    let i = 0;
    while (i < n) {
      const end = Math.min(n, i + this.step - this.filled);
      for (let c = 0; c < this.channels; c++) {
        const w = this.weights[c];
        if (!w) continue;
        const x = chunk[c];
        const o = c * 4;
        let z1 = this.state[o];
        let z2 = this.state[o + 1];
        let z3 = this.state[o + 2];
        let z4 = this.state[o + 3];
        let sum = 0;
        for (let k = i; k < end; k++) {
          const v = x[k];
          const y1 = s.b0 * v + z1;
          z1 = s.b1 * v - s.a1 * y1 + z2;
          z2 = s.b2 * v - s.a2 * y1;
          const y2 = y1 + z3;
          z3 = -2 * y1 - h.a1 * y2 + z4;
          z4 = y1 - h.a2 * y2;
          sum += y2 * y2;
        }
        this.state[o] = z1;
        this.state[o + 1] = z2;
        this.state[o + 2] = z3;
        this.state[o + 3] = z4;
        this.acc += w * sum;
      }
      this.filled += end - i;
      i = end;
      if (this.filled === this.step) {
        this.subs.push(this.acc);
        this.acc = 0;
        this.filled = 0;
      }
    }
    this.frames += n;
  }

  /** mean-square energy of every window `len` sub-blocks long, one per sub-block */
  private windows(len: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let k = 0; k < this.subs.length; k++) {
      sum += this.subs[k];
      if (k >= len) sum -= this.subs[k - len];
      if (k >= len - 1) out.push(Math.max(0, sum) / (len * this.step));
    }
    return out;
  }

  result(): Loudness {
    for (const p of this.peaks) p.flush();
    const integrated = gatedMean(this.windows(4), 10).mean;
    // EBU Tech 3342: 3 s short-term windows, −20 LU relative gate, spread between the 10th and 95th percentiles
    const st = gatedMean(this.windows(30), 20).kept.map(toLufs).sort((a, b) => a - b);
    const pct = (p: number) => st[Math.round((st.length - 1) * p)];
    return {
      integrated: integrated > 0 ? toLufs(integrated) : -Infinity,
      range: st.length > 1 ? pct(0.95) - pct(0.1) : 0,
      truePeak: toDb(Math.max(0, ...this.peaks.map((p) => p.peak))),
      samplePeak: toDb(Math.max(0, ...this.peaks.map((p) => p.sample))),
      channels: this.channels,
      durationSec: this.frames / this.sampleRate,
    };
  }
}
