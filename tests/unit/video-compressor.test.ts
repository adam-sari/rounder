import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '@/engines/media/types';
import { autoShortSide, capSize, errorText, etaSeconds, MB, planCompression, qualityBitrate, shortDuration, type Settings } from '@/tools/lib/video-compressor/plan';

const info = (o: { w?: number; h?: number; dur?: number; size?: number; vbr?: number | null; fps?: number; audio?: string | null; abr?: number } = {}): MediaInfo => ({
  container: 'mp4',
  durationSec: o.dur ?? 60,
  sizeBytes: o.size ?? 120 * MB,
  video: { codec: 'avc', width: o.w ?? 1920, height: o.h ?? 1080, displayWidth: o.w ?? 1920, displayHeight: o.h ?? 1080, rotation: 0, fps: o.fps ?? 30, bitrate: o.vbr === undefined ? 15_000_000 : o.vbr, canDecode: true },
  audio: o.audio === null ? undefined : { codec: o.audio ?? 'aac', sampleRate: 48000, channels: 2, bitrate: o.abr ?? 192_000, canDecode: true },
  readable: true,
  needsFallback: false,
  via: 'mediabunny',
});

const base: Settings = { mode: 'target', targetMB: 10, preset: 'balanced', resolution: 'auto', fps: 'original', codec: 'avc', removeAudio: false };

describe('capSize', () => {
  it('caps the short side and keeps the aspect ratio', () => {
    expect(capSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(capSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
  });
  it('never upscales', () => {
    expect(capSize(640, 360, 1080)).toEqual({ width: 640, height: 360 });
  });
});

describe('autoShortSide', () => {
  it('keeps the size when the bitrate is plenty', () => {
    expect(autoShortSide(1920, 1080, 30, 8_000_000, 'avc')).toBeUndefined();
  });
  it('steps down when the bitrate is thin', () => {
    expect(autoShortSide(1920, 1080, 30, 1_200_000, 'avc')).toBe(720);
    expect(autoShortSide(1920, 1080, 30, 50_000, 'avc')).toBe(360);
  });
  it('lets more efficient codecs keep more pixels', () => {
    expect(autoShortSide(1920, 1080, 30, 1_600_000, 'av1')).toBeUndefined();
  });
});

describe('planCompression · target size', () => {
  it('splits the budget, passes targetSizeBytes and estimates under the target', () => {
    const p = planCompression(info(), base);
    expect(p.options.container).toBe('mp4');
    expect(p.options.video).toMatchObject({ codec: 'avc', targetSizeBytes: 10 * MB });
    expect(p.options.audio).toEqual({ bitrate: 128_000 });
    expect(p.estimateBytes).toBeLessThanOrEqual(10 * MB);
    expect(p.feasible).toBe(true);
  });
  it('auto-picks a smaller frame for a tight budget', () => {
    const p = planCompression(info(), base);
    expect(p.autoSide).toBe(720);
    expect(p.options.video).toMatchObject({ height: 720 });
    expect([p.width, p.height]).toEqual([1280, 720]);
  });
  it('caps portrait video by width', () => {
    const p = planCompression(info({ w: 1080, h: 1920 }), { ...base, resolution: 480 });
    expect(p.options.video).toMatchObject({ width: 480 });
    expect(p.options.video).not.toHaveProperty('height');
    expect([p.width, p.height]).toEqual([480, 854]);
  });
  it('keeps a file that already fits', () => {
    expect(planCompression(info({ size: 8 * MB }), base).skip).toBe('fits');
  });
  it('still re-encodes a file that fits when asked to drop audio, cap size or frame rate', () => {
    for (const s of [{ removeAudio: true }, { resolution: 720 as const }, { fps: 24 as const }]) {
      const p = planCompression(info({ size: 8 * MB }), { ...base, ...s });
      expect(p.skip).toBeUndefined();
      // the budget is the file's own size, not the larger target
      expect(p.options.video).toMatchObject({ targetSizeBytes: 8 * MB });
    }
  });
  it('flags targets too small for the length', () => {
    expect(planCompression(info({ dur: 3600 }), base).feasible).toBe(false);
  });
  it('drops audio when asked, giving video the whole budget', () => {
    const p = planCompression(info(), { ...base, removeAudio: true });
    expect(p.options.audio).toBe(false);
    expect(p.audioBitrate).toBe(0);
  });
  it('puts VP9 in WebM', () => {
    expect(planCompression(info(), { ...base, codec: 'vp9' }).container).toBe('webm');
  });
});

describe('planCompression · quality', () => {
  const q: Settings = { ...base, mode: 'quality', resolution: 'auto' };
  it('treats auto resolution as original', () => {
    const p = planCompression(info(), q);
    expect([p.width, p.height]).toEqual([1920, 1080]);
    expect(p.options.video).not.toHaveProperty('height');
  });
  it('never asks for more than a share of the source bitrate', () => {
    const p = planCompression(info({ vbr: 2_000_000 }), { ...q, preset: 'high' });
    expect(p.videoBitrate).toBeLessThanOrEqual(1_500_000);
  });
  it('uses the preset bitrate for heavy sources', () => {
    const p = planCompression(info(), q);
    expect(p.videoBitrate).toBe(qualityBitrate('avc', 1920, 1080, 0.25));
    expect(p.options.video).toMatchObject({ bitrate: p.videoBitrate });
  });
  it('shrinks the presets in order', () => {
    const sizes = (['high', 'balanced', 'small'] as const).map((preset) => planCompression(info(), { ...q, preset }).estimateBytes);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });
  it('copies lean audio instead of re-encoding it', () => {
    const p = planCompression(info({ abr: 96_000 }), q);
    expect(p.options.audio).toBeUndefined();
    expect(p.audioBitrate).toBe(96_000);
  });
  it('re-encodes audio that does not fit the container', () => {
    expect(planCompression(info({ audio: 'pcm-s16', abr: 64_000 }), q).options.audio).toEqual({ bitrate: 128_000 });
  });
  it('caps the frame rate only when it lowers it', () => {
    expect(planCompression(info({ fps: 60 }), { ...q, fps: 30 }).options.video).toMatchObject({ fps: 30 });
    expect(planCompression(info({ fps: 24 }), { ...q, fps: 30 }).options.video).not.toHaveProperty('fps');
  });
  it('passes the cap when the source frame rate is unknown', () => {
    const v = info();
    v.video!.fps = null;
    expect(planCompression(v, { ...q, fps: 30 }).options.video).toMatchObject({ fps: 30 });
  });
  it('estimates from size and duration when the track has no bitrate', () => {
    const p = planCompression(info({ vbr: null, size: 30 * MB }), { ...q, preset: 'small' });
    expect(p.estimateBytes).toBeLessThan(30 * MB);
  });
});

describe('helpers', () => {
  it('waits for some progress before guessing an ETA', () => {
    expect(etaSeconds(500, 0.5)).toBeNull();
    expect(etaSeconds(10_000, 0.01)).toBeNull();
    expect(etaSeconds(10_000, 0.25)).toBeCloseTo(30);
  });
  it('formats short durations', () => {
    expect(shortDuration(12.4)).toBe('12s');
    expect(shortDuration(65)).toBe('1:05');
    expect(shortDuration(3725)).toBe('1:02:05');
  });
  it('maps error codes to friendly text', () => {
    expect(errorText('out-of-memory', 'x')).toMatch(/memory/);
    expect(errorText('failed', 'engine said so')).toBe('engine said so');
  });
});
