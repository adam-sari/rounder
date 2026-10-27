/*
 * Integrated loudness (LUFS) after ITU-R BS.1770-4: K-weighting, 400 ms blocks with 75 %
 * overlap, an absolute gate at −70 LUFS and a relative gate 10 LU below the gated mean.
 * Mono and stereo only (every channel weighted 1), which is all the joiner produces.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** the two K-weighting stages (head-related high shelf, then RLB high-pass) for any sample rate */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // analog prototypes from libebur128, so rates other than 48 kHz get the same curve
  let K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  let Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  K = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const highPass = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highPass];
}

/** squared K-weighted samples of one channel, summed per 100 ms step */
function stepEnergy(x: Float32Array, stages: Biquad[], step: number): Float64Array {
  const out = new Float64Array(Math.ceil(x.length / step));
  const state = stages.map(() => [0, 0, 0, 0]); // x1 x2 y1 y2 per stage
  for (let i = 0; i < x.length; i++) {
    let v = x[i];
    for (let s = 0; s < stages.length; s++) {
      const f = stages[s];
      const z = state[s];
      const y = f.b0 * v + f.b1 * z[0] + f.b2 * z[1] - f.a1 * z[2] - f.a2 * z[3];
      z[1] = z[0];
      z[0] = v;
      z[3] = z[2];
      z[2] = y;
      v = y;
    }
    out[Math.floor(i / step)] += v * v;
  }
  return out;
}

const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** integrated loudness in LUFS; −Infinity for silence */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const frames = channels[0]?.length ?? 0;
  if (!frames) return -Infinity;
  const step = Math.max(1, Math.round(sampleRate * 0.1));
  const steps = channels.map((ch) => stepEnergy(ch, kWeighting(sampleRate), step));
  const nSteps = steps[0].length;
  // one 400 ms block per 100 ms hop; shorter clips are measured as a single block
  const perBlock = Math.min(4, nSteps);
  const blocks: number[] = [];
  for (let b = 0; b + perBlock <= nSteps; b++) {
    let sum = 0;
    for (const ch of steps) for (let k = b; k < b + perBlock; k++) sum += ch[k];
    const len = Math.min(frames, (b + perBlock) * step) - b * step;
    blocks.push(sum / len);
  }
  const mean = (list: number[]) => list.reduce((a, v) => a + v, 0) / list.length;
  const loud = blocks.filter((z) => toLufs(z) > -70);
  if (!loud.length) return -Infinity;
  const gate = toLufs(mean(loud)) - 10;
  const kept = loud.filter((z) => toLufs(z) > gate);
  return toLufs(mean(kept));
}

/**
 * Gain (dB) that brings a track to `target` LUFS without pushing its sample peak above
 * `ceilingDb`. Silent tracks are left alone.
 */
export function loudnessGainDb(lufs: number, peak: number, target = -16, ceilingDb = -1): number {
  if (!Number.isFinite(lufs) || !(peak > 0)) return 0;
  return Math.min(target - lufs, ceilingDb - 20 * Math.log10(peak));
}
