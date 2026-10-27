import * as Comlink from 'comlink';
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { extractPages } from './extract';
import { fitChunks } from './plan';

/* pdf-lib parsing and saving can take seconds on big files, so they run here */

let src: PDFDocument | undefined;

async function extract(indices: number[]): Promise<Uint8Array> {
  if (!src) throw new Error('No PDF is loaded.');
  const out = await extractPages(src, indices);
  const title = src.getTitle();
  const author = src.getAuthor();
  if (title) out.setTitle(title);
  if (author) out.setAuthor(author);
  return out.save();
}

const api = {
  /**
   * 'encrypted' and 'damaged' tell the page to run the file through qpdf first.
   * A page count that differs from what pdf.js found (the thumbnails) also counts
   * as damaged, so page numbers on screen always match the pages copied.
   */
  async open(data: Blob | Uint8Array, numPages: number): Promise<'ok' | 'encrypted' | 'damaged'> {
    src = undefined;
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    try {
      // updateMetadata: false keeps the original producer and dates
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      if (doc.getPageCount() !== numPages) return 'damaged';
      src = doc;
      return 'ok';
    } catch (e) {
      if (e instanceof RangeError) throw e; // out of memory: a repair pass wouldn't help
      return (e as Error)?.name === 'EncryptedPDFError' || /is encrypted/i.test((e as Error)?.message) ? 'encrypted' : 'damaged';
    }
  },

  async build(indices: number[]): Promise<Uint8Array> {
    const bytes = await extract(indices);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  /** runs of pages, each saved file at most `limit` bytes (unless one page alone is bigger); `guess` = pages per file to try first */
  async bySize(limit: number, guess: number, onProgress: (pagesDone: number) => void) {
    if (!src) throw new Error('No PDF is loaded.');
    const numPages = src.getPageCount();
    const chunks = await fitChunks(numPages, limit, async (start, end) => {
      const bytes = await extract(Array.from({ length: end - start }, (_, k) => start + k));
      return { size: bytes.length, bytes };
    }, { guess, onChunk: (c) => onProgress(c.end) });
    const out = chunks.map((c) => ({ start: c.start, end: c.end, over: c.over, bytes: c.out.bytes }));
    return Comlink.transfer(out, out.map((c) => c.bytes.buffer as ArrayBuffer));
  },

  /** stored, not deflated: PDF streams are already compressed */
  async zip(files: { name: string; data: Blob }[]): Promise<Uint8Array> {
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
    for (const f of files) entries[f.name] = [new Uint8Array(await f.data.arrayBuffer()), { level: 0 }];
    const bytes = zipSync(entries);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type SplitWorker = typeof api;
Comlink.expose(api);
