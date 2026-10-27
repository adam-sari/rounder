<!--
  Picks and gates the engine for a writing tool. Chrome's built-in AI (Gemini Nano) when the browser
  has it, since nothing then downloads from us; otherwise the local model through ModelGate
  (Qwen3.5 0.8B on WebGPU, in a worker). The visitor can switch, and the choice is remembered.

  <LlmGate apis={['summarizer', 'prompt']}>{#snippet children(llm)}…run controls…{/snippet}</LlmGate>
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { detectDevice } from '@/engines/ai/device';
  import { MODELS } from '@/engines/ai/models';
  import { modelWorker, proxy } from '@/engines/ai/worker-utils';
  import { availability, bestOf, builtinLlm, downloadBuiltin, type Availability, type BuiltinApi } from './chrome-ai';
  import { llmErrorMessage, localLlm } from './engine';
  import type { Llm } from './engine';
  import type { LocalWorker } from './local.worker';

  interface Props {
    /** Chrome built-in APIs that can do this tool's job, best first */
    apis: BuiltinApi[];
    children: Snippet<[Llm]>;
  }
  let { apis, children: tool }: Props = $props();

  const KEY = 'qwen3.5-0.8b';
  const PREF = 'rounder-llm-engine';
  const uid = $props.id();

  const worker = modelWorker<LocalWorker>(() => new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' }));
  /** what ModelGate loaded, to load the same again if the worker crashes */
  let loadedAs: Partial<Pick<GateLoadContext, 'variant' | 'device'>> = {};
  const local = localLlm(worker, MODELS[KEY].name, () => worker.call((api) => api.load(loadedAs, proxy(() => {}))));

  type Phase = 'checking' | 'offer' | 'downloading' | 'builtin' | 'local' | 'none';
  let phase = $state<Phase>('checking');
  let statuses = $state<Partial<Record<BuiltinApi, Availability>>>({});
  let webgpu = $state(false);
  let fraction = $state(0);
  let error = $state('');
  let controller: AbortController | null = null;

  const best = $derived(bestOf(Object.values(statuses)));
  const builtin = $derived(builtinLlm(apis.filter((a) => statuses[a] === 'available')));

  function remember(engine: 'builtin' | 'local') {
    try {
      localStorage.setItem(PREF, engine);
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  }
  function prefersLocal() {
    try {
      return localStorage.getItem(PREF) === 'local';
    } catch {
      return false;
    }
  }

  async function check() {
    statuses = Object.fromEntries(await Promise.all(apis.map(async (a) => [a, await availability(a)] as const)));
  }

  /** the built-in AI when Chrome has it (or can fetch it), unless the visitor picked the local model */
  function pick(): Phase {
    if (best === 'available' && !prefersLocal()) return 'builtin';
    if (best !== 'unavailable' && (!prefersLocal() || !webgpu)) return 'offer';
    return webgpu ? 'local' : 'none';
  }

  onMount(() => {
    let gone = false;
    (async () => {
      const [, info] = await Promise.all([check(), detectDevice()]);
      if (gone) return;
      webgpu = info.webgpu;
      phase = pick();
    })();
    return () => {
      gone = true;
      controller?.abort();
      worker.terminate();
    };
  });

  async function useBuiltin() {
    error = '';
    fraction = 0;
    phase = 'downloading';
    const ctl = (controller = new AbortController());
    // the APIs share one model, so fetching it for one is enough
    const api = apis.find((a) => statuses[a] === 'downloadable' || statuses[a] === 'downloading') ?? apis[0];
    try {
      await downloadBuiltin(api, (f) => (fraction = f), ctl.signal);
      await check();
      statuses[api] = 'available';
      remember('builtin');
      phase = 'builtin';
    } catch (err) {
      if (ctl !== controller) return;
      if (!ctl.signal.aborted) error = llmErrorMessage(err);
      phase = 'offer';
    }
  }

  function cancel() {
    controller?.abort();
    controller = null;
    phase = 'offer';
  }

  function useLocal() {
    remember('local');
    phase = webgpu ? 'local' : 'none';
  }

  function useChrome() {
    remember('builtin');
    phase = best === 'available' ? 'builtin' : 'offer';
  }

  const loadLocal = ({ variant, device, onProgress, signal }: GateLoadContext) => {
    loadedAs = { variant, device };
    return worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal);
  };
</script>

{#if phase === 'builtin'}
  <div class="chip">
    <p class="mono" role="status"><span class="dot" aria-hidden="true"></span>{builtin.name} · runs on this device · nothing leaves it</p>
    {#if webgpu}<button type="button" class="switch" onclick={useLocal}>use {MODELS[KEY].name} instead</button>{/if}
  </div>
  {@render tool(builtin)}
{:else if phase === 'local'}
  <ModelGate model={KEY} light={null} load={loadLocal}>
    {#snippet children()}{@render tool(local)}{/snippet}
  </ModelGate>
  {#if best !== 'unavailable'}<button type="button" class="switch mt-3" onclick={useChrome}>use Chrome's built-in AI instead</button>{/if}
{:else}
  <section class="gate card" aria-labelledby={`${uid}-title`} aria-busy={phase === 'checking' || phase === 'downloading'}>
    <span class="pill"><span class="dot" aria-hidden="true"></span>AI model · runs on your device</span>
    {#if phase === 'checking'}
      <h3 id={`${uid}-title`} class="title">Checking your browser…</h3>
      <p class="mono">looking for Chrome's built-in AI and WebGPU</p>
    {:else if phase === 'none'}
      <h3 id={`${uid}-title`} class="title">No AI model can run in this browser</h3>
      <p class="text-soft">
        This tool runs a language model on your own device, which needs one of two things: Chrome's built-in AI (a recent Chrome on a computer) or WebGPU, which lets a web page use the graphics card for our downloadable model. This browser has neither. Open this page in the latest Chrome or Edge on a computer.
      </p>
    {:else}
      <h3 id={`${uid}-title`} class="title">Chrome's built-in AI</h3>
      <p class="text-soft">
        Your browser comes with an AI model, Gemini Nano. Chrome downloads it once and shares it between the sites that use it; after that it works offline. What you type stays on this device.
      </p>
      <dl class="facts">
        <div>
          <dt class="label">download</dt>
          <dd>a few GB, once, by Chrome<span class="sub">{best === 'downloading' ? 'Chrome is already fetching it' : 'needs about 22 GB free space'}</span></dd>
        </div>
        <div>
          <dt class="label">runs on</dt>
          <dd>your device<span class="sub">graphics card or processor, Chrome decides</span></dd>
        </div>
        <div>
          <dt class="label">made by</dt>
          <dd>Google<span class="sub">part of Chrome, under Chrome's terms</span></dd>
        </div>
      </dl>
      {#if phase === 'downloading'}
        <div class="grid gap-2" aria-live="polite">
          <div class="bar" role="progressbar" aria-label="Chrome model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} class:init={fraction >= 1}>
            <span style={`width: ${fraction >= 1 ? 100 : Math.round(fraction * 100)}%`}></span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="mono">{fraction >= 1 ? 'setting up…' : fraction > 0 ? `Chrome is downloading · ${Math.round(fraction * 100)}%` : 'asking Chrome…'}</p>
            <button type="button" class="btn py-2! text-sm!" onclick={cancel}>Cancel</button>
          </div>
        </div>
      {:else}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-ai" onclick={useBuiltin}>Download Chrome's model & start</button>
          {#if webgpu}<button type="button" class="btn" onclick={useLocal}>Use {MODELS[KEY].name} instead (about 490 MB)</button>{/if}
        </div>
      {/if}
      <p class="fine">It's AI, so check what it gives you. Your text never leaves your device.</p>
    {/if}
  </section>
{/if}

<style>
  .gate {
    display: grid;
    gap: 16px;
    padding: clamp(18px, 3vw, 28px);
    border-color: color-mix(in srgb, var(--color-ai) 35%, var(--color-line-2));
    background:
      radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, var(--color-ai) 9%, transparent), transparent 60%),
      var(--color-panel);
  }
  .pill {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 400 12px var(--font-mono);
    color: var(--color-ai);
    padding: 5px 10px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--color-ai) 12%, transparent);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 8px;
    border-radius: 99px;
    background: var(--color-ai);
    box-shadow: 0 0 10px var(--color-ai);
    flex: none;
  }
  .pill .dot {
    margin-right: 0;
  }
  .title {
    font-size: clamp(28px, 4vw, 36px);
    line-height: 1.05;
  }
  .facts {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    padding-block: 14px;
    border-block: 1px solid var(--color-line);
    & dd {
      display: grid;
      gap: 2px;
      font-size: 15px;
    }
  }
  .sub {
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
  }
  .fine {
    font-size: 13px;
    color: var(--color-muted);
  }
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .bar {
    position: relative;
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: linear-gradient(90deg, color-mix(in srgb, var(--color-ai) 70%, transparent), var(--color-ai));
      transition: width 0.25s ease-out;
    }
    &.init span {
      background: repeating-linear-gradient(-45deg, var(--color-ai) 0 10px, color-mix(in srgb, var(--color-ai) 65%, transparent) 10px 20px);
      background-size: 28px 28px;
      animation: stripes 0.9s linear infinite;
    }
  }
  @keyframes stripes {
    to {
      background-position: 28px 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
    .bar.init span {
      animation: none;
    }
  }
  .chip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 14px;
    margin-bottom: 14px;
  }
  .switch {
    font: 400 12.5px var(--font-mono);
    color: var(--color-ai);
    text-decoration: underline dotted;
    text-underline-offset: 4px;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
</style>
