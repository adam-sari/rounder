/** One sampled pen position. `p` is stylus pressure 0–1, or -1 when the device doesn't report it */
export interface PenPoint {
  x: number;
  y: number;
  /** ms */
  t: number;
  p: number;
}

/**
 * A pen width for every point: real pressure from a stylus, otherwise speed
 * (quick strokes run thinner, as with a fountain pen), eased so it never jumps.
 */
export function strokeWidths(pts: PenPoint[], base: number): number[] {
  const out: number[] = [];
  let w = base;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    let target = base;
    if (a.p >= 0) target = base * (0.35 + a.p * 1.15);
    else if (i > 0) {
      const b = pts[i - 1];
      const speed = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, a.t - b.t); // px per ms
      target = base * Math.min(1.3, Math.max(0.45, 1.3 - speed * 0.35));
    }
    w = i === 0 ? target : w * 0.65 + target * 0.35;
    out.push(w);
  }
  return out;
}

/**
 * Makes paper see-through, in place: pixels lighter than `threshold` (0–255)
 * vanish, and a soft band below it fades out with the white taken out of the
 * colour, so the ink keeps clean edges instead of a pale halo.
 */
export function removeLight(data: Uint8ClampedArray, threshold: number, soft = 48) {
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (l >= threshold) {
      data[i + 3] = 0;
      continue;
    }
    if (l <= threshold - soft) continue;
    const a = (threshold - l) / soft;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.round((data[i + c] - 255 * (1 - a)) / a));
    data[i + 3] = Math.round(data[i + 3] * a);
  }
}

/** the smallest box holding every pixel at least `min` opaque, or null for an empty image */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, min = 8) {
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < min) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** "Jane Q. Doe" → "JD" */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return '';
  const first = (w: string) => w.match(/\p{L}/u)![0].toUpperCase();
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}
