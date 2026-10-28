import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { abortError, DAMAGED, PdfError, PdfPasswordError } from './errors';
import { documentOptions, importPdfjs, newCanvas, pdfjsAsset } from './pdfjs-env';

type PdfjsModule = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfjsModule> | undefined;

/** pdf.js itself, loaded on first use; parsing runs in its own worker */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjs ??= importPdfjs();
  return pdfjs;
}

let nextDoc = 0;

/** An open PDF for viewing, thumbnails and text. Page indexes are 0-based everywhere. */
export class PdfDoc {
  readonly id = `pdf${++nextDoc}`;
  readonly numPages: number;
  #destroyed = false;

  constructor(
    readonly proxy: PDFDocumentProxy,
    /** the file name, when opened from a File */
    readonly name: string,
  ) {
    this.numPages = proxy.numPages;
  }

  async getPage(pageIndex: number): Promise<PDFPageProxy> {
    if (pageIndex < 0 || pageIndex >= this.numPages) throw new RangeError(`No page at index ${pageIndex}`);
    return this.proxy.getPage(pageIndex + 1);
  }

  get destroyed() {
    return this.#destroyed;
  }

  /** frees the worker-side document and this doc's cached thumbnails */
  async destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    dropThumbnails(this.id);
    await this.proxy.loadingTask.destroy();
  }
}

/** One page as shown in PdfPageGrid; reorder, rotate and remove these, then assemblePdf() */
export interface PageRef {
  /** unique within a grid */
  id: string;
  doc: PdfDoc;
  pageIndex: number;
  /** extra clockwise rotation chosen by the user: 0 | 90 | 180 | 270 */
  rotation: number;
}

export function pageRefs(doc: PdfDoc): PageRef[] {
  return Array.from({ length: doc.numPages }, (_, i) => ({ id: `${doc.id}:${i}`, doc, pageIndex: i, rotation: 0 }));
}

export type PdfSource = File | Blob | Uint8Array | ArrayBuffer;

/**
 * Opens a PDF with pdf.js. Throws PdfPasswordError when it's encrypted and the
 * password is missing or wrong, PdfError for anything that isn't a readable PDF.
 * A Uint8Array/ArrayBuffer you pass in is copied, so you can still use it afterwards.
 */
export async function openPdf(src: PdfSource, { password }: { password?: string } = {}): Promise<PdfDoc> {
  const lib = await loadPdfjs();
  // pdf.js takes ownership of the bytes it's given, hence the copies
  const data = src instanceof Blob ? new Uint8Array(await src.arrayBuffer()) : new Uint8Array(src instanceof ArrayBuffer ? src.slice(0) : src);
  const task = lib.getDocument({
    data,
    password,
    cMapUrl: pdfjsAsset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAsset('standard_fonts'),
    wasmUrl: pdfjsAsset('wasm'),
    iccUrl: pdfjsAsset('iccs'),
    // annotations / form scripts never run
    enableXfa: false,
    ...documentOptions,
  });
  try {
    return new PdfDoc(await task.promise, src instanceof File ? src.name : '');
  } catch (e) {
    void task.destroy();
    const err = e as Error & { code?: number };
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordError(err.code === lib.PasswordResponses.INCORRECT_PASSWORD ? 'wrongPassword' : 'needsPassword');
    }
    if (err?.name === 'InvalidPDFException') throw new PdfError(DAMAGED, 'damaged');
    throw new PdfError(`This PDF couldn't be opened${err?.message ? ` (${err.message})` : ''}.`);
  }
}

export interface PageSize {
  /** points (1/72 inch), as displayed: rotation already applied */
  width: number;
  height: number;
  /** the page's own /Rotate, 0 | 90 | 180 | 270 */
  rotate: number;
}

export async function getPageSize(doc: PdfDoc, pageIndex: number): Promise<PageSize> {
  const page = await doc.getPage(pageIndex);
  const { width, height } = page.getViewport({ scale: 1 });
  return { width, height, rotate: page.rotate };
}

export const normalizeRotation = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

export interface RenderOptions {
  /** pick one: scale (1 = 72 dpi), dpi, or a target width and/or height in pixels (fits inside both) */
  scale?: number;
  dpi?: number;
  width?: number;
  height?: number;
  /** extra rotation on top of the page's own, in degrees (multiples of 90) */
  rotation?: number;
  /** any canvas fillStyle; 'transparent' keeps alpha. Default white */
  background?: string;
  /** caps width × height so huge pages don't fail silently (iOS Safari stops at ~16.7M px) */
  maxPixels?: number;
  /** include form fields and annotations with appearances. Default true */
  annotations?: boolean;
  signal?: AbortSignal;
}

const MAX_PIXELS = 16_777_216;

/** Works out the scale for the options, applying the pixel cap */
function scaleFor(base: { width: number; height: number }, o: RenderOptions) {
  let s = o.scale ?? 1;
  if (o.dpi) s = o.dpi / 72;
  else if (o.width || o.height) s = Math.min(o.width ? o.width / base.width : Infinity, o.height ? o.height / base.height : Infinity);
  const max = o.maxPixels ?? MAX_PIXELS;
  const px = base.width * base.height * s * s;
  return px > max ? s * Math.sqrt(max / px) : s;
}

/**
 * Renders a page. Returns an HTMLCanvasElement by default, or an ImageBitmap
 * with `{ output: 'bitmap' }` (drawn on an OffscreenCanvas where supported).
 * Abort via `signal` to cancel; the promise then rejects with an AbortError.
 */
export async function renderPage(doc: PdfDoc, pageIndex: number, o?: RenderOptions & { output?: 'canvas' }): Promise<HTMLCanvasElement>;
export async function renderPage(doc: PdfDoc, pageIndex: number, o: RenderOptions & { output: 'bitmap' }): Promise<ImageBitmap>;
export async function renderPage(doc: PdfDoc, pageIndex: number, o: RenderOptions & { output?: 'canvas' | 'bitmap' } = {}) {
  const { signal } = o;
  if (signal?.aborted) throw abortError();
  const page = await doc.getPage(pageIndex);
  if (signal?.aborted) throw abortError();
  const rotation = normalizeRotation(page.rotate + (o.rotation ?? 0));
  const scale = scaleFor(page.getViewport({ scale: 1, rotation }), o);
  const viewport = page.getViewport({ scale, rotation });
  const w = Math.max(1, Math.floor(viewport.width));
  const h = Math.max(1, Math.floor(viewport.height));

  const offscreen = o.output === 'bitmap' && typeof OffscreenCanvas !== 'undefined';
  const canvas = newCanvas(w, h, offscreen);
  const transparent = o.background === 'transparent';
  // created first so pdf.js reuses this context (its own default has no alpha)
  canvas.getContext('2d', { alpha: transparent });

  const lib = await loadPdfjs();
  if (signal?.aborted) throw abortError();
  const task = page.render({
    canvas: canvas as HTMLCanvasElement,
    viewport,
    background: o.background ?? 'white',
    annotationMode: o.annotations === false ? lib.AnnotationMode.DISABLE : lib.AnnotationMode.ENABLE,
  });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
  } catch (e) {
    if ((e as Error)?.name === 'RenderingCancelledException' || signal?.aborted) throw abortError();
    throw new PdfError(`Page ${pageIndex + 1} couldn't be drawn. The file may be damaged.`, 'damaged');
  } finally {
    signal?.removeEventListener('abort', cancel);
    // frees the page's parsed drawing data; matters across hundreds of pages
    page.cleanup();
  }
  if (o.output !== 'bitmap') return canvas;
  if (canvas instanceof OffscreenCanvas) return canvas.transferToImageBitmap();
  return createImageBitmap(canvas);
}

/** Encodes a rendered page; the main thread isn't blocked on OffscreenCanvas */
export async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PdfError('The image could not be encoded.'))), type, quality));
  }
  return canvas.convertToBlob({ type, quality });
}

/* ---------------- thumbnails ---------------- */

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

const THUMB_CACHE = 400;
const cache = new Map<string, Thumbnail>(); // insertion order = recency
const inflight = new Map<string, { promise: Promise<Thumbnail>; waiters: number; ctrl: AbortController }>();
const queue: (() => void)[] = [];
let running = 0;

function dropThumbnails(docId: string) {
  for (const [key, t] of cache) {
    if (!key.startsWith(`${docId}:`)) continue;
    URL.revokeObjectURL(t.url);
    cache.delete(key);
  }
}

function remember(key: string, t: Thumbnail) {
  cache.set(key, t);
  while (cache.size > THUMB_CACHE) {
    const [oldKey, old] = cache.entries().next().value!;
    URL.revokeObjectURL(old.url);
    cache.delete(oldKey);
  }
}

// a few at a time, newest request first, so fast scrolling renders what's on screen
async function slot<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  // a queued job is handed the finishing job's slot, so `running` never overshoots
  if (running >= 3) {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener('abort', drop);
        resolve();
      };
      const drop = () => {
        queue.splice(queue.indexOf(go), 1);
        reject(abortError());
      };
      queue.push(go);
      signal.addEventListener('abort', drop, { once: true });
    });
  } else running++;
  try {
    return await fn();
  } finally {
    const next = queue.pop();
    if (next) next();
    else running--;
  }
}

/**
 * A cached thumbnail as an object URL (JPEG). `width` is in pixels, so pass
 * css width × devicePixelRatio. The cache owns the URL: don't revoke it. It
 * stays valid until doc.destroy() or until it's among the least recently used
 * past 400 thumbnails; an <img> that already shows it keeps working, but for a
 * new element (or on an img error) call getThumbnail again.
 * Cancelling via `signal` only stops the render if no one else is waiting on it.
 */
export function getThumbnail(doc: PdfDoc, pageIndex: number, { width = 240, rotation = 0, signal }: { width?: number; rotation?: number; signal?: AbortSignal } = {}): Promise<Thumbnail> {
  const key = `${doc.id}:${pageIndex}:${Math.round(width)}:${normalizeRotation(rotation)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  let job = inflight.get(key);
  if (!job || job.ctrl.signal.aborted) {
    const ctrl = new AbortController();
    const promise = slot(async () => {
      const canvas = await renderPage(doc, pageIndex, { width, rotation, signal: ctrl.signal, maxPixels: 4_000_000 });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
      const t = { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
      canvas.width = 0; // frees its pixels now rather than at GC
      if (doc.destroyed) URL.revokeObjectURL(t.url);
      else remember(key, t);
      return t;
    }, ctrl.signal).finally(() => {
      // an aborted job may already have been replaced by a fresh one for the same key
      if (inflight.get(key) === created) inflight.delete(key);
    });
    const created = (job = { promise, waiters: 0, ctrl });
    inflight.set(key, job);
  }
  const current = job;
  current.waiters++;
  if (!signal) return current.promise;
  if (signal.aborted) {
    if (--current.waiters === 0) current.ctrl.abort();
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const leave = () => {
      if (--current.waiters === 0) current.ctrl.abort();
      reject(abortError());
    };
    signal.addEventListener('abort', leave, { once: true });
    current.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
  });
}

/* ---------------- text ---------------- */

export interface PdfTextItem {
  str: string;
  /** pdf.js text matrix in PDF user space: [a, b, c, d, e, f] */
  transform: number[];
  /** box in points from the page's top-left corner (unrotated, i.e. ignoring /Rotate), ascent to descent */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  /** a line break follows this item */
  hasEOL: boolean;
  dir: string;
}

export interface PdfPageText {
  items: PdfTextItem[];
  /** unrotated page size in points */
  width: number;
  height: number;
  /** [x1, y1, x2, y2] of the page box in PDF user space, for converting back to pdf-lib coordinates */
  viewBox: number[];
}

/**
 * Text with positions, for search, redaction and comparing. To get pdf-lib
 * coordinates (bottom-left origin): pdfX = viewBox[0] + x, pdfY = viewBox[3] - y - height.
 */
export async function getText(doc: PdfDoc, pageIndex: number): Promise<PdfPageText> {
  const [page, lib] = await Promise.all([doc.getPage(pageIndex), loadPdfjs()]);
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const content = await page.getTextContent();
  const items: PdfTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const m = lib.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(m[2], m[3]);
    const style = content.styles[item.fontName];
    const ascent = style?.ascent || 0.8;
    const descent = style?.descent || -0.2;
    items.push({
      str: item.str,
      transform: item.transform,
      x: m[4],
      y: m[5] - size * ascent,
      width: item.width,
      height: size * (ascent - descent),
      fontName: item.fontName,
      hasEOL: item.hasEOL,
      dir: item.dir,
    });
  }
  return { items, width: viewport.width, height: viewport.height, viewBox: [...page.view] };
}

/** Plain text of a page, with line breaks where pdf.js found them */
export function textToString(items: Pick<PdfTextItem, 'str' | 'hasEOL'>[]) {
  return items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');
}
