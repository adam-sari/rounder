import { encoderSampleRate } from '@/engines/media/dsp';
import { snapAudioBitrate } from '@/engines/media/math';
import { audioCodecLabel, type AudioCodec, type Capabilities, type MediaInfo, type TranscodeOptions } from '@/engines/media/types';

export type OutFormat = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';
/** source formats that get their own variant page */
export type SourceFormat = 'mp3' | 'wav' | 'm4a' | 'flac' | 'ogg';
export type WavDepth = 'pcm-s16' | 'pcm-s24';

export const outFormats: OutFormat[] = ['mp3', 'm4a', 'wav', 'ogg', 'flac'];

export const formatInfo: Record<OutFormat, { label: string; blurb: string }> = {
  mp3: { label: 'MP3', blurb: 'plays on every phone, car stereo and app' },
  m4a: { label: 'M4A', blurb: 'AAC audio, the Apple default; a little smaller than MP3 at the same quality' },
  wav: { label: 'WAV', blurb: 'uncompressed, for editors and DAWs; about 10 MB a minute' },
  ogg: { label: 'OGG', blurb: 'open format used by games, Android and the web' },
  flac: { label: 'FLAC', blurb: 'lossless and smaller than WAV, for archives and hi-fi players' },
};

export const sourceInfo: Record<SourceFormat, { label: string; accept: string; noun: string }> = {
  mp3: { label: 'MP3', accept: '.mp3,audio/mpeg', noun: 'MP3 files' },
  wav: { label: 'WAV', accept: '.wav,audio/wav,audio/x-wav,audio/wave', noun: 'WAV files' },
  m4a: { label: 'M4A', accept: '.m4a,.aac,audio/mp4,audio/x-m4a,audio/aac', noun: 'M4A files' },
  flac: { label: 'FLAC', accept: '.flac,audio/flac,audio/x-flac', noun: 'FLAC files' },
  ogg: { label: 'OGG', accept: '.ogg,.oga,.opus,audio/ogg,audio/opus', noun: 'OGG files' },
};

// files often arrive with an empty or odd mime type, hence the extensions; videos give up their soundtrack
const ANY_AUDIO = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.wma,.aif,.aiff,.amr,.mka,.weba,.webm,.mp4,.mov,.mkv';

export function acceptFor(from?: SourceFormat) {
  return from ? `${sourceInfo[from].accept},${ANY_AUDIO}` : ANY_AUDIO;
}

export function dropTitle(from?: SourceFormat) {
  return from ? `Drop ${sourceInfo[from].noun} here` : 'Drop audio files here';
}

export interface FormatPlan {
  available: boolean;
  /** the codec this browser will write (WAV depends on the chosen bit depth) */
  codec: AudioCodec;
  /** why the format can't be picked */
  reason?: string;
  /** encoding goes through the ffmpeg.wasm download */
  viaFallback: boolean;
}

/** What each output format turns into in this browser. `caps` is null while it loads. */
export function planFormat(f: OutFormat, caps: Capabilities | null, depth: WavDepth = 'pcm-s16'): FormatPlan {
  const enc = caps?.audio.encode;
  switch (f) {
    case 'mp3':
      return { available: true, codec: 'mp3', viaFallback: false };
    case 'm4a': {
      const available = caps?.containers.m4a ?? true;
      return { available, codec: 'aac', viaFallback: false, reason: available ? undefined : "This browser can't encode AAC audio." };
    }
    case 'wav':
      return { available: true, codec: depth, viaFallback: false };
    case 'flac':
      // no browser ships a WebCodecs FLAC encoder yet, so this normally means the ffmpeg download
      return { available: true, codec: 'flac', viaFallback: !!enc && !enc.includes('flac') };
    case 'ogg': {
      const codec: AudioCodec = !enc || enc.includes('opus') ? 'opus' : 'vorbis';
      const available = !enc || enc.includes(codec);
      return { available, codec, viaFallback: false, reason: available ? undefined : "This browser can't encode Ogg audio. Try MP3 or M4A." };
    }
  }
}

const k = (n: number) => n * 1000;

/** bitrate presets in bits/s, for the lossy codecs */
export function bitrateChoices(codec: AudioCodec): number[] {
  switch (codec) {
    case 'mp3':
      return [128, 192, 256, 320].map(k);
    case 'aac':
      // native AAC encoders (Windows in particular) only take these
      return [96, 128, 160, 192].map(k);
    case 'opus':
      return [64, 96, 128, 192].map(k);
    case 'vorbis':
      return [128, 160, 192, 256].map(k);
    default:
      return [];
  }
}

const defaults: Partial<Record<AudioCodec, number>> = { mp3: k(192), aac: k(160), opus: k(128), vorbis: k(192) };

export const defaultBitrate = (codec: AudioCodec) => defaults[codec] ?? 0;

/** a plain-words hint for a bitrate choice */
export function bitrateHint(codec: AudioCodec, bps: number): string {
  // Opus and AAC sound as good as MP3 at lower rates, so compare in MP3 terms
  const mp3ish = codec === 'opus' ? bps * 2 : codec === 'aac' ? bps * 1.25 : bps;
  if (mp3ish < k(160)) return 'small files, fine for speech and podcasts';
  if (mp3ish < k(224)) return 'good for music, a common choice';
  if (mp3ish < k(288)) return 'very good, hard to tell from the original';
  return 'highest quality, largest files';
}

/** sample-rate presets (0 = keep the original); Opus always runs at 48 kHz */
export function sampleRateChoices(codec: AudioCodec): number[] {
  if (codec === 'opus') return [];
  if (codec === 'aac' || codec === 'vorbis') return [0, 48000, 44100];
  return [0, 48000, 44100, 22050];
}

export const formatRate = (hz: number) => `${+(hz / 1000).toFixed(2)} kHz`;

export const channelsLabel = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} channels`);

export interface Settings {
  format: OutFormat;
  /** bits/s; ignored by lossless formats */
  bitrate: number;
  depth: WavDepth;
  /** 0 keeps the source rate */
  sampleRate: number;
  /** 0 keeps the source layout (anything above stereo is mixed down) */
  channels: 0 | 1 | 2;
  keepMetadata: boolean;
}

export const isLossless = (codec: AudioCodec) => codec === 'flac' || codec.startsWith('pcm');

export function transcodeOptions(s: Settings, codec: AudioCodec): TranscodeOptions {
  return {
    container: s.format,
    keepMetadata: s.keepMetadata,
    audio: {
      codec,
      bitrate: isLossless(codec) ? undefined : s.bitrate,
      sampleRate: s.sampleRate || undefined,
      channels: s.channels || undefined,
    },
  };
}

/** the sample rate and channel count the output will really have */
export function outputShape(info: MediaInfo, s: Settings, codec: AudioCodec) {
  const sourceRate = info.audio?.sampleRate || 48000;
  return {
    sampleRate: encoderSampleRate(codec, s.sampleRate || sourceRate),
    channels: s.channels || Math.min(2, info.audio?.channels || 2),
  };
}

/** rough output size in bytes, or null when it can't be told in advance (FLAC) */
export function estimateBytes(info: MediaInfo, s: Settings, codec: AudioCodec): number | null {
  const sec = info.durationSec;
  if (!(sec > 0) || codec === 'flac') return null;
  const { sampleRate, channels } = outputShape(info, s, codec);
  if (codec === 'pcm-s16' || codec === 'pcm-s24') return Math.round(sec * sampleRate * channels * (codec === 'pcm-s16' ? 2 : 3)) + 44;
  const bitrate = snapAudioBitrate(codec, s.bitrate) ?? s.bitrate;
  return Math.round(((bitrate * sec) / 8) * 1.01);
}

const codecName = (codec: string | null) => (codec ? (audioCodecLabel[codec as AudioCodec] ?? codec.toUpperCase()) : 'unknown codec');

/** "MP3 · 44.1 kHz · stereo · 192 kbps" */
export function describeAudio(info: MediaInfo): string {
  const a = info.audio;
  if (!a) return 'no audio track';
  const parts = [codecName(a.codec)];
  if (a.sampleRate) parts.push(formatRate(a.sampleRate));
  if (a.channels) parts.push(channelsLabel(a.channels));
  if (a.bitrate && a.bitrate > 0) parts.push(`${Math.round(a.bitrate / 1000)} kbps`);
  return parts.join(' · ');
}

/** overall 0–1 progress of a batch, each file weighted by its duration */
export function batchProgress(parts: { weight: number; progress: number }[]): number {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (!total) return 0;
  return parts.reduce((s, p) => s + p.weight * Math.min(1, Math.max(0, p.progress)), 0) / total;
}

/** seconds left, or null until there's enough progress to guess from */
export function etaSeconds(elapsedSec: number, progress: number): number | null {
  if (progress < 0.03 || elapsedSec < 1) return null;
  return Math.max(0, (elapsedSec * (1 - progress)) / progress);
}

/** 4 → "4s", 75 → "1m 15s" */
export function shortDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** a friendlier message per engine error code */
export function friendlyError(code: string | undefined, message: string): string {
  switch (code) {
    case 'unsupported-input':
      return "This file isn't an audio or video format we can read.";
    case 'no-tracks':
      return 'This file has no audio track to convert.';
    case 'unsupported-codec':
      return "This browser can't encode that format. Try MP3 or WAV.";
    case 'out-of-memory':
      return 'Ran out of memory. Try this file on its own, or close some other tabs.';
    case 'ffmpeg-failed':
      return "The extra decoder couldn't convert this file. It may be damaged or protected.";
    case 'aborted':
      return 'Cancelled.';
    default:
      return message || 'Something went wrong with this file.';
  }
}
