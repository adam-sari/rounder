import type { Capabilities } from '@/engines/media/types';
import type { Loudness } from './lufs';

export type TargetId = 'streaming' | 'apple' | 'podcast' | 'broadcast' | 'peak' | 'custom';

export const TARGETS: { id: TargetId; name: string; hint: string }[] = [
  { id: 'streaming', name: 'Spotify / YouTube', hint: '−14 LUFS' },
  { id: 'apple', name: 'Apple Music', hint: '−16 LUFS' },
  { id: 'podcast', name: 'Podcast', hint: '−16 LUFS stereo · −19 mono' },
  { id: 'broadcast', name: 'Broadcast · EBU R128', hint: '−23 LUFS' },
  { id: 'peak', name: 'Peak normalize', hint: 'loudest peak to the ceiling' },
  { id: 'custom', name: 'Custom', hint: 'pick your own LUFS' },
];

export interface NormalizeSettings {
  target: TargetId;
  customLufs: number;
  /** true-peak ceiling in dBTP (sample peak for peak normalizing) */
  ceilingDb: number;
  /** allow a limiter to reach the target; without it the gain stops at the ceiling */
  limit: boolean;
}

export const DEFAULT_SETTINGS: NormalizeSettings = { target: 'streaming', customLufs: -18, ceilingDb: -1, limit: true };

/** LUFS to aim for; mono podcasts sit 3 LU lower because they play from both speakers */
export function targetLufs(s: NormalizeSettings, channels: number): number | null {
  switch (s.target) {
    case 'streaming':
      return -14;
    case 'apple':
      return -16;
    case 'podcast':
      return channels === 1 ? -19 : -16;
    case 'broadcast':
      return -23;
    case 'custom':
      return s.customLufs;
    case 'peak':
      return null;
  }
}

export interface GainPlan {
  gainDb: number;
  /** null when peak normalizing */
  target: number | null;
  /** the limiter will have to hold peaks down */
  limited: boolean;
  /** LU short of the target because the limiter is off (0 when it's reached) */
  shortBy: number;
  silent: boolean;
}

export function planGain(m: Loudness, s: NormalizeSettings): GainPlan {
  const target = targetLufs(s, m.channels);
  const plan = { gainDb: 0, target, limited: false, shortBy: 0, silent: false };
  if (target === null) {
    if (!Number.isFinite(m.samplePeak)) return { ...plan, silent: true };
    return { ...plan, gainDb: s.ceilingDb - m.samplePeak };
  }
  if (!Number.isFinite(m.integrated)) return { ...plan, silent: true };
  const want = target - m.integrated;
  const headroom = s.ceilingDb - m.truePeak;
  if (want <= headroom) return { ...plan, gainDb: want };
  if (s.limit) return { ...plan, gainDb: want, limited: true };
  return { ...plan, gainDb: headroom, shortBy: want - headroom };
}

// ---------------------------------------------------------------- output formats

export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac';
/** 'video' keeps the picture and the input's container; 'same' (batch) picks per file */
export type OutputFormat = AudioFormat | 'video';

export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];

export const FORMAT_LABEL: Record<AudioFormat, string> = { mp3: 'MP3', wav: 'WAV', m4a: 'M4A', ogg: 'OGG', flac: 'FLAC' };

/** audio and video files we try to open (extensions cover files the OS gives no MIME type) */
export const ACCEPT =
  'audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.wma,.aif,.aiff,.amr,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mts';

/** the output that matches an input container, for "same as the original" */
export function sameAudioFormat(container: string): AudioFormat {
  if (container === 'mp3' || container === 'wav' || container === 'flac' || container === 'ogg') return container;
  if (container === 'webm') return 'ogg';
  if (container === 'mp4' || container === 'm4a' || container === 'aac' || container === 'mov') return 'm4a';
  return 'mp3';
}

export type VideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv';

/** videos keep their container where we can write it; anything else (AVI, WMV…) becomes MP4 */
export function videoContainer(container: string): VideoContainer {
  return container === 'mov' || container === 'webm' || container === 'mkv' ? container : 'mp4';
}

/** whether this browser can write a format, and what the user should know if it's a stretch */
export function formatSupport(f: AudioFormat, caps: Capabilities | null, decoderMb: number): { ok: boolean; note?: string } {
  if (f === 'wav') return { ok: true };
  if (f === 'flac') return caps?.audio.encode.includes('flac') ? { ok: true } : { ok: true, note: `FLAC uses a one-time ${decoderMb} MB encoder download` };
  if (!caps) return { ok: false, note: 'checking what this browser can encode…' };
  return caps.containers[f] ? { ok: true } : { ok: false, note: `This browser can't encode ${FORMAT_LABEL[f]}` };
}

/** keep a WAV's bit depth rather than quietly dropping 24-bit audio to 16 */
export function wavCodec(codec: string | null | undefined): 'pcm-s16' | 'pcm-s24' | 'pcm-f32' {
  return codec === 'pcm-s24' || codec === 'pcm-f32' ? codec : 'pcm-s16';
}
