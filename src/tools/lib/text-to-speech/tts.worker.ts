/// <reference lib="webworker" />
/*
 * Kokoro 82M through kokoro-js, in a worker. kokoro-js brings its own transformers.js 3 and the
 * espeak-ng phonemizer (GPL, credited on /credits); both are imported on first load as a
 * separate chunk. Its ORT build (1.22 jsep) comes from /vendor.
 * kokoro-js can't pin a revision and caches on its own ('transformers-cache', 'kokoro-voices'),
 * so this worker sends its `main` requests (weights, tokenizer, voices) to the pinned commit and
 * keeps them in the shared model cache under the pinned URLs, where ModelGate and
 * clearModelCache('kokoro') find them like any other model's files.
 */
import type { Device, Variant } from '@/engines/ai/models';
import { MODELS, variantFiles } from '@/engines/ai/models';
import { ProgressTally, throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { ENGINE_FILE, ortBase } from '@/engines/ai/runtime';
import { MODEL_CACHE } from '@/engines/ai/storage';
import { VENDOR } from '@/engines/ai/vendor.generated';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import type { VoiceId } from './voices';

type Kokoro = InstanceType<typeof import('kokoro-js').KokoroTTS>;
export interface Opts {
  variant: string;
  device: Device;
}

const spec = MODELS.kokoro;
const MAIN = `https://huggingface.co/${spec.repo}/resolve/main/`;
const PINNED = `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/`;
const pinned = (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith(MAIN) ? PINNED + url.slice(MAIN.length) : url;
};

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = pinned(input);
  const res = await nativeFetch(url.startsWith(PINNED) ? url : input, init);
  // kokoro-js reads voice files without checking the status and caches whatever came back, so an
  // error page (rate limit, outage) would become a broken voice for good; transformers.js checks its own
  if (!res.ok && url.startsWith(`${PINNED}voices/`)) throw new Error(`HTTP ${res.status} for ${url.slice(PINNED.length)}`);
  return res;
};

// kokoro-js only calls match() and put() on the caches it opens
if (typeof caches !== 'undefined') {
  const open = caches.open.bind(caches);
  caches.open = async () => {
    const cache = await open(MODEL_CACHE);
    return { match: (key, o) => cache.match(pinned(key), o), put: (key, res) => cache.put(pinned(key), res) } as Cache;
  };
}

const WASM = 'ort-wasm-simd-threaded.jsep.wasm';
let engineUrl: Promise<string> | null = null;

/** the 21.6 MB runtime, fetched by us (for the progress bar) and handed to ORT as a blob URL */
function engine(onBytes: (loaded: number) => void): Promise<string> {
  engineUrl ??= (async () => {
    const res = await nativeFetch(ortBase('jsep') + WASM);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${WASM}`);
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
  })().catch((err) => {
    engineUrl = null;
    throw err;
  });
  return engineUrl;
}

let loading: Promise<{ tts: Kokoro; device: Device }> | null = null;

async function load(o: Opts, onProgress?: OnProgress) {
  const report = onProgress ? throttleProgress(onProgress) : () => {};
  const engineBytes = VENDOR.jsep.files[WASM].bytes;
  const tally = new ProgressTally({ ...Object.fromEntries(variantFiles(spec, o.variant).map((f) => [f.path, f.bytes])), [ENGINE_FILE]: engineBytes });
  const [wasm, { KokoroTTS, env }] = await Promise.all([engine((n) => report(tally.update(ENGINE_FILE, n, engineBytes))), import('kokoro-js')]);
  env.wasmPaths = { mjs: `${ortBase('jsep')}ort-wasm-simd-threaded.jsep.mjs`, wasm };
  const dtype = (spec.variants as Record<string, Variant>)[o.variant].dtype as 'q8' | 'fp32';
  const fromPretrained = (device: Device) =>
    KokoroTTS.from_pretrained(spec.repo, {
      dtype,
      device,
      progress_callback: (i: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (!i.file) return;
        if (i.status === 'progress') report(tally.update(i.file, i.loaded ?? 0, i.total));
        else if (i.status === 'done') report(tally.done(i.file));
      },
    });
  let device = o.device;
  let tts: Kokoro;
  try {
    tts = await fromPretrained(device);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    console.warn('Kokoro: WebGPU failed, retrying on the CPU', err);
    tts = await fromPretrained((device = 'wasm'));
  }
  const total = tally.sum().total;
  report({ phase: 'init', loaded: total, total });
  // the first run sets up the session and fetches the default voice, so the first real sentence starts sooner
  await tts.generate('Ready.', { voice: 'af_heart' });
  return { tts, device };
}

/** one load per worker; after a crash or cancel the page's next call loads again (from the cache) */
function ensure(o: Opts, onProgress?: OnProgress) {
  loading ??= load(o, onProgress).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

// one sentence at a time: previews and the reading queue share the model
let queue: Promise<unknown> = Promise.resolve();

const api = {
  async load(o: Opts, onProgress: OnProgress) {
    const { device } = await ensure(o, onProgress);
    return { device, variant: o.variant };
  },

  /** speaks one sentence; mono Float32 samples at 24 kHz */
  speak(text: string, voice: VoiceId, speed: number, o: Opts) {
    const job = queue.then(async () => {
      const { tts } = await ensure(o);
      // a copy we own: the model's output may be a view into memory the runtime keeps using
      const audio = (await tts.generate(text, { voice, speed })).audio.slice() as Float32Array<ArrayBuffer>;
      return transfer(audio, [audio.buffer]);
    });
    queue = job.catch(() => {});
    return job;
  },
};

exposeWorker(api);
export type TtsWorker = typeof api;
