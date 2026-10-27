import type { PDFDocument, PDFFont, PDFPage, SaveOptions } from 'pdf-lib';
import { DAMAGED, PdfError, PdfPasswordError } from './errors';
import { runQpdf } from './qpdf';
import { normalizeRotation, type PageRef, type PdfSource } from './pdfjs';

export type PdfLib = typeof import('pdf-lib');
let pdfLib: Promise<PdfLib> | undefined;

/** pdf-lib, loaded on first use: `const { PDFDocument, rgb, degrees } = await loadPdfLibModule()` */
export function loadPdfLibModule(): Promise<PdfLib> {
  pdfLib ??= import('pdf-lib');
  return pdfLib;
}

export async function toBytes(src: PdfSource): Promise<Uint8Array> {
  if (src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  return src instanceof Uint8Array ? src : new Uint8Array(src);
}

/**
 * Loads a PDF into pdf-lib with friendly errors. pdf-lib can't decrypt, so an
 * encrypted file throws PdfPasswordError unless `ignoreEncryption` (then edits
 * may produce garbage). Most tools want loadEditablePdf instead.
 */
export async function loadPdfLib(src: PdfSource, { ignoreEncryption = false } = {}): Promise<PDFDocument> {
  const [{ PDFDocument }, bytes] = await Promise.all([loadPdfLibModule(), toBytes(src)]);
  try {
    // updateMetadata: false keeps the original producer/dates instead of stamping "pdf-lib"
    return await PDFDocument.load(bytes, { ignoreEncryption, updateMetadata: false });
  } catch (e) {
    if ((e as Error)?.name === 'EncryptedPDFError' || /is encrypted/i.test((e as Error)?.message)) throw new PdfPasswordError('needsPassword');
    throw new PdfError(DAMAGED, 'damaged');
  }
}

/**
 * Loads any PDF for editing: encrypted files are decrypted with qpdf (owner-only
 * "permissions" passwords need no password; an open password must be given),
 * and files pdf-lib can't parse get one repair pass through qpdf first.
 * `bytes` are what `doc` was loaded from (decrypted/repaired when needed).
 */
export async function loadEditablePdf(src: PdfSource, { password }: { password?: string } = {}): Promise<{ doc: PDFDocument; bytes: Uint8Array; decrypted: boolean }> {
  let bytes = await toBytes(src);
  try {
    return { doc: await loadPdfLib(bytes), bytes, decrypted: false };
  } catch (e) {
    const encrypted = e instanceof PdfPasswordError;
    try {
      bytes = await runQpdf(encrypted ? ['--decrypt', 'in.pdf', 'out.pdf'] : ['in.pdf', 'out.pdf'], bytes, { password });
    } catch (err) {
      throw encrypted ? err : e;
    }
    return { doc: await loadPdfLib(bytes), bytes, decrypted: encrypted };
  }
}

export async function savePdf(doc: PDFDocument, options?: SaveOptions): Promise<Blob> {
  const bytes = await doc.save(options);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/**
 * Builds a new PDF from page refs (any mix of documents, any order, repeats
 * allowed), applying each ref's extra rotation. `sources` maps PdfDoc.id to
 * that file loaded in pdf-lib (e.g. via loadEditablePdf).
 */
export async function assemblePdf(refs: Pick<PageRef, 'doc' | 'pageIndex' | 'rotation'>[], sources: Map<string, PDFDocument>): Promise<PDFDocument> {
  const { PDFDocument, degrees } = await loadPdfLibModule();
  const out = await PDFDocument.create();
  const wanted = new Map<string, number[]>();
  for (const r of refs) wanted.set(r.doc.id, [...(wanted.get(r.doc.id) ?? []), r.pageIndex]);
  // one copyPages per source keeps shared fonts and images from being duplicated
  const copies = new Map<string, PDFPage[]>();
  for (const [id, indices] of wanted) {
    const src = sources.get(id);
    if (!src) throw new PdfError('One of the files is no longer loaded. Add it again and retry.');
    copies.set(id, await out.copyPages(src, indices));
  }
  for (const r of refs) {
    const page = out.addPage(copies.get(r.doc.id)!.shift()!);
    if (r.rotation) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + r.rotation)));
  }
  return out;
}

/** "Report.PDF" + "-merged" → "Report-merged.pdf" (always ends in .pdf) */
export function pdfName(fileName: string, suffix = '', ext = 'pdf') {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || 'document';
  return `${base}${suffix}.${ext}`;
}

/** width × height in points (1/72 inch), portrait */
export const PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
} as const satisfies Record<string, readonly [number, number]>;
export type PageSizeName = keyof typeof PAGE_SIZES;

export const mmToPt = (mm: number) => (mm * 72) / 25.4;
export const inToPt = (inches: number) => inches * 72;

/* ---------------- fonts ---------------- */

// the 0x80–0x9F block of Windows-1252, which the standard 14 fonts can draw
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** true when Helvetica & co. can draw every character (tabs/newlines are handled by pdf-lib) */
export function isWinAnsi(text: string) {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) continue;
    return false;
  }
  return true;
}

/** Noto Sans (OFL), Latin + Latin Extended + Greek + Cyrillic; served from /fonts/pdf/ */
const fontFiles = { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' };
const fontBytes = new Map<string, Promise<Uint8Array>>();

function unicodeFont(bold: boolean): Promise<Uint8Array> {
  const file = fontFiles[bold ? 'bold' : 'regular'];
  let p = fontBytes.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/pdf/${file}`).then(async (r) => {
      if (!r.ok) throw new PdfError("The font for non-Latin text couldn't be loaded. Check your connection and try again.");
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => fontBytes.delete(file));
    fontBytes.set(file, p);
  }
  return p;
}

async function loadFontkit() {
  const m = await import('@pdf-lib/fontkit');
  // its types declare named exports, its ES build has only a default export
  return (m as unknown as { default?: typeof m }).default ?? m;
}

const embedded = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

/**
 * A font that can draw `text` (one string or all the strings you'll draw, so
 * they share a font): Helvetica when possible, else the whole embedded Noto Sans.
 * Cached per document. Characters outside Noto Sans
 * (CJK, Arabic, emoji…) still can't be drawn; see missingGlyphs.
 */
export async function embedFontWithFallback(doc: PDFDocument, text: string | string[], { bold = false } = {}): Promise<PDFFont> {
  const all = Array.isArray(text) ? text.join('\n') : text;
  const key = isWinAnsi(all) ? (bold ? 'helvetica-bold' : 'helvetica') : bold ? 'noto-bold' : 'noto';
  let fonts = embedded.get(doc);
  if (!fonts) embedded.set(doc, (fonts = new Map()));
  let font = fonts.get(key);
  if (!font) {
    font = (async () => {
      const { StandardFonts } = await loadPdfLibModule();
      if (key.startsWith('helvetica')) return doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
      const [fontkit, bytes] = await Promise.all([loadFontkit(), unicodeFont(bold)]);
      doc.registerFontkit(fontkit);
      // fontkit's subsetter drops Cyrillic and Greek glyphs from Noto Sans, so embed it whole (~0.5 MB)
      return doc.embedFont(bytes);
    })();
    font.catch(() => fonts.delete(key));
    fonts.set(key, font);
  }
  return font;
}

const parsed: Promise<import('@pdf-lib/fontkit').Font>[] = [];

/** The distinct characters in `text` that even the fallback font can't draw, to warn about */
export async function missingGlyphs(text: string, { bold = false } = {}): Promise<string[]> {
  if (isWinAnsi(text)) return [];
  parsed[+bold] ??= Promise.all([loadFontkit(), unicodeFont(bold)])
    .then(([fontkit, bytes]) => fontkit.create(bytes))
    .catch((e) => {
      delete parsed[+bold]; // let a later call retry the download
      throw e;
    });
  const font = await parsed[+bold]!;
  const missing = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && !font.hasGlyphForCodePoint(ch.codePointAt(0)!)) missing.add(ch);
  return [...missing];
}

type DrawTextOptions = NonNullable<Parameters<PDFPage['drawText']>[1]>;

/** page.drawText that picks a font able to draw the text (see embedFontWithFallback) */
export async function drawTextAuto(page: PDFPage, text: string, options: Omit<DrawTextOptions, 'font'> & { bold?: boolean } = {}) {
  const { bold, ...rest } = options;
  const font = await embedFontWithFallback(page.doc, text, { bold });
  page.drawText(text, { ...rest, font });
  return font;
}
