/*
 * Pure pixel math for the background remover: the model sees a ~1024 px copy of the photo, and
 * its mask is brought back to full resolution with a fast guided filter (He & Sun, 2015) that
 * snaps the mask to the real edges of the full-size photo. Also brush and crop geometry.
 */

/** longest side the model and the guided filter work at */
export const WORK_SIZE = 1024;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One brush stroke in full-resolution pixels: erase (remove) or restore (bring back) */
export interface Stroke {
  erase: boolean;
  /** brush radius */
  r: number;
  /** x0, y0, x1, y1, … */
  pts: number[];
}

/** Size that fits inside `max` on the longest side, never enlarged */
export function fitSize(w: number, h: number, max: number): [number, number] {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** Area-average downscale of interleaved 8-bit pixels (1 channel for masks, 4 for RGBA) */
export function downsample(src: ArrayLike<number>, w: number, h: number, tw: number, th: number, channels: number): Uint8ClampedArray<ArrayBuffer> {
  const xs = new Int32Array(w);
  const ys = new Int32Array(h);
  const cx = new Uint32Array(tw);
  const cy = new Uint32Array(th);
  for (let x = 0; x < w; x++) cx[(xs[x] = Math.floor((x * tw) / w))]++;
  for (let y = 0; y < h; y++) cy[(ys[y] = Math.floor((y * th) / h))]++;
  const sums = new Float64Array(tw * th * channels);
  for (let y = 0, i = 0; y < h; y++) {
    const row = ys[y] * tw;
    for (let x = 0; x < w; x++) {
      const o = (row + xs[x]) * channels;
      for (let c = 0; c < channels; c++) sums[o + c] += src[i++];
    }
  }
  const out = new Uint8ClampedArray(sums.length);
  for (let ty = 0, o = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const n = cx[tx] * cy[ty];
      for (let c = 0; c < channels; c++, o++) out[o] = sums[o] / n;
    }
  }
  return out;
}

/** Sample positions for bilinear resampling n → m along one axis (pixel centres aligned) */
function axis(n: number, m: number) {
  const i0 = new Int32Array(m);
  const i1 = new Int32Array(m);
  const f = new Float32Array(m);
  for (let j = 0; j < m; j++) {
    const s = Math.min(n - 1, Math.max(0, ((j + 0.5) * n) / m - 0.5));
    i0[j] = Math.floor(s);
    i1[j] = Math.min(n - 1, i0[j] + 1);
    f[j] = s - i0[j];
  }
  return { i0, i1, f };
}

export function resizeBilinear(src: Float32Array, sw: number, sh: number, tw: number, th: number): Float32Array {
  const X = axis(sw, tw);
  const Y = axis(sh, th);
  const out = new Float32Array(tw * th);
  for (let y = 0, o = 0; y < th; y++) {
    const r0 = Y.i0[y] * sw;
    const r1 = Y.i1[y] * sw;
    const fy = Y.f[y];
    for (let x = 0; x < tw; x++, o++) {
      const a = src[r0 + X.i0[x]] + (src[r0 + X.i1[x]] - src[r0 + X.i0[x]]) * X.f[x];
      const b = src[r1 + X.i0[x]] + (src[r1 + X.i1[x]] - src[r1 + X.i0[x]]) * X.f[x];
      out[o] = a + (b - a) * fy;
    }
  }
  return out;
}

/** Model outputs are either probabilities or logits (BiRefNet); returns probabilities, in place */
export function toProbabilities(data: Float32Array): Float32Array {
  if (data.some((v) => v < -1e-5 || v > 1 + 1e-5)) for (let i = 0; i < data.length; i++) data[i] = 1 / (1 + Math.exp(-data[i]));
  return data;
}

export type MaskVerdict = 'ok' | 'invalid' | 'empty' | 'everything' | 'noise';

/**
 * A cheap check that a mask (probabilities) is a cut-out at all: not NaN, not (almost) nothing or
 * everything, and not mostly undecided, which is what a model that ran wrong tends to return.
 */
export function maskVerdict(mask: Float32Array): MaskVerdict {
  let fg = 0;
  let unsure = 0;
  for (const v of mask) {
    if (Number.isNaN(v)) return 'invalid';
    if (v > 0.5) fg++;
    if (v > 0.1 && v < 0.9) unsure++;
  }
  const n = mask.length;
  if (fg < n * 0.002) return 'empty';
  if (fg > n * 0.995) return 'everything';
  return unsure > n * 0.5 ? 'noise' : 'ok';
}

/** Mean over a (2r+1)² window, shrinking at the borders */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const pre = new Float64Array(Math.max(w, h) + 1);
  const pass = (from: Float32Array, to: Float32Array, n: number, lines: number, step: number, stride: number) => {
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + from[base + i * step];
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - r);
        const hi = Math.min(n, i + r + 1);
        to[base + i * step] = (pre[hi] - pre[lo]) / (hi - lo);
      }
    }
  };
  pass(src, tmp, w, h, 1, w);
  pass(tmp, out, h, w, w, 1);
  return out;
}

function luma(rgba: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  return out;
}

/**
 * Full-resolution alpha from a low-resolution mask. The guided filter's linear coefficients
 * (alpha ≈ a·gray + b) are fitted at work size, against a work-size copy of the photo, then
 * upsampled and applied to the full-size photo: edges follow the original pixels, not the
 * blurry upscaled mask. Where the photo has no contrast it falls back to the smooth mask.
 */
export function refineMatte(
  mask: Float32Array,
  mw: number,
  mh: number,
  work: ArrayLike<number>,
  ww: number,
  wh: number,
  full: ArrayLike<number>,
  w: number,
  h: number,
  { r = Math.max(2, Math.round(Math.max(ww, wh) / 256)), eps = 1e-3 } = {},
): Uint8Array<ArrayBuffer> {
  const n = ww * wh;
  const p = mw === ww && mh === wh ? mask : resizeBilinear(mask, mw, mh, ww, wh);
  const I = luma(work, n);
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    II[i] = I[i] * I[i];
    Ip[i] = I[i] * p[i];
  }
  const mI = boxMean(I, ww, wh, r);
  const mp = boxMean(p, ww, wh, r);
  const mII = boxMean(II, ww, wh, r);
  const mIp = boxMean(Ip, ww, wh, r);
  const a = II; // reuse buffers
  const b = Ip;
  for (let i = 0; i < n; i++) {
    a[i] = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const A = boxMean(a, ww, wh, r);
  const B = boxMean(b, ww, wh, r);

  // faint haze below 3% and near-solid above 97% snap to clean 0 / 255
  const LO = 0.03;
  const SPAN = 0.94;
  const X = axis(ww, w);
  const Y = axis(wh, h);
  const out = new Uint8Array(w * h);
  for (let y = 0, o = 0; y < h; y++) {
    const r0 = Y.i0[y] * ww;
    const r1 = Y.i1[y] * ww;
    const fy = Y.f[y];
    for (let x = 0; x < w; x++, o++) {
      const x0 = X.i0[x];
      const x1 = X.i1[x];
      const fx = X.f[x];
      const a0 = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * fx;
      const a1 = A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * fx;
      const b0 = B[r0 + x0] + (B[r0 + x1] - B[r0 + x0]) * fx;
      const b1 = B[r1 + x0] + (B[r1 + x1] - B[r1 + x0]) * fx;
      const j = o * 4;
      const g = (0.299 * full[j] + 0.587 * full[j + 1] + 0.114 * full[j + 2]) / 255;
      const q = ((a0 + (a1 - a0) * fy) * g + b0 + (b1 - b0) * fy - LO) / SPAN;
      out[o] = q <= 0 ? 0 : q >= 1 ? 255 : Math.round(q * 255);
    }
  }
  return out;
}

/** Bounding box of pixels whose value passes `threshold`; reads every `stride`-th value from `offset` */
export function alphaBounds(values: ArrayLike<number>, w: number, h: number, stride = 1, offset = 0, threshold = 16): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * stride + offset; x < w; x++, i += stride) {
      if (values[i] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      y0 = Math.min(y0, y);
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Grows a box by `pad` on every side, kept inside W × H, in whole pixels */
export function padBox(b: Box, pad: number, W: number, H: number): Box {
  const x = Math.max(0, Math.floor(b.x - pad));
  const y = Math.max(0, Math.floor(b.y - pad));
  return { x, y, w: Math.min(W, Math.ceil(b.x + b.w + pad)) - x, h: Math.min(H, Math.ceil(b.y + b.h + pad)) - y };
}

/** Brush dabs along one segment, every `spacing` px, excluding the start and including the end */
export function segmentStamps(x0: number, y0: number, x1: number, y1: number, spacing: number): number[] {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing));
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  return out;
}
