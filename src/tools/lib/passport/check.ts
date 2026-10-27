/** where the photo sits inside the output frame (all in output px) */
export interface Placement {
  /** centre of the photo */
  cx: number;
  cy: number;
  /** output px per source px */
  scale: number;
  /** clockwise, degrees */
  rotation: number;
}

/** True when the rotated, scaled photo covers every corner of the frame (no blank edges) */
export function coversFrame(p: Placement, img: { width: number; height: number }, frame: { width: number; height: number }) {
  const a = (-p.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const slack = 0.5; // half a source pixel of rounding
  return [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]].every(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const u = (dx * cos - dy * sin) / p.scale;
    const v = (dx * sin + dy * cos) / p.scale;
    return Math.abs(u) <= img.width / 2 + slack && Math.abs(v) <= img.height / 2 + slack;
  });
}

export interface BackgroundStats {
  /** mean luma, 0–1 */
  brightness: number;
  /** spread of luma, 0–1 (shadows, objects) */
  unevenness: number;
  /** how far the average color is from neutral grey, 0–1 */
  tint: number;
}

/**
 * Looks at the two top corners of the cropped photo, beside the head and above
 * the shoulders, where only background should show.
 */
export function backgroundStats(data: Uint8ClampedArray, width: number, height: number): BackgroundStats {
  const xEdge = Math.max(1, Math.round(width * 0.14));
  const yEdge = Math.max(1, Math.round(height * 0.22));
  let n = 0, sum = 0, sumSq = 0, r = 0, g = 0, b = 0;
  for (let y = 0; y < yEdge; y++) {
    for (let x = 0; x < width; x++) {
      if (x === xEdge) x = width - xEdge;
      const i = (y * width + x) * 4;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += luma;
      sumSq += luma * luma;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  const mean = sum / n;
  const spread = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return {
    brightness: mean / 255,
    unevenness: spread / 255,
    tint: (Math.max(r, g, b) - Math.min(r, g, b)) / n / 255,
  };
}

export interface Hint {
  ok: boolean;
  text: string;
}

/** Plain-language advice; these are hints, not a verdict from any passport office */
export function backgroundHints(s: BackgroundStats, need: 'white' | 'light'): Hint[] {
  const hints: Hint[] = [];
  const min = need === 'white' ? 0.8 : 0.65;
  if (s.brightness < min) {
    hints.push({ ok: false, text: `The background looks ${s.brightness < 0.45 ? 'dark' : 'greyish'} (${Math.round(s.brightness * 100)}% bright). This document wants ${need === 'white' ? 'white or off-white' : 'a light, plain'} background: try a lighter wall or more light behind you.` });
  }
  if (s.unevenness > 0.08) hints.push({ ok: false, text: 'The background looks uneven. Shadows, patterns or objects behind you can get a photo rejected.' });
  if (s.tint > 0.1) hints.push({ ok: false, text: 'The background has a color cast. A plain white or light grey wall is safest.' });
  if (!hints.length) hints.push({ ok: true, text: 'The background looks light, plain and even.' });
  return hints;
}
