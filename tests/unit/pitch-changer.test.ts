import { describe, expect, it } from 'vitest';
import { FFT } from '@/tools/lib/timestretch/fft';
import { SincResampler } from '@/tools/lib/timestretch/resampler';
import { frameSize, plan, semitonesToRatio, stretchChannels } from '@/tools/lib/timestretch/stretch';
import { intervalName, pitchSuffix, transposeKey } from '@/tools/lib/timestretch/labels';

const RATE = 44100;
const sine = (freq: number, seconds: number, amp = 0.5, phase = 0) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE + phase));

/** strongest frequency in the middle of `x`, refined by parabolic interpolation */
function dominant(x: Float32Array, n = 16384) {
  const fft = new FFT(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const from = Math.floor((x.length - n) / 2);
  for (let i = 0; i < n; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft.forward(re, im);
  const mag = (k: number) => Math.log(Math.hypot(re[k], im[k]) + 1e-12);
  let best = 1;
  for (let k = 1; k < n / 2; k++) if (mag(k) > mag(best)) best = k;
  const [a, b, c] = [mag(best - 1), mag(best), mag(best + 1)];
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * RATE) / n;
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

describe('FFT', () => {
  it('finds a bin-centred tone and round-trips', () => {
    const n = 1024;
    const fft = new FFT(n);
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 37 * i) / n));
    const orig = re.slice();
    const im = new Float64Array(n);
    fft.forward(re, im);
    expect(re[37]).toBeCloseTo(n / 2, 6);
    expect(re[n - 37]).toBeCloseTo(n / 2, 6);
    expect(Math.abs(re[36]) + Math.abs(im[38])).toBeLessThan(1e-6);
    fft.inverse(re, im);
    for (let i = 0; i < n; i += 97) expect(re[i] / n).toBeCloseTo(orig[i], 9);
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => new FFT(1000)).toThrow();
  });
});

describe('sinc resampler', () => {
  it('moves a tone by the step and keeps the length exact', () => {
    const x = sine(1000, 1);
    const r = new SincResampler(1.5, 1);
    const head = r.push([x.subarray(0, 10000)])[0];
    const rest = r.push([x.subarray(10000)])[0];
    const tail = r.flush()[0];
    const y = new Float32Array([...head, ...rest, ...tail]);
    expect(y.length).toBe(Math.round(x.length / 1.5));
    expect(dominant(y, 8192)).toBeCloseTo(1500, 0);
    expect(rms(y, 2000, y.length - 2000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('filters out what would alias when reading faster', () => {
    // 15 kHz read at 2× would land at 30 kHz, above Nyquist: it must be removed, not folded down
    const y = new SincResampler(2, 1).push([sine(15000, 1)])[0];
    expect(rms(y, 1000, y.length - 1000)).toBeLessThan(0.002);
  });
});

describe('pitch changer', () => {
  it('maps semitones and cents to frequency ratios', () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2, 12);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 12);
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 4);
    expect(semitonesToRatio(0, 100)).toBeCloseTo(semitonesToRatio(1), 12);
    expect(plan({ tempo: 1, pitch: 1.5 })).toEqual({ stretch: 1.5, step: 1.5 });
    expect(plan({ tempo: 1.25, pitch: 1.25 })).toEqual({ stretch: 1, step: 1.25 });
  });

  it('picks frame sizes by sound and sample rate', () => {
    expect(frameSize(44100, 'music')).toBe(4096);
    expect(frameSize(48000, 'music')).toBe(4096);
    expect(frameSize(48000, 'voice')).toBe(2048);
    expect(frameSize(22050, 'music')).toBe(2048);
  });

  for (const [semitones, cents] of [[5, 0], [-7, 0], [12, 0], [-12, 0], [2, 30]]) {
    it(`shifts a 440 Hz sine by ${semitones} st ${cents} ct without changing its length`, () => {
      const x = sine(440, 3);
      const ratio = semitonesToRatio(semitones, cents);
      const [y] = stretchChannels([x], { tempo: 1, pitch: ratio, fftSize: 4096 });
      expect(Math.abs(y.length - x.length)).toBeLessThanOrEqual(1);
      expect(dominant(y) / (440 * ratio)).toBeCloseTo(1, 2);
      // a steady tone keeps a steady level: no phasiness dips or swells
      expect(rms(y, 8000, y.length - 8000) / rms(x)).toBeGreaterThan(0.85);
      expect(rms(y, 8000, y.length - 8000) / rms(x)).toBeLessThan(1.15);
    });
  }

  it('keeps stereo channels in phase with each other', () => {
    const l = sine(330, 2);
    const r = sine(330, 2, 0.5, Math.PI / 2);
    const [yl, yr] = stretchChannels([l, r], { tempo: 1, pitch: semitonesToRatio(3), fftSize: 4096 });
    // a quarter-cycle offset between left and right should survive the shift
    let dot = 0;
    for (let i = 10000; i < yl.length - 10000; i++) dot += yl[i] * yr[i];
    const corr = dot / (rms(yl, 10000, yl.length - 10000) * rms(yr, 10000, yr.length - 10000) * (yl.length - 20000));
    expect(Math.abs(corr)).toBeLessThan(0.1);
    expect(dominant(yl)).toBeCloseTo(dominant(yr), 1);
  });

  it('names intervals, keys and files', () => {
    expect(intervalName(7)).toBe('perfect fifth up');
    expect(intervalName(-2)).toBe('whole step down');
    expect(intervalName(0)).toBe('original pitch');
    expect(transposeKey('A', 3)).toBe('C');
    expect(transposeKey('C', -1)).toBe('B');
    expect(transposeKey('F#', 12)).toBe('F#');
    expect(pitchSuffix(2, 0)).toBe('-pitch+2');
    expect(pitchSuffix(-3, -25)).toBe('-pitch-3.25');
    expect(pitchSuffix(0, 50)).toBe('-pitch+0.5');
  });
});
