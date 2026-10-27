import type { Rotation } from '@/engines/media/types';

/**
 * A video's new orientation, in the engine's order: turn clockwise first, then mirror in the
 * turned frame. `turns` is cumulative so the preview always spins the short way.
 */
export interface Orientation {
  turns: number;
  flipX: boolean;
  flipY: boolean;
}

export const rotationOf = (turns: number) => ((((turns % 4) + 4) % 4) * 90) as Rotation;

/**
 * Turning a mirrored picture clockwise on screen means turning the source the other way,
 * because the mirror is applied after the turn.
 */
export const turn = (o: Orientation, clockwise: boolean): Orientation => ({ ...o, turns: o.turns + ((o.flipX !== o.flipY) === clockwise ? -1 : 1) });

/** what the picture ends up as: mirroring both ways is the same as a half turn */
export function effective(o: Orientation): { rotate: Rotation; mirrored: boolean } {
  const both = o.flipX && o.flipY;
  return { rotate: rotationOf(o.turns + (both ? 2 : 0)), mirrored: o.flipX !== o.flipY };
}

export const isIdentity = (o: Orientation) => {
  const e = effective(o);
  return e.rotate === 0 && !e.mirrored;
};

/** engine options; both-way flips are passed as a half turn so the encoder does one transform */
export function engineOptions(o: Orientation): { rotate: Rotation; flipHorizontal: boolean; flipVertical: boolean } {
  const both = o.flipX && o.flipY;
  return { rotate: effective(o).rotate, flipHorizontal: both ? false : o.flipX, flipVertical: both ? false : o.flipY };
}

export function outputSize(width: number, height: number, o: Orientation) {
  const side = effective(o).rotate % 180 !== 0;
  return side ? { width: height, height: width } : { width, height };
}

/** CSS transform for a centred element: rotate, then mirror in screen axes (matches the engine) */
export const cssTransform = (o: Orientation) => `translate(-50%, -50%) scale(${o.flipX ? -1 : 1}, ${o.flipY ? -1 : 1}) rotate(${o.turns * 90}deg)`;

/** "90° clockwise · mirrored" */
export function describe(o: Orientation): string {
  const { rotate, mirrored } = effective(o);
  const parts = [rotate ? `${rotate}° clockwise` : 'upright'];
  if (mirrored) parts.push('mirrored');
  return parts.join(' · ');
}

export function fileSuffix(o: Orientation): string {
  const { rotate, mirrored } = effective(o);
  if (rotate && mirrored) return `-rotated-${rotate}-mirrored`;
  if (rotate) return `-rotated-${rotate}`;
  return mirrored ? '-mirrored' : '-upright';
}

/** box sizes for the preview: the turned picture fitted inside the stage, and the element before turning */
export function previewBox(stageW: number, stageH: number, srcW: number, srcH: number, o: Orientation) {
  const out = outputSize(srcW, srcH, o);
  const k = Math.max(0, Math.min(stageW / out.width, stageH / out.height));
  const side = out.width !== srcW || out.height !== srcH;
  const frame = { width: out.width * k, height: out.height * k };
  return { frame, element: side ? { width: frame.height, height: frame.width } : frame };
}
