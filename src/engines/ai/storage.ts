import { aiError, toAiError } from './errors';
import { getModel, modelUrl, variantFiles, type ModelKey, type ModelSpec } from './models';

/** Cache Storage bucket for model files; transformers.js is pointed at it too */
export const MODEL_CACHE = 'rounder-models-v1';
/** where kokoro-js (transformers.js 3) keeps its files */
const LEGACY_CACHES = ['transformers-cache'];

const hasCaches = () => typeof caches !== 'undefined';

async function openCache(): Promise<Cache | null> {
  try {
    return hasCaches() ? await caches.open(MODEL_CACHE) : null;
  } catch {
    // private windows and some embedded browsers refuse Cache Storage
    return null;
  }
}

/** Reads a body into one buffer, reporting bytes; preallocates when the size is known */
async function readBody(res: Response, size: number, onBytes?: (loaded: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  let buf = new Uint8Array(size);
  let chunks: Uint8Array[] | null = size ? null : [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!chunks && loaded + value.length > buf.length) chunks = [buf.subarray(0, loaded)];
    if (chunks) chunks.push(value);
    else buf.set(value, loaded);
    loaded += value.length;
    onBytes?.(loaded);
  }
  if (chunks) {
    buf = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) buf.set(c, (at += c.length) - c.length);
  }
  return loaded === buf.length ? buf : buf.slice(0, loaded);
}

export interface FetchOptions {
  /** bytes so far and the expected total */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** size from the registry, used when the server sends no Content-Length */
  bytes?: number;
}

/**
 * Fetches a model file from the model cache, or from the network and then into the cache.
 * A cache that is full or unavailable never fails the download; the file just isn't kept.
 */
export async function fetchCached(url: string, { onProgress, signal, bytes = 0 }: FetchOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const cache = await openCache();
    const hit = await cache?.match(url);
    if (hit) {
      const size = Number(hit.headers.get('content-length')) || bytes;
      return await readBody(hit, size, (n) => onProgress?.(n, size));
    }
    const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
    if (res.status === 429) throw aiError('rate-limited');
    if (!res.ok) throw aiError('network', new Error(`HTTP ${res.status} for ${url}`));
    const size = Number(res.headers.get('content-length')) || bytes;
    const data = await readBody(res, size, (n) => onProgress?.(n, Math.max(size, n)));
    await cache?.put(url, new Response(data, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(data.length) } })).catch(() => {});
    return data;
  } catch (err) {
    throw toAiError(signal?.aborted ? signal.reason ?? err : err);
  }
}

const matchAnywhere = async (url: string) => hasCaches() && !!(await caches.match(url).catch(() => undefined));

/** True when every file of the variant (or of any variant, when none is named) is already on this device */
export async function isModelCached(model: ModelKey | ModelSpec, variant?: string): Promise<boolean> {
  return variant ? (await Promise.all(variantFiles(model, variant).map((f) => matchAnywhere(modelUrl(model, f.path))))).every(Boolean) : !!(await cachedVariant(model));
}

/** The first variant (in preference order) that is fully cached, or null */
export async function cachedVariant(model: ModelKey | ModelSpec): Promise<string | null> {
  const m = getModel(model);
  const order = [...new Set([...m.prefer.webgpu, ...m.prefer.wasm, ...Object.keys(m.variants)])];
  for (const v of order) if (await isModelCached(m, v)) return v;
  return null;
}

/** Deletes one model's files (and its remembered consent), or every downloaded model */
export async function clearModelCache(model?: ModelKey): Promise<void> {
  if (!hasCaches()) return;
  if (!model) {
    await Promise.all([MODEL_CACHE, ...LEGACY_CACHES].map((name) => caches.delete(name)));
    forgetAllConsent();
    return;
  }
  const m = getModel(model);
  const urls = Object.keys(m.variants).flatMap((v) => variantFiles(m, v).map((f) => modelUrl(m, f.path)));
  // transformers.js also keeps config lookups under /resolve/main/ (and kokoro-js everything)
  const repo = m.baseUrl ? null : `https://huggingface.co/${m.repo}/resolve/`;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    const stale: (Request | string)[] = repo ? (await cache.keys()).filter((r) => r.url.startsWith(repo)) : urls;
    await Promise.all(stale.map((r) => cache.delete(r)));
  }
  forgetConsent(model);
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** quota minus usage: roughly what this site may still store */
  available: number;
  persisted: boolean;
}

/** How much this site may store; null where the browser won't say */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage, quota, available: Math.max(0, quota - usage), persisted };
  } catch {
    return null;
  }
}

/**
 * Asks the browser not to evict our storage under pressure. Chrome decides silently; Firefox may
 * show a prompt, so only call this from a click, and only for big downloads.
 */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

// ── consent: "Download model & start" is asked once per model ──

const consentKey = (model: ModelKey) => `rounder:ai-consent:${model}`;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function hasConsent(model: ModelKey): boolean {
  try {
    return store()?.getItem(consentKey(model)) === getModel(model).revision;
  } catch {
    return false;
  }
}

export function rememberConsent(model: ModelKey): void {
  try {
    store()?.setItem(consentKey(model), getModel(model).revision);
  } catch {
    // storage full or blocked: we'll simply ask again next time
  }
}

export function forgetConsent(model: ModelKey): void {
  try {
    store()?.removeItem(consentKey(model));
  } catch {
    /* nothing remembered */
  }
}

function forgetAllConsent() {
  const s = store();
  if (!s) return;
  try {
    for (const k of Object.keys(s)) if (k.startsWith('rounder:ai-consent:')) s.removeItem(k);
  } catch {
    /* nothing remembered */
  }
}
