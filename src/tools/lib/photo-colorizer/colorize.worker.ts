/// <reference lib="webworker" />
// DDColor tiny on onnxruntime-web: predict() turns a 512² picture into a/b chroma planes,
// compose() lays them over a full-size photo's own lightness.
import { createOrtSession, type LoadOptions } from '@/engines/ai/load';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import { composeColor, MODEL_SIZE, modelInput, type Pixels } from './lab';

type Options = Pick<LoadOptions, 'device' | 'variant'>;
type Session = Awaited<ReturnType<typeof createOrtSession>>;

let session: Promise<Session> | null = null;

function open(o: Options, onProgress?: OnProgress) {
  // errors only: on the processor the float16 graph logs dozens of harmless "can't constant fold" warnings
  const s = (session = createOrtSession('ddcolor-tiny', { ...o, onProgress: onProgress && throttleProgress(onProgress), sessionOptions: { logSeverityLevel: 3 } }));
  s.catch(() => {
    if (session === s) session = null;
  });
  return s;
}

async function infer({ value: { session, ort } }: Session, input: Float32Array<ArrayBuffer>) {
  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const out = (await session.run({ [session.inputNames[0]]: tensor }))[session.outputNames[0]];
  const ab = new Float32Array((await out.getData()) as Float32Array);
  out.dispose();
  // a graphics card without enough float16 precision can return NaN or Infinity instead of failing
  if (ab.some((v) => !Number.isFinite(v))) throw new Error('the model returned invalid numbers');
  return ab;
}

const api = {
  async load(o: Options, onProgress: OnProgress) {
    const r = await open(o, onProgress);
    return { device: r.device };
  },

  /** a/b planes (2 × 512 × 512) for a picture already resized to 512 × 512 */
  async predict(img: Pixels, o: Options) {
    const start = performance.now();
    const input = modelInput(img);
    let r = await (session ?? open(o));
    let ab: Float32Array<ArrayBuffer>;
    try {
      ab = await infer(r, input);
    } catch (err) {
      if (r.device !== 'webgpu') throw err;
      // WebGPU drivers vary; the processor is slower but dependable
      await r.value.session.release();
      r = await open({ ...o, device: 'wasm' });
      ab = await infer(r, input);
    }
    return transfer({ ab, device: r.device, ms: performance.now() - start }, [ab.buffer]);
  },

  compose(src: Pixels, ab: Float32Array, saturation: number) {
    const data = composeColor(src, ab, saturation);
    return transfer({ data, width: src.width, height: src.height }, [data.buffer]);
  },
};

exposeWorker(api);
export type ColorizeWorker = typeof api;
