import { oklab } from './image-color-picker/color';

export interface Swatch {
  r: number;
  g: number;
  b: number;
  /** fraction of the (opaque) pixels this color stands for, 0–1 */
  share: number;
}

/**
 * Finds the dominant colors of an RGBA pixel buffer with k-means in OKLab, so the
 * groups match what people see rather than raw RGB distance. Pixels are first
 * binned to 5 bits per channel: a 24 MP photo collapses to a few thousand weighted
 * points, which keeps it fast and makes the result deterministic. Mostly
 * transparent pixels are ignored. Pass a downscaled copy for big images.
 */
export function extractPalette(rgba: ArrayLike<number>, count: number, maxIterations = 24): Swatch[] {
  const BINS = 1 << 15;
  const weight = new Uint32Array(BINS);
  const sum = new Float64Array(BINS * 3);
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    weight[key]++;
    sum[key * 3] += r;
    sum[key * 3 + 1] += g;
    sum[key * 3 + 2] += b;
    total++;
  }
  if (!total) return [];

  const points: { w: number; rgb: [number, number, number]; lab: [number, number, number] }[] = [];
  for (let key = 0; key < BINS; key++) {
    const w = weight[key];
    if (!w) continue;
    const rgb: [number, number, number] = [sum[key * 3] / w, sum[key * 3 + 1] / w, sum[key * 3 + 2] / w];
    points.push({ w, rgb, lab: oklab({ r: rgb[0], g: rgb[1], b: rgb[2] }) });
  }

  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // seeding: the most common color first, then repeatedly the point that is both
  // common and far from every seed so far (a deterministic k-means++)
  const k = Math.max(1, Math.min(count, points.length));
  let first = points[0];
  for (const p of points) if (p.w > first.w) first = p;
  const centers: number[][] = [[...first.lab]];
  const nearest = points.map((p) => dist(p.lab, first.lab));
  while (centers.length < k) {
    let best = -1;
    let bestScore = 0;
    points.forEach((p, i) => {
      const score = p.w * nearest[i];
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best < 0) break; // fewer distinct colors than asked for
    const c = points[best].lab;
    centers.push([...c]);
    points.forEach((p, i) => (nearest[i] = Math.min(nearest[i], dist(p.lab, c))));
  }

  const assign = new Int32Array(points.length).fill(-1);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    points.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const d = dist(p.lab, c);
        if (d < bestD) [best, bestD] = [j, d];
      });
      if (assign[i] !== best) [assign[i], changed] = [best, true];
    });
    if (!changed) break;
    const acc = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const a = acc[assign[i]];
      a[0] += p.lab[0] * p.w;
      a[1] += p.lab[1] * p.w;
      a[2] += p.lab[2] * p.w;
      a[3] += p.w;
    });
    acc.forEach((a, j) => a[3] && (centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]));
  }

  // report each group as the average of its actual pixels
  const groups = centers.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
  points.forEach((p, i) => {
    const g = groups[assign[i]];
    g.r += p.rgb[0] * p.w;
    g.g += p.rgb[1] * p.w;
    g.b += p.rgb[2] * p.w;
    g.w += p.w;
  });
  // when an image has fewer real colors than asked for, the spare groups end up on
  // anti-aliased edge pixels that look like the main colors; fold those back in
  const kept: { r: number; g: number; b: number; w: number; lab: number[] }[] = [];
  for (const g of groups.filter((g) => g.w).sort((a, b) => b.w - a.w)) {
    const lab = oklab({ r: g.r / g.w, g: g.g / g.w, b: g.b / g.w });
    const twin = kept.find((k) => dist(k.lab, lab) < MERGE_DISTANCE ** 2);
    if (!twin) {
      kept.push({ ...g, lab });
      continue;
    }
    twin.r += g.r;
    twin.g += g.g;
    twin.b += g.b;
    twin.w += g.w;
  }
  return kept.map((g) => ({ r: Math.round(g.r / g.w), g: Math.round(g.g / g.w), b: Math.round(g.b / g.w), share: g.w / total }));
}

/** OKLab distance under which two swatches read as the same color */
const MERGE_DISTANCE = 0.06;
