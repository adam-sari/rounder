import type { Capabilities, MediaInfo, Pcm, Segment } from '@/engines/media/types';
import { invertSegments, normalizeSegments } from '@/engines/media/math';
import { toMediaError } from '@/engines/media/types';

/*
 * Pure editing logic shared by the audio cutter and the ringtone maker: which formats this
 * browser can write, which parts to keep, and how to stitch decoded pieces back together.
 */

export type OutFormat = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';

export const formatLabel: Record<OutFormat, string> = { mp3: 'MP3', m4a: 'M4A', wav: 'WAV', ogg: 'OGG', flac: 'FLAC' };

/** bitrate choices (bits/s) per lossy format, middle one is the default */
export const bitrates: Partial<Record<OutFormat, number[]>> = {
  mp3: [128_000, 192_000, 320_000],
  m4a: [128_000, 160_000, 192_000],
  ogg: [96_000, 128_000, 192_000],
};

export const isLossy = (f: OutFormat) => !!bitrates[f];
export const defaultBitrate = (f: OutFormat) => bitrates[f]?.[1];

/** the output format that matches the input, so it can be cut without re-encoding */
export function sameFormat(info: Pick<MediaInfo, 'container' | 'audio'>): OutFormat | null {
  const codec = info.audio?.codec;
  switch (info.container) {
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
      return info.container;
    case 'mp4':
    case 'mov':
    case 'aac':
      return codec === 'aac' ? 'm4a' : null;
    default:
      return null;
  }
}

export interface FormatSupport {
  ok: boolean;
  /** why it's disabled, or a heads-up when it works but costs a download */
  note?: string;
  /** needs the one-time ffmpeg.wasm download */
  download?: boolean;
}

/** what this browser can write, from capabilities(); null caps = still checking */
export function formatSupport(f: OutFormat, caps: Pick<Capabilities, 'audio'> | null, downloadMb: number): FormatSupport {
  const enc = caps?.audio.encode ?? [];
  if (f === 'mp3' || f === 'wav') return { ok: true };
  if (!caps) return { ok: false, note: 'Checking your browser…' };
  if (f === 'm4a') return enc.includes('aac') ? { ok: true } : { ok: false, note: "This browser can't encode AAC audio." };
  if (f === 'ogg') return enc.includes('opus') || enc.includes('vorbis') ? { ok: true } : { ok: false, note: "This browser can't encode Opus or Vorbis audio." };
  return enc.includes('flac') ? { ok: true } : { ok: true, download: true, note: `FLAC uses a one-time ${downloadMb} MB encoder download.` };
}

/** the parts of the source that end up in the output, in order */
export function keptSegments(mode: 'trim' | 'cut', start: number, end: number, cuts: Segment[], duration: number): Segment[] {
  return mode === 'trim' ? normalizeSegments([{ start, end }], duration) : invertSegments(cuts, duration);
}

/** fades can't overlap: scale both down to fit the output if they would */
export function fitFades(inSec: number, outSec: number, total: number): { inSec: number; outSec: number } {
  const a = Math.max(0, inSec);
  const b = Math.max(0, outSec);
  if (a + b <= total || a + b === 0) return { inSec: a, outSec: b };
  const k = Math.max(0, total) / (a + b);
  return { inSec: a * k, outSec: b * k };
}

/**
 * Concatenates decoded pieces with a few milliseconds of linear crossfade at each join, so
 * cuts never click. Each join shortens the output by the overlap.
 */
export function joinPieces(pieces: Pcm[], crossfadeSec = 0.008): Pcm {
  // nothing to join: don't copy what may be a very long buffer
  if (pieces.length === 1) return pieces[0];
  const sampleRate = pieces[0]?.sampleRate ?? 48000;
  const chs = Math.max(1, ...pieces.map((p) => p.channels.length));
  const lens = pieces.map((p) => p.channels[0]?.length ?? 0);
  const overlaps = lens.slice(1).map((len, i) => Math.min(Math.round(crossfadeSec * sampleRate), len, lens[i]));
  const total = lens.reduce((s, n) => s + n, 0) - overlaps.reduce((s, n) => s + n, 0);
  const out = Array.from({ length: chs }, () => new Float32Array(total));
  let at = 0;
  pieces.forEach((p, i) => {
    const ov = i > 0 ? overlaps[i - 1] : 0;
    const from = at - ov;
    for (let c = 0; c < chs; c++) {
      // mono pieces fill every channel
      const src = p.channels[c] ?? p.channels[0];
      const dst = out[c];
      for (let k = 0; k < ov; k++) {
        const w = (k + 1) / (ov + 1);
        dst[from + k] = dst[from + k] * (1 - w) + src[k] * w;
      }
      dst.set(src.subarray(ov), from + ov);
    }
    at = from + lens[i];
  });
  return { sampleRate, channels: out };
}

/** folds surround down to stereo (ITU-style for 5.1), since not every encoder takes 6 channels */
export function toStereo(channels: Float32Array[]): Float32Array[] {
  if (channels.length <= 2) return channels;
  const n = channels[0].length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  if (channels.length === 6) {
    // L R C LFE Ls Rs
    const [l, r, c, , ls, rs] = channels;
    const k = Math.SQRT1_2;
    for (let i = 0; i < n; i++) {
      L[i] = (l[i] + k * c[i] + k * ls[i]) / (1 + 2 * k);
      R[i] = (r[i] + k * c[i] + k * rs[i]) / (1 + 2 * k);
    }
    return [L, R];
  }
  const half = [Math.ceil(channels.length / 2), Math.floor(channels.length / 2)];
  channels.forEach((ch, idx) => {
    const dst = idx % 2 ? R : L;
    const g = 1 / half[idx % 2];
    for (let i = 0; i < n; i++) dst[i] += ch[i] * g;
  });
  return [L, R];
}

/** rough output size for the "about X MB" hint */
export function estimateBytes(f: OutFormat, seconds: number, bitrate: number | undefined, sampleRate = 44100, channels = 2): number {
  if (f === 'wav') return Math.round(seconds * sampleRate * Math.min(2, channels) * 2) + 44;
  if (f === 'flac') return Math.round(seconds * sampleRate * Math.min(2, channels) * 2 * 0.6);
  return Math.round(((bitrate ?? 192_000) * seconds) / 8);
}

/** seconds left, once there's enough progress to guess */
export function etaSeconds(progress: number, elapsedSec: number): number | null {
  if (progress < 0.03 || elapsedSec < 1 || progress >= 1) return null;
  return (elapsedSec / progress) * (1 - progress);
}

/** a friendly line for any engine error; empty for a cancel */
export function errorText(e: unknown): string {
  // main-thread failures (e.g. a RangeError allocating the joined audio) get the same codes
  const { code, message } = toMediaError(e);
  switch (code) {
    case 'aborted':
      return '';
    case 'no-tracks':
      return "This file doesn't have an audio track.";
    case 'unsupported-input':
      return "Your browser can't read this file's format. Try converting it to MP3 or WAV first.";
    case 'unsupported-codec':
      return "This browser can't write that format. Try MP3 or WAV instead.";
    case 'no-webcodecs':
      return 'This browser is missing audio features this tool needs. Try a recent Chrome, Edge, Safari or Firefox.';
    case 'out-of-memory':
      return 'Your device ran out of memory. Try a shorter selection, or a recent desktop browser.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't process this file. It may be damaged or use a very unusual format.";
    default:
      return message ? `Something went wrong: ${message}` : 'Something went wrong while processing the file.';
  }
}
