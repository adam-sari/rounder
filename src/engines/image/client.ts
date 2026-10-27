import * as Comlink from 'comlink';
import type { ImageWorker } from './worker';
import { formatInfo, type EncodeOptions, type Job, type ResizeOptions } from './types';

export * from './types';

/*
 * A small pool of image workers. Each job borrows an idle worker, so a batch of
 * 200 photos runs a few at a time in the background and the page stays smooth.
 */
interface Slot {
  api: Comlink.Remote<ImageWorker>;
  busy: boolean;
}

const slots: Slot[] = [];
const waiting: ((slot: Slot) => void)[] = [];

function poolSize() {
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
}

function acquire(): Promise<Slot> {
  const idle = slots.find((s) => !s.busy);
  if (idle) {
    idle.busy = true;
    return Promise.resolve(idle);
  }
  if (slots.length < poolSize()) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const slot: Slot = { api: Comlink.wrap<ImageWorker>(worker), busy: true };
    slots.push(slot);
    return Promise.resolve(slot);
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(slot: Slot) {
  const next = waiting.shift();
  if (next) next(slot);
  else slot.busy = false;
}

async function withWorker<T>(fn: (api: Comlink.Remote<ImageWorker>) => Promise<T>): Promise<T> {
  const slot = await acquire();
  try {
    return await fn(slot.api);
  } finally {
    release(slot);
  }
}

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'bmp' | 'svg' | 'tiff' | 'ico' | 'unknown';

/** Identifies an image by its first bytes, since file names and types can lie */
export async function imageKind(file: Blob & { name?: string }): Promise<ImageKind> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (ascii.startsWith('\x89PNG')) return 'png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('II*\0') || ascii.startsWith('MM\0*')) return 'tiff';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
  if (ascii.slice(4, 8) === 'ftyp') {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    const brands = ascii.slice(8, Math.min(boxSize, 64));
    if (/avi[fs]/.test(brands)) return 'avif';
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return 'heic';
  }
  if (/^\s*(<\?xml|<svg|<!--)/i.test(ascii) || file.type === 'image/svg+xml' || file.name?.toLowerCase().endsWith('.svg')) return 'svg';
  return 'unknown';
}

/** largest side used when an svg has no size of its own */
const SVG_FALLBACK = 2048;

async function svgToBitmap(file: Blob, scale = 1): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || SVG_FALLBACK;
    let h = img.naturalHeight || SVG_FALLBACK;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turns a file into something the worker can decode. HEIC (on browsers that can't
 * read it) and SVG need the main thread, so they arrive as a ready ImageBitmap.
 */
export async function toDecodable(file: Blob, opts: { svgScale?: number } = {}): Promise<Blob | ImageBitmap> {
  const kind = await imageKind(file);
  if (kind === 'svg') return svgToBitmap(file, opts.svgScale);
  if (kind === 'heic') {
    try {
      return await createImageBitmap(file); // Safari reads HEIC natively
    } catch {
      const { heicTo } = await import('heic-to');
      return heicTo({ blob: file, type: 'bitmap' });
    }
  }
  return file;
}

const transferable = (src: Blob | ImageBitmap | ImageData) => (src instanceof ImageBitmap ? Comlink.transfer(src, [src]) : src);

/**
 * The worker turns bitmaps into pixels on an OffscreenCanvas. Browsers without one (Safari before 16.4)
 * get the pixels drawn here instead; formats the page can't read go to the worker's wasm decoders.
 */
async function forWorker(file: Blob): Promise<Blob | ImageBitmap | ImageData> {
  const source = await toDecodable(file);
  if (typeof OffscreenCanvas !== 'undefined') return source;
  const bitmap = source instanceof Blob ? await createImageBitmap(source).catch(() => null) : source;
  if (!bitmap) return source;
  const ctx = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Decode → resize → rotate → encode, off the main thread. Pass already decoded
 * pixels (from decodeImage) when running several jobs on the same image.
 */
export async function processImage(file: Blob | ImageData, job: Job) {
  const source = file instanceof ImageData ? file : await forWorker(file);
  const result = await withWorker((api) => api.run(transferable(source), job));
  const { buffer, ...info } = result;
  return { blob: new Blob([buffer], { type: formatInfo[job.encode.format].mime }), ...info };
}

/** Raw pixels for tools that edit images on a canvas */
export async function decodeImage(file: Blob): Promise<ImageData> {
  const source = await forWorker(file);
  return withWorker((api) => api.decode(transferable(source)));
}

export async function encodeImage(img: ImageData, options: EncodeOptions): Promise<Blob> {
  const buffer = await withWorker((api) => api.encode(img, options));
  return new Blob([buffer], { type: formatInfo[options.format].mime });
}

export async function resizeImage(img: ImageData, options: ResizeOptions): Promise<ImageData> {
  return withWorker((api) => api.resize(img, options));
}

/** Encodes a canvas through the worker codecs (better compression than canvas.toBlob) */
export async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, options: EncodeOptions): Promise<Blob> {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return encodeImage(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
}

/** A file's original format, mapped to the closest output we can write */
export function outputFormatFor(kind: ImageKind): keyof typeof formatInfo {
  return kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'avif' ? kind : kind === 'heic' ? 'jpeg' : 'png';
}
