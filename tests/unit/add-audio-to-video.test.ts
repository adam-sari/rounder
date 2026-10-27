import { describe, expect, it } from 'vitest';
import { canReplaceDirectly, mixBlock, musicBlocks, musicEnd, musicEnvelope, musicSource, musicTimeAt, PcmStream, renderMixWav, toStereo, wavHeader, type MixPlan, type ReadPcm } from '@/tools/lib/add-audio-to-video/mix';
import { MediaError } from '@/engines/media/types';

const plan = (over: Partial<MixPlan> = {}): MixPlan => ({ duration: 10, offset: 0, musicLength: 4, loop: false, fadeIn: 0, fadeOut: 0, musicGain: 1, originalGain: 1, ...over });

describe('timeline', () => {
  it('ends with the music or the video', () => {
    expect(musicEnd(plan())).toBe(4);
    expect(musicEnd(plan({ offset: 8 }))).toBe(10);
    expect(musicEnd(plan({ loop: true }))).toBe(10);
  });
  it('lays out loop blocks', () => {
    expect(musicBlocks(plan({ loop: true, offset: 1 }))).toEqual([
      { start: 1, end: 5 },
      { start: 5, end: 9 },
      { start: 9, end: 10 },
    ]);
    expect(musicBlocks(plan({ offset: 2 }))).toEqual([{ start: 2, end: 6 }]);
    expect(musicBlocks(plan({ offset: 10 }))).toEqual([]);
  });
  it('caps blocks for tiny loops', () => {
    const blocks = musicBlocks(plan({ loop: true, musicLength: 0.01, duration: 100 }));
    expect(blocks).toHaveLength(200);
    expect(blocks[199].end).toBe(100);
  });
  it('maps video time to music time', () => {
    const p = plan({ offset: 2, loop: true });
    expect(musicTimeAt(p, 1)).toBeNull();
    expect(musicTimeAt(p, 3)).toBeCloseTo(1);
    expect(musicTimeAt(p, 7)).toBeCloseTo(1);
    expect(musicTimeAt(plan({ offset: 2 }), 7)).toBeNull();
  });
  it('fades in and out', () => {
    const p = plan({ offset: 1, fadeIn: 2, fadeOut: 2 });
    expect(musicEnvelope(p, 0.5)).toBe(0);
    expect(musicEnvelope(p, 2)).toBeCloseTo(0.5);
    expect(musicEnvelope(p, 3)).toBe(1);
    expect(musicEnvelope(p, 4)).toBeCloseTo(0.5);
    // looping fades at the video's end
    expect(musicEnvelope(plan({ loop: true, fadeOut: 2 }), 9)).toBeCloseTo(0.5);
  });
});

describe('canReplaceDirectly', () => {
  const trim = { start: 0, end: 30 };
  it('takes the fast path for a plain swap', () => {
    expect(canReplaceDirectly(plan({ originalGain: 0, musicLength: 30 }), trim, 30, true)).toBe(true);
    expect(canReplaceDirectly(plan({ musicLength: 30 }), trim, 30, false)).toBe(true);
  });
  it('mixes when anything needs shaping', () => {
    expect(canReplaceDirectly(plan({ musicLength: 30 }), trim, 30, true)).toBe(false);
    expect(canReplaceDirectly(plan({ originalGain: 0, musicLength: 30, offset: 1 }), trim, 30, true)).toBe(false);
    expect(canReplaceDirectly(plan({ originalGain: 0, musicLength: 30, fadeOut: 2 }), trim, 30, true)).toBe(false);
    expect(canReplaceDirectly(plan({ originalGain: 0, musicLength: 30, musicGain: 0 }), trim, 30, true)).toBe(false);
  });
  it('needs the trimmed segment to cover the video or reach the file end', () => {
    // 4 s segment cut from the middle of a 30 s song would play past its out point
    expect(canReplaceDirectly(plan({ originalGain: 0 }), { start: 5, end: 9 }, 30, true)).toBe(false);
    expect(canReplaceDirectly(plan({ originalGain: 0 }), { start: 26, end: 30 }, 30, true)).toBe(true);
    expect(canReplaceDirectly(plan({ originalGain: 0, loop: true }), { start: 26, end: 30 }, 30, true)).toBe(false);
  });
});

/** a fake decoder over sample values 0, 1, 2… at `rate`, sliced like the engine slices */
const ramp = (rate: number, seconds: number, channels = 1): { read: ReadPcm; calls: [number, number][] } => {
  const calls: [number, number][] = [];
  const total = Math.round(seconds * rate);
  return {
    calls,
    read: async (start, end) => {
      calls.push([start, end]);
      const a = Math.min(total, Math.round(start * rate));
      const b = Math.min(total, Math.round(end * rate));
      return { sampleRate: rate, channels: Array.from({ length: channels }, (_, c) => Float32Array.from({ length: b - a }, (_, i) => a + i + c * 0.25)) };
    },
  };
};

describe('reading audio in windows', () => {
  it('folds mono and surround down to stereo', () => {
    const mono = Float32Array.from([0.5]);
    expect(toStereo([mono])).toEqual([mono, mono]);
    const one = (v: number) => Float32Array.from([v]);
    // FL FR FC LFE BL BR: center and surrounds at −3 dB, LFE dropped, normalised
    const [l, r] = toStereo([one(1), one(0), one(1), one(1), one(0), one(0)]);
    expect(l[0]).toBeCloseTo((1 + Math.SQRT1_2) / (1 + 2 * Math.SQRT1_2), 5);
    expect(r[0]).toBeCloseTo(Math.SQRT1_2 / (1 + 2 * Math.SQRT1_2), 5);
  });
  it('joins windows seamlessly, with preroll dropped', async () => {
    const src = ramp(100, 150);
    const s = new PcmStream(src.read, 0, 150, 100);
    const got: number[] = [];
    for (const n of [70, 6000, 33, 9000, 5000]) got.push(...(await s.take(n))[0]);
    expect(got).toHaveLength(15000);
    expect(got.every((v, i) => v === i)).toBe(true);
    // later windows start 0.2 s early so the decoder has history
    expect(src.calls).toEqual([[0, 60], [59.8, 120], [119.8, 150]]);
  });
  it('resamples continuously across windows', async () => {
    const src = ramp(100, 130);
    const s = new PcmStream(src.read, 0, 130, 200);
    const [l] = await s.take(26_000);
    expect(l.length).toBeGreaterThan(25_990);
    // a ramp stays a ramp at half the step, with no jumps at the seams
    for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1]).toBeCloseTo(0.5, 4);
  });
  it('loops short music from memory and long music by decoding again', async () => {
    const short = ramp(10, 1);
    const feed = await musicSource(short.read, { start: 0.2, end: 0.5 }, true, 10);
    expect(Array.from((await feed.take(7))[0])).toEqual([2, 3, 4, 2, 3, 4, 2]);
    expect(short.calls).toHaveLength(1);
    const long = ramp(1, 1000);
    const lf = await musicSource(long.read, { start: 0, end: 400 }, true, 1);
    const [l] = await lf.take(900);
    expect([l[399], l[400], l[899]]).toEqual([399, 0, 99]);
    const once = await musicSource(ramp(10, 1).read, { start: 0, end: 0.3 }, false, 10);
    expect((await once.take(10))[0]).toHaveLength(3);
  });
});

describe('mixing', () => {
  const sr = 10;
  it('writes a valid header', () => {
    const h = new DataView(wavHeader(100, 48000, 2).buffer);
    expect(String.fromCharCode(h.getUint8(0), h.getUint8(1), h.getUint8(2), h.getUint8(3))).toBe('RIFF');
    expect(h.getUint32(4, true)).toBe(36 + 400);
    expect(h.getUint16(22, true)).toBe(2);
    expect(h.getUint32(24, true)).toBe(48000);
    expect(h.getUint32(40, true)).toBe(400);
  });
  it('places and gains the music over the original', () => {
    const p = plan({ duration: 1, offset: 0.2, musicLength: 0.3, musicGain: 0.5, originalGain: 0.5 });
    const music = [Float32Array.from([1, 0.5, 0]), Float32Array.from([0, 0, 1])];
    const original = [new Float32Array(10).fill(0.4), new Float32Array(10).fill(-0.4)];
    const out = new Int16Array(20);
    mixBlock(out, p, sr, 0, original, music, 2);
    const left = (i: number) => out[2 * i] / 32767;
    const right = (i: number) => out[2 * i + 1] / 32767;
    expect(left(0)).toBeCloseTo(0.2, 3);
    expect(right(0)).toBeCloseTo(-0.2, 3);
    expect(left(2)).toBeCloseTo(0.7, 3); // 0.2 + 1 × 0.5
    expect(left(3)).toBeCloseTo(0.45, 3);
    expect(right(4)).toBeCloseTo(0.3, 3);
    expect(left(5)).toBeCloseTo(0.2, 3); // music over
  });
  it('clips instead of wrapping', () => {
    const out = new Int16Array(2);
    mixBlock(out, plan({ duration: 0.1, musicGain: 3 }), sr, 0, null, [Float32Array.from([1]), Float32Array.from([-1])]);
    expect([out[0], out[1]]).toEqual([32767, -32767]);
  });
  it('ignores the original at zero gain', () => {
    const out = new Int16Array(4);
    mixBlock(out, plan({ originalGain: 0 }), sr, 0, [new Float32Array(2).fill(1), new Float32Array(2).fill(1)], null);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
  it('renders loops, fades and the original into one WAV, matching the envelope', async () => {
    const rate = 100;
    const p = plan({ duration: 25, offset: 0.35, musicLength: 0.7, loop: true, fadeIn: 0.5, fadeOut: 1, musicGain: 0.8, originalGain: 0.5 });
    const music = ramp(rate, 1);
    const tune = await musicSource(async (a, b) => {
      const pcm = await music.read(a, b);
      return { ...pcm, channels: pcm.channels.map((c) => c.map((v) => Math.sin(v))) };
    }, { start: 0, end: 0.7 }, true, rate);
    const orig = new PcmStream(async (a, b) => {
      const pcm = await ramp(rate, 25).read(a, b);
      return { ...pcm, channels: pcm.channels.map((c) => c.map((v) => Math.cos(v) / 4)) };
    }, 0, 25, rate);
    const blob = await renderMixWav(p, rate, tune, orig);
    expect(blob.size).toBe(44 + 2500 * 4);
    const pcm = new Int16Array(await blob.arrayBuffer(), 44);
    const at = (i: number) => pcm[2 * i] / 32767;
    expect(at(10)).toBeCloseTo(Math.cos(10) / 8, 3); // before the music
    const i = 60; // inside the fade-in, music frame 25
    expect(at(i)).toBeCloseTo(Math.cos(i) / 8 + Math.sin(25) * 0.8 * musicEnvelope(p, i / rate), 3);
    const j = 1200; // a later loop, across a 10 s block seam
    expect(at(j)).toBeCloseTo(Math.cos(j) / 8 + Math.sin((j - 35) % 70) * 0.8, 3);
    expect(at(2499)).toBeCloseTo(Math.cos(2499) / 8 + Math.sin((2499 - 35) % 70) * 0.8 * musicEnvelope(p, 24.99), 3);
  });
  it('honours abort', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tune = await musicSource(ramp(10, 1).read, { start: 0, end: 1 }, false, 10);
    await expect(renderMixWav(plan(), 10, tune, null, { signal: ctrl.signal })).rejects.toBeInstanceOf(MediaError);
  });
});
