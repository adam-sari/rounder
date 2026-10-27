import { formatBytes, formatTime } from '@/engines/media/math';
import { containers, MediaError, videoCodecLabel, type Capabilities, type MediaInfo, type VideoCodec } from '@/engines/media/types';

/** a picked video, ready to edit: `playable` is the file itself or the fallback decoder's copy */
export interface Opened {
  file: File;
  playable: Blob;
  info: MediaInfo;
}

export type VideoFormat = 'mp4' | 'webm' | 'mov';

export interface FormatOption {
  id: VideoFormat;
  label: string;
  ok: boolean;
  reason?: string;
}

/** output formats this browser can write; `caps` is null while capabilities() loads, or for good when it failed */
export function videoFormats(caps: Capabilities | null, failed = false): FormatOption[] {
  const list: FormatOption[] = (['mp4', 'webm', 'mov'] as const).map((id) => {
    const ok = caps ? caps.containers[id] : id === 'mp4';
    const codecs = containers[id].video.map((c) => videoCodecLabel[c]).join(' or ');
    return { id, label: containers[id].label, ok, reason: ok ? undefined : caps ? `This browser can't encode ${codecs} video.` : failed ? "Couldn't check whether this browser can encode it." : 'Checking what your browser can encode…' };
  });
  // no native video encoder at all: the ffmpeg fallback still writes H.264 MP4
  if (!list.some((f) => f.ok)) list[0] = { ...list[0], ok: true, reason: undefined };
  return list;
}

/** keeps the input's format when we can write it, otherwise the first that works (MP4 first) */
export function pickFormat(options: FormatOption[], wanted: string | null, container: string): VideoFormat {
  const ok = (id: string | null) => options.find((f) => f.ok && f.id === id)?.id;
  return ok(wanted) ?? ok(container) ?? options.find((f) => f.ok)?.id ?? 'mp4';
}

export function codecName(codec: string | null | undefined): string {
  if (!codec) return 'unknown codec';
  return videoCodecLabel[codec as VideoCodec] ?? codec.toUpperCase();
}

/** the facts worth showing about a picked video */
export function infoChips(info: MediaInfo): string[] {
  const v = info.video;
  const chips = [formatTime(info.durationSec, 1)];
  if (v) {
    chips.push(`${v.displayWidth} × ${v.displayHeight}`, codecName(v.codec));
    if (v.fps) chips.push(`${Math.round(v.fps * 100) / 100} fps`);
    if (v.rotation) chips.push(`rotated ${v.rotation}°`);
  }
  chips.push(info.audio ? `${codecName(info.audio.codec)} audio` : 'no audio', formatBytes(info.sizeBytes));
  return chips;
}

/** "−35%" / "+12%" for an output size against its source */
export function sizeChange(before: number, after: number): string {
  if (!(before > 0)) return '';
  const d = Math.round(((after - before) / before) * 100);
  return d === 0 ? 'same size' : d < 0 ? `−${-d}%` : `+${d}%`;
}

const clock = (ms: number) => formatTime(Math.round(ms / 1000), 0);

/** elapsed time, and a remaining-time estimate once there's enough progress to trust */
export function timing(progress: number, elapsedMs: number): { elapsed: string; left: string | null } {
  const left = progress > 0.03 && progress < 1 ? (elapsedMs * (1 - progress)) / progress : null;
  return { elapsed: clock(elapsedMs), left: left === null ? null : clock(left) };
}

/** a friendly sentence for anything an export or probe can throw */
export function errorText(e: unknown): string {
  if (!(e instanceof MediaError)) return (e as Error)?.message || 'Something went wrong while processing the video.';
  switch (e.code) {
    case 'unsupported-input':
      return "Your browser can't read this video. It may be damaged, or use a codec this browser doesn't support.";
    case 'unsupported-codec':
      return "Your browser can't encode video in this format. Try another format, like MP4.";
    case 'no-webcodecs':
      return 'This browser is missing WebCodecs, which video editing here needs. Try a recent Chrome, Edge, Safari or Firefox.';
    case 'no-tracks':
      return 'This file has no video track to work with.';
    case 'out-of-memory':
      return 'Your device ran out of memory. Try a shorter clip, a smaller output size, or closing other tabs.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't convert this file. It may be damaged or use a very unusual codec.";
    case 'aborted':
      return 'Cancelled.';
    default:
      return e.message || 'Something went wrong while processing the video.';
  }
}
