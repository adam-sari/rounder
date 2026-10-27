export interface ScrollMap {
  xs: number[];
  ys: number[];
}

/**
 * Pairs up the scroll position of each block in one pane with the same block in
 * the other. Blocks missing on either side (NaN), out of order or past the end
 * are skipped so the map stays strictly increasing.
 */
export function buildMap(from: number[], to: number[], fromMax: number, toMax: number): ScrollMap {
  const xs = [0];
  const ys = [0];
  for (let i = 0; i < from.length; i++) {
    const x = from[i];
    const y = to[i];
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (x > xs[xs.length - 1] && y >= ys[ys.length - 1] && x < fromMax && y < toMax) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (fromMax > 0) {
    xs.push(fromMax);
    ys.push(Math.max(toMax, ys[ys.length - 1]));
  }
  return { xs, ys };
}

/** Where the other pane should scroll to, interpolating between neighboring blocks */
export function mapScroll({ xs, ys }: ScrollMap, at: number): number {
  const last = xs.length - 1;
  if (last < 1) return 0;
  const x = Math.min(Math.max(at, 0), xs[last]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((x - xs[lo]) / (xs[hi] - xs[lo])) * (ys[hi] - ys[lo]);
}
