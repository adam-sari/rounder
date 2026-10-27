import { Quality as MbQuality } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import type { QualityLevel } from '@/engines/media/types';
import {
  copyBlocker,
  defaultContainer,
  estimateVideoBitrate,
  etaSeconds,
  frameIndex,
  friendlyError,
  inPoint,
  keptParts,
  likelyCodec,
  markCut,
  markTrimIn,
  markTrimOut,
  outPoint,
  skipTarget,
  stepFrame,
  videoQuality,
} from '@/tools/lib/trim-video/plan';

// internal, but it's the formula we mirror
const mediabunnyRate = (level: QualityLevel, codec: string, w: number, h: number) =>
  (new MbQuality(level) as unknown as { _toVideoBitrate(c: string, w: number, h: number): number })._toVideoBitrate(codec, w, h);

const all = { mp4: true, mov: true, webm: true, mkv: true };

describe('defaultContainer', () => {
  it('keeps the source container when it can be written', () => {
    expect(defaultContainer('mov', all)).toBe('mov');
    expect(defaultContainer('webm', all)).toBe('webm');
    expect(defaultContainer('mkv', null)).toBe('mkv');
  });
  it('falls back to MP4 for unwritable or exotic sources', () => {
    expect(defaultContainer('avi', all)).toBe('mp4');
    expect(defaultContainer('mov', { ...all, mov: false })).toBe('mp4');
    expect(defaultContainer('avi', { mp4: false, mov: false, webm: true, mkv: true })).toBe('webm');
  });
});

describe('keptParts', () => {
  it('trim mode keeps the one range', () => {
    expect(keptParts('trim', 2, 5, [], 10)).toEqual([{ start: 2, end: 5 }]);
  });
  it('segments mode keeps everything between the cuts', () => {
    expect(keptParts('segments', 0, 0, [{ start: 2, end: 3 }, { start: 6, end: 10 }], 10)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
    expect(keptParts('segments', 0, 0, [], 10)).toEqual([{ start: 0, end: 10 }]);
    expect(keptParts('segments', 0, 0, [{ start: 0, end: 10 }], 10)).toEqual([]);
  });
  it('drops slivers between cuts that hold no frame', () => {
    const cuts = [{ start: 0.01, end: 3 }, { start: 3.01, end: 6 }];
    expect(keptParts('segments', 0, 0, cuts, 10, 0.5 / 30)).toEqual([{ start: 6, end: 10 }]);
  });
});

describe('copyBlocker', () => {
  it('allows a copy when the container holds the codec and nothing is rotated', () => {
    expect(copyBlocker('avc', 0, 'mp4')).toBe('');
    expect(copyBlocker('vp9', 0, 'mkv')).toBe('');
  });
  it('explains why the stream would be re-encoded anyway', () => {
    expect(copyBlocker('avc', 0, 'webm')).toMatch(/WebM/);
    expect(copyBlocker(null, 0, 'mp4')).toMatch(/codec/);
    expect(copyBlocker('hevc', 90, 'mov')).toMatch(/rotated/);
  });
});

describe('frame maths', () => {
  const fps = 30;
  it('finds the frame on screen, tolerating float error', () => {
    expect(frameIndex(10 / 30 - 1e-9, fps)).toBe(10);
    expect(frameIndex(0.35, fps)).toBe(10);
  });
  it('steps one frame and lands inside it', () => {
    const next = stepFrame(10 / 30, fps, 1, 5);
    expect(frameIndex(next, fps)).toBe(11);
    expect(frameIndex(stepFrame(next, fps, -1, 5), fps)).toBe(10);
  });
  it('clamps steps to the clip', () => {
    expect(stepFrame(0, fps, -1, 5)).toBeLessThan(1 / fps);
    expect(frameIndex(stepFrame(4.99, fps, 1, 5), fps)).toBe(149);
  });
  it('in points start the frame, out points keep it', () => {
    expect(inPoint(0.35, fps)).toBeCloseTo(10 / 30);
    expect(outPoint(0.35, fps, 5)).toBeCloseTo(11 / 30);
    expect(outPoint(4.999, fps, 5)).toBe(5);
  });
});

describe('trim marks', () => {
  it('sets start and keeps end', () => {
    expect(markTrimIn({ start: 0, end: 8 }, 3, 10, 0.1)).toEqual({ start: 3, end: 8 });
  });
  it('an in point past the end reopens the end', () => {
    expect(markTrimIn({ start: 0, end: 4 }, 6, 10, 0.1)).toEqual({ start: 6, end: 10 });
  });
  it('an out point before the start reopens the start', () => {
    expect(markTrimOut({ start: 5, end: 8 }, 2, 10, 0.1)).toEqual({ start: 0, end: 2 });
    expect(markTrimOut({ start: 1, end: 8 }, 6, 10, 0.1)).toEqual({ start: 1, end: 6 });
  });
});

describe('markCut', () => {
  const cuts = [
    { start: 2, end: 3 },
    { start: 6, end: 7 },
  ];
  it('moves the edge of the cut under the playhead', () => {
    expect(markCut(cuts, 2.5, 'start', 10, 0.1)).toEqual([{ start: 2.5, end: 3 }, cuts[1]]);
    expect(markCut(cuts, 6.5, 'end', 10, 0.1)).toEqual([cuts[0], { start: 6, end: 6.5 }]);
  });
  it('pulls the next cut back for "in" and the previous one forward for "out"', () => {
    expect(markCut(cuts, 4, 'start', 10, 0.1)).toEqual([cuts[0], { start: 4, end: 7 }]);
    expect(markCut(cuts, 4, 'end', 10, 0.1)).toEqual([{ start: 2, end: 4 }, cuts[1]]);
  });
  it('starts a new cut when there is nothing to move', () => {
    expect(markCut([], 4, 'start', 10, 0.1)).toEqual([{ start: 4, end: 5 }]);
    expect(markCut([], 4, 'end', 10, 0.1)).toEqual([{ start: 3, end: 4 }]);
    expect(markCut(cuts, 8, 'start', 10, 0.1)).toEqual([...cuts, { start: 8, end: 9 }]);
  });
  it('never overlaps a neighbour', () => {
    expect(markCut(cuts, 1, 'start', 10, 0.1)).toEqual([{ start: 1, end: 3 }, cuts[1]]);
    expect(markCut([{ start: 2, end: 3 }, { start: 3.5, end: 4 }], 3.2, 'end', 10, 0.1)).toEqual([
      { start: 2, end: 3.2 },
      { start: 3.5, end: 4 },
    ]);
  });
});

describe('skipTarget', () => {
  const cuts = [{ start: 2, end: 3 }];
  it('jumps to the end of the cut under the playhead', () => {
    expect(skipTarget(cuts, 2.4)).toBe(3);
    expect(skipTarget(cuts, 1)).toBeNull();
    expect(skipTarget(cuts, 3)).toBeNull();
  });
});

describe('quality', () => {
  it("mirrors mediabunny's own estimate", () => {
    for (const level of ['very-high', 'high', 'medium'] as const) {
      for (const codec of ['avc', 'vp9'] as const) {
        expect(estimateVideoBitrate(codec, 1920, 1080, level)).toBe(mediabunnyRate(level, codec, 1920, 1080));
        expect(estimateVideoBitrate(codec, 1280, 720, level)).toBe(mediabunnyRate(level, codec, 1280, 720));
      }
    }
  });
  it('picks the first encodable codec of the container', () => {
    expect(likelyCodec('webm', ['avc', 'vp8'])).toBe('vp8');
    expect(likelyCodec('mp4', null)).toBe('avc');
  });
  it('copy means no video options', () => {
    expect(videoQuality('copy', { codec: 'avc', width: 1920, height: 1080, bitrate: 8e6 }, 'avc')).toBeNull();
  });
  it("uses the level's bitrate for rich or unknown sources, never a bare (unbounded) quality level", () => {
    const best = estimateVideoBitrate('avc', 1920, 1080, 'very-high');
    expect(videoQuality('very-high', { codec: 'avc', width: 1920, height: 1080, bitrate: 20e6 }, 'avc')).toEqual({ bitrate: best });
    expect(videoQuality('high', { codec: 'avc', width: 1920, height: 1080, bitrate: null }, 'avc')).toEqual({ bitrate: estimateVideoBitrate('avc', 1920, 1080, 'high') });
    // the measured case: a 16 Mbps phone clip stays under its own bitrate at Best
    expect(videoQuality('very-high', { codec: 'avc', width: 1920, height: 1080, bitrate: 16e6 }, 'avc')!.bitrate).toBeLessThan(16e6);
  });
  it('caps lean sources near their own bitrate, scaled for codec efficiency', () => {
    expect(videoQuality('very-high', { codec: 'avc', width: 1920, height: 1080, bitrate: 2e6 }, 'avc')).toEqual({ bitrate: 2_300_000 });
    expect(videoQuality('very-high', { codec: 'hevc', width: 1920, height: 1080, bitrate: 3e6 }, 'avc')).toEqual({ bitrate: 5_750_000 });
  });
});

describe('etaSeconds & errors', () => {
  it('waits for enough progress, then extrapolates', () => {
    expect(etaSeconds(500, 0.5)).toBeNull();
    expect(etaSeconds(10_000, 0.01)).toBeNull();
    expect(etaSeconds(10_000, 0.25)).toBeCloseTo(30);
  });
  it('has a friendly message for each code', () => {
    expect(friendlyError('out-of-memory', 'x')).toMatch(/memory/);
    expect(friendlyError('failed', 'Boom.')).toBe('Boom.');
    expect(friendlyError(undefined, '')).toMatch(/went wrong/);
  });
});
