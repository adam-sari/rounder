import { to8bit, toCmyk, toGamut, toHsl, toHwb, toLab, toLch, toOklab, toOklch, toP3, type Color } from './convert';

/** rounds and drops trailing zeros (and the minus from -0) */
export const fixed = (n: number, digits: number) => String(+n.toFixed(digits) || 0);

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function toHex(c: Color) {
  const [r, g, b] = to8bit(c);
  const a = c.alpha < 1 ? hex2(Math.round(c.alpha * 255)) : '';
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a}`;
}

/** the same color as plain #rrggbb, for <input type="color"> and swatch labels */
export const toHex6 = (c: Color) => toHex({ ...c, alpha: 1 });

export type FormatKey = 'hex' | 'rgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'p3' | 'cmyk';

export const formatLabels: [FormatKey, string][] = [
  ['hex', 'HEX'],
  ['rgb', 'RGB'],
  ['hsl', 'HSL'],
  ['hwb', 'HWB'],
  ['oklch', 'OKLCH'],
  ['oklab', 'OKLab'],
  ['lch', 'LCH'],
  ['lab', 'LAB'],
  ['p3', 'Display P3'],
  ['cmyk', 'CMYK'],
];

/**
 * Every format as ready-to-paste CSS. Formats that can only describe sRGB (hex, rgb, hsl,
 * hwb, cmyk) use the gamut-mapped color; the wide ones keep the exact value.
 */
export function formatAll(c: Color): Record<FormatKey, string> {
  const alpha = c.alpha < 1 ? fixed(c.alpha, 3) : '';
  const slash = alpha ? ` / ${alpha}` : '';
  const m = toGamut(c);
  const [r, g, b] = to8bit(c);
  const [h, s, l] = toHsl(m);
  const [hh, w, bl] = toHwb(m);
  const [L, A, B] = toLab(c);
  const [, C, H] = toLch(c);
  const [oL, oA, oB] = toOklab(c);
  const [, oC, oH] = toOklch(c);
  const p3 = toP3(c);
  const cmyk = toCmyk(m).map((v) => `${Math.round(v * 100)}%`);
  return {
    hex: toHex(c),
    rgb: alpha ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`,
    hsl: `${alpha ? 'hsla' : 'hsl'}(${fixed(h, 1)}, ${fixed(s, 1)}%, ${fixed(l, 1)}%${alpha ? `, ${alpha}` : ''})`,
    hwb: `hwb(${fixed(hh, 1)} ${fixed(w, 1)}% ${fixed(bl, 1)}%${slash})`,
    lab: `lab(${fixed(L, 2)}% ${fixed(A, 2)} ${fixed(B, 2)}${slash})`,
    lch: `lch(${fixed(L, 2)}% ${fixed(C, 2)} ${fixed(H, 2)}${slash})`,
    oklab: `oklab(${fixed(oL * 100, 2)}% ${fixed(oA, 5)} ${fixed(oB, 5)}${slash})`,
    oklch: `oklch(${fixed(oL * 100, 2)}% ${fixed(oC, 4)} ${fixed(oH, 2)}${slash})`,
    p3: `color(display-p3 ${p3.map((v) => fixed(v, 4)).join(' ')}${slash})`,
    cmyk: `cmyk(${cmyk.join(', ')})`,
  };
}

/** for painting swatches: hex first as a fallback, then the exact (maybe wide-gamut) color */
export const swatchCss = (c: Color) => {
  const [L, C, H] = toOklch(c);
  return `background: ${toHex(c)}; background: oklch(${fixed(L * 100, 3)}% ${fixed(C, 5)} ${fixed(H, 3)} / ${fixed(c.alpha, 3)})`;
};
