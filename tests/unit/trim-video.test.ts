import { Quality as MbQuality } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import type { QualityLevel } from '@/engines/media/types';
import {
  copyBlocker,
  defaultContainer,
  estimateVideoBitrate,
  etaSeconds,
  exportPreset,
  frameIndex,
  friendlyError,
  inPoint,
  keptParts,
  likelyCodec,
  markCut,
  markTrimIn,
  markTrimOut,
  outPoint,
  outputCodec,
  skipTarget,
  sourceVideoBitrate,
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
  it('never passes a bare (unbounded) quality level, and uses the estimates for unknown sources', () => {
    expect(videoQuality('very-high', { codec: 'avc', width: 1920, height: 1080, bitrate: null }, 'avc')).toEqual({ bitrate: estimateVideoBitrate('avc', 1920, 1080, 'very-high') });
    expect(videoQuality('high', { codec: 'avc', width: 1920, height: 1080, bitrate: null }, 'avc')).toEqual({ bitrate: estimateVideoBitrate('avc', 1920, 1080, 'high') });
  });
  it('Best follows the source bitrate, so a cut is about the size of that part of the original', () => {
    // the measured case: 0:10–0:40 of a 117 MB, 1-minute 1080p clip came out 157 MB (42 Mbps)
    const src = { codec: 'avc', width: 1920, height: 1080, bitrate: 15.6e6 };
    const { bitrate } = videoQuality('very-high', src, 'avc')!;
    expect(bitrate).toBe(15.6e6);
    expect((bitrate * 30) / 8).toBeLessThanOrEqual((117e6 * 30) / 60);
    // lean and rich sources alike
    expect(videoQuality('very-high', { ...src, bitrate: 2e6 }, 'avc')).toEqual({ bitrate: 2e6 });
    expect(videoQuality('very-high', { ...src, bitrate: 40e6 }, 'avc')).toEqual({ bitrate: 40e6 });
  });
  it('scales for a codec change', () => {
    expect(videoQuality('very-high', { codec: 'hevc', width: 1920, height: 1080, bitrate: 3e6 }, 'avc')).toEqual({ bitrate: 5e6 });
    expect(videoQuality('very-high', { codec: 'avc', width: 1920, height: 1080, bitrate: 5e6 }, 'vp9')).toEqual({ bitrate: 3e6 });
  });
  it('High and Smaller stay under Best, and under their level for rich sources', () => {
    const rich = { codec: 'avc', width: 1920, height: 1080, bitrate: 30e6 };
    expect(videoQuality('high', rich, 'avc')).toEqual({ bitrate: estimateVideoBitrate('avc', 1920, 1080, 'high') });
    for (const bitrate of [0.5e6, 2e6, 8e6, 15.6e6, 30e6]) {
      const s = { ...rich, bitrate };
      const best = videoQuality('very-high', s, 'avc')!.bitrate;
      const high = videoQuality('high', s, 'avc')!.bitrate;
      const small = videoQuality('medium', s, 'avc')!.bitrate;
      expect(high).toBeLessThan(best);
      expect(small).toBeLessThan(high);
    }
  });
});

describe('sourceVideoBitrate', () => {
  const video = { codec: 'avc', width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0 as const, fps: 30, canDecode: true };
  const audio = { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: 128_000, canDecode: true };
  it("follows the whole file, not the track's estimate from its opening packets", () => {
    // a still 10 s intro, then motion: the first 240 packets measured 17.7 kbps for a 163 Mbps clip
    const info = { sizeBytes: 815_612_421, durationSec: 40, video: { ...video, bitrate: 17_725 }, audio };
    expect(sourceVideoBitrate(info)).toBe(Math.round((815_612_421 * 8) / 40 - 128_000));
  });
  it('a cut at that bitrate is about the size of that slice of the file', () => {
    const info = { sizeBytes: 117e6, durationSec: 60, video: { ...video, bitrate: 30e6 }, audio };
    const v = sourceVideoBitrate(info)!;
    expect(((v + 128_000) * 30) / 8).toBeCloseTo((117e6 * 30) / 60, -3);
  });
  it("falls back to the track's figure without a usable duration", () => {
    expect(sourceVideoBitrate({ sizeBytes: 1e6, durationSec: 0, video: { ...video, bitrate: 2e6 } })).toBe(2e6);
    expect(sourceVideoBitrate({ sizeBytes: 1e6, durationSec: 0, video: { ...video, bitrate: null } })).toBeNull();
  });
});

describe('outputCodec', () => {
  const enc = ['avc', 'hevc', 'vp9'] as const;
  it('Best keeps the source codec when the browser can write it into the container', () => {
    expect(outputCodec('very-high', 'hevc', 'mp4', [...enc])).toBe('hevc');
    expect(outputCodec('very-high', 'vp9', 'webm', [...enc])).toBe('vp9');
  });
  it('otherwise takes the engine pick', () => {
    expect(outputCodec('high', 'hevc', 'mp4', [...enc])).toBe('avc');
    expect(outputCodec('very-high', 'hevc', 'mp4', ['avc'])).toBe('avc');
    expect(outputCodec('very-high', 'hevc', 'webm', [...enc])).toBe('vp9');
    expect(outputCodec('very-high', 'hevc', 'mp4', null)).toBe('avc');
  });
});

describe('exportPreset', () => {
  const fps = 30;
  it('Best copies when the one part starts on the first frame and the stream can be copied', () => {
    expect(exportPreset('very-high', [{ start: 0, end: 60 }], '', fps)).toBe('copy');
    expect(exportPreset('very-high', [{ start: 0, end: 40 }], '', fps)).toBe('copy');
  });
  it('Best re-encodes a later start, which can only be frame-exact that way', () => {
    expect(exportPreset('very-high', [{ start: 10, end: 40 }], '', fps)).toBe('very-high');
    expect(exportPreset('very-high', [{ start: 1 / fps, end: 40 }], '', fps)).toBe('very-high');
  });
  it("re-encodes when the stream can't be copied, and keeps the other presets", () => {
    expect(exportPreset('very-high', [{ start: 0, end: 60 }], 'this video is stored rotated', fps)).toBe('very-high');
    expect(exportPreset('copy', [{ start: 5, end: 60 }], 'joining parts needs a re-encode', fps)).toBe('very-high');
    expect(exportPreset('copy', [{ start: 5, end: 60 }], '', fps)).toBe('copy');
    expect(exportPreset('high', [{ start: 0, end: 60 }], '', fps)).toBe('high');
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
