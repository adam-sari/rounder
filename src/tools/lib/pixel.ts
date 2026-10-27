import { quantize } from 'gifenc';

/** ImageData without the DOM, so the logic runs (and is tested) anywhere */
export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export type Rgb = [number, number, number];

export const pixels = (width: number, height: number): Pixels => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

/**
 * Shrinks an image by averaging every source pixel that falls in each output cell.
 * Colors are weighted by alpha so transparent pixels don't drag edges towards black.
 */
export function downsample(src: Pixels, width: number, height: number): Pixels {
  const out = pixels(width, height);
  const { data, width: W, height: H } = src;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * H) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * W) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / width));
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0, i = (sy * W + x0) * 4; sx < x1; sx++, i += 4) {
          const al = data[i + 3];
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
        }
      }
      const o = (y * width + x) * 4;
      if (a) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = a / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** grid height for a grid `width` cells wide, keeping square cells */
export const gridHeight = (srcW: number, srcH: number, width: number) => Math.max(1, Math.round((width * srcH) / srcW));

const hex = (s: string): Rgb => [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];

export type PaletteId = 'auto' | 'gray' | 'gameboy' | 'pico8' | 'nes' | 'cga' | 'original';

export const RETRO: Record<'gameboy' | 'pico8' | 'nes' | 'cga', { name: string; colors: Rgb[] }> = {
  gameboy: { name: 'Game Boy', colors: ['0f380f', '306230', '8bac0f', '9bbc0f'].map(hex) },
  pico8: {
    name: 'PICO-8',
    colors: ['000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'].map(hex),
  },
  // a hand-picked slice of the NES system palette
  nes: {
    name: 'NES',
    colors: [
      '000000', '7c7c7c', 'bcbcbc', 'f8f8f8', '0000fc', '0078f8', '3cbcfc', 'a4e4fc', '940084', 'd800cc', 'f878f8', 'a80020', 'e40058', 'f83800', 'f87858', 'f8b8f8',
      'ac7c00', 'f8b800', 'f8d878', '00b800', '58d854', 'b8f818', '005800', '008888', '00e8d8', '503000', 'fca044', 'f0d0b0',
    ].map(hex),
  },
  cga: { name: 'CGA', colors: ['000000', '55ffff', 'ff55ff', 'ffffff'].map(hex) },
};

export function grayPalette(levels: number): Rgb[] {
  return Array.from({ length: levels }, (_, i) => {
    const v = Math.round((i * 255) / (levels - 1));
    return [v, v, v];
  });
}

/** Best palette of up to `count` colors for the opaque pixels of an image */
export function autoPalette(img: Pixels, count: number): Rgb[] {
  const opaque: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] >= 128) opaque.push(img.data[i], img.data[i + 1], img.data[i + 2], 255);
  }
  if (!opaque.length) return [[0, 0, 0]];
  return quantize(new Uint8Array(opaque), count).map(([r, g, b]) => [r, g, b] as Rgb);
}

/** "redmean" distance: plain RGB distance weighted to match the eye a little better */
export function distance(a: Rgb | number[], r: number, g: number, b: number) {
  const rm = (a[0] + r) / 2;
  const dr = a[0] - r, dg = a[1] - g, db = a[2] - b;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function nearest(palette: Rgb[], r: number, g: number, b: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = distance(palette[i], r, g, b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** typical gap between neighboring palette colors: how far ordered dithering should nudge a pixel */
export function ditherSpread(palette: Rgb[]) {
  if (palette.length < 2) return 0;
  let sum = 0;
  for (const c of palette) {
    let min = Infinity;
    for (const o of palette) if (o !== c) min = Math.min(min, Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]));
    sum += min;
  }
  return sum / palette.length;
}

export type Dither = 'none' | 'bayer' | 'floyd';

/**
 * Maps every pixel to its closest palette color. Pixels under half opacity become
 * fully transparent and the rest fully opaque, so the result has crisp pixel edges.
 */
export function applyPalette(img: Pixels, palette: Rgb[], dither: Dither = 'none'): Pixels {
  const { width, height } = img;
  const out = pixels(width, height);
  const spread = dither === 'bayer' ? ditherSpread(palette) : 0;
  // floyd–steinberg works on a float copy so errors can push values past 0–255
  const buf = dither === 'floyd' ? Float32Array.from(img.data) : null;
  const cache = new Map<number, number>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (img.data[i + 3] < 128) continue;
      let r = buf ? buf[i] : img.data[i];
      let g = buf ? buf[i + 1] : img.data[i + 1];
      let b = buf ? buf[i + 2] : img.data[i + 2];
      if (spread) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
        r += t * spread;
        g += t * spread;
        b += t * spread;
      }
      let idx: number;
      if (buf) idx = nearest(palette, r, g, b);
      else {
        // match on the clamped color so a cached answer is the same whatever pixel asked first
        r = clamp8(r);
        g = clamp8(g);
        b = clamp8(b);
        const key = (r << 16) | (g << 8) | b;
        idx = cache.get(key) ?? nearest(palette, r, g, b);
        cache.set(key, idx);
      }
      const c = palette[idx];
      out.data[i] = c[0];
      out.data[i + 1] = c[1];
      out.data[i + 2] = c[2];
      out.data[i + 3] = 255;
      if (buf) spreadError(buf, img.data, width, height, x, y, [r - c[0], g - c[1], b - c[2]]);
    }
  }
  return out;
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function spreadError(buf: Float32Array, alpha: Uint8ClampedArray, w: number, h: number, x: number, y: number, err: number[]) {
  const push = (dx: number, dy: number, k: number) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= w || ny >= h) return;
    const j = (ny * w + nx) * 4;
    if (alpha[j + 3] < 128) return;
    buf[j] += err[0] * k;
    buf[j + 1] += err[1] * k;
    buf[j + 2] += err[2] * k;
  };
  push(1, 0, 7 / 16);
  push(-1, 1, 3 / 16);
  push(0, 1, 5 / 16);
  push(1, 1, 1 / 16);
}

/** canvas limits that hold in every browser: iOS Safari refuses more than 4096² pixels in all */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 4096 * 4096;

/** the largest whole upscale, up to `want`, that keeps a w × h image inside canvas limits */
export function maxScale(w: number, h: number, want: number) {
  return Math.max(1, Math.min(want, Math.floor(MAX_CANVAS_SIDE / Math.max(w, h)), Math.floor(Math.sqrt(MAX_CANVAS_AREA / (w * h)))));
}

/** Snaps alpha to on/off without changing colors (the "original colors" palette) */
export function hardAlpha(img: Pixels): Pixels {
  const out = { ...img, data: Uint8ClampedArray.from(img.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = out.data[i] < 128 ? 0 : 255;
  return out;
}

/** Distinct opaque colors in an image, most used first */
export function usedColors(img: Pixels): Rgb[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => [k >> 16, (k >> 8) & 255, k & 255]);
}
