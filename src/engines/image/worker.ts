/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { cropPixels, orientPixels } from './pixels';
import { encode, resize } from './codec';
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
