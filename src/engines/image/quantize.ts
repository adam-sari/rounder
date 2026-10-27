import { quantize } from 'gifenc';

/**
 * Reduces an image to at most `colors` colors (2–256). Oxipng then stores the
 * result as an indexed png, which is usually 60–80% smaller than truecolor.
 * Floyd–Steinberg dithering hides the banding this would otherwise cause on photos.
 */
export function reduceColors(img: ImageData, colors: number, dither = true): ImageData {
  const { data, width, height } = img;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      hasAlpha = true;
      break;
    }
  }

  const palette = quantize(data, Math.max(2, Math.min(256, colors)), {
    format: hasAlpha ? 'rgba4444' : 'rgb565',
    clearAlpha: false,
  }) as number[][];
  const pr = palette.map((c) => c[0]);
  const pg = palette.map((c) => c[1]);
  const pb = palette.map((c) => c[2]);
  const pa = palette.map((c) => (hasAlpha ? (c[3] ?? 255) : 255));

  // nearest-color lookups cached on a 5-bit-per-channel grid
  const cache = new Uint16Array(1 << 20);
  const nearest = (r: number, g: number, b: number, a: number) => {
    const key = ((r >> 3) << 15) | ((g >> 3) << 10) | ((b >> 3) << 5) | (a >> 3);
    const hit = cache[key];
    if (hit) return hit - 1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pr.length; i++) {
      const dr = r - pr[i], dg = g - pg[i], db = b - pb[i], da = a - pa[i];
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3 + da * da * 3;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    cache[key] = best + 1;
    return best;
  };

  const out = new Uint8ClampedArray(data.length);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  // error rows for the current and next line, 4 channels each
  let cur = new Float32Array((width + 2) * 4);
  let next = new Float32Array((width + 2) * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const e = (x + 1) * 4;
      const r = dither ? clamp(data[i] + cur[e]) : data[i];
      const g = dither ? clamp(data[i + 1] + cur[e + 1]) : data[i + 1];
      const b = dither ? clamp(data[i + 2] + cur[e + 2]) : data[i + 2];
      const a = dither && hasAlpha ? clamp(data[i + 3] + cur[e + 3]) : data[i + 3];
      const p = nearest(r | 0, g | 0, b | 0, hasAlpha ? a | 0 : 255);
      out[i] = pr[p];
      out[i + 1] = pg[p];
      out[i + 2] = pb[p];
      out[i + 3] = hasAlpha ? pa[p] : 255;
      if (!dither) continue;
      const err = [r - pr[p], g - pg[p], b - pb[p], hasAlpha ? a - pa[p] : 0];
      for (let c = 0; c < 4; c++) {
        cur[e + 4 + c] += (err[c] * 7) / 16;
        next[e - 4 + c] += (err[c] * 3) / 16;
        next[e + c] += (err[c] * 5) / 16;
        next[e + 4 + c] += err[c] / 16;
      }
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
  return new ImageData(out, width, height);
}
