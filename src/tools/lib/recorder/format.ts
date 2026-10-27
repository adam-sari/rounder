import { clamp, suggestedBitrate } from '@/engines/media/math';

/**
 * MediaRecorder formats, best first. H.264/AAC in MP4 plays everywhere (Safari, recent Chrome
 * and Edge record it natively); otherwise WebM. Opus-in-MP4 is skipped on purpose: QuickTime
 * and many phones can't play it, while WebM converts cleanly to a real MP4 afterwards.
 */
const WITH_AUDIO = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const VIDEO_ONLY = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** the first type the recorder accepts, or '' to let the browser pick its default */
export function pickMimeType(isSupported: (type: string) => boolean, hasAudio: boolean): string {
  return (hasAudio ? WITH_AUDIO : VIDEO_ONLY).find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  }) ?? '';
}

export interface RecordedFormat {
  ext: 'mp4' | 'webm' | 'mkv';
  label: string;
  /** worth offering a conversion to MP4 for compatibility */
  convertible: boolean;
}

export function recordedFormat(mime: string): RecordedFormat {
  const m = mime.toLowerCase();
  if (m.startsWith('video/mp4')) return { ext: 'mp4', label: 'MP4', convertible: false };
  // Chrome reports H.264-in-WebM recordings as Matroska
  if (m.includes('matroska')) return { ext: 'mkv', label: 'MKV', convertible: true };
  return { ext: 'webm', label: 'WebM', convertible: true };
}

const CODEC_NAMES: [RegExp, string][] = [
  [/^(avc[13]|h264)/, 'H.264'],
  [/^(hvc1|hev1)/, 'HEVC'],
  [/^(vp09|vp9)/, 'VP9'],
  [/^vp8/, 'VP8'],
  [/^av01/, 'AV1'],
  [/^opus/, 'Opus'],
  [/^mp4a/, 'AAC'],
  [/^vorbis/, 'Vorbis'],
  [/^pcm/, 'PCM'],
];

/** 'video/webm;codecs="vp9,opus"' → "VP9 · Opus" ('' when the type names no codecs) */
export function codecLabel(mime: string): string {
  const list = /codecs\s*=\s*"?([^";]+)"?/i.exec(mime)?.[1] ?? '';
  return list
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .map((c) => CODEC_NAMES.find(([re]) => re.test(c))?.[1])
    .filter(Boolean)
    .join(' · ');
}

/** bits/s for the recorder: browser defaults (~2.5 Mbps) smear screen text at 1080p and above */
export const videoBitrate = (width: number, height: number, fps: number) =>
  clamp(suggestedBitrate(width, height, fps, 'medium'), 2_500_000, 12_000_000);
