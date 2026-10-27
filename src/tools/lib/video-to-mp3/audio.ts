import { snapAudioBitrate } from '@/engines/media/math';
import type { AudioInfo } from '@/engines/media/types';

export type AudioFormat = 'mp3' | 'm4a' | 'ogg' | 'wav' | 'flac';
/** kbps, or 'copy' = keep the original audio bytes when the codec already fits */
export type Bitrate = number | 'copy';

export interface FormatSpec {
  id: AudioFormat;
  label: string;
  /** the codec transcode() picks first for this container */
  codec: string;
  /** kbps choices; empty for lossless formats */
  bitrates: number[];
  defaultKbps: number;
  blurb: string;
  /** source codecs that can go into this format without re-encoding */
  copyFrom: string[];
}

export const AUDIO_FORMATS: FormatSpec[] = [
  { id: 'mp3', label: 'MP3', codec: 'mp3', bitrates: [128, 192, 256, 320], defaultKbps: 192, blurb: 'plays on everything', copyFrom: ['mp3'] },
  { id: 'm4a', label: 'M4A', codec: 'aac', bitrates: [96, 128, 160, 192], defaultKbps: 160, blurb: 'AAC: smaller than MP3 at the same quality, at home on Apple devices', copyFrom: ['aac'] },
  { id: 'ogg', label: 'OGG', codec: 'opus', bitrates: [64, 96, 128, 192], defaultKbps: 128, blurb: 'Opus: the most quality per kilobyte, for apps and the web', copyFrom: ['opus', 'vorbis'] },
  { id: 'wav', label: 'WAV', codec: 'pcm-s16', bitrates: [], defaultKbps: 0, blurb: 'uncompressed: exact, editor-friendly and large', copyFrom: [] },
  { id: 'flac', label: 'FLAC', codec: 'flac', bitrates: [], defaultKbps: 0, blurb: 'lossless, typically around half the size of WAV', copyFrom: [] },
];

export const formatSpec = (id: AudioFormat) => AUDIO_FORMATS.find((f) => f.id === id)!;

export const isLossless = (id: AudioFormat) => formatSpec(id).bitrates.length === 0;

/**
 * the source audio can be copied into this format untouched (fast and lossless); surround
 * sources can't, because the engine downmixes them to stereo, which means re-encoding
 */
export const canCopy = (id: AudioFormat, sourceCodec: string | null | undefined, channels = 2) =>
  !!sourceCodec && channels <= 2 && formatSpec(id).copyFrom.includes(sourceCodec);

/** the bitrate (bits/s) to hand transcode(); undefined means copy or lossless */
export function audioBitrate(id: AudioFormat, bitrate: Bitrate, sourceCodec: string | null | undefined, channels?: number): number | undefined {
  const spec = formatSpec(id);
  if (isLossless(id) || (bitrate === 'copy' && canCopy(id, sourceCodec, channels))) return undefined;
  const kbps = bitrate === 'copy' ? spec.defaultKbps : bitrate;
  return snapAudioBitrate(spec.codec, kbps * 1000) ?? kbps * 1000;
}

/** rough output size in bytes, for "≈ 3.1 MB" hints */
export function estimateAudioBytes(id: AudioFormat, bitrate: Bitrate, durationSec: number, audio?: Pick<AudioInfo, 'codec' | 'bitrate' | 'sampleRate' | 'channels'>): number {
  const dur = Math.max(0, durationSec);
  if (isLossless(id)) {
    // 16-bit stereo at the source rate; FLAC usually lands somewhere around 50–70% of that
    const wav = dur * (audio?.sampleRate || 48_000) * Math.min(2, audio?.channels || 2) * 2 + 44;
    return Math.round(id === 'flac' ? wav * 0.6 : wav);
  }
  const bps = bitrate === 'copy' && canCopy(id, audio?.codec, audio?.channels) && audio?.bitrate ? audio.bitrate : audioBitrate(id, bitrate, null)!;
  return Math.round((bps * dur) / 8);
}

/** length of the part that will be extracted */
export const clipLength = (durationSec: number, trim?: { start: number; end: number } | null) =>
  trim ? Math.max(0, Math.min(trim.end, durationSec) - Math.max(0, trim.start)) : durationSec;
