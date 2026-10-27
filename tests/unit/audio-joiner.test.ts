import { describe, expect, it } from 'vitest';
import { estimateJoinBytes, joinFormats } from '@/tools/lib/audio-joiner/formats';
import { integratedLoudness, kWeighting, loudnessGainDb } from '@/tools/lib/audio-joiner/loudness';
import { conformChannels, fadeInGain, fadeOutGain, framePlan, mixTrack, outputLayout, planJoin } from '@/tools/lib/audio-joiner/mix';

const sine = (freq: number, rate: number, seconds: number, amp = 1) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
const ones = (n: number) => new Float32Array(n).fill(1);

describe('planJoin', () => {
  it('butts tracks together with no transition', () => {
    expect(planJoin([3, 4, 5], { kind: 'none', seconds: 2 })).toEqual({ offsets: [0, 3, 7], overlaps: [0, 0], total: 12 });
  });

  it('inserts silence between tracks', () => {
    expect(planJoin([3, 4], { kind: 'gap', seconds: 1.5 })).toEqual({ offsets: [0, 4.5], overlaps: [0], total: 8.5 });
  });

  it('overlaps tracks for a crossfade', () => {
    const p = planJoin([10, 10, 10], { kind: 'crossfade', seconds: 2 });
    expect(p.offsets).toEqual([0, 8, 16]);
    expect(p.total).toBe(26);
  });

  it('caps a crossfade at half of the shorter neighbour', () => {
    const p = planJoin([10, 3, 10], { kind: 'crossfade', seconds: 5 });
    expect(p.overlaps).toEqual([1.5, 1.5]);
    expect(p.total).toBe(20);
  });

  it('handles empty and single-track lists', () => {
    expect(planJoin([], { kind: 'crossfade', seconds: 2 }).total).toBe(0);
    expect(planJoin([7], { kind: 'gap', seconds: 2 })).toEqual({ offsets: [0], overlaps: [], total: 7 });
  });
});

describe('framePlan', () => {
  it('converts to frames with fades only at inner joins', () => {
    const lengths = [1, 1];
    const { tracks, total } = framePlan(planJoin(lengths, { kind: 'crossfade', seconds: 0.25 }), lengths, 100);
    expect(tracks).toEqual([
      { offset: 0, length: 100, fadeIn: 0, fadeOut: 25 },
      { offset: 75, length: 100, fadeIn: 25, fadeOut: 0 },
    ]);
    expect(total).toBe(175);
  });
});

describe('equal-power crossfade', () => {
  it('keeps power constant across the overlap', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(fadeInGain(t) ** 2 + fadeOutGain(t) ** 2).toBeCloseTo(1, 10);
    expect(fadeInGain(0)).toBe(0);
    expect(fadeOutGain(0)).toBe(1);
  });

  it('mixes two tracks with matching curves', () => {
    const rate = 100;
    const lengths = [1, 1];
    const { tracks, total } = framePlan(planJoin(lengths, { kind: 'crossfade', seconds: 0.2 }), lengths, rate);
    const out = [new Float32Array(total)];
    for (const t of tracks) mixTrack(out, [ones(t.length)], { ...t, gain: 1 });
    // outside the overlap each track plays at full level
    expect(out[0][10]).toBe(1);
    expect(out[0][total - 1]).toBe(1);
    // inside it, the two gains are sin/cos of the same position: squares sum to 1
    const a = tracks[1].offset;
    for (let i = 0; i < 20; i++) {
      const t = (i + 0.5) / 20;
      expect(out[0][a + i]).toBeCloseTo(fadeOutGain(t) + fadeInGain(t), 5);
    }
    // correlated material peaks at √2 in the middle of an equal-power fade
    expect(Math.max(...out[0])).toBeLessThanOrEqual(Math.SQRT2 + 1e-6);
  });

  it('applies gain, pads short sources and never writes past the buffer', () => {
    const out = [new Float32Array(10), new Float32Array(10)];
    mixTrack(out, [ones(3)], { offset: 6, length: 6, fadeIn: 0, fadeOut: 0, gain: 0.5 });
    expect([...out[0]]).toEqual([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0]);
    expect([...out[1]]).toEqual([...out[0]]);
  });
});

describe('channels and layout', () => {
  it('upmixes mono and folds surround to centred stereo', () => {
    const m = new Float32Array([0.5, -0.5]);
    expect(conformChannels([m], 2)).toEqual([m, m]);
    const st = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    expect(conformChannels(st, 2)).toBe(st);
    expect([...conformChannels(st, 1)[0]]).toEqual([0.5, 0.5]);
    const six = Array.from({ length: 6 }, () => new Float32Array([0.6]));
    const folded = conformChannels(six, 2);
    expect(folded).toHaveLength(2);
    expect(folded[0][0]).toBeCloseTo(0.6);
  });

  it('picks the highest rate (capped at 48 kHz) and stereo when any track is', () => {
    expect(outputLayout([{ sampleRate: 22050, channels: 1 }, { sampleRate: 44100, channels: 2 }])).toEqual({ sampleRate: 44100, channels: 2 });
    expect(outputLayout([{ sampleRate: 96000, channels: 1 }])).toEqual({ sampleRate: 48000, channels: 1 });
    expect(outputLayout([{ sampleRate: 0, channels: 1 }])).toEqual({ sampleRate: 8000, channels: 1 });
  });
});

describe('loudness (BS.1770)', () => {
  it('matches the published 48 kHz K-weighting coefficients', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 8);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 8);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 8);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 8);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 8);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 8);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 8);
  });

  it('reads a full-scale 997 Hz tone as −3 LUFS per channel', () => {
    const tone = sine(997, 48000, 5);
    expect(integratedLoudness([tone], 48000)).toBeCloseTo(-3.01, 1);
    expect(integratedLoudness([tone, tone], 48000)).toBeCloseTo(0, 1);
  });

  it('is sample-rate independent and scales with level', () => {
    const at44 = integratedLoudness([sine(997, 44100, 3, 0.1)], 44100);
    expect(at44).toBeCloseTo(-23.01, 1);
  });

  it('gates out silence', () => {
    const rate = 48000;
    const tone = sine(997, rate, 2, 0.1);
    const padded = new Float32Array(rate * 10);
    padded.set(tone, rate * 4);
    // ungated, 2 s of tone in 10 s would read 7 dB quieter; only blocks straddling the edges pull it down
    const gated = integratedLoudness([padded], rate);
    expect(gated).toBeLessThan(integratedLoudness([tone], rate));
    expect(gated).toBeGreaterThan(integratedLoudness([tone], rate) - 1);
    expect(integratedLoudness([new Float32Array(rate)], rate)).toBe(-Infinity);
  });

  it('measures clips shorter than one block', () => {
    expect(Number.isFinite(integratedLoudness([sine(997, 48000, 0.2, 0.5)], 48000))).toBe(true);
  });

  it('levels to the target without breaking the peak ceiling', () => {
    expect(loudnessGainDb(-26, 0.1)).toBeCloseTo(10);
    // −26 LUFS but peaking at 0.5: +10 dB would clip, so stop at −1 dBFS
    expect(loudnessGainDb(-26, 0.5)).toBeCloseTo(-1 - 20 * Math.log10(0.5));
    expect(loudnessGainDb(-Infinity, 0)).toBe(0);
    expect(loudnessGainDb(-10, 0.9)).toBeCloseTo(-6);
  });
});

describe('formats', () => {
  it('estimates sizes', () => {
    expect(estimateJoinBytes('mp3', 60, 192_000, 44100, 2)).toBe(1_440_000);
    expect(estimateJoinBytes('wav', 1, 0, 44100, 2)).toBe(176_444);
    expect(estimateJoinBytes('flac', 1, 0, 44100, 2)).toBeLessThan(176_444);
  });

  it('offers a default bitrate from each lossy ladder', () => {
    for (const f of Object.values(joinFormats)) if (f.bitrates.length) expect(f.bitrates).toContain(f.defaultBitrate);
  });
});
