/** RGBA pixels, the shape of ImageData (which workers can't always construct) */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** per-channel difference below which pixels count as the same (anti-aliasing, color rounding) */
export const TOLERANCE = 40;

function delta(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) {
  return Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
}

function sameSize(a: Raster, b: Raster) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Both pages must be rendered at the same size.');
}

/** How many pixels differ between two renders of the same size */
export function countChanged(a: Raster, b: Raster, tolerance = TOLERANCE) {
  sameSize(a, b);
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) if (delta(a.data, b.data, i) > tolerance) changed++;
  return changed;
}

/**
 * A page counts as visibly changed above a few stray pixels. Kept low on purpose:
 * on a ~180k px scan of an A4 page, one edited digit moves only about 10 pixels.
 */
export function visibleShare(changed: number, total: number) {
  return changed >= Math.max(4, total * 0.00002) ? changed / total : 0;
}

/** "<0.1%", "2.4%", "38%" */
export function formatShare(share: number) {
  if (share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

const RED = [226, 59, 48];
const BLUE = [36, 104, 242];
const SUN = [255, 210, 94];

/**
 * A difference picture: the new page as a faint ghost, ink only in the old
 * page in red, ink only in the new page in blue, and a soft yellow tint on
 * every `cell`×`cell` block that has a change, so small edits are easy to find.
 */
export function highlightDiff(a: Raster, b: Raster, { tolerance = TOLERANCE, cell = 24 } = {}): Raster & { changed: number } {
  sameSize(a, b);
  const { width, height } = a;
  const cols = Math.ceil(width / cell);
  const hot = new Uint8Array(cols * Math.ceil(height / cell));
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (delta(a.data, b.data, (y * width + x) * 4) > tolerance) {
        changed++;
        hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const la = lum(a.data, i);
      const lb = lum(b.data, i);
      // ghost of the new page: ink at about a fifth of its strength
      let r = 255 - (255 - lb) * 0.22;
      let g = r;
      let bl = r;
      if (hot[Math.floor(y / cell) * cols + Math.floor(x / cell)]) {
        r += (SUN[0] - r) * 0.22;
        g += (SUN[1] - g) * 0.22;
        bl += (SUN[2] - bl) * 0.22;
      }
      const d = delta(a.data, b.data, i);
      if (d > tolerance) {
        // darker in the old page = removed ink; darker in the new one (or recolored) = added
        const c = la < lb ? RED : BLUE;
        const k = 0.45 + 0.55 * Math.min(1, d / 160);
        r += (c[0] - r) * k;
        g += (c[1] - g) * k;
        bl += (c[2] - bl) * k;
      }
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = bl;
      out[i + 3] = 255;
    }
  }
  return { data: out, width, height, changed };
}
