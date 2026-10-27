/*
 * Depth → color. Inferno and viridis use Matt Zucker's CC0 polynomial fits of the matplotlib
 * maps; turbo uses Google's polynomial approximation (Apache-2.0). All are baked into 256-entry
 * lookup tables once.
 */

export type Colormap = 'gray' | 'inferno' | 'viridis' | 'turbo';

export const COLORMAPS: [Colormap, string][] = [
  ['gray', 'grayscale'],
  ['inferno', 'inferno'],
  ['viridis', 'viridis'],
  ['turbo', 'turbo'],
];

/** per channel, polynomial coefficients from x⁰ upwards */
const POLY: Record<Exclude<Colormap, 'gray'>, [number[], number[], number[]]> = {
  inferno: [
    [0.0002189403691192265, 0.1065134194856116, 11.60249308247187, -41.70399613139459, 77.162935699427, -71.31942824499214, 25.13112622477341],
    [0.001651004631001012, 0.5639564367884091, -3.972853965665698, 17.43639888205313, -33.40235894210092, 32.62606426397723, -12.24266895238567],
    [-0.01948089843709184, 3.932712388889277, -15.9423941062914, 44.35414519872813, -81.80730925738993, 73.20951985803202, -23.07032500287172],
  ],
  viridis: [
    [0.2777273272234177, 0.1050930431085774, -0.3308618287255563, -4.634230498983486, 6.228269936347081, 4.776384997670288, -5.435455855934631],
    [0.005407344544966578, 1.404613529898575, 0.214847559468213, -5.799100973351585, 14.17993336680509, -13.74514537774601, 4.645852612178535],
    [0.3340998053353061, 1.384590162594685, 0.09509516302823659, -19.33244095627987, 56.69055260068105, -65.35303263337234, 26.3124352495832],
  ],
  turbo: [
    [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
    [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
    [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973],
  ],
};

const horner = (c: number[], x: number) => c.reduceRight((acc, k) => acc * x + k, 0);
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

const tables = new Map<Colormap, Uint8Array>();

/** 256 RGB triplets */
export function lut(map: Colormap): Uint8Array {
  let t = tables.get(map);
  if (t) return t;
  t = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const rgb = map === 'gray' ? [x, x, x] : POLY[map].map((c) => horner(c, x));
    for (let ch = 0; ch < 3; ch++) t[i * 3 + ch] = byte(rgb[ch]);
  }
  tables.set(map, t);
  return t;
}

/** One depth byte per pixel (255 = nearest) → opaque RGBA; `invert` makes near dark instead */
export function colorize(depth: Uint8Array | Uint8ClampedArray, map: Colormap, invert = false): Uint8ClampedArray<ArrayBuffer> {
  const t = lut(map);
  const out = new Uint8ClampedArray(depth.length * 4);
  for (let i = 0; i < depth.length; i++) {
    const k = (invert ? 255 - depth[i] : depth[i]) * 3;
    out[i * 4] = t[k];
    out[i * 4 + 1] = t[k + 1];
    out[i * 4 + 2] = t[k + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Grows near areas by `r` pixels (a max filter), so the fringe of a foreground object moves with
 * it in the 3D view instead of smearing into the background.
 */
export function dilate(depth: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r < 1) return depth;
  const pass = (src: Uint8Array, along: number, across: number, stride: number, step: number) => {
    const out = new Uint8Array(src.length);
    for (let a = 0; a < across; a++) {
      const base = a * stride;
      for (let i = 0; i < along; i++) {
        let m = 0;
        for (let j = Math.max(0, i - r), end = Math.min(along - 1, i + r); j <= end; j++) m = Math.max(m, src[base + j * step]);
        out[base + i * step] = m;
      }
    }
    return out;
  };
  return pass(pass(depth, width, height, width, 1), height, width, 1, width);
}
