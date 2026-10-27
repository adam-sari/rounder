import { describe, expect, it } from 'vitest';
import { FFT } from '@/tools/lib/timestretch/fft';
import { PhaseVocoder } from '@/tools/lib/timestretch/vocoder';
import { memoryNote, outputFrames, stretchChannels } from '@/tools/lib/timestretch/stretch';
import { clampTempo, sliderToTempo, tapeSemitones, tempoSuffix, tempoToSlider } from '@/tools/lib/timestretch/labels';

const RATE = 44100;
const sine = (freq: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE));

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

/** frequency from zero crossings, as a second opinion that doesn't share the FFT */
function crossingFreq(x: Float32Array, from: number, to: number) {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
  return (n / 2) * (RATE / (to - from));
}

describe('audio speed changer', () => {
  for (const tempo of [0.5, 0.75, 1.25, 1.5, 2]) {
    it(`plays a 440 Hz sine at ${tempo}× with the pitch kept`, () => {
      const x = sine(440, 4);
      const [y] = stretchChannels([x], { tempo, pitch: 1, fftSize: 4096 });
      expect(y.length).toBe(outputFrames(x.length, tempo));
      expect(dominant(y)).toBeCloseTo(440, 0);
      expect(crossingFreq(y, 5000, y.length - 5000) / 440).toBeCloseTo(1, 2);
    });
  }

  it('changes the pitch with the speed in record mode', () => {
    const x = sine(440, 3);
    const [y] = stretchChannels([x], { tempo: 1.5, pitch: 1.5, fftSize: 4096 });
    expect(y.length).toBe(outputFrames(x.length, 1.5));
    expect(dominant(y, 8192)).toBeCloseTo(660, 0);
  });

  it('gives the same result however the input is chunked', () => {
    const x = sine(523.25, 1.5);
    const whole = new PhaseVocoder(1.3, 1, 2048);
    const a = [...whole.push([x])[0], ...whole.flush()[0]];
    const chunked = new PhaseVocoder(1.3, 1, 2048);
    const b: number[] = [];
    for (let at = 0; at < x.length; at += 777) b.push(...chunked.push([x.subarray(at, at + 777)])[0]);
    b.push(...chunked.flush()[0]);
    expect(b.length).toBe(a.length);
    expect(a.length).toBe(Math.round(x.length * 1.3));
    for (let i = 0; i < a.length; i += 501) expect(b[i]).toBeCloseTo(a[i], 6);
  });

  it('keeps stereo channels linked', () => {
    // right is the left at half level: the output must keep exactly that relation
    const l = sine(300, 2);
    const r = l.map((v) => v * 0.5);
    const [yl, yr] = stretchChannels([l, r], { tempo: 0.8, pitch: 1, fftSize: 4096 });
    for (let i = 1000; i < yl.length; i += 997) expect(yr[i]).toBeCloseTo(yl[i] * 0.5, 5);
  });

  it('passes audio through untouched at 1×', () => {
    const x = sine(440, 0.5);
    expect(stretchChannels([x], { tempo: 1, pitch: 1, fftSize: 4096 })[0]).toEqual(x);
  });

  it('handles very short and silent input', () => {
    for (const tempo of [0.5, 1.5]) {
      const [y] = stretchChannels([new Float32Array(100)], { tempo, pitch: 1, fftSize: 4096 });
      expect(y.length).toBe(outputFrames(100, tempo));
      expect(y.every((v) => v === 0)).toBe(true);
      expect(stretchChannels([new Float32Array(0)], { tempo, pitch: tempo, fftSize: 4096 })[0].length).toBe(0);
    }
  });

  it('warns about memory only for long files', () => {
    expect(memoryNote(240, 44100, 2, 0.5)).toBe('');
    expect(memoryNote(2 * 3600, 48000, 6, 1)).toMatch(/^long file: needs about [\d.]+ GB/);
  });

  it('handles the speed slider and labels', () => {
    expect(clampTempo(3)).toBe(2);
    expect(clampTempo(0.1)).toBe(0.5);
    expect(clampTempo(1.234)).toBe(1.23);
    expect(clampTempo(Number.NaN)).toBe(1);
    expect(sliderToTempo(tempoToSlider(1.5))).toBe(1.5);
    expect(tempoToSlider(0.5)).toBe(-1);
    expect(tempoSuffix(1.25)).toBe('-1.25x');
    expect(tapeSemitones(2)).toBe(12);
    expect(tapeSemitones(0.75)).toBe(-5);
  });
});
