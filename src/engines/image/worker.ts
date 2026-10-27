/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { cropPixels, orientPixels } from './pixels';
import { reduceColors } from './quantize';
import { resolveSize, type EncodeOptions, type Job, type JobResult, type ResizeOptions } from './types';

async function decode(input: Blob | ImageBitmap | ImageData): Promise<ImageData> {
  if (input instanceof ImageData) return input;
  let bitmap: ImageBitmap;
  if (input instanceof Blob) {
    try {
      bitmap = await createImageBitmap(input);
    } catch {
      // browsers before 2023 can't decode avif natively
      const head = new TextDecoder().decode(await input.slice(4, 12).arrayBuffer());
      if (head.startsWith('ftypavi')) {
        const { default: decodeAvif } = await import('@jsquash/avif/decode');
        const img = await decodeAvif(await input.arrayBuffer());
        if (img) return img;
      }
      throw new Error("Your browser can't read this image format.");
    }
  } else {
    bitmap = input;
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function resize(img: ImageData, o: ResizeOptions): Promise<ImageData> {
  const width = Math.max(1, Math.round(o.width));
  const height = Math.max(1, Math.round(o.height));
  if (width === img.width && height === img.height) return img;
  const { default: resizeImage } = await import('@jsquash/resize');
  return resizeImage(img, { width, height, method: o.method ?? 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
}

/** paints transparent pixels onto a solid color, for formats without alpha */
function flatten(img: ImageData, background: string): ImageData {
  const hex = background.replace('#', '');
  const [br, bg, bb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const d = img.data;
  let opaque = true;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return img;
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = d[i] * a + br * (1 - a);
    out[i + 1] = d[i + 1] * a + bg * (1 - a);
    out[i + 2] = d[i + 2] * a + bb * (1 - a);
    out[i + 3] = 255;
  }
  return new ImageData(out, img.width, img.height);
}

async function encode(img: ImageData, o: EncodeOptions): Promise<ArrayBuffer> {
  switch (o.format) {
    case 'jpeg': {
      const { default: encodeJpeg } = await import('@jsquash/jpeg/encode');
      return encodeJpeg(flatten(img, o.background ?? '#ffffff'), { quality: o.quality ?? 80, progressive: o.progressive ?? true });
    }
    case 'webp': {
      const { default: encodeWebp } = await import('@jsquash/webp/encode');
      return encodeWebp(img, { quality: o.quality ?? 80, lossless: o.lossless ? 1 : 0, method: 4 });
    }
    case 'avif': {
      const { default: encodeAvif } = await import('@jsquash/avif/encode');
      return encodeAvif(img, { quality: o.quality ?? 60, lossless: !!o.lossless, speed: 6 });
    }
    case 'png': {
      const source = o.colors && o.colors <= 256 ? reduceColors(img, o.colors, o.dither ?? true) : img;
      const { default: optimise } = await import('@jsquash/oxipng/optimise');
      return optimise(source, { level: 2, interlace: false, optimiseAlpha: true });
    }
  }
}

const api = {
  /** decode → resize → rotate/flip → encode in one round trip */
  async run(input: Blob | ImageBitmap | ImageData, job: Job): Promise<JobResult> {
    let img = await decode(input);
    const sourceWidth = img.width;
    const sourceHeight = img.height;
    if (job.crop) img = cropPixels(img, job.crop);
    if (job.resize) {
      const size = resolveSize(img.width, img.height, job.resize);
      img = await resize(img, { ...size, method: job.resize.method });
      if (size.crop) img = cropPixels(img, size.crop);
    }
    img = orientPixels(img, job.rotate, job.flipX, job.flipY);
    const buffer = await encode(img, job.encode);
    return Comlink.transfer({ buffer, width: img.width, height: img.height, sourceWidth, sourceHeight }, [buffer]);
  },
  async decode(input: Blob | ImageBitmap | ImageData): Promise<ImageData> {
    const img = await decode(input);
    return Comlink.transfer(img, [img.data.buffer]);
  },
  async encode(img: ImageData, options: EncodeOptions): Promise<ArrayBuffer> {
    const buffer = await encode(img, options);
    return Comlink.transfer(buffer, [buffer]);
  },
  async resize(img: ImageData, options: ResizeOptions): Promise<ImageData> {
    const out = await resize(img, options);
    return Comlink.transfer(out, [out.data.buffer]);
  },
};

export type ImageWorker = typeof api;

Comlink.expose(api);
