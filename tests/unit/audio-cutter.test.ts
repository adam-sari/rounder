import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transcode } from '@/engines/media/core';
import { nearbyDoubles } from '@/engines/media/math';
import { MediaError } from '@/engines/media/types';
import { errorText, estimateBytes, etaSeconds, fitFades, formatSupport, joinPieces, keptSegments, sameFormat, toStereo } from '@/tools/lib/audio-cutter/edit';
import tool from '@/tools/defs/audio-cutter';

const ramp = (n: number, v = 1) => Float32Array.from({ length: n }, () => v);
const caps = (encode: string[]) => ({ audio: { encode, decode: [], nativeAac: false } }) as never;

describe('sameFormat', () => {
  it('maps audio containers to themselves', () => {
    expect(sameFormat({ container: 'mp3', audio: { codec: 'mp3' } as never })).toBe('mp3');
    expect(sameFormat({ container: 'flac', audio: { codec: 'flac' } as never })).toBe('flac');
  });
  it('treats AAC in MP4/MOV/ADTS as M4A, other MP4 audio as unknown', () => {
    expect(sameFormat({ container: 'mp4', audio: { codec: 'aac' } as never })).toBe('m4a');
    expect(sameFormat({ container: 'aac', audio: { codec: 'aac' } as never })).toBe('m4a');
    expect(sameFormat({ container: 'mp4', audio: { codec: 'opus' } as never })).toBeNull();
    expect(sameFormat({ container: 'webm', audio: { codec: 'opus' } as never })).toBeNull();
  });
});

describe('formatSupport', () => {
  it('always offers MP3 and WAV', () => {
    expect(formatSupport('mp3', null, 31).ok).toBe(true);
    expect(formatSupport('wav', caps([]), 31).ok).toBe(true);
  });
  it('checks encoders for M4A and OGG', () => {
    expect(formatSupport('m4a', caps(['mp3']), 31).ok).toBe(false);
    expect(formatSupport('m4a', caps(['aac']), 31).ok).toBe(true);
    expect(formatSupport('ogg', caps(['vorbis']), 31).ok).toBe(true);
    expect(formatSupport('ogg', null, 31).ok).toBe(false);
  });
  it('flags the FLAC download when there is no native encoder', () => {
    expect(formatSupport('flac', caps([]), 31)).toMatchObject({ ok: true, download: true });
    expect(formatSupport('flac', caps([]), 31).note).toContain('31 MB');
    expect(formatSupport('flac', caps(['flac']), 31).download).toBeUndefined();
  });
});

describe('keptSegments', () => {
  it('keeps the selection in trim mode', () => {
    expect(keptSegments('trim', 2, 5, [], 10)).toEqual([{ start: 2, end: 5 }]);
  });
  it('keeps the gaps between cuts', () => {
    expect(keptSegments('cut', 0, 0, [{ start: 6, end: 8 }, { start: 2, end: 3 }], 10)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
      { start: 8, end: 10 },
    ]);
  });
  it('keeps nothing when a cut covers everything', () => {
    expect(keptSegments('cut', 0, 0, [{ start: 0, end: 10 }], 10)).toEqual([]);
  });
});

describe('fitFades', () => {
  it('leaves fades that fit alone', () => {
    expect(fitFades(1, 2, 10)).toEqual({ inSec: 1, outSec: 2 });
  });
  it('scales overlapping fades down proportionally', () => {
    const f = fitFades(6, 2, 4);
    expect(f.inSec).toBeCloseTo(3);
    expect(f.outSec).toBeCloseTo(1);
  });
});

describe('joinPieces', () => {
  it('shortens by the overlap and crossfades at the join', () => {
    const rate = 1000;
    const a = { sampleRate: rate, channels: [ramp(100, 1)] };
    const b = { sampleRate: rate, channels: [ramp(100, -1)] };
    const out = joinPieces([a, b], 0.01);
    const x = out.channels[0];
    expect(x.length).toBe(190);
    expect(x[89]).toBe(1);
    expect(x[100]).toBe(-1);
    // monotonic ramp from +1 to -1 across the 10-sample overlap
    for (let i = 90; i < 100; i++) expect(x[i]).toBeLessThan(x[i - 1]);
    expect(x[90]).toBeGreaterThan(0.5);
    expect(x[99]).toBeLessThan(-0.5);
  });
  it('fills extra channels from mono pieces and handles a single piece', () => {
    const out = joinPieces([{ sampleRate: 8, channels: [ramp(4, 0.5), ramp(4, 0.25)] }, { sampleRate: 8, channels: [ramp(4, 1)] }], 0);
    expect(out.channels).toHaveLength(2);
    expect(Array.from(out.channels[1])).toEqual([0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1]);
    expect(joinPieces([{ sampleRate: 8, channels: [ramp(3)] }]).channels[0]).toHaveLength(3);
  });
  it('never overlaps more than a piece is long', () => {
    const out = joinPieces([{ sampleRate: 1000, channels: [ramp(3)] }, { sampleRate: 1000, channels: [ramp(100)] }], 0.05);
    expect(out.channels[0].length).toBe(100);
  });
});

describe('toStereo', () => {
  it('passes mono and stereo through', () => {
    const ch = [ramp(2)];
    expect(toStereo(ch)).toBe(ch);
  });
  it('downmixes 5.1 without clipping a full-scale signal', () => {
    const [L, R] = toStereo([ramp(4, 1), ramp(4, 0), ramp(4, 1), ramp(4, 1), ramp(4, 1), ramp(4, 0)]);
    expect(L[0]).toBeCloseTo(1);
    expect(R[0]).toBeGreaterThan(0);
    expect(R[0]).toBeLessThan(1);
  });
  it('averages odd/even channels for other layouts', () => {
    const [L, R] = toStereo([ramp(2, 1), ramp(2, 0), ramp(2, 1), ramp(2, 0)]);
    expect(L[0]).toBe(1);
    expect(R[0]).toBe(0);
  });
});

describe('estimates and messages', () => {
  it('sizes lossy outputs by bitrate and WAV by samples', () => {
    expect(estimateBytes('mp3', 10, 128_000)).toBe(160_000);
    expect(estimateBytes('wav', 1, undefined, 44100, 2)).toBe(176_444);
  });
  it('only guesses an ETA with enough progress', () => {
    expect(etaSeconds(0.01, 5)).toBeNull();
    expect(etaSeconds(0.5, 10)).toBeCloseTo(10);
  });
  it('is silent on cancel and friendly otherwise', () => {
    expect(errorText(new MediaError('aborted', 'Cancelled.'))).toBe('');
    expect(errorText(new MediaError('no-tracks', 'x'))).toMatch(/audio track/);
    expect(errorText(new Error('boom'))).toContain('boom');
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.h1).toMatch(/\*\w+\*/);
  });
});

describe('review fixes', () => {
  it('passes a single piece through without copying it', () => {
    const one = { sampleRate: 48000, channels: [ramp(10)] };
    expect(joinPieces([one])).toBe(one);
  });
  it('maps a main-thread allocation failure to the memory message', () => {
    expect(errorText(new RangeError('Array buffer allocation failed'))).toMatch(/memory/);
  });
});

describe('same-format cut after moving the start (regression)', () => {
  // Ten 0.01 s arrow-key steps leave the start at 0.09999999999999999, where mediabunny's float check for
  // copying into a start-at-zero format failed. It then re-encoded to MP3 with no encoder registered, and
  // the cutter said "This browser can't write that format". Copying needs no codecs, so this runs in Node.
  const mp3 = () => new Blob([readFileSync('tests/fixtures/media/sample.mp3')]);
  const keyboardStart = (steps: number) => Array.from({ length: steps }).reduce<number>((t) => t + 0.01, 0);

  it('nearbyDoubles walks out one representable value at a time', () => {
    const t = keyboardStart(10);
    const near = nearbyDoubles(t, 2);
    expect(near[0]).toBe(t);
    expect(near).toHaveLength(5);
    expect(near[1]).toBeGreaterThan(t);
    expect(near[2]).toBeLessThan(t);
    for (const x of near) expect(Math.abs(x - t)).toBeLessThan(1e-15);
    expect(nearbyDoubles(0)).toEqual([0]);
  });

  it('copies the MP3 instead of failing, for every start the arrow keys reach in the first second', async () => {
    const file = mp3();
    for (let steps = 1; steps <= 100; steps++) {
      const out = await transcode(file, { container: 'mp3', trim: { start: keyboardStart(steps), end: 2 }, video: false });
      expect(out.notes, `start after ${steps} steps`).toEqual([]);
      expect(out.blob.size).toBeLessThan(file.size);
    }
  });

  it('keeps the cut where it was asked, starting at most 0.2 s early', async () => {
    const file = mp3();
    const start = keyboardStart(10);
    const out = await transcode(file, { container: 'mp3', trim: { start, end: 2 }, video: false });
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    // 128 kbps, 44.1 kHz: 417–418 bytes a frame of 1152 samples
    const seconds = (buf.length / 418) * (1152 / 44100);
    expect(seconds).toBeGreaterThan(2 - start - 0.05);
    expect(seconds).toBeLessThan(2 - start + 0.25);
  });
});
