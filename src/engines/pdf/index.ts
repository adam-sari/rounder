/*
 * PDF engine: everything here runs on the user's device. Heavy libraries load
 * on first use (pdf.js, pdf-lib, fontkit, qpdf), so importing this is cheap.
 * Page indexes are 0-based in code; people see 1-based numbers.
 *
 * Viewing / thumbnails / text (pdf.js, parses in its own worker)
 *   const doc = await openPdf(file, { password });   // PdfDoc: numPages, getPage(i), destroy()
 *   const canvas = await renderPage(doc, 0, { width: 800 * devicePixelRatio, rotation: 90, signal });
 *   const bitmap = await renderPage(doc, 0, { dpi: 150, output: 'bitmap' });
 *   const { url } = await getThumbnail(doc, 0, { width: 240 });   // cached object URL, don't revoke
 *   const { items } = await getText(doc, 0);        // str + box in points from the top-left
 *   doc.destroy() when done (also drops its thumbnails).
 *
 * Editing (pdf-lib)
 *   const { doc } = await loadEditablePdf(file, { password });   // decrypts / repairs via qpdf when needed
 *   const out = await assemblePdf(pageRefs, new Map([[pdfDoc.id, doc]]));  // reorder/rotate/merge/delete
 *   const font = await embedFontWithFallback(out, texts);    // Helvetica, or Noto Sans for Greek/Cyrillic/…
 *   downloadBlob(await savePdf(out), pdfName(file.name, '-organized'));
 *   const { rgb, degrees, StandardFonts } = await loadPdfLibModule();
 *
 * qpdf (worker): encrypt, decrypt, lossless compression, linearize. See qpdf.ts for recipes.
 *   const locked = await runQpdf(['--encrypt', `--user-password=${pw}`, `--owner-password=${pw}`, '--bits=256', '--', 'in.pdf', 'out.pdf'], bytes);
 *
 * Page ranges: parsePageRanges('1-3, 5, 8-', numPages) → [0,1,2,4,7,…]; throws PageRangeError
 * with a message you can show. parsePageRangeGroups for "one file per range", formatPageRanges back.
 *
 * Errors: everything throws PdfError (message is user-facing) or its subclass
 * PdfPasswordError (reason 'needsPassword' | 'wrongPassword'). Aborted renders
 * reject with an AbortError: check isAbort(e) and ignore those.
 *
 * Export pages as images: canvasToBlob(await renderPage(doc, i, { dpi: 150 }), 'image/jpeg', 0.9),
 * then set canvas.width = 0 so the browser can free it before the next page.
 *
 * Components (src/components/tool/)
 *   <PdfDrop multiple onopen={({ file, doc, password }) => …} />   drop + open + unlock prompt, per file
 *   <PdfPageGrid bind:pages bind:selected selectable reorder rotate remove />
 *       with `let pages = $state(pageRefs(doc))`; PdfDoc is a class, so $state leaves it unproxied
 *   <PdfPasswordPrompt> for your own unlock flow: catch PdfPasswordError, prompt, retry.
 *
 * Static files: public/vendor/pdfjs/ (cmaps, standard_fonts, wasm, iccs, copied from
 * pdfjs-dist 6.4.299; recopy when upgrading) and public/fonts/pdf/ (Noto Sans, OFL).
 * Sample files for testing: tests/fixtures/pdf/ (regenerate with node tests/fixtures/pdf/generate.mjs).
 */
export * from './errors';
export * from './ranges';
export * from './pdfjs';
export * from './lib';
export * from './qpdf';
