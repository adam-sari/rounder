import * as Comlink from 'comlink';
import { PDFDocument } from 'pdf-lib';
import { imageToPdf, mergeDocs, type MergeOptions, type PlanPage } from './merge';

export type LoadStatus = 'ok' | 'encrypted' | 'damaged';
export type MergeProgress = { stage: 'copying'; done: number; total: number } | { stage: 'saving' };

const docs = new Map<string, PDFDocument>();

const api = {
  /** parses one source with pdf-lib; the page count must match what pdf.js saw, or the file needs repair */
  async load(id: string, src: Blob | Uint8Array, pages: number): Promise<LoadStatus> {
    const bytes = src instanceof Blob ? new Uint8Array(await src.arrayBuffer()) : src;
    try {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      if (doc.getPageCount() !== pages) return 'damaged';
      docs.set(id, doc);
      return 'ok';
    } catch (e) {
      return (e as Error)?.name === 'EncryptedPDFError' || /is encrypted/i.test((e as Error)?.message) ? 'encrypted' : 'damaged';
    }
  },

  async merge(plan: PlanPage[], opts: MergeOptions, onProgress: (p: MergeProgress) => void): Promise<Uint8Array> {
    const out = await mergeDocs(plan, docs, opts, (done, total) => onProgress({ stage: 'copying', done, total }));
    docs.clear();
    onProgress({ stage: 'saving' });
    // no need to yield to an event loop in here, so write everything in one go
    const bytes = await out.save({ objectsPerTick: Infinity });
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  async imagePdf(bytes: Uint8Array, type: 'jpeg' | 'png', rotation: number): Promise<Uint8Array> {
    const out = await imageToPdf(bytes, type, rotation);
    return Comlink.transfer(out, [out.buffer]);
  },
};

export type MergeWorker = typeof api;
Comlink.expose(api);
