/*
 * Objects placed on top of PDF pages. Every coordinate is in PDF points, in the
 * page's displayed orientation (its /Rotate applied), measured from the top-left
 * corner of the visible page box, so what you see is what gets drawn.
 */

export type FontFamily = 'sans' | 'serif' | 'mono';
export type MarkKind = 'check' | 'cross';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
  /** 0-based page index */
  page: number;
}

export interface TextObj extends Base, Box {
  kind: 'text';
  text: string;
  /** points */
  size: number;
  font: FontFamily;
  bold: boolean;
  color: string;
}

export interface ImageObj extends Base, Box {
  kind: 'image';
  asset: string;
  opacity: number;
  role?: 'signature' | 'initials';
}

export interface ShapeObj extends Base, Box {
  kind: 'rect' | 'ellipse';
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

export interface HighlightObj extends Base, Box {
  kind: 'highlight';
  color: string;
}

export interface MarkObj extends Base, Box {
  kind: 'mark';
  mark: MarkKind;
  color: string;
}

export interface LineObj extends Base {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  arrow: boolean;
}

export interface InkObj extends Base, Box {
  kind: 'ink';
  /** flat x,y pairs, 0–1 within the box, so resizing the box scales the drawing */
  points: number[];
  color: string;
  width: number;
}

export type OverlayObject = TextObj | ImageObj | ShapeObj | HighlightObj | MarkObj | LineObj | InkObj;
export type BoxObject = Exclude<OverlayObject, LineObj>;

/** What the save step needs to know about each page, read from pdf.js */
export interface PageInfo {
  /** displayed size in points */
  w: number;
  h: number;
  /** the visible page box in PDF user space: [x1, y1, x2, y2] */
  view: number[];
  /** the page's own /Rotate: 0 | 90 | 180 | 270 */
  rotate: number;
}

/** An image ready to embed: PNG or JPEG bytes, plus an object URL for the screen */
export interface Asset {
  url: string;
  bytes: Uint8Array;
  type: 'png' | 'jpg';
  /** pixels */
  width: number;
  height: number;
}

export const INK = '#111111';
export const SIGN_BLUE = '#1d3f9e';

export const swatches = [INK, SIGN_BLUE, '#d62828', '#1f8a3b', '#6b7280', '#ffffff'];
export const highlightColors = ['#ffe066', '#8ce99a', '#ffa8c5', '#74c0fc'];

/** highlights are drawn with a multiply blend so the text underneath stays crisp */
export const HIGHLIGHT_OPACITY = 0.45;

export const fontLabels: Record<FontFamily, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };

/** CSS stacks metric-compatible with the PDF standard fonts (Helvetica, Times, Courier) */
export const cssFonts: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
  mono: '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", monospace',
};

export function hasBox(o: OverlayObject): o is BoxObject {
  return o.kind !== 'line';
}

/** the box around any object, for selection frames and snapping */
export function boundsOf(o: OverlayObject): Box {
  if (o.kind !== 'line') return { x: o.x, y: o.y, w: o.w, h: o.h };
  const x = Math.min(o.x1, o.x2);
  const y = Math.min(o.y1, o.y2);
  return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
}

/** a short spoken name, for screen readers */
export function describe(o: OverlayObject): string {
  switch (o.kind) {
    case 'text':
      return `Text: ${o.text.split('\n')[0].slice(0, 40) || 'empty'}`;
    case 'image':
      return o.role === 'signature' ? 'Signature' : o.role === 'initials' ? 'Initials' : 'Image';
    case 'rect':
      return o.fill === '#ffffff' && !o.stroke ? 'Whiteout box' : 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'highlight':
      return 'Highlight';
    case 'mark':
      return o.mark === 'check' ? 'Check mark' : 'Cross';
    case 'line':
      return o.arrow ? 'Arrow' : 'Line';
    case 'ink':
      return 'Drawing';
  }
}

export type DateFormat = 'mdy' | 'dmy' | 'dot' | 'iso' | 'long';
export const dateFormats: DateFormat[] = ['mdy', 'dmy', 'dot', 'iso', 'long'];

export function formatDate(d: Date, f: DateFormat) {
  const p = (n: number) => String(n).padStart(2, '0');
  const [y, m, day] = [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())];
  if (f === 'mdy') return `${m}/${day}/${y}`;
  if (f === 'dmy') return `${day}/${m}/${y}`;
  if (f === 'dot') return `${day}.${m}.${y}`;
  if (f === 'iso') return `${y}-${m}-${day}`;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
