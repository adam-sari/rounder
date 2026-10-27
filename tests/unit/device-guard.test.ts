import { describe, expect, it } from 'vitest';
import { toMediaError } from '@/engines/media/types';
import {
  checkDevice,
  DeviceLimitError,
  deviceMessage,
  deviceSpec,
  estimateMemory,
  guard,
  isOutOfMemory,
  maxPixels,
  memoryBudget,
  tooBigMessage,
  type DeviceSpec,
} from '@/tools/lib/device-guard';

const GB = 2 ** 30;
const MB = 2 ** 20;
const phone2: DeviceSpec = { memoryGB: 2, cores: 8, mobile: true, ios: false };
const phone4: DeviceSpec = { memoryGB: 4, cores: 8, mobile: true, ios: false };
const iphone: DeviceSpec = { cores: 6, mobile: true, ios: true };
const laptop: DeviceSpec = { memoryGB: 8, cores: 8, mobile: false, ios: false };
const firefox: DeviceSpec = { cores: 8, mobile: false, ios: false };

describe('device spec and budget', () => {
  it('falls back to a desktop guess without a navigator', () => {
    expect(deviceSpec()).toMatchObject({ mobile: false, ios: false });
  });

  it('gives phones about a third of RAM and computers 40%, and flags guesses', () => {
    expect(memoryBudget(phone2)).toEqual({ bytes: 0.6 * GB, known: true });
    expect(memoryBudget(laptop).bytes).toBeCloseTo(3.2 * GB);
    expect(memoryBudget(iphone)).toEqual({ bytes: GB, known: false });
    expect(memoryBudget(firefox)).toEqual({ bytes: 3 * GB, known: false });
  });

  it('counts no video frames for sound-only work', () => {
    expect(estimateMemory('video', { width: 0, height: 0 })).toBe(0);
    expect(estimateMemory('video', {})).toBeGreaterThan(estimateMemory('video', { width: 1280, height: 720 }));
  });
});

describe('checkDevice', () => {
  it('lets ordinary jobs through', () => {
    expect(checkDevice('video', { bytes: 80 * MB, seconds: 60, width: 1920, height: 1080 }, phone2)).toEqual({ level: 'ok', message: '' });
    expect(checkDevice('pdf', { bytes: 5 * MB }, phone2).level).toBe('ok');
    expect(checkDevice('vocals', { seconds: 240 }, laptop).level).toBe('ok');
  });

  it('warns with a lighter setting to try when a job is big for the device', () => {
    const v = checkDevice('video', { bytes: 900 * MB, seconds: 600, width: 3840, height: 2160 }, phone2);
    expect(v.level).toBe('warn');
    expect(v.message).toMatch(/^This video is big for this device's memory, so it may not finish\. Try 720p or 480p/);
  });

  it('blocks only when the device reports its memory and the job needs far more', () => {
    const song = { seconds: 14 * 60 };
    const blocked = checkDevice('vocals', song, phone2);
    expect(blocked.level).toBe('block');
    expect(blocked.message).toMatch(/too big for this device: it needs about 1\.\d GB of memory, more than a browser tab gets on a device with 2 GB\. Try cutting/);
    // the same song on a phone that doesn't say how much memory it has: a warning, never a block on a guess
    expect(checkDevice('vocals', song, { ...phone2, memoryGB: undefined }).level).toBe('warn');
    // deviceMemory tops out at 8 ("8 GB or more"), so those devices are never blocked on memory
    expect(checkDevice('pdf', { bytes: 2 * GB }, laptop).level).toBe('warn');
    expect(checkDevice('pdf', { bytes: 2 * GB }, phone4).level).toBe('block');
  });

  it("blames the device, not the file, when the tool alone needs more than it has", () => {
    const phone1: DeviceSpec = { memoryGB: 1, cores: 4, mobile: true, ios: false };
    const tiny: DeviceSpec = { memoryGB: 0.25, cores: 2, mobile: true, ios: false };
    // a 10-second clip: no advice about cutting a file that is already short
    expect(checkDevice('transcribe', { seconds: 10 }, phone2).level).toBe('ok');
    expect(checkDevice('transcribe', { seconds: 10 }, phone1)).toEqual({
      level: 'warn',
      message: 'This tool uses a lot of memory and this device has little to spare, so it may not finish. Close other tabs and apps first.',
    });
    expect(checkDevice('transcribe', { seconds: 10 }, tiny).message).toMatch(/^This tool needs about \d+ MB of memory even for a small file, more than a browser tab gets on a device with 0\.25 GB\. Try it on a computer/);
    // a long recording on the same 2 GB phone is about the file
    expect(checkDevice('transcribe', { seconds: 3 * 3600 }, phone2).message).toMatch(/^This recording is .* Try cutting it into shorter parts/);
  });

  it('blocks files the 2 GB ffmpeg heap cannot hold, on any device', () => {
    const v = checkDevice('ffmpeg', { bytes: 1.9 * GB }, firefox);
    expect(v.level).toBe('block');
    expect(v.message).toMatch(/backup converter .* at most 2 GB/);
    // a much smaller output (compressing to a target) fits
    expect(checkDevice('ffmpeg', { bytes: 1.9 * GB, outBytes: 50 * MB }, firefox).level).not.toBe('block');
  });

  it('warns that the backup converter is slow on long files', () => {
    expect(checkDevice('ffmpeg', { bytes: 50 * MB, seconds: 600 }, { ...phone4, memoryGB: 8 }).message).toMatch(/slower backup converter/);
    expect(checkDevice('ffmpeg', { bytes: 50 * MB, seconds: 600 }, laptop).level).toBe('ok');
  });

  it("blocks canvases the browser can't draw: 16.7 MP on iPhone and iPad", () => {
    const v = checkDevice('collage', { width: 5000, height: 5000 }, iphone);
    expect(v).toEqual({ level: 'block', message: expect.stringMatching(/5,000 × 5,000 pixels, and Safari on iPhone and iPad draws at most 16\.7 megapixels\. Try a smaller output size\.$/) });
    expect(checkDevice('collage', { width: 3840, height: 3840 }, iphone).level).not.toBe('block');
    expect(checkDevice('upscale', { width: 40000, height: 2000 }, laptop).message).toMatch(/browsers draw at most 268 megapixels/);
  });

  it('uses the caller’s tip and counts OCR pages as slow work', () => {
    expect(checkDevice('pdf', { bytes: 300 * MB, tip: 'Try merging fewer files.' }, phone4).message).toMatch(/Try merging fewer files\.$/);
    expect(checkDevice('ocr', { bytes: MB, count: 60 }, phone4).message).toBe('Reading 60 pages can take a long time on this device. Keep this tab open, or pick fewer pages.');
  });

  it('guard() throws a DeviceLimitError carrying the message', () => {
    expect(() => guard('vocals', { seconds: 14 * 60 }, phone2)).toThrow(DeviceLimitError);
    expect(guard('vocals', { seconds: 60 }, laptop).level).toBe('ok');
  });
});

describe('maxPixels', () => {
  it('shrinks the working size on small devices, but not below the floor', () => {
    expect(maxPixels('image-ai', phone2)).toBe(4e6);
    expect(maxPixels('image-ai', phone4)).toBeGreaterThan(20e6);
    expect(maxPixels('image-ai', laptop)).toBeGreaterThan(maxPixels('image-ai', phone4));
  });
});

describe('out-of-memory errors', () => {
  it('recognises the shapes engines throw', () => {
    expect(isOutOfMemory(new RangeError('Array buffer allocation failed'))).toBe(true);
    expect(isOutOfMemory(new RangeError('Invalid typed array length: 4294967296'))).toBe(true);
    expect(isOutOfMemory(new Error('Aborted(OOM). Build with -sASSERTIONS for more info.'))).toBe(true);
    expect(isOutOfMemory(new Error('RuntimeError: memory access out of bounds'))).toBe(true);
    expect(isOutOfMemory(new Error('Total canvas memory use exceeds the maximum limit (384 MB).'))).toBe(true);
    expect(isOutOfMemory({ name: 'AiError', code: 'out-of-memory', message: 'x' })).toBe(true);
    expect(isOutOfMemory(new Error('wrapped', { cause: new RangeError('Array buffer allocation failed') }))).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isOutOfMemory(new RangeError('Invalid time value'))).toBe(false);
    expect(isOutOfMemory(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isOutOfMemory(new Error("This file's format isn't supported."))).toBe(false);
    expect(isOutOfMemory(undefined)).toBe(false);
  });

  it('turns them into advice, and passes other errors back as null', () => {
    expect(deviceMessage('gif', new RangeError('Array buffer allocation failed'))).toBe(tooBigMessage('gif'));
    expect(tooBigMessage('gif')).toBe('This GIF is too big for this device: it ran out of memory. Try a smaller width, a lower frame rate or a shorter range.');
    expect(deviceMessage('pdf', new DeviceLimitError('Too big.'))).toBe('Too big.');
    expect(deviceMessage('pdf', new Error('damaged'))).toBeNull();
  });

  it('keeps a wasm out-of-memory abort from passing as a cancel in the media engine', () => {
    expect(toMediaError(new Error('Aborted(OOM)')).code).toBe('out-of-memory');
    expect(toMediaError(new Error('Aborted(native code called abort())')).code).toBe('failed');
    expect(toMediaError(new DOMException('The operation was aborted.', 'AbortError')).code).toBe('aborted');
  });
});
