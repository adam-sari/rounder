import { describe, expect, it } from 'vitest';
import {
  applyEnvelope,
  busiestWindow,
  clampSection,
  DELAY_FRAMES,
  denoise,
  FRAME,
  finishPlan,
  frameStats,
  GATE,
  gateEnvelope,
  highpass,
  joinFrames,
  mergeStats,
  mergeVad,
  normalizeGainDb,
  OVERLAP,
  planChunks,
  PREVIEW_SEC,
  RATE,
  renderPreview,
  resampleSinc,
  sameChannels,
  stitch,
  toStereo,
  type Denoiser,
} from '@/tools/lib/audio-noise-reduction/dsp';
import { defaultFormat, unavailableReason, videoTarget, bitrateLabel } from '@/tools/lib/audio-noise-reduction/formats';
import type { Capabilities, MediaInfo } from '@/engines/media/types';
import def from '@/tools/defs/audio-noise-reduction';

const sine = (hz: number, sec: number, rate: number, amp = 0.5) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

/** behaves like RNNoise's timing: hands back what it was given two calls ago, scaled */
function delayingDenoiser(scale = 1, vad = () => 0.9): Denoiser {
  const queue: Float32Array[] = [];
  return (frame) => {
    queue.push(frame.slice());
    const out = queue.length > DELAY_FRAMES ? queue.shift()! : new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) frame[i] = out[i] * scale;
    return vad();
  };
}

describe('highpass', () => {
  it('removes rumble and keeps the voice band', () => {
    const low = sine(30, 2, RATE);
    const mid = sine(1000, 2, RATE);
    highpass(low, RATE);
    highpass(mid, RATE);
    const settled = RATE; // skip the filter's start-up
    expect(rms(low, settled)).toBeLessThan(0.5 * Math.SQRT1_2 * 0.2);
    expect(rms(mid, settled)).toBeCloseTo(0.5 * Math.SQRT1_2, 2);
  });
});

describe('resampleSinc', () => {
  it('returns the input untouched at the same rate', () => {
    const x = sine(440, 0.1, RATE);
    expect(resampleSinc(x, RATE, RATE)).toBe(x);
  });

  it('converts 44.1 kHz to 48 kHz cleanly', () => {
    const x = sine(1000, 1, 44_100);
    const y = resampleSinc(x, 44_100, RATE);
    expect(y.length).toBe(RATE);
    const want = sine(1000, 1, RATE);
    let err = 0;
    for (let i = 1000; i < y.length - 1000; i++) err = Math.max(err, Math.abs(y[i] - want[i]));
    expect(err).toBeLessThan(2e-3);
  });

  it('filters out what the lower rate cannot hold when downsampling', () => {
    const x = sine(30_000, 0.5, 96_000);
    const y = resampleSinc(x, 96_000, RATE);
    expect(rms(y, 1000, y.length - 1000)).toBeLessThan(0.01);
  });
});

describe('denoise', () => {
  it('re-aligns the delayed output with the input', () => {
    const x = sine(300, 0.5, RATE);
    const out = new Float32Array(x.length);
    denoise(x, out, delayingDenoiser());
    for (let i = 0; i < x.length; i += 997) expect(out[i]).toBeCloseTo(x[i], 4);
  });

  it('blends dry and wet in place', () => {
    const x = sine(300, 0.3, RATE);
    const dry = x.slice();
    denoise(x, x, delayingDenoiser(0), 0.75);
    for (let i = 0; i < x.length; i += 501) expect(x[i]).toBeCloseTo(0.25 * dry[i], 5);
  });

  it('returns one voice probability per frame, ending with progress 1', () => {
    const x = new Float32Array(FRAME * 10 + 7);
    let last = 0;
    const vad = denoise(x, new Float32Array(x.length), delayingDenoiser(1, () => 0.4), 1, (p) => (last = p));
    expect(vad.length).toBe(11);
    expect(vad[0]).toBeCloseTo(0.4);
    expect(last).toBe(1);
  });

  it('sends 16-bit sample values to the model', () => {
    let seen = 0;
    denoise(Float32Array.from({ length: FRAME }, () => 0.5), new Float32Array(FRAME), (f) => ((seen = Math.max(seen, f[0])), 0));
    expect(seen).toBe(16384);
  });
});

describe('parallel pieces', () => {
  it('splits long audio into frame-aligned pieces with pre-roll and lookahead', () => {
    const n = RATE * 95 + 123;
    const chunks = planChunks(n, 4);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toMatchObject({ from: 0, start: 0 });
    expect(chunks.at(-1)).toMatchObject({ to: n, end: n, tail: 0 });
    for (const [i, c] of chunks.entries()) {
      expect(c.from % FRAME).toBe(0);
      if (i) expect(c.from).toBe(chunks[i - 1].to);
      if (i) expect(c.from - c.start).toBe(RATE);
      if (c.to < n) expect(c.end - c.to).toBeGreaterThanOrEqual(c.tail + DELAY_FRAMES * FRAME);
    }
  });

  it('keeps short audio in one piece', () => {
    expect(planChunks(RATE * 30, 4)).toHaveLength(1);
    expect(planChunks(RATE * 15, 4, 4)).toHaveLength(3);
    expect(planChunks(100, 4)).toEqual([{ from: 0, to: 100, start: 0, end: 100, tail: 0 }]);
  });

  it('puts the pieces back in place and crossfades the seams', () => {
    const n = RATE * 50;
    const chunks = planChunks(n, 2);
    // piece i is filled with i + 1, tail included
    const parts = chunks.map((c, i) => new Float32Array(c.to - c.from + c.tail).fill(i + 1));
    const out = stitch(n, chunks, parts);
    const seam = chunks[1].from;
    expect(out[0]).toBe(1);
    expect(out[n - 1]).toBe(2);
    expect(out[seam - 1]).toBe(1);
    expect(out[seam]).toBeCloseTo(1 + 0.5 / OVERLAP, 4);
    expect(out[seam + OVERLAP / 2]).toBeCloseTo(1.5, 2);
    expect(out[seam + OVERLAP]).toBe(2);
  });

  it('reproduces the whole-file result when every piece is cleaned with its pre-roll', () => {
    // a stateless "denoiser" makes pieces and the whole identical, which checks the bookkeeping
    const n = RATE * 9 + 333;
    const x = sine(220, n / RATE, RATE);
    const whole = new Float32Array(n);
    const wholeVad = denoise(x, whole, delayingDenoiser(0.5, () => 0.7));
    const chunks = planChunks(n, 3, 2);
    const pieces = chunks.map((c) => {
      const input = x.slice(c.start, c.end);
      const out = new Float32Array(input.length);
      const vad = denoise(input, out, delayingDenoiser(0.5, () => 0.7));
      const skip = c.from - c.start;
      return { out: out.slice(skip, skip + c.to - c.from + c.tail), vad: vad.slice(skip / FRAME, Math.ceil((skip + c.to - c.from) / FRAME)) };
    });
    const joined = stitch(n, chunks, pieces.map((p) => p.out));
    for (let i = 0; i < n; i += 211) expect(joined[i]).toBeCloseTo(whole[i], 5);
    // stitching over the input itself (as the export does, to save memory) gives the same result
    const input = x.slice();
    expect(stitch(n, chunks, pieces.map((p) => p.out), input)).toBe(input);
    expect([...input]).toEqual([...joined]);
    expect(joinFrames(pieces.map((p) => p.vad), (m) => new Float32Array(m))).toHaveLength(wholeVad.length);
  });
});

describe('channels', () => {
  it('spots mono saved as stereo', () => {
    const a = sine(200, 0.1, RATE);
    expect(sameChannels([a, a.slice()])).toBe(true);
    const b = a.slice();
    b[100] += 0.01;
    expect(sameChannels([a, b])).toBe(false);
    expect(sameChannels([a])).toBe(true);
  });

  it('merges voice probabilities and stats across channels', () => {
    expect([...mergeVad([Float32Array.of(0.1, 0.9), Float32Array.of(0.5, 0.2)])]).toEqual([0.5, Math.fround(0.9)]);
    const s = mergeStats([frameStats(Float32Array.of(0.5, -0.5)), frameStats(Float32Array.of(0.1, 0.8))]);
    expect(s.energy[0]).toBeCloseTo(0.5 + 0.01 + 0.64);
    expect(s.peak[0]).toBeCloseTo(0.8);
  });
});

describe('toStereo', () => {
  it('leaves mono and stereo alone', () => {
    const a = sine(200, 0.01, RATE);
    const st = [a, a.slice()];
    expect(toStereo([a])).toEqual([a]);
    expect(toStereo(st)).toBe(st);
  });

  it('mixes 5.1 the usual way, skipping the LFE', () => {
    const one = (v: number) => Float32Array.of(v, v);
    const [l, r] = toStereo([one(0.1), one(0.2), one(0.3), one(0.9), one(0.05), one(0)]);
    expect(l[0]).toBeCloseTo(0.1 + Math.SQRT1_2 * (0.3 + 0.05), 6);
    expect(r[0]).toBeCloseTo(0.2 + Math.SQRT1_2 * 0.3, 6);
  });

  it('turns the mix down only when it would clip', () => {
    const loud = Float32Array.of(0.9, -0.9);
    const [l, r] = toStereo([loud, loud, loud, loud, loud, loud]);
    expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeCloseTo(1, 6);
    expect(l[0]).toBeCloseTo(-l[1], 6);
    const [ql] = toStereo([Float32Array.of(0.1), Float32Array.of(0.1), Float32Array.of(0.1)]);
    expect(ql[0]).toBeCloseTo(0.2, 6);
  });
});

describe('gateEnvelope', () => {
  const vad = (speech: [number, number][], n = 200) => Float32Array.from({ length: n }, (_, k) => (speech.some(([a, b]) => k >= a && k < b) ? 0.95 : 0.05));

  it('is fully open during speech and ducked well away from it', () => {
    const g = gateEnvelope(vad([[50, 80]]));
    expect(g[60]).toBe(1);
    expect(g[0]).toBeCloseTo(10 ** (-GATE.depthDb / 20), 5);
    expect(g[199]).toBeCloseTo(10 ** (-GATE.depthDb / 20), 5);
  });

  it('opens ahead of speech and holds after it', () => {
    const g = gateEnvelope(vad([[50, 80]]));
    expect(g[50 - GATE.lookaheadFrames]).toBe(1);
    expect(g[80 + GATE.holdFrames - 1]).toBe(1);
    // ramps rather than jumps
    const before = g[50 - GATE.lookaheadFrames - 2];
    expect(before).toBeGreaterThan(0.1);
    expect(before).toBeLessThan(1);
  });

  it('bridges short pauses between words', () => {
    const g = gateEnvelope(vad([
      [20, 40],
      [55, 70],
    ]));
    for (let k = 40; k < 55; k++) expect(g[k]).toBe(1);
  });
});

describe('normalizeGainDb', () => {
  it('lifts quiet speech toward the target', () => {
    const x = sine(200, 2, RATE, 0.02); // ≈ −37 dBFS RMS
    const vad = new Float32Array(Math.ceil(x.length / FRAME)).fill(0.9);
    const db = normalizeGainDb(frameStats(x), vad, null, 1);
    expect(db).toBeGreaterThan(14);
    expect(db).toBeLessThanOrEqual(18);
  });

  it('never pushes a peak past the ceiling', () => {
    const x = sine(200, 2, RATE, 0.05);
    x[1000] = 0.8; // one loud click
    const vad = new Float32Array(Math.ceil(x.length / FRAME)).fill(0.9);
    const db = normalizeGainDb(frameStats(x), vad, null, 1);
    expect(0.8 * 10 ** (db / 20)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
  });

  it('leaves silence alone', () => {
    const x = new Float32Array(RATE);
    expect(normalizeGainDb(frameStats(x), new Float32Array(100), null, 1)).toBe(0);
  });
});

describe('finishPlan and applyEnvelope', () => {
  it('skips the gate when no speech was heard', () => {
    const x = sine(200, 1, RATE, 0.1);
    const plan = finishPlan(frameStats(x), new Float32Array(100).fill(0.1), { gate: true, normalize: false }, 1);
    expect(plan.gains).toBeNull();
    expect(plan.speech).toBe(false);
  });

  it('interpolates the envelope smoothly across a frame', () => {
    const x = new Float32Array(FRAME * 2).fill(1);
    applyEnvelope(x, Float32Array.of(0, 1), 0);
    expect(x[0]).toBe(0);
    expect(x[FRAME / 2]).toBeCloseTo(0.5);
    expect(x[FRAME + 5]).toBe(1);
  });

  it('applies a fixed gain without a gate', () => {
    const x = Float32Array.of(0.1, -0.2);
    applyEnvelope(x, null, 20 * Math.log10(2));
    expect([...x].map((v) => +v.toFixed(5))).toEqual([0.2, -0.4]);
  });
});

describe('renderPreview', () => {
  it('matches the strength blend the export uses', () => {
    const dry = [Float32Array.of(1, 1, 1)];
    const wet = [Float32Array.of(0, 0, 0)];
    const r = renderPreview(dry, wet, new Float32Array(1), { strength: 0.8, highpass: true, gate: false, normalize: false });
    expect(r.channels[0][0]).toBeCloseTo(0.2);
    expect(dry[0][0]).toBe(1);
  });
});

describe('preview section', () => {
  it('finds the busiest stretch and keeps it inside the file', () => {
    const rms = new Float32Array(100).fill(0.01);
    rms.fill(0.5, 60, 70);
    const start = busiestWindow(rms, 100);
    expect(start).toBeGreaterThanOrEqual(55);
    expect(start).toBeLessThanOrEqual(60);
    expect(busiestWindow(rms, 10)).toBe(0);
    expect(clampSection(95, 100)).toBe(100 - PREVIEW_SEC);
    expect(clampSection(-3, 100)).toBe(0);
  });
});

describe('formats', () => {
  const info = (o: Partial<MediaInfo>): MediaInfo => ({ container: 'mp3', durationSec: 10, sizeBytes: 1, readable: true, needsFallback: false, via: 'mediabunny', ...o });
  const caps = (encode: string[]) => ({ audio: { encode, decode: [], nativeAac: true }, containers: { mp4: true, mov: true, webm: true, mkv: true } }) as unknown as Capabilities;
  const video = { codec: 'avc', width: 1, height: 1, displayWidth: 1, displayHeight: 1, rotation: 0 as const, fps: 30, bitrate: null, canDecode: true };

  it('keeps videos as videos and audio in its own kind', () => {
    expect(defaultFormat(info({ container: 'mp4', video }), null)).toBe('video');
    expect(defaultFormat(info({ container: 'wav' }), null)).toBe('wav');
    expect(defaultFormat(info({ container: 'mp4' }), caps(['aac', 'mp3']))).toBe('m4a');
    expect(defaultFormat(info({ container: 'mp4' }), caps(['mp3']))).toBe('mp3');
    expect(defaultFormat(info({ container: 'ogg' }), null)).toBe('mp3');
  });

  it('explains formats the browser cannot make', () => {
    expect(unavailableReason('m4a', null, caps(['mp3']))).toMatch(/M4A/);
    expect(unavailableReason('wav', null, caps([]))).toBe('');
    expect(unavailableReason('video', info({}), null)).toMatch(/video/);
  });

  it('puts the sound back into a container that can hold the codec', () => {
    expect(videoTarget(info({ container: 'webm', video }), false, caps(['opus', 'aac']))).toEqual({ container: 'webm', codec: 'opus' });
    expect(videoTarget(info({ container: 'webm', video }), false, caps(['aac']))).toEqual({ container: 'mp4', codec: 'aac' });
    expect(videoTarget(info({ container: 'mkv', video }), true, caps(['aac']))).toEqual({ container: 'mp4', codec: 'aac' });
  });

  it('labels the real encoder bitrate', () => {
    expect(bitrateLabel('mp3', 'mp3', 2)).toBe('192 kbps');
    expect(bitrateLabel('m4a', 'aac', 1)).toBe('128 kbps');
    expect(bitrateLabel('wav', 'pcm-s16', 2)).toBe('');
  });
});

describe('page copy', () => {
  it('fits search limits and ends its FAQ with the privacy answer', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.length).toBeGreaterThanOrEqual(3);
    expect(def.faq.length).toBeLessThanOrEqual(5);
    expect(def.faq.at(-1)?.q).toMatch(/uploaded/);
    expect(def.h1.match(/\*/g)).toHaveLength(2);
  });
});
