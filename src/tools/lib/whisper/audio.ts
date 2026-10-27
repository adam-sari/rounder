import { decodeAudio, MediaError, probe, type StatusControl } from '@/engines/media';
import { guard, type Verdict } from '../device-guard';
import { SAMPLE_RATE } from './segment';

/** decoded in pieces so a long film never sits in memory as 48 kHz stereo */
const PIECE_SEC = 300;

/** Proper (filtered) resampling to Whisper's 16 kHz through the browser's own resampler */
async function to16k(samples: Float32Array, rate: number): Promise<Float32Array> {
  if (rate === SAMPLE_RATE || !samples.length) return samples;
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.round((samples.length * SAMPLE_RATE) / rate)), SAMPLE_RATE);
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Any audio or video file → 16 kHz mono samples for Whisper, plus the file's duration. Files the
 * browser can't read go through the media engine's ffmpeg.wasm fallback.
 */
export async function decodeSpeech(
  file: Blob,
  ctl: StatusControl = {},
  /** the low-end device check, once the length is known (it throws DeviceLimitError instead of 'block') */
  onCheck?: (v: Verdict) => void,
): Promise<{ audio: Float32Array; duration: number }> {
  const info = await probe(file, { signal: ctl.signal });
  if (info.readable && !info.audio) throw new MediaError('no-tracks', 'This file has no sound to transcribe.');
  const duration = info.durationSec;
  onCheck?.(guard('transcribe', { bytes: file.size, seconds: duration > 0 ? duration : undefined }));
  if (!info.audio?.canDecode || !(duration > 0)) {
    const pcm = await decodeAudio(file, { mono: true }, ctl);
    const audio = await to16k(pcm.channels[0], pcm.sampleRate);
    return { audio, duration: audio.length / SAMPLE_RATE };
  }
  const out = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  let n = 0;
  for (let t = 0; t < duration; t += PIECE_SEC) {
    const end = Math.min(duration, t + PIECE_SEC);
    const pcm = await decodeAudio(file, { start: t, end, mono: true }, { signal: ctl.signal, onProgress: (p) => ctl.onProgress?.((t + p * (end - t)) / duration) });
    const piece = await to16k(pcm.channels[0], pcm.sampleRate);
    const take = Math.min(piece.length, out.length - n);
    out.set(piece.subarray(0, take), n);
    n += take;
  }
  return { audio: out.subarray(0, n), duration };
}
