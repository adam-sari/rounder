import './imagedata';
import { PDFDocument, ParseSpeeds } from 'pdf-lib';
import decodeJpeg from '@jsquash/jpeg/decode.js';
import resizePixels from '@jsquash/resize';
import { encode } from '@/engines/image/codec';
import { abortError } from '@/engines/pdf/errors';
import { optimizeImages, sampleImages, type Codec } from '@/tools/lib/compress-pdf/images';
import type { ImagePassResult, SampleResult } from '@/tools/lib/compress-pdf/compress.worker';
import type { ImageOptions } from '@/tools/lib/compress-pdf/settings';
import { initCodecs } from './codecs';

/*
 * Node twin of src/tools/lib/compress-pdf/runner.ts: the same image pass (images.ts, unchanged), run in this process
 * with jSquash in place of OffscreenCanvas. compress.ts's ladder and estimates stay shared with the site.
 */

type Unreadable = { status: 'encrypted' | 'unreadable' };

async function open(bytes: Uint8Array): Promise<PDFDocument | Unreadable> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest });
  } catch (e) {
    return { status: (e as Error)?.name === 'EncryptedPDFError' || /encrypted/i.test((e as Error)?.message) ? 'encrypted' : 'unreadable' };
  }
}

const shrink = async (img: ImageData, width: number, height: number) =>
  img.width === width && img.height === height ? img : ((await resizePixels(img, { width, height, method: 'triangle', fitMethod: 'stretch' })) as ImageData);

function codec(signal: AbortSignal): Codec {
  return {
    async jpeg(bytes, width, height) {
      if (signal.aborted) throw abortError();
      // PDF viewers ignore the JPEG's own orientation and color profile, so we do too
      const img = (await decodeJpeg(bytes.slice().buffer as ArrayBuffer, { preserveOrientation: false })) as ImageData;
      const out = await shrink(new ImageData(img.data, img.width, img.height), width, height);
      return { data: out.data, width, height };
    },
    async resize(px, width, height) {
      const out = await shrink(new ImageData(px.data, px.width, px.height), width, height);
      return { data: out.data, width, height };
    },
    async encode(px, quality) {
      if (signal.aborted) throw abortError();
      return new Uint8Array(await encode(new ImageData(px.data, px.width, px.height), { format: 'jpeg', quality, progressive: false }));
    },
  };
}

export async function runImagePass(bytes: Uint8Array, options: ImageOptions, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<ImagePassResult> {
  await initCodecs();
  const doc = await open(bytes.slice());
  if (!(doc instanceof PDFDocument)) return doc;
  const stats = await optimizeImages(doc, options, codec(signal), progress);
  if (!stats.replaced) return { status: 'ok', stats };
  // qpdf packs object streams afterwards; form fields keep their own appearances
  const out = await doc.save({ useObjectStreams: false, objectsPerTick: Infinity, updateFieldAppearances: false });
  return { status: 'ok', stats, bytes: out };
}

export async function runSample(bytes: Uint8Array, settings: ImageOptions[], signal: AbortSignal, progress: (done: number, total: number) => void): Promise<SampleResult> {
  await initCodecs();
  const doc = await open(bytes.slice());
  if (!(doc instanceof PDFDocument)) return doc;
  if (signal.aborted) throw abortError();
  return { status: 'ok', sample: await sampleImages(doc, settings, codec(signal), 3, progress) };
}
