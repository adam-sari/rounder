import { describe, expect, it } from 'vitest';
import {
  estimateBytes,
  exportChoices,
  exportFileName,
  isTrimmed,
  nextRecordingName,
  pickAudioMime,
  recordedFormat,
  safeName,
  targetContainer,
} from '@/tools/lib/voice-recorder/format';
import { RecordingClock, Trail, formatTimer, meterPosition, signalLevel, smoothLevel, toDb } from '@/tools/lib/voice-recorder/live';
import { ignoredProcessing, micChoices, micConstraints, micErrorText, micSupport } from '@/tools/lib/voice-recorder/mic';
import { isLiveElsewhere, lockName } from '@/tools/lib/voice-recorder/store';
import tool from '@/tools/defs/voice-recorder';

describe('recorder formats', () => {
  it('prefers Opus in WebM, then falls back', () => {
    expect(pickAudioMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickAudioMime((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickAudioMime(() => false)).toBe('');
    expect(
      pickAudioMime((t) => {
        if (t.includes('webm')) throw new Error('boom');
        return t === 'audio/ogg;codecs=opus';
      }),
    ).toBe('audio/ogg;codecs=opus');
  });

  it('maps recorder types to containers', () => {
    expect(recordedFormat('audio/webm;codecs=opus')).toMatchObject({ container: 'webm', mime: 'audio/webm' });
    expect(recordedFormat('audio/mp4;codecs=mp4a.40.2')).toMatchObject({ container: 'm4a', codec: 'AAC' });
    expect(recordedFormat('audio/ogg')).toMatchObject({ container: 'ogg' });
    expect(recordedFormat('')).toMatchObject({ container: 'webm' });
  });

  it('offers what the browser can encode', () => {
    const withAac = { audio: { encode: ['aac', 'opus', 'mp3'], decode: [], nativeAac: true } } as never;
    const noAac = { audio: { encode: ['opus', 'mp3'], decode: [], nativeAac: false } } as never;
    expect(exportChoices('webm', withAac).map((c) => [c.id, c.ok])).toEqual([
      ['mp3', true],
      ['wav', true],
      ['m4a', true],
      ['original', true],
    ]);
    expect(exportChoices('webm', noAac).find((c) => c.id === 'm4a')).toMatchObject({ ok: false, note: expect.stringContaining('AAC') });
    expect(exportChoices('webm', null).find((c) => c.id === 'm4a')?.ok).toBe(false);
    // Safari's AAC recording is already an M4A
    expect(exportChoices('m4a', withAac).map((c) => c.id)).toEqual(['mp3', 'wav', 'original']);
    expect(targetContainer('original', 'ogg')).toBe('ogg');
    expect(targetContainer('mp3', 'webm')).toBe('mp3');
  });

  it('estimates sizes', () => {
    expect(estimateBytes('mp3', 60, { bitrate: 128_000 })).toBe(960_000);
    expect(estimateBytes('wav', 1, { sampleRate: 48000, channels: 1 })).toBe(96_044);
    expect(estimateBytes('wav', 1, { sampleRate: 48000, channels: 6 })).toBe(192_044);
    expect(estimateBytes('original', 10, { sourceBytesPerSec: 16_000 })).toBe(160_000);
  });

  it('names files safely', () => {
    expect(safeName('Interview: part 1/2')).toBe('Interview- part 1-2');
    expect(safeName('  ..  ')).toBe('recording');
    expect(exportFileName('Recording 1', 'mp3', false)).toBe('Recording 1.mp3');
    expect(exportFileName('Recording 1', 'wav', true)).toBe('Recording 1 (trimmed).wav');
  });

  it('numbers new recordings after existing ones', () => {
    expect(nextRecordingName([])).toBe('Recording 1');
    expect(nextRecordingName(['Recording 1', 'Recording 2'])).toBe('Recording 3');
    expect(nextRecordingName(['Recording 4'])).toBe('Recording 5');
    expect(nextRecordingName(['Podcast intro', 'Recording 1'])).toBe('Recording 3');
  });

  it('knows when a selection trims', () => {
    expect(isTrimmed(0, 10, 10)).toBe(false);
    expect(isTrimmed(0.001, 9.999, 10)).toBe(false);
    expect(isTrimmed(0.5, 10, 10)).toBe(true);
    expect(isTrimmed(0, 9, 10)).toBe(true);
  });
});

describe('live recording maths', () => {
  it('leaves paused time out of the clock', () => {
    let t = 0;
    const c = new RecordingClock(() => t);
    c.start();
    t = 1000;
    c.pause();
    t = 5000;
    expect(c.elapsedMs).toBe(1000);
    c.resume();
    t = 6500;
    expect(c.elapsedMs).toBe(2500);
    c.stop();
    t = 9000;
    expect(c.elapsedMs).toBe(2500);
  });

  it('formats the timer', () => {
    expect(formatTimer(0)).toBe('0:00.0');
    expect(formatTimer(7_349)).toBe('0:07.3');
    expect(formatTimer(754_000)).toBe('12:34.0');
    expect(formatTimer(3_723_400)).toBe('1:02:03.4');
  });

  it('measures levels', () => {
    const { rms, peak } = signalLevel(new Float32Array([0.5, -0.5, 0.5, -1]));
    expect(peak).toBe(1);
    expect(rms).toBeCloseTo(Math.sqrt((0.25 * 3 + 1) / 4));
    expect(signalLevel(new Float32Array(0))).toEqual({ rms: 0, peak: 0 });
    expect(toDb(1)).toBe(0);
    expect(toDb(0)).toBe(-120);
    expect(meterPosition(0)).toBe(1);
    expect(meterPosition(-30)).toBe(0.5);
    expect(meterPosition(-90)).toBe(0);
  });

  it('rises instantly and falls gently', () => {
    expect(smoothLevel(0.2, 0.8, 16)).toBe(0.8);
    const fall = smoothLevel(0.8, 0.2, 16);
    expect(fall).toBeLessThan(0.8);
    expect(fall).toBeGreaterThan(0.7);
    expect(smoothLevel(0.8, 0.2, 10_000)).toBeCloseTo(0.2);
  });

  it('keeps a rolling waveform history', () => {
    const t = new Trail(4);
    expect(Array.from(t.last(3))).toEqual([]);
    [1, 2, 3].forEach((v) => t.push(v));
    expect(Array.from(t.last(10))).toEqual([1, 2, 3]);
    [4, 5, 6].forEach((v) => t.push(v));
    expect(t.length).toBe(4);
    expect(Array.from(t.last(4))).toEqual([3, 4, 5, 6]);
    expect(Array.from(t.last(2))).toEqual([5, 6]);
    t.clear();
    expect(t.length).toBe(0);
  });
});

describe('microphone setup', () => {
  const opts = { noiseSuppression: true, echoCancellation: false, autoGainControl: true };

  it('builds constraints', () => {
    expect(micConstraints('', opts)).toEqual({ noiseSuppression: true, echoCancellation: false, autoGainControl: true, channelCount: { ideal: 1 } });
    expect(micConstraints('abc', opts).deviceId).toEqual({ exact: 'abc' });
  });

  it('spots processing the browser ignored', () => {
    expect(ignoredProcessing(opts, { noiseSuppression: false, autoGainControl: true })).toEqual(['noiseSuppression']);
    expect(ignoredProcessing(opts, {})).toEqual([]);
  });

  it('lists microphones without the default alias', () => {
    const list = [
      { deviceId: 'default', kind: 'audioinput', label: 'Default - USB Mic' },
      { deviceId: 'a', kind: 'audioinput', label: 'USB Mic' },
      { deviceId: 'b', kind: 'audioinput', label: '' },
      { deviceId: 'c', kind: 'videoinput', label: 'Camera' },
      { deviceId: '', kind: 'audioinput', label: '' },
    ] as MediaDeviceInfo[];
    expect(micChoices(list)).toEqual([
      { id: 'a', label: 'USB Mic' },
      { id: 'b', label: 'Microphone 2' },
    ]);
  });

  it('explains errors and missing support', () => {
    expect(micErrorText({ name: 'NotAllowedError' })).toContain('blocked');
    expect(micErrorText({ name: 'NotFoundError' })).toContain('No microphone');
    expect(micErrorText({ name: 'NotReadableError' })).toContain('busy');
    expect(micErrorText(new Error('x'))).toContain("couldn't start");
    expect(micSupport({ secure: false, userMedia: true, recorder: true })).toBe('insecure');
    expect(micSupport({ secure: true, userMedia: false, recorder: true })).toBe('no-mic');
    expect(micSupport({ secure: true, userMedia: true, recorder: false })).toBe('no-recorder');
    expect(micSupport({ secure: true, userMedia: true, recorder: true })).toBeNull();
  });
});

describe('recovery after a reload', () => {
  const meta = { id: 'a', finished: false, updatedAt: 10_000 };

  it('trusts the recording lock when the browser has Web Locks', () => {
    // freshly written but nobody holds the lock: the tab that made it reloaded or crashed
    expect(isLiveElsewhere(meta, new Set(), 10_500)).toBe(false);
    // paused for minutes in another tab: still live
    expect(isLiveElsewhere(meta, new Set(['a']), 600_000)).toBe(true);
    expect(isLiveElsewhere({ ...meta, finished: true }, new Set(['a']), 10_500)).toBe(false);
    expect(lockName('a')).toBe('rounder-voice-recorder:a');
  });

  it('falls back to the heartbeat without Web Locks', () => {
    expect(isLiveElsewhere(meta, null, 12_000)).toBe(true);
    expect(isLiveElsewhere(meta, null, 16_000)).toBe(false);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.faq.at(-1)?.q).toMatch(/uploaded/);
  });
});
