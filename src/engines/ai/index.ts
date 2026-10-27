/**
 * Rounder AI engine: models run on the visitor's device (WebGPU when available, WebAssembly on
 * the CPU otherwise). Nothing is uploaded. Model weights come from the Hugging Face CDN at
 * pinned commits and are cached in the browser; runtime code (onnxruntime-web, tesseract core)
 * is self-hosted under /vendor (scripts/vendor-ai.mjs), never loaded from a CDN.
 * Errors are AiError with a stable `code` (aborted | network | rate-limited | storage-full |
 * out-of-memory | no-webgpu | failed) and a `message` written for end users.
 *
 * ── 1. Pick a model ──────────────────────────────────────────────────────────────────────
 *   MODELS in ./models.ts: repo, pinned revision, files + exact sizes per variant (dtype),
 *   license + URL, credit line (use it in your FAQ), runtime, speed hints, `light` alternative.
 *   Need one that isn't there? Ask for it to be added (with sha + sizes from the HF API).
 *   totalDownloadSize('modnet', 'q8') → bytes · formatMB(bytes) → "6.6 MB" (decimal, like HF)
 *   pickVariant('birefnet-lite', await detectDevice()) → { device: 'webgpu', variant: 'fp16' } | null (needs WebGPU)
 *   modelUrl('migan', 'migan_pipeline_v2.onnx') → pinned https URL
 *
 * ── 2. Gate the tool UI ──────────────────────────────────────────────────────────────────
 *   src/components/tool/ModelGate.svelte shows the model card (size, device, license), asks
 *   once, downloads with progress + Cancel, remembers consent, offers the light model on
 *   phones / without WebGPU, then renders your UI:
 *
 *   <ModelGate model="depth-anything-v2-small" load={({ variant, device, onProgress, signal }) =>
 *       worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal)}>
 *     {#snippet children({ key, device })}…tool UI (key tells you if the light model was chosen)…{/snippet}
 *   </ModelGate>
 *
 * ── 3. Load in a worker (keeps the page responsive) ──────────────────────────────────────
 *   See ./worker-utils.ts and the working example ./lab/lab.worker.ts:
 *     worker file:  exposeWorker({ load(o, onProgress) {…}, run(input) {…} })
 *     island:       const worker = modelWorker<Api>(() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }))
 *                   worker.call((api) => api.run(data), signal)   // abort → terminate
 *   Loaders (work in workers and on the page; all take { device?, variant?, onProgress?, signal? }
 *   and return { value, device, variant, ms } — device is where it really runs after fallback):
 *     loadTransformersPipeline('automatic-speech-recognition', 'whisper-base', o)  → pipeline
 *     loadTransformersModel('florence2-base', (tf, opts, spec) => tf.Florence2ForConditionalGeneration.from_pretrained(spec.repo, opts), o)
 *     createOrtSession('migan', o) → { session, ort }  (onnxruntime-web 1.30, WebGPU EP or wasm; 1.22 JSEP for gpu: 'jsep' models)
 *       Feed the dtype the model declares (fp16 models may want Float16Array inputs); call
 *       tensor.dispose() on outputs once read and session.release() when the tool is done.
 *     fetchModelFile('demucs', o) → Uint8Array (cached, with progress) for libraries that take bytes
 *   All of them: pinned revision (transformers.js' own `main` lookups are redirected to it), one
 *   aggregated "MB of MB" progress (runtime download included), a CPU retry when a WebGPU session
 *   fails (also when you pass device: 'webgpu'), cancel via AbortSignal.
 *   WebGPU per model, from the registry: `gpu: 'jsep'` runs it on onnxruntime 1.22's JSEP backend
 *   (the newer WebGPU EP gets MODNet wrong); `patch` rewrites its graph for createOrtSession first
 *   (onnx-patch.ts): 'webgpu' narrows wide Splits and turns Sum into Adds, 'fp32' widens a float16-only
 *   model to float32 (DDColor: its LayerNorms fail in fp16 math). Variants that are wrong on GPUs (fp16
 *   overflow) are simply not in prefer.webgpu. Check any change on /dev/ai-parity.
 *   Progress crossing a worker boundary: wrap with throttleProgress() in the worker.
 *
 * ── Other runtimes ───────────────────────────────────────────────────────────────────────
 *   demucs-web:    new DemucsProcessor({ ort: await loadOrt() }); processor.loadModel((await fetchModelFile('demucs', o)).buffer)
 *   kokoro-js:     import { KokoroTTS, env } from 'kokoro-js'; env.wasmPaths = ortBase('jsep');  (ORT 1.22 build, self-hosted)
 *                  KokoroTTS.from_pretrained(MODELS.kokoro.repo, { dtype: 'q8', device: 'wasm', progress_callback })
 *                  (kokoro-js can't pin a revision: it loads `main` into its own 'transformers-cache')
 *   tesseract.js:  createWorker('eng', 1, { ...tesseractPaths(), langPath: MODELS['tesseract-eng'].baseUrl })
 *   MediaPipe:     modelAssetBuffer: await fetchModelFile('selfie-segmenter'), wasm via ?url imports (see tools/lib/blur-image/faces.ts)
 *
 * ── Device & storage ─────────────────────────────────────────────────────────────────────
 *   detectDevice() → { webgpu, fp16, adapterInfo, maxBufferSize, isMobile, deviceMemory, cores, threads, recommended, reason }
 *   isModelCached(key, variant?) · cachedVariant(key) · clearModelCache(key?) · storageEstimate() · requestPersist()
 *   hasConsent(key) / rememberConsent(key) (ModelGate handles these)
 *
 * ── Testing ──────────────────────────────────────────────────────────────────────────────
 *   /dev/ai-lab: device report, MODNet through both paths (transformers pipeline in a worker,
 *   raw ORT session on the page) with timings, cache check/clear and a vendor file check.
 *   /dev/ai-parity: every model on the same input on the CPU and on both WebGPU backends, with the
 *   difference and a pass/fail (lab/parity.worker.ts holds the cases).
 */

export * from './device';
export * from './errors';
export * from './load';
export * from './models';
export * from './progress';
export { engineBytes, engineCached, loadOrt, loadTransformers, ortBase, tesseractPaths, type OrtModule, type TransformersModule } from './runtime';
export * from './storage';
