import type { AudioCodec } from '@/engines/media/types';

export type JoinFormat = 'mp3' | 'm4a' | 'ogg' | 'wav' | 'flac';

export interface FormatChoice {
  label: string;
  codec: AudioCodec;
  /** offered bitrates (bits/s), empty for lossless */
  bitrates: number[];
  defaultBitrate: number;
  note: string;
}

// AAC rates are the ones every native encoder takes (see snapAudioBitrate)
export const joinFormats: Record<JoinFormat, FormatChoice> = {
  mp3: { label: 'MP3', codec: 'mp3', bitrates: [128_000, 192_000, 256_000, 320_000], defaultBitrate: 192_000, note: 'plays everywhere' },
  m4a: { label: 'M4A', codec: 'aac', bitrates: [96_000, 128_000, 160_000, 192_000], defaultBitrate: 160_000, note: 'AAC, great for Apple devices' },
  ogg: { label: 'OGG', codec: 'opus', bitrates: [64_000, 96_000, 128_000, 192_000], defaultBitrate: 128_000, note: 'Opus, smallest at the same quality' },
  wav: { label: 'WAV', codec: 'pcm-s16', bitrates: [], defaultBitrate: 0, note: 'uncompressed 16-bit, for editing' },
  flac: { label: 'FLAC', codec: 'flac', bitrates: [], defaultBitrate: 0, note: 'lossless and about half the size of WAV' },
};

export const joinFormatList = Object.keys(joinFormats) as JoinFormat[];

/** rough output size; FLAC is a guess, since it depends on how compressible the audio is */
export function estimateJoinBytes(format: JoinFormat, seconds: number, bitrate: number, sampleRate: number, channels: number): number {
  if (format === 'wav') return Math.round(seconds * sampleRate * channels * 2 + 44);
  if (format === 'flac') return Math.round(seconds * sampleRate * channels * 2 * 0.55);
  return Math.round((bitrate * seconds) / 8);
}
