import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, downsample, type Pixels } from './pixel';

/** a monospace character is about half as wide as it is tall */
export const CELL_ASPECT = 0.5;

export type Charset = 'standard' | 'detailed' | 'blocks' | 'braille' | 'custom';

/** ramps run from empty to densest */
export const RAMPS: Record<Exclude<Charset, 'braille' | 'custom'>, string> = {
  standard: ' .:-=+*#%@',
  // Paul Bourke's 70-level ramp
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
};

export const THEMES = {
  dark: { bg: '#131211', ink: '#f2ede4' },
  light: { bg: '#faf8f3', ink: '#131211' },
} as const;

export interface AsciiOptions {
  cols: number;
  charset: Charset;
  /** light-to-dense characters for the custom set */
  custom?: string;
  /** the text is tuned to read right on this background */
  background: 'dark' | 'light';
  invert?: boolean;
  /** −100…100 */
  brightness?: number;
  /** −100…100 */
  contrast?: number;
}

export interface AsciiArt {
  cols: number;
  rows: number;
  /** one entry per cell, row by row */
  chars: string[];
  /** rgb per cell, for colored output */
  colors: Uint8ClampedArray;
}

export function gridSize(width: number, height: number, cols: number) {
  return { cols, rows: Math.max(1, Math.round(cols * (height / width) * CELL_ASPECT)) };
}

/**
 * The largest cell width, up to `want`, whose rendering (cells 1 × 2, plus `padCells` all
 * round) stays inside canvas limits, with a little room for rounding.
 */
export function fitCell(cols: number, rows: number, want: number, padCells = 0) {
  const w = cols + padCells * 2;
  const h = rows * 2 + padCells * 2;
  return Math.min(want, (MAX_CANVAS_SIDE - 8) / Math.max(w, h), Math.sqrt((MAX_CANVAS_AREA * 0.98) / (w * h)));
}

/** custom sets are split by code point so emoji and other wide symbols survive */
export function rampFor(opts: Pick<AsciiOptions, 'charset' | 'custom'>): string[] {
  if (opts.charset === 'custom') {
    const chars = Array.from(opts.custom ?? '');
    return chars.length >= 2 ? chars : Array.from(RAMPS.standard);
  }
  return Array.from(RAMPS[opts.charset === 'braille' ? 'standard' : opts.charset]);
}

/** applies brightness / contrast to a 0–1 value */
function adjuster(opts: AsciiOptions) {
  const factor = ((100 + (opts.contrast ?? 0)) / 100) ** 2;
  const shift = (opts.brightness ?? 0) / 200;
  return (v: number) => Math.min(1, Math.max(0, (v - 0.5) * factor + 0.5 + shift));
}

/**
 * How much "ink" each pixel needs, 0–1. On a dark background bright areas get the
 * dense characters; on a light one dark areas do. Transparency shows the background.
 */
function inkMap(img: Pixels, opts: AsciiOptions): Float32Array {
  const adjust = adjuster(opts);
  const bg = opts.background === 'dark' ? 0 : 1;
  const flip = (opts.background === 'light') !== !!opts.invert;
  const out = new Float32Array(img.width * img.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const a = img.data[i + 3] / 255;
    const lum = (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
    const v = adjust(lum * a + bg * (1 - a));
    out[p] = flip ? 1 - v : v;
  }
  return out;
}

// braille dot bits, indexed [row][column] within the 2 × 4 cell
const BRAILLE = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

function brailleChars(img: Pixels, cols: number, rows: number, opts: AsciiOptions): string[] {
  const w = cols * 2;
  const h = rows * 4;
  const ink = inkMap(downsample(img, w, h), opts);
  // floyd–steinberg so a 1-bit dot grid still shows smooth tones
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const on = ink[p] >= 0.5 ? 1 : 0;
      const err = ink[p] - on;
      ink[p] = on;
      if (x + 1 < w) ink[p + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) ink[p + w - 1] += (err * 3) / 16;
        ink[p + w] += (err * 5) / 16;
        if (x + 1 < w) ink[p + w + 1] += err / 16;
      }
    }
  }
  const chars: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) if (ink[(r * 4 + dy) * w + c * 2 + dx]) bits |= BRAILLE[dy][dx];
      }
      // U+2800 (blank braille) rather than a space keeps lines from collapsing when pasted
      chars.push(String.fromCharCode(0x2800 + bits));
    }
  }
  return chars;
}

export function toAscii(img: Pixels, opts: AsciiOptions): AsciiArt {
  const { cols, rows } = gridSize(img.width, img.height, opts.cols);
  const cells = downsample(img, cols, rows);

  let chars: string[];
  if (opts.charset === 'braille') chars = brailleChars(img, cols, rows, opts);
  else {
    const ramp = rampFor(opts);
    chars = Array.from(inkMap(cells, opts), (v) => ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))]);
  }

  const adjust = adjuster(opts);
  const bg = opts.background === 'dark' ? 0 : 255;
  const colors = new Uint8ClampedArray(cols * rows * 3);
  for (let p = 0; p < cols * rows; p++) {
    const a = cells.data[p * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) colors[p * 3 + k] = adjust((cells.data[p * 4 + k] * a + bg * (1 - a)) / 255) * 255;
  }
  return { cols, rows, chars, colors };
}

export function lines(art: AsciiArt): string[] {
  return Array.from({ length: art.rows }, (_, r) => art.chars.slice(r * art.cols, (r + 1) * art.cols).join(''));
}

/** plain text with trailing spaces trimmed, ready to paste */
export const toText = (art: AsciiArt) => lines(art).map((l) => l.replace(/ +$/, '')).join('\n');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = (c: Uint8ClampedArray, p: number) => `#${[c[p * 3], c[p * 3 + 1], c[p * 3 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** A standalone HTML page; with color on, runs of same-colored characters share a span */
export function toHtml(art: AsciiArt, background: 'dark' | 'light', color: boolean): string {
  const theme = THEMES[background];
  let body = '';
  for (let r = 0; r < art.rows; r++) {
    let run = '';
    let runColor = '';
    for (let c = 0; c < art.cols; c++) {
      const p = r * art.cols + c;
      const col = color ? hex(art.colors, p) : '';
      if (col !== runColor && run) {
        body += runColor ? `<span style="color:${runColor}">${escapeHtml(run)}</span>` : escapeHtml(run);
        run = '';
      }
      runColor = col;
      run += art.chars[p];
    }
    body += (runColor ? `<span style="color:${runColor}">${escapeHtml(run)}</span>` : escapeHtml(run)) + '\n';
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ASCII art</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${theme.bg}">
<pre style="margin:0;padding:24px;color:${theme.ink};font:10px/1.2 ui-monospace,Menlo,Consolas,'DejaVu Sans Mono',monospace">${body}</pre>
</body></html>
`;
}
