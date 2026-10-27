/*
 * Cheap per-frame signals for auto-reframe, computed on tiny grayscale frames (64 px wide):
 * scene cuts (histogram + pixel difference), a "where's the action" point for shots without
 * faces (motion, else contrast, with a mild centre bias), and merging overlapping face boxes.
 */

/** a box in 0–1 frame units */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
}

/** where the action is when no face is: 0–1 frame units, weight 0–1 (how sure) */
export interface Focus {
  x: number;
  y: number;
  weight: number;
}

/** Rec. 601 luma of RGBA pixels */
export function lumaOf(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return out;
}

export function histogram(luma: Uint8Array, bins = 32): Float32Array {
  const h = new Float32Array(bins);
  const shift = Math.log2(256 / bins);
  for (const v of luma) h[v >> shift]++;
  for (let i = 0; i < bins; i++) h[i] /= luma.length || 1;
  return h;
}

/** 0 (same tones) – 1 (no overlap) */
export function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

/** mean absolute difference, 0–1 */
export function pixelDiff(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / (a.length || 1) / 255;
}

/** how different two frames are, 0–1: a hard cut scores high, camera motion low */
export function changeScore(a: Uint8Array, b: Uint8Array): number {
  return 0.5 * histDistance(histogram(a), histogram(b)) + 0.5 * Math.min(1, pixelDiff(a, b) * 2.5);
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/**
 * Indices i where a new shot starts (a cut between frame i-1 and i). A cut must score above
 * `threshold` and stand out from its neighbourhood (so steady fast motion isn't a cut);
 * cuts closer than `minShot` seconds keep the stronger one.
 */
export function findCuts(scores: number[], times: number[], o: { threshold?: number; ratio?: number; minShot?: number } = {}): number[] {
  const { threshold = 0.3, ratio = 2.5, minShot = 0.6 } = o;
  const cuts: number[] = [];
  for (let i = 1; i < scores.length; i++) {
    const near: number[] = [];
    for (let j = Math.max(1, i - 6); j <= Math.min(scores.length - 1, i + 6); j++) if (j !== i) near.push(scores[j]);
    if (scores[i] < threshold || scores[i] < ratio * median(near) + 0.02) continue;
    const last = cuts.at(-1);
    if (last !== undefined && times[i] - times[last] < minShot) {
      if (scores[i] > scores[last]) cuts[cuts.length - 1] = i;
    } else cuts.push(i);
  }
  return cuts;
}

/**
 * The exact cut inside a sampled gap: `lumas` are consecutive frames at `times` (one frame
 * apart, from before the cut to after it). Returns a time just after the last frame of the old
 * shot, so every frame of the new shot (timestamp > that) gets the new framing.
 */
export function refineCut(times: number[], lumas: Uint8Array[]): number {
  let best = 1;
  let bestScore = -1;
  for (let j = 1; j < lumas.length; j++) {
    const s = changeScore(lumas[j - 1], lumas[j]);
    if (s > bestScore) [best, bestScore] = [j, s];
  }
  return times[best - 1] + 0.001;
}

/**
 * Where the eye goes in a frame without faces: the centroid of motion since the previous
 * frame, or of contrast when nothing moves, mildly pulled to the centre. Null for a flat frame.
 */
export function focusPoint(cur: Uint8Array, prev: Uint8Array | null, w: number, h: number): Focus | null {
  const bias = (x: number, y: number) => Math.exp(-((x / w - 0.5) ** 2 + (y / h - 0.5) ** 2) / 0.18);
  const centroid = (weightAt: (i: number, x: number, y: number) => number) => {
    let sum = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const v = weightAt(y * w + x, x, y);
        if (!v) continue;
        const b = v * bias(x, y);
        sum += b;
        sx += b * (x + 0.5);
        sy += b * (y + 0.5);
      }
    }
    return { sum, x: sx / sum / w, y: sy / sum / h };
  };

  if (prev) {
    let energy = 0;
    const motion = (i: number) => Math.max(0, Math.abs(cur[i] - prev[i]) - 10);
    for (let i = 0; i < cur.length; i++) energy += motion(i);
    const mean = energy / cur.length;
    if (mean > 1.5) {
      const c = centroid(motion);
      if (c.sum > 0) return { x: c.x, y: c.y, weight: Math.min(1, Math.max(0.3, mean / 6)) };
    }
  }
  const c = centroid((i) => {
    const g = Math.abs(cur[i + 1] - cur[i - 1]) + Math.abs(cur[i + w] - cur[i - w]);
    return g > 24 ? g : 0;
  });
  return c.sum > 0 ? { x: c.x, y: c.y, weight: 0.3 } : null;
}

const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** one box per face when several passes (full frame, zoomed tiles, two models) found it */
export function mergeBoxes(boxes: Box[], overlap = 0.3): Box[] {
  const kept: Box[] = [];
  for (const b of [...boxes].sort((p, q) => (q.score ?? 0) - (p.score ?? 0))) {
    if (!kept.some((k) => iou(k, b) > overlap || contains(k, b) || contains(b, k))) kept.push(b);
  }
  return kept;
}

const contains = (a: Box, b: Box) => {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx > a.x && cx < a.x + a.w && cy > a.y && cy < a.y + a.h && b.w < a.w;
};

/** two overlapping squares covering a wide (or tall) frame; none for squarish ones */
export function squareTiles(W: number, H: number): { x: number; y: number; size: number }[] {
  const size = Math.min(W, H);
  if (Math.max(W, H) < size * 1.25) return [];
  return W > H
    ? [
        { x: 0, y: 0, size },
        { x: W - size, y: 0, size },
      ]
    : [
        { x: 0, y: 0, size },
        { x: 0, y: H - size, size },
      ];
}
