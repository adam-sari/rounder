import { mmToPx } from './specs';

export interface Paper {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  /** blank edge to leave for printers that can't print to the edge */
  marginMm: number;
}

export const PAPERS: Paper[] = [
  // photo labs print 4×6 borderless, so photos can run to the edge
  { id: '4x6', label: '4×6 in', widthMm: 101.6, heightMm: 152.4, marginMm: 0 },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, marginMm: 6 },
  { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4, marginMm: 6 },
];

/** space between photos for scissors, when the paper has room for it */
export const GAP_MM = 2;

export interface SheetLayout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  gap: number;
  /** top-left corner of each photo, px */
  slots: { x: number; y: number }[];
}

const fit = (space: number, size: number, gap: number) => (space < size ? 0 : Math.floor((space + gap) / (size + gap)));

/**
 * Tiles as many upright photos (w × h px) as fit on the paper at `dpi`, trying
 * both paper orientations, with and without a gap. On a tie it keeps the gap and
 * portrait paper; packing edge to edge only wins when it fits more photos.
 */
export function layoutSheet(paper: Paper, w: number, h: number, dpi = 300): SheetLayout {
  const short = mmToPx(paper.widthMm, dpi);
  const long = mmToPx(paper.heightMm, dpi);
  const margin = mmToPx(paper.marginMm, dpi);
  let best: SheetLayout | undefined;
  for (const [width, height] of [[short, long], [long, short]]) {
    for (const gap of [mmToPx(GAP_MM, dpi), 0]) {
      const cols = fit(width - 2 * margin, w, gap);
      const rows = fit(height - 2 * margin, h, gap);
      if (best && cols * rows <= best.cols * best.rows) continue;
      const x0 = Math.round((width - (cols * w + (cols - 1) * gap)) / 2);
      const y0 = Math.round((height - (rows * h + (rows - 1) * gap)) / 2);
      const slots = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * (w + gap), y: y0 + r * (h + gap) });
      best = { width, height, cols, rows, gap, slots };
    }
  }
  return best!;
}

/** x and y positions of every photo edge, for drawing cut lines */
export function cutLines(layout: SheetLayout, w: number, h: number) {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const { x, y } of layout.slots) {
    xs.add(x).add(x + w);
    ys.add(y).add(y + h);
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}
