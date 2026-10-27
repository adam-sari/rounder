import { formatTime } from '@/engines/media/math';
import { audioCodecLabel, MediaError, videoCodecLabel, type AudioCodec, type Container, type MediaInfo, type VideoCodec } from '@/engines/media/types';

/*
 * Small pure helpers shared by the mute-video and add-audio-to-video islands.
 */

const VIDEO_CONTAINERS: Container[] = ['mp4', 'mov', 'webm', 'mkv'];

/** keeps the input's container when we can write it, otherwise MP4 (plays everywhere) */
export function keepContainer(info: Pick<MediaInfo, 'container' | 'needsFallback'>, writable?: Partial<Record<Container, boolean>>): Container {
  const c = info.container as Container;
  return !info.needsFallback && VIDEO_CONTAINERS.includes(c) && writable?.[c] !== false ? c : 'mp4';
}

/**
 * Muting copies the picture and drops the sound, so ffmpeg.wasm is only needed when the
 * container is unreadable or the browser can't decode the video codec. Sound it can't decode
 * (AC-3, DTS in MKV…) doesn't matter here.
 */
export const muteNeedsDecoder = (info: MediaInfo) => !info.readable || !!(info.video && !info.video.canDecode);

/** the engine bakes a phone's rotation flag into the pixels, so those videos are re-encoded, not copied */
export const rotatedPicture = (info: MediaInfo) => !!info.video?.rotation;

const channelsLabel =(n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} ch`);

/** "00:12.40 · 1920×1080 · H.264 · AAC stereo" pieces, for file cards */
export function describeMedia(info: MediaInfo): string[] {
  const parts: string[] = [];
  if (info.durationSec > 0) parts.push(formatTime(info.durationSec, 1));
  if (info.video) {
    if (info.video.displayWidth) parts.push(`${info.video.displayWidth}×${info.video.displayHeight}`);
    if (info.video.codec) parts.push(videoCodecLabel[info.video.codec as VideoCodec] ?? info.video.codec.toUpperCase());
  }
  if (info.audio) {
    const codec = info.audio.codec ? (audioCodecLabel[info.audio.codec as AudioCodec] ?? info.audio.codec.toUpperCase()) : 'audio';
    parts.push(info.audio.channels ? `${codec} ${channelsLabel(info.audio.channels)}` : codec);
  } else if (info.readable) {
    parts.push('no sound');
  }
  return parts;
}

/** seconds left, once there's enough progress for a fair guess */
export function etaSeconds(progress: number, elapsedMs: number): number | null {
  if (!(progress >= 0.03) || progress >= 1 || elapsedMs < 1000) return null;
  return ((elapsedMs / 1000) * (1 - progress)) / progress;
}

/** 4 → "4 s", 75 → "1 min 15 s", 3720 → "1 h 2 min" */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.round((s % 3600) / 60);
  return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ''}`;
}

/** "−42%" style change between two sizes */
export function sizeChange(before: number, after: number): { text: string; smaller: boolean } {
  if (!before) return { text: '', smaller: false };
  const pct = Math.round((1 - after / before) * 100);
  if (pct === 0) return { text: 'same size', smaller: false };
  return { text: pct > 0 ? `−${pct}%` : `+${-pct}%`, smaller: pct > 0 };
}

/** user-facing text for anything a media job throws */
export function errorMessage(e: unknown): string {
  if (!(e instanceof MediaError)) return e instanceof Error && e.message ? e.message : 'Something went wrong while processing the file.';
  switch (e.code) {
    case 'aborted':
      return 'Cancelled.';
    case 'unsupported-codec':
      return "This browser can't encode the needed format. A recent Chrome or Edge usually can.";
    case 'no-webcodecs':
      return 'This browser is missing WebCodecs, which this tool needs. Try a recent Chrome, Edge, Safari or Firefox.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't convert this file. It may be damaged or use a rare codec.";
    default:
      return e.message || 'Something went wrong while processing the file.';
  }
}
