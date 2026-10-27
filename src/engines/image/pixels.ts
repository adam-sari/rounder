import type { Rect } from './types';

/*
 * Crops and quarter turns done on the pixels themselves, so the worker needs no OffscreenCanvas
 * for them (Safari before 16.4 has none). Exact, and faster than a canvas round trip.
 */

export function cropPixels(img: ImageData, r: Rect): ImageData {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  const w = Math.max(1, Math.min(img.width - x, Math.round(r.width)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(r.height)));
  if (x === 0 && y === 0 && w === img.width && h === img.height) return img;
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * img.width + x) * 4;
    out.data.set(img.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/** flips first, then turns clockwise, the same order as the canvas transform it replaces */
export function orientPixels(img: ImageData, rotate: 0 | 90 | 180 | 270 = 0, flipX = false, flipY = false): ImageData {
  if (!rotate && !flipX && !flipY) return img;
  const { width: sw, height: sh } = img;
  const swap = rotate === 90 || rotate === 270;
  const w = swap ? sh : sw;
  const out = new ImageData(w, swap ? sw : sh);
  // one RGBA pixel per element
  const src = new Uint32Array(img.data.buffer, img.data.byteOffset, sw * sh);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < sh; y++) {
    const fy = flipY ? sh - 1 - y : y;
    for (let x = 0; x < sw; x++) {
      const fx = flipX ? sw - 1 - x : x;
      let at: number;
      if (rotate === 90) at = fx * w + (sh - 1 - fy);
      else if (rotate === 180) at = (sh - 1 - fy) * w + (sw - 1 - fx);
      else if (rotate === 270) at = (sw - 1 - fx) * w + fy;
      else at = fy * w + fx;
      dst[at] = src[y * sw + x];
    }
  }
  return out;
}
