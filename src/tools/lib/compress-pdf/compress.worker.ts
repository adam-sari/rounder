/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { PDFDocument, ParseSpeeds } from 'pdf-lib';
import { optimizeImages, type Codec, type ImageStats } from './images';
import type { Pixels } from './pixels';
import type { ImageOptions } from './settings';

/** the page's side of the conversation: JPEG encoding runs in the shared image engine */
export interface Host {
  encode(img: ImageData, quality: number): Promise<ArrayBuffer>;
  progress(done: number, total: number): void;
}

export type ImagePassResult = { status: 'ok'; stats: ImageStats; bytes?: Uint8Array } | { status: 'encrypted' | 'unreadable' };

type Source = ImageBitmap | OffscreenCanvas;

/** Scales down by halving first, since one big bilinear jump aliases */
function draw(src: Source, width: number, height: number): Pixels {
  let cur = src;
  let w = src.width;
  let h = src.height;
  while (w / 2 >= width && h / 2 >= height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    cur = step(cur, w, h);
  }
  const out = step(cur, width, height);
  const img = out.getContext('2d')!.getImageData(0, 0, width, height);
  return { data: img.data, width, height };
}

function step(src: Source, w: number, h: number) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (src instanceof OffscreenCanvas) src.width = 0; // let the bigger step go now
  return c;
}

function codec(host: Host): Codec {
  return {
    async jpeg(bytes, width, height) {
      // PDF viewers ignore the JPEG's own orientation and color profile, so we do too
      const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {
        imageOrientation: 'none',
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      try {
        return draw(bitmap, width, height);
      } finally {
        bitmap.close();
      }
    },
    async resize(px, width, height) {
      const c = new OffscreenCanvas(px.width, px.height);
      c.getContext('2d')!.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
      return draw(c, width, height);
    },
    async encode(px, quality) {
      const img = new ImageData(px.data, px.width, px.height);
      return new Uint8Array(await host.encode(Comlink.transfer(img, [img.data.buffer]), quality));
    },
  };
}

const api = {
  async run(bytes: Uint8Array, options: ImageOptions, host: Host): Promise<ImagePassResult> {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest });
    } catch (e) {
      return { status: (e as Error)?.name === 'EncryptedPDFError' || /encrypted/i.test((e as Error)?.message) ? 'encrypted' : 'unreadable' };
    }
    const stats = await optimizeImages(doc, options, codec(host), (done, total) => host.progress(done, total));
    if (!stats.replaced) return { status: 'ok', stats };
    // qpdf packs object streams afterwards; form fields keep their own appearances
    const out = await doc.save({ useObjectStreams: false, objectsPerTick: Infinity, updateFieldAppearances: false });
    return Comlink.transfer({ status: 'ok' as const, stats, bytes: out }, [out.buffer as ArrayBuffer]);
  },
};

export type CompressWorker = typeof api;
Comlink.expose(api);
