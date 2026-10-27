// BiRefNet lite's pre- and post-processing around a raw ORT session (used by the tool's worker and /dev/ai-parity)
import type { InferenceSession } from 'onnxruntime-web';
import type { OrtModule } from '@/engines/ai/runtime';
import { toProbabilities } from './matte';

/** the model's mask (probabilities) for a work-size RGBA picture */
export type Predict = (rgba: Uint8ClampedArray, w: number, h: number) => Promise<{ mask: Float32Array; mw: number; mh: number }>;

/** 1024² in, ImageNet mean/std, logits out */
const BIREFNET_SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function birefnet(session: InferenceSession, ort: OrtModule): Predict {
  return async (rgba, w, h) => {
    const n = BIREFNET_SIZE * BIREFNET_SIZE;
    const src = new OffscreenCanvas(w, h);
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const ctx = new OffscreenCanvas(BIREFNET_SIZE, BIREFNET_SIZE).getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, BIREFNET_SIZE, BIREFNET_SIZE);
    const px = ctx.getImageData(0, 0, BIREFNET_SIZE, BIREFNET_SIZE).data;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    const feed = new ort.Tensor('float32', input, [1, 3, BIREFNET_SIZE, BIREFNET_SIZE]);
    const out = (await session.run({ [session.inputNames[0]]: feed }))[session.outputNames[0]];
    const mask = toProbabilities(new Float32Array((await out.getData()) as Float32Array));
    feed.dispose();
    out.dispose();
    return { mask, mw: BIREFNET_SIZE, mh: BIREFNET_SIZE };
  };
}
