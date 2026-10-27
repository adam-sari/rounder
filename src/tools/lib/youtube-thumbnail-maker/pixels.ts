/** YouTube rejects custom thumbnails over 2 MB */
export const SIZE_LIMIT = 2 * 1024 * 1024;
export const QUALITIES = [92, 86, 80, 74, 68, 60, 52, 44];

/** Encodes at the highest quality that fits under limit (or the lowest one tried, if none does) */
export async function fitUnder(limit: number, encode: (quality: number) => Promise<Blob>, qualities = QUALITIES) {
  let blob: Blob | undefined;
  let quality = qualities[0];
  for (const q of qualities) {
    blob = await encode(q);
    quality = q;
    if (blob.size <= limit) break;
  }
  return { blob: blob!, quality };
}

/** true if any pixel is noticeably see-through, which is how a dropped PNG is told apart from a photo */
export function hasTransparency(data: Uint8ClampedArray, step = 7) {
  for (let i = 3; i < data.length; i += 4 * step) if (data[i] < 240) return true;
  return false;
}

/** Bounding box of the pixels that aren't fully transparent, or null for an empty image */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
