/// <reference lib="webworker" />
// Fills the marked areas of one crop with MI-GAN or LaMa, off the main thread.
import type { InferenceSession } from 'onnxruntime-web';
import { createOrtSession } from '@/engines/ai/load';
import type { Device } from '@/engines/ai/models';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import type { OrtModule } from '@/engines/ai/runtime';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import { SIDE, type Stroke } from './geometry';
import { blend, boxBlur, fromPlanar, toPlanar } from './pixels';
import { strokeMask } from './raster';

export type InpaintModel = 'migan' | 'lama';
export interface ModelChoice {
  key: InpaintModel;
  variant?: string;
  device?: Device;
}

let loaded: { key: InpaintModel; device: Device; session: InferenceSession; ort: OrtModule } | null = null;

/** one model in memory at a time: LaMa alone needs a few hundred MB */
async function open(m: ModelChoice, onProgress?: OnProgress) {
  if (loaded?.key === m.key && (m.device !== 'wasm' || loaded.device === 'wasm')) return loaded;
  await loaded?.session.release().catch(() => {});
  loaded = null;
  const r = await createOrtSession(m.key, { variant: m.variant, device: m.device, onProgress: onProgress && throttleProgress(onProgress) });
  loaded = { key: m.key, device: r.device, ...r.value };
  return loaded;
}

/** scales RGBA pixels through a canvas (smooth both ways) */
function resample(img: ImageData, width: number, height: number): ImageData {
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext('2d')!.putImageData(img, 0, 0);
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * One model run on a SIDE² image. MI-GAN's pipeline takes uint8 RGB and a uint8 mask
 * (255 = keep, 0 = fill) and returns uint8 RGB; LaMa takes RGB in 0–1 and a mask with
 * 1 = fill, and returns RGB in 0–255.
 */
async function infer({ key, session, ort }: NonNullable<typeof loaded>, image: ImageData, hole: Uint8Array) {
  const n = SIDE * SIDE;
  const lama = key === 'lama';
  const feeds = lama
    ? {
        image: new ort.Tensor('float32', toPlanar(image.data, new Float32Array(3 * n), 1 / 255), [1, 3, SIDE, SIDE]),
        mask: new ort.Tensor('float32', Float32Array.from(hole, (v) => (v ? 1 : 0)), [1, 1, SIDE, SIDE]),
      }
    : {
        image: new ort.Tensor('uint8', toPlanar(image.data, new Uint8Array(3 * n)), [1, 3, SIDE, SIDE]),
        mask: new ort.Tensor('uint8', Uint8Array.from(hole, (v) => (v ? 0 : 255)), [1, 1, SIDE, SIDE]),
      };
  const out = await session.run(feeds);
  const result = out[session.outputNames[0]];
  const rgba = fromPlanar(result.data as Uint8Array | Float32Array, n);
  Object.values(feeds).forEach((t) => t.dispose());
  result.dispose();
  return new ImageData(rgba, SIDE, SIDE);
}

const api = {
  async load(m: ModelChoice, onProgress: OnProgress) {
    return { device: (await open(m, onProgress)).device };
  },

  /**
   * Fills the marked parts of a crop (strokes in crop pixels) and blends the fill back in with
   * a soft edge, at the crop's full size. Pixels away from the marks come back unchanged.
   * Null when the marks were all erased.
   */
  async erase(m: ModelChoice, image: ImageData, strokes: Stroke[]) {
    const { width: w, height: h } = image;
    // edge softness in crop pixels: about 2 model pixels, even so it splits into two blur passes
    const feather = 2 * Math.max(1, Math.round(Math.max(w, h) / SIDE));
    const marks = strokeMask(strokes, w, h, 1, 1, feather);
    if (!marks.some(Boolean)) return null;
    const alpha = boxBlur(boxBlur(marks, w, h, feather / 2), w, h, feather / 2);
    // the hole covers everything the blend touches, so no trace of the object is blended back
    const hole = strokeMask(strokes, SIDE, SIDE, SIDE / w, SIDE / h, 2 * feather);
    const input = resample(image, SIDE, SIDE);
    let model = await open(m);
    let filled: ImageData;
    try {
      filled = await infer(model, input, hole);
    } catch (err) {
      if (model.device !== 'webgpu') throw err;
      console.warn(`${m.key}: WebGPU run failed, retrying on the CPU`, err);
      model = await open({ key: m.key, device: 'wasm' });
      filled = await infer(model, input, hole);
    }
    const out = new ImageData(blend(image, resample(filled, w, h), alpha), w, h);
    return transfer({ image: out, device: model.device }, [out.data.buffer]);
  },
};

exposeWorker(api);
export type InpaintWorker = typeof api;
