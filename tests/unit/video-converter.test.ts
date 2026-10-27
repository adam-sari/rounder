import { describe, expect, it } from 'vitest';
import type { Capabilities, MediaInfo } from '@/engines/media/types';
import { MediaError } from '@/engines/media/types';
import defs from '@/tools/defs/video-converter';
import {
  audioBitrateChoices,
  availability,
  codecChoices,
  defaultAudioBitrate,
  describePlan,
  errorText,
  etaSeconds,
  isFastPath,
  planConversion,
  resolutionChoices,
  sizeChange,
  sizeFor,
  type Settings,
} from '@/tools/lib/video-converter/plan';

const info = (video: string | null, audio: string | null, w = 1920, h = 1080): MediaInfo => ({
  container: 'mov',
  durationSec: 10,
  sizeBytes: 1e7,
  readable: true,
  needsFallback: false,
  via: 'mediabunny',
  video: video ? { codec: video, width: w, height: h, displayWidth: w, displayHeight: h, rotation: 0, fps: 30, bitrate: null, canDecode: true } : undefined,
  audio: audio ? { codec: audio, sampleRate: 48000, channels: 2, bitrate: null, canDecode: true } : undefined,
});

const base: Settings = { container: 'mp4', codec: 'auto', quality: 'original', resolution: 0, keepAudio: true, audioBitrate: 0 };
const encodable = ['avc', 'vp9', 'av1'] as const;
const plan = (i: MediaInfo, s: Partial<Settings> = {}) => planConversion(i, { ...base, ...s }, [...encodable]);

const caps = (containers: Partial<Capabilities['containers']>): Capabilities => ({
  webCodecs: { videoEncoder: true, videoDecoder: true, audioEncoder: true, audioDecoder: true },
  video: { encode: [...encodable], decode: [...encodable] },
  audio: { encode: ['aac', 'opus', 'mp3'], decode: ['aac', 'opus', 'mp3'], nativeAac: true },
  containers: { mp4: true, mov: true, webm: true, mkv: true, mp3: true, wav: true, ogg: true, m4a: true, flac: true, ...containers },
  imageDecoder: true,
});

describe('planConversion', () => {
  it('copies an iPhone HEVC MOV into MP4 untouched', () => {
    const p = plan(info('hevc', 'aac'));
    expect(p.options).toEqual({ container: 'mp4' });
    expect(p.copyVideo && p.copyAudio).toBe(true);
    expect(isFastPath(p)).toBe(true);
    expect(p.videoCodec).toBe('hevc');
  });

  it('re-encodes when the user picks a different codec', () => {
    const p = plan(info('hevc', 'aac'), { codec: 'avc' });
    expect(p.copyVideo).toBe(false);
    expect(p.options.video).toEqual({ codec: 'avc', quality: 'very-high' });
    expect(p.videoCodec).toBe('avc');
    expect(p.copyAudio).toBe(true);
  });

  it('turns WebM VP9 + Opus into H.264 + AAC for MP4 rather than copying', () => {
    const p = plan(info('vp9', 'opus'));
    expect(p.copyVideo).toBe(false);
    expect(p.videoCodec).toBe('avc');
    expect(p.options.audio).toEqual({ codec: 'aac' });
    expect(isFastPath(p)).toBe(false);
  });

  it('copies VP9 into WebM but re-encodes H.264', () => {
    expect(plan(info('vp9', 'opus'), { container: 'webm' }).copyVideo).toBe(true);
    const p = plan(info('avc', 'aac'), { container: 'webm' });
    expect(p.videoCodec).toBe('vp9');
    expect(p.audioCodec).toBe('opus');
  });

  it('MKV takes any codec as-is', () => {
    expect(isFastPath(plan(info('vp9', 'opus'), { container: 'mkv' }))).toBe(true);
  });

  it('resizes by the short side and forces a re-encode', () => {
    expect(plan(info('avc', 'aac'), { resolution: 720 }).options.video).toEqual({ codec: undefined, quality: 'very-high', height: 720 });
    expect(plan(info('avc', 'aac', 1080, 1920), { resolution: 720, quality: 'medium' }).options.video).toEqual({ codec: undefined, quality: 'medium', width: 720 });
    // asking for the source size or bigger is a no-op
    expect(plan(info('avc', 'aac'), { resolution: 1080 }).copyVideo).toBe(true);
  });

  it('re-encodes rotated phone videos and surround sound, which the engine cannot copy', () => {
    const portrait = info('hevc', 'aac');
    portrait.video!.rotation = 90;
    const p = plan(portrait);
    expect(p.copyVideo).toBe(false);
    expect(p.options.video).toEqual({ codec: undefined, quality: 'very-high' });
    const surround = info('avc', 'aac');
    surround.audio!.channels = 6;
    expect(plan(surround).options.audio).toEqual({ codec: 'aac' });
    expect(audioBitrateChoices('m4a', surround)).not.toContain(0);
  });

  it('does not promise a copy when the ffmpeg fallback has to decode the file', () => {
    const undecodable = info('hevc', 'aac');
    undecodable.video!.canDecode = false;
    const p = plan(undecodable, { container: 'mkv' });
    expect(p.copyVideo || p.copyAudio).toBe(false);
    expect(p.options.audio).toEqual({ codec: 'opus' });
    // an AVI read by ffmpeg: video is copied out of the fallback's rewrap, its audio arrives as PCM
    const avi: MediaInfo = { ...info('avc', 'mp3'), readable: false, needsFallback: true, via: 'ffmpeg' };
    avi.video!.canDecode = avi.audio!.canDecode = false;
    const q = plan(avi);
    expect(q.copyVideo).toBe(true);
    expect(q.options.audio).toEqual({ codec: 'aac' });
  });

  it('drops audio when asked', () => {
    const p = plan(info('avc', 'aac'), { keepAudio: false });
    expect(p.options.audio).toBe(false);
    expect(p.audioCodec).toBeNull();
    expect(describePlan(p, { ...base, keepAudio: false }, true)).toContain('audio: removed');
  });

  it('plans audio-only outputs', () => {
    const mp3 = plan(info('avc', 'aac'), { container: 'mp3', audioBitrate: 192_000 });
    expect(mp3.options).toEqual({ container: 'mp3', video: false, audio: { bitrate: 192_000 } });
    expect(describePlan(mp3, { ...base, container: 'mp3', audioBitrate: 192_000 }, true)).toEqual(['audio: re-encoded to MP3 at 192 kbps']);
    const m4a = plan(info('avc', 'aac'), { container: 'm4a', audioBitrate: 0 });
    expect(m4a.copyAudio).toBe(true);
    expect(isFastPath(m4a)).toBe(true);
    expect(plan(info('avc', 'aac'), { container: 'wav' }).audioCodec).toBe('pcm-s16');
  });
});

describe('choices', () => {
  it('offers only smaller standard resolutions', () => {
    expect(resolutionChoices(1920, 1080)).toEqual([720, 480, 360]);
    expect(resolutionChoices(2160, 3840)).toEqual([1440, 1080, 720, 480, 360]);
    expect(resolutionChoices(320, 240)).toEqual([]);
    expect(sizeFor(1080, 1920, 720)).toEqual({ width: 720 });
  });

  it('offers "original" audio only when it can be copied', () => {
    expect(audioBitrateChoices('m4a', info('avc', 'aac'))[0]).toBe(0);
    expect(audioBitrateChoices('mp3', info('avc', 'aac'))).not.toContain(0);
    expect(audioBitrateChoices('wav', info('avc', 'aac'))).toEqual([]);
    expect(defaultAudioBitrate([0, 128_000])).toBe(0);
    expect(defaultAudioBitrate([128_000, 192_000])).toBe(192_000);
    // WAV has no bitrate: the default must not invent one
    expect(defaultAudioBitrate([])).toBe(0);
  });

  it('filters codecs and formats by what the browser can encode', () => {
    expect(codecChoices(caps({}), 'mp4')).toEqual(['avc', 'av1', 'vp9']);
    expect(codecChoices(caps({}), 'mov')).toEqual(['avc']);
    expect(availability(caps({ mov: false }), 'mov', true, true)).toEqual({ ok: false, reason: 'this browser can’t create MOV' });
    expect(availability(caps({}), 'mp4', false, true).ok).toBe(false);
    expect(availability(caps({}), 'mp3', true, false).ok).toBe(false);
    expect(availability(null, 'webm', true, true).ok).toBe(true);
  });
});

describe('ui helpers', () => {
  it('estimates time left only once there is progress', () => {
    expect(etaSeconds(1, 0.5)).toBeNull();
    expect(etaSeconds(10, 0.01)).toBeNull();
    expect(etaSeconds(10, 0.25)).toBe(30);
  });

  it('formats size changes', () => {
    expect(sizeChange(100, 65)).toEqual({ text: '−35%', smaller: true });
    expect(sizeChange(100, 112)).toEqual({ text: '+12%', smaller: false });
  });

  it('maps engine errors to friendly text', () => {
    expect(errorText(new MediaError('no-tracks', 'x'), true)).toBe('This video has no sound to save.');
    expect(errorText(new MediaError('out-of-memory', 'x'))).toMatch(/memory/);
    expect(errorText(new MediaError('ffmpeg-failed', 'Check your connection.'))).toBe('Check your connection.');
  });
});

describe('page copy', () => {
  it('fits search limits and links real variants', () => {
    expect(defs.map((d) => d.slug)).toEqual(['video-converter', 'mov-to-mp4', 'webm-to-mp4', 'mp4-to-webm', 'avi-to-mp4', 'mkv-to-mp4']);
    for (const d of defs) {
      expect(d.title.length, d.slug).toBeLessThanOrEqual(65);
      expect(d.description.length, d.slug).toBeLessThanOrEqual(160);
      expect(d.keywords.length).toBeGreaterThanOrEqual(6);
      expect(d.keywords.length).toBeLessThanOrEqual(10);
      expect(d.steps).toHaveLength(3);
      expect(d.faq.length).toBeGreaterThanOrEqual(3);
      expect(d.faq.length).toBeLessThanOrEqual(5);
      expect(d.related!.length).toBeLessThanOrEqual(4);
      expect(d.h1).toMatch(/\*\w+\*/);
    }
  });
});
