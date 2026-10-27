/*
 * Turns one RGBA frame into GIF palette indices. Two things make the GIFs smaller than a
 * plain quantize-every-frame encoder:
 *  - pixels that barely changed since the last frame become transparent, so the previous
 *    frame shows through and LZW gets long runs of one index;
 *  - the palette is built from the changed pixels only, so its colors go where they're needed.
 * `screen` (RGB, 3 bytes per pixel) tracks what a viewer currently sees and is updated in place.
 */
import { quantize } from 'gifenc';
import type { Dither } from './plan';

export interface IndexedFrame {
  index: Uint8Array;
  palette: number[][];
  /** -1 when the frame is stored in full */
  transparentIndex: number;
}

export interface IndexOptions {
  colors: number;
  dither: Dither;
  /** squared RGB distance below which a pixel counts as unchanged */
  threshold?: number;
}

/** about ±4–5 per channel: invisible frame to frame, but kills sensor noise and compression shimmer */
export const UNCHANGED = 64;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** nearest palette entry, cached per 15-bit color so a frame costs a few thousand searches at most */
function nearestFinder(palette: number[][], skip: number) {
  const cache = new Int16Array(32768).fill(-1);
  return (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = cache[key];
    if (best >= 0) return best;
    let dist = Infinity;
    for (let k = 0; k < palette.length; k++) {
      if (k === skip) continue;
      const p = palette[k];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < dist) {
        dist = d;
        best = k;
      }
    }
    cache[key] = best;
    return best;
  };
}

const byte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function indexFrame(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, screen: Uint8Array, first: boolean, o: IndexOptions): IndexedFrame {
  const n = width * height;
  const threshold = o.threshold ?? UNCHANGED;
  const changed = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const d = first ? Infinity : (rgba[i * 4] - screen[i * 3]) ** 2 + (rgba[i * 4 + 1] - screen[i * 3 + 1]) ** 2 + (rgba[i * 4 + 2] - screen[i * 3 + 2]) ** 2;
    if (d > threshold) {
      changed[i] = 1;
      count++;
    }
  }

  // one slot goes to "transparent" whenever some pixels can be skipped
  const reserve = count < n ? 1 : 0;
  let sample: Uint8ClampedArray | Uint8Array = rgba;
  if (reserve) {
    sample = new Uint8ClampedArray(Math.max(1, count) * 4);
    for (let i = 0, j = 0; i < n; i++) if (changed[i]) sample.set(rgba.subarray(i * 4, i * 4 + 4), 4 * j++);
  }
  const palette = count ? quantize(sample, Math.max(2, Math.min(256, o.colors) - reserve)) : [[0, 0, 0]];
  const transparentIndex = reserve ? palette.length : -1;
  if (reserve) palette.push([0, 0, 0]);
  const nearest = nearestFinder(palette, transparentIndex);
  const index = new Uint8Array(n);

  // Floyd–Steinberg carries error along this row and into the next
  const diffuse = o.dither === 'diffuse';
  let cur = diffuse ? new Float32Array((width + 2) * 3) : null;
  let next = diffuse ? new Float32Array((width + 2) * 3) : null;
  // pattern dither strength grows as the palette shrinks
  const spread = o.dither === 'pattern' ? 160 / Math.cbrt(Math.max(2, palette.length)) : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!changed[i]) {
        index[i] = transparentIndex;
        continue;
      }
      let r = rgba[i * 4];
      let g = rgba[i * 4 + 1];
      let b = rgba[i * 4 + 2];
      if (spread) {
        const off = ((BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16 - 0.5) * spread;
        r += off;
        g += off;
        b += off;
      } else if (cur) {
        const e = (x + 1) * 3;
        r += cur[e];
        g += cur[e + 1];
        b += cur[e + 2];
      }
      r = byte(r);
      g = byte(g);
      b = byte(b);
      const k = nearest(r, g, b);
      const p = palette[k];
      index[i] = k;
      screen[i * 3] = p[0];
      screen[i * 3 + 1] = p[1];
      screen[i * 3 + 2] = p[2];
      if (cur && next) {
        const e = (x + 1) * 3;
        const err = [r - p[0], g - p[1], b - p[2]];
        for (let c = 0; c < 3; c++) {
          cur[e + 3 + c] += (err[c] * 7) / 16;
          next[e - 3 + c] += (err[c] * 3) / 16;
          next[e + c] += (err[c] * 5) / 16;
          next[e + 3 + c] += err[c] / 16;
        }
      }
    }
    if (cur && next) {
      [cur, next] = [next, cur];
      next.fill(0);
    }
  }
  return { index, palette, transparentIndex };
}
