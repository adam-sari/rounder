import { describe, expect, it } from 'vitest';
import { MediaError } from '@/engines/media/types';
import { clock, describeMedia, errorMessage, level, signed, timing } from '@/tools/lib/loudness/format';
import { limit } from '@/tools/lib/loudness/limiter';
import { LoudnessMeter } from '@/tools/lib/loudness/lufs';
import { formatSupport, planGain, sameAudioFormat, targetLufs, videoContainer, wavCodec, DEFAULT_SETTINGS } from '@/tools/lib/loudness/presets';
import type { Capabilities } from '@/engines/media/types';

const RATE = 48000;
const sine = (freq: number, amp: number, seconds = 1, phase = 0) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE + phase));

function measure(channels: Float32Array[]) {
  const m = new LoudnessMeter(RATE, channels.length);
  m.push(channels);
  return m.result();
}

const dbOf = (x: number) => 20 * Math.log10(x);

describe('true-peak limiter', () => {
  it('only scales audio that stays under the ceiling', () => {
    const x = sine(440, 0.25);
    const y = x.slice();
    expect(limit([y], RATE, { gainDb: 6, ceilingDb: -1 })).toBe(0);
    for (let i = 0; i < x.length; i += 997) expect(y[i]).toBeCloseTo(x[i] * 10 ** (6 / 20), 6);
  });

  it('holds a hot signal under the ceiling, including between samples', () => {
    for (const freq of [100, 1000, 11025]) {
      const y = sine(freq, 0.9, 1, Math.PI / 4);
      const reduction = limit([y, y.slice()], RATE, { gainDb: 12, ceilingDb: -1 });
      const after = measure([y]);
      expect(reduction).toBeGreaterThan(11);
      expect(after.samplePeak).toBeLessThanOrEqual(-1 + 1e-6);
      expect(after.truePeak).toBeLessThanOrEqual(-0.9);
      // and it isn't squashed far below the ceiling either
      expect(after.samplePeak).toBeGreaterThan(-3.5);
    }
  });

  it('leaves audio away from a loud burst alone and keeps the length', () => {
    const quiet = sine(300, 0.1, 2);
    const y = quiet.slice();
    for (let i = RATE; i < RATE + 480; i++) y[i] = 0.99 * Math.sign(Math.sin(i));
    limit([y], RATE, { gainDb: 6, ceilingDb: -1, releaseMs: 50 });
    expect(y.length).toBe(quiet.length);
    const g = 10 ** (6 / 20);
    // well before the burst (more than the look-ahead) and well after (release has recovered)
    expect(y[RATE - 2000]).toBeCloseTo(quiet[RATE - 2000] * g, 5);
    expect(y[RATE + 480 + RATE / 2]).toBeCloseTo(quiet[RATE + 480 + RATE / 2] * g, 3);
    expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    expect(y.every(Number.isFinite)).toBe(true);
  });

  it('starts dipping before a peak rather than after it', () => {
    const y = new Float32Array(RATE / 10);
    y[2400] = 2;
    for (let i = 2300; i < 2400; i++) y[i] = 0.5;
    limit([y], RATE, { ceilingDb: -1, lookaheadMs: 5 });
    expect(Math.abs(y[2400])).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    // the samples leading up to the spike are already turned down
    expect(y[2399]).toBeLessThan(0.5);
  });
});

describe('gain planning', () => {
  const m = (integrated: number, truePeak: number, channels = 2) => ({ integrated, truePeak, samplePeak: truePeak - 0.3, range: 6, channels, durationSec: 60 });

  it('reaches the target with plain gain when there is headroom', () => {
    const p = planGain(m(-20, -8), DEFAULT_SETTINGS);
    expect(p).toMatchObject({ target: -14, limited: false, shortBy: 0 });
    expect(p.gainDb).toBeCloseTo(6);
  });

  it('calls on the limiter, or stops short at the ceiling without it', () => {
    expect(planGain(m(-20, -3), DEFAULT_SETTINGS)).toMatchObject({ gainDb: 6, limited: true });
    const p = planGain(m(-20, -3), { ...DEFAULT_SETTINGS, limit: false });
    expect(p.gainDb).toBeCloseTo(2);
    expect(p.shortBy).toBeCloseTo(4);
  });

  it('turns loud files down', () => {
    expect(planGain(m(-9, 0.5), DEFAULT_SETTINGS).gainDb).toBeCloseTo(-5);
  });

  it('uses −19 LUFS for mono podcasts', () => {
    const s = { ...DEFAULT_SETTINGS, target: 'podcast' as const };
    expect(targetLufs(s, 1)).toBe(-19);
    expect(targetLufs(s, 2)).toBe(-16);
    expect(planGain(m(-25, -10, 1), s).gainDb).toBeCloseTo(6);
  });

  it('peak normalizes to the ceiling from the sample peak', () => {
    const p = planGain(m(-20, -6), { ...DEFAULT_SETTINGS, target: 'peak' });
    expect(p.target).toBeNull();
    expect(p.gainDb).toBeCloseTo(5.3);
  });

  it('leaves silence alone', () => {
    expect(planGain(m(-Infinity, -Infinity), DEFAULT_SETTINGS)).toMatchObject({ gainDb: 0, silent: true });
  });
});

describe('formats', () => {
  it('maps inputs to a matching output', () => {
    expect(sameAudioFormat('mp3')).toBe('mp3');
    expect(sameAudioFormat('mp4')).toBe('m4a');
    expect(sameAudioFormat('webm')).toBe('ogg');
    expect(sameAudioFormat('wma')).toBe('mp3');
    expect(videoContainer('mov')).toBe('mov');
    expect(videoContainer('avi')).toBe('mp4');
    expect(wavCodec('pcm-s24')).toBe('pcm-s24');
    expect(wavCodec('mp3')).toBe('pcm-s16');
  });

  it('only offers what the browser can encode', () => {
    const caps = { containers: { mp3: true, m4a: false, ogg: true }, audio: { encode: ['mp3', 'opus'] } } as unknown as Capabilities;
    expect(formatSupport('m4a', caps, 31).ok).toBe(false);
    expect(formatSupport('ogg', caps, 31).ok).toBe(true);
    expect(formatSupport('flac', caps, 31)).toMatchObject({ ok: true, note: expect.stringContaining('31 MB') });
    expect(formatSupport('wav', null, 31).ok).toBe(true);
  });
});

describe('formatting', () => {
  it('formats times, levels and estimates', () => {
    expect(clock(75.4)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
    expect(signed(6)).toBe('+6.0');
    expect(signed(-3.25)).toBe('−3.3');
    expect(signed(-0.01)).toBe('0.0');
    expect(level(-14.04)).toBe('−14.0');
    expect(level(-Infinity)).toBe('−∞');
    expect(timing(10_000, 0.25)).toEqual({ elapsed: '0:10', left: '0:30' });
    expect(timing(500, 0.5).left).toBeNull();
  });

  it('turns media errors into friendly text and stays quiet on cancel', () => {
    expect(errorMessage(new MediaError('aborted', 'Cancelled.'))).toBeNull();
    expect(errorMessage(new MediaError('no-tracks', 'x'))).toMatch(/no audio track/);
    expect(errorMessage(new MediaError('failed', 'Decoder exploded.'))).toBe('Decoder exploded.');
    expect(errorMessage(new RangeError('Array buffer allocation failed'))).toMatch(/memory/);
  });

  it('describes a file, leaving out the duration until it is known', () => {
    const audio = { codec: 'mp3', sampleRate: 44100, channels: 2 };
    expect(describeMedia({ durationSec: 75, audio } as never)).toBe('1:15 · MP3 44.1 kHz stereo');
    expect(describeMedia({ durationSec: 0, readable: false, needsFallback: true } as never)).toBe('');
  });
});

it('reports gain reduction in dB', () => {
  const y = sine(1000, 1);
  expect(limit([y], RATE, { ceilingDb: -6 })).toBeCloseTo(dbOf(1 / 10 ** (-6 / 20)), 0);
});
