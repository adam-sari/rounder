import ImageTracer from 'imagetracerjs';
import { quantize } from 'gifenc';
import { ERROR_TOLERANCE, PATH_OMIT, type TraceResult, type TraceSettings } from './settings';

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Rgb = [number, number, number];

interface TraceData {
  layers: { isholepath: boolean }[][];
  palette: { r: number; g: number; b: number; a: number }[];
}

// svgpathstring is public on the tracer but missing from its types
const tracer = ImageTracer as typeof ImageTracer & {
  svgpathstring(td: TraceData, layer: number, path: number, options: Record<string, unknown>): string;
};

export const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The tracer has no notion of partial transparency: each pixel is either in or out */
export function flattenAlpha({ data: d }: Pixels) {
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    else d[i + 3] = 255;
  }
}

/** Pure black and white, split at a luminance level */
export function threshold({ data: d }: Pixels, level: number) {
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    d[i] = d[i + 1] = d[i + 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < level ? 0 : 255;
  }
}

/** The most common color along the border, if it covers enough of it to be a background */
export function edgeColor({ width: w, height: h, data: d }: Pixels): Rgb | undefined {
  // coarse buckets so jpeg noise doesn't split one color into many
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  const visit = (p: number) => {
    total++;
    const i = p * 4;
    if (!d[i + 3]) return;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += d[i];
    b.g += d[i + 1];
    b.b += d[i + 2];
    buckets.set(key, b);
  };
  for (let x = 0; x < w; x++) visit(x), visit((h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) visit(y * w), visit(y * w + w - 1);
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best || best.n < total / 3) return undefined;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/**
 * Clears pixels close to `color` that connect to the border, so a white logo
 * on white paper keeps its inner white while the paper goes. Returns the count.
 */
export function removeBackground({ width: w, height: h, data: d }: Pixels, [r, g, b]: Rgb, tolerance = 56) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (d[i + 3] && Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) <= tolerance) stack[top++] = p;
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  let removed = 0;
  while (top) {
    const p = stack[--top];
    d.fill(0, p * 4, p * 4 + 4);
    removed++;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  return removed;
}

/** Starting palette for the tracer's own clustering; better than its grid sampling, which misses small details */
function palette({ data: d }: Pixels, s: TraceSettings) {
  const opaque = new Uint8Array(d.length);
  let n = 0;
  let transparent = false;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]) {
      opaque[n++] = d[i];
      opaque[n++] = d[i + 1];
      opaque[n++] = d[i + 2];
      opaque[n++] = 255;
    } else transparent = true;
  }
  if (!n) return [];
  const colors = s.mode === 'bw' ? [[0, 0, 0], [255, 255, 255]] : quantize(opaque.subarray(0, n), s.colors);
  const pal = colors.map(([r, g, b]) => ({ r, g, b, a: 255 }));
  if (transparent) pal.push({ r: 0, g: 0, b: 0, a: 0 });
  return pal;
}

/** One <g> per color with its paths; viewBox in traced pixels, size in original pixels */
export function buildSvg(layers: Map<string, string[]>, view: { width: number; height: number }, out: { width: number; height: number }) {
  const groups = [...layers].map(([color, paths]) => `<g fill="${color}" stroke="${color}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>\n`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${out.width}" height="${out.height}" viewBox="0 0 ${view.width} ${view.height}" stroke-width="1" stroke-linejoin="round">\n${groups.join('')}</svg>\n`;
}

/** Bitmap → SVG. Modifies `img` in place. */
export function traceImage(img: Pixels, s: TraceSettings, out: { width: number; height: number }): TraceResult {
  flattenAlpha(img);
  if (s.mode === 'bw') threshold(img, s.threshold);
  let removed: string | undefined;
  if (s.removeBg) {
    const bg = edgeColor(img);
    if (bg && removeBackground(img, bg)) removed = hex(bg);
  }

  const layers = new Map<string, string[]>();
  const pal = palette(img, s);
  if (pal.length) {
    const tolerance = ERROR_TOLERANCE[s.smoothing];
    const options: Record<string, unknown> = {
      ltres: tolerance,
      qtres: tolerance,
      pathomit: PATH_OMIT[s.detail],
      rightangleenhance: true,
      pal,
      numberofcolors: pal.length,
      // let the palette settle on the real colors; b&w stays exactly black and white
      colorquantcycles: s.mode === 'bw' ? 1 : 3,
      blurradius: s.blur,
      blurdelta: 32,
      strokewidth: 1,
      roundcoords: 1,
    };
    const td = ImageTracer.imagedataToTracedata(img as ImageData, options) as TraceData;
    td.layers.forEach((paths, l) => {
      const c = td.palette[l];
      if (c.a < 128) return;
      const color = hex([c.r, c.g, c.b]);
      const list = layers.get(color) ?? [];
      paths.forEach((p, i) => {
        if (p.isholepath) return;
        const d = tracer.svgpathstring(td, l, i, options).match(/ d="([^"]+)"/)?.[1].trim();
        if (d) list.push(d);
      });
      if (list.length) layers.set(color, list);
    });
  }

  return {
    svg: buildSvg(layers, img, out),
    paths: [...layers.values()].reduce((n, p) => n + p.length, 0),
    colors: layers.size,
    removed,
  };
}
