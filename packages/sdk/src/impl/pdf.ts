import type { PDFDocument } from 'pdf-lib';
import { imageKind } from '@/engines/image/kind';
import { getPageSize, loadEditablePdf, loadPdfLib, openPdf, pdfName, renderPage, runQpdf, PdfPasswordError, type PdfDoc } from '@/engines/pdf';
import { parsePageRangeGroups, parsePageRanges } from '@/engines/pdf/ranges';
import { compressPdf, compressToTarget, type Progress as CompressProgress } from '@/tools/lib/compress-pdf/compress';
import { DEFAULT_SETTINGS, type CompressSettings } from '@/tools/lib/compress-pdf/settings';
import { combinedName, hasTransparency, layoutPage, type PageLayout } from '@/tools/lib/jpg-to-pdf/layout';
import { hasAlpha, jpegOrientation, ORIENTATION_ROTATION } from '@/tools/lib/merge-pdf/image';
import { imageToPdf, mergeDocs, type PlanPage } from '@/tools/lib/merge-pdf/merge';
import { describeRestrictions, encryptArgs, protectProblem, type Permissions } from '@/tools/lib/pdf-security/security';
import { addPageNumbers, addWatermark } from '@/tools/lib/pdf-stamp/stamp';
import { convert, dedupe, findImages } from '@/tools/lib/pdf-images/extract';
import { toMarkdown, toText, type PageText } from '@/tools/lib/pdf-text/format';
import { readPage } from '@/tools/lib/pdf-text/read';
import { pageImageName, planRender } from '@/tools/lib/pdf-to-jpg/render';
import { extractPages } from '@/tools/lib/split-pdf/extract';
import { everyN, fitChunks, outputName } from '@/tools/lib/split-pdf/plan';
import { RounderError, throwIfAborted } from '../core/errors';
import type { Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type Ctx, type OpResult } from '../core/run';
import { formatSize, parseSize } from '../core/size';
import type * as ops from '../ops/pdf';
import { decodeBytes, encodeImage, headerSize } from '../platform/node/image-client';

const PDF = 'application/pdf';
const stem = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || 'document';
const pdfOut = (name: string, data: Uint8Array, meta: Record<string, unknown> = {}, warnings: string[] = []) => new FileOutput({ name, mime: PDF, data, meta, warnings });
const save = (doc: PDFDocument) => doc.save();

async function editable(src: Source, password?: string) {
  return loadEditablePdf(await src.bytes(), { password });
}

/** "1-3, 5" → 0-based page indexes, every page when blank */
const pick = (text: string | undefined, numPages: number) => (text ? parsePageRanges(text, numPages, { unique: true }) : Array.from({ length: numPages }, (_, i) => i));

export async function merge(inputs: Source[], o: OptionsOut<typeof ops.mergePdf>, ctx: Ctx): Promise<OpResult> {
  const sources = new Map<string, PDFDocument>();
  const plan: PlanPage[] = [];
  const names: Record<string, string> = {};
  let firstPdf: string | undefined;
  for (const [i, src] of inputs.entries()) {
    throwIfAborted(ctx.signal);
    ctx.progress({ stage: 'reading', done: i, total: inputs.length, note: src.name });
    const id = `s${i}`;
    const bytes = await src.bytes();
    const kind = await imageKind(new Blob([bytes.subarray(0, 64) as Uint8Array<ArrayBuffer>]));
    let doc: PDFDocument;
    try {
      if (kind === 'jpeg' || kind === 'png') {
        const turn = kind === 'jpeg' ? ORIENTATION_ROTATION[jpegOrientation(bytes)] : 0;
        doc = await loadPdfLib(await imageAsPdf(bytes, kind, turn));
      } else {
        doc = (await loadEditablePdf(bytes, { password: o.password })).doc;
        firstPdf ??= id;
      }
    } catch (e) {
      throw named(src.name, e);
    }
    sources.set(id, doc);
    names[id] = stem(src.name);
    for (let p = 0; p < doc.getPageCount(); p++) plan.push({ source: id, pageIndex: p, rotation: 0 });
  }
  const out = await mergeDocs(plan, sources, { bookmarks: o.bookmarks ? names : undefined, metadataFrom: o.keepInfo ? firstPdf : undefined, title: o.title ?? stem(inputs[0].name) }, (done, total) =>
    ctx.progress({ stage: 'merging', done, total }),
  );
  const pages = out.getPageCount();
  return result({ files: [pdfOut(pdfName(inputs[0].name, '-merged'), await save(out), { pages, inputs: inputs.length })] });
}

/** a JPG keeps its bytes (no recompression); orientations a page turn can't show are redrawn */
async function imageAsPdf(bytes: Uint8Array, kind: 'jpeg' | 'png', turn: number | undefined) {
  if (turn !== undefined) {
    try {
      return await imageToPdf(bytes, kind, turn);
    } catch {
      // an unusual JPG/PNG variant pdf-lib can't embed: redraw it below
    }
  }
  const img = await decodeBytes(bytes, kind);
  const type = hasAlpha(img.data) ? 'png' : 'jpeg';
  return imageToPdf(new Uint8Array(await (await encodeImage(img, { format: type, quality: 92 })).arrayBuffer()), type, 0);
}

const named = (name: string, e: unknown) => {
  if (e instanceof Error && e.name.endsWith('Error') && 'kind' in e) e.message = `${name}: ${e.message}`;
  return e;
};

export async function split(inputs: Source[], o: OptionsOut<typeof ops.splitPdf>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { doc } = await editable(src, o.password);
  const n = doc.getPageCount();
  const base = stem(src.name);
  const files: FileOutput[] = [];
  const warnings: string[] = [];
  if (o.maxSize !== undefined) {
    const limit = parseSize(o.maxSize);
    const chunks = await fitChunks(n, limit, async (start, end) => {
      throwIfAborted(ctx.signal);
      const bytes = await save(await extractPages(doc, Array.from({ length: end - start }, (_, k) => start + k)));
      return { size: bytes.length, bytes };
    }, { onChunk: (c) => ctx.progress({ stage: 'splitting', done: c.end, total: n }) });
    chunks.forEach((c, i) => {
      const indices = Array.from({ length: c.end - c.start }, (_, k) => c.start + k);
      if (c.over) warnings.push(`Page ${c.start + 1} alone is ${formatSize(c.out.size)}, over the ${formatSize(limit)} limit.`);
      files.push(pdfOut(outputName(base, indices, i), c.out.bytes, { pages: indices.map((p) => p + 1) }));
    });
    return result({ files, warnings });
  }
  const groups = o.ranges ? parsePageRangeGroups(o.ranges, n) : everyN(n, o.every ?? 1);
  for (const [i, indices] of groups.entries()) {
    throwIfAborted(ctx.signal);
    ctx.progress({ stage: 'splitting', done: i, total: groups.length });
    files.push(pdfOut(outputName(base, indices, i), await save(await extractPages(doc, indices)), { pages: indices.map((p) => p + 1) }));
  }
  return result({ files });
}

export async function compress(inputs: Source[], o: OptionsOut<typeof ops.compressPdf>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const blob = new Blob([(await src.bytes()) as Uint8Array<ArrayBuffer>], { type: PDF });
  const onprogress = (p: CompressProgress) => ctx.progress(p.stage === 'optimize' ? { stage: 'optimizing' } : { stage: p.stage === 'images' ? 'images' : 'estimating', done: p.done, total: p.total });
  const run = { password: o.password, signal: ctx.signal, onprogress };
  const name = pdfName(src.name, '-compressed');
  const warnings: string[] = [];
  if (o.target !== undefined) {
    const target = parseSize(o.target);
    const r = await compressToTarget(blob, target, { grayscale: o.grayscale, stripMetadata: o.stripMetadata }, run);
    const data = new Uint8Array(await r.blob.arrayBuffer());
    if (!r.fits && r.miss) warnings.push(`${r.miss.why} Splitting it into ${r.miss.parts} parts would fit.`);
    return result({ files: [pdfOut(name, data, { kept: r.kept, fits: r.fits, target, rung: r.rung, attempts: r.attempts, images: r.images, miss: r.miss }, warnings)], warnings });
  }
  const custom = o.dpi !== undefined || o.quality !== undefined;
  const settings: CompressSettings = { ...DEFAULT_SETTINGS, level: custom ? 'custom' : o.level, dpi: o.dpi ?? 150, quality: o.quality ?? 75, grayscale: o.grayscale, stripMetadata: o.stripMetadata };
  const r = await compressPdf(blob, settings, run);
  if (r.kept) warnings.push("It's already about as small as this level gets, so the result is the original file.");
  const data = new Uint8Array(await r.blob.arrayBuffer());
  return result({ files: [pdfOut(name, data, { kept: r.kept, images: r.images, decrypted: r.decrypted }, warnings)], warnings });
}

export async function protect(inputs: Source[], o: OptionsOut<typeof ops.protectPdf>): Promise<OpResult> {
  const [src] = inputs;
  const allow: Permissions = { print: o.print, copy: o.copy, edit: o.edit, comment: o.comment, forms: o.forms };
  const restrict = Object.values(allow).some((v) => !v);
  const settings = { openPassword: o.password, confirm: o.password, ownerPassword: o.ownerPassword ?? '', restrict, allow };
  const problem = protectProblem(settings);
  if (problem) throw new RounderError('invalid-options', problem);
  const out = await runQpdf(encryptArgs(settings), await src.bytes());
  return result({ files: [pdfOut(pdfName(src.name, '-protected'), out, { restricted: restrict ? Object.keys(allow).filter((k) => !allow[k as keyof Permissions]) : [] })] });
}

export async function unlock(inputs: Source[], o: OptionsOut<typeof ops.unlockPdf>): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const warnings: string[] = [];
  const doc = await openPdf(bytes, { password: o.password });
  const allowed = await doc.proxy.getPermissions();
  const filter = (((await doc.proxy.getMetadata()).info ?? {}) as { EncryptFilterName?: string | null }).EncryptFilterName;
  await doc.destroy();
  if (filter == null && allowed === null) warnings.push("This PDF wasn't locked; the copy is the same document.");
  const out = await runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], bytes, { password: o.password });
  return result({ files: [pdfOut(pdfName(src.name, '-unlocked'), out, { removed: describeRestrictions(allowed) }, warnings)], warnings });
}

export async function organize(inputs: Source[], o: OptionsOut<typeof ops.organizePdf>): Promise<OpResult> {
  const [src] = inputs;
  const { doc } = await editable(src, o.password);
  const n = doc.getPageCount();
  const warnings: string[] = [];
  let order = Array.from({ length: n }, (_, i) => i);
  if (o.order === 'reverse') order.reverse();
  else if (o.order) {
    order = parsePageRanges(o.order, n);
    const missing = n - new Set(order).size;
    if (missing > 0) warnings.push(`${missing} page${missing === 1 ? ' was' : 's were'} left out of the order, so ${missing === 1 ? "it isn't" : "they aren't"} in the result.`);
  }
  const removed = new Set(o.remove ? parsePageRanges(o.remove, n) : []);
  const turned = new Set(o.rotate ? pick(o.rotatePages, n) : []);
  const plan = order.filter((i) => !removed.has(i)).map((i) => ({ source: 'a', pageIndex: i, rotation: turned.has(i) ? (o.rotate ?? 0) : 0 }));
  if (!plan.length) throw new RounderError('invalid-options', "That would remove every page. Keep at least one.");
  const out = await mergeDocs(plan, new Map([['a', doc]]), { metadataFrom: 'a', title: stem(src.name) });
  return result({ files: [pdfOut(pdfName(src.name, '-organized'), await save(out), { pages: plan.length })], warnings });
}

export async function numbers(inputs: Source[], o: OptionsOut<typeof ops.addPageNumbers>): Promise<OpResult> {
  const [src] = inputs;
  const { doc } = await editable(src, o.password);
  const count = await addPageNumbers(doc, { pages: pick(o.pages, doc.getPageCount()), skipFirst: o.skipFirst, start: o.start, template: o.format, anchor: o.position, margin: o.margin, family: o.font, bold: o.bold, size: o.size, color: o.color });
  return result({ files: [pdfOut(pdfName(src.name, '-numbered'), await save(doc), { numbered: count })] });
}

export async function watermark(inputs: Source[], o: OptionsOut<typeof ops.watermarkPdf>): Promise<OpResult> {
  const [src] = inputs;
  const { doc } = await editable(src, o.password);
  const count = await addWatermark(doc, {
    mark: { kind: 'text', text: o.text, family: o.font, bold: o.bold, size: o.size, color: o.color },
    pages: pick(o.pages, doc.getPageCount()),
    opacity: o.opacity,
    angleMode: typeof o.angle === 'number' ? 'custom' : o.angle,
    angle: typeof o.angle === 'number' ? o.angle : 0,
    placement: o.position,
    margin: o.margin,
    under: o.under,
  });
  return result({ files: [pdfOut(pdfName(src.name, '-watermarked'), await save(doc), { stamped: count })] });
}

export async function fromImages(inputs: Source[], o: OptionsOut<typeof ops.jpgToPdf>, ctx: Ctx): Promise<OpResult> {
  const { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(stem(inputs[0].name));
  doc.setCreator('Rounder');
  const add = async (bytes: Uint8Array, type: 'jpg' | 'png', layout: PageLayout) => {
    const image = type === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const { width, height, box, image: r } = layout;
    const page = doc.addPage([width, height]);
    // layout is top-left based, PDF space is bottom-left
    const y = (rect: { y: number; h: number }) => height - rect.y - rect.h;
    const clipped = r.x < box.x - 0.01 || r.y < box.y - 0.01 || r.w > box.w + 0.01 || r.h > box.h + 0.01;
    if (clipped) page.pushOperators(pushGraphicsState(), rectangle(box.x, y(box), box.w, box.h), clip(), endPath());
    page.drawImage(image, { x: r.x, y: y(r), width: r.w, height: r.h });
    if (clipped) page.pushOperators(popGraphicsState());
  };
  const opts = { size: o.pageSize, orientation: o.orientation, margin: o.margin, placement: o.placement } as const;
  for (const [i, src] of inputs.entries()) {
    throwIfAborted(ctx.signal);
    ctx.progress({ stage: 'adding', done: i, total: inputs.length, note: src.name });
    const bytes = await src.bytes();
    const kind = await imageKind(new Blob([bytes.subarray(0, 64) as Uint8Array<ArrayBuffer>]));
    const dims = kind === 'jpeg' || kind === 'png' ? headerSize(bytes, kind) : null;
    // upright JPGs and PNGs go in as they are; the rest (and rotated photos) are decoded, which applies the rotation
    if (dims && (kind === 'png' || jpegOrientation(bytes) === 1)) {
      try {
        await add(bytes, kind === 'jpeg' ? 'jpg' : 'png', layoutPage(dims.width, dims.height, opts));
        continue;
      } catch {
        // an unusual variant pdf-lib can't embed: redraw it below
      }
    }
    try {
      const img = await decodeBytes(bytes, kind);
      const png = hasTransparency(img.data);
      const encoded = new Uint8Array(await (await encodeImage(img, { format: png ? 'png' : 'jpeg', quality: 92 })).arrayBuffer());
      await add(encoded, png ? 'png' : 'jpg', layoutPage(img.width, img.height, opts));
    } catch (e) {
      throw named(src.name, e);
    }
  }
  return result({ files: [pdfOut(combinedName(inputs.map((s) => s.name)), await save(doc), { pages: inputs.length })] });
}

async function withPdfjs<T>(src: Source, password: string | undefined, fn: (doc: PdfDoc) => Promise<T>): Promise<T> {
  const doc = await openPdf(await src.bytes(), { password });
  try {
    return await fn(doc);
  } finally {
    await doc.destroy();
  }
}

export async function toTextOp(inputs: Source[], o: OptionsOut<typeof ops.pdfToText>, ctx: Ctx): Promise<OpResult> {
  return withPdfjs(inputs[0], o.password, async (doc) => {
    const wanted = pick(o.pages, doc.numPages);
    const parts: string[] = [];
    let scanned = 0;
    for (const [k, i] of wanted.entries()) {
      throwIfAborted(ctx.signal);
      ctx.progress({ stage: 'reading', done: k, total: wanted.length });
      let page: PageText = null;
      try {
        const r = await readPage(doc, i);
        page = r.paragraphs;
        if (r.scanned) scanned++;
      } catch {
        page = null;
      }
      parts.push(o.format === 'markdown' ? toMarkdown([page], { markers: o.markers, firstPage: i }).trimEnd() : toText([page], { markers: o.markers, join: o.join, firstPage: i }).trimEnd());
    }
    const text = parts.filter(Boolean).join('\n\n') + '\n';
    const warnings = scanned ? [`${scanned} page${scanned === 1 ? ' is' : 's are'} scanned images with no text layer. OCR them first (roundertools.com/ocr-pdf).`] : [];
    return result({ text, warnings, data: { pages: wanted.length, scanned } });
  });
}

export async function toImages(inputs: Source[], o: OptionsOut<typeof ops.pdfToJpg>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  return withPdfjs(src, o.password, async (doc) => {
    const wanted = pick(o.pages, doc.numPages);
    const ext = o.format === 'png' ? 'png' : 'jpg';
    const files: FileOutput[] = [];
    for (const [k, i] of wanted.entries()) {
      throwIfAborted(ctx.signal);
      ctx.progress({ stage: 'rendering', done: k, total: wanted.length });
      const size = await getPageSize(doc, i);
      const plan = planRender(size.width, size.height, { mode: 'dpi', dpi: o.dpi });
      const canvas = (await renderPage(doc, i, { scale: plan.scale, signal: ctx.signal })) as unknown as { encode(f: string, q?: number): Promise<Uint8Array>; width: number; height: number };
      const data = new Uint8Array(o.format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg', o.quality));
      files.push(new FileOutput({ name: pageImageName(src.name, i, ext, doc.numPages), mime: o.format === 'png' ? 'image/png' : 'image/jpeg', data, meta: { page: i + 1, width: canvas.width, height: canvas.height, dpi: plan.dpi } }));
    }
    return result({ files });
  });
}

export async function extractImagesOp(inputs: Source[], o: OptionsOut<typeof ops.extractImages>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { doc } = await editable(src, o.password);
  const refs = await dedupe(findImages(doc));
  const files: FileOutput[] = [];
  let skipped = 0;
  for (const [k, ref] of refs.entries()) {
    throwIfAborted(ctx.signal);
    ctx.progress({ stage: 'extracting', done: k, total: refs.length });
    const img = convert(ref);
    if (Math.max(img.width, img.height) < o.minSize) continue;
    if (!img.file) {
      skipped++;
      continue;
    }
    const name = `${stem(src.name)}-image-${String(files.length + 1).padStart(String(refs.length).length, '0')}.${img.file.ext}`;
    files.push(new FileOutput({ name, mime: img.file.ext === 'jpg' ? 'image/jpeg' : 'image/png', data: img.file.bytes, meta: { pages: img.pages.map((p) => p + 1), width: img.width, height: img.height, color: img.color, encoding: img.encoding } }));
  }
  const warnings = skipped ? [`${skipped} image${skipped === 1 ? ' is' : 's are'} stored as JPEG 2000, JBIG2 or CMYK, which the SDK can't save yet. roundertools.com/extract-images-from-pdf can.`] : [];
  if (!files.length && !skipped) warnings.push('This PDF has no images (at least none at the minimum size).');
  return result({ files, warnings });
}

/** pages, encryption, restrictions and document info */
export async function info(src: Source, password?: string) {
  const bytes = await src.bytes();
  let encrypted = false;
  try {
    await loadPdfLib(bytes);
  } catch (e) {
    if (e instanceof PdfPasswordError) encrypted = true;
    else throw e;
  }
  return withPdfjs(src, password, async (doc) => {
    const [allowed, meta, size] = await Promise.all([doc.proxy.getPermissions(), doc.proxy.getMetadata(), getPageSize(doc, 0)]);
    const i = (meta.info ?? {}) as Record<string, unknown>;
    const text = (k: string) => (typeof i[k] === 'string' && i[k] ? (i[k] as string) : undefined);
    return {
      kind: 'pdf',
      pages: doc.numPages,
      encrypted: encrypted || i.EncryptFilterName != null || allowed !== null,
      restrictions: describeRestrictions(allowed),
      pageSize: { width: Math.round(size.width), height: Math.round(size.height), unit: 'pt' },
      title: text('Title'),
      author: text('Author'),
      creator: text('Creator'),
      producer: text('Producer'),
      version: text('PDFFormatVersion'),
    };
  });
}
