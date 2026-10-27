import type { FontFamily } from './stamp';

/*
 * Preview drawing. The canvas is set up in page points, y up (like PDF), so
 * the geometry from geometry.ts applies unchanged; these helpers flip locally
 * so text and images come out upright.
 */

// closest system lookalikes of the PDF standard fonts; widths are matched exactly below
const CSS_FONTS: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** `unicode`: the output uses the embedded Noto Sans instead of the chosen font */
export function cssFont(family: FontFamily, bold: boolean, unicode: boolean, size: number) {
  return `${bold ? 700 : 400} ${size}px ${unicode ? '"Noto Sans", Arial, sans-serif' : CSS_FONTS[family]}`;
}

/** Draws one line into its box (origin bottom-left, y up), stretched to the width the PDF font gives it */
export function drawTextBox(ctx: CanvasRenderingContext2D, text: string, font: string, box: { width: number; height: number; descent: number }) {
  ctx.save();
  ctx.translate(0, box.height);
  ctx.scale(1, -1);
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const measured = ctx.measureText(text).width;
  if (measured > 0) ctx.scale(box.width / measured, 1);
  ctx.fillText(text, 0, box.height - box.descent);
  ctx.restore();
}

/** Draws an image into the unit square (origin bottom-left, y up) */
export function drawImageBox(ctx: CanvasRenderingContext2D, img: CanvasImageSource) {
  ctx.save();
  ctx.translate(0, 1);
  ctx.scale(1, -1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, 1, 1);
  ctx.restore();
}
