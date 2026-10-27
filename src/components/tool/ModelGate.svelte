<!--
  Consent + download gate for AI tools. Shows what model will download, how big it is, where it
  runs and its license; downloads on click with progress and Cancel; then renders the tool.
  Returning visitors (consent remembered, or model cached) skip straight to loading.

  <ModelGate model="modnet" load={({ variant, device, onProgress, signal }) => worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal)}>
    {#snippet children({ device })}…the tool UI…{/snippet}
  </ModelGate>
-->
<script lang="ts" module>
  import type { Device, ModelKey, ModelSpec } from '@/engines/ai/models';
  import type { OnProgress } from '@/engines/ai/progress';

  export interface GateModel {
    key: ModelKey;
    spec: ModelSpec;
    variant: string;
    device: Device;
  }
  export interface GateContext extends GateModel {
    /** every model, when the gate holds several (the first is spread above) */
    models: GateModel[];
  }
  export interface GateLoadContext extends GateContext {
    onProgress: OnProgress;
    signal: AbortSignal;
  }
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { deviceLabel, detectDevice, type DeviceInfo } from '@/engines/ai/device';
  import { toAiError, type AiError } from '@/engines/ai/errors';
  import { lightModel, MODELS, pickVariant, totalDownloadSize } from '@/engines/ai/models';
  import { formatMB, formatProgress, type LoadProgress } from '@/engines/ai/progress';
  import { engineBytes, engineCached, engineFor } from '@/engines/ai/runtime';
  import { hasConsent, isModelCached, rememberConsent, requestPersist, storageEstimate } from '@/engines/ai/storage';

  interface Props {
    /** registry key(s) of the model(s) the tool needs */
    model: ModelKey | ModelKey[];
    /** lighter alternative to offer; defaults to the registry's, null for none */
    light?: ModelKey | null;
    /** force a registry variant (dtype) instead of the best for the device */
    variant?: string;
    /** loads the model(s), usually by calling the tool's worker; return the device it ended up on after any fallback */
    load: (ctx: GateLoadContext) => Promise<void | { device?: Device }>;
    /** true once loaded */
    ready?: boolean;
    /** load at once when the visitor agreed before or the model is cached */
    autostart?: boolean;
    /** the one-line model status above the tool */
    chip?: boolean;
    children: Snippet<[GateContext]>;
  }

  let { model, light, variant, load, ready = $bindable(false), autostart = true, chip = true, children }: Props = $props();

  const uid = $props.id();
  type Status = 'checking' | 'idle' | 'loading' | 'ready' | 'error';
  let status = $state<Status>('checking');
  let info = $state<DeviceInfo | null>(null);
  let useLight = $state(false);
  let cached = $state(false);
  let engineMissing = $state(0);
  let freeBytes = $state<number | null>(null);
  let progress = $state<LoadProgress | null>(null);
  let error = $state<AiError | null>(null);
  let ranOn = $state<Device | null>(null);
  let controller: AbortController | null = null;

  const primary = $derived<ModelKey[]>(Array.isArray(model) ? model : [model]);
  const lightKey = $derived(light === null ? undefined : (light ?? lightModel(primary[0])));
  const keys = $derived<ModelKey[]>(useLight && lightKey ? [lightKey] : primary);
  const choices = $derived(
    info
      ? keys.map((key) => {
          const spec: ModelSpec = MODELS[key];
          const choice = variant && key === primary[0] && !useLight ? { variant, device: pickVariant(spec, info!)?.device ?? 'wasm' } : pickVariant(spec, info!);
          return choice && { key, spec, ...choice };
        })
      : [],
  );
  const models = $derived(choices.every(Boolean) ? (choices as GateModel[]) : null);
  const first = $derived(models?.[0]);
  const total = $derived(models?.reduce((sum, m) => sum + totalDownloadSize(m.spec, m.variant), 0) ?? 0);
  /** download size of the best variant of each model for this device; -1 when one can't run here */
  function sizeHere(list: ModelKey[]) {
    let sum = 0;
    for (const k of list) {
      const c = info && pickVariant(k, info);
      if (!c) return -1;
      sum += totalDownloadSize(k, c.variant);
    }
    return sum;
  }
  const fullTotal = $derived(sizeHere(primary));
  const lightTotal = $derived(lightKey ? sizeHere([lightKey]) : -1);
  const fullUnavailable = $derived(fullTotal < 0);
  /** why the full model isn't the one on offer */
  const why = $derived.by(() => {
    if (!info || !useLight) return '';
    if (fullUnavailable) return `${MODELS[primary[0]].name} needs WebGPU. ${info.reason ?? ''}`.trim();
    return info.isMobile ? 'On phones we start with the lighter model, which downloads faster and fits in memory.' : '';
  });
  const runtime = $derived(first ? engineFor(first.spec, first.device) : null);
  /** where the weights download from, in words */
  const host = $derived.by(() => {
    const base = first?.spec.baseUrl;
    if (!base) return 'Hugging Face';
    if (base.startsWith('/')) return 'this site';
    return base.includes('googleapis.com') ? "Google's servers" : new URL(base).hostname;
  });
  const pct = $derived(progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0);
  const initPhase = $derived(progress?.phase === 'init' || pct >= 100);

  async function refresh() {
    if (!models || !info) return;
    const [isCached, engine] = await Promise.all([
      Promise.all(models.map((m) => isModelCached(m.key, m.variant))).then((all) => all.every(Boolean)),
      runtime ? engineCached(runtime, info.webgpu).then((hit) => (hit ? 0 : engineBytes(runtime, info!.webgpu))) : 0,
    ]);
    cached = isCached;
    engineMissing = engine;
  }

  onMount(() => {
    let gone = false;
    (async () => {
      info = await detectDevice();
      // phones, and browsers that can't run the full model, start with the light one
      useLight = lightTotal > 0 && (fullUnavailable || info.isMobile);
      await refresh();
      freeBytes = (await storageEstimate())?.available ?? null;
      if (gone) return;
      if (autostart && models && (cached || keys.every(hasConsent))) start(false);
      else status = 'idle';
    })();
    return () => {
      gone = true;
      controller?.abort();
    };
  });

  async function start(fromClick = true) {
    if (!models || !first) return;
    controller?.abort();
    const ctl = (controller = new AbortController());
    const agreed = keys;
    // ask the browser to keep big downloads (Firefox may prompt, so only from a click)
    if (fromClick && !cached && total > 100e6) requestPersist();
    status = 'loading';
    error = null;
    progress = null;
    try {
      const onProgress = (p: LoadProgress) => {
        if (ctl === controller) progress = p;
      };
      const result = await load({ ...first, models, onProgress, signal: ctl.signal });
      if (ctl !== controller) return;
      // remembered only once it worked: a cancelled download shouldn't restart by itself next visit
      agreed.forEach(rememberConsent);
      ranOn = result?.device ?? first.device;
      status = 'ready';
      ready = true;
      cached = true;
    } catch (err) {
      if (ctl !== controller) return;
      const e = toAiError(err);
      if (e.code === 'aborted') {
        status = 'idle';
        await refresh();
      } else {
        error = e;
        status = 'error';
      }
    }
  }

  function cancel() {
    controller?.abort();
    controller = null;
    status = 'idle';
    progress = null;
    refresh();
  }

  async function switchModel(toLight: boolean) {
    useLight = toLight;
    error = null;
    if (status === 'error') status = 'idle';
    await refresh();
  }
</script>

{#if status === 'ready' && first}
  {#if chip}
    <p class="chip mono" role="status">
      <span class="dot" aria-hidden="true"></span>
      {first.spec.name}{models && models.length > 1 ? ` + ${models.length - 1} more` : ''} · running on {deviceLabel(ranOn ?? first.device)} · nothing leaves this device
    </p>
  {/if}
  {@render children({ ...first, device: ranOn ?? first.device, models: models! })}
{:else}
  <section class="gate card" aria-labelledby={`${uid}-title`} aria-busy={status === 'checking' || status === 'loading'}>
    <div class="flex flex-wrap items-center gap-2">
      <span class="pill"><span class="dot" aria-hidden="true"></span>AI model · runs on your device</span>
      {#if cached && status !== 'checking'}<span class="pill cached">✓ already downloaded</span>{/if}
    </div>

    {#if status === 'checking' || !info}
      <h3 id={`${uid}-title`} class="title">Checking your device…</h3>
      <p class="mono">looking for WebGPU and the model cache</p>
    {:else if !models || !first}
      <h3 id={`${uid}-title`} class="title">{MODELS[primary[0]].name} can't run in this browser</h3>
      <p class="text-soft">
        It needs WebGPU, a way for web pages to use the graphics card. {info.reason ?? ''} Try the latest Chrome or Edge on a computer.
      </p>
    {:else}
      <h3 id={`${uid}-title`} class="title">{first.spec.name}{models.length > 1 ? ` + ${models.length - 1} more` : ''}</h3>
      <p class="text-soft">{first.spec.summary}</p>

      <dl class="facts">
        <div>
          <dt class="label">download</dt>
          <dd>
            {#if cached}already on this device{:else}{formatMB(total)}, once{/if}
            {#if engineMissing}<span class="sub">+ {formatMB(engineMissing)} AI engine, shared by all AI tools</span>{/if}
          </dd>
        </div>
        <div>
          <dt class="label">runs on</dt>
          <dd>
            {deviceLabel(first.device)}
            {#if first.spec.speed[first.device]}<span class="sub">typically {first.spec.speed[first.device]}</span>{/if}
          </dd>
        </div>
        <div>
          <dt class="label">license</dt>
          <dd>
            {#each models as m, i}
              {i ? ', ' : ''}<a href={m.spec.license.url} target="_blank" rel="noopener noreferrer" class="link">{m.spec.license.name}<span class="sr-only"> license for {m.spec.name} (opens in a new tab)</span></a>
            {/each}
            <span class="sub">{first.spec.credit}</span>
          </dd>
        </div>
      </dl>

      {#if first.device === 'wasm' && first.spec.prefer.webgpu.length && !info.webgpu}
        <p class="note">No WebGPU here, so it runs on the processor: it works, just slower than on a graphics card.</p>
      {/if}
      {#if why}<p class="note">{why}</p>{/if}
      {#if info.isMobile && first.spec.desktopOnly}
        <p class="note">This model is made for computers. On a phone it may run out of memory.</p>
      {/if}
      {#if !cached && freeBytes !== null && freeBytes < total * 1.1}
        <p class="note warn">Your browser has about {formatMB(freeBytes)} of space left for this site, which may not be enough.</p>
      {/if}

      {#if status === 'loading'}
        <div class="grid gap-2" aria-live="polite">
          <div class="bar" role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={initPhase ? 100 : pct} class:init={initPhase}>
            <span style={`width: ${initPhase ? 100 : pct}%`}></span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="mono">
              {#if initPhase}setting up on {deviceLabel(first.device)}…
              {:else if progress}{cached ? 'loading from this device' : 'downloading'} · {formatProgress(progress)} · {pct}%
              {:else}starting…{/if}
            </p>
            <button type="button" class="btn py-2! text-sm!" onclick={cancel}>Cancel</button>
          </div>
        </div>
      {:else}
        {#if status === 'error' && error}
          <p class="text-sm text-bad" role="alert">{error.message}</p>
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-ai" onclick={() => start()}>
            {status === 'error' ? 'Try again' : cached ? 'Start' : 'Download model & start'}
          </button>
          {#if !useLight && lightKey && lightTotal > 0}
            <button type="button" class="btn" onclick={() => switchModel(true)}>Use the lighter model ({formatMB(lightTotal)})</button>
          {:else if useLight && !fullUnavailable}
            <button type="button" class="btn" onclick={() => switchModel(false)}>Use the full model ({formatMB(fullTotal)})</button>
          {/if}
        </div>
      {/if}

      <p class="fine">
        It's AI, so check what it gives you. The model comes from {host} the first time and then stays in your browser; your files never leave your device.
      </p>
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 400 12px var(--font-mono);
    color: var(--color-ai);
    padding: 5px 10px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--color-ai) 12%, transparent);
    &.cached {
      color: var(--color-ok);
      background: color-mix(in srgb, var(--color-ok) 12%, transparent);
    }
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--color-ai);
    box-shadow: 0 0 10px var(--color-ai);
    flex: none;
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
    & .label {
      margin-bottom: 2px;
    }
  }
  .sub {
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
  }
  .link {
    color: var(--color-ai);
    text-decoration: underline dotted;
    text-underline-offset: 4px;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
    &.warn {
      border-color: var(--color-sun);
    }
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
  .chip {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
</style>
