/*
 * Tiled super-resolution. Big photos are cut into equal, overlapping squares so each model run
 * fits in GPU (or wasm) memory and the progress bar moves; neighbouring results are cross-faded
 * across their overlap so no seams show. Pure functions over RGBA bytes, so they run anywhere.
 */

export type Scale = 2 | 4;

export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  /** how far this tile overlaps the one to its left / above (0 on the first column / row) */
  left: number;
  top: number;
}

/** Swin2SR works on 8 × 8 windows, so inputs are padded to a multiple of 8 */
export const WINDOW = 8;

/** Tile starts along one side: equal tiles, the last one moved back to end exactly at the edge */
export function axisStarts(length: number, tile: number, overlap: number): number[] {
  if (length <= tile) return [0];
  const starts: number[] = [];
  for (let s = 0; s + tile < length; s += tile - overlap) starts.push(s);
  starts.push(length - tile);
  return starts;
}

/** Every tile of a w × h image, row by row (blendTile relies on that order) */
export function planTiles(width: number, height: number, tile: number, overlap: number): Tile[] {
  const tw = Math.min(tile, width);
  const th = Math.min(tile, height);
  const xs = axisStarts(width, tw, overlap);
  const ys = axisStarts(height, th, overlap);
  return ys.flatMap((y, row) => xs.map((x, col) => ({ x, y, w: tw, h: th, left: col ? xs[col - 1] + tw - x : 0, top: row ? ys[row - 1] + th - y : 0 })));
}

/** Cuts a w × h piece out of an image */
export function crop(src: Pixels, x: number, y: number, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) data.set(src.data.subarray(((y + row) * src.width + x) * 4, ((y + row) * src.width + x + w) * 4), row * w * 4);
  return { data, width: w, height: h };
}

/**
 * RGBA bytes → the model's pixel_values: planar RGB in 0–1, padded to a multiple of 8 by
 * repeating the edge pixels (repeating beats black, which would bleed into the border).
 */
export function toPixelValues({ data, width, height }: Pixels): { values: Float32Array; width: number; height: number } {
  const pw = Math.ceil(width / WINDOW) * WINDOW;
  const ph = Math.ceil(height / WINDOW) * WINDOW;
  const plane = pw * ph;
  const values = new Float32Array(plane * 3);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(y, height - 1);
    for (let x = 0; x < pw; x++) {
      const s = (sy * width + Math.min(x, width - 1)) * 4;
      const d = y * pw + x;
      values[d] = data[s] / 255;
      values[d + plane] = data[s + 1] / 255;
      values[d + plane * 2] = data[s + 2] / 255;
    }
  }
  return { values, width: pw, height: ph };
}

/** The model's planar RGB output (pw × ph, padding included) → opaque RGBA of the wanted w × h */
export function fromReconstruction(values: ArrayLike<number>, pw: number, ph: number, w: number, h: number): Pixels {
  const plane = pw * ph;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * pw + x;
      const d = (y * w + x) * 4;
      // Uint8ClampedArray clamps and rounds for us
      data[d] = values[s] * 255;
      data[d + 1] = values[s + plane] * 255;
      data[d + 2] = values[s + plane * 2] * 255;
      data[d + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/**
 * Writes an upscaled tile into the output at (x, y). Across the overlap with the tiles written
 * before it (left, top, in output pixels) it fades from their result to its own, so the edge of
 * each tile, where the model saw the least context, never shows.
 */
export function blendTile(out: Pixels, tile: Pixels, x: number, y: number, left: number, top: number) {
  for (let ty = 0; ty < tile.height; ty++) {
    const wy = top ? Math.min(1, (ty + 0.5) / top) : 1;
    for (let tx = 0; tx < tile.width; tx++) {
      const w = Math.min(wy, left ? Math.min(1, (tx + 0.5) / left) : 1);
      const s = (ty * tile.width + tx) * 4;
      const d = ((y + ty) * out.width + x + tx) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = w === 1 ? tile.data[s + c] : out.data[d + c] * (1 - w) + tile.data[s + c] * w;
    }
  }
}

export function hasTransparency({ data }: Pixels): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** Copies the alpha channel of `alpha` (same size) into `out` */
export function copyAlpha(out: Pixels, alpha: Pixels) {
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = alpha.data[i];
}

/**
 * The largest input we upscale, as the long side in pixels. The result is what runs out first:
 * 6000 px (36 megapixels, ~150 MB of raw pixels held twice while it's built and saved) is about
 * what a computer's browser handles comfortably; phones get 4096 px, Safari's canvas ceiling.
 */
export function maxInputSide(scale: Scale, mobile: boolean): number {
  return (mobile ? 4096 : 6000) / scale;
}

/** w × h scaled down (never up) so the long side is at most `max` */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/**
 * Tile size and overlap (input pixels): big tiles on the GPU, smaller ones on the CPU so progress
 * moves. The largest GPU buffer is a 64-channel feature map at output size (4× of a 256 px tile:
 * 64 × 1024² × 4 bytes = 256 MiB), so GPUs with small buffer limits (phones) get smaller tiles.
 */
export function tiling(device: 'webgpu' | 'wasm', scale: Scale, maxBufferSize: number): { tile: number; overlap: number } {
  if (device === 'wasm') return { tile: 128, overlap: 16 };
  const tile = [256, 192].find((t) => 64 * (t * scale) ** 2 * 4 <= maxBufferSize / 2) ?? 128;
  return { tile, overlap: 24 };
}

/**
 * Rough input pixels per second, including tile overlap. CPU figures are measured (one thread,
 * onnxruntime-web wasm on a desktop: ×2 ≈ 2.3 s and ×4 ≈ 10.5 s per 128 px tile); GPU figures are
 * conservative guesses. The page refines its estimate from real tile times once it starts.
 */
const RATE: Record<'webgpu' | 'wasm', Record<Scale, number>> = {
  webgpu: { 2: 300_000, 4: 60_000 },
  wasm: { 2: 7_000, 4: 1_550 },
};

export function estimateSeconds(tiles: Tile[], device: 'webgpu' | 'wasm', scale: Scale, mobile: boolean): number {
  const pixels = tiles.reduce((sum, t) => sum + Math.ceil(t.w / WINDOW) * WINDOW * Math.ceil(t.h / WINDOW) * WINDOW, 0);
  return (pixels / RATE[device][scale]) * (mobile ? 3 : 1);
}

/** 12 → "a few seconds", 50 → "under a minute", 200 → "about 4 min", 4000 → "about 1 h 7 min" */
export function formatDuration(seconds: number): string {
  if (seconds < 20) return 'a few seconds';
  if (seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  return min < 60 ? `about ${min} min` : `about ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
