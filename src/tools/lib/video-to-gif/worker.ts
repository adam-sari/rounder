/// <reference lib="webworker" />
/*
 * GIF encoder worker: frames arrive as ImageBitmaps (straight from the media engine's
 * decoder), get the caption drawn on, then are indexed and LZW-packed here, so the page
 * never stutters. It also renders the live first-frame preview and the size estimate.
 */
import * as Comlink from 'comlink';
import { GIFEncoder } from 'gifenc';
import { indexFrame, type IndexOptions } from './palette';
import { estimateGifBytes } from './plan';

let caption: ImageBitmap | null = null;
let canvas: OffscreenCanvas | null = null;
let samples: ImageBitmap[] = [];
let job: { gif: ReturnType<typeof GIFEncoder>; screen: Uint8Array | null; style: IndexOptions; repeat: number } | null = null;

/** the frame with the caption on top, as RGBA */
function pixels(bitmap: ImageBitmap) {
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  if (caption) ctx.drawImage(caption, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** bytes one frame adds to a GIF (header included, which is close enough for an estimate) */
function frameBytes(f: ReturnType<typeof indexFrame>, width: number, height: number) {
  const gif = GIFEncoder();
  gif.writeFrame(f.index, width, height, { palette: f.palette, transparent: f.transparentIndex >= 0, transparentIndex: Math.max(0, f.transparentIndex), dispose: 1 });
  return gif.bytesView().length;
}

const api = {
  setCaption(bitmap: ImageBitmap | null) {
    caption?.close();
    caption = bitmap;
  },

  /** frames for the preview: [first, second, …] then optional pairs from later in the clip */
  setSamples(bitmaps: ImageBitmap[]) {
    samples.forEach((b) => b.close());
    samples = bitmaps;
  },

  /** the first frame exactly as the GIF will show it, plus an estimate for `frames` frames */
  async preview(style: IndexOptions, frames: number): Promise<{ image: ImageBitmap; bytes: number } | null> {
    if (!samples.length) return null;
    const first = pixels(samples[0]);
    const screen = new Uint8Array(first.width * first.height * 3);
    const head = indexFrame(first.data, first.width, first.height, screen, true, style);
    const firstBytes = frameBytes(head, first.width, first.height);
    const rgba = new Uint8ClampedArray(first.width * first.height * 4);
    for (let i = 0, n = first.width * first.height; i < n; i++) {
      rgba.set(screen.subarray(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    }
    const image = await createImageBitmap(new ImageData(rgba, first.width, first.height));

    // later frames only store what changed: measure a couple of real pairs
    const diffs: number[] = [];
    for (let s = 0; s + 1 < samples.length; s += 2) {
      const a = s === 0 ? null : pixels(samples[s]);
      const pairScreen = a ? new Uint8Array(a.width * a.height * 3) : screen;
      if (a) indexFrame(a.data, a.width, a.height, pairScreen, true, style);
      const b = pixels(samples[s + 1]);
      diffs.push(frameBytes(indexFrame(b.data, b.width, b.height, pairScreen, false, style), b.width, b.height));
    }
    return Comlink.transfer({ image, bytes: estimateGifBytes(frames, firstBytes, diffs) }, [image]);
  },

  start(style: IndexOptions, repeat: number) {
    job = { gif: GIFEncoder(), screen: null, style, repeat };
  },

  add(bitmap: ImageBitmap, delayMs: number) {
    if (!job) return bitmap.close(); // cancelled while frames were in flight
    const { data, width, height } = pixels(bitmap);
    bitmap.close();
    const first = !job.screen;
    job.screen ??= new Uint8Array(width * height * 3);
    const f = indexFrame(data, width, height, job.screen, first, job.style);
    job.gif.writeFrame(f.index, width, height, {
      palette: f.palette,
      delay: delayMs,
      repeat: job.repeat,
      transparent: f.transparentIndex >= 0,
      transparentIndex: Math.max(0, f.transparentIndex),
      // keep the previous frame on screen: transparent pixels show it through
      dispose: 1,
    });
  },

  finish(): Uint8Array {
    if (!job) throw new Error('Nothing to finish.');
    job.gif.finish();
    const bytes = job.gif.bytes();
    job = null;
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  cancel() {
    job = null;
  },
};

export type GifWorker = typeof api;
Comlink.expose(api);
