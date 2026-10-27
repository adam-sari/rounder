import type { InferenceSession } from 'onnxruntime-web';
import { detectDevice } from './device';
import { aiError, toAiError } from './errors';
import { getModel, MODELS, modelUrl, pickVariant, variantFiles, type Choice, type Device, type ModelKey, type ModelSpec } from './models';
import { ProgressTally, type OnProgress } from './progress';
import { ENGINE_FILE, engineBytes, engineFor, loadOrt, loadTransformers, transformersEngine, type OrtModule, type TransformersModule } from './runtime';
import { patchForWebGpu, toFloat32 } from './onnx-patch';
import { fetchCached } from './storage';

export interface LoadOptions {
  /** run on this device instead of the best one available ('wasm' = CPU) */
  device?: Device;
  /** a variant key from the registry (e.g. 'q8'); default: the best for the device */
  variant?: string;
  /** WebGPU backend instead of the registry's choice, for comparing them (/dev/ai-parity) */
  gpu?: ModelSpec['gpu'] | 'webgpu';
  /** apply the registry's graph patch on any device (true) or never (false); default: on WebGPU (/dev/ai-parity) */
  patch?: boolean;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}

/** The pretrained options loadTransformersModel hands to your from_pretrained()/pipeline() call */
export interface PretrainedOptions {
  revision: string;
  /** 'auto' on the JSEP build, where session_options names the provider instead */
  device: Device | 'auto';
  session_options?: { executionProviders: Device[] };
  dtype: NonNullable<ModelSpec['variants'][string]['dtype']>;
  progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => void;
}

export interface Loaded<T> {
  value: T;
  /** where it actually runs, after any fallback */
  device: Device;
  variant: string;
  /** milliseconds from call to ready */
  ms: number;
}

async function choose(m: ModelSpec, o: LoadOptions): Promise<Choice> {
  const info = await detectDevice();
  const gpu = o.device === 'wasm' ? { webgpu: false, fp16: false } : info;
  // a forced variant runs on WebGPU when there is one and the model (or the caller) wants it
  const device: Device = gpu.webgpu && (o.device === 'webgpu' || m.prefer.webgpu.length) ? 'webgpu' : 'wasm';
  const choice = o.variant ? { variant: o.variant, device } : pickVariant(m, gpu);
  if (!choice) throw aiError('no-webgpu');
  return choice;
}

/**
 * The CPU choice to retry with after WebGPU failed, or null when there is none. Also applies when
 * the caller passed device: 'webgpu' (ModelGate always passes its choice along).
 */
function cpuFallback(m: ModelSpec, choice: Choice, err: unknown, o: LoadOptions): Choice | null {
  const code = toAiError(err).code;
  if (choice.device !== 'webgpu' || o.signal?.aborted || code === 'network' || code === 'rate-limited' || code === 'storage-full') return null;
  console.warn(`${m.name}: WebGPU failed, retrying on the CPU`, err);
  return pickVariant(m, { webgpu: false, fp16: false });
}

/** Expected bytes per file for the progress bar, including the runtime when it isn't loaded yet */
function expected(m: ModelSpec, variant: string, engine: number): Record<string, number> {
  return Object.fromEntries([...variantFiles(m, variant).map((f) => [f.path, f.bytes] as const), [ENGINE_FILE, engine]]);
}

// transformers.js fetches through env.fetch; each load's AbortSignal is matched to its repo's URLs
const signals = new Map<string, AbortSignal>();
/**
 * pipeline() reads config.json and file metadata at the `main` revision (it doesn't pass
 * `revision` on to those lookups), so registry repos are sent to their pinned commit instead.
 */
const PINNED: [main: string, pinned: string][] = Object.values(MODELS).flatMap((m: ModelSpec) =>
  m.baseUrl ? [] : [[`https://huggingface.co/${m.repo}/resolve/main/`, `https://huggingface.co/${m.repo}/resolve/${m.revision}/`]],
);
let fetchPatched = false;

function patchFetch(tf: TransformersModule) {
  if (fetchPatched) return;
  fetchPatched = true;
  tf.env.fetch = (input, init) => {
    const pin = typeof input === 'string' && PINNED.find(([main]) => input.startsWith(main));
    const url = pin ? pin[1] + (input as string).slice(pin[0].length) : String(input);
    const signal = [...signals].find(([repo]) => url.includes(`/${repo}/`))?.[1];
    return fetch(pin ? url : input, signal ? { ...init, signal } : init);
  };
}

/**
 * Loads any transformers.js model with the registry's pinned revision, dtype and device, one
 * aggregated progress bar, cancellation, and a CPU retry when WebGPU fails. `build` receives the
 * transformers module and the options to pass to from_pretrained()/pipeline():
 *
 *   const { value: [model, processor] } = await loadTransformersModel('florence2-base', (tf, o, m) =>
 *     Promise.all([tf.Florence2ForConditionalGeneration.from_pretrained(m.repo, o), tf.AutoProcessor.from_pretrained(m.repo, o)]));
 */
export async function loadTransformersModel<T>(model: ModelKey, build: (tf: TransformersModule, options: PretrainedOptions, spec: ModelSpec) => Promise<T>, o: LoadOptions = {}): Promise<Loaded<T>> {
  const start = performance.now();
  const m = getModel(model);
  let choice = await choose(m, o);
  const engine = engineFor(m, choice.device, o.gpu) === 'jsep' ? 'jsep' : 'transformers';
  const tally = new ProgressTally(expected(m, choice.variant, engineBytes(engine, true)));
  const report = (p: ReturnType<ProgressTally['sum']>) => o.onProgress?.(p.loaded >= p.total ? { ...p, phase: 'init' } : p);
  try {
    const tf = await loadTransformers((n, t) => report(tally.update(ENGINE_FILE, n, t)), engine);
    patchFetch(tf);
    if (o.signal) signals.set(m.repo, o.signal);
    for (;;) {
      o.signal?.throwIfAborted();
      const options: PretrainedOptions = {
        revision: m.revision,
        // transformers.js only accepts device names its own onnxruntime build knows; on JSEP the provider is named directly
        ...(transformersEngine() === 'jsep' ? { device: 'auto', session_options: { executionProviders: [choice.device] } } : { device: choice.device }),
        dtype: m.variants[choice.variant].dtype ?? 'fp32',
        progress_callback: (info) => {
          if (!info.file) return;
          if (info.status === 'progress') report(tally.update(info.file, info.loaded ?? 0, info.total));
          else if (info.status === 'done') report(tally.done(info.file));
        },
      };
      try {
        const value = await build(tf, options, m);
        o.signal?.throwIfAborted();
        return { value, device: choice.device, variant: choice.variant, ms: performance.now() - start };
      } catch (err) {
        const next = cpuFallback(m, choice, err, o);
        if (!next) throw err;
        choice = next;
        for (const f of variantFiles(m, choice.variant)) tally.update(f.path, 0, f.bytes);
      }
    }
  } catch (err) {
    throw toAiError(o.signal?.aborted ? o.signal.reason : err);
  } finally {
    if (signals.get(m.repo) === o.signal) signals.delete(m.repo);
  }
}

/**
 * A transformers.js pipeline for a registry model:
 *
 *   const { value: segment, device } = await loadTransformersPipeline('background-removal', 'modnet', { onProgress, signal });
 *   const cutout = await segment(image);   // one image in → one RawImage out (RGBA, subject in alpha)
 */
export function loadTransformersPipeline<T extends Parameters<TransformersModule['pipeline']>[0]>(task: T, model: ModelKey, o: LoadOptions = {}) {
  return loadTransformersModel(model, (tf, options, m) => tf.pipeline(task, m.repo, options), o);
}

const PATCHES = { webgpu: patchForWebGpu, fp32: toFloat32 } satisfies Record<NonNullable<ModelSpec['patch']>, unknown>;

/**
 * Downloads one ORT model (through the model cache, with progress) and opens an InferenceSession
 * on WebGPU when the model and device support it, else on the CPU. Returns `ort` too, for Tensors:
 *
 *   const { value: { session, ort } } = await createOrtSession('migan', { onProgress, signal });
 *   const out = await session.run({ image: new ort.Tensor('uint8', data, [1, 3, h, w]), … });
 */
export async function createOrtSession(model: ModelKey, o: LoadOptions & { sessionOptions?: InferenceSession.SessionOptions } = {}): Promise<Loaded<{ session: InferenceSession; ort: OrtModule }>> {
  const start = performance.now();
  const m = getModel(model);
  let choice = await choose(m, o);
  const gpu = (await detectDevice()).webgpu;
  const engine = engineFor(m, choice.device, o.gpu) === 'jsep' ? 'jsep' : 'ort';
  const tally = new ProgressTally(expected(m, choice.variant, engineBytes(engine, gpu)));
  const report = (p: ReturnType<ProgressTally['sum']>) => o.onProgress?.(p.loaded >= p.total ? { ...p, phase: 'init' } : p);
  try {
    // a WebGPU failure on JSEP falls back to that build's own CPU path
    const ort = await loadOrt((n, t) => report(tally.update(ENGINE_FILE, n, t)), engine);
    for (;;) {
      const [file] = m.variants[choice.variant].files;
      const bytes = await fetchCached(modelUrl(m, file.path), { bytes: file.bytes, signal: o.signal, onProgress: (n, t) => report(tally.update(file.path, n, t)) });
      o.signal?.throwIfAborted();
      try {
        const patch = m.patch && (o.patch ?? choice.device === 'webgpu') ? PATCHES[m.patch] : null;
        const session = await ort.InferenceSession.create(patch ? patch(bytes) : bytes, {
          executionProviders: [choice.device],
          graphOptimizationLevel: 'all',
          ...o.sessionOptions,
        });
        return { value: { session, ort }, device: choice.device, variant: choice.variant, ms: performance.now() - start };
      } catch (err) {
        const next = cpuFallback(m, choice, err, o);
        if (!next) throw err;
        choice = next;
      }
    }
  } catch (err) {
    throw toAiError(o.signal?.aborted ? o.signal.reason : err);
  }
}

/**
 * One registry file through the model cache, for runtimes that take bytes themselves
 * (demucs-web's loadModel(buffer), MediaPipe's modelAssetBuffer, kokoro voices…).
 */
export async function fetchModelFile(model: ModelKey, o: Omit<LoadOptions, 'device'> & { file?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const m = getModel(model);
  const variant = o.variant ?? m.prefer.wasm[0] ?? m.prefer.webgpu[0];
  const file = o.file ? { path: o.file, bytes: 0 } : m.variants[variant].files[0];
  const tally = new ProgressTally({ [file.path]: file.bytes });
  return fetchCached(modelUrl(m, file.path), { bytes: file.bytes, signal: o.signal, onProgress: (n, t) => o.onProgress?.(tally.update(file.path, n, t)) });
}
