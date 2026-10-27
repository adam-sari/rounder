import { decodeAudio, encodeAudio, fade, transcode, type Segment, type StatusControl } from '@/engines/media';
import { fitFades, joinPieces, toStereo, type OutFormat } from './edit';

export interface RenderOptions {
  /** parts of the source to keep, in order */
  segments: Segment[];
  format: OutFormat;
  /** for lossy formats; ignored when copying */
  bitrate?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** the output format matches the source, so a plain trim can copy the audio untouched */
  sameAsSource?: boolean;
}

export interface RenderResult {
  blob: Blob;
  durationSec: number;
  /** the audio was copied, not re-encoded */
  copied: boolean;
}

/**
 * One range and no fades goes through transcode(), which streams (any length) and copies the
 * audio when the format is unchanged. Anything else is decoded piece by piece, joined, faded
 * and encoded, which keeps the whole output in memory.
 */
export async function renderAudio(file: Blob, o: RenderOptions, ctl: StatusControl = {}): Promise<RenderResult> {
  const total = o.segments.reduce((s, x) => s + x.end - x.start, 0);
  const fades = fitFades(o.fadeIn ?? 0, o.fadeOut ?? 0, total);

  if (o.segments.length === 1 && !fades.inSec && !fades.outSec) {
    const [{ start, end }] = o.segments;
    const copy = !!o.sameAsSource;
    const out = await transcode(file, { container: o.format, trim: { start, end }, video: false, audio: copy ? undefined : { bitrate: o.bitrate } }, ctl);
    return { blob: out.blob, durationSec: out.durationSec, copied: copy };
  }

  // decoding takes most of the time; encoding the joined result the rest
  const DECODE = 0.7;
  const pieces = [];
  let done = 0;
  ctl.onStatus?.('Decoding…');
  for (const s of o.segments) {
    const len = s.end - s.start;
    const span = (p: number) => ctl.onProgress?.(((done + p * len) / total) * DECODE);
    pieces.push(await decodeAudio(file, { start: s.start, end: s.end }, { signal: ctl.signal, onStatus: ctl.onStatus, onProgress: span }));
    done += len;
  }
  const pcm = joinPieces(pieces);
  pieces.length = 0;
  pcm.channels = toStereo(pcm.channels);
  fade(pcm.channels, pcm.sampleRate, fades);

  ctl.onStatus?.('Encoding…');
  const blob = await encodeAudio(pcm, { format: o.format, bitrate: o.bitrate }, { signal: ctl.signal, onProgress: (p) => ctl.onProgress?.(DECODE + p * (1 - DECODE)) });
  return { blob, durationSec: (pcm.channels[0]?.length ?? 0) / pcm.sampleRate, copied: false };
}
