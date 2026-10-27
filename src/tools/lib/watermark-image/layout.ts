/** 3×3 anchor: row (top, middle, bottom) then column (left, center, right) */
export type Position = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

export interface Point {
  x: number;
  y: number;
}

/** size of the upright box a w × h rectangle needs once rotated by `angle` radians */
export function rotatedBox(w: number, h: number, angle: number) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { width: w * c + h * s, height: w * s + h * c };
}

/**
 * Places a single w × h mark at an anchor, keeping its rotated box inside the
 * margins. Marks too big for the image (long text on a tall photo) are shrunk to fit.
 */
export function placeMark(W: number, H: number, w: number, h: number, angle: number, position: Position, margin: number) {
  const box = rotatedBox(w, h, angle);
  const k = Math.min(1, Math.max(0, W - 2 * margin) / box.width, Math.max(0, H - 2 * margin) / box.height);
  const bw = box.width * k;
  const bh = box.height * k;
  const col = 'lcr'.indexOf(position[1]);
  const row = 'tmb'.indexOf(position[0]);
  return {
    width: w * k,
    height: h * k,
    x: [margin + bw / 2, W / 2, W - margin - bw / 2][col],
    y: [margin + bh / 2, H / 2, H - margin - bh / 2][row],
  };
}

/** upper bound on how many marks a tiled pattern draws (roughly; partial edge marks add a few) */
export const MAX_TILES = 1000;

/**
 * Centres for a repeating pattern of w × h marks laid out in staggered rows,
 * rotated by `angle` around the image centre. Only marks that touch the image are kept.
 */
export function tileCenters(W: number, H: number, w: number, h: number, angle: number, gap: number): Point[] {
  // always leave some air so neighbouring marks never run into each other
  const stepX = Math.max(1, w + Math.max(gap, h));
  // long thin text with no spacing would mean tens of thousands of draws; spread the rows to cap the count
  const stepY = Math.max(1, h + Math.max(gap, h), (W * H) / MAX_TILES / stepX);
  const reach = Math.hypot(W, H) / 2 + Math.max(w, h);
  const rows = Math.ceil(reach / stepY);
  const cols = Math.ceil(reach / stepX) + 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const box = rotatedBox(w, h, angle);
  const out: Point[] = [];
  for (let r = -rows; r <= rows; r++) {
    for (let c = -cols; c <= cols; c++) {
      const lx = c * stepX + (r & 1 ? stepX / 2 : 0);
      const ly = r * stepY;
      const x = W / 2 + lx * cos - ly * sin;
      const y = H / 2 + lx * sin + ly * cos;
      if (x + box.width / 2 < 0 || x - box.width / 2 > W || y + box.height / 2 < 0 || y - box.height / 2 > H) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** true for colors dark enough to want a light shadow behind them */
export function isDark(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 100;
}

/**
 * Gives an SVG logo an explicit width and height (from its viewBox) so every browser
 * can draw it on a canvas, and reports its aspect ratio. Null if the size can't be told.
 */
export function sizeSvg(svg: string): { svg: string; aspect: number } | null {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (name: string) => Number(tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i'))?.[1]);
  const w = attr('width');
  const h = attr('height');
  if (w > 0 && h > 0) return { svg, aspect: w / h };
  const vb = tag.match(/\sviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i);
  const vw = Number(vb?.[1]);
  const vh = Number(vb?.[2]);
  if (!(vw > 0 && vh > 0)) return null;
  const aspect = vw / vh;
  const width = Math.round(aspect >= 1 ? 1024 : 1024 * aspect);
  const height = Math.round(aspect >= 1 ? 1024 / aspect : 1024);
  const sized = tag.replace(/\s(?:width|height)\s*=\s*(["']).*?\1/gi, '').replace(/^<svg/i, `<svg width="${width}" height="${height}"`);
  return { svg: svg.replace(tag, () => sized), aspect };
}
