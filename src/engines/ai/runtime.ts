import { detectDevice } from './device';
import { aiError, toAiError } from './errors';
import type { Device, ModelSpec } from './models';
import { MODEL_CACHE } from './storage';
import { VENDOR } from './vendor.generated';

/*
 * Runtime code always comes from our own /vendor folder (scripts/vendor-ai.mjs), never a CDN.
 * There is no COOP/COEP on this site (ads need to keep working), so ORT runs single-threaded
 * WebAssembly; threads are set explicitly so ORT doesn't warn about it.
 */

export type OrtModule = typeof import('onnxruntime-web');
export type TransformersModule = typeof import('@huggingface/transformers');
/**
 * ort          onnxruntime-web 1.30 for raw sessions (createOrtSession, demucs-web)
 * transformers the 1.31 build transformers.js bundles
 * jsep         onnxruntime-web 1.22 with the older JSEP WebGPU backend: kokoro-js, and models whose
 *              registry entry says gpu: 'jsep' because the newer WebGPU EP gets them wrong
 */
export type OrtRuntime = 'ort' | 'transformers' | 'jsep';
type Bytes = (loaded: number, total: number) => void;

interface VendoredFile {
  bytes: number;
  sha256: string;
  parts?: readonly { name: string; bytes: number }[];
}

const FACTORY = 'ort-wasm-simd-threaded';
/** progress label for the runtime download, shared by every loader */
export const ENGINE_FILE = 'AI engine';

/**
 * Absolute URL of a vendored ORT build's folder, e.g. for kokoro-js: `env.wasmPaths = ortBase('jsep')`.
 * Absolute on purpose: in dev, Vite rewrites dynamic imports of root-relative URLs inside
 * node_modules to `…?import`, which it refuses to serve from /public.
 */
export const ortBase = (runtime: OrtRuntime): string => new URL(VENDOR[runtime].base, location.origin).href;

/**
 * transformers.js uses the plain (non-asyncify) build on Safari before 26 without WebGPU; mirror
 * its check (dist/transformers.web.js, isSafariBelow26) so the wasm matches what it expects there.
 */
function legacySafari(): boolean {
  if (typeof navigator === 'undefined' || navigator.gpu) return false;
  const ua = navigator.userAgent;
  const safari = (navigator.vendor || '').includes('Apple') && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i.test(ua) && !ua.includes('Chrome') && !ua.includes('Android');
  return safari && Number(ua.match(/Version\/(\d+)/)?.[1] ?? 26) < 26;
}

const engineFactory = (runtime: OrtRuntime, gpu: boolean) =>
  runtime === 'jsep' ? `${FACTORY}.jsep` : (runtime === 'ort' ? !gpu : legacySafari()) ? FACTORY : `${FACTORY}.asyncify`;
const engineFile = (runtime: OrtRuntime, gpu: boolean) => `${engineFactory(runtime, gpu)}.wasm`;

/** The ORT build a registry model loads on a device (JSEP only on WebGPU; its CPU path is the regular one) */
export function engineFor(spec: ModelSpec, device: Device, gpu: ModelSpec['gpu'] | 'webgpu' = spec.gpu): OrtRuntime | null {
  if (spec.runtime === 'transformers' || spec.runtime === 'ort' || spec.runtime === 'demucs') {
    if (device === 'webgpu' && gpu === 'jsep') return 'jsep';
    return spec.runtime === 'transformers' ? 'transformers' : 'ort';
  }
  return null;
}
const vendored = (runtime: OrtRuntime, name: string) => (VENDOR[runtime].files as Record<string, VendoredFile>)[name];

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const binaries = new Map<string, Promise<ArrayBuffer>>();
const ready = new Set<string>();
/** everyone waiting on a runtime download hears its progress, not just the caller that started it */
const listeners = new Map<string, Set<Bytes>>();

/** Bytes of runtime .wasm a loader still has to fetch on this page (0 once it's loaded) */
export function engineBytes(runtime: OrtRuntime, gpu: boolean): number {
  const name = engineFile(runtime, gpu);
  return ready.has(VENDOR[runtime].base + name) ? 0 : vendored(runtime, name).bytes;
}

/**
 * Whether the runtime is already on this device (loaded on this page, or kept by the service
 * worker from an earlier visit), so model cards can skip "plus a 27 MB AI engine, once".
 */
export async function engineCached(runtime: OrtRuntime, gpu: boolean): Promise<boolean> {
  const name = engineFile(runtime, gpu);
  const { base } = VENDOR[runtime];
  const first = vendored(runtime, name).parts?.[0].name ?? name;
  return ready.has(base + name) || (typeof caches !== 'undefined' && !!(await caches.match(base + first).catch(() => undefined)));
}

/**
 * Fetches a vendored .wasm once per page: joins its parts (Cloudflare Pages caps files at 25 MB)
 * and checks the SHA-256. The service worker keeps the parts for next time.
 */
function vendorWasm(runtime: OrtRuntime, name: string): Promise<ArrayBuffer> {
  const { base } = VENDOR[runtime];
  const file = vendored(runtime, name);
  const key = base + name;
  let pending = binaries.get(key);
  if (!pending) {
    pending = (async () => {
      const joined = new Uint8Array(file.bytes);
      let at = 0;
      for (const part of file.parts ?? [{ name, bytes: file.bytes }]) {
        const res = await fetch(base + part.name);
        if (!res.ok || !res.body) throw aiError('network', new Error(`${base + part.name}: HTTP ${res.status}`));
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          joined.set(value, at);
          at += value.length;
          listeners.get(key)?.forEach((fn) => fn(at, file.bytes));
        }
      }
      // crypto.subtle only exists on secure origins (https, localhost)
      if (crypto.subtle && hex(await crypto.subtle.digest('SHA-256', joined)) !== file.sha256) throw aiError('network', new Error(`${name} failed its integrity check`));
      ready.add(key);
      return joined.buffer;
    })().catch((err) => {
      binaries.delete(key);
      throw toAiError(err);
    });
    binaries.set(key, pending);
  }
  return pending;
}

/** Subscribes onBytes to a runtime download for as long as `job` runs */
async function hearing<T>(runtime: OrtRuntime, name: string, onBytes: Bytes | undefined, job: Promise<T>): Promise<T> {
  const key = VENDOR[runtime].base + name;
  if (!onBytes || ready.has(key)) return job;
  const set = listeners.get(key) ?? new Set<Bytes>();
  listeners.set(key, set.add(onBytes));
  try {
    return await job;
  } finally {
    set.delete(onBytes);
  }
}

const orts = new Map<'ort' | 'jsep', Promise<OrtModule>>();

/**
 * onnxruntime-web, imported at run time from /vendor so the bundler never copies its 27 MB wasm
 * into the build. Devices with WebGPU get the WebGPU build (which also runs on the CPU); the
 * rest get the 14 MB CPU-only build. Pass the result to libraries that take an `ort` option
 * (demucs-web). `build: 'jsep'` is ORT 1.22 with its JSEP WebGPU backend instead (see models.ts gpu).
 */
export async function loadOrt(onBytes?: Bytes, build: 'ort' | 'jsep' = 'ort'): Promise<OrtModule> {
  const device = await detectDevice();
  const file = engineFile(build, device.webgpu);
  let pending = orts.get(build);
  if (!pending) {
    pending = (async () => {
      const base = ortBase(build);
      const factory = engineFactory(build, device.webgpu);
      const [mod, binary] = await Promise.all([
        import(/* @vite-ignore */ `${base}${build === 'jsep' || device.webgpu ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'}`) as Promise<OrtModule>,
        vendorWasm(build, file),
      ]);
      Object.assign(mod.env.wasm, { wasmPaths: { mjs: `${base}${factory}.mjs` }, wasmBinary: binary, numThreads: device.threads, proxy: false });
      mod.env.logLevel = 'error';
      return mod;
    })().catch((err) => {
      orts.delete(build);
      throw toAiError(err);
    });
    orts.set(build, pending);
  }
  return hearing(build, file, onBytes, pending);
}

let transformers: Promise<TransformersModule> | undefined;
let transformersOn: 'transformers' | 'jsep' = 'transformers';
/** the ORT build transformers.js runs on in this page or worker */
export const transformersEngine = () => transformersOn;

/**
 * @huggingface/transformers with our runtime settings: models only from the Hub at pinned
 * revisions, cached in MODEL_CACHE, and ORT's wasm from /vendor. With `build: 'jsep'` it runs on
 * ORT 1.22 (transformers.js takes a global onnxruntime when one is set before it loads). One build
 * per page or worker: the first call decides, so a worker should only load models that agree.
 */
export function loadTransformers(onBytes?: Bytes, build: 'transformers' | 'jsep' = 'transformers'): Promise<TransformersModule> {
  if (transformers && build !== transformersOn) console.warn(`transformers.js already runs on the ${transformersOn} build here; ${build} was asked for`);
  transformers ??= (async () => {
    transformersOn = build;
    if (build === 'jsep') (globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')] = await loadOrt(undefined, 'jsep');
    const [mod, device] = await Promise.all([import('@huggingface/transformers'), detectDevice()]);
    const { env } = mod;
    Object.assign(env, { allowLocalModels: false, cacheKey: MODEL_CACHE, useWasmCache: false });
    if (build === 'transformers') {
      const name = engineFactory('transformers', true);
      Object.assign(env.backends.onnx.wasm!, {
        wasmPaths: { mjs: `${ortBase('transformers')}${name}.mjs` },
        wasmBinary: await vendorWasm('transformers', `${name}.wasm`),
        numThreads: device.threads,
      });
      const bundled = env.backends.onnx.versions?.web;
      if (bundled && bundled !== VENDOR.transformers.version) console.warn(`transformers.js bundles onnxruntime-web ${bundled} but /vendor has ${VENDOR.transformers.version}; run scripts/vendor-ai.mjs`);
    }
    return mod;
  })().catch((err) => {
    transformers = undefined;
    throw toAiError(err);
  });
  const runtime = transformersOn;
  return hearing(runtime, engineFile(runtime, true), onBytes, transformers);
}

/**
 * Paths for tesseract.js `createWorker(langs, oem, { ...tesseractPaths() })`. Its worker is
 * started from a blob, so the URLs must be absolute. Language data (`langPath`) is up to the tool.
 */
export function tesseractPaths(): { workerPath: string; corePath: string } {
  const base = new URL(VENDOR.tesseract.base, location.origin).href;
  return { workerPath: `${base}worker.min.js`, corePath: `${base}core` };
}
