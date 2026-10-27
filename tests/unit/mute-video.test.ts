import { describe, expect, it } from 'vitest';
import { MediaError, type MediaInfo } from '@/engines/media/types';
import { describeMedia, errorMessage, etaSeconds, formatSeconds, keepContainer, muteNeedsDecoder, rotatedPicture, sizeChange } from '@/tools/lib/mute-video/media';

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  container: 'mp4',
  durationSec: 12.4,
  sizeBytes: 1000,
  readable: true,
  needsFallback: false,
  via: 'mediabunny',
  video: { codec: 'avc', width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30, bitrate: null, canDecode: true },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: null, canDecode: true },
  ...over,
});

describe('keepContainer', () => {
  it('keeps writable video containers', () => {
    expect(keepContainer(info({ container: 'webm' }))).toBe('webm');
    expect(keepContainer(info({ container: 'mov' }), { mov: true })).toBe('mov');
  });
  it('falls back to mp4 for odd or unwritable inputs', () => {
    expect(keepContainer(info({ container: 'avi', needsFallback: true }))).toBe('mp4');
    expect(keepContainer(info({ container: 'ts' }))).toBe('mp4');
    expect(keepContainer(info({ container: 'webm' }), { webm: false })).toBe('mp4');
  });
});

describe('describeMedia', () => {
  it('lists duration, size, codecs', () => {
    expect(describeMedia(info())).toEqual(['00:12.4', '1920×1080', 'H.264', 'AAC stereo']);
  });
  it('says when there is no sound', () => {
    expect(describeMedia(info({ audio: undefined }))).toContain('no sound');
  });
  it('stays quiet about sound for unreadable files', () => {
    expect(describeMedia(info({ readable: false, audio: undefined, video: undefined, durationSec: 0 }))).toEqual([]);
  });
});

describe('progress timing', () => {
  it('waits for enough progress before guessing', () => {
    expect(etaSeconds(0.01, 5000)).toBeNull();
    expect(etaSeconds(0.5, 500)).toBeNull();
    expect(etaSeconds(1, 5000)).toBeNull();
  });
  it('extrapolates linearly', () => {
    expect(etaSeconds(0.25, 10_000)).toBeCloseTo(30);
  });
  it('formats seconds', () => {
    expect(formatSeconds(4.4)).toBe('4 s');
    expect(formatSeconds(60)).toBe('1 min');
    expect(formatSeconds(75)).toBe('1 min 15 s');
    expect(formatSeconds(3720)).toBe('1 h 2 min');
  });
});

describe('sizeChange', () => {
  it('reports shrink and growth', () => {
    expect(sizeChange(100, 58)).toEqual({ text: '−42%', smaller: true });
    expect(sizeChange(100, 120)).toEqual({ text: '+20%', smaller: false });
    expect(sizeChange(100, 100).text).toBe('same size');
  });
});

describe('errorMessage', () => {
  it('maps codes and passes engine messages through', () => {
    expect(errorMessage(new MediaError('aborted', 'x'))).toBe('Cancelled.');
    expect(errorMessage(new MediaError('no-tracks', 'This file has no video.'))).toBe('This file has no video.');
    expect(errorMessage(new MediaError('unsupported-codec', 'x'))).toMatch(/can't encode/);
    expect(errorMessage('weird')).toMatch(/Something went wrong/);
  });
});

describe('muteNeedsDecoder', () => {
  it('only asks for the decoder when the picture needs it', () => {
    const a = info().audio!;
    // MKV with AC-3 sound: the sound is dropped anyway
    expect(muteNeedsDecoder(info({ container: 'mkv', needsFallback: true, audio: { ...a, codec: 'ac3', canDecode: false } }))).toBe(false);
    expect(muteNeedsDecoder(info({ needsFallback: true, video: { ...info().video!, canDecode: false } }))).toBe(true);
    expect(muteNeedsDecoder(info({ container: 'avi', readable: false, needsFallback: true }))).toBe(true);
  });
  it('spots phone rotation flags', () => {
    expect(rotatedPicture(info())).toBe(false);
    expect(rotatedPicture(info({ video: { ...info().video!, rotation: 90 } }))).toBe(true);
  });
});
