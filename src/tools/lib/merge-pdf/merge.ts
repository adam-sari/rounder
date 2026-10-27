import { degrees, PDFDocument, PDFHexString, PDFName, PDFObjectCopier, PDFPage, type PDFPageLeaf, type PDFRef } from 'pdf-lib';

/** One output page: which loaded source it comes from, and the extra rotation the user chose */
export interface PlanPage {
  source: string;
  pageIndex: number;
  rotation: number;
}

export interface MergeOptions {
  /** one bookmark per source, pointing at its first page in the output */
  bookmarks?: Record<string, string>;
  /** copy title, author and other document info from this source */
  metadataFrom?: string;
  /** document title when there's no metadata to keep */
  title: string;
}

const normalize = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/**
 * Copies the planned pages into a new PDF. Uses one object copier per source,
 * like pdf-lib's copyPages, so fonts and images shared by many pages are
 * copied once, but goes page by page so progress can be reported. Pages are
 * copied by reference, so links and annotations that point at another page of
 * the same file land on that page in the output instead of an orphaned copy.
 */
export async function mergeDocs(plan: PlanPage[], sources: Map<string, PDFDocument>, opts: MergeOptions, onProgress?: (done: number, total: number) => void): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const copiers = new Map<string, { copier: PDFObjectCopier; pages: PDFPage[] }>();
  const firstPage = new Map<string, number>();
  const added = new Set<string>();

  for (const [i, p] of plan.entries()) {
    let c = copiers.get(p.source);
    if (!c) {
      const src = sources.get(p.source);
      if (!src) throw new Error(`Source ${p.source} isn't loaded`);
      await src.flush();
      c = { copier: PDFObjectCopier.for(src.context, out.context), pages: src.getPages() };
      copiers.set(p.source, c);
    }
    const srcPage = c.pages[p.pageIndex];
    const key = `${p.source}:${p.pageIndex}`;
    let page: PDFPage;
    // a page used twice needs a node of its own: one leaf can't sit in the page tree twice
    if (added.has(key)) {
      const node = c.copier.copy(srcPage.node);
      page = PDFPage.of(node, out.context.register(node), out);
    } else {
      const ref = c.copier.copy(srcPage.ref);
      page = PDFPage.of(out.context.lookup(ref) as PDFPageLeaf, ref, out);
      added.add(key);
    }
    out.addPage(page);
    if (p.rotation) page.setRotation(degrees(normalize(page.getRotation().angle + p.rotation)));
    if (!firstPage.has(p.source)) firstPage.set(p.source, i);
    if (onProgress && (i % 10 === 9 || i === plan.length - 1)) onProgress(i + 1, plan.length);
  }

  if (opts.bookmarks) {
    const entries = [...firstPage].filter(([id]) => opts.bookmarks![id]).map(([id, page]) => ({ title: opts.bookmarks![id], page }));
    addOutline(out, entries);
  }
  const from = opts.metadataFrom ? sources.get(opts.metadataFrom) : undefined;
  if (from) copyInfo(from, out);
  if (!out.getTitle()) out.setTitle(opts.title);
  if (!out.getCreationDate()) out.setCreationDate(new Date());
  out.setModificationDate(new Date());
  return out;
}

/** A flat outline (bookmarks panel): one entry per item, each opening its page */
export function addOutline(doc: PDFDocument, entries: { title: string; page: number }[]) {
  if (!entries.length) return;
  const ctx = doc.context;
  const pages = doc.getPages();
  const root = ctx.nextRef();
  const refs: PDFRef[] = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => {
    const item = ctx.obj({ Title: PDFHexString.fromText(e.title), Parent: root, Dest: [pages[e.page].ref, 'Fit'] });
    if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], item);
  });
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

// malformed dates and strings in the Info dictionary make pdf-lib's getters throw
const tryGet = <T>(get: () => T) => {
  try {
    return get();
  } catch {
    return undefined;
  }
};

/** Title, author, subject, keywords, creator, producer and creation date */
export function copyInfo(from: PDFDocument, to: PDFDocument) {
  const title = tryGet(() => from.getTitle());
  const author = tryGet(() => from.getAuthor());
  const subject = tryGet(() => from.getSubject());
  const keywords = tryGet(() => from.getKeywords());
  const creator = tryGet(() => from.getCreator());
  const producer = tryGet(() => from.getProducer());
  const created = tryGet(() => from.getCreationDate());
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  if (keywords) to.setKeywords([keywords]);
  if (creator) to.setCreator(creator);
  if (producer) to.setProducer(producer);
  if (created && !Number.isNaN(created.getTime())) to.setCreationDate(created);
}

/* ---------------- images as pages ---------------- */

const A4_SHORT = 595.28;
const A4_LONG = 841.89;
/** the largest page side the PDF format allows (200 inches) */
const MAX_SIDE = 14_400;

/**
 * Page size in points for an image of w × h pixels: 96 dpi, but no wider than
 * an A4 page (portrait or landscape to match), so photos sit well next to documents.
 */
export function imagePageSize(w: number, h: number): [number, number] {
  const s = Math.min(0.75, (w > h ? A4_LONG : A4_SHORT) / w, MAX_SIDE / h);
  return [Math.round(w * s * 100) / 100, Math.round(h * s * 100) / 100];
}

/** A one-page PDF showing the image edge to edge. `rotation` (clockwise) fixes camera orientation. */
export async function imageToPdf(bytes: Uint8Array, type: 'jpeg' | 'png', rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const img = type === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const turned = rotation % 180 !== 0;
  // size for how it will be seen, then lay it out unrotated
  const [a, b] = turned ? imagePageSize(img.height, img.width) : imagePageSize(img.width, img.height);
  const [w, h] = turned ? [b, a] : [a, b];
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  if (rotation) page.setRotation(degrees(normalize(rotation)));
  return doc.save();
}
