import { audioCodecLabel, MediaError, toMediaError, videoCodecLabel, type AudioCodec, type MediaErrorCode, type MediaInfo, type VideoCodec } from '@/engines/media/types';

const MINUS = '−';

/** 75 → "1:15", 3725 → "1:02:05" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 6 → "+6.0", -3.25 → "−3.3", with a typographic minus */
export function signed(x: number, digits = 1): string {
  const v = x.toFixed(digits);
  if (Number(v) === 0) return (0).toFixed(digits);
  return x > 0 ? `+${v}` : `${MINUS}${v.slice(1)}`;
}

/** a level in dB without a plus sign: "−14.2", or "−∞" for silence */
export function level(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return `${MINUS}∞`;
  const v = x.toFixed(digits);
  return v.startsWith('-') ? `${MINUS}${v.slice(1)}` : v;
}

/** elapsed time and, once there's enough to go on, a remaining-time estimate */
export function timing(elapsedMs: number, progress: number): { elapsed: string; left: string | null } {
  const elapsed = clock(elapsedMs / 1000);
  if (progress < 0.03 || elapsedMs < 1500 || progress >= 1) return { elapsed, left: null };
  return { elapsed, left: clock(((elapsedMs / progress) * (1 - progress)) / 1000) };
}

const channelName = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} ch`);

/** "3:12 · 1920×1080 H.264 · AAC 48 kHz stereo"; empty for files the browser can't read yet */
export function describeMedia(info: MediaInfo): string {
  const parts = info.durationSec > 0 ? [clock(info.durationSec)] : [];
  const v = info.video;
  if (v) parts.push(`${v.displayWidth}×${v.displayHeight}${v.codec ? ` ${videoCodecLabel[v.codec as VideoCodec] ?? v.codec.toUpperCase()}` : ''}`);
  const a = info.audio;
  if (a) {
    const codec = a.codec ? (audioCodecLabel[a.codec as AudioCodec] ?? a.codec.toUpperCase()) : 'audio';
    parts.push(`${codec} ${+(a.sampleRate / 1000).toFixed(1)} kHz ${channelName(a.channels)}`);
  }
  return parts.join(' · ');
}

const messages: Partial<Record<MediaErrorCode, string>> = {
  'unsupported-input': "This file's format can't be read in this browser. If it plays elsewhere, try converting it to MP3 or MP4 first.",
  'unsupported-codec': "This browser can't encode that format. Pick another output format and try again.",
  'no-webcodecs': 'This browser is missing a feature this tool needs. A recent Chrome, Edge, Safari or Firefox will work.',
  'no-tracks': 'This file has no audio track to work on.',
  'out-of-memory': 'Your device ran out of memory. Close other tabs and try again, or try a shorter file.',
  'ffmpeg-failed': "The fallback decoder couldn't read this file. It may be damaged, or in a format we can't open.",
};

/** a friendly sentence for anything a media job throws; null for a cancel */
export function errorMessage(e: unknown): string | null {
  const err = e instanceof MediaError ? e : toMediaError(e);
  if (err.code === 'aborted') return null;
  return messages[err.code] ?? (err.message || 'Something went wrong while processing this file.');
}
