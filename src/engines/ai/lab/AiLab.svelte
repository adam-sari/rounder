<script lang="ts">
  /*
   * Dev-only bench for the AI engine (/dev/ai-lab): device report, vendored runtime check,
   * MODNet through both loading paths (transformers.js pipeline in a worker behind ModelGate,
   * raw ORT session on the page) with timings, and the model cache.
   */
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { decodeImage } from '@/engines/image/client';
  import {
    cachedVariant,
    clearModelCache,
    createOrtSession,
    detectDevice,
    forgetConsent,
    formatMB,
    formatProgress,
    MODELS,
    storageEstimate,
    toAiError,
    totalDownloadSize,
    type DeviceInfo,
    type LoadProgress,
    type StorageEstimate,
  } from '@/engines/ai';
  import { VENDOR } from '@/engines/ai/vendor.generated';
  import { modelWorker, proxy } from '@/engines/ai/worker-utils';
  import type { LabWorker } from './lab.worker';

  let page = $state<DeviceInfo | null>(null);
  let inWorker = $state<DeviceInfo | null>(null);
  let storage = $state<StorageEstimate | null>(null);
  let vendor = $state<{ url: string; status: string; ok: boolean }[]>([]);

  let source = $state.raw<ImageData | null>(null);
  let sourceUrl = $state('');
  let forceCpu = $state(false);

  // path A: transformers pipeline in a worker
  const worker = modelWorker<LabWorker>(() => new Worker(new URL('./lab.worker.ts', import.meta.url), { type: 'module' }));
  let loadedA = $state('');
  let resultA = $state('');
  let busyA = $state(false);
  let errorA = $state('');

  // path B: raw ORT session on the page
  let session = $state.raw<Awaited<ReturnType<typeof createOrtSession>> | null>(null);
  let progressB = $state<LoadProgress | null>(null);
  let resultB = $state('');
  let busyB = $state(false);
  let errorB = $state('');
  let controllerB: AbortController | null = null;
  let matteCanvas = $state<HTMLCanvasElement>();
  let cutoutUrl = $state('');

  let cache = $state<Record<string, string>>({});
  const CACHE_KEYS = ['modnet', 'birefnet-lite', 'whisper-base', 'depth-anything-v2-small'] as const;

  async function refreshCache() {
    storage = await storageEstimate();
    cache = Object.fromEntries(await Promise.all(CACHE_KEYS.map(async (k) => [k, (await cachedVariant(k)) ?? 'not cached'])));
  }

  async function checkVendor() {
    const urls = [
      ...Object.values(VENDOR).flatMap((rt) =>
        'files' in rt ? Object.entries(rt.files as Record<string, { parts?: readonly { name: string }[] }>).flatMap(([name, f]) => (f.parts ? f.parts.map((p) => rt.base + p.name) : [rt.base + name])) : [],
      ),
      `${VENDOR.tesseract.base}worker.min.js`,
      `${VENDOR.tesseract.base}core/tesseract-core-simd-lstm.wasm.js`,
    ];
    vendor = await Promise.all(
      urls.map(async (url) => {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
        const bytes = Number(res?.headers.get('content-length'));
        return { url, ok: !!res?.ok, status: res ? `${res.status}${bytes ? ` · ${formatMB(bytes)}` : ''}` : 'failed' };
      }),
    );
  }

  /** a stand-in "portrait" so both paths can run without a file */
  function sample(): ImageData {
    const c = new OffscreenCanvas(640, 480);
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, '#7cc4ff');
    sky.addColorStop(1, '#2a3a55');
    g.fillStyle = sky;
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#e8b48c';
    g.beginPath();
    g.ellipse(320, 190, 70, 90, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c8a6ff';
    g.beginPath();
    g.ellipse(320, 480, 170, 150, 0, Math.PI, 0);
    g.fill();
    return g.getImageData(0, 0, 640, 480);
  }

  async function show(img: ImageData) {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d')!.putImageData(img, 0, 0);
    return URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
  }

  async function useImage(img: ImageData) {
    source = img;
    URL.revokeObjectURL(sourceUrl);
    sourceUrl = await show(img);
  }

  onMount(() => {
    detectDevice().then((d) => (page = d));
    worker.call((api) => api.device()).then((d) => (inWorker = d), () => {});
    useImage(sample());
    refreshCache();
    checkVendor();
    return () => worker.terminate();
  });

  async function runA() {
    if (!source) return;
    busyA = true;
    errorA = resultA = '';
    try {
      const copy = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
      const { image, ms } = await worker.call((api) => api.run(copy));
      URL.revokeObjectURL(cutoutUrl);
      cutoutUrl = await show(image);
      resultA = `${image.width}×${image.height} in ${ms.toFixed(0)} ms`;
    } catch (err) {
      errorA = toAiError(err).message;
    } finally {
      busyA = false;
    }
  }

  async function loadB() {
    controllerB?.abort();
    const ctl = (controllerB = new AbortController());
    busyB = true;
    errorB = resultB = '';
    // a session keeps its weights (on the GPU too) until released
    await session?.value.session.release().catch(() => {});
    session = null;
    try {
      const gpu = !forceCpu && (await detectDevice()).webgpu;
      // fp32/q8 keep float32 inputs, so this demo needs no Float16Array handling
      session = await createOrtSession('modnet', { device: gpu ? 'webgpu' : 'wasm', variant: gpu ? 'fp32' : 'q8', signal: ctl.signal, onProgress: (p) => (progressB = p) });
      refreshCache();
    } catch (err) {
      errorB = toAiError(err).message;
    } finally {
      busyB = false;
      progressB = null;
    }
  }

  /**
   * MODNet by hand, as its preprocessor_config.json says: shortest edge 512, sides a multiple of
   * 32, RGB (x/255 − 0.5)/0.5, NCHW float32 → 1×1×H×W matte in 0…1, scaled back to the input size
   */
  async function runB() {
    if (!source || !session) return;
    const { session: s, ort } = session.value;
    busyB = true;
    errorB = '';
    try {
      const scale = 512 / Math.min(source.width, source.height);
      const [W, H] = [source.width, source.height].map((d) => Math.max(32, Math.round((d * scale) / 32) * 32));
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d')!;
      g.drawImage(await createImageBitmap(source), 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      const N = W * H;
      const input = new Float32Array(3 * N);
      for (let i = 0; i < N; i++) for (let ch = 0; ch < 3; ch++) input[ch * N + i] = px[i * 4 + ch] / 127.5 - 1;
      const start = performance.now();
      const feed = new ort.Tensor('float32', input, [1, 3, H, W]);
      const out = await s.run({ [s.inputNames[0]]: feed });
      const ms = performance.now() - start;
      const result = out[s.outputNames[0]];
      const matte = result.data as Float32Array;
      const img = new ImageData(W, H);
      for (let i = 0; i < N; i++) {
        const v = Math.round(Math.min(1, Math.max(0, matte[i])) * 255);
        img.data.set([v, v, v, 255], i * 4);
      }
      // tensors can hold GPU buffers: free them as soon as the pixels are read
      feed.dispose();
      result.dispose();
      const m = matteCanvas!;
      m.width = source.width;
      m.height = source.height;
      m.getContext('2d')!.drawImage(await createImageBitmap(img), 0, 0, source.width, source.height);
      resultB = `inputs ${s.inputNames.join(', ')} → outputs ${s.outputNames.join(', ')} · run ${ms.toFixed(0)} ms`;
    } catch (err) {
      errorB = toAiError(err).message;
    } finally {
      busyB = false;
    }
  }

  // C: the gate's own UI, with loading faked so nothing big downloads
  let gateRun = $state(0);
  async function simulate({ spec, variant, onProgress, signal }: GateLoadContext) {
    const total = totalDownloadSize(spec, variant);
    for (let i = 1; i <= 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      signal.throwIfAborted();
      onProgress({ phase: i === 40 ? 'init' : 'download', loaded: (total * i) / 40, total });
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  function resetGate() {
    forgetConsent('birefnet-lite');
    gateRun++;
  }

  async function clear(key?: 'modnet') {
    await clearModelCache(key);
    await refreshCache();
  }
</script>

<div class="lab">
  <section class="card pad">
    <h2>Device</h2>
    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <span class="label">page</span>
        <pre>{page ? JSON.stringify(page, null, 2) : 'detecting…'}</pre>
      </div>
      <div>
        <span class="label">inside a worker</span>
        <pre>{inWorker ? JSON.stringify(inWorker, null, 2) : 'detecting…'}</pre>
      </div>
    </div>
    <p class="mono">crossOriginIsolated: {String(globalThis.crossOriginIsolated)} · storage: {storage ? `${formatMB(storage.usage)} used of ${formatMB(storage.quota)}${storage.persisted ? ' · persisted' : ''}` : 'unknown'}</p>
  </section>

  <section class="card pad">
    <div class="row">
      <h2>Vendored runtimes</h2>
      <button type="button" class="btn sm" onclick={checkVendor}>Recheck</button>
    </div>
    <ul class="grid gap-1">
      {#each vendor as v (v.url)}
        <li class="mono"><span class={v.ok ? 'text-ok' : 'text-bad'}>{v.ok ? '✓' : '✗'}</span> {v.url} · {v.status}</li>
      {/each}
    </ul>
  </section>

  <section class="card pad">
    <div class="row">
      <h2>Test image</h2>
      <label class="mono flex items-center gap-2"><input type="checkbox" bind:checked={forceCpu} class="accent-(--color-ai)" /> force CPU (wasm) for both paths</label>
    </div>
    <Dropzone accept="image/*" title="Drop a portrait" hint="or use the built-in sample" paste={false} onfiles={async ([f]) => useImage(await decodeImage(f))} />
    {#if sourceUrl}<img src={sourceUrl} alt="Test input" class="thumb" />{/if}
  </section>

  <section class="card pad">
    <h2>A · transformers.js pipeline in a worker</h2>
    <p class="mono">ModelGate → lab.worker.ts → loadTransformersPipeline('background-removal', 'modnet')</p>
    <ModelGate
      model="modnet"
      light={null}
      autostart={false}
      load={async ({ variant, device, onProgress, signal }) => {
        const r = await worker.call((api) => api.load(forceCpu ? { device: 'wasm' } : { variant, device }, proxy(onProgress)), signal);
        loadedA = `${r.variant} on ${r.device} · loaded in ${r.ms.toFixed(0)} ms`;
        refreshCache();
        return { device: r.device };
      }}
    >
      {#snippet children()}
        <div class="grid gap-3">
          <p class="mono">{loadedA}</p>
          <div class="row gap">
            <button type="button" class="btn btn-primary sm" disabled={busyA || !source} onclick={runA}>{busyA ? 'Running…' : 'Run cut-out'}</button>
            {#if resultA}<span class="mono">{resultA}</span>{/if}
          </div>
          {#if errorA}<p class="text-sm text-bad" role="alert">{errorA}</p>{/if}
          {#if cutoutUrl}<img src={cutoutUrl} alt="Cut-out result" class="thumb checker" />{/if}
        </div>
      {/snippet}
    </ModelGate>
  </section>

  <section class="card pad">
    <h2>B · raw ORT session on the page</h2>
    <p class="mono">createOrtSession('modnet') · onnxruntime-web from /vendor ({VENDOR.jsep.version} JSEP on WebGPU, as models.ts says; {VENDOR.ort.version} on the CPU) · fp32 on WebGPU, q8 on CPU</p>
    <div class="row gap">
      <button type="button" class="btn sm" disabled={busyB} onclick={loadB}>{session ? 'Reload session' : 'Load session'}</button>
      {#if progressB}
        <span class="mono">{progressB.phase === 'init' ? 'creating session…' : formatProgress(progressB)}</span>
        <button type="button" class="btn sm" onclick={() => controllerB?.abort()}>Cancel</button>
      {/if}
      {#if session}
        <span class="mono">{session.variant} on {session.device} · ready in {session.ms.toFixed(0)} ms</span>
        <button type="button" class="btn btn-primary sm" disabled={busyB || !source} onclick={runB}>Run matte</button>
      {/if}
    </div>
    {#if resultB}<p class="mono">{resultB}</p>{/if}
    {#if errorB}<p class="text-sm text-bad" role="alert">{errorB}</p>{/if}
    <canvas bind:this={matteCanvas} class="thumb" class:hidden={!resultB}></canvas>
  </section>

  <section class="card pad">
    <div class="row">
      <h2>C · ModelGate with a light alternative</h2>
      <button type="button" class="btn sm" onclick={resetGate}>Reset card</button>
    </div>
    <p class="mono">BiRefNet lite (WebGPU only) with MODNet as the light model. Loading is simulated: nothing downloads. Try it without WebGPU (Firefox, or chrome://flags) and with phone emulation; both should start on MODNet.</p>
    {#key gateRun}
      <ModelGate model="birefnet-lite" autostart={false} load={simulate}>
        {#snippet children({ key, variant, device })}
          <p class="mono">ready (simulated): {key} · {variant} · {device}</p>
        {/snippet}
      </ModelGate>
    {/key}
  </section>

  <section class="card pad">
    <div class="row">
      <h2>Model cache</h2>
      <div class="row gap">
        <button type="button" class="btn sm" onclick={refreshCache}>Refresh</button>
        <button type="button" class="btn sm" onclick={() => clear('modnet')}>Clear MODNet</button>
        <button type="button" class="btn sm" onclick={() => clear()}>Clear all models</button>
      </div>
    </div>
    <ul class="grid gap-1">
      {#each Object.entries(cache) as [key, variant] (key)}
        <li class="mono">
          {key} ({MODELS[key as keyof typeof MODELS].name}) · cached variant: {variant}
          · sizes: {Object.keys(MODELS[key as keyof typeof MODELS].variants).map((v) => `${v} ${formatMB(totalDownloadSize(key as keyof typeof MODELS, v))}`).join(', ')}
        </li>
      {/each}
    </ul>
    <p class="mono">isModelCached('modnet', 'q8') via the console: <code>(await import('/src/engines/ai/index.ts')).isModelCached('modnet', 'q8')</code></p>
  </section>
</div>

<style>
  .lab {
    display: grid;
    gap: 18px;
    padding-block: 32px 80px;
  }
  .pad {
    padding: 20px;
    display: grid;
    gap: 14px;
  }
  h2 {
    font-size: 28px;
    line-height: 1.1;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .gap {
    justify-content: flex-start;
    gap: 8px;
  }
  .sm {
    padding: 7px 11px;
    font-size: 13px;
  }
  pre {
    font: 400 12px/1.5 var(--font-mono);
    color: var(--color-soft);
    background: #141312;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    padding: 12px;
    overflow: auto;
    max-height: 320px;
  }
  .thumb {
    max-width: min(100%, 420px);
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
  }
  .checker {
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
  }
</style>
