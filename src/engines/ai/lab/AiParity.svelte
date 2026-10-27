<script lang="ts">
  /*
   * Dev-only parity check (/dev/ai-parity): each model runs the same input on the CPU (wasm, the
   * reference) and on the graphics card through both WebGPU backends (onnxruntime's current
   * WebGPU EP and 1.22's JSEP), each in a fresh worker. A GPU result passes when it stays close to
   * the CPU's: fp16 vs fp32 differs by well under 1%, a broken kernel by far more.
   * Console: `await parity.run('modnet', { device: 'webgpu', variant: 'fp16', gpu: 'jsep' })`.
   */
  import { onMount } from 'svelte';
  import { detectDevice, formatMB, MODELS, totalDownloadSize, type ModelKey } from '@/engines/ai';
  import { modelWorker } from '@/engines/ai/worker-utils';
  import type { ParityConfig, ParityInput, ParityOutput, ParityWorker } from './parity.worker';

  const DOCS = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/';
  /** demucs-web's segment length (TRAINING_SAMPLES) */
  const SEGMENT = 343980;

  interface Row {
    key: ModelKey;
    /** CPU reference variant */
    ref: string;
    /** where the reference runs, when the CPU can't */
    refDevice?: 'webgpu';
    /** variants to try on the graphics card */
    gpu: string[];
    /** run twice and time the second run (cheap models only) */
    warm?: boolean;
    /** more configs to compare, e.g. without the registry's graph patch */
    extra?: ParityConfig[];
  }
  const ROWS: Row[] = [
    // the CPU can't hold BiRefNet at 1024² (wasm's 4 GB); GPU fp32 matches native onnxruntime-node's CPU result to 0.002%
    { key: 'birefnet-lite', ref: 'fp32', refDevice: 'webgpu', gpu: ['fp16'] },
    { key: 'modnet', ref: 'fp32', gpu: ['fp16', 'fp32'], warm: true },
    { key: 'swin2sr-x2-light', ref: 'fp32', gpu: ['fp32'], warm: true },
    { key: 'swin2sr-x4-realworld', ref: 'fp32', gpu: ['fp16', 'fp32'], warm: true },
    { key: 'migan', ref: 'fp32', gpu: ['fp32'], warm: true },
    { key: 'lama', ref: 'fp32', gpu: ['fp32'] },
    // fp16 math on the GPU is 110% off; widened to fp32 (patch) it matches. Also: the CPU on the widened graph
    {
      key: 'ddcolor-tiny',
      ref: 'fp16',
      gpu: ['fp16'],
      warm: true,
      extra: [
        { device: 'webgpu', variant: 'fp16', gpu: 'webgpu', patch: false },
        { device: 'wasm', variant: 'fp16', patch: true },
      ],
    },
    { key: 'florence2-base', ref: 'mixed', gpu: ['mixed', 'q8'] },
    { key: 'depth-anything-v2-small', ref: 'fp32', gpu: ['fp16', 'fp32'], warm: true },
    { key: 'whisper-tiny', ref: 'fp16', gpu: ['fp16', 'q8'] },
    { key: 'whisper-base', ref: 'fp16', gpu: ['fp16', 'q8'] },
    // the CPU takes ≈6 min on JFK (one thread) for the same text; GPU q4 matches it to 0.01%. q4f16's
    // features are 5–11% off with the same words (JFK, a noisy clip via parity.useSpeech); JSEP q4f16 32% off
    { key: 'whisper-large-turbo', ref: 'q4', refDevice: 'webgpu', gpu: ['q4f16'] },
    { key: 'opus-mt-en-es', ref: 'q8', gpu: ['q8'] },
    // the CPU has no GatherBlockQuantized kernel; q4 on the GPU computes in fp32
    { key: 'qwen3.5-0.8b', ref: 'q4', refDevice: 'webgpu', gpu: ['q4f16'] },
    { key: 'demucs', ref: 'fp32', gpu: ['fp32'] },
  ];
  const BACKENDS = ['webgpu', 'jsep'] as const;

  interface Result extends ParityOutput {
    error?: string;
  }
  interface Verdict {
    relL1: number;
    maxAbs: number;
    cos: number;
    sim: number;
    pass: boolean;
    why: string;
  }

  let input = $state.raw<ParityInput | null>(null);
  let status = $state('loading test inputs…');
  let gpuName = $state('');
  let results = $state<Record<string, Result>>({});
  let busy = $state<Record<string, boolean>>({});
  let queue: Promise<unknown> = Promise.resolve();

  const id = (key: string, c: ParityConfig) => `${key}|${c.device}|${c.variant}|${c.gpu ?? ''}${c.patch === undefined ? '' : `|patch:${c.patch}`}`;
  const configs = (r: Row): ParityConfig[] => [
    { device: r.refDevice ?? 'wasm', variant: r.ref },
    ...r.gpu.flatMap((variant) => BACKENDS.map((gpu) => ({ device: 'webgpu' as const, variant, gpu }))),
    ...(r.extra ?? []),
  ];

  async function decodeAudio(url: string, rate: number, channels: number): Promise<Float32Array[]> {
    const buf = await (await fetch(url)).arrayBuffer();
    const probe = await new OfflineAudioContext(1, 1, rate).decodeAudioData(buf);
    const ctx = new OfflineAudioContext(channels, Math.ceil(probe.duration * rate), rate);
    const src = ctx.createBufferSource();
    src.buffer = probe;
    src.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    return Array.from({ length: channels }, (_, c) => out.getChannelData(c));
  }

  onMount(async () => {
    const info = await detectDevice();
    gpuName = info.webgpu ? `${info.adapterInfo?.vendor} ${info.adapterInfo?.architecture} · shader-f16 ${info.fp16} · max buffer ${formatMB(info.maxBufferSize)}` : `no WebGPU: ${info.reason}`;
    const bmp = await createImageBitmap(await (await fetch(`${DOCS}portrait-of-woman.jpg`)).blob());
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const [speech] = await decodeAudio(`${DOCS}jfk.wav`, 16000, 1);
    const [left, right] = await decodeAudio(`${DOCS}jfk.wav`, 44100, 2);
    input = { image: ctx.getImageData(0, 0, bmp.width, bmp.height), speech, music: [left.slice(0, SEGMENT), right.slice(0, SEGMENT)] };
    status = `portrait ${bmp.width}×${bmp.height} · speech ${(speech.length / 16000).toFixed(1)} s · one ${(SEGMENT / 44100).toFixed(1)} s Demucs segment`;
    (window as unknown as { parity: unknown }).parity = {
      run,
      runRow: (key: ModelKey) => runRow(ROWS.find((r) => r.key === key)!),
      summary,
      /** another speech clip (same origin) for the Whisper rows, e.g. a noisy one; clears earlier results */
      useSpeech: async (url: string) => {
        const [speech] = await decodeAudio(url, 16000, 1);
        input = { ...input!, speech };
        results = {};
        return `speech ${(speech.length / 16000).toFixed(1)} s`;
      },
      /** any two runs, e.g. compare('whisper-base', { device: 'wasm', variant: 'fp16' }, { device: 'webgpu', variant: 'fp16', gpu: 'webgpu' }) */
      compare: (key: ModelKey, a: ParityConfig, b: ParityConfig) => verdict(results[id(key, a)], results[id(key, b)]),
    };
  });

  /** every result as one line of text, for the console */
  function summary(filter = ''): string {
    return Object.entries(results)
      .filter(([k]) => k.includes(filter))
      .map(([k, r]) => {
        const row = ROWS.find((x) => x.key === k.split('|')[0]);
        const refKey = row && id(row.key, configs(row)[0]);
        const v = row && k !== refKey ? verdict(results[refKey!], r) : null;
        const cmp = v ? ` Δ ${(v.relL1 * 100).toFixed(2)}% cos ${v.cos.toFixed(4)} max ${v.maxAbs.toPrecision(3)} sim ${v.sim.toFixed(2)} ${v.pass ? 'PASS' : `FAIL ${v.why}`}` : '';
        return `${k} → ${r.device} load ${ms(r.loadMs)} run ${ms(r.runMs)}${r.error ? ` ERROR ${r.error}` : cmp}${r.text !== undefined ? ` "${r.text}"` : ''}`;
      })
      .join('\n');
  }

  /** one config in a fresh worker; runs are queued so timings don't overlap */
  function run(key: ModelKey, c: ParityConfig, warm = false): Promise<Result> {
    const k = id(key, c);
    const job = queue.then(async () => {
      busy[k] = true;
      const worker = modelWorker<ParityWorker>(() => new Worker(new URL('./parity.worker.ts', import.meta.url), { type: 'module' }));
      try {
        // the input is copied, not transferred: every run needs it
        results[k] = await worker.call((api) => api.run(key, c, input!, warm));
      } catch (err) {
        results[k] = { device: c.device!, variant: c.variant!, loadMs: 0, runMs: 0, error: String((err as Error).message ?? err) };
        console.error(k, err);
      } finally {
        worker.terminate();
        busy[k] = false;
      }
      return results[k];
    });
    queue = job.catch(() => {});
    return job;
  }

  async function runRow(r: Row) {
    for (const c of configs(r)) await run(r.key, c, r.warm);
  }

  /** 1 − edit distance / length, on words */
  function similarity(a: string, b: string): number {
    const x = a.toLowerCase().split(/\s+/).filter(Boolean);
    const y = b.toLowerCase().split(/\s+/).filter(Boolean);
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      const cur = [i];
      for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[y.length] / Math.max(1, x.length, y.length);
  }

  function verdict(ref: Result | undefined, got: Result | undefined): Verdict | null {
    if (!ref || !got || ref.error || got.error) return null;
    const v: Verdict = { relL1: 0, maxAbs: 0, cos: 1, sim: 1, pass: true, why: '' };
    // fp32 matches to well under 1%, and fp16 on the GPU (true fp16 math) against fp32 or the CPU's
    // upcast fp16 within a few %. A broken kernel is off by tens of %
    const fp16 = got.variant.includes('16');
    const tol = ref.variant === got.variant ? (fp16 ? 0.05 : 0.01) : fp16 && ref.variant === 'fp32' ? 0.02 : 0.1;
    const writes = ref.text !== undefined && got.text !== undefined;
    if (ref.values && got.values) {
      const a = ref.values;
      const b = got.values;
      if (a.length !== b.length) return { ...v, pass: false, why: `length ${b.length} ≠ ${a.length}` };
      let diff = 0;
      let mag = 0;
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        diff += d;
        mag += Math.abs(a[i]);
        if (d > v.maxAbs || Number.isNaN(d)) v.maxAbs = d;
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      v.relL1 = diff / Math.max(mag, 1e-12);
      v.cos = dot / Math.sqrt(na * nb);
      // for models that write text, the text decides; their inner numbers only have to point the same way
      if (writes ? !(v.cos >= 0.95) : !(v.relL1 <= tol))
        Object.assign(v, { pass: false, why: writes ? `features point elsewhere (cos ${v.cos.toFixed(3)})` : `off by ${(v.relL1 * 100).toFixed(1)}% (allowed ${tol * 100}%)` });
    }
    if (writes) {
      v.sim = similarity(ref.text ?? '', got.text ?? '');
      if (v.sim < 0.8) Object.assign(v, { pass: false, why: `${v.why ? `${v.why}; ` : ''}text differs` });
    }
    return v;
  }

  const ms = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)} s` : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n.toFixed(0)} ms`);
  const size = (r: Row, v: string) => formatMB(totalDownloadSize(r.key, v));
</script>

<div class="lab">
  <section class="card pad">
    <p class="mono">{gpuName}</p>
    <p class="mono">{status}</p>
    <p class="mono">Reference: CPU (wasm). GPU rows: "webgpu" = onnxruntime's current WebGPU EP (1.30 raw / 1.31 in transformers.js), "jsep" = onnxruntime 1.22's JSEP backend. Registry choice marked ★.</p>
  </section>

  {#each ROWS as r (r.key)}
    {@const spec = MODELS[r.key]}
    {@const ref = results[id(r.key, configs(r)[0])]}
    <section class="card pad">
      <div class="row">
        <h2>{spec.name} <span class="mono">{r.key}</span></h2>
        <button type="button" class="btn sm" disabled={!input} onclick={() => runRow(r)}>Run all</button>
      </div>
      <table>
        <thead><tr><th>device</th><th>variant (size)</th><th>backend</th><th>load</th><th>run</th><th>Δ vs CPU</th><th>cos</th><th>result</th><th></th></tr></thead>
        <tbody>
          {#each configs(r) as c, i (id(r.key, c))}
            {@const res = results[id(r.key, c)]}
            {@const v = i ? verdict(ref, res) : null}
            {@const chosen = i > 0 && c.variant === spec.prefer.webgpu[0] && (c.gpu === 'jsep') === ('gpu' in spec && spec.gpu === 'jsep')}
            <tr>
              <td>{c.device === 'wasm' ? 'CPU' : 'GPU'}{i ? '' : ' (ref)'}</td>
              <td>{c.variant} ({size(r, c.variant!)})</td>
              <td>{c.gpu ?? '—'}{c.patch !== undefined ? ` · patch ${c.patch ? 'on' : 'off'}` : ''}{chosen && c.patch === undefined ? ' ★' : ''}</td>
              <td>{res && !res.error ? ms(res.loadMs) : ''}</td>
              <td>{res && !res.error ? ms(res.runMs) : ''}</td>
              <td>{v ? `${(v.relL1 * 100).toFixed(2)}% · max ${v.maxAbs.toPrecision(2)}` : ''}</td>
              <td>{v ? v.cos.toFixed(4) : ''}</td>
              <td class="out">
                {#if busy[id(r.key, c)]}running…
                {:else if res?.error}<span class="text-bad">error: {res.error}</span>
                {:else if res}
                  {#if res.device !== c.device}<span class="text-bad">fell back to {res.device} · </span>{/if}
                  {#if v}<span class={v.pass ? 'text-ok' : 'text-bad'}>{v.pass ? 'PASS' : `FAIL ${v.why}`}</span>{/if}
                  {#if res.text !== undefined}<span class="mono">“{res.text}”</span>{/if}
                {/if}
              </td>
              <td><button type="button" class="btn sm" disabled={!input || busy[id(r.key, c)]} onclick={() => run(r.key, c, r.warm)}>Run</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/each}
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
    gap: 10px;
    overflow-x: auto;
  }
  h2 {
    font-size: 24px;
    line-height: 1.1;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .sm {
    padding: 5px 10px;
    font-size: 13px;
  }
  table {
    border-collapse: collapse;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  th,
  td {
    text-align: left;
    padding: 4px 10px 4px 0;
    vertical-align: top;
    white-space: nowrap;
  }
  .out {
    white-space: normal;
    min-width: 260px;
  }
</style>
