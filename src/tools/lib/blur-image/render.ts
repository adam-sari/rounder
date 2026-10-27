import { boxBlur, effectParams, type Box, type Effect, type Shape } from './regions';

export interface Paint extends Box {
  shape: Shape;
  effect: Effect;
}

/** blur radius worked at; stronger blurs run on a scaled-down copy, which looks the same and keeps canvases small */
const MAX_SIGMA = 8;

function surface(w: number, h: number, readBack = false) {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  return [canvas, canvas.getContext('2d', { willReadFrequently: readBack })!] as const;
}

/** iOS counts canvas memory until garbage collection, so give it back right away */
function free(...canvases: (HTMLCanvasElement | undefined)[]) {
  for (const c of canvases) if (c) c.width = c.height = 0;
}

let filterSupport: boolean | undefined;

/** Safari before 18 ignores ctx.filter without complaint, so test that a blur actually spreads */
function canvasFilterWorks() {
  if (filterSupport === undefined) {
    const [dot, dctx] = surface(5, 1);
    dctx.fillStyle = '#fff';
    dctx.fillRect(2, 0, 1, 1);
    const [probe, ctx] = surface(5, 1, true);
    ctx.filter = 'blur(1px)';
    ctx.drawImage(dot, 0, 0);
    filterSupport = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
    free(dot, probe);
  }
  return filterSupport;
}

/**
 * Gaussian blur of the area around (x, y, w, h), taking in m pixels on each side so
 * the region blends with its surroundings. Where the image ends, its edge pixels are
 * repeated instead of letting transparent emptiness darken the border.
 */
function blurred(img: ImageData, x: number, y: number, w: number, h: number, sigma: number) {
  const m = Math.ceil(sigma * 3);
  const ex0 = Math.max(0, x - m);
  const ey0 = Math.max(0, y - m);
  const ex1 = Math.min(img.width, x + w + m);
  const ey1 = Math.min(img.height, y + h + m);
  const [src, sctx] = surface(ex1 - ex0, ey1 - ey0);
  sctx.putImageData(img, -ex0, -ey0, ex0, ey0, ex1 - ex0, ey1 - ey0);

  // the padded area, scaled down by k so the blur itself stays within MAX_SIGMA
  const k = Math.max(1, sigma / MAX_SIGMA);
  const L = Math.round((ex0 - (x - m)) / k);
  const T = Math.round((ey0 - (y - m)) / k);
  const R = Math.round((x + w + m - ex1) / k);
  const B = Math.round((y + h + m - ey1) / k);
  const iw = Math.max(1, Math.round((ex1 - ex0) / k));
  const ih = Math.max(1, Math.round((ey1 - ey0) / k));
  const PW = L + iw + R;
  const PH = T + ih + B;
  const [pad, pctx] = surface(PW, PH, true);
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(src, L, T, iw, ih);
  free(src);

  pctx.imageSmoothingEnabled = false;
  if (L) pctx.drawImage(pad, L, T, 1, ih, 0, T, L, ih);
  if (R) pctx.drawImage(pad, PW - R - 1, T, 1, ih, PW - R, T, R, ih);
  if (T) pctx.drawImage(pad, 0, T, PW, 1, 0, 0, PW, T);
  if (B) pctx.drawImage(pad, 0, PH - B - 1, PW, 1, 0, PH - B, PW, B);

  let soft = pad;
  if (canvasFilterWorks()) {
    const [b, bctx] = surface(PW, PH);
    bctx.filter = `blur(${sigma / k}px)`;
    bctx.drawImage(pad, 0, 0);
    free(pad);
    soft = b;
  } else {
    const data = pctx.getImageData(0, 0, PW, PH);
    boxBlur(data.data, PW, PH, sigma / k);
    pctx.putImageData(data, 0, 0);
  }

  const [out, octx] = surface(w, h);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(soft, -m, -m, w + 2 * m, h + 2 * m);
  free(soft);
  return out;
}

/** Applies one region's effect to img in place, through the region's shape */
function paint(img: ImageData, r: Paint, strength: number) {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(img.width, Math.ceil(r.x + r.w)) - x;
  const h = Math.min(img.height, Math.ceil(r.y + r.h)) - y;
  if (w < 1 || h < 1) return;
  const { sigma, cols, rows } = effectParams(r, strength);

  const [base, ctx] = surface(w, h, true);
  ctx.putImageData(img, -x, -y, x, y, w, h);

  let layer: HTMLCanvasElement | undefined;
  if (r.effect === 'blur') layer = blurred(img, x, y, w, h, sigma);
  else if (r.effect === 'pixelate') {
    const [tiny, tctx] = surface(cols, rows);
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(base, 0, 0, w, h, 0, 0, cols, rows);
    const [big, bctx] = surface(w, h);
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(tiny, 0, 0, w, h);
    free(tiny);
    layer = big;
  }

  if (r.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2 - x, r.y + r.h / 2 - y, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  if (layer) ctx.drawImage(layer, 0, 0);
  else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  const done = ctx.getImageData(0, 0, w, h).data;
  free(base, layer);
  for (let row = 0; row < h; row++) {
    img.data.set(done.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * img.width + x) * 4);
  }
}

/** A copy of src with every region painted over, in order. Used for both the preview and the export. */
export function applyRegions(src: ImageData, regions: Paint[], strength: number) {
  const img = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  for (const r of regions) paint(img, r, strength);
  return img;
}
