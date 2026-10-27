export type QuarterTurn = 0 | 90 | 180 | 270;

export interface Orientation {
  /** clockwise quarter turns, applied after the flips */
  rotate: QuarterTurn;
  flipX: boolean;
  flipY: boolean;
}

/** Any multiple of 90 (negative or past 360) → 0 | 90 | 180 | 270 */
export function quarter(deg: number): QuarterTurn {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
}

/**
 * Mirror the image as it currently looks on screen. Flips are applied before the
 * rotation, so once the picture is on its side a screen-horizontal flip is a
 * vertical flip of the source.
 */
export function flipOnScreen(o: Orientation, axis: 'horizontal' | 'vertical'): Orientation {
  const sideways = o.rotate === 90 || o.rotate === 270;
  return (axis === 'horizontal') !== sideways ? { ...o, flipX: !o.flipX } : { ...o, flipY: !o.flipY };
}

/** Size of a w × h image after quarter turns */
export function turnedSize(w: number, h: number, rotate: QuarterTurn) {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h };
}

const rad = (deg: number) => (Math.abs(deg) * Math.PI) / 180;

/** Canvas that holds the whole w × h image tilted by `deg` (corners filled in) */
export function boundingSize(w: number, h: number, deg: number) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { width: Math.ceil(w * c + h * s - 1e-9), height: Math.ceil(w * s + h * c - 1e-9) };
}

/**
 * Largest centred rectangle with the image's own aspect ratio that fits inside
 * the w × h image tilted by `deg`, so the straightened photo has no empty corners.
 * `margin` keeps the anti-aliased edge pixels out of the crop.
 */
export function innerCropSize(w: number, h: number, deg: number, margin = 2) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  if (s < 1e-9) return { width: w, height: h };
  const k = Math.min((w - margin) / (w * c + h * s), (h - margin) / (w * s + h * c));
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)) };
}

/** "-rotated", "-straightened" or "-flipped", depending on what was done; "-upright" when only the EXIF turn is baked in */
export function outputSuffix(o: Orientation, fine: number) {
  if (o.rotate) return '-rotated';
  if (fine) return '-straightened';
  if (o.flipX || o.flipY) return '-flipped';
  return '-upright';
}
