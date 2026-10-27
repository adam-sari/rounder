export interface FitResult<T> {
  out: T;
  quality: number;
  /** 1 = original dimensions */
  scale: number;
  fits: boolean;
}

export interface FitOptions {
  maxQuality?: number;
  /** lowest quality tried at a given size before the image is shrunk instead */
  minQuality?: number;
  /** encode budget for the quality search */
  maxSteps?: number;
  minScale?: number;
}

/**
 * Finds the best quality that lands at or under `target` bytes. It keeps the original
 * dimensions while quality ≥ minQuality fits, and only then shrinks the image.
 * `encode(quality, scale)` returns anything with a byte size (a Blob, usually).
 */
export async function fitFileSize<T extends { size: number }>(
  target: number,
  encode: (quality: number, scale: number) => Promise<T>,
  { maxQuality = 92, minQuality = 50, maxSteps = 8, minScale = 0.02 }: FitOptions = {},
): Promise<FitResult<T>> {
  let steps = 0;
  let smallest: FitResult<T> | undefined;
  const attempt = async (quality: number, scale: number) => {
    steps++;
    const out = await encode(quality, scale);
    const r = { out, quality, scale, fits: out.size <= target };
    if (!smallest || out.size < smallest.out.size) smallest = r;
    return r;
  };

  const top = await attempt(maxQuality, 1);
  if (top.fits) return top;

  let scale = 1;
  let best = await attempt(minQuality, scale);
  // size grows roughly with pixel count, so shrink by the square root of the overshoot;
  // a few steps past the budget are allowed here so we still end up under the limit
  while (!best.fits && scale > minScale && steps < maxSteps + 4) {
    scale = Math.max(minScale, scale * Math.min(0.9, Math.sqrt(target / best.out.size) * 0.95));
    best = await attempt(minQuality, scale);
  }
  if (!best.fits) return smallest!;

  // binary search: lo always fits, hi never does (maxQuality is only known to fail at full size)
  let lo = minQuality;
  let hi = scale === 1 ? maxQuality : maxQuality + 1;
  while (hi - lo > 2 && steps < maxSteps) {
    const mid = Math.round((lo + hi) / 2);
    const r = await attempt(mid, scale);
    if (r.fits) {
      best = r;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}
