import { planVideoSize, suggestedBitrate } from './math';
import { containers, isAudioContainer, type AudioCodec, type MediaInfo, type TranscodeOptions, type VideoCodec } from './types';

/*
 * Pure helpers for the ffmpeg.wasm fallback: building command lines and reading
 * `ffmpeg -i` logs. Kept apart from ffmpeg.ts so they can be unit tested in node.
 */

/*
 * Encoders that actually work in @ffmpeg/core 0.12.10 (single-thread), tested in Chrome:
 * libx264, libvpx (VP8), aac, libmp3lame, libvorbis, flac, PCM and ffmpeg's native opus.
 * libvpx-vp9 and libopus trap ("memory access out of bounds"); libx265 is too slow to use.
 * So the fallback writes H.264 into MP4/MOV/MKV and VP8 into WebM; Opus uses the native encoder.
 */
const FALLBACK_VIDEO: Record<VideoCodec, 'avc' | 'vp8'> = { avc: 'avc', hevc: 'avc', vp9: 'vp8', av1: 'vp8', vp8: 'vp8' };

const VIDEO_ENCODER: Record<'avc' | 'vp8', string[]> = {
  avc: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
  vp8: ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'],
};

const AUDIO_ENCODER: Record<AudioCodec, string[]> = {
  aac: ['aac'],
  opus: ['opus', '-strict', '-2'],
  mp3: ['libmp3lame'],
  flac: ['flac'],
  vorbis: ['libvorbis'],
  'pcm-s16': ['pcm_s16le'],
  'pcm-s24': ['pcm_s24le'],
  'pcm-f32': ['pcm_f32le'],
};

const label: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };

const CRF: Record<string, number> = { 'very-low': 34, low: 29, medium: 25, high: 22, 'very-high': 19 };

/** atempo-free tape speed change, matching the WebCodecs path (pitch follows speed) */
const tapeSpeed = (speed: number, rate: number) => `asetrate=${Math.round(rate * speed)},aresample=${rate}`;

export interface FfmpegJob {
  args: string[];
  output: string;
  notes: string[];
}

/**
 * Full transcode through ffmpeg, used when the browser has no WebCodecs at all.
 * `input` / `replace` are paths inside the ffmpeg filesystem.
 */
export function buildTranscodeArgs(o: TranscodeOptions, info: MediaInfo, input: string, replace?: string): FfmpegJob {
  const c = containers[o.container];
  const notes: string[] = [];
  const output = `/out/output.${c.ext}`;
  const args: string[] = ['-hide_banner', '-nostdin'];
  const start = Math.max(0, o.trim?.start ?? 0);
  const end = Math.min(o.trim?.end ?? info.durationSec, info.durationSec || Infinity);
  if (start > 0) args.push('-ss', start.toFixed(3));
  args.push('-i', input);
  const replacing = o.audio && o.audio.replace && replace;
  if (replacing) args.push('-ss', (o.audio && o.audio.replaceOffset ? o.audio.replaceOffset : 0).toFixed(3), '-i', replace);
  if (Number.isFinite(end) && end > start) args.push('-t', (end - start).toFixed(3));

  const v = o.video === false || isAudioContainer(o.container) || !info.video ? null : (o.video ?? {});
  const a = o.audio === false || (!info.audio && !replacing) ? null : (o.audio ?? {});
  const speed = v?.speed && v.speed > 0 ? v.speed : 1;

  if (v) args.push('-map', '0:v:0');
  if (a) args.push('-map', replacing ? '1:a:0' : '0:a:0');
  if (!v) args.push('-vn');
  if (!a) args.push('-an');
  args.push('-sn', '-dn');

  if (v && info.video) {
    const filters: string[] = [];
    if (v.rotate === 90) filters.push('transpose=1');
    else if (v.rotate === 180) filters.push('hflip,vflip');
    else if (v.rotate === 270) filters.push('transpose=2');
    if (v.flipHorizontal) filters.push('hflip');
    if (v.flipVertical) filters.push('vflip');
    if (v.crop) filters.push(`crop=${Math.round(v.crop.width)}:${Math.round(v.crop.height)}:${Math.round(v.crop.x)}:${Math.round(v.crop.y)}`);
    const size = planVideoSize(info.video.displayWidth, info.video.displayHeight, v);
    if (size.fit === 'contain' && v.width && v.height) {
      filters.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`, `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`);
    } else if (size.fit === 'cover' && v.width && v.height) {
      filters.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=increase`, `crop=${size.width}:${size.height}`);
    } else if (size.width !== size.sourceWidth || size.height !== size.sourceHeight) {
      filters.push(`scale=${size.width}:${size.height}`);
    }
    filters.push('setsar=1');
    if (speed !== 1) filters.push(`setpts=PTS/${speed}`);
    if (v.fps) filters.push(`fps=${v.fps}`);
    args.push('-vf', filters.join(','));

    const wanted = v.codec && c.video.includes(v.codec) ? v.codec : c.video[0];
    // H.264 can't go in WebM, VP8 can't go in MP4/MOV
    const codec = c.video.includes(FALLBACK_VIDEO[wanted]) ? FALLBACK_VIDEO[wanted] : c.video.includes('avc') ? 'avc' : 'vp8';
    if (v.codec && codec !== v.codec) notes.push(`The fallback encoder can't write ${label[v.codec]}; used ${label[codec]}.`);
    args.push(...VIDEO_ENCODER[codec]);
    const duration = (end - start) / speed;
    const bitrate = v.bitrate ?? (v.targetSizeBytes && duration > 0 ? Math.max(50_000, Math.floor((v.targetSizeBytes * 8 * 0.95) / duration - 128_000)) : undefined);
    const level = v.quality ?? 'medium';
    if (bitrate) args.push('-b:v', String(Math.round(bitrate)));
    // VP8's crf is "constrained quality": it needs a bitrate ceiling
    else if (codec === 'vp8') args.push('-crf', String(CRF[level] - 10), '-b:v', String(2 * suggestedBitrate(size.width, size.height, v.fps ?? info.video.fps ?? 30, level)));
    else args.push('-crf', String(CRF[level]));
    if (v.keyFrameInterval && info.video.fps) args.push('-g', String(Math.round(v.keyFrameInterval * (v.fps ?? info.video.fps))));
  }

  if (a) {
    const codec = a.codec && c.audio.includes(a.codec) ? a.codec : c.audio[0];
    args.push('-c:a', ...AUDIO_ENCODER[codec]);
    if (a.bitrate && !codec.startsWith('pcm') && codec !== 'flac') args.push('-b:a', String(Math.round(a.bitrate)));
    else if (codec === 'mp3' || codec === 'aac' || codec === 'opus' || codec === 'vorbis') args.push('-b:a', a.quality === 'very-high' ? '256k' : a.quality === 'low' || a.quality === 'very-low' ? '96k' : '160k');
    const rate = a.sampleRate ?? (codec === 'opus' ? 48000 : info.audio?.sampleRate ?? 48000);
    if (a.sampleRate || codec === 'opus') args.push('-ar', String(rate));
    // ffmpeg's native Opus encoder is mono/stereo only
    const channels = codec === 'opus' ? Math.min(2, a.channels ?? info.audio?.channels ?? 2) : a.channels;
    if (channels && (a.channels || channels !== info.audio?.channels)) args.push('-ac', String(channels));
    const af: string[] = [];
    if (speed !== 1 && !replacing) af.push(tapeSpeed(speed, rate));
    if (a.gainDb) af.push(`volume=${a.gainDb}dB`);
    if (af.length) args.push('-af', af.join(','));
  }
  if (replacing) args.push('-shortest');
  if (o.container === 'mp4' || o.container === 'mov' || o.container === 'm4a') args.push('-movflags', '+faststart');
  if (o.keepMetadata === false) args.push('-map_metadata', '-1');
  args.push(output);
  return { args, output, notes };
}

/**
 * Remux/transcode into a Matroska file WebCodecs can decode, so the regular pipeline
 * (hooks, trims, every option) can take over. Video is copied when the browser can
 * decode it, otherwise re-encoded with x264 at high quality; audio becomes PCM (or FLAC
 * when PCM would be huge).
 */
export function buildNormalizeArgs(
  input: string,
  o: { copyVideo: boolean; start?: number; end?: number; durationSec: number; hasVideo: boolean; hasAudio: boolean },
): FfmpegJob & { offset: number } {
  const args = ['-hide_banner', '-nostdin'];
  // seeking is only frame-accurate when re-encoding, so copies keep the whole file
  const cut = !o.copyVideo || !o.hasVideo;
  const start = cut ? Math.max(0, o.start ?? 0) : 0;
  const end = cut ? Math.min(o.end ?? o.durationSec, o.durationSec || Infinity) : Infinity;
  if (start > 0) args.push('-ss', start.toFixed(3));
  args.push('-i', input);
  if (Number.isFinite(end) && end > start) args.push('-t', (end - start).toFixed(3));
  if (o.hasVideo) args.push('-map', '0:v:0', ...(o.copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-pix_fmt', 'yuv420p']));
  if (o.hasAudio) {
    const seconds = (Number.isFinite(end) ? end : o.durationSec) - start;
    // 16-bit stereo 48 kHz is ~11.5 MB a minute; beyond ~25 min switch to lossless FLAC (about half the size)
    const pcm = seconds > 0 && seconds < 25 * 60;
    args.push('-map', '0:a:0', ...(pcm ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'flac']));
  }
  args.push('-sn', '-dn', '/out/normalized.mkv');
  // the normalized file starts at `offset` in the original timeline
  return { args, output: '/out/normalized.mkv', notes: [], offset: start };
}

const FF_VIDEO: Record<string, string> = { h264: 'avc', hevc: 'hevc', vp9: 'vp9', vp8: 'vp8', av1: 'av1' };
const FF_AUDIO: Record<string, string> = { aac: 'aac', opus: 'opus', mp3: 'mp3', flac: 'flac', vorbis: 'vorbis', pcm_s16le: 'pcm-s16' };

/** Reads the stream summary ffmpeg prints for `ffmpeg -i file` */
export function parseFfmpegProbe(log: string, sizeBytes: number): MediaInfo | null {
  const input = /Input #0, ([^,\s]+)/.exec(log);
  if (!input) return null;
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const durationSec = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const info: MediaInfo = { container: input[1], durationSec, sizeBytes, readable: false, needsFallback: true, via: 'ffmpeg' };

  const video = /Stream #0:\d+[^:]*: Video: ([a-z0-9_]+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*/.exec(log);
  if (video) {
    const line = video[0];
    const fps = /([\d.]+) fps/.exec(line) ?? /([\d.]+) tbr/.exec(line);
    const kbs = /(\d+) kb\/s/.exec(line);
    const rot = /rotation of (-?[\d.]+) degrees/.exec(log) ?? /rotate\s*:\s*(-?\d+)/.exec(log);
    const rotation = (((Math.round(-Number(rot?.[1] ?? 0) / 90) * 90) % 360) + 360) % 360;
    const w = +video[2];
    const h = +video[3];
    const swap = rotation === 90 || rotation === 270;
    info.video = {
      codec: FF_VIDEO[video[1]] ?? video[1],
      width: w,
      height: h,
      displayWidth: swap ? h : w,
      displayHeight: swap ? w : h,
      rotation: rotation as 0 | 90 | 180 | 270,
      fps: fps ? Number(fps[1]) : null,
      bitrate: kbs ? +kbs[1] * 1000 : null,
      canDecode: false,
    };
  }
  const audio = /Stream #0:\d+[^:]*: Audio: ([a-z0-9_]+)[^\n]*?, (\d+) Hz, ([^,\n]+)[^\n]*/.exec(log);
  if (audio) {
    const layout = audio[3].trim();
    const surround = /^(\d+)\.(\d)/.exec(layout);
    const channels = layout === 'mono' ? 1 : layout === 'stereo' ? 2 : surround ? +surround[1] + +surround[2] : Number(/(\d+) channels/.exec(layout)?.[1] ?? 2);
    const kbs = /(\d+) kb\/s/.exec(audio[0]);
    info.audio = { codec: FF_AUDIO[audio[1]] ?? audio[1], sampleRate: +audio[2], channels, bitrate: kbs ? +kbs[1] * 1000 : null, canDecode: false };
  }
  return info;
}

/** ffmpeg prints "time=00:01:02.50" while encoding; seconds, or null */
export function parseFfmpegTime(line: string): number | null {
  const m = /time=\s*(-?)(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m || m[1] === '-') return null;
  return +m[2] * 3600 + +m[3] * 60 + +m[4];
}
