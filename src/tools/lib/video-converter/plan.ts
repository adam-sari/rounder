import {
  audioCodecLabel,
  containers,
  isAudioContainer,
  videoCodecLabel,
  type AudioCodec,
  type Capabilities,
  type Container,
  type MediaErrorCode,
  type MediaInfo,
  type QualityLevel,
  type TranscodeOptions,
  type VideoCodec,
  type VideoOptions,
} from '@/engines/media/types';

export const VIDEO_OUTPUTS = ['mp4', 'webm', 'mov', 'mkv'] as const;
export const AUDIO_OUTPUTS = ['mp3', 'm4a', 'wav'] as const;
export type VideoOutput = (typeof VIDEO_OUTPUTS)[number];
export type Output = VideoOutput | (typeof AUDIO_OUTPUTS)[number];

export const isOutput = (v: unknown): v is Output => [...VIDEO_OUTPUTS, ...AUDIO_OUTPUTS].includes(v as Output);

export type Quality = 'original' | 'high' | 'medium' | 'low';
export const QUALITIES: [Quality, string][] = [['original', 'original'], ['high', 'high'], ['medium', 'balanced'], ['low', 'small']];
// "original" only re-encodes when it has to, and then aims as close to the source as it can
const qualityLevel: Record<Quality, QualityLevel> = { original: 'very-high', high: 'high', medium: 'medium', low: 'low' };

/**
 * Codecs worth copying as-is into each container. MP4 can technically hold VP9/AV1 and Opus,
 * but few phones, TVs and editors play that, and compatibility is why people convert to MP4.
 */
const COPY_VIDEO: Record<VideoOutput, readonly string[]> = { mp4: ['avc', 'hevc'], mov: ['avc', 'hevc'], webm: ['vp9', 'av1', 'vp8'], mkv: containers.mkv.video };
const COPY_AUDIO: Record<VideoOutput, readonly string[]> = { mp4: ['aac', 'mp3'], mov: ['aac', 'pcm-s16'], webm: ['opus', 'vorbis'], mkv: containers.mkv.audio };

export const codecHint: Record<VideoCodec, string> = {
  avc: 'plays on nearly everything',
  hevc: 'smaller, but some PCs and older devices can’t play it',
  av1: 'smallest files, slow to encode, needs newer devices',
  vp9: 'the usual WebM codec, plays in every major browser',
  vp8: 'older and bigger, for very old players',
};

export interface Settings {
  container: Output;
  codec: 'auto' | VideoCodec;
  quality: Quality;
  /** target short side in pixels; 0 keeps the original size */
  resolution: number;
  keepAudio: boolean;
  /** for MP3/M4A outputs; 0 copies the audio when it already fits */
  audioBitrate: number;
}

export interface Plan {
  options: TranscodeOptions;
  copyVideo: boolean;
  copyAudio: boolean;
  /** what the video ends up as (codec id), null for audio outputs */
  videoCodec: string | null;
  /** what the audio ends up as, null when there is none */
  audioCodec: string | null;
}

/** Whether this browser can write `c` for this file, and why not */
export function availability(caps: Capabilities | null, c: Output, hasVideo: boolean, hasAudio: boolean): { ok: boolean; reason?: string } {
  const label = containers[c].label;
  if (!isAudioContainer(c) && !hasVideo) return { ok: false, reason: 'this file has no video' };
  if (isAudioContainer(c) && !hasAudio) return { ok: false, reason: 'this file has no sound' };
  if (caps && !caps.containers[c]) return { ok: false, reason: `this browser can’t create ${label}` };
  return { ok: true };
}

/** video codecs this browser can encode into `c`, best default first */
export const codecChoices = (caps: Capabilities | null, c: Output): VideoCodec[] => containers[c].video.filter((v) => caps?.video.encode.includes(v));

const LADDER = [2160, 1440, 1080, 720, 480, 360];

/** standard sizes below the source's short side */
export const resolutionChoices = (width: number, height: number) => LADDER.filter((n) => n < Math.min(width, height));
export const resolutionLabel = (n: number) => (n === 2160 ? '4K' : `${n}p`);

/** "1080p" means the short side, so portrait phone videos shrink by width */
export const sizeFor = (width: number, height: number, n: number): Pick<VideoOptions, 'width' | 'height'> => (width >= height ? { height: n } : { width: n });

/**
 * The engine downmixes surround to stereo (a re-encode), and the ffmpeg fallback hands audio
 * over as PCM/FLAC, so only decodable mono/stereo audio can really be copied.
 */
const copyableAudio = (info: MediaInfo, codecs: readonly string[]) =>
  !!info.audio && info.readable && info.audio.canDecode && info.audio.channels <= 2 && codecs.includes(info.audio.codec ?? '');

/** MP3 / M4A bitrate choices; 0 ("original") only when the audio can be copied */
export function audioBitrateChoices(c: Output, info: MediaInfo | null): number[] {
  if (c !== 'mp3' && c !== 'm4a') return [];
  const ladder = c === 'mp3' ? [128_000, 192_000, 256_000, 320_000] : [128_000, 160_000, 192_000];
  return info && copyableAudio(info, containers[c].audio) ? [0, ...ladder] : ladder;
}

/** 0 (copy, or the encoder default for WAV) unless a bitrate has to be picked */
export const defaultAudioBitrate = (choices: number[]) => (choices.length && !choices.includes(0) ? 192_000 : 0);

/**
 * Turns the form into transcode options. Streams are copied untouched (fast, lossless) when
 * the codec suits the container and nothing asks for a re-encode.
 */
export function planConversion(info: MediaInfo, s: Settings, encodable: VideoCodec[] = []): Plan {
  const c = containers[s.container];
  const srcAudio = info.audio?.codec ?? '';

  if (isAudioContainer(s.container)) {
    const copyAudio = s.audioBitrate === 0 && copyableAudio(info, c.audio);
    return {
      options: { container: s.container, video: false, audio: s.audioBitrate ? { bitrate: s.audioBitrate } : {} },
      copyVideo: false,
      copyAudio,
      videoCodec: null,
      audioCodec: copyAudio ? srcAudio : c.audio[0],
    };
  }

  const out = s.container as VideoOutput;
  const v = info.video;
  const src = v?.codec ?? '';
  const shrink = !!v && s.resolution > 0 && s.resolution < Math.min(v.displayWidth, v.displayHeight);
  // the engine bakes rotation into the pixels, so a rotated (portrait phone) stream is always re-encoded;
  // video in a readable file that the browser can't decode is re-encoded by the fallback first
  const copyVideo =
    !!v && !v.rotation && (v.canDecode || !info.readable) && s.quality === 'original' && !shrink && (s.codec === src || (s.codec === 'auto' && COPY_VIDEO[out].includes(src)));
  const wanted = s.codec !== 'auto' && encodable.includes(s.codec) ? s.codec : c.video.find((x) => encodable.includes(x));

  const keepAudio = s.keepAudio && !!info.audio;
  // undecodable video sends the whole file through the fallback, which also converts the audio
  const copyAudio = keepAudio && (!v || v.canDecode) && copyableAudio(info, COPY_AUDIO[out]);

  const options: TranscodeOptions = { container: s.container };
  if (!copyVideo) {
    // re-encoding at "original" quality follows the source's own bitrate (with headroom for a codec
    // change) instead of a fixed preset, so a lean 400 kbps clip doesn't come out six times bigger
    const followSource = s.quality === 'original' && !shrink && !!v?.bitrate;
    options.video = {
      codec: s.codec === 'auto' ? undefined : s.codec,
      ...(followSource ? { bitrate: Math.round(v!.bitrate! * 1.25) } : { quality: qualityLevel[s.quality] }),
      ...(v && shrink ? sizeFor(v.displayWidth, v.displayHeight, s.resolution) : {}),
    };
  }
  // naming the codec forces a re-encode even where the container would accept the original
  if (!keepAudio) options.audio = false;
  else if (!copyAudio) options.audio = { codec: c.audio[0] };

  return {
    options,
    copyVideo,
    copyAudio,
    videoCodec: copyVideo ? src : (wanted ?? null),
    audioCodec: keepAudio ? (copyAudio ? srcAudio : c.audio[0]) : null,
  };
}

export const videoName = (codec: string | null | undefined) => (codec ? (videoCodecLabel[codec as VideoCodec] ?? codec.toUpperCase()) : 'unknown');
export const audioName = (codec: string | null | undefined) => (codec ? (audioCodecLabel[codec as AudioCodec] ?? codec.toUpperCase()) : 'unknown');

/** short lines explaining what will happen to each stream */
export function describePlan(plan: Plan, s: Settings, hasAudio: boolean): string[] {
  const lines: string[] = [];
  if (!isAudioContainer(s.container)) {
    lines.push(plan.copyVideo ? `video: ${videoName(plan.videoCodec)}, copied as-is` : `video: re-encoded to ${videoName(plan.videoCodec)}`);
  }
  if (!hasAudio) lines.push('audio: none in this file');
  else if (!plan.audioCodec) lines.push('audio: removed');
  else if (plan.copyAudio) lines.push(`audio: ${audioName(plan.audioCodec)}, copied as-is`);
  else lines.push(`audio: re-encoded to ${audioName(plan.audioCodec)}${s.audioBitrate && isAudioContainer(s.container) ? ` at ${s.audioBitrate / 1000} kbps` : ''}`);
  return lines;
}

/** nothing gets re-encoded, so the job is a quick, lossless rewrap */
export const isFastPath = (plan: Plan) => (plan.videoCodec === null || plan.copyVideo) && (plan.audioCodec === null || plan.copyAudio);

/** friendly text for a MediaError (or anything else thrown) */
export function errorText(e: unknown, audioOnly = false): string {
  const err = e as { code?: MediaErrorCode; message?: string } | null;
  switch (err?.code) {
    case 'no-tracks':
      return audioOnly ? 'This video has no sound to save.' : 'This file has no video or audio we can convert.';
    case 'unsupported-codec':
      return 'This browser can’t encode that format. Try MP4 with H.264, or a recent Chrome or Edge.';
    case 'out-of-memory':
      return 'Your device ran out of memory. Try a lower resolution, or close other tabs and try again.';
    case 'unsupported-input':
      return 'This file couldn’t be read. It may be damaged, or use a codec the browser can’t decode.';
    default:
      return err?.message || 'Something went wrong while converting. Please try again.';
  }
}

/** seconds left, once there's enough progress to guess */
export function etaSeconds(elapsedSec: number, progress: number): number | null {
  if (progress < 0.03 || elapsedSec < 1.5 || progress >= 1) return null;
  return (elapsedSec * (1 - progress)) / progress;
}

/** "−35%" / "+12%" and whether the file got smaller */
export function sizeChange(before: number, after: number): { text: string; smaller: boolean } {
  const pct = Math.round((1 - after / before) * 100);
  return pct >= 0 ? { text: `−${pct}%`, smaller: pct > 0 } : { text: `+${-pct}%`, smaller: false };
}
