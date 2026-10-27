/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { PDFDocument, ParseSpeeds } from 'pdf-lib';
import { convert, dedupe, findImages, type FoundImage } from './extract';

export type ScanStatus = 'ok' | 'encrypted' | 'damaged';

const api = {
  /** Finds and converts every image, handing each one over as soon as it's ready */
  async scan(bytes: Uint8Array, onProgress: (done: number, total: number) => void, onImage: (image: FoundImage) => Promise<void>): Promise<ScanStatus> {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest });
    } catch (e) {
      return (e as Error)?.name === 'EncryptedPDFError' || /is encrypted/i.test((e as Error)?.message) ? 'encrypted' : 'damaged';
    }
    let refs;
    try {
      refs = await dedupe(findImages(doc));
    } catch {
      return 'damaged';
    }
    await onProgress(0, refs.length);
    for (const [i, ref] of refs.entries()) {
      const image = convert(ref);
      // awaited so a slow main thread holds the worker back instead of piling up images
      await onImage(image.file ? Comlink.transfer(image, [image.file.bytes.buffer]) : image);
      await onProgress(i + 1, refs.length);
    }
    return 'ok';
  },
};

export type PdfImagesWorker = typeof api;

Comlink.expose(api);
