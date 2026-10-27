import { decodeAudio, fade, transcode, writeWav, type Pcm, type StatusControl } from '@/engines/media';
import { toStereo, type OutFormat } from '@/tools/lib/audio-cutter/edit';
import { stretchInWorker, type Stretched } from './client';
import type { StretchSettings } from './stretch';

export const PREVIEW_SEC = 10;

export interface ExportOptions {
  settings: StretchSettings;
  format: OutFormat;
  bitrate?: number;
  /** status line while the vocoder runs, e.g. "Changing pitch…" */
  label: string;
}

export interface Exported {
  blob: Blob;
  durationSec: number;
  safetyDb: number;
}

/** decode → stretch in a worker → WAV, or encode the WAV to the chosen format (streamed) */
export async function renderStretch(file: Blob, o: ExportOptions, ctl: StatusControl = {}): Promise<Exported> {
  const { signal, onStatus } = ctl;
  const span = (from: number, to: number) => (p: number) => ctl.onProgress?.(from + (to - from) * p);
  const encodeAt = o.format === 'wav' ? 1 : 0.85;

  onStatus?.('Decoding…');
  const pcm = await decodeAudio(file, {}, { signal, onStatus, onProgress: span(0, 0.15) });
  pcm.channels = toStereo(pcm.channels);

  onStatus?.(o.label);
  const out = await stretchInWorker(pcm, o.settings, { signal, onProgress: span(0.15, encodeAt) });
  if (o.format === 'wav') return { blob: out.wav, durationSec: out.durationSec, safetyDb: out.safetyDb };

  onStatus?.('Encoding…');
  const enc = await transcode(out.wav, { container: o.format, video: false, audio: { bitrate: o.bitrate } }, { signal, onProgress: span(encodeAt, 1) });
  return { blob: enc.blob, durationSec: out.durationSec, safetyDb: out.safetyDb };
}

/** a short stretch of the source, stereo, with 10 ms fades so the preview doesn't click */
export async function decodePreview(file: Blob, start: number, ctl: StatusControl = {}): Promise<Pcm> {
  const pcm = await decodeAudio(file, { start, end: start + PREVIEW_SEC }, ctl);
  pcm.channels = toStereo(pcm.channels);
  fade(pcm.channels, pcm.sampleRate, { inSec: 0.01, outSec: 0.01 });
  return pcm;
}

export const pcmToWav = (pcm: Pcm) => new Blob([writeWav(pcm)], { type: 'audio/wav' });

/** processes a copy, so the decoded slice can be reused for the next setting */
export const renderPreview = (slice: Pcm, settings: StretchSettings, ctl: StatusControl = {}): Promise<Stretched> =>
  stretchInWorker({ sampleRate: slice.sampleRate, channels: slice.channels.map((c) => c.slice()) }, settings, ctl);
