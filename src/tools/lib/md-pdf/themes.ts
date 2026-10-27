import type { PageSizeName } from '@/engines/pdf/lib';

/**
 * Themes and page settings, shared by the PDF layout, the on-screen preview
 * and the print stylesheet so all three look alike. Sizes are in points.
 */

/** The PDF's standard 14 fonts cover these; anything outside WinAnsi falls back to Noto Sans */
export type Family = 'sans' | 'serif' | 'mono';
export type FontKey = `${Family}-${'r' | 'b' | 'i' | 'bi'}` | 'noto-r' | 'noto-b';

export function fontKey(family: Family, bold = false, italic = false): FontKey {
  return `${family}-${bold ? (italic ? 'bi' : 'b') : italic ? 'i' : 'r'}`;
}

/** Noto Sans has no italic here, so italics are slanted when drawn */
export function notoKey(bold = false): FontKey {
  return bold ? 'noto-b' : 'noto-r';
}

/** Browser font stacks that match the PDF fonts' metrics (Arial ≈ Helvetica, and so on) */
export const STACKS: Record<Family | 'noto', string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", "Rounder Noto Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
  noto: '"Rounder Noto Sans", "Noto Sans", Arial, sans-serif',
};

export interface HeadingStyle {
  /** × body size */
  scale: number;
  bold: boolean;
  italic?: boolean;
  /** a rule under the heading */
  rule?: boolean;
  /** space above and below, × body size */
  mt: number;
  mb: number;
}

export type ThemeId = 'clean' | 'editorial' | 'technical';

export interface Theme {
  id: ThemeId;
  label: string;
  body: Family;
  heading: Family;
  size: number;
  /** line height, × size */
  lead: number;
  text: string;
  muted: string;
  headingColor: string;
  accent: string;
  rule: string;
  codeBg: string;
  codeFg: string;
  codeBorder: string | null;
  inlineCodeBg: string;
  /** code size, × body size */
  codeScale: number;
  quoteBar: string;
  quoteItalic: boolean;
  tableHeadBg: string;
  /** full cell borders instead of lines between rows */
  tableGrid: boolean;
  h: [HeadingStyle, HeadingStyle, HeadingStyle, HeadingStyle, HeadingStyle, HeadingStyle];
}

export const THEMES: Record<ThemeId, Theme> = {
  clean: {
    id: 'clean',
    label: 'Clean',
    body: 'sans',
    heading: 'sans',
    size: 10.5,
    lead: 1.5,
    text: '#1f2328',
    muted: '#59636e',
    headingColor: '#111418',
    accent: '#0969da',
    rule: '#d1d9e0',
    codeBg: '#f6f8fa',
    codeFg: '#1f2328',
    codeBorder: '#e1e6eb',
    inlineCodeBg: '#eff2f5',
    codeScale: 0.88,
    quoteBar: '#d1d9e0',
    quoteItalic: false,
    tableHeadBg: '#f6f8fa',
    tableGrid: true,
    h: [
      { scale: 2, bold: true, rule: true, mt: 1.6, mb: 0.7 },
      { scale: 1.5, bold: true, rule: true, mt: 1.6, mb: 0.6 },
      { scale: 1.25, bold: true, mt: 1.4, mb: 0.5 },
      { scale: 1.05, bold: true, mt: 1.3, mb: 0.4 },
      { scale: 1, bold: true, mt: 1.2, mb: 0.4 },
      { scale: 0.95, bold: true, mt: 1.2, mb: 0.4 },
    ],
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    body: 'serif',
    heading: 'serif',
    size: 12,
    lead: 1.5,
    text: '#222019',
    muted: '#5f5a50',
    headingColor: '#141310',
    accent: '#8a3324',
    rule: '#d8d1c4',
    codeBg: '#f6f2ea',
    codeFg: '#2b2822',
    codeBorder: null,
    inlineCodeBg: '#f1ece2',
    codeScale: 0.8,
    quoteBar: '#8a3324',
    quoteItalic: true,
    tableHeadBg: '#ffffff',
    tableGrid: false,
    h: [
      { scale: 2.3, bold: false, mt: 1.4, mb: 0.6 },
      { scale: 1.6, bold: false, italic: true, mt: 1.5, mb: 0.5 },
      { scale: 1.25, bold: true, mt: 1.3, mb: 0.4 },
      { scale: 1.05, bold: true, mt: 1.2, mb: 0.3 },
      { scale: 1, bold: true, italic: true, mt: 1.1, mb: 0.3 },
      { scale: 1, bold: false, italic: true, mt: 1.1, mb: 0.3 },
    ],
  },
  technical: {
    id: 'technical',
    label: 'Technical',
    body: 'sans',
    heading: 'mono',
    size: 10,
    lead: 1.45,
    text: '#1b1f24',
    muted: '#57606a',
    headingColor: '#0b0d10',
    accent: '#0f766e',
    rule: '#c9d1d9',
    codeBg: '#1e2329',
    codeFg: '#e6edf3',
    codeBorder: null,
    inlineCodeBg: '#e9eef2',
    codeScale: 0.92,
    quoteBar: '#0f766e',
    quoteItalic: false,
    tableHeadBg: '#eef2f5',
    tableGrid: true,
    h: [
      { scale: 1.9, bold: true, rule: true, mt: 1.5, mb: 0.7 },
      { scale: 1.45, bold: true, mt: 1.6, mb: 0.55 },
      { scale: 1.2, bold: true, mt: 1.4, mb: 0.45 },
      { scale: 1.05, bold: true, mt: 1.2, mb: 0.4 },
      { scale: 1, bold: true, mt: 1.1, mb: 0.4 },
      { scale: 1, bold: false, mt: 1.1, mb: 0.4 },
    ],
  },
};

export type PageSize = Extract<PageSizeName, 'A4' | 'Letter'>;
export type MarginId = 'narrow' | 'normal' | 'wide';
export type NumberPos = 'off' | 'bottom' | 'bottom-total' | 'bottom-right' | 'top-right';

export interface PageOptions {
  theme: ThemeId;
  size: PageSize;
  margin: MarginId;
  numbers: NumberPos;
}

export const MARGINS: Record<MarginId, { mm: number; label: string }> = {
  narrow: { mm: 12.7, label: 'Narrow' },
  normal: { mm: 20, label: 'Normal' },
  wide: { mm: 30, label: 'Wide' },
};

export const marginPt = (id: MarginId) => (MARGINS[id].mm * 72) / 25.4;

export const NUMBER_LABELS: Record<NumberPos, string> = {
  off: 'None',
  bottom: 'Bottom center: 1',
  'bottom-total': 'Bottom center: 1 of 9',
  'bottom-right': 'Bottom right: 1',
  'top-right': 'Top right: 1',
};

export function pageLabel(pos: NumberPos, page: number, total: number) {
  return pos === 'bottom-total' ? `${page} of ${total}` : String(page);
}
