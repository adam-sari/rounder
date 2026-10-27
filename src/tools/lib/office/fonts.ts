/*
 * Fonts for Office → PDF. The page is laid out by the browser in metric-compatible stand-ins for the
 * usual Office fonts (vendored by scripts/vendor-office.mjs), and the PDF embeds subsets of the very
 * same files, so every word lands where the browser put it.
 */
import type { PDFDocument, PDFFont } from 'pdf-lib';

export type Family = 'carlito' | 'caladea' | 'arimo' | 'tinos' | 'cousine';

interface Face {
  subset: string;
  weight: number;
  style: 'normal' | 'italic';
  file: string;
  range: string;
}

const BASE = () => `${import.meta.env.BASE_URL}vendor/office-fonts/`;
/** the CSS family the page is laid out in */
export const cssFamily = (f: Family) => `rounder-${f}`;

const NAMES: [RegExp, Family][] = [
  [/^(calibri|carlito|aptos|candara|corbel|segoe ui|trebuchet ms|gill sans)/, 'carlito'],
  [/^(cambria|caladea|constantia)/, 'caladea'],
  [/^(times|tinos|liberation serif|georgia|garamond|book antiqua|palatino|baskerville|century schoolbook|serif$)/, 'tinos'],
  [/^(courier|cousine|consolas|lucida console|liberation mono|menlo|monaco|monospace$|source code)/, 'cousine'],
  [/^(arial|arimo|helvetica|liberation sans|verdana|tahoma|roboto|open sans|lato|montserrat|noto sans|sans-serif$|system-ui)/, 'arimo'],
];

/** The stand-in for a CSS font-family list: the first name we know, else sans */
export function familyFor(cssFontFamily: string): Family {
  for (const raw of cssFontFamily.split(',')) {
    const name = raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (name.startsWith('rounder-')) return name.slice(8) as Family;
    for (const [re, family] of NAMES) if (re.test(name)) return family;
  }
  return 'arimo';
}

/** "U+0000-00FF,U+0131" → [[0, 255], [305, 305]] */
export function parseRange(range: string): [number, number][] {
  return range.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

const covers = (ranges: [number, number][], cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);

interface Manifest {
  families: Record<Family, Face[]>;
}

let manifest: Promise<Manifest> | undefined;
const loadManifest = () =>
  (manifest ??= fetch(`${BASE()}manifest.json`).then((r) => {
    if (!r.ok) throw new Error("The page fonts couldn't be loaded. Check your connection and try again.");
    return r.json() as Promise<Manifest>;
  })).catch((e) => {
    manifest = undefined;
    throw e;
  });

const parsed = new Map<Face, [number, number][]>();
const rangesOf = (face: Face) => {
  let r = parsed.get(face);
  if (!r) parsed.set(face, (r = parseRange(face.range)));
  return r;
};

/** Registers every stand-in with the document (only the subsets a page uses are fetched, by the browser) */
export async function registerFonts(): Promise<void> {
  const { families } = await loadManifest();
  for (const [family, faces] of Object.entries(families) as [Family, Face[]][])
    for (const f of faces) {
      const face = new FontFace(cssFamily(family), `url(${BASE()}${f.file}) format('woff')`, { weight: String(f.weight), style: f.style, unicodeRange: f.range });
      document.fonts.add(face);
    }
}

export interface Variant {
  family: Family;
  bold: boolean;
  italic: boolean;
}

/** The face that has this character in this variant, or null (the character then comes out as a picture) */
export async function faceFor(v: Variant, cp: number): Promise<Face | null> {
  const { families } = await loadManifest();
  const faces = families[v.family].filter((f) => f.weight === (v.bold ? 700 : 400) && f.style === (v.italic ? 'italic' : 'normal'));
  return faces.find((f) => covers(rangesOf(f), cp)) ?? null;
}

/** Embeds faces into one PDF as they're first used (subset to the characters drawn) */
export class PdfFonts {
  private fonts = new Map<string, Promise<PDFFont>>();
  constructor(private doc: PDFDocument) {}

  async get(face: Face): Promise<PDFFont> {
    let font = this.fonts.get(face.file);
    if (!font) {
      font = (async () => {
        const res = await fetch(`${BASE()}${face.file}`);
        if (!res.ok) throw new Error("The page fonts couldn't be loaded. Check your connection and try again.");
        // WOFF2 subsetting breaks in fontkit, WOFF works
        return this.doc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: true });
      })();
      this.fonts.set(face.file, font);
    }
    return font;
  }
}
