import { describe, expect, it } from 'vitest';
import { MediaError } from '@/engines/media/types';
import { cssTransform, describe as describeOrientation, effective, engineOptions, fileSuffix, isIdentity, outputSize, previewBox, rotationOf, turn, type Orientation } from '@/tools/lib/rotate-video/orientation';
import { clock, containerBlock, defaultContainer, errorText, eta, infoChips, sizeChange } from '@/tools/lib/video-retouch/job';
import type { Capabilities, MediaInfo } from '@/engines/media/types';

const o = (turns = 0, flipX = false, flipY = false): Orientation => ({ turns, flipX, flipY });

describe('orientation', () => {
  it('normalises cumulative turns', () => {
    expect(rotationOf(0)).toBe(0);
    expect(rotationOf(1)).toBe(90);
    expect(rotationOf(-1)).toBe(270);
    expect(rotationOf(6)).toBe(180);
  });

  it('turns clockwise on screen even when mirrored', () => {
    expect(turn(o(), true).turns).toBe(1);
    expect(turn(o(), false).turns).toBe(-1);
    expect(turn(o(0, true), true).turns).toBe(-1);
    expect(turn(o(0, true, true), true).turns).toBe(1);
  });

  it('treats a double flip as a half turn', () => {
    expect(effective(o(0, true, true))).toEqual({ rotate: 180, mirrored: false });
    expect(engineOptions(o(1, true, true))).toEqual({ rotate: 270, flipHorizontal: false, flipVertical: false });
    expect(engineOptions(o(1, true))).toEqual({ rotate: 90, flipHorizontal: true, flipVertical: false });
    expect(isIdentity(o(2, true, true))).toBe(true);
    expect(isIdentity(o(4))).toBe(true);
    expect(isIdentity(o(0, false, true))).toBe(false);
  });

  it('swaps the output size on quarter turns', () => {
    expect(outputSize(1920, 1080, o(1))).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(1920, 1080, o(2))).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(1920, 1080, o(-1, true))).toEqual({ width: 1080, height: 1920 });
  });

  it('describes and names the result', () => {
    expect(describeOrientation(o())).toBe('upright');
    expect(describeOrientation(o(1, true))).toBe('90° clockwise · mirrored');
    expect(fileSuffix(o(-1))).toBe('-rotated-270');
    expect(fileSuffix(o(0, true))).toBe('-mirrored');
    expect(fileSuffix(o(1, false, true))).toBe('-rotated-90-mirrored');
    expect(fileSuffix(o())).toBe('-upright');
  });

  it('builds a CSS transform that turns, then mirrors', () => {
    expect(cssTransform(o(-1, true))).toBe('translate(-50%, -50%) scale(-1, 1) rotate(-90deg)');
  });

  it('fits the turned preview in the stage', () => {
    const box = previewBox(400, 300, 1600, 900, o(1));
    expect(box.frame.height).toBeCloseTo(300);
    expect(box.frame.width).toBeCloseTo(168.75);
    expect(box.element).toEqual({ width: box.frame.height, height: box.frame.width });
    const flat = previewBox(400, 300, 1600, 900, o());
    expect(flat.frame).toEqual({ width: 400, height: 225 });
    expect(flat.element).toEqual(flat.frame);
  });
});

const caps = (over: Partial<Capabilities['containers']> = {}, encoder = true): Capabilities => ({
  webCodecs: { videoEncoder: encoder, videoDecoder: encoder, audioEncoder: encoder, audioDecoder: encoder },
  video: { encode: ['avc'], decode: ['avc'] },
  audio: { encode: ['aac'], decode: ['aac'], nativeAac: true },
  containers: { mp4: true, mov: true, webm: true, mkv: true, mp3: true, wav: true, ogg: true, m4a: true, flac: true, ...over },
  imageDecoder: true,
});

describe('retouch job helpers', () => {
  it('formats clocks without a leading zero', () => {
    expect(clock(5)).toBe('0:05');
    expect(clock(75.4)).toBe('1:15');
    expect(clock(3723)).toBe('1:02:03');
  });

  it('only estimates time left once there is a trend', () => {
    expect(eta(1000, 0.5)).toBeNull();
    expect(eta(10_000, 0.01)).toBeNull();
    expect(eta(10_000, 0.25)).toBeCloseTo(30);
  });

  it('keeps the input container when it can be written', () => {
    expect(defaultContainer('mov', caps())).toBe('mov');
    expect(defaultContainer('avi', caps())).toBe('mp4');
    expect(defaultContainer('webm', caps({ webm: false }))).toBe('mp4');
    expect(defaultContainer('mp4', caps({ mp4: false }))).toBe('webm');
    expect(defaultContainer('webm', caps({}, false))).toBe('mp4');
  });

  it('explains blocked containers', () => {
    expect(containerBlock('webm', caps({ webm: false }))).toMatch(/WebM/);
    expect(containerBlock('mov', caps({}, false))).toMatch(/WebCodecs/);
    expect(containerBlock('mp4', null)).toBeNull();
  });

  it('summarises a file', () => {
    const info: MediaInfo = {
      container: 'mp4',
      durationSec: 65,
      sizeBytes: 5 * 1024 * 1024,
      video: { codec: 'avc', width: 1920, height: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 90, fps: 29.97, bitrate: null, canDecode: true },
      readable: true,
      needsFallback: false,
      via: 'mediabunny',
    };
    expect(infoChips(info)).toEqual(['1:05', '1080×1920', '29.97 fps', 'H.264', 'no audio', '5.0 MB']);
  });

  it('describes the size change', () => {
    expect(sizeChange(1000_000, 500_000)).toEqual({ text: '977 KB → 488 KB (−50%)', smaller: true });
    expect(sizeChange(100, 150).smaller).toBe(false);
  });

  it('turns errors into friendly text and stays quiet on cancel', () => {
    expect(errorText(new MediaError('aborted', 'Cancelled.'))).toBeNull();
    expect(errorText(new MediaError('out-of-memory', 'x'))).toMatch(/memory/);
    expect(errorText(new MediaError('unsupported-codec', "Can't encode."))).toMatch(/MP4/);
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText(new RangeError('Array buffer allocation failed'))).toMatch(/memory/);
  });
});
