/*
 * Collage geometry. Layouts are drawn on a small grid of cols × rows units, so
 * gutters stay even however the cells are split up. Nothing here touches the DOM.
 */

export interface Layout {
  id: string;
  label: string;
  cols: number;
  rows: number;
  /** [x, y, w, h] in grid units */
  cells: [number, number, number, number][];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** how a photo sits in its cell: zoom 1 = cover-fit, fx/fy 0–1 = where the crop window sits */
export interface View {
  zoom: number;
  fx: number;
  fy: number;
}

export const DEFAULT_VIEW: View = { zoom: 1, fx: 0.5, fy: 0.5 };
export const MAX_ZOOM = 4;
export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 9;

const L = (id: string, label: string, cols: number, rows: number, cells: Layout['cells']): Layout => ({ id, label, cols, rows, cells });

export const layouts: Layout[] = [
  L('2-cols', 'Side by side', 2, 1, [[0, 0, 1, 1], [1, 0, 1, 1]]),
  L('2-rows', 'Stacked', 1, 2, [[0, 0, 1, 1], [0, 1, 1, 1]]),
  L('2-wide', 'Wide and narrow', 3, 1, [[0, 0, 2, 1], [2, 0, 1, 1]]),
  L('2-tall', 'Tall and short', 1, 3, [[0, 0, 1, 2], [0, 2, 1, 1]]),

  L('3-left', 'One big left, two right', 2, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]]),
  L('3-top', 'One big top, two below', 2, 2, [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]]),
  L('3-right', 'Two left, one big right', 3, 2, [[0, 0, 1, 1], [0, 1, 1, 1], [1, 0, 2, 2]]),
  L('3-cols', 'Three columns', 3, 1, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]]),
  L('3-rows', 'Three rows', 1, 3, [[0, 0, 1, 1], [0, 1, 1, 1], [0, 2, 1, 1]]),

  L('4-grid', 'Grid of four', 2, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]]),
  L('4-top', 'One big top, three below', 3, 3, [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]),
  L('4-left', 'One big left, three right', 3, 3, [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]]),
  L('4-brick', 'Staggered', 2, 3, [[0, 0, 1, 2], [1, 0, 1, 1], [0, 2, 1, 1], [1, 1, 1, 2]]),

  L('5-2-3', 'Two over three', 6, 2, [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]]),
  L('5-3-2', 'Three over two', 6, 2, [[0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 2, 1], [0, 1, 3, 1], [3, 1, 3, 1]]),
  L('5-left', 'One big, four small', 4, 2, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]]),
  L('5-pinwheel', 'Pinwheel', 3, 3, [[0, 0, 2, 1], [2, 0, 1, 2], [1, 1, 1, 1], [0, 1, 1, 2], [1, 2, 2, 1]]),

  L('6-3x2', 'Three by two', 3, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]]),
  L('6-2x3', 'Two by three', 2, 3, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1]]),
  L('6-big', 'One big, five small', 3, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]),

  L('7-3-4', 'Three over four', 12, 2, [[0, 0, 4, 1], [4, 0, 4, 1], [8, 0, 4, 1], [0, 1, 3, 1], [3, 1, 3, 1], [6, 1, 3, 1], [9, 1, 3, 1]]),
  L('7-big', 'One big, six small', 4, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 2, 1], [2, 2, 2, 1]]),

  L('8-4x2', 'Four by two', 4, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [3, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]]),
  L('8-2x4', 'Two by four', 2, 4, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 1, 1], [1, 3, 1, 1]]),
  L('8-3-2-3', 'Three, two, three', 6, 3, [[0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 2, 1], [0, 1, 3, 1], [3, 1, 3, 1], [0, 2, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1]]),

  L('9-grid', 'Grid of nine', 3, 3, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]),
  L('9-big', 'One big, eight small', 4, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], [3, 2, 1, 1]]),
];

export const layoutsFor = (count: number) => layouts.filter((l) => l.cells.length === count);

export const aspects = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
  { id: '9:16', w: 9, h: 16 },
  { id: '16:9', w: 16, h: 9 },
  { id: '3:2', w: 3, h: 2 },
] as const;

/** canvas size for an aspect ratio and a long side in px */
export function canvasSize(aw: number, ah: number, longSide: number) {
  return aw >= ah ? { w: longSide, h: Math.round((longSide * ah) / aw) } : { w: Math.round((longSide * aw) / ah), h: longSide };
}

/**
 * Pixel boxes for each cell. Every gutter (between cells and around the edge) comes
 * out the same width: each grid unit is stretched by one gap and the gap is taken
 * back off the far edge of the cell.
 */
export function cellBoxes(layout: Layout, w: number, h: number, gap: number, pad: number): Box[] {
  const iw = w - 2 * pad + gap;
  const ih = h - 2 * pad + gap;
  return layout.cells.map(([x, y, cw, ch]) => {
    const x0 = Math.round(pad + (x / layout.cols) * iw);
    const y0 = Math.round(pad + (y / layout.rows) * ih);
    const x1 = Math.round(pad + ((x + cw) / layout.cols) * iw - gap);
    const y1 = Math.round(pad + ((y + ch) / layout.rows) * ih - gap);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  });
}

/** the part of an image (in its own pixels) shown in a cell of cw × ch */
export function coverCrop(iw: number, ih: number, cw: number, ch: number, view: View) {
  const scale = Math.max(cw / iw, ch / ih) * view.zoom;
  const sw = Math.min(iw, cw / scale);
  const sh = Math.min(ih, ch / scale);
  return { sx: (iw - sw) * view.fx, sy: (ih - sh) * view.fy, sw, sh };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** moves the crop window so the photo follows a drag of dx, dy cell pixels */
export function panView(view: View, iw: number, ih: number, cw: number, ch: number, dx: number, dy: number): View {
  const { sw, sh } = coverCrop(iw, ih, cw, ch, view);
  const scale = cw / sw;
  const slackX = iw - sw;
  const slackY = ih - sh;
  return {
    zoom: view.zoom,
    fx: slackX > 0.5 ? clamp01(view.fx - dx / scale / slackX) : view.fx,
    fy: slackY > 0.5 ? clamp01(view.fy - dy / scale / slackY) : view.fy,
  };
}
