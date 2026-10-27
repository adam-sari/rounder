export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** alpha is 0–255 like canvas pixel data */
export interface Rgba extends Rgb {
  a: number;
}

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** sRGB → OKLab (Björn Ottosson). Distances here roughly match how different colors look. */
export function oklab({ r, g, b }: Rgb): [number, number, number] {
  const R = LINEAR[Math.round(r)];
  const G = LINEAR[Math.round(g)];
  const B = LINEAR[Math.round(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklch(c: Rgb): { l: number; c: number; h: number } {
  const [l, a, b] = oklab(c);
  const chroma = Math.hypot(a, b);
  // grays have no meaningful hue; rounding noise would otherwise show a random angle
  const h = chroma < 2e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c: chroma, h };
}

export function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: s * 100, l: l * 100 };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function toHex(c: Rgba | Rgb) {
  const a = 'a' in c && c.a < 255 ? hex2(c.a) : '';
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a}`;
}

/** Reads "#rgb", "#rrggbb", "#rrggbbaa" or "rgb(r, g, b)" (what EyeDropper returns) */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 255 };
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return { r: clamp(+m[1]), g: clamp(+m[2]), b: clamp(+m[3]), a: Math.round(clamp(alpha * 255)) };
  }
  return null;
}

// CSS named colors (aqua/fuchsia and the "grey" spellings are duplicates and left out)
const NAMED = 'aliceblue:f0f8ff,antiquewhite:faebd7,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

let named: { name: string; hex: string; lab: [number, number, number] }[] | undefined;

/** The closest CSS color keyword, measured in OKLab */
export function nearestNamed(c: Rgb): { name: string; hex: string; exact: boolean } {
  named ??= NAMED.split(',').map((pair) => {
    const [name, hex] = pair.split(':');
    const n = parseInt(hex, 16);
    return { name, hex: `#${hex}`, lab: oklab({ r: n >> 16, g: (n >> 8) & 255, b: n & 255 }) };
  });
  const [l, a, b] = oklab(c);
  let best = named[0];
  let bestD = Infinity;
  for (const entry of named) {
    const d = (entry.lab[0] - l) ** 2 + (entry.lab[1] - a) ** 2 + (entry.lab[2] - b) ** 2;
    if (d < bestD) [best, bestD] = [entry, d];
  }
  return { name: best.name, hex: best.hex, exact: best.hex === toHex({ r: c.r, g: c.g, b: c.b }) };
}

/** true when dark text reads better on top of this color */
export const isLight = (c: Rgb) => oklab(c)[0] > 0.68;

const fixed = (n: number, digits: number) => String(+n.toFixed(digits));

/** Every format the picker shows, as ready-to-paste CSS */
export function describe(c: Rgba) {
  const alpha = c.a < 255 ? fixed(c.a / 255, 2) : '';
  const h = hsl(c);
  const o = oklch(c);
  const hslH = Math.round(h.h) % 360;
  return {
    hex: toHex(c),
    rgb: alpha ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : `rgb(${c.r}, ${c.g}, ${c.b})`,
    hsl: `${alpha ? 'hsla' : 'hsl'}(${hslH}, ${Math.round(h.s)}%, ${Math.round(h.l)}%${alpha ? `, ${alpha}` : ''})`,
    oklch: `oklch(${fixed(o.l * 100, 1)}% ${fixed(o.c, 3)} ${fixed(o.h, 1)}${alpha ? ` / ${alpha}` : ''})`,
    named: nearestNamed(c),
  };
}
