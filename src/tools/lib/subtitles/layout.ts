import type { Ctx2D } from '@/engines/media';

export type FontChoice = 'sans' | 'serif' | 'system';
export type Placement = 'top' | 'middle' | 'bottom';

export interface CaptionStyle {
  font: FontChoice;
  /** font size as a fraction of the frame height */
  size: number;
  color: string;
  /** outline thickness as a fraction of the font size; 0 = none */
  outline: number;
  outlineColor: string;
  box: boolean;
  boxColor: string;
  /** 0–1 */
  boxOpacity: number;
  position: Placement;
  /** widest a line may get, as a fraction of the frame width */
  maxWidth: number;
  uppercase: boolean;
}

export const defaultStyle: CaptionStyle = {
  font: 'sans',
  size: 0.055,
  color: '#ffffff',
  outline: 0.14,
  outlineColor: '#000000',
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.6,
  position: 'bottom',
  maxWidth: 0.86,
  uppercase: false,
};

export const fonts: Record<FontChoice, { label: string; family: string; weight: number }> = {
  sans: { label: 'Geist', family: '"Geist Variable", system-ui, sans-serif', weight: 700 },
  serif: { label: 'Instrument Serif', family: '"Instrument Serif", Georgia, serif', weight: 400 },
  system: { label: 'System bold', family: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', weight: 800 },
};

export const fontCss = (font: FontChoice, px: number) => `${fonts[font].weight} ${px}px ${fonts[font].family}`;

export const LINE_HEIGHT = 1.25;
/** gap between the captions and the top/bottom edge, as a fraction of the frame height */
export const EDGE = 0.06;
/** background box padding, as a fraction of the font size */
export const BOX_PAD = 0.4;

/** Greedy word wrap that keeps manual line breaks; words wider than a line (or unspaced scripts) break by character. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= maxWidth) {
        line = joined;
        continue;
      }
      if (line) out.push(line);
      line = '';
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      for (const ch of Array.from(word)) {
        if (line && measure(line + ch) > maxWidth) {
          out.push(line);
          line = '';
        }
        line += ch;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export interface CaptionLine {
  text: string;
  /** centre x and middle y */
  x: number;
  y: number;
  width: number;
}

export interface CaptionLayout {
  px: number;
  lineHeight: number;
  /** stroke width in pixels (0 = no outline) */
  outline: number;
  padX: number;
  lines: CaptionLine[];
}

/** Lays out caption text on a w × h frame. `measure` returns the width of `s` at `px` in the chosen font. */
export function layoutCaption(text: string, style: CaptionStyle, w: number, h: number, measure: (s: string, px: number) => number): CaptionLayout | null {
  const px = Math.max(6, Math.round(style.size * h));
  const content = style.uppercase ? text.toUpperCase() : text;
  const outline = style.outline > 0 ? Math.max(1, style.outline * px) : 0;
  const padX = style.box ? px * BOX_PAD : 0;
  const maxW = Math.max(px, style.maxWidth * w - 2 * padX - outline);
  const wrapped = wrapLines(content, maxW, (s) => measure(s, px));
  if (!wrapped.length) return null;
  const lineHeight = Math.round(px * LINE_HEIGHT);
  const blockH = wrapped.length * lineHeight;
  const edge = h * EDGE;
  const top = style.position === 'top' ? edge : style.position === 'middle' ? (h - blockH) / 2 : h - edge - blockH;
  return {
    px,
    lineHeight,
    outline,
    padX,
    lines: wrapped.map((t, i) => ({ text: t, x: w / 2, y: top + (i + 0.5) * lineHeight, width: measure(t, px) })),
  };
}

/** Paints a laid-out caption: one background path (so touching boxes don't darken), then outline, then fill. */
export function drawCaption(ctx: Ctx2D, l: CaptionLayout, style: CaptionStyle) {
  ctx.save();
  ctx.font = fontCss(style.font, l.px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (style.box) {
    ctx.globalAlpha = style.boxOpacity;
    ctx.fillStyle = style.boxColor;
    ctx.beginPath();
    for (const line of l.lines) {
      const x = line.x - line.width / 2 - l.padX;
      const y = line.y - l.lineHeight / 2;
      const w = line.width + l.padX * 2;
      if (ctx.roundRect) ctx.roundRect(x, y, w, l.lineHeight, l.px * 0.18);
      else ctx.rect(x, y, w, l.lineHeight);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (l.outline) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = l.outline;
    ctx.strokeStyle = style.outlineColor;
    for (const line of l.lines) ctx.strokeText(line.text, line.x, line.y);
  }
  ctx.fillStyle = style.color;
  for (const line of l.lines) ctx.fillText(line.text, line.x, line.y);
  ctx.restore();
}
