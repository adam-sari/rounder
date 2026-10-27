export type FontId = 'anton' | 'bebas' | 'bangers' | 'geist' | 'serif';

export interface FontDef {
  name: string;
  family: string;
  weight: number;
  lineHeight: number;
}

export const fonts: Record<FontId, FontDef> = {
  anton: { name: 'Anton', family: '"Anton", Impact, sans-serif', weight: 400, lineHeight: 1.12 },
  bebas: { name: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', weight: 400, lineHeight: 1.0 },
  bangers: { name: 'Bangers', family: '"Bangers", Impact, sans-serif', weight: 400, lineHeight: 1.08 },
  geist: { name: 'Geist Black', family: '"Geist Variable", system-ui, sans-serif', weight: 900, lineHeight: 1.08 },
  serif: { name: 'Instrument Serif', family: '"Instrument Serif", Georgia, serif', weight: 400, lineHeight: 1.0 },
};

export const fontIds = Object.keys(fonts) as FontId[];

export const fontCss = (id: FontId, px: number) => `${fonts[id].weight} ${px}px ${fonts[id].family}`;

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/** the display fonts we ship (OFL); Geist and Instrument Serif already come with the site */
const bundled = [
  { family: 'Anton', file: 'anton' },
  { family: 'Bebas Neue', file: 'bebas-neue' },
  { family: 'Bangers', file: 'bangers' },
];

let added = false;

/** Registers the bundled fonts and waits until every font is ready to draw on a canvas */
export async function loadFonts() {
  if (!added) {
    added = true;
    for (const { family, file } of bundled) {
      for (const [subset, range] of [['latin', LATIN], ['latin-ext', LATIN_EXT]]) {
        document.fonts.add(new FontFace(family, `url(/fonts/thumbnail/${file}-${subset}.woff2) format("woff2")`, { unicodeRange: range, display: 'swap' }));
      }
    }
  }
  await Promise.allSettled(fontIds.map((id) => document.fonts.load(fontCss(id, 64), 'Aa')));
}

/** Capital height divided by font size, so text can be centered on its capitals */
export function capRatio(ctx: CanvasRenderingContext2D, id: FontId) {
  ctx.font = fontCss(id, 100);
  const m = ctx.measureText('H');
  return m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / 100 : 0.72;
}
