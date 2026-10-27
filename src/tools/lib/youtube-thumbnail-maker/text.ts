/*
 * Text for the thumbnail maker. Words wrapped in *asterisks* are "marked": they take the
 * accent color or get their own highlight box. Layout is in canvas pixels around the
 * layer's center, so the overlay boxes and the painted text always agree.
 */

export interface Run {
  text: string;
  mark: boolean;
}

/** One line of runs per line of input. An unpaired * is kept as a literal asterisk. */
export function parseMarkup(src: string): Run[][] {
  return src.split('\n').map((line) => {
    const parts = line.split('*');
    if (parts.length % 2 === 0) parts.splice(-2, 2, `${parts.at(-2)}*${parts.at(-1)}`);
    return parts.map((text, i) => ({ text, mark: i % 2 === 1 })).filter((r) => r.text);
  });
}

export type Highlight = 'none' | 'lines' | 'marked';
export type Align = 'left' | 'center' | 'right';

export interface TextStyle {
  /** font size in px */
  size: number;
  /** line height as a multiple of the size */
  lineHeight: number;
  /** outline thickness as a share of the size */
  outline: number;
  highlight: Highlight;
  upper: boolean;
  align: Align;
}

/** width of `text` at `px` pixels */
export type Measure = (text: string, px: number) => number;

export interface PlacedRun extends Run {
  x: number;
  width: number;
  /** the run without its leading and trailing spaces, for highlight boxes */
  inkX: number;
  inkWidth: number;
}

export interface PlacedLine {
  runs: PlacedRun[];
  x: number;
  width: number;
  /** alphabetic baseline */
  baseline: number;
  /** vertical middle of the capital letters */
  middle: number;
}

export interface Pill {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayout {
  lines: PlacedLine[];
  /** highlight boxes behind lines or marked words */
  pills: Pill[];
  radius: number;
  width: number;
  height: number;
}

/** highlight box padding as a share of the size */
export const PILL_X = 0.16;
export const PILL_Y = 0.14;

/**
 * capRatio is the height of a capital letter divided by the font size, so each line's
 * capitals sit in the middle of their line (display fonts all differ here).
 */
export function layoutText(text: string, style: TextStyle, measure: Measure, capRatio: number): TextLayout {
  const px = style.size;
  const source = style.upper ? text.toUpperCase() : text;
  const lh = px * style.lineHeight;
  const cap = px * capRatio;
  const rows = parseMarkup(source);
  const widths = rows.map((runs) => runs.reduce((w, r) => w + measure(r.text, px), 0));
  const maxW = Math.max(px * 0.3, ...widths);
  const top = -(rows.length * lh) / 2;

  const lines = rows.map((runs, i): PlacedLine => {
    const width = widths[i];
    const x = style.align === 'left' ? -maxW / 2 : style.align === 'right' ? maxW / 2 - width : -width / 2;
    const middle = top + (i + 0.5) * lh;
    let cursor = x;
    const placed = runs.map((r): PlacedRun => {
      const w = measure(r.text, px);
      const lead = r.text.length - r.text.trimStart().length;
      const inkX = cursor + (lead ? measure(r.text.slice(0, lead), px) : 0);
      const inkWidth = r.text.trim() ? measure(r.text.trim(), px) : 0;
      const run = { ...r, x: cursor, width: w, inkX, inkWidth };
      cursor += w;
      return run;
    });
    return { runs: placed, x, width, baseline: middle + cap / 2, middle };
  });

  const padX = px * PILL_X;
  const pillH = cap + px * PILL_Y * 2;
  const pills: Pill[] = [];
  for (const line of lines) {
    const y = line.middle - pillH / 2;
    if (style.highlight === 'lines' && line.width > 0) {
      const ink = line.runs.filter((r) => r.inkWidth > 0);
      if (!ink.length) continue;
      const left = ink[0].inkX;
      const right = ink.at(-1)!.inkX + ink.at(-1)!.inkWidth;
      pills.push({ x: left - padX, y, width: right - left + padX * 2, height: pillH });
    } else if (style.highlight === 'marked') {
      for (const r of line.runs) if (r.mark && r.inkWidth > 0) pills.push({ x: r.inkX - padX, y, width: r.inkWidth + padX * 2, height: pillH });
    }
  }

  // the hit box: the text itself plus whatever an outline or highlight adds around it
  const outlinePad = style.outline * px;
  const padW = Math.max(outlinePad, style.highlight === 'none' ? 0 : padX);
  const padH = Math.max(outlinePad, style.highlight === 'none' ? 0 : Math.max(0, pillH - lh) / 2);
  return {
    lines,
    pills,
    radius: px * 0.12,
    width: maxW + padW * 2,
    height: rows.length * lh + padH * 2,
  };
}

/** "This changed *everything*" → "this-changed-everything-thumbnail.jpg" */
export function fileNameFor(text: string | undefined, ext: string) {
  const slug = (text ?? '')
    .replace(/\*/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${slug ? `${slug}-` : ''}thumbnail.${ext}`;
}
