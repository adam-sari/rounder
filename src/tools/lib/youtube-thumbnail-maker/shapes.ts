/** Built-in vector stickers, as SVG path data in their own viewBox. They stay sharp at any size. */

export type ShapeId = 'arrow' | 'curve' | 'ring' | 'burst';

export interface Shape {
  name: string;
  w: number;
  h: number;
  d: string;
}

/** A starburst badge: `points` spikes alternating between the outer and inner radius */
export function burstPath(points: number, outer: number, inner: number, cx = outer, cy = outer) {
  const d: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    d.push(`${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `${d.join(' ')}Z`;
}

export const shapes: Record<ShapeId, Shape> = {
  arrow: { name: 'Arrow', w: 100, h: 56, d: 'M0 17H58V0L100 28 58 56V39H0Z' },
  curve: { name: 'Curved arrow', w: 100, h: 78, d: 'M2 76C6 40 32 16 66 14V0L98 24 66 50V34C42 35 24 52 22 76Z' },
  // two circles drawn in opposite directions, so the inner one cuts a hole
  ring: { name: 'Circle', w: 100, h: 100, d: 'M2 50A48 48 0 1 0 98 50 48 48 0 1 0 2 50ZM13 50A37 37 0 1 1 87 50 37 37 0 1 1 13 50Z' },
  burst: { name: 'Burst', w: 100, h: 100, d: burstPath(14, 50, 39) },
};

export const shapeIds = Object.keys(shapes) as ShapeId[];
