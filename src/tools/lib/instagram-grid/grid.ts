/*
 * Geometry and pixel helpers for splitting one image into Instagram tiles.
 * Everything here is pure so it can be unit tested without a DOM.
 */

export type Layout = 'grid' | 'carousel';
export type Shape = '3:4' | '4:5' | '1:1';
export type Fit = 'fill' | 'fit';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const ratio: Record<Shape, number> = { '3:4': 4 / 3, '4:5': 5 / 4, '1:1': 1 };

/** Instagram's profile grid is always three columns wide */
export function gridSize(layout: Layout, count: number, shape: Shape, tileWidth: number) {
  const cols = layout === 'grid' ? 3 : count;
  const rows = layout === 'grid' ? count : 1;
  const tw = tileWidth;
  const th = Math.round(tileWidth * ratio[shape]);
  return { cols, rows, tw, th, width: cols * tw, height: rows * th };
}

/**
 * Where the image sits inside the W × H grid, in output pixels. px/py (0–1) slide
 * the image across whatever room there is: 0 = left/top edge, 0.5 = centred.
 */
export function placeImage(sw: number, sh: number, W: number, H: number, fit: Fit, zoom: number, px: number, py: number) {
  const s = (fit === 'fill' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)) * zoom;
  const iw = sw * s;
  const ih = sh * s;
  return { s, iw, ih, ox: (W - iw) * px, oy: (H - ih) * py };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Moves the image by dx/dy output pixels, returning the new px/py */
export function panBy(place: { iw: number; ih: number }, W: number, H: number, px: number, py: number, dx: number, dy: number) {
  const roomX = W - place.iw;
  const roomY = H - place.ih;
  return {
    px: Math.abs(roomX) < 0.5 ? px : clamp01(px + dx / roomX),
    py: Math.abs(roomY) < 0.5 ? py : clamp01(py + dy / roomY),
  };
}

/** The part of the source that lands inside the grid, and where it lands (whole pixels) */
export function visibleRegion(sw: number, sh: number, W: number, H: number, place: ReturnType<typeof placeImage>) {
  const { s, ox, oy } = place;
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(W, ox + sw * s);
  const y1 = Math.min(H, oy + sh * s);
  const dst = { x: Math.round(x0), y: Math.round(y0), width: Math.max(1, Math.round(x1) - Math.round(x0)), height: Math.max(1, Math.round(y1) - Math.round(y0)) };
  const sx = Math.max(0, Math.floor((x0 - ox) / s));
  const sy = Math.max(0, Math.floor((y0 - oy) / s));
  const src = {
    x: sx,
    y: sy,
    width: Math.max(1, Math.min(sw, Math.ceil((x1 - ox) / s)) - sx),
    height: Math.max(1, Math.min(sh, Math.ceil((y1 - oy) / s)) - sy),
  };
  return { src, dst };
}

/**
 * Upload order for the tile at row-major index i. New posts appear top-left on a
 * profile, so the bottom-right tile goes up first; carousels run left to right.
 */
export function postingOrder(i: number, total: number, layout: Layout) {
  return layout === 'grid' ? total - i : i + 1;
}

/** "01-post-first.jpg", "02.jpg" … "09-post-last.jpg" */
export function tileName(order: number, total: number, layout: Layout, ext: string) {
  const n = String(order).padStart(2, '0');
  const word = layout === 'grid' ? 'post' : 'slide';
  const tag = order === 1 ? `-${word}-first` : order === total ? `-${word}-last` : '';
  return `${n}${tag}.${ext}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Copies a rectangle out of an RGBA buffer */
export function cropPixels(img: Pixels, r: Rect): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    const start = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(start, start + r.width * 4), y * r.width * 4);
  }
  return out;
}

/**
 * Builds one opaque tile: the background color, with the (already resized) image
 * drawn at (at.x, at.y) in grid space and blended over it. Instagram has no
 * transparency, so flattening here keeps the files identical to the preview.
 */
export function extractTile(img: Pixels, at: { x: number; y: number }, tile: Rect, bg: [number, number, number]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg[0];
    out[i + 1] = bg[1];
    out[i + 2] = bg[2];
    out[i + 3] = 255;
  }
  // overlap of the tile and the image, in grid space
  const x0 = Math.max(tile.x, at.x);
  const y0 = Math.max(tile.y, at.y);
  const x1 = Math.min(tile.x + tile.width, at.x + img.width);
  const y1 = Math.min(tile.y + tile.height, at.y + img.height);
  for (let y = y0; y < y1; y++) {
    let s = ((y - at.y) * img.width + (x0 - at.x)) * 4;
    let d = ((y - tile.y) * tile.width + (x0 - tile.x)) * 4;
    for (let x = x0; x < x1; x++, s += 4, d += 4) {
      const a = img.data[s + 3];
      if (a === 255) {
        out[d] = img.data[s];
        out[d + 1] = img.data[s + 1];
        out[d + 2] = img.data[s + 2];
      } else if (a) {
        const k = a / 255;
        out[d] = img.data[s] * k + bg[0] * (1 - k);
        out[d + 1] = img.data[s + 1] * k + bg[1] * (1 - k);
        out[d + 2] = img.data[s + 2] * k + bg[2] * (1 - k);
      }
    }
  }
  return out;
}
