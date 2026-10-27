/*
 * CIE Lab in OpenCV's float convention (L 0–100, a/b about ±127, D65, sRGB gamma), the space
 * DDColor was trained in. The model sees a 512×512 grey picture and predicts only the a/b
 * chroma; the result keeps the photo's own full-resolution lightness, so detail isn't lost.
 */

/** DDColor tiny's fixed input side */
export const MODEL_SIZE = 512;

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// OpenCV's sRGB ↔ XYZ matrices and D65 white point
const XN = 0.950456;
const ZN = 1.088754;
const [R2X, G2X, B2X, R2Y, G2Y, B2Y, R2Z, G2Z, B2Z] = [0.412453, 0.35758, 0.180423, 0.212671, 0.71516, 0.072169, 0.019334, 0.119193, 0.950227];
const [X2R, Y2R, Z2R, X2G, Y2G, Z2G, X2B, Y2B, Z2B] = [3.240479, -1.53715, -0.498535, -0.969256, 1.875991, 0.041556, 0.055648, -0.204043, 1.057311];
const T = 0.008856;
const K = 903.3;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > T ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const F_T = 7.787 * T + 16 / 116;
const fInv = (t: number) => (t > F_T ? t * t * t : (t - 16 / 116) / 7.787);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 8-bit sRGB → linear light */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
/** linear light (0–1, in GAMMA_STEPS) → 8-bit sRGB, so a full-size photo needs no pow() per pixel */
const GAMMA_STEPS = 16383;
const GAMMA = Uint8ClampedArray.from({ length: GAMMA_STEPS + 1 }, (_, i) => Math.round(toGamma(i / GAMMA_STEPS) * 255));

const lightnessOfY = (y: number) => (y > T ? 116 * Math.cbrt(y) - 16 : K * y);

/** sRGB (0–1) → Lab */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const x = (R2X * lr + G2X * lg + B2X * lb) / XN;
  const y = R2Y * lr + G2Y * lg + B2Y * lb;
  const z = (R2Z * lr + G2Z * lg + B2Z * lb) / ZN;
  const fy = f(y);
  return [lightnessOfY(y), 500 * (f(x) - fy), 200 * (fy - f(z))];
}

/** Lab → linear sRGB written to `out`, clipped to 0–1 (OpenCV clips before the gamma curve) */
function labToLinear(out: Float64Array, l: number, a: number, b: number) {
  const fy = l <= T * K ? 7.787 * (l / K) + 16 / 116 : (l + 16) / 116;
  const y = l <= T * K ? l / K : fy * fy * fy;
  const x = fInv(a / 500 + fy) * XN;
  const z = fInv(fy - b / 200) * ZN;
  out[0] = clamp01(X2R * x + Y2R * y + Z2R * z);
  out[1] = clamp01(X2G * x + Y2G * y + Z2G * z);
  out[2] = clamp01(X2B * x + Y2B * y + Z2B * z);
  return out;
}

/** Lab → sRGB (0–1) */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const [r, g, bl] = labToLinear(new Float64Array(3), l, a, b);
  return [toGamma(r), toGamma(g), toGamma(bl)];
}

/** L of an 8-bit pixel */
export function lightness(data: Uint8ClampedArray, i: number) {
  return lightnessOfY(R2Y * LINEAR[data[i]] + G2Y * LINEAR[data[i + 1]] + B2Y * LINEAR[data[i + 2]]);
}

/**
 * The model's input: the picture's lightness as grey RGB (a = b = 0), float32 NCHW 0–1, no
 * normalisation. Pass it already resized to MODEL_SIZE².
 */
export function modelInput(img: Pixels): Float32Array<ArrayBuffer> {
  const n = img.width * img.height;
  const out = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) {
    const [r, g, b] = labToRgb(lightness(img.data, p * 4), 0, 0);
    out[p] = r;
    out[n + p] = g;
    out[2 * n + p] = b;
  }
  return out;
}

/** source index pairs and weights for a half-pixel-centred bilinear resize (like cv2.resize) */
export function bilinearAxis(from: number, to: number) {
  const i0 = new Int32Array(to);
  const i1 = new Int32Array(to);
  const w = new Float32Array(to);
  for (let i = 0; i < to; i++) {
    const s = Math.min(from - 1, Math.max(0, ((i + 0.5) * from) / to - 0.5));
    i0[i] = Math.floor(s);
    i1[i] = Math.min(from - 1, i0[i] + 1);
    w[i] = s - i0[i];
  }
  return { i0, i1, w };
}

/**
 * The colorized picture: the source's own lightness at its full size, plus the predicted
 * a/b planes (side × side, planar) scaled up smoothly and multiplied by `saturation`.
 * Alpha is kept.
 */
export function composeColor(src: Pixels, ab: Float32Array, saturation = 1, side = MODEL_SIZE): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(width * height * 4);
  const xs = bilinearAxis(side, width);
  const ys = bilinearAxis(side, height);
  const plane = side * side;
  const rgb = new Float64Array(3);
  for (let y = 0; y < height; y++) {
    const r0 = ys.i0[y] * side;
    const r1 = ys.i1[y] * side;
    const wy = ys.w[y];
    for (let x = 0; x < width; x++) {
      const c0 = xs.i0[x];
      const c1 = xs.i1[x];
      const wx = xs.w[x];
      const w00 = (1 - wx) * (1 - wy);
      const w01 = wx * (1 - wy);
      const w10 = (1 - wx) * wy;
      const w11 = wx * wy;
      const a = (ab[r0 + c0] * w00 + ab[r0 + c1] * w01 + ab[r1 + c0] * w10 + ab[r1 + c1] * w11) * saturation;
      const bb = (ab[plane + r0 + c0] * w00 + ab[plane + r0 + c1] * w01 + ab[plane + r1 + c0] * w10 + ab[plane + r1 + c1] * w11) * saturation;
      const i = (y * width + x) * 4;
      labToLinear(rgb, lightness(data, i), a, bb);
      out[i] = GAMMA[Math.round(rgb[0] * GAMMA_STEPS)];
      out[i + 1] = GAMMA[Math.round(rgb[1] * GAMMA_STEPS)];
      out[i + 2] = GAMMA[Math.round(rgb[2] * GAMMA_STEPS)];
      out[i + 3] = data[i + 3];
    }
  }
  return out;
}

/** true when no pixel is see-through (so a JPEG preview loses nothing) */
export function isOpaque({ data }: Pixels) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}
