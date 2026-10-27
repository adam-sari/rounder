import type Tesseract from 'tesseract.js';
import { unwrap } from '../pdf-text/format';

/** A recognized word, in the original image's pixels */
export interface OcrWord {
  text: string;
  /** 0–100 */
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** below this a word is shown as "check me" */
export const LOW_CONFIDENCE = 60;

// Tesseract puts a space between every Chinese/Japanese character; Korean really uses spaces
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef';
const CJK_GAP = new RegExp(`(?<=[${CJK}]) +(?=[${CJK}])`, 'gu');
export const tidyCjk = (s: string) => s.replace(CJK_GAP, '');

/**
 * The page's text with Tesseract's line breaks, and a blank line between paragraphs.
 * Falls back to the flat text when no layout was requested.
 */
export function pageText(page: Pick<Tesseract.Page, 'blocks' | 'text'>): string {
  if (!page.blocks) return tidyCjk(page.text.trim());
  return page.blocks
    .flatMap((b) => b.paragraphs)
    .map((p) =>
      p.lines
        .map((l) => tidyCjk(l.text.trim()))
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** One line per paragraph (mending words hyphenated at line ends), for pasting into documents */
export function joinLines(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => tidyCjk(unwrap(p.split('\n'))))
    .join('\n\n');
}

/** Every word with its box, scaled back from the OCR image to the original */
export function pageWords(page: Pick<Tesseract.Page, 'blocks'>, scale = 1): OcrWord[] {
  const words: OcrWord[] = [];
  for (const b of page.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words) {
          const text = w.text.trim();
          if (!text) continue;
          const { x0, y0, x1, y1 } = w.bbox;
          words.push({ text, confidence: Math.round(w.confidence), x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale });
        }
  return words;
}

/** Mean word confidence (0–100), or null without words */
export function meanConfidence(words: readonly OcrWord[]): number | null {
  if (!words.length) return null;
  return Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / words.length);
}

/**
 * How much to enlarge an image before OCR. Tesseract wants letters about 20–30 px tall, and
 * screenshots and phone crops are usually smaller than that, so small images are upscaled.
 * Huge images are scaled down to stay within memory.
 */
export function ocrScale(width: number, height: number, maxPixels = 16e6): number {
  const long = Math.max(width, height);
  const want = long < 1000 ? 3 : long < 2000 ? 2 : 1;
  return Math.min(want, Math.sqrt(maxPixels / (width * height)));
}

/**
 * RGBA pixels → binary PGM (8-bit grayscale), which Tesseract's image reader loads directly:
 * a few ms to build and 4× smaller than RGBA, where PNG would take a second to encode.
 * Transparent pixels are flattened onto white so dark text on a clear background survives.
 */
export function toPgm(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + width * height);
  out.set(header);
  for (let i = 0, o = header.length; i < width * height; i++, o++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    const luma = (r * 77 + g * 150 + b * 29) >> 8;
    out[o] = a === 255 ? luma : (luma * a + 255 * (255 - a) + 127) / 255;
  }
  return out;
}
