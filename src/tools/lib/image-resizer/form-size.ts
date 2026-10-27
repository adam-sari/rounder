// Sizes for upload forms: a KB range (often 20–50 KB), dimensions in px, cm, mm or inches, and the DPI stored in the JPEG.
import { fitFileSize, type FitResult } from './fit-file-size';

export type Unit = 'px' | 'cm' | 'mm' | 'in';

const perInch: Record<Unit, number> = { px: 0, cm: 2.54, mm: 25.4, in: 1 };

/** a length in pixels; px stays as it is, physical units go through `dpi` */
export const toPixels = (value: number, unit: Unit, dpi: number) => (unit === 'px' ? value : (value / perInch[unit]) * dpi);

/** a pixel length back in `unit`, to 2 decimals (for switching units without retyping) */
export const fromPixels = (px: number, unit: Unit, dpi: number) => (unit === 'px' ? Math.round(px) : Math.round((px / dpi) * perInch[unit] * 100) / 100);

export interface RangeResult<T> extends FitResult<T> {
  /** bytes still missing to reach the minimum; the caller pads JPEGs by this much */
  short: number;
}

/**
 * The best quality between `min` and `max` bytes (either may be left out). Over the maximum it behaves like
 * fitFileSize; with `fixedSize` the dimensions never change, so only quality moves (down to 10). Under the minimum it
 * raises the quality, then enlarges the picture (unless the size is fixed), and reports what is still missing as `short`.
 */
export async function fitRange<T extends { size: number }>(
  { min = 0, max }: { min?: number; max?: number },
  encode: (quality: number, scale: number) => Promise<T>,
  { fixedSize = false, maxScale = 4 }: { fixedSize?: boolean; maxScale?: number } = {},
): Promise<RangeResult<T>> {
  let best: FitResult<T>;
  if (max !== undefined) best = await fitFileSize(max, encode, fixedSize ? { minScale: 1, minQuality: 10 } : {});
  else best = { out: await encode(92, 1), quality: 92, scale: 1, fits: true };
  const inRange = (r: FitResult<T>) => r.out.size >= min && (max === undefined || r.out.size <= max);
  if (!best.fits || best.out.size >= min) return { ...best, short: 0 };

  const attempt = async (quality: number, scale: number) => {
    const out = await encode(quality, scale);
    return { out, quality, scale, fits: max === undefined || out.size <= max };
  };
  // more quality at the same size: 100 if that stays under the maximum, otherwise a binary search below it
  const top = await attempt(100, best.scale);
  if (top.fits) best = top;
  else {
    let [lo, hi] = [best.quality, 100];
    for (let step = 0; step < 4 && hi - lo > 1 && !inRange(best); step++) {
      const q = Math.round((lo + hi) / 2);
      const r = await attempt(q, best.scale);
      if (r.fits) [best, lo] = [r, q];
      else hi = q;
    }
  }
  if (inRange(best)) return { ...best, short: 0 };

  // then more pixels, roughly in proportion to the bytes still missing
  for (let step = 0; !fixedSize && step < 4 && best.out.size < min && best.scale < maxScale; step++) {
    const scale = Math.min(maxScale, best.scale * Math.max(1.1, Math.sqrt(min / best.out.size) * 1.08));
    const r = await attempt(92, scale);
    if (!r.fits) break;
    best = r;
  }
  return { ...best, short: Math.max(0, min - best.out.size) };
}

const SOI = 2;

/** where the JPEG's leading APPn headers (JFIF, EXIF…) end; JFIF has to stay right after the start marker */
function afterHeaders(bytes: Uint8Array) {
  let at = SOI;
  while (at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1] >= 0xe0 && bytes[at + 1] <= 0xef) at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  return Math.min(at, bytes.length);
}

/**
 * Adds `extra` bytes of blank JPEG comment (COM) segments after the JPEG's headers. Viewers skip comments, so the
 * picture is unchanged; it only lets a small file meet a form's minimum size. The headers stay first, so the stored
 * DPI and upload checks that look for "FF D8 FF E0" still work.
 */
export function padJpeg(bytes: Uint8Array, extra: number): Uint8Array {
  if (extra <= 0) return bytes;
  const head = afterHeaders(bytes);
  const segments: Uint8Array[] = [];
  for (let left = extra; left > 0; ) {
    const payload = Math.min(65533, Math.max(0, left - 4));
    const seg = new Uint8Array(4 + payload).fill(0x20);
    seg.set([0xff, 0xfe, (payload + 2) >> 8, (payload + 2) & 255]);
    segments.push(seg);
    left -= seg.length;
  }
  const out = new Uint8Array(bytes.length + segments.reduce((s, x) => s + x.length, 0));
  out.set(bytes.subarray(0, head));
  let at = head;
  for (const seg of segments) {
    out.set(seg, at);
    at += seg.length;
  }
  out.set(bytes.subarray(head), at);
  return out;
}

/** Stores `dpi` in the JPEG's JFIF header (adding one when missing), so print sizes in cm or inches come out right */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0';
  if (isJfif) {
    const out = bytes.slice();
    out.set([1, d >> 8, d & 255, d >> 8, d & 255], 13);
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, SOI));
  out.set(app0, SOI);
  out.set(bytes.subarray(SOI), SOI + app0.length);
  return out;
}

/** the DPI stored in a JPEG's JFIF header, or null (also for aspect-ratio-only headers) */
export function jpegDpi(bytes: Uint8Array): number | null {
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0';
  if (!isJfif || bytes[13] === 0) return null;
  const x = (bytes[14] << 8) | bytes[15];
  return bytes[13] === 2 ? Math.round(x * 2.54) : x;
}
