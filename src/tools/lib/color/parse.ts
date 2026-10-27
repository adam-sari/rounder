import { fromCmyk, fromHsl, fromHwb, fromLab, fromLch, fromLinearRgb, fromOklab, fromOklch, fromP3, type Color } from './convert';

// every CSS named color, including the duplicate spellings (aqua, fuchsia, grey…)
const NAMED_LIST =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

let named: Map<string, string> | undefined;

function fromHex(hex: string): Color | null {
  if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((x) => x + x).join('') : hex;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), alpha: full.length === 8 ? n(6) : 1 };
}

interface Token {
  value: number;
  unit: '' | '%' | 'deg' | 'rad' | 'grad' | 'turn';
}

function token(s: string): Token | null {
  if (s === 'none') return { value: 0, unit: '' };
  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/);
  return m ? { value: parseFloat(m[1]), unit: (m[2] ?? '') as Token['unit'] } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** a number, or a percentage of `full` */
const num = (t: Token, full: number) => (t.unit === '%' ? (t.value / 100) * full : t.value);

function angle(t: Token) {
  const deg = t.unit === 'rad' ? (t.value * 180) / Math.PI : t.unit === 'grad' ? t.value * 0.9 : t.unit === 'turn' ? t.value * 360 : t.value;
  return ((deg % 360) + 360) % 360;
}

/**
 * Reads any CSS color: hex (with or without #), named colors, rgb(), hsl(), hwb(), lab(),
 * lch(), oklab(), oklch(), color(srgb | srgb-linear | display-p3 …), plus cmyk() and three
 * bare numbers as RGB. Legacy comma syntax, `/ alpha` and `none` all work.
 */
export function parseColor(input: string): Color | null {
  const c = parse(input);
  // absurd values like hsl(1e999 …) or lab(50 1e300 0) overflow to Infinity/NaN in the math
  return c && [c.r, c.g, c.b, c.alpha].every(Number.isFinite) ? c : null;
}

function parse(input: string): Color | null {
  const s = input.trim().toLowerCase().replace(/;$/, '');
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  named ??= new Map(NAMED_LIST.split(',').map((pair) => pair.split(':') as [string, string]));
  const hexName = named.get(s);
  if (hexName) return fromHex(hexName);
  if (/^#?[0-9a-f]+$/.test(s)) return fromHex(s.replace('#', ''));

  const fn = s.match(/^([a-z-]+)\((.*)\)$/s);
  const name = fn ? fn[1] : 'rgb';
  const body = fn ? fn[2] : s;

  const [main, slashAlpha, extra] = body.split('/');
  if (extra !== undefined) return null;
  const parts = main.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  let space = '';
  if (name === 'color') space = parts.shift() ?? '';
  const channels = name === 'cmyk' || name === 'device-cmyk' ? 4 : 3;
  // legacy comma syntax puts alpha in a 4th (or 5th) slot
  let alphaText: string | undefined = slashAlpha?.trim();
  if (alphaText === undefined && parts.length === channels + 1) alphaText = parts.pop();
  if (parts.length !== channels) return null;
  const maybe = parts.map(token);
  if (maybe.some((x) => !x)) return null;
  const t = maybe as Token[];
  const [a, b, c, d] = t;

  let alpha = 1;
  if (alphaText !== undefined) {
    const at = token(alphaText);
    if (!at || (at.unit !== '' && at.unit !== '%')) return null;
    alpha = clamp(num(at, 1), 0, 1);
  }
  // only hue slots may carry angle units
  const plain = (...xs: Token[]) => xs.every((x) => x.unit === '' || x.unit === '%');
  const isAngle = (x: Token) => x.unit !== '%';

  switch (name) {
    case 'rgb':
    case 'rgba':
      if (!plain(a, b, c)) return null;
      return { r: clamp(num(a, 255), 0, 255) / 255, g: clamp(num(b, 255), 0, 255) / 255, b: clamp(num(c, 255), 0, 255) / 255, alpha };
    case 'hsl':
    case 'hsla':
      if (!isAngle(a) || !plain(b, c)) return null;
      return fromHsl([angle(a), clamp(b.value, 0, 100), clamp(c.value, 0, 100)], alpha);
    case 'hwb':
      if (!isAngle(a) || !plain(b, c)) return null;
      return fromHwb([angle(a), clamp(b.value, 0, 100), clamp(c.value, 0, 100)], alpha);
    case 'lab':
      if (!plain(a, b, c)) return null;
      return fromLab([clamp(num(a, 100), 0, 100), num(b, 125), num(c, 125)], alpha);
    case 'lch':
      if (!plain(a, b) || !isAngle(c)) return null;
      return fromLch([clamp(num(a, 100), 0, 100), Math.max(0, num(b, 150)), angle(c)], alpha);
    case 'oklab':
      if (!plain(a, b, c)) return null;
      return fromOklab([clamp(num(a, 1), 0, 1), num(b, 0.4), num(c, 0.4)], alpha);
    case 'oklch':
      if (!plain(a, b) || !isAngle(c)) return null;
      return fromOklch([clamp(num(a, 1), 0, 1), Math.max(0, num(b, 0.4)), angle(c)], alpha);
    case 'color': {
      if (!plain(a, b, c)) return null;
      const v: [number, number, number] = [num(a, 1), num(b, 1), num(c, 1)];
      if (space === 'srgb') return { r: v[0], g: v[1], b: v[2], alpha };
      if (space === 'srgb-linear') return fromLinearRgb(v, alpha);
      if (space === 'display-p3') return fromP3(v, alpha);
      return null;
    }
    case 'cmyk':
    case 'device-cmyk': {
      if (!plain(a, b, c, d)) return null;
      // "cmyk(0, 47, 100, 0)" means percentages; device-cmyk's 0–1 numbers work too
      const scale = t.some((x) => x.unit === '' && x.value > 1) ? 100 : 1;
      const k = (x: Token) => clamp(x.unit === '%' ? x.value / 100 : x.value / scale, 0, 1);
      return fromCmyk([k(a), k(b), k(c), k(d)], alpha);
    }
  }
  return null;
}
