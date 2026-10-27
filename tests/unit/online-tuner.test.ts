import { describe, expect, it } from 'vitest';
import { detectPitch } from '@/tools/lib/pitch/mpm';
import { cents, clampA4, midiToFreq, nearestNote, parseNote } from '@/tools/lib/pitch/notes';
import { closestString, instrumentById, stringTargets } from '@/tools/lib/pitch/instruments';
import { PitchSmoother } from '@/tools/lib/pitch/smoother';

/** a tone with optional harmonics ([multiple, level]), a random phase and a little noise */
function tone(freq: number, sampleRate: number, n: number, harmonics: [number, number][] = [[1, 1]], noise = 0) {
  const x = new Float32Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const phase = 1.234;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const [k, level] of harmonics) s += level * Math.sin((2 * Math.PI * freq * k * i) / sampleRate + phase * k);
    x[i] = 0.3 * s + noise * rand();
  }
  return x;
}

const guitar: [number, number][] = [[1, 1], [2, 0.6], [3, 0.4], [4, 0.25], [5, 0.15]];

describe('pitch detection (McLeod)', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const freq of [82.41, 329.63, 440]) {
      it(`finds ${freq} Hz within half a cent at ${sampleRate} Hz`, () => {
        const p = detectPitch(tone(freq, sampleRate, 4096), { sampleRate });
        expect(p).not.toBeNull();
        expect(Math.abs(cents(p!.freq, freq))).toBeLessThan(0.5);
        expect(p!.clarity).toBeGreaterThan(0.95);
      });
      it(`finds ${freq} Hz with harmonics and noise at ${sampleRate} Hz`, () => {
        const p = detectPitch(tone(freq, sampleRate, 4096, guitar, 0.02), { sampleRate });
        expect(Math.abs(cents(p!.freq, freq))).toBeLessThan(0.5);
      });
    }
  }

  it('locks onto the fundamental even when it is weaker than the overtones', () => {
    const p = detectPitch(tone(110, 48000, 4096, [[1, 0.3], [2, 1], [3, 0.8]]), { sampleRate: 48000 });
    expect(Math.abs(cents(p!.freq, 110))).toBeLessThan(1);
  });

  it('finds the low B of a five-string bass', () => {
    const p = detectPitch(tone(30.87, 48000, 4096, guitar), { sampleRate: 48000, minFreq: 28 });
    expect(Math.abs(cents(p!.freq, 30.87))).toBeLessThan(1);
  });

  it('stays quiet on silence and on noise', () => {
    expect(detectPitch(new Float32Array(4096), { sampleRate: 48000 })).toBeNull();
    expect(detectPitch(tone(440, 48000, 4096, [[1, 0]], 0.3), { sampleRate: 48000 })).toBeNull();
  });
});

describe('notes', () => {
  it('names notes and measures cents', () => {
    expect(nearestNote(440)).toEqual({ midi: 69, name: 'A', octave: 4, cents: 0 });
    const e = nearestNote(82.41);
    expect([e.name, e.octave]).toEqual(['E', 2]);
    expect(Math.abs(e.cents)).toBeLessThan(0.1);
    const sharp = nearestNote(440 * 2 ** (10 / 1200));
    expect(sharp.name).toBe('A');
    expect(sharp.cents).toBeCloseTo(10, 6);
    expect(nearestNote(277.18).name).toBe('C♯');
  });
  it('follows the reference pitch', () => {
    expect(midiToFreq(69, 432)).toBe(432);
    expect(nearestNote(432, 432).cents).toBeCloseTo(0, 9);
    expect(nearestNote(440, 432).cents).toBeCloseTo(31.77, 2);
    expect(clampA4(450)).toBe(446);
    expect(clampA4(Number.NaN)).toBe(440);
  });
  it('parses note names', () => {
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('E2')).toBe(40);
    expect(parseNote('C#4')).toBe(61);
    expect(parseNote('Bb3')).toBe(58);
    expect(() => parseNote('H2')).toThrow();
  });
});

describe('instruments', () => {
  it('has correct open strings', () => {
    const f = stringTargets(instrumentById('guitar')).map((t) => +t.freq.toFixed(2));
    expect(f).toEqual([82.41, 110, 146.83, 196, 246.94, 329.63]);
    expect(stringTargets(instrumentById('drop-d'))[0].freq).toBeCloseTo(73.42, 2);
    expect(stringTargets(instrumentById('bass'))[0].freq).toBeCloseTo(41.2, 2);
  });
  it('picks the closest string', () => {
    const t = stringTargets(instrumentById('guitar'));
    expect(closestString(84, t)?.index).toBe(0);
    expect(closestString(240, t)?.index).toBe(4);
    expect(closestString(100, [])).toBeNull();
  });
  it('falls back to standard guitar for an unknown id', () => {
    expect(instrumentById('banjo').id).toBe('guitar');
  });
});

describe('smoothing', () => {
  it('ignores a one-off octave slip', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 5; i++) s.push(440);
    expect(s.push(880)).toBeCloseTo(440, 6);
  });
  it('snaps to a new note once it holds', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 5; i++) s.push(440);
    let out = 0;
    for (let i = 0; i < 3; i++) out = s.push(330)!;
    expect(out).toBeCloseTo(330, 6);
  });
  it('eases small changes in', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 5; i++) s.push(440);
    for (let i = 0; i < 3; i++) s.push(442);
    const mid = s.push(442)!;
    expect(mid).toBeGreaterThan(440);
    expect(mid).toBeLessThan(442);
  });
  it('holds through short dropouts, then clears', () => {
    const s = new PitchSmoother(5, 0.35, 3);
    s.push(440);
    expect(s.push(null)).toBeCloseTo(440, 6);
    s.push(null);
    s.push(null);
    expect(s.push(null)).toBeNull();
  });
});
