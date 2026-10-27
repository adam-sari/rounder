import { describe, expect, it } from 'vitest';
import { kWeighting, LoudnessMeter, type Loudness } from '@/tools/lib/loudness/lufs';
import { TruePeakMeter } from '@/tools/lib/loudness/truepeak';

const db = (x: number) => 10 ** (x / 20);

/** sine bursts back to back: [seconds, dBFS] pairs, same signal in every channel */
function tone(rate: number, parts: [number, number][], { freq = 997, channels = 2 } = {}) {
  const total = parts.reduce((n, [s]) => n + Math.round(s * rate), 0);
  const x = new Float32Array(total);
  let o = 0;
  for (const [s, level] of parts) {
    const amp = db(level);
    for (let i = 0; i < Math.round(s * rate); i++, o++) x[o] = amp * Math.sin((2 * Math.PI * freq * o) / rate);
  }
  return Array.from({ length: channels }, () => x.slice());
}

function measure(channels: Float32Array[], rate: number, chunk = 4096): Loudness {
  const m = new LoudnessMeter(rate, channels.length);
  for (let i = 0; i < channels[0].length; i += chunk) m.push(channels.map((c) => c.subarray(i, i + chunk)));
  return m.result();
}

describe('K-weighting', () => {
  it('matches the BS.1770 coefficient table at 48 kHz', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 10);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 10);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 10);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 10);
  });
});

describe('integrated loudness (BS.1770-4)', () => {
  it('reads a mono 997 Hz sine at −20 dBFS as −23.0 LUFS', () => {
    // a full-scale sine in one channel is −3.01 LUFS by definition, so −20 dBFS → −23.01
    expect(measure(tone(48000, [[20, -20]], { channels: 1 }), 48000).integrated).toBeCloseTo(-23.01, 1);
  });

  it('reads a stereo 1 kHz sine at −23 dBFS as −23.0 LUFS (EBU Tech 3341 case 1)', () => {
    expect(measure(tone(48000, [[20, -23]], { freq: 1000 }), 48000).integrated).toBeCloseTo(-23, 1);
  });

  it('gives the same answer at 44.1 kHz', () => {
    expect(measure(tone(44100, [[20, -23]], { freq: 1000 }), 44100).integrated).toBeCloseTo(-23, 1);
  });

  it('gates out quieter passages (EBU Tech 3341 cases 3 and 5)', () => {
    const case3 = tone(48000, [[10, -36], [60, -23], [10, -36]], { freq: 1000 });
    expect(measure(case3, 48000).integrated).toBeCloseTo(-23, 1);
    const case5 = tone(48000, [[20, -26], [20.1, -20], [20, -26]], { freq: 1000 });
    expect(measure(case5, 48000).integrated).toBeCloseTo(-23, 1);
  });

  it('ignores near-silence below the −70 LUFS absolute gate (EBU Tech 3341 case 4)', () => {
    const case4 = tone(48000, [[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]], { freq: 1000 });
    expect(measure(case4, 48000).integrated).toBeCloseTo(-23, 1);
  });

  it('weights surround channels and skips the LFE in 5.1', () => {
    const [x] = tone(48000, [[10, -23]], { freq: 1000, channels: 1 });
    const silent = new Float32Array(x.length);
    // the same tone in the LFE channel only measures as silence
    expect(measure([silent, silent, silent, x, silent, silent], 48000).integrated).toBe(-Infinity);
    // in one surround channel it reads 1.5 dB louder than in a front channel (weight 1.41)
    const front = measure([x, silent, silent, silent, silent, silent], 48000).integrated;
    const surround = measure([silent, silent, silent, silent, x, silent], 48000).integrated;
    expect(surround - front).toBeCloseTo(10 * Math.log10(1.41), 2);
  });

  it('does not depend on chunk size', () => {
    const x = tone(44100, [[5, -18], [5, -30]]);
    expect(measure(x, 44100, 1).integrated).toBeCloseTo(measure(x, 44100, 100_000).integrated, 6);
  });

  it('reports silence and too-short clips as −Infinity', () => {
    expect(measure([new Float32Array(48000 * 3)], 48000).integrated).toBe(-Infinity);
    expect(measure(tone(48000, [[0.3, -10]]), 48000).integrated).toBe(-Infinity);
  });
});

describe('loudness range (EBU Tech 3342)', () => {
  it.each([
    [-20, -30, 10],
    [-20, -15, 5],
    [-40, -20, 20],
  ])('%d then %d dBFS → %d LU', (a, b, lra) => {
    expect(measure(tone(48000, [[20, a], [20, b]], { freq: 1000 }), 48000).range).toBeCloseTo(lra, 0);
  });
});

/** smooth fade in and out, so the start and end don't ring like a click */
const ramp = (i: number, n: number, len = 256) => {
  const d = Math.min(i, n - 1 - i);
  return d >= len ? 1 : Math.sin((Math.PI / 2) * (d / len)) ** 2;
};

describe('true peak', () => {
  it('finds a peak that falls between samples', () => {
    // fs/4 sine shifted by 45°: every sample sits at ±0.707 of the real peak
    const rate = 48000;
    const x = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((Math.PI / 2) * i + Math.PI / 4) * ramp(i, rate));
    const r = measure([x], rate);
    expect(r.samplePeak).toBeCloseTo(20 * Math.log10(0.5 * Math.SQRT1_2), 2);
    expect(r.truePeak).toBeCloseTo(20 * Math.log10(0.5), 1);
  });

  it('never reads below the sample peak and stays accurate at low frequencies', () => {
    const m = new TruePeakMeter();
    m.push(Float32Array.from({ length: 48000 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 100 * i) / 48000 + 0.3)));
    m.flush();
    expect(m.peak).toBeGreaterThanOrEqual(m.sample);
    expect(m.peak).toBeCloseTo(0.8, 3);
  });
});
