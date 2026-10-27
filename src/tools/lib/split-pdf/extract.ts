import { PDFDocument, PDFNull, PDFObjectCopier, PDFPage, type PDFRef } from 'pdf-lib';

/**
 * A new PDF made of `indices` of `src`. Plain copyPages follows every link
 * annotation to its target page, so a linked contents page would carry the
 * pages it points to (and their images) as hidden objects, and links between
 * kept pages would point at orphan copies. Here kept pages' refs map to their
 * new pages and the rest map to null, so links inside the selection still work
 * and links out of it go nowhere.
 */
export async function extractPages(src: PDFDocument, indices: number[]): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  const copier = PDFObjectCopier.for(src.context, out.context);
  // private in the typings; it's the copier's ref → copy map
  const mapped = (copier as unknown as { traversedObjects: Map<unknown, unknown> }).traversedObjects;
  const pages = src.getPages();
  const keep = new Set(indices);
  pages.forEach((p, i) => mapped.set(p.ref, keep.has(i) ? out.context.nextRef() : PDFNull));
  const placed = new Set<number>();
  for (const i of indices) {
    const node = copier.copy(pages[i].node);
    let ref: PDFRef;
    if (placed.has(i)) ref = out.context.register(node);
    else {
      ref = mapped.get(pages[i].ref) as PDFRef;
      out.context.assign(ref, node);
      placed.add(i);
    }
    out.addPage(PDFPage.of(node, ref, out));
  }
  return out;
}
