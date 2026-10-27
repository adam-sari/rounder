import { fromLinearRgb, linearRgb, toGamut, type Color, type Vec3 } from './convert';

export type Vision = 'protanopia' | 'deuteranopia' | 'tritanopia';

// Machado, Oliveira & Fernandes (2009), full severity, applied to linear RGB
const MATRICES: Record<Vision, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export const visions: { id: Vision; name: string; detail: string }[] = [
  { id: 'protanopia', name: 'Protanopia', detail: 'no red cones' },
  { id: 'deuteranopia', name: 'Deuteranopia', detail: 'no green cones' },
  { id: 'tritanopia', name: 'Tritanopia', detail: 'no blue cones' },
];

/** roughly how the color looks to someone with this kind of color blindness */
export function simulate(c: Color, vision: Vision): Color {
  const m = MATRICES[vision];
  const [r, g, b] = linearRgb(toGamut(c));
  const out: Vec3 = [0, 1, 2].map((i) => m[i][0] * r + m[i][1] * g + m[i][2] * b) as Vec3;
  return toGamut(fromLinearRgb(out, c.alpha));
}
