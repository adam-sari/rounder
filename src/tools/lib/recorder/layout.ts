import { evenize } from '@/engines/media/math';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type BubbleSize = 'small' | 'medium' | 'large';

export interface Bubble {
  corner: Corner;
  size: BubbleSize;
}

/** bubble diameter as a share of the frame's shorter side */
export const BUBBLE_SHARE: Record<BubbleSize, number> = { small: 0.2, medium: 0.28, large: 0.36 };
const MARGIN_SHARE = 0.04;

/** where the webcam circle sits in a width × height frame (top-left corner and diameter) */
export function bubbleRect(width: number, height: number, b: Bubble) {
  const short = Math.min(width, height);
  const size = Math.round(short * BUBBLE_SHARE[b.size]);
  const margin = Math.round(short * MARGIN_SHARE);
  return {
    x: b.corner.endsWith('left') ? margin : width - margin - size,
    y: b.corner.startsWith('top') ? margin : height - margin - size,
    size,
  };
}

/** letterboxes a source into a box, keeping its aspect ratio */
export function containRect(sw: number, sh: number, dw: number, dh: number) {
  if (!sw || !sh) return { x: 0, y: 0, width: dw, height: dh };
  const s = Math.min(dw / sw, dh / sh);
  const width = sw * s;
  const height = sh * s;
  return { x: (dw - width) / 2, y: (dh - height) / 2, width, height };
}

/** the centred square of a source, for filling a circle without squashing a face */
export function centerSquare(sw: number, sh: number) {
  const size = Math.min(sw, sh);
  return { x: (sw - size) / 2, y: (sh - size) / 2, size };
}

/** canvas size for compositing: the source size, capped so a 5K screen doesn't choke the encoder */
export function canvasSize(width: number, height: number, maxSide = 2560) {
  const s = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: evenize(width * s), height: evenize(height * s) };
}
