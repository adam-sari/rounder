/*
 * Camera paths for the 3D photo. A camera shifts the view by `x`/`y` (fractions of the frame, for
 * something at full depth difference from the pivot) and dollies by `zoom` (how much bigger the
 * nearest things get). Every path is a seamless loop over phase t ∈ [0, 1).
 */

export type Motion = 'orbit' | 'sway' | 'dolly';

export const MOTIONS: [Motion, string][] = [
  ['orbit', 'orbit'],
  ['sway', 'sway'],
  ['dolly', 'dolly zoom'],
];

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** shift at amount 1, as a fraction of the frame */
export const MAX_SHIFT = 0.06;
/** dolly at amount 1 */
export const MAX_ZOOM = 0.3;

/** camera at loop phase t (0–1) for an amount of 0–1 */
export function cameraAt(motion: Motion, t: number, amount: number): Camera {
  const a = amount * MAX_SHIFT;
  const w = 2 * Math.PI * t;
  if (motion === 'orbit') return { x: a * Math.cos(w), y: a * 0.6 * Math.sin(w), zoom: 0 };
  if (motion === 'sway') return { x: a * Math.sin(w), y: 0, zoom: 0 };
  return { x: 0, y: a * 0.25 * Math.sin(w), zoom: amount * MAX_ZOOM * (1 - Math.cos(w)) * 0.5 };
}

/** camera that follows a pointer or a tilted phone; px/py in −1…1 */
export function cameraFrom(px: number, py: number, amount: number): Camera {
  const len = Math.hypot(px, py);
  const k = (amount * MAX_SHIFT) / Math.max(1, len);
  return { x: px * k, y: py * k, zoom: 0 };
}

/**
 * How far to scale the photo up so the frame edges never show, constant over the whole loop.
 * The shader samples 0.5 + (s − 0.5 − shift·k) / (scale · (1 + zoom·k)) with k = depth − focus.
 */
export function overscan(motion: Motion, amount: number, focus: number): number {
  const far = Math.max(focus, 1 - focus);
  const zoom = motion === 'dolly' ? amount * MAX_ZOOM : 0;
  return (1 + 2 * amount * MAX_SHIFT * far) / (1 - zoom * focus);
}

/** output size that fits in maxSide, with even sides for video encoders */
export function fitSize(width: number, height: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  const even = (v: number) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Per-frame duration for the media engine's imagesToVideo. A hair under 1/fps: it advances to
 * the next image when the running sum of durations reaches the frame time, and float rounding
 * would otherwise make it repeat one frame and skip the next now and then.
 */
export const frameDuration = (fps: number) => (1 / fps) * (1 - 1e-9);
