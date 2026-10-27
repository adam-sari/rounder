export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4];

/** the engine caps sped-up video at 60 fps by dropping frames */
export const FAST_FPS_CAP = 60;
/** below this, slow motion starts to look like a slideshow */
export const CHOPPY_FPS = 20;

export type AudioMode = 'pitch' | 'tape' | 'mute';

export const clampSpeed = (s: number) => (Number.isFinite(s) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(s * 100) / 100)) : 1);

/** the slider runs on a log scale so 0.5× and 2× sit the same distance from 1× */
export const speedToSlider = (s: number) => Math.log2(clampSpeed(s));
export const sliderToSpeed = (v: number) => clampSpeed(2 ** v);

/** 0.5 → "0.5×", 1.25 → "1.25×" */
export const speedLabel = (s: number) => `${clampSpeed(s)}×`;

/** "-2x", "-0.5x" for file names */
export const speedSuffix = (s: number) => `-${clampSpeed(s)}x`;

/**
 * Frame rate the output actually plays at. Slowing down stretches the same frames over more
 * time (no new frames are invented); speeding up drops frames above the cap.
 */
export function outputFps(sourceFps: number | null | undefined, speed: number): number | null {
  if (!sourceFps || !(sourceFps > 0)) return null;
  const fps = sourceFps * clampSpeed(speed);
  return speed > 1 ? Math.min(FAST_FPS_CAP, fps) : fps;
}

export const formatFps = (fps: number) => `${fps >= 10 ? Math.round(fps) : Math.round(fps * 10) / 10} fps`;
