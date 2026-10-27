/*
 * Ringtone rules: iPhone takes up to 40 seconds, so the selection is capped there, and an
 * .m4r is simply AAC in an MPEG-4 file with Apple's "M4A " brand.
 */

export const MAX_SEC = 40;
export const DEFAULT_SEC = 30;
export const LENGTHS = [15, 20, 30, 40];
export const M4R_MIME = 'audio/x-m4r';

export type Platform = 'iphone' | 'android';

export const guessPlatform = (ua: string): Platform => (/android/i.test(ua) ? 'android' : 'iphone');

/**
 * Keeps end − start ≤ max. Whichever handle just moved stops at the limit; when both moved
 * (the whole window was dragged, or a new file) the end follows the start.
 */
export function limitSelection(start: number, end: number, prev: { start: number; end: number }, max = MAX_SEC): { start: number; end: number } {
  if (end - start <= max + 1e-6) return { start, end };
  if (start !== prev.start && end === prev.end) return { start: end - max, end };
  return { start, end: start + max };
}

/** a window of `len` seconds starting at `start`, slid back if it would run past the end */
export function windowAt(start: number, len: number, duration: number): { start: number; end: number } {
  const l = Math.min(len, duration);
  const s = Math.max(0, Math.min(start, duration - l));
  return { start: s, end: s + l };
}

/**
 * Start time of the loudest `len`-second stretch, by summed energy of the waveform's RMS
 * buckets. Choruses are usually the loudest part of a song, so this is a good first guess.
 */
export function loudestWindow(rms: ArrayLike<number>, duration: number, len: number): number {
  const n = rms.length;
  if (!n || duration <= len) return 0;
  const w = Math.max(1, Math.min(n, Math.round((len / duration) * n)));
  let sum = 0;
  for (let i = 0; i < w; i++) sum += rms[i] * rms[i];
  let best = sum;
  let at = 0;
  for (let i = w; i < n; i++) {
    sum += rms[i] * rms[i] - rms[i - w] * rms[i - w];
    if (sum > best + 1e-12) {
      best = sum;
      at = i - w + 1;
    }
  }
  return Math.min((at / n) * duration, duration - len);
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/**
 * Rebrands an MPEG-4 audio file the way iTunes writes ringtones (major brand "M4A "). Only
 * bytes inside the existing ftyp box change, so the file layout is untouched. Returns the
 * input unchanged if it doesn't start with an ftyp box.
 */
export function brandAsM4a(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 16 || ascii(bytes, 4) !== 'ftyp') return bytes;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size > bytes.length) return bytes;
  const out = bytes.slice();
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  put(8, 'M4A ');
  // first compatible brand too, if there's room for one
  if (size >= 20) put(16, 'M4A ');
  // and keep "isom" listed so strict readers still recognise the file
  if (size >= 24 && !Array.from({ length: Math.floor((size - 16) / 4) }, (_, i) => ascii(out, 16 + i * 4)).includes('isom')) put(20, 'isom');
  return out;
}
