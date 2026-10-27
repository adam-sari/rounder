import type { PDFArray as PdfArray, PDFDict as PdfDict, PDFDocument, PDFName as PdfName, PDFPage, PDFRef } from 'pdf-lib';
import { loadPdfLibModule } from '@/engines/pdf';

/*
 * The pdf-lib side of true redaction. A redacted page keeps its place in the
 * page tree (so links and bookmarks to it still work) but everything it drew
 * is replaced by one flat image. pdf-lib saves every object it parsed, even
 * ones nothing points to any more, so dropUnreachable() must run before
 * saving, or the old page content would still be inside the file.
 */

/**
 * Cuts the ties the rest of the document has to what's on `pages`: form
 * fields whose widgets sit there (their values are often the very text being
 * hidden), replies and popups pointing at their comments, and the tagged-PDF
 * structure tree, whose alt text and references can reach the old content,
 * and resource dictionaries shared with other pages (see unshareResources).
 * Run it before replacePageWithImage.
 */
export async function detachPages(doc: PDFDocument, pages: number[]) {
  const { PDFArray, PDFDict, PDFName, PDFRef } = await loadPdfLibModule();
  const ctx = doc.context;
  const name = (s: string) => PDFName.of(s);

  const gone = new Set<unknown>();
  for (const i of pages) for (const a of doc.getPage(i).node.Annots()?.asArray() ?? []) gone.add(ctx.lookup(a));

  const removed = new Set<unknown>();
  const prune = (list: PdfArray) => {
    for (let k = list.size() - 1; k >= 0; k--) {
      const field = ctx.lookup(list.get(k));
      if (!(field instanceof PDFDict)) continue;
      const kids = field.lookupMaybe(name('Kids'), PDFArray);
      if (kids) prune(kids);
      if (kids ? !kids.size() : gone.has(field)) {
        list.remove(k);
        removed.add(field);
      }
    }
  };
  const form = doc.catalog.lookupMaybe(name('AcroForm'), PDFDict);
  const fields = form?.lookupMaybe(name('Fields'), PDFArray);
  if (fields) prune(fields);
  // the calculation order lists fields too, and would keep the removed ones (and their values) in the file
  const order = form?.lookupMaybe(name('CO'), PDFArray);
  if (order) for (let k = order.size() - 1; k >= 0; k--) if (removed.has(ctx.lookup(order.get(k)))) order.remove(k);
  // an XFA form keeps its own copy of every field value
  form?.delete(name('XFA'));

  for (const [i, page] of doc.getPages().entries()) {
    if (pages.includes(i)) continue;
    for (const a of page.node.Annots()?.asArray() ?? []) {
      const annot = ctx.lookup(a);
      if (!(annot instanceof PDFDict)) continue;
      for (const key of ['IRT', 'Popup', 'Parent']) {
        const ref = annot.get(name(key));
        if (ref instanceof PDFRef && gone.has(ctx.lookup(ref))) annot.delete(name(key));
      }
    }
  }

  doc.catalog.delete(name('StructTreeRoot'));
  doc.catalog.delete(name('MarkInfo'));
  // bookmarks can point into the structure tree too
  const seen = new Set<unknown>();
  const todo = [doc.catalog.lookupMaybe(name('Outlines'), PDFDict)?.get(name('First'))];
  while (todo.length) {
    const item = ctx.lookup(todo.pop() as PDFRef);
    if (!(item instanceof PDFDict) || seen.has(item)) continue;
    seen.add(item);
    item.delete(name('SE'));
    todo.push(item.get(name('First')), item.get(name('Next')));
  }

  await unshareResources(doc, pages);
}

/**
 * A redacted page's images can stay reachable through resources it shares
 * with other pages: some makers (jsPDF, for one) give every page one
 * dictionary listing every image, and resources can be inherited from the
 * page tree. Every page gets its own resources, and a page sharing images
 * with a redacted one keeps only those its content actually draws, so the
 * redacted page's own images become unreachable and are dropped on save.
 */
async function unshareResources(doc: PDFDocument, pages: number[]) {
  const { PDFArray, PDFDict, PDFName } = await loadPdfLibModule();
  const ctx = doc.context;
  const RES = PDFName.of('Resources');
  const XOBJ = PDFName.of('XObject');

  const theirs = new Set<unknown>();
  for (const i of pages) {
    const xo = doc.getPage(i).node.Resources()?.lookupMaybe(XOBJ, PDFDict);
    for (const v of xo?.values() ?? []) theirs.add(ctx.lookup(v));
  }

  for (const [i, page] of doc.getPages().entries()) {
    if (!page.node.get(RES)) {
      const inherited = page.node.getInheritableAttribute(RES);
      if (inherited) page.node.set(RES, inherited);
    }
    if (pages.includes(i)) continue;
    const res = page.node.Resources();
    const xo = res?.lookupMaybe(XOBJ, PDFDict);
    if (!res || !xo) continue;
    const shared = xo.keys().filter((k) => theirs.has(ctx.lookup(xo.get(k))));
    if (!shared.length) continue;
    const used = await drawnNames(page, xo);
    const unused = used && shared.filter((k) => !used.has(k));
    if (!unused?.length) continue;
    const own = xo.clone(ctx);
    for (const k of unused) own.delete(k);
    const copy = res.clone(ctx);
    copy.set(XOBJ, own);
    page.node.set(RES, copy);
  }

  // every page now has its own, so the page tree's copies only hold leftovers
  const todo = [doc.catalog.get(PDFName.of('Pages'))];
  const seen = new Set<unknown>();
  while (todo.length) {
    const node = ctx.lookup(todo.pop() as PDFRef);
    if (!(node instanceof PDFDict) || seen.has(node) || node.get(PDFName.of('Type')) !== PDFName.of('Pages')) continue;
    seen.add(node);
    node.delete(RES);
    todo.push(...(node.lookupMaybe(PDFName.of('Kids'), PDFArray)?.asArray() ?? []));
  }
}

/**
 * The XObject names a page draws with `Do`, including inside forms that use
 * the page's resources. null when a content stream can't be decoded, so
 * nothing is removed on a guess.
 */
async function drawnNames(page: PDFPage, xo: PdfDict): Promise<Set<PdfName> | null> {
  const { decodePDFRawStream, PDFArray, PDFName, PDFRawStream, PDFStream } = await loadPdfLibModule();
  const ctx = page.doc.context;
  const used = new Set<PdfName>();
  const contents = page.node.Contents();
  const todo: unknown[] = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  const seen = new Set<unknown>();
  const latin1 = new TextDecoder('latin1');
  while (todo.length) {
    const stream = todo.pop();
    if (stream === undefined || seen.has(stream)) continue;
    seen.add(stream);
    if (!(stream instanceof PDFStream)) return null;
    let bytes: Uint8Array;
    try {
      bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
    } catch {
      return null;
    }
    for (const [, raw] of latin1.decode(bytes).matchAll(/\/([^\s/[\]()<>{}%]+)\s*Do(?![^\s/[\]()<>{}%])/g)) {
      const key = PDFName.of(raw);
      used.add(key);
      // a form without resources of its own draws with the page's
      const target = ctx.lookup(xo.get(key));
      if (target instanceof PDFStream && target.dict.get(PDFName.of('Subtype')) === PDFName.of('Form') && !target.dict.get(PDFName.of('Resources'))) todo.push(target);
    }
  }
  return used;
}

const num = (n: number) => String(+n.toFixed(4));

/**
 * Empties a page and makes it show only `image`, stretched over `view`
 * ([x1, y1, x2, y2], the visible page box in user space, as pdf.js's page.view).
 * The page's rotation is kept, so the image must be drawn unrotated.
 */
export async function replacePageWithImage(doc: PDFDocument, pageIndex: number, image: PDFRef, view: number[]) {
  const { PDFName } = await loadPdfLibModule();
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  const rotate = page.getRotation().angle;
  const keep = new Set(['Type', 'Parent', 'UserUnit'].map((k) => PDFName.of(k)));
  // fonts, images, annotations, thumbnails, app data: all of it goes
  for (const key of page.node.keys()) if (!keep.has(key)) page.node.delete(key);
  const [x1, y1, x2, y2] = view;
  page.node.set(PDFName.of('MediaBox'), ctx.obj(view.map(Number)));
  page.node.set(PDFName.of('CropBox'), ctx.obj(view.map(Number)));
  page.node.set(PDFName.of('Rotate'), ctx.obj(rotate));
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Redacted: image } }));
  const draw = `q ${num(x2 - x1)} 0 0 ${num(y2 - y1)} ${num(x1)} ${num(y1)} cm /Redacted Do Q`;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(draw)));
}

export interface StripOptions {
  /** title, author, producer, dates (Info), XMP metadata and app-private data */
  metadata?: boolean;
  /** comments, links, form fields, bookmarks, attachments, scripts and automatic actions */
  extras?: boolean;
}

export async function stripHidden(doc: PDFDocument, { metadata = false, extras = false }: StripOptions) {
  const { PDFDict, PDFName } = await loadPdfLibModule();
  const name = (s: string) => PDFName.of(s);
  const { catalog } = doc;
  const drop = (dict: { delete(k: PdfName): boolean }, keys: string[]) => keys.forEach((k) => dict.delete(name(k)));

  if (metadata) {
    doc.context.trailerInfo.Info = undefined;
    drop(catalog, ['Metadata', 'PieceInfo']);
    for (const page of doc.getPages()) drop(page.node, ['Metadata', 'PieceInfo']);
  }
  if (extras) {
    for (const page of doc.getPages()) drop(page.node, ['Annots', 'AA']);
    drop(catalog, ['AcroForm', 'AA', 'Outlines', 'Collection']);
    const mode = catalog.get(name('PageMode'));
    if (mode === name('UseOutlines') || mode === name('UseAttachments')) catalog.delete(name('PageMode'));
    const names = catalog.lookupMaybe(name('Names'), PDFDict);
    if (names) drop(names, ['JavaScript', 'EmbeddedFiles']);
    // an action (not a plain "open at page" destination) can run script or launch things
    if (catalog.lookup(name('OpenAction')) instanceof PDFDict) catalog.delete(name('OpenAction'));
  }
}

/** Deletes every object the document no longer reaches from its trailer */
export async function dropUnreachable(doc: PDFDocument) {
  const { PDFArray, PDFDict, PDFRef, PDFStream } = await loadPdfLibModule();
  const ctx = doc.context;
  const reached = new Set<PDFRef>();
  const todo: unknown[] = Object.values(ctx.trailerInfo);
  while (todo.length) {
    const o = todo.pop();
    if (o instanceof PDFRef) {
      if (reached.has(o)) continue;
      reached.add(o);
      const target = ctx.lookup(o);
      if (target) todo.push(target);
    } else if (o instanceof PDFDict) {
      for (const v of o.values()) todo.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) todo.push(v);
    } else if (o instanceof PDFStream) {
      todo.push(o.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref)) dropped += +ctx.delete(ref);
  }
  return dropped;
}
