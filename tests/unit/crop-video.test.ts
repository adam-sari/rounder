import { describe, expect, it } from 'vitest';
import { MediaError, type Capabilities, type MediaInfo } from '@/engines/media/types';
import { cropAspects, evenCrop, ratioLabel, scaleChoices, scaleToShortSide } from '@/tools/lib/crop-video/geometry';
import { errorText, infoChips, pickFormat, sizeChange, timing, videoFormats } from '@/tools/lib/crop-video/job';

const caps = (containers: Partial<Capabilities['containers']>) =>
  ({ containers: { mp4: false, mov: false, webm: false, mkv: false, mp3: true, wav: true, ogg: true, m4a: true, flac: true, ...containers } }) as Capabilities;

describe('evenCrop', () => {
  it('trims odd sides to even and keeps the box in frame', () => {
    expect(evenCrop({ x: 10, y: 5, width: 607, height: 1081 }, 1920, 1080)).toEqual({ x: 10, y: 0, width: 606, height: 1080 });
  });

  it('slides a box that would overhang the right edge back inside', () => {
    expect(evenCrop({ x: 1500, y: 0, width: 421, height: 300 }, 1919, 1080)).toEqual({ x: 1499, y: 0, width: 420, height: 300 });
  });

  it('never goes below 2 × 2', () => {
    expect(evenCrop({ x: 0, y: 0, width: 1, height: 1 }, 100, 100)).toMatchObject({ width: 2, height: 2 });
  });
});

describe('scaling', () => {
  it('scales the short side to the target and keeps both sides even', () => {
    expect(scaleToShortSide(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(scaleToShortSide(608, 1080, 480)).toEqual({ width: 480, height: 852 });
  });

  it('only offers resolutions that shrink the video', () => {
    expect(scaleChoices(1920, 1080).map((c) => c.side)).toEqual([720, 480]);
    expect(scaleChoices(3840, 2160).map((c) => c.side)).toEqual([1080, 720, 480]);
    expect(scaleChoices(640, 480)).toEqual([]);
  });

  it('labels ratios in lowest terms', () => {
    expect(ratioLabel(1080, 1920)).toBe('9:16');
    expect(ratioLabel(1080, 1350)).toBe('4:5');
    expect(ratioLabel(1000, 997)).toBe('1.00:1');
  });

  it('has the platform presets the page promises', () => {
    expect(cropAspects.map((a) => a.key)).toEqual(['free', '9:16', '1:1', '4:5', '16:9', '4:3']);
  });
});

describe('formats', () => {
  it('offers only containers this browser can write, with a reason for the rest', () => {
    const list = videoFormats(caps({ mp4: true, webm: true }));
    expect(list.map((f) => [f.id, f.ok])).toEqual([['mp4', true], ['webm', true], ['mov', false]]);
    expect(list[2].reason).toMatch(/H\.264/);
  });

  it('allows MP4 only while capabilities are loading, and falls back to MP4 when nothing encodes', () => {
    expect(videoFormats(null).filter((f) => f.ok).map((f) => f.id)).toEqual(['mp4']);
    expect(videoFormats(caps({})).filter((f) => f.ok).map((f) => f.id)).toEqual(['mp4']);
  });

  it('stops saying "checking" once capabilities() has failed', () => {
    expect(videoFormats(null)[1].reason).toMatch(/^Checking/);
    expect(videoFormats(null, true)[1].reason).toMatch(/^Couldn't check/);
  });

  it('keeps the chosen or input format when possible', () => {
    const list = videoFormats(caps({ mp4: true, webm: true, mov: true }));
    expect(pickFormat(list, null, 'webm')).toBe('webm');
    expect(pickFormat(list, 'mov', 'webm')).toBe('mov');
    expect(pickFormat(list, null, 'avi')).toBe('mp4');
    expect(pickFormat(videoFormats(caps({ webm: true })), 'mp4', 'mp4')).toBe('webm');
  });
});

describe('job helpers', () => {
  it('describes a probed video', () => {
    const info: MediaInfo = {
      container: 'mp4', durationSec: 12.4, sizeBytes: 5_000_000, readable: true, needsFallback: false, via: 'mediabunny',
      video: { codec: 'avc', width: 1920, height: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 90, fps: 29.97, bitrate: null, canDecode: true },
    };
    expect(infoChips(info)).toEqual(['00:12.4', '1080 × 1920', 'H.264', '29.97 fps', 'rotated 90°', 'no audio', '4.8 MB']);
  });

  it('formats size changes', () => {
    expect(sizeChange(100, 65)).toBe('−35%');
    expect(sizeChange(100, 112)).toBe('+12%');
    expect(sizeChange(100, 100)).toBe('same size');
  });

  it('estimates time left only once progress is meaningful', () => {
    expect(timing(0.01, 2000)).toEqual({ elapsed: '00:02', left: null });
    expect(timing(0.25, 10_000)).toEqual({ elapsed: '00:10', left: '00:30' });
  });

  it('gives each error code a friendly message', () => {
    expect(errorText(new MediaError('out-of-memory', 'x'))).toMatch(/memory/);
    expect(errorText(new MediaError('invalid-options', 'The selected range is empty.'))).toBe('The selected range is empty.');
    expect(errorText(new Error('boom'))).toBe('boom');
  });
});
