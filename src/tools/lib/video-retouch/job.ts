import { formatBytes, formatTime } from '@/engines/media/math';
import { audioCodecLabel, containers, toMediaError, videoCodecLabel, type AudioCodec, type Capabilities, type Container, type MediaInfo, type VideoCodec } from '@/engines/media/types';

export const VIDEO_CONTAINERS = ['mp4', 'webm', 'mov', 'mkv'] as const satisfies Container[];
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

export const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv';

/** "1:05" / "1:02:03"; durations, elapsed time and ETAs */
export const clock = (sec: number) => formatTime(sec, 0).replace(/^0(?=\d:)/, '');

/** seconds left, once there's enough of a trend to be worth showing */
export function eta(elapsedMs: number, progress: number): number | null {
  if (progress < 0.03 || elapsedMs < 2000 || progress >= 1) return null;
  return ((elapsedMs / progress) * (1 - progress)) / 1000;
}

const codecName = (codec: string | null | undefined, labels: Record<string, string>) => (codec ? (labels[codec] ?? codec.toUpperCase()) : 'unknown');

/** short facts about the input for the file header */
export function infoChips(info: MediaInfo): string[] {
  const chips = [clock(info.durationSec)];
  const v = info.video;
  if (v) {
    chips.push(`${v.displayWidth}×${v.displayHeight}`);
    if (v.fps) chips.push(`${Math.round(v.fps * 100) / 100} fps`);
    chips.push(codecName(v.codec, videoCodecLabel as Record<VideoCodec, string>));
  }
  chips.push(info.audio ? codecName(info.audio.codec, audioCodecLabel as Record<AudioCodec, string>) : 'no audio');
  chips.push(formatBytes(info.sizeBytes));
  return chips;
}

/** why a container can't be picked here, or null when it can */
export function containerBlock(c: VideoContainer, caps: Capabilities | null): string | null {
  if (!caps) return null;
  // without WebCodecs everything goes through the ffmpeg fallback, which is happiest writing MP4
  if (!caps.webCodecs.videoEncoder) return c === 'mp4' ? null : 'Needs WebCodecs, which this browser lacks';
  return caps.containers[c] ? null : `This browser can't encode video for ${containers[c].label}`;
}

/** keeps the input's container when we can write it, else MP4 */
export function defaultContainer(input: string | undefined, caps: Capabilities | null): VideoContainer {
  const same = VIDEO_CONTAINERS.find((c) => c === input);
  if (same && !containerBlock(same, caps)) return same;
  return VIDEO_CONTAINERS.find((c) => !containerBlock(c, caps)) ?? 'mp4';
}

/** "12 MB → 9.4 MB (−22%)" */
export function sizeChange(before: number, after: number): { text: string; smaller: boolean } {
  const pct = before > 0 ? Math.round(((after - before) / before) * 100) : 0;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±';
  return { text: `${formatBytes(before)} → ${formatBytes(after)} (${sign}${Math.abs(pct)}%)`, smaller: after <= before };
}

/** friendly text for a failure, or null when the user cancelled */
export function errorText(err: unknown): string | null {
  // our own code (the audio stretch) can throw plain errors, e.g. a RangeError when memory runs out
  const e = toMediaError(err);
  switch (e.code) {
    case 'aborted':
      return null;
    case 'unsupported-input':
      return `${e.message} Try converting it to MP4 first, or open it in another browser.`;
    case 'unsupported-codec':
      return `${e.message} Pick MP4, which every current browser can write.`;
    case 'no-webcodecs':
      return 'This browser is missing WebCodecs, which video processing needs. Try a recent Chrome, Edge, Safari or Firefox.';
    case 'no-tracks':
      return e.message || "This file doesn't contain a video track.";
    case 'out-of-memory':
      return 'Your browser ran out of memory. Close other tabs and try again, or try a shorter clip.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't convert this file. It may be damaged, or use a codec we can't read.";
    default:
      return e.message || 'Something went wrong while processing the video.';
  }
}
