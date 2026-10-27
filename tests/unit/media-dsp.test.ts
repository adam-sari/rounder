import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePeaks, dbToGain, encoderSampleRate, fade, mixdown, PeakAccumulator, parseWav, resample, Resampler, writeWav } from '@/engines/media/dsp';
import { parseFfmpegProbe, parseFfmpegTime, buildTranscodeArgs, buildNormalizeArgs } from '@/engines/media/ffargs';
import type { MediaInfo } from '@/engines/media/types';

const sine = (freq: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

const zeroCrossings = (x: Float32Array) => {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
  return n;
};

describe('WAV writer / reader', () => {
  it('writes a canonical 16-bit header', () => {
    const buf = writeWav({ sampleRate: 44100, channels: [new Float32Array(10), new Float32Array(10)] });
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint32(40, true)).toBe(40);
    expect(buf.byteLength).toBe(84);
  });

  it.each(['pcm-s16', 'pcm-s24', 'pcm-f32'] as const)('round-trips %s', (format) => {
    const left = sine(440, 8000, 0.05);
    const right = sine(1000, 8000, 0.05, 0.9);
    const back = parseWav(writeWav({ sampleRate: 8000, channels: [left, right] }, format));
    expect(back.sampleRate).toBe(8000);
    expect(back.channels).toHaveLength(2);
    const tol = format === 'pcm-s16' ? 1e-4 : 1e-6;
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(back.channels[0][i] - left[i])).toBeLessThan(tol);
      expect(Math.abs(back.channels[1][i] - right[i])).toBeLessThan(tol);
    }
  });

  it('clips out-of-range samples instead of wrapping', () => {
    const back = parseWav(writeWav({ sampleRate: 8000, channels: [Float32Array.from([1.5, -1.5, 1, -1])] }));
    expect(Array.from(back.channels[0]).map((x) => Math.round(x * 1000) / 1000)).toEqual([1, -1, 1, -1]);
  });

  it('reads the ffmpeg-made fixture', () => {
    const file = readFileSync('tests/fixtures/media/sample.wav');
    const pcm = parseWav(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    expect(pcm.sampleRate).toBe(44100);
    expect(pcm.channels).toHaveLength(2);
    expect(pcm.channels[0].length).toBe(88200);
    // a 440 Hz tone crosses zero 880 times a second
    expect(zeroCrossings(pcm.channels[0].subarray(0, 44100))).toBeGreaterThan(870);
    expect(zeroCrossings(pcm.channels[0].subarray(0, 44100))).toBeLessThan(890);
  });
});

describe('peaks', () => {
  it('finds min, max and rms per bucket', () => {
    const ch = Float32Array.from([0, 0.5, -0.25, 0, 1, -1, 0, 0]);
    const p = computePeaks([ch], 2);
    expect(Array.from(p.max)).toEqual([0.5, 1]);
    expect(Array.from(p.min)).toEqual([-0.25, -1]);
    expect(p.rms[1]).toBeCloseTo(Math.sqrt(2 / 4), 6);
  });

  it('takes the loudest channel and works incrementally', () => {
    const a = sine(100, 1000, 1, 0.2);
    const b = sine(100, 1000, 1, 0.8);
    const whole = computePeaks([a, b], 10);
    const acc = new PeakAccumulator(1000, 10);
    for (let i = 0; i < 1000; i += 137) acc.push([a.subarray(i, i + 137), b.subarray(i, i + 137)]);
    const parts = acc.result();
    expect(Array.from(parts.max)).toEqual(Array.from(whole.max));
    expect(Array.from(parts.min)).toEqual(Array.from(whole.min));
    // the loud channel wins; a sampled 100 Hz sine at 1 kHz peaks at 0.8 · sin(0.4π)
    expect(Math.max(...whole.max)).toBeCloseTo(0.8 * Math.sin(0.4 * Math.PI), 5);
  });

  it('puts frames past the estimate in the last bucket', () => {
    const acc = new PeakAccumulator(4, 2);
    acc.push([Float32Array.from([0, 0, 0, 0, 0.9])]);
    expect(acc.result().max[1]).toBeCloseTo(0.9);
  });
});

describe('resampling', () => {
  it('halves the length and doubles the pitch at speed 2 (tape style)', () => {
    const x = sine(100, 8000, 1);
    const out = new Resampler(2, 1).process([x])[0];
    expect(out.length).toBeGreaterThan(3990);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(zeroCrossings(out) / (out.length / 8000)).toBeCloseTo(400, -1);
  });

  it('is seamless across chunk boundaries', () => {
    const x = sine(50, 8000, 0.5);
    const whole = new Resampler(0.75, 1).process([x])[0];
    const r = new Resampler(0.75, 1);
    const pieces = [x.subarray(0, 1000), x.subarray(1000, 1333), x.subarray(1333)].map((c) => r.process([c])[0]);
    const joined = Float32Array.from(pieces.flatMap((p) => Array.from(p)));
    expect(joined.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(joined[i]).toBeCloseTo(whole[i], 5);
  });

  it('converts sample rates', () => {
    const pcm = resample({ sampleRate: 48000, channels: [sine(1000, 48000, 0.1)] }, 44100);
    expect(pcm.sampleRate).toBe(44100);
    expect(Math.abs(pcm.channels[0].length - 4410)).toBeLessThanOrEqual(1);
  });

  it('keeps a constant signal constant', () => {
    const out = new Resampler(1.37, 2).process([new Float32Array(500).fill(0.3), new Float32Array(500).fill(-0.3)]);
    expect(out[0].every((v) => Math.abs(v - 0.3) < 1e-6)).toBe(true);
    expect(out[1].every((v) => Math.abs(v + 0.3) < 1e-6)).toBe(true);
  });
});

describe('misc dsp', () => {
  it('mixes down and converts dB', () => {
    expect(Array.from(mixdown([Float32Array.from([1, 0]), Float32Array.from([0, 1])]))).toEqual([0.5, 0.5]);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });

  it('fades both ends to silence', () => {
    const ch = new Float32Array(100).fill(1);
    fade([ch], 100, { inSec: 0.1, outSec: 0.1 });
    expect(ch[0]).toBe(0);
    expect(ch[99]).toBe(0);
    expect(ch[50]).toBe(1);
  });

  it('picks encoder-safe sample rates', () => {
    expect(encoderSampleRate('opus', 44100)).toBe(48000);
    expect(encoderSampleRate('aac', 22050)).toBe(44100);
    expect(encoderSampleRate('aac', 96000)).toBe(48000);
    expect(encoderSampleRate('mp3', 44100)).toBe(44100);
    expect(encoderSampleRate('flac', 96000)).toBe(96000);
  });
});

describe('ffmpeg fallback helpers', () => {
  const log = `Input #0, avi, from '/in1/input0.avi':
  Metadata:
    software        : Lavf62.3.100
  Duration: 00:01:02.04, start: 0.000000, bitrate: 621 kb/s
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 320x180 [SAR 1:1 DAR 16:9], 520 kb/s, 25 fps, 25 tbr, 25 tbn
  Stream #0:1: Audio: mp3 (mp3float) (U[0][0][0] / 0x0055), 44100 Hz, stereo, fltp, 96 kb/s
      Side data:
        displaymatrix: rotation of -90.00 degrees
At least one output file must be specified`;

  it('reads ffmpeg -i output', () => {
    const info = parseFfmpegProbe(log, 1234)!;
    expect(info.container).toBe('avi');
    expect(info.durationSec).toBeCloseTo(62.04);
    expect(info.video).toMatchObject({ codec: 'mpeg4', width: 320, height: 180, displayWidth: 180, displayHeight: 320, rotation: 90, fps: 25, bitrate: 520_000 });
    expect(info.audio).toMatchObject({ codec: 'mp3', sampleRate: 44100, channels: 2, bitrate: 96_000 });
    expect(parseFfmpegProbe('garbage', 1)).toBeNull();
    expect(parseFfmpegProbe(`Input #0, wav, from 'x':\n  Duration: 00:00:02.00\n  Stream #0:0: Audio: pcm_s16le, 48000 Hz, 5.1(side), s16`, 1)!.audio!.channels).toBe(6);
  });

  it('reads progress times', () => {
    expect(parseFfmpegTime('frame=  50 fps=0.0 q=-1.0 size=  256kB time=00:01:02.50 bitrate=')).toBe(62.5);
    expect(parseFfmpegTime('time=N/A')).toBeNull();
    expect(parseFfmpegTime('time=-00:00:00.02')).toBeNull();
  });

  const info: MediaInfo = {
    container: 'avi',
    durationSec: 10,
    sizeBytes: 1,
    readable: false,
    needsFallback: true,
    via: 'ffmpeg',
    video: { codec: 'mpeg4', width: 640, height: 360, displayWidth: 640, displayHeight: 360, rotation: 0, fps: 25, bitrate: null, canDecode: false },
    audio: { codec: 'mp3', sampleRate: 44100, channels: 2, bitrate: null, canDecode: false },
  };

  it('builds a full transcode command', () => {
    const { args, output } = buildTranscodeArgs(
      { container: 'mp4', trim: { start: 2, end: 6 }, video: { width: 320, rotate: 90, speed: 2, quality: 'high' }, audio: { gainDb: 3 } },
      info,
      '/in/a.avi',
    );
    const joined = args.join(' ');
    expect(joined).toContain('-ss 2.000 -i /in/a.avi -t 4.000');
    expect(joined).toContain('transpose=1');
    expect(joined).toContain('scale=320:568'); // 320 × 640/360 = 568.9, evened down
    expect(joined).toContain('setpts=PTS/2');
    expect(joined).toContain('libx264');
    expect(joined).toContain('-crf 22');
    expect(joined).toContain('asetrate=88200,aresample=44100,volume=3dB');
    expect(joined).toContain('+faststart');
    expect(output).toBe('/out/output.mp4');
  });

  it('builds audio-only and muted commands', () => {
    const mp3 = buildTranscodeArgs({ container: 'mp3', audio: { bitrate: 192_000 } }, info, '/in/a.avi').args.join(' ');
    expect(mp3).toContain('-vn');
    expect(mp3).toContain('libmp3lame -b:a 192000');
    expect(mp3).not.toContain('-map 0:v');
    const muted = buildTranscodeArgs({ container: 'webm', audio: false }, info, '/in/a.avi').args.join(' ');
    expect(muted).toContain('-an');
    expect(muted).toContain('-c:v libvpx ');
  });

  it('only uses encoders that work in the wasm core', () => {
    const webm = buildTranscodeArgs({ container: 'webm', video: { codec: 'vp9' } }, info, '/in/a.avi');
    const w = webm.args.join(' ');
    expect(w).not.toMatch(/libvpx-vp9|libopus/);
    expect(w).toContain('-c:a opus -strict -2');
    expect(w).toMatch(/-crf \d+ -b:v \d+/); // VP8 constrained quality needs a ceiling
    expect(webm.notes.join()).toContain('VP9');
    const hevc = buildTranscodeArgs({ container: 'mp4', video: { codec: 'hevc' } }, info, '/in/a.avi');
    expect(hevc.args.join(' ')).toContain('libx264');
    expect(hevc.args.join(' ')).not.toContain('libx265');
    const ogg = buildTranscodeArgs({ container: 'ogg', audio: { channels: 6 } }, info, '/in/a.avi').args.join(' ');
    expect(ogg).toContain('-ar 48000 -ac 2');
  });

  it('copies video when normalizing and only cuts when re-encoding', () => {
    const copy = buildNormalizeArgs('/in/a.avi', { copyVideo: true, start: 3, durationSec: 10, hasVideo: true, hasAudio: true });
    expect(copy.args.join(' ')).toContain('-c:v copy');
    expect(copy.args).not.toContain('-ss');
    expect(copy.offset).toBe(0);
    const cut = buildNormalizeArgs('/in/a.avi', { copyVideo: false, start: 3, end: 5, durationSec: 10, hasVideo: true, hasAudio: true });
    expect(cut.args.join(' ')).toContain('-ss 3.000 -i /in/a.avi -t 2.000');
    expect(cut.args.join(' ')).toContain('pcm_s16le');
    expect(cut.offset).toBe(3);
    const long = buildNormalizeArgs('/in/a.avi', { copyVideo: true, durationSec: 3600, hasVideo: true, hasAudio: true });
    expect(long.args.join(' ')).toContain('-c:a flac');
  });
});
