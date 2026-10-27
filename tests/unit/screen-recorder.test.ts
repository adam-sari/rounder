import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelFromSamples, mixAudio } from '@/tools/lib/recorder/audio';
import { RecordingClock, etaSeconds, recordingName } from '@/tools/lib/recorder/clock';
import { codecLabel, pickMimeType, recordedFormat, videoBitrate } from '@/tools/lib/recorder/format';
import { bubbleRect, canvasSize, centerSquare, containRect } from '@/tools/lib/recorder/layout';
import { displayMediaOptions, screenSupport, type CaptureEnv } from '@/tools/lib/recorder/capture';

describe('pickMimeType', () => {
  const chrome = new Set(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm']);
  const firefox = new Set(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']);
  const safari = new Set(['video/mp4']);

  it('prefers H.264 MP4 where the browser records it', () => {
    expect(pickMimeType((t) => chrome.has(t), true)).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    expect(pickMimeType((t) => chrome.has(t), false)).toBe('video/mp4;codecs=avc1');
  });
  it('falls back to WebM, then to whatever MP4 the browser offers', () => {
    expect(pickMimeType((t) => firefox.has(t), true)).toBe('video/webm;codecs=vp8,opus');
    expect(pickMimeType((t) => safari.has(t), true)).toBe('video/mp4');
  });
  it('never picks Opus inside MP4, and survives a throwing check', () => {
    expect(pickMimeType((t) => t === 'video/mp4;codecs=avc1,opus' || t === 'video/webm;codecs=vp9,opus', true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickMimeType(() => {
      throw new Error('nope');
    }, true)).toBe('');
  });
});

describe('recorded formats', () => {
  it('maps recorder types to extensions and offers MP4 conversion for the rest', () => {
    expect(recordedFormat('video/mp4;codecs=avc1.64001F,mp4a.40.2')).toEqual({ ext: 'mp4', label: 'MP4', convertible: false });
    expect(recordedFormat('video/webm;codecs=vp9,opus')).toEqual({ ext: 'webm', label: 'WebM', convertible: true });
    expect(recordedFormat('video/x-matroska;codecs=avc1')).toEqual({ ext: 'mkv', label: 'MKV', convertible: true });
    expect(recordedFormat('').ext).toBe('webm');
  });
  it('names codecs', () => {
    expect(codecLabel('video/webm;codecs=vp9,opus')).toBe('VP9 · Opus');
    expect(codecLabel('video/mp4; codecs="avc1.64001F, mp4a.40.2"')).toBe('H.264 · AAC');
    expect(codecLabel('video/webm')).toBe('');
  });
  it('keeps recorder bitrates in a sensible band', () => {
    expect(videoBitrate(640, 480, 30)).toBe(2_500_000);
    expect(videoBitrate(1920, 1080, 30)).toBe(Math.round(1920 * 1080 * 30 * 0.08));
    expect(videoBitrate(3840, 2160, 60)).toBe(12_000_000);
  });
});

describe('RecordingClock', () => {
  it('leaves paused stretches out of the elapsed time', () => {
    let t = 1000;
    const c = new RecordingClock(() => t);
    c.start();
    t = 4000;
    expect(c.elapsedMs).toBe(3000);
    c.pause();
    expect(c.paused).toBe(true);
    t = 10_000;
    expect(c.elapsedMs).toBe(3000);
    c.resume();
    t = 12_000;
    expect(c.elapsedMs).toBe(5000);
    c.stop();
    t = 50_000;
    expect(c.elapsedMs).toBe(5000);
  });
  it('freezes at the pause point when stopped while paused, and ignores double pauses', () => {
    let t = 0;
    const c = new RecordingClock(() => t);
    c.start();
    t = 2000;
    c.pause();
    t = 3000;
    c.pause();
    t = 9000;
    c.stop();
    expect(c.paused).toBe(false);
    expect(c.elapsedMs).toBe(2000);
    c.resume();
    expect(c.elapsedMs).toBe(2000);
  });
  it('restarts from zero', () => {
    let t = 0;
    const c = new RecordingClock(() => t);
    c.start();
    t = 5000;
    c.stop();
    c.start();
    t = 6000;
    expect(c.elapsedMs).toBe(1000);
  });
});

describe('progress and names', () => {
  it('guesses time left only once the job is under way', () => {
    expect(etaSeconds(500, 0.5)).toBeNull();
    expect(etaSeconds(5000, 0.01)).toBeNull();
    expect(etaSeconds(10_000, 0.25)).toBeCloseTo(30);
    expect(etaSeconds(10_000, 1)).toBeNull();
  });
  it('stamps file names with the local date and time', () => {
    expect(recordingName('screen-recording', new Date(2026, 9, 6, 9, 5, 3))).toBe('screen-recording-2026-10-06-090503');
  });
});

describe('webcam bubble layout', () => {
  it('sits inset from the chosen corner, sized from the shorter side', () => {
    expect(bubbleRect(1920, 1080, { corner: 'bottom-right', size: 'medium' })).toEqual({ x: 1920 - 43 - 302, y: 1080 - 43 - 302, size: 302 });
    expect(bubbleRect(1920, 1080, { corner: 'top-left', size: 'small' })).toEqual({ x: 43, y: 43, size: 216 });
    // portrait screens use the width as the short side
    const r = bubbleRect(1080, 1920, { corner: 'top-right', size: 'large' });
    expect(r.size).toBe(389);
    expect(r.x + r.size + 43).toBe(1080);
  });
  it('letterboxes and crops without distortion', () => {
    expect(containRect(1920, 1080, 960, 960)).toEqual({ x: 0, y: 210, width: 960, height: 540 });
    expect(containRect(0, 0, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    expect(centerSquare(1280, 720)).toEqual({ x: 280, y: 0, size: 720 });
  });
  it('caps huge screens and keeps sides even', () => {
    expect(canvasSize(1366, 768)).toEqual({ width: 1366, height: 768 });
    expect(canvasSize(5120, 2880)).toEqual({ width: 2560, height: 1440 });
    expect(canvasSize(1001, 677)).toEqual({ width: 1002, height: 678 });
  });
});

describe('capture options and support', () => {
  it('asks for unprocessed system audio only when wanted', () => {
    const on = displayMediaOptions({ surface: 'browser', fps: 60, systemAudio: true }) as Record<string, unknown>;
    expect(on.video).toEqual({ displaySurface: 'browser', frameRate: { ideal: 60, max: 60 } });
    expect(on.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false });
    expect(on.systemAudio).toBe('include');
    const off = displayMediaOptions({ surface: 'monitor', fps: 30, systemAudio: false }) as Record<string, unknown>;
    expect(off.audio).toBe(false);
    expect(off.systemAudio).toBe('exclude');
  });
  it('explains phones separately from old desktop browsers', () => {
    const env: CaptureEnv = { secure: true, displayMedia: true, userMedia: true, recorder: true, mobile: false };
    expect(screenSupport(env)).toBeNull();
    expect(screenSupport({ ...env, displayMedia: false, mobile: true })).toBe('mobile-screen');
    expect(screenSupport({ ...env, displayMedia: false })).toBe('no-screen');
    expect(screenSupport({ ...env, recorder: false })).toBe('no-recorder');
    expect(screenSupport({ ...env, secure: false })).toBe('insecure');
  });
});

describe('mixAudio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes zero or one track straight through and closes the unused context', () => {
    const close = vi.fn(() => Promise.resolve());
    const track = { kind: 'audio' } as MediaStreamTrack;
    expect(mixAudio([], null).track).toBeNull();
    expect(mixAudio([track], { close } as unknown as AudioContext).track).toBe(track);
    expect(close).toHaveBeenCalledOnce();
  });
  it('mixes two tracks into one destination', () => {
    vi.stubGlobal('MediaStream', class {
      constructor(public tracks: unknown[]) {}
    });
    const out = { kind: 'audio', id: 'mixed' };
    const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const dest = { stream: { getAudioTracks: () => [out] } };
    const ctx = {
      resume: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      createMediaStreamDestination: () => dest,
      createMediaStreamSource: () => {
        const n = { connect: vi.fn(), disconnect: vi.fn() };
        sources.push(n);
        return n;
      },
    };
    const mix = mixAudio([{ kind: 'audio' }, { kind: 'audio' }] as MediaStreamTrack[], ctx as unknown as AudioContext);
    expect(mix.track).toBe(out);
    expect(sources).toHaveLength(2);
    sources.forEach((s) => expect(s.connect).toHaveBeenCalledWith(dest));
    mix.close();
    sources.forEach((s) => expect(s.disconnect).toHaveBeenCalled());
    expect(ctx.close).toHaveBeenCalled();
  });
});

describe('levelFromSamples', () => {
  it('maps RMS onto a -60…0 dB meter', () => {
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
    expect(levelFromSamples(new Float32Array(64))).toBe(0);
    expect(levelFromSamples(new Float32Array(64).fill(1))).toBe(1);
    expect(levelFromSamples(new Float32Array(64).fill(0.1))).toBeCloseTo(2 / 3);
    expect(levelFromSamples(new Float32Array(64).fill(0.0001))).toBe(0);
  });
});
