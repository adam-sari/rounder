import { fromOklch, toGamut, toOklch, type Color } from './convert';
import { fixed, toHex } from './format';

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Lightness and relative chroma of a typical Tailwind v4 palette (its red), in OKLCH
const LIGHTNESS = [0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.258];
const CHROMA = [0.055, 0.135, 0.266, 0.481, 0.806, 1, 1.034, 0.899, 0.747, 0.595, 0.388];

export interface Shade {
  step: (typeof STEPS)[number];
  color: Color;
  hex: string;
  oklch: string;
}

/**
 * An 11-step 50–950 scale built around the color. The color itself lands exactly on the
 * step with the nearest lightness; the other steps follow the Tailwind lightness curve,
 * stretched so it still runs from near-white to near-black, and keep the hue.
 */
export function shades(c: Color): { anchor: number; shades: Shade[] } {
  const [L, C, H] = toOklch(toGamut(c));
  let anchor = 0;
  LIGHTNESS.forEach((l, i) => Math.abs(l - L) < Math.abs(LIGHTNESS[anchor] - L) && (anchor = i));
  const at = LIGHTNESS[anchor];
  // piecewise-linear remap of the curve so (0→0, anchor→L, 1→1)
  const remap = (l: number) => (l >= at ? L + ((l - at) / (1 - at)) * (1 - L) : (l / at) * L);
  const list = STEPS.map((step, i) => {
    const lightness = i === anchor ? L : remap(LIGHTNESS[i]);
    // capped, so a near-white tint doesn't turn into a neon 500
    const chroma = i === anchor ? C : C * Math.min(4, CHROMA[i] / CHROMA[anchor]);
    const color = i === anchor ? toGamut({ ...c, alpha: 1 }) : toGamut(fromOklch([lightness, chroma, H]));
    const [l2, c2, h2] = toOklch(color);
    return { step, color, hex: toHex(color), oklch: `oklch(${fixed(l2 * 100, 1)}% ${fixed(c2, 3)} ${fixed(h2, 1)})` };
  });
  return { anchor, shades: list };
}

export type ScaleExport = 'css' | 'tailwind' | 'json';

export function scaleCode(list: Shade[], format: ScaleExport, value: 'hex' | 'oklch', name = 'brand') {
  const v = (s: Shade) => s[value];
  if (format === 'json') return JSON.stringify(Object.fromEntries(list.map((s) => [s.step, v(s)])), null, 2);
  const lines = list.map((s) => `  --color-${name}-${s.step}: ${v(s)};`).join('\n');
  return format === 'tailwind' ? `@theme {\n${lines}\n}` : `:root {\n${lines}\n}`;
}
