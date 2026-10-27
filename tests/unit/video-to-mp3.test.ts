import { describe, expect, it } from 'vitest';
import { AUDIO_FORMATS, audioBitrate, canCopy, clipLength, estimateAudioBytes, isLossless } from '@/tools/lib/video-to-mp3/audio';
import { etaSeconds, formatClock, mediaErrorText } from '@/tools/lib/video-to-mp3/job';
import def from '@/tools/defs/video-to-mp3';

describe('audio formats', () => {
  it('lists the five outputs with sane defaults', () => {
    expect(AUDIO_FORMATS.map((f) => f.id)).toEqual(['mp3', 'm4a', 'ogg', 'wav', 'flac']);
    for (const f of AUDIO_FORMATS) {
      if (f.bitrates.length) expect(f.bitrates).toContain(f.defaultKbps);
    }
    expect(isLossless('wav')).toBe(true);
    expect(isLossless('mp3')).toBe(false);
  });

  it('copies only when the source codec fits the format', () => {
    expect(canCopy('m4a', 'aac')).toBe(true);
    expect(canCopy('mp3', 'aac')).toBe(false);
    expect(canCopy('ogg', 'opus')).toBe(true);
    expect(canCopy('ogg', null)).toBe(false);
    expect(canCopy('wav', 'pcm-s16')).toBe(false);
    // 5.1 is downmixed to stereo, so it's re-encoded at the format default
    expect(canCopy('m4a', 'aac', 6)).toBe(false);
    expect(audioBitrate('m4a', 'copy', 'aac', 6)).toBe(160_000);
  });

  it('picks the bitrate to encode with', () => {
    expect(audioBitrate('mp3', 192, 'aac')).toBe(192_000);
    expect(audioBitrate('m4a', 'copy', 'aac')).toBeUndefined();
    // can't copy: falls back to the format default
    expect(audioBitrate('m4a', 'copy', 'opus')).toBe(160_000);
    expect(audioBitrate('mp3', 'copy', 'aac')).toBe(192_000);
    expect(audioBitrate('wav', 320, 'aac')).toBeUndefined();
    // AAC encoders only take 96–192k
    expect(audioBitrate('m4a', 320, 'mp3')).toBe(192_000);
  });

  it('estimates output sizes', () => {
    expect(estimateAudioBytes('mp3', 128, 60)).toBe(960_000);
    expect(estimateAudioBytes('m4a', 'copy', 10, { codec: 'aac', bitrate: 256_000, sampleRate: 48_000, channels: 2 })).toBe(320_000);
    expect(estimateAudioBytes('wav', 'copy', 1, { codec: 'aac', bitrate: null, sampleRate: 44_100, channels: 6 })).toBe(44_100 * 2 * 2 + 44);
    expect(estimateAudioBytes('flac', 'copy', 1)).toBeLessThan(estimateAudioBytes('wav', 'copy', 1));
  });

  it('measures the trimmed length', () => {
    expect(clipLength(30)).toBe(30);
    expect(clipLength(30, { start: 5, end: 12.5 })).toBe(7.5);
    expect(clipLength(30, { start: 25, end: 40 })).toBe(5);
  });
});

describe('job helpers', () => {
  it('waits for enough progress before guessing an ETA', () => {
    expect(etaSeconds(500, 0.5)).toBeNull();
    expect(etaSeconds(10_000, 0.01)).toBeNull();
    expect(etaSeconds(10_000, 0.5)).toBeCloseTo(10);
    expect(etaSeconds(4_000, 1)).toBe(0);
  });

  it('formats clock times', () => {
    expect(formatClock(7)).toBe('0:07');
    expect(formatClock(65.4)).toBe('1:05');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('turns engine errors into friendly text', () => {
    expect(mediaErrorText({ code: 'aborted' })).toBe('Cancelled.');
    expect(mediaErrorText({ code: 'no-tracks', message: 'This file has no audio.' })).toBe('This file has no audio.');
    expect(mediaErrorText({ code: 'unsupported-codec', message: 'raw' })).not.toBe('raw');
    expect(mediaErrorText(new Error('boom'))).toBe('boom');
    expect(mediaErrorText(undefined)).toMatch(/went wrong/);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(def.slug).toBe('video-to-mp3');
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.length).toBeGreaterThanOrEqual(3);
    expect(def.faq.length).toBeLessThanOrEqual(5);
    expect(def.h1.match(/\*/g)).toHaveLength(2);
  });
});
