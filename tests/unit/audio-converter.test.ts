import { describe, expect, it } from 'vitest';
import tools from '@/tools/defs/audio-converter';
import { filePrivacyFaq } from '@/tools/types';
import type { Capabilities, MediaInfo } from '@/engines/media/types';
import {
  acceptFor,
  batchProgress,
  bitrateChoices,
  bitrateHint,
  defaultBitrate,
  describeAudio,
  dropTitle,
  estimateBytes,
  etaSeconds,
  friendlyError,
  outputShape,
  planFormat,
  sampleRateChoices,
  shortDuration,
  transcodeOptions,
  type Settings,
} from '@/tools/lib/audio-converter/formats';

const slugsAllowed = new Set(
  'video-to-mp3 audio-converter mp3-to-wav wav-to-mp3 m4a-to-mp3 flac-to-mp3 ogg-to-mp3 audio-cutter ringtone-maker audio-joiner volume-booster audio-normalizer pitch-changer audio-speed-changer voice-recorder audio-noise-reduction bpm-finder audiogram-maker'.split(' '),
);

const caps = (encode: string[], m4a = true): Capabilities => ({
  webCodecs: { videoEncoder: true, videoDecoder: true, audioEncoder: true, audioDecoder: true },
  video: { encode: [], decode: [] },
  audio: { encode: encode as Capabilities['audio']['encode'], decode: [], nativeAac: true },
  containers: { mp4: true, mov: true, webm: true, mkv: true, mp3: true, wav: true, ogg: true, m4a, flac: true },
  imageDecoder: true,
});

const info = (o: Partial<MediaInfo['audio']> & { durationSec?: number } = {}): MediaInfo => ({
  container: 'wav',
  durationSec: o.durationSec ?? 60,
  sizeBytes: 1,
  readable: true,
  needsFallback: false,
  via: 'mediabunny',
  audio: { codec: o.codec ?? 'pcm-s16', sampleRate: o.sampleRate ?? 44100, channels: o.channels ?? 2, bitrate: o.bitrate ?? null, canDecode: true },
});

const settings = (o: Partial<Settings> = {}): Settings => ({ format: 'mp3', bitrate: 192_000, depth: 'pcm-s16', sampleRate: 0, channels: 0, keepMetadata: true, ...o });

describe('audio converter pages', () => {
  const slugs = tools.map((t) => t.slug);

  it('puts the main tool first and the variants after it', () => {
    expect(slugs).toEqual(['audio-converter', 'mp3-to-wav', 'wav-to-mp3', 'm4a-to-mp3', 'flac-to-mp3', 'ogg-to-mp3']);
    expect(tools.slice(1).every((t) => t.variantOf === 'audio-converter' && t.island === 'AudioConverter')).toBe(true);
    expect(tools.find((t) => t.slug === 'm4a-to-mp3')?.props).toEqual({ from: 'm4a', to: 'mp3' });
  });

  it.each(tools.map((t) => [t.slug, t] as const))('%s meets the page copy rules', (_, t) => {
    expect(t.category).toBe('audio');
    expect(t.title.length).toBeLessThanOrEqual(65);
    expect(t.description.length).toBeLessThanOrEqual(160);
    expect(t.h1.match(/\*[^*]+\*/g)).toHaveLength(1);
    expect(t.keywords.length).toBeGreaterThanOrEqual(6);
    expect(t.keywords.length).toBeLessThanOrEqual(10);
    expect(t.steps).toHaveLength(3);
    expect(t.faq.length).toBeGreaterThanOrEqual(3);
    expect(t.faq.length).toBeLessThanOrEqual(6);
    expect(t.faq.at(-1)).toBe(filePrivacyFaq);
    expect(t.related!.length).toBeGreaterThanOrEqual(2);
    expect(t.related!.length).toBeLessThanOrEqual(4);
    expect(t.related!.every((s) => slugsAllowed.has(s) && s !== t.slug)).toBe(true);
  });
});

describe('format plans', () => {
  it('assumes the usual codecs before capabilities load', () => {
    expect(planFormat('ogg', null)).toMatchObject({ available: true, codec: 'opus' });
    expect(planFormat('flac', null).viaFallback).toBe(false);
    expect(planFormat('wav', null, 'pcm-s24').codec).toBe('pcm-s24');
  });

  it('follows what the browser can encode', () => {
    expect(planFormat('ogg', caps(['aac', 'mp3', 'vorbis'])).codec).toBe('vorbis');
    expect(planFormat('ogg', caps(['aac', 'mp3']))).toMatchObject({ available: false, reason: expect.any(String) });
    expect(planFormat('flac', caps(['aac', 'mp3', 'opus'])).viaFallback).toBe(true);
    expect(planFormat('flac', caps(['flac'])).viaFallback).toBe(false);
    expect(planFormat('m4a', caps(['mp3'], false)).available).toBe(false);
    expect(planFormat('m4a', caps(['aac'])).reason).toBeUndefined();
  });

  it('offers presets that fit each codec', () => {
    expect(bitrateChoices('mp3')).toEqual([128_000, 192_000, 256_000, 320_000]);
    expect(bitrateChoices('aac').every((b) => b <= 192_000)).toBe(true);
    expect(bitrateChoices('flac')).toEqual([]);
    for (const c of ['mp3', 'aac', 'opus', 'vorbis'] as const) expect(bitrateChoices(c)).toContain(defaultBitrate(c));
    expect(sampleRateChoices('opus')).toEqual([]);
    expect(sampleRateChoices('aac')).not.toContain(22050);
    expect(sampleRateChoices('mp3')[0]).toBe(0);
    expect(bitrateHint('mp3', 128_000)).toMatch(/speech/);
    expect(bitrateHint('mp3', 320_000)).toMatch(/highest/);
    expect(bitrateHint('opus', 128_000)).toMatch(/very good|highest/);
  });
});

describe('transcode options', () => {
  it('drops the bitrate for lossless output and leaves "keep" choices unset', () => {
    expect(transcodeOptions(settings({ format: 'wav' }), 'pcm-s16')).toEqual({
      container: 'wav',
      keepMetadata: true,
      audio: { codec: 'pcm-s16', bitrate: undefined, sampleRate: undefined, channels: undefined },
    });
    expect(transcodeOptions(settings({ sampleRate: 44100, channels: 1, keepMetadata: false }), 'mp3')).toEqual({
      container: 'mp3',
      keepMetadata: false,
      audio: { codec: 'mp3', bitrate: 192_000, sampleRate: 44100, channels: 1 },
    });
  });

  it('knows the real output rate and channel count', () => {
    expect(outputShape(info({ sampleRate: 22050 }), settings(), 'aac')).toEqual({ sampleRate: 44100, channels: 2 });
    expect(outputShape(info({ sampleRate: 44100, channels: 6 }), settings(), 'opus')).toEqual({ sampleRate: 48000, channels: 2 });
    expect(outputShape(info({ sampleRate: 96000 }), settings({ channels: 1 }), 'pcm-s16')).toEqual({ sampleRate: 96000, channels: 1 });
  });
});

describe('size estimates', () => {
  it('estimates lossy files from the bitrate', () => {
    // a minute at 192 kbps is 1.44 MB, plus a little container overhead
    expect(estimateBytes(info(), settings(), 'mp3')).toBe(Math.round(1_440_000 * 1.01));
    // AAC snaps 256k down to the 192k the encoder accepts
    expect(estimateBytes(info(), settings({ bitrate: 256_000 }), 'aac')).toBe(Math.round(1_440_000 * 1.01));
  });

  it('computes WAV exactly and gives up on FLAC', () => {
    expect(estimateBytes(info(), settings({ format: 'wav' }), 'pcm-s16')).toBe(60 * 44100 * 2 * 2 + 44);
    expect(estimateBytes(info(), settings({ format: 'wav', channels: 1 }), 'pcm-s24')).toBe(60 * 44100 * 3 + 44);
    expect(estimateBytes(info(), settings({ format: 'flac' }), 'flac')).toBeNull();
    expect(estimateBytes(info({ durationSec: 0 }), settings(), 'mp3')).toBeNull();
  });
});

describe('labels and progress', () => {
  it('describes the source audio', () => {
    expect(describeAudio(info({ codec: 'mp3', bitrate: 192_000 }))).toBe('MP3 · 44.1 kHz · stereo · 192 kbps');
    expect(describeAudio(info({ codec: 'opus', sampleRate: 48000, channels: 1 }))).toBe('Opus · 48 kHz · mono');
    expect(describeAudio({ ...info(), audio: undefined })).toBe('no audio track');
  });

  it('weights batch progress by duration', () => {
    expect(batchProgress([])).toBe(0);
    expect(batchProgress([{ weight: 30, progress: 1 }, { weight: 90, progress: 0.5 }])).toBeCloseTo(0.625);
    expect(batchProgress([{ weight: 1, progress: 2 }])).toBe(1);
  });

  it('guesses time left only once there is progress', () => {
    expect(etaSeconds(10, 0.01)).toBeNull();
    expect(etaSeconds(10, 0.5)).toBe(10);
    expect(etaSeconds(30, 0.75)).toBe(10);
    expect(shortDuration(4.4)).toBe('4s');
    expect(shortDuration(75)).toBe('1m 15s');
  });

  it('has friendly errors and page helpers', () => {
    expect(friendlyError('no-tracks', 'x')).toMatch(/no audio/);
    expect(friendlyError('failed', 'Disk full.')).toBe('Disk full.');
    expect(friendlyError(undefined, '')).toMatch(/went wrong/);
    expect(acceptFor('flac').startsWith('.flac')).toBe(true);
    expect(acceptFor()).toContain('audio/*');
    expect(dropTitle('m4a')).toBe('Drop M4A files here');
    expect(dropTitle()).toBe('Drop audio files here');
  });
});
