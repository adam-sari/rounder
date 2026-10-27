import { intervalPeak, TAPS } from './truepeak';

export interface LimiterOptions {
  /** gain applied before limiting */
  gainDb?: number;
  /** true-peak ceiling in dBTP */
  ceilingDb?: number;
  /** how early the gain starts to dip before a peak */
  lookaheadMs?: number;
  /** how quickly the gain recovers afterwards */
  releaseMs?: number;
  onProgress?: (p: number) => void;
}

/**
 * Applies a gain, then a look-ahead brickwall limiter, in place. The detector looks at the
 * 4×-oversampled signal, so in-between (true) peaks are held under the ceiling as well as the
 * samples. Gain dips start `lookahead` early and fade with a raised edge, so there are no
 * clicks, then recover over `release`. Material that stays under the ceiling is only scaled.
 * Returns the deepest gain reduction in dB (0 when nothing was limited).
 */
export function limit(channels: Float32Array[], sampleRate: number, o: LimiterOptions = {}): number {
  const n = channels[0]?.length ?? 0;
  const gain = 10 ** ((o.gainDb ?? 0) / 20);
  const ceiling = 10 ** ((o.ceilingDb ?? -1) / 20);
  // the window must outlast the interpolator so the detector never reads a sample already written
  const L = Math.max(TAPS, Math.round(((o.lookaheadMs ?? 5) * sampleRate) / 1000));
  const delay = L - 1;
  const release = 1 - Math.exp(-1000 / ((o.releaseMs ?? 120) * sampleRate));

  // sliding minimum of the wanted gain over the last L samples (monotonic deque in a ring)
  const dqIndex = new Int32Array(L + 1);
  const dqValue = new Float64Array(L + 1);
  let head = 0;
  let tail = 0;
  // moving average of that minimum over L samples: the dip ramps in before each peak
  const box = new Float64Array(L).fill(1);
  let boxSum = L;
  let env = 1;
  let deepest = 1;
  let prevInterval = 0;
  const every = Math.max(1, sampleRate * 5);

  for (let i = 0; i < n + delay; i++) {
    let want = 1;
    if (i < n) {
      // a peak between i and i+1 is shared by both neighbours
      let peak = 0;
      let interval = 0;
      for (const x of channels) {
        peak = Math.max(peak, Math.abs(x[i]));
        interval = Math.max(interval, intervalPeak(x, i));
      }
      peak = Math.max(peak, interval, prevInterval) * gain;
      prevInterval = interval;
      if (peak > ceiling) want = ceiling / peak;
    }
    if (tail !== head && dqIndex[head] <= i - L) head = (head + 1) % (L + 1);
    while (tail !== head && dqValue[(tail + L) % (L + 1)] >= want) tail = (tail + L) % (L + 1);
    dqIndex[tail] = i;
    dqValue[tail] = want;
    tail = (tail + 1) % (L + 1);

    const slot = i % L;
    boxSum += dqValue[head] - box[slot];
    box[slot] = dqValue[head];
    const target = boxSum / L;
    // every value averaged here is ≤ the wanted gain at i − delay, so the dip is always deep enough
    env = target < env ? target : env + (target - env) * release;

    const at = i - delay;
    if (at >= 0) {
      const g = gain * env;
      for (const x of channels) x[at] = Math.max(-ceiling, Math.min(ceiling, x[at] * g));
      if (env < deepest) deepest = env;
    }
    if (o.onProgress && i % every === 0) o.onProgress(Math.min(1, i / n));
  }
  return deepest < 1 ? -20 * Math.log10(deepest) : 0;
}
