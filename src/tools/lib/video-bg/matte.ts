/** Pure helpers for turning the segmenter's person mask into a clean, steady matte. */

/** the model looks at 256 × 256, so a bigger mask would only be interpolated */
export const MASK_LONG_SIDE = 256;
/** MediaPipe's vision engine (.wasm), SIMD and plain builds: the model card counts only the model */
export const ENGINE_BYTES = { simd: 13_519_922, plain: 12_627_509 };

/** mask pixels repeated around each edge so feathering doesn't fade a person cut off by the frame */
export const MASK_PAD = 4;

/** mask size with the frame's aspect ratio, long side MASK_LONG_SIDE */
export function maskSize(w: number, h: number): { width: number; height: number } {
  const s = MASK_LONG_SIDE / Math.max(w, h, 1);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Blends this frame's mask into the running one (in place). Small wobble from frame to frame
 * (flicker) is smoothed hard, while big changes (real movement) follow almost at once, so
 * people moving quickly don't leave ghosts. smoothing 0 = off, 1 = strongest.
 */
export function smoothMask(acc: Float32Array, next: Float32Array, smoothing: number): void {
  const keep = Math.min(1, Math.max(0, smoothing)) * 0.9;
  for (let i = 0; i < acc.length; i++) {
    const d = next[i] - acc[i];
    const still = 1 - Math.min(1, Math.abs(d));
    acc[i] += d * (1 - keep * still * still);
  }
}

/**
 * Confidence (quantised to 0–255) → alpha, a smoothstep around 0.5. More feather widens the
 * ramp, so edges get softer; none gives a crisp cut-out.
 */
export function edgeRamp(feather: number): Uint8ClampedArray {
  const half = 0.06 + 0.3 * Math.min(1, Math.max(0, feather));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / 255 - (0.5 - half)) / (2 * half)));
    lut[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return lut;
}

/**
 * Writes the mask into the alpha channel of a padded RGBA image (RGB stays white), repeating
 * the outermost mask pixels into the MASK_PAD border.
 */
export function writeAlpha(mask: Float32Array, w: number, h: number, lut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const pw = w + 2 * MASK_PAD;
  const ph = h + 2 * MASK_PAD;
  for (let y = 0; y < ph; y++) {
    const row = Math.min(h - 1, Math.max(0, y - MASK_PAD)) * w;
    for (let x = 0; x < pw; x++) {
      const v = mask[row + Math.min(w - 1, Math.max(0, x - MASK_PAD))];
      out[(y * pw + x) * 4 + 3] = lut[Math.round(Math.min(1, Math.max(0, v)) * 255)];
    }
  }
}

/** edge blur in output pixels, scaled to the frame so the preview matches the export */
export const featherPx = (feather: number, w: number, h: number) => feather * Math.min(w, h) * 0.012;

/** background blur radius in output pixels */
export const backgroundBlurPx = (blur: number, w: number, h: number) => Math.min(w, h) * (0.006 + 0.04 * blur);

/** where to draw an image so it covers a w × h frame, centred */
export function coverRect(iw: number, ih: number, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const s = Math.max(w / iw, h / ih);
  const width = iw * s;
  const height = ih * s;
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** output size with the short side capped (0 = keep the original), even for the encoder */
export function exportSize(w: number, h: number, maxShort: number): { width: number; height: number } {
  const s = maxShort ? Math.min(1, maxShort / Math.min(w, h)) : 1;
  return { width: even(w * s), height: even(h * s) };
}

/** size that fits inside a box of `max` on the long side, never upscaled (for the live preview) */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
