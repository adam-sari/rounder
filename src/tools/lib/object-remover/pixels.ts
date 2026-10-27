import type { Rect } from './geometry';

/** RGBA pixels (an ImageData, or anything shaped like one) */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** copy of one rect of an image, as RGBA rows */
export function cropPixels(src: Pixels, r: Rect): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * src.width + r.x) * 4;
    out.set(src.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

/** writes `src` into `dst` with its top-left corner at x, y */
export function pastePixels(dst: Pixels, src: Pixels, x: number, y: number) {
  for (let row = 0; row < src.height; row++) {
    dst.data.set(src.data.subarray(row * src.width * 4, (row + 1) * src.width * 4), ((y + row) * dst.width + x) * 4);
  }
}

/** one box-blur pass along rows (step 1) or columns (step = width), edges repeated */
function pass(src: Uint8Array, dst: Uint8Array, len: number, lines: number, step: number, stride: number, r: number) {
  const n = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    const o = line * stride;
    const at = (i: number) => src[o + Math.min(len - 1, Math.max(0, i)) * step];
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += at(i);
    for (let i = 0; i < len; i++) {
      dst[o + i * step] = Math.round(sum / n);
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

/** box blur of a one-channel mask; a zero stays zero wherever no marked pixel is within r */
export function boxBlur(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  pass(src, tmp, width, height, 1, width, r);
  pass(tmp, out, height, width, width, 1, r);
  return out;
}

/**
 * Mixes the model's fill into the original by `alpha` (0 keeps the original pixel exactly,
 * 255 takes the fill). The original alpha channel is kept.
 */
export function blend(orig: Pixels, fill: Pixels, alpha: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(orig.data);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (!a) continue;
    for (let c = i * 4; c < i * 4 + 3; c++) out[c] = orig.data[c] + ((fill.data[c] - orig.data[c]) * a) / 255;
  }
  return out;
}

/** RGBA → planar RGB (NCHW), each value multiplied by `scale` */
export function toPlanar<T extends Uint8Array | Float32Array>(rgba: Uint8ClampedArray, out: T, scale = 1): T {
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = rgba[i * 4 + c] * scale;
  return out;
}

/** planar RGB (NCHW, 0–255) → opaque RGBA, rounded and clamped */
export function fromPlanar(planar: ArrayLike<number>, n: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = planar[c * n + i];
    out[i * 4 + 3] = 255;
  }
  return out;
}
