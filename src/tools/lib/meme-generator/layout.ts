/*
 * Text layout for the meme generator. Everything is worked out in full-resolution
 * pixels, so the small preview and the exported file wrap words identically.
 */

export type Align = 'left' | 'center' | 'right';
/** top/bottom hug the image edge (classic memes); free boxes sit wherever they were dragged */
export type Anchor = 'top' | 'bottom' | 'free';

export interface TextBox {
  text: string;
  anchor: Anchor;
  /** centre of the box as fractions of the image width and height (y is only used when free) */
  x: number;
  y: number;
  /** box width as a fraction of the image width */
  width: number;
  /** font size as a fraction of the image width */
  size: number;
  color: string;
  stroke: boolean;
  strokeColor: string;
  align: Align;
  upper: boolean;
}

/** width of `text` set at `px` pixels */
export type Measure = (text: string, px: number) => number;

export const LINE_HEIGHT = 1.1;
/** outline thickness as a share of the font size (half of it lands outside the letters) */
export const STROKE = 0.14;
/** gap between classic top/bottom text and the image edge, as a share of the shorter side */
export const EDGE = 0.03;
export const CAPTION_LINE_HEIGHT = 1.25;
/** caption bar padding as a share of the image width */
export const CAPTION_PAD = 0.045;

export interface BoxLayout {
  lines: string[];
  px: number;
  lineHeight: number;
  strokeWidth: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptionLayout {
  lines: string[];
  px: number;
  lineHeight: number;
  pad: number;
  height: number;
}

/** Splits a word that is wider than the line into pieces that fit */
function breakWord(word: string, maxWidth: number, width: (s: string) => number): string[] {
  if (width(word) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && width(piece + ch) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap that keeps the user's own line breaks */
export function wrapLines(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (const piece of breakWord(word, maxWidth, width)) {
        const next = line ? `${line} ${piece}` : piece;
        if (line && width(next) > maxWidth) {
          out.push(line);
          line = piece;
        } else line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutBox(box: TextBox, imgW: number, imgH: number, measure: Measure): BoxLayout {
  const text = box.upper ? box.text.toUpperCase() : box.text;
  const width = box.width * imgW;
  let px = box.size * imgW;

  // like classic generators, shrink until the longest word fits on one line (but not below half size)
  const longest = Math.max(0, ...text.split(/\s+/).map((w) => measure(w, px)));
  const room = width - (box.stroke ? px * STROKE : 0);
  if (longest > room) px = Math.max(px / 2, (px * width) / (longest + (box.stroke ? px * STROKE : 0)));

  const strokeWidth = box.stroke ? px * STROKE : 0;
  const lines = wrapLines(text, Math.max(1, width - strokeWidth), (s) => measure(s, px));
  const lineHeight = px * LINE_HEIGHT;
  const height = lines.length * lineHeight;
  const edge = EDGE * Math.min(imgW, imgH);
  const top = box.anchor === 'top' ? edge : box.anchor === 'bottom' ? imgH - edge - height : box.y * imgH - height / 2;
  return { lines, px, lineHeight, strokeWidth, left: box.x * imgW - width / 2, top, width, height };
}

/** The white bar above the image used by the modern "caption" meme format */
export function layoutCaption(text: string, size: number, imgW: number, measure: Measure): CaptionLayout {
  const px = size * imgW;
  const pad = CAPTION_PAD * imgW;
  const lines = wrapLines(text, imgW - pad * 2, (s) => measure(s, px));
  const lineHeight = px * CAPTION_LINE_HEIGHT;
  return { lines, px, lineHeight, pad, height: Math.round(pad * 2 + lines.length * lineHeight) };
}

/** x position to hand fillText for a line, given the canvas textAlign */
export function lineX(align: Align, left: number, width: number, inset: number) {
  return align === 'left' ? left + inset : align === 'right' ? left + width - inset : left + width / 2;
}
