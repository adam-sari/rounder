/**
 * Colors are kept as gamma-encoded sRGB floats. Inside the sRGB gamut each channel is 0–1;
 * colors from wider spaces (lab, oklch, display-p3) can go outside that range, which is
 * how we know they need gamut mapping before they can be shown as hex.
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  alpha: number;
}

export type Vec3 = [number, number, number];

const mul = (m: number[][], [x, y, z]: Vec3): Vec3 => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z,
  m[1][0] * x + m[1][1] * y + m[1][2] * z,
  m[2][0] * x + m[2][1] * y + m[2][2] * z,
];

// sign-preserving, so out-of-gamut negatives survive the round trip
const toLinear = (c: number) => {
  const a = Math.abs(c);
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const a = Math.abs(c);
  return a <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055);
};

export const linearRgb = (c: Color): Vec3 => [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
export const fromLinearRgb = ([r, g, b]: Vec3, alpha = 1): Color => ({ r: fromLinear(r), g: fromLinear(g), b: fromLinear(b), alpha });

/** exact inverses, so conversions round-trip to float precision */
function invert(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

// matrices from CSS Color 4
const SRGB_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_SRGB = invert(SRGB_XYZ);
const P3_XYZ = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const XYZ_P3 = invert(P3_XYZ);
// Bradford adaptation: CSS lab() and lch() use a D50 white point
const D65_D50 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_D65 = invert(D65_D50);
const D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/** display-p3 shares the sRGB transfer curve, just with wider primaries */
export function toP3(c: Color): Vec3 {
  const [r, g, b] = mul(XYZ_P3, mul(SRGB_XYZ, linearRgb(c)));
  return [fromLinear(r), fromLinear(g), fromLinear(b)];
}
export function fromP3([r, g, b]: Vec3, alpha = 1): Color {
  return fromLinearRgb(mul(XYZ_SRGB, mul(P3_XYZ, [toLinear(r), toLinear(g), toLinear(b)])), alpha);
}

const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

/** CIE Lab (D50), L 0–100 */
export function toLab(c: Color): Vec3 {
  const xyz = mul(D65_D50, mul(SRGB_XYZ, linearRgb(c)));
  const [fx, fy, fz] = xyz.map((v, i) => {
    const t = v / D50[i];
    return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function fromLab([L, a, b]: Vec3, alpha = 1): Color {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xyz: Vec3 = [
    (fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA) * D50[0],
    (L > KAPPA * EPSILON ? fy ** 3 : L / KAPPA) * D50[1],
    (fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA) * D50[2],
  ];
  return fromLinearRgb(mul(XYZ_SRGB, mul(D50_D65, xyz)), alpha);
}

// OKLab (Björn Ottosson): linear sRGB → LMS, then cube roots → Lab
const RGB_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_LAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const LMS_RGB = invert(RGB_LMS);
const LAB_LMS = invert(LMS_LAB);

/** OKLab, L 0–1 */
export const toOklab = (c: Color): Vec3 => mul(LMS_LAB, mul(RGB_LMS, linearRgb(c)).map(Math.cbrt) as Vec3);
export const fromOklab = (lab: Vec3, alpha = 1): Color =>
  fromLinearRgb(mul(LMS_RGB, mul(LAB_LMS, lab).map((v) => v ** 3) as Vec3), alpha);

/** a/b → chroma/hue; near-grays get hue 0 since their angle is just rounding noise */
function toPolar([L, a, b]: Vec3, grayBelow: number): Vec3 {
  const C = Math.hypot(a, b);
  const H = C < grayBelow ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}
function fromPolar([L, C, H]: Vec3): Vec3 {
  const rad = (H * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

export const toLch = (c: Color) => toPolar(toLab(c), 0.0015);
export const fromLch = (lch: Vec3, alpha = 1) => fromLab(fromPolar(lch), alpha);
export const toOklch = (c: Color) => toPolar(toOklab(c), 2e-5);
export const fromOklch = (lch: Vec3, alpha = 1) => fromOklab(fromPolar(lch), alpha);

/** [hue 0–360, saturation 0–100, lightness 0–100] */
export function toHsl({ r, g, b }: Color): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
export function fromHsl([h, s, l]: Vec3, alpha = 1): Color {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), alpha };
}

/** [hue 0–360, saturation 0–1, value 0–1], what the picker square works in */
export function toHsv({ r, g, b }: Color): Vec3 {
  const v = Math.max(r, g, b);
  const d = v - Math.min(r, g, b);
  const [h] = toHsl({ r, g, b, alpha: 1 });
  return [h, v === 0 ? 0 : d / v, v];
}
export function fromHsv([h, s, v]: Vec3, alpha = 1): Color {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1), alpha };
}

/** [hue 0–360, whiteness 0–100, blackness 0–100] */
export function toHwb(c: Color): Vec3 {
  const [h] = toHsl(c);
  return [h, Math.min(c.r, c.g, c.b) * 100, (1 - Math.max(c.r, c.g, c.b)) * 100];
}
export function fromHwb([h, w, bl]: Vec3, alpha = 1): Color {
  w /= 100;
  bl /= 100;
  if (w + bl >= 1) {
    const gray = w / (w + bl);
    return { r: gray, g: gray, b: gray, alpha };
  }
  const pure = fromHsl([h, 100, 50]);
  const f = (v: number) => v * (1 - w - bl) + w;
  return { r: f(pure.r), g: f(pure.g), b: f(pure.b), alpha };
}

/** Naive CMYK (0–1 each), with no print profile involved */
export function toCmyk({ r, g, b }: Color): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}
export function fromCmyk([c, m, y, k]: [number, number, number, number], alpha = 1): Color {
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k), alpha };
}

/** half an 8-bit step, so values that round to the same hex count as in gamut */
const GAMUT_SLACK = 0.5 / 255;

export const inGamut = ({ r, g, b }: Color, slack = GAMUT_SLACK) =>
  [r, g, b].every((v) => v >= -slack && v <= 1 + slack);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clip = (c: Color): Color => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), alpha: clamp01(c.alpha) });

export function deltaEOK(a: Color, b: Color) {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * CSS Color 4 gamut mapping: lower OKLCH chroma (keeping lightness and hue) until a plain
 * clip is no longer noticeably different. Much closer to the intended color than clipping.
 */
export function toGamut(c: Color): Color {
  if (inGamut(c)) return clip(c);
  const [L, C, H] = toOklch(c);
  if (L >= 0.99999) return { r: 1, g: 1, b: 1, alpha: c.alpha };
  if (L <= 0.00001) return { r: 0, g: 0, b: 0, alpha: c.alpha };
  const JND = 0.02;
  let lo = 0;
  let hi = C;
  let loInGamut = true;
  let clipped = clip(c);
  if (deltaEOK(clipped, c) < JND) return clipped;
  while (hi - lo > 1e-4) {
    const chroma = (lo + hi) / 2;
    const current = fromOklch([L, chroma, H], c.alpha);
    if (loInGamut && inGamut(current, 0)) {
      lo = chroma;
      continue;
    }
    clipped = clip(current);
    const e = deltaEOK(clipped, current);
    if (e < JND) {
      if (JND - e < 1e-4) return clipped;
      loInGamut = false;
      lo = chroma;
    } else {
      hi = chroma;
    }
  }
  return clipped;
}

/** 0–255 channels of the gamut-mapped color */
export function to8bit(c: Color): [number, number, number] {
  const m = toGamut(c);
  return [Math.round(m.r * 255), Math.round(m.g * 255), Math.round(m.b * 255)];
}
