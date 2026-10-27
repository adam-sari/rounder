import { snapAudioBitrate } from '@/engines/media/math';
import { containers, type AudioCodec, type Capabilities, type Container, type MediaInfo } from '@/engines/media/types';
import { keepContainer } from '../mute-video/media';

/** 'video' puts the cleaned sound back into the video; the rest are audio files */
export type OutFormat = 'video' | 'wav' | 'mp3' | 'm4a';

export const AUDIO_FORMATS: { id: Exclude<OutFormat, 'video'>; label: string; codec: AudioCodec; blurb: string }[] = [
  { id: 'wav', label: 'WAV', codec: 'pcm-s16', blurb: 'lossless, for editing further' },
  { id: 'mp3', label: 'MP3', codec: 'mp3', blurb: 'plays everywhere' },
  { id: 'm4a', label: 'M4A', codec: 'aac', blurb: 'AAC, smaller than MP3 at the same quality' },
];

/** speech needs less than music; mono needs less than stereo */
export const audioBitrate = (channels: number) => (channels === 1 ? 128_000 : 192_000);

/** the bitrate the encoder will really use, for labels */
export function bitrateLabel(format: OutFormat, codec: AudioCodec | undefined, channels: number): string {
  if (format === 'wav' || !codec) return '';
  const bps = snapAudioBitrate(codec, audioBitrate(channels)) ?? audioBitrate(channels);
  return `${Math.round(bps / 1000)} kbps`;
}

/** why a format can't be made in this browser, or '' when it can */
export function unavailableReason(format: OutFormat, info: MediaInfo | null, caps: Capabilities | null): string {
  if (format === 'video') return info?.video ? '' : 'Only for video files';
  const f = AUDIO_FORMATS.find((a) => a.id === format)!;
  if (!caps || format === 'wav' || caps.audio.encode.includes(f.codec)) return '';
  return `Your browser can't create ${f.label} files`;
}

/** where the cleaned soundtrack goes back in: the source's container when we can write it, with a codec it can hold */
export function videoTarget(info: MediaInfo, converted: boolean, caps: Capabilities | null): { container: Container; codec?: AudioCodec } {
  let container = converted ? 'mp4' : keepContainer(info, caps?.containers);
  const codecFor = (c: Container) => containers[c].audio.find((a) => !caps || caps.audio.encode.includes(a));
  if (!codecFor(container)) container = 'mp4';
  return { container, codec: codecFor(container) };
}

/** videos stay videos; audio keeps its kind where it can (WAV → WAV, M4A → M4A), else MP3 */
export function defaultFormat(info: MediaInfo, caps: Capabilities | null): OutFormat {
  if (info.video) return 'video';
  const want: OutFormat = info.container === 'wav' ? 'wav' : ['mp4', 'm4a', 'aac', 'mov'].includes(info.container) ? 'm4a' : 'mp3';
  return unavailableReason(want, info, caps) ? 'mp3' : want;
}
