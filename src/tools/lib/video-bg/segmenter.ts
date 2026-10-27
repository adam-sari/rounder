import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
// self-hosted (same files as the face blur tool), so nothing is fetched from a CDN
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import plainLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import plainBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import { fetchModelFile, ProgressTally, toAiError, totalDownloadSize, type LoadProgress, type OnProgress } from '@/engines/ai';
import { ENGINE_BYTES } from './matte';

const ENGINE = 'MediaPipe engine';

let ready: Promise<ImageSegmenter> | undefined;

/** Streams the engine's .wasm with progress into a blob URL MediaPipe can instantiate */
async function fetchWasm(url: string, signal: AbortSignal | undefined, onBytes: (loaded: number) => void): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes((loaded += value.length));
  }
  return URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
}

/**
 * Loads the selfie segmenter once per page (later calls share it): engine + model with one
 * "MB of MB" progress. Runs on the CPU (wasm), which is plenty for a 256 × 256 model.
 */
export function loadSegmenter(o: { onProgress?: OnProgress; signal?: AbortSignal } = {}): Promise<ImageSegmenter> {
  ready ??= (async () => {
    const simd = await FilesetResolver.isSimdSupported();
    // the build's exact size: Content-Length is missing or compressed when the host gzips wasm
    const tally = new ProgressTally({ [ENGINE]: simd ? ENGINE_BYTES.simd : ENGINE_BYTES.plain, model: totalDownloadSize('selfie-segmenter', 'fp16') });
    const report = (p: LoadProgress) => o.onProgress?.(p);
    const [binary, model] = await Promise.all([
      fetchWasm(simd ? simdBinary : plainBinary, o.signal, (n) => report(tally.update(ENGINE, n))),
      fetchModelFile('selfie-segmenter', { signal: o.signal, onProgress: (p) => report(tally.update('model', p.loaded, p.total)) }),
    ]);
    o.onProgress?.({ ...tally.sum(), phase: 'init' });
    try {
      return await ImageSegmenter.createFromOptions(
        { wasmLoaderPath: simd ? simdLoader : plainLoader, wasmBinaryPath: binary },
        { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false },
      );
    } finally {
      URL.revokeObjectURL(binary);
    }
  })().catch((err) => {
    ready = undefined;
    throw toAiError(o.signal?.aborted ? o.signal.reason : err);
  });
  return ready;
}
