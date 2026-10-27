/** The file types the writing tools take */
export const TEXT_ACCEPT = '.txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf';

/** Plain text of a .txt, .md or .pdf file (PDF text through pdf.js, wrapped lines joined into paragraphs) */
export async function readTextFile(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return file.text();
  const [{ openPdf, PdfPasswordError }, { readAll }, { toText }] = await Promise.all([import('@/engines/pdf'), import('@/tools/lib/pdf-text/read'), import('@/tools/lib/pdf-text/format')]);
  let doc;
  try {
    doc = await openPdf(file);
  } catch (err) {
    if (err instanceof PdfPasswordError) throw new Error('This PDF is password-protected. Unlock it first, then drop it here again.');
    throw err;
  }
  try {
    const pages: Parameters<typeof toText>[0] = [];
    await readAll(doc, (_, page) => pages.push(page.paragraphs), new AbortController().signal);
    const text = toText(pages, { markers: false, join: true }).trim();
    if (!text) throw new Error("This PDF has no text to read. It's probably a scan: run it through OCR first.");
    return text;
  } finally {
    doc.destroy();
  }
}
