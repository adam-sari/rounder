import { linearRgb, toGamut, type Color } from './convert';

/** paints a (possibly see-through) color over an opaque one */
export function composite(top: Color, under: Color): Color {
  const a = top.alpha;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), alpha: 1 };
}

const WHITE: Color = { r: 1, g: 1, b: 1, alpha: 1 };

/** the colors a screen would actually show: background on white, text on that background */
export function resolvePair(text: Color, bg: Color) {
  const back = composite(toGamut(bg), WHITE);
  return { text: composite(toGamut(text), back), bg: back };
}

/** WCAG 2 relative luminance */
export function luminance(c: Color) {
  const [r, g, b] = linearRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21 */
export function contrastRatio(a: Color, b: Color) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 success criteria 1.4.3, 1.4.6 and 1.4.11 */
export function wcagChecks(ratio: number) {
  return [
    { id: 'aa', label: 'AA', detail: 'normal text', need: 4.5 },
    { id: 'aa-large', label: 'AA', detail: 'large text', need: 3 },
    { id: 'aaa', label: 'AAA', detail: 'normal text', need: 7 },
    { id: 'aaa-large', label: 'AAA', detail: 'large text', need: 4.5 },
    { id: 'ui', label: 'AA', detail: 'icons & UI', need: 3 },
  ].map((c) => ({ ...c, pass: ratio >= c.need }));
}

/**
 * APCA lightness contrast (APCA-W3 0.0.98G-4g). Positive for dark text on a light
 * background, negative for light text on dark.
 */
export function apca(text: Color, bg: Color) {
  const y = (c: Color) => {
    const v = 0.2126729 * Math.max(0, c.r) ** 2.4 + 0.7151522 * Math.max(0, c.g) ** 2.4 + 0.072175 * Math.max(0, c.b) ** 2.4;
    return v > 0.022 ? v : v + (0.022 - v) ** 1.414;
  };
  const yt = y(text);
  const yb = y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const sapc = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

/** what an APCA Lc value is good for, from the APCA "bronze" readability guidance */
export function apcaUse(lc: number) {
  const v = Math.abs(lc);
  if (v >= 90) return 'Preferred for body text';
  if (v >= 75) return 'Fine for body text';
  if (v >= 60) return 'Fine for content text, not long reading';
  if (v >= 45) return 'Headlines and large text only';
  if (v >= 30) return 'Placeholder or disabled text at most';
  if (v >= 15) return 'Non-text only (dividers, outlines)';
  return 'Not readable';
}

const BLACK: Color = { r: 0, g: 0, b: 0, alpha: 1 };

/** black or white, whichever reads better on this color (see-through colors are shown over `under`) */
export function readableInk(bg: Color, under: Color = WHITE): 'black' | 'white' {
  const back = composite(toGamut(bg), under);
  return Math.abs(apca(BLACK, back)) >= Math.abs(apca(WHITE, back)) ? 'black' : 'white';
}
