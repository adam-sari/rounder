<!--
  Whisper behind the model gate, plus the "standard / accurate" choice on computers with WebGPU.
  Renders the tool once a model is loaded: children({ worker, spec }) — pass both to Transcription.run.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { detectDevice, type DeviceInfo } from '@/engines/ai/device';
  import { MODELS, pickVariant, totalDownloadSize } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { proxy, type ModelWorker } from '@/engines/ai/worker-utils';
  import { whisperWorker, type WhisperKey, type WhisperSpec } from './engine';
  import type { WhisperWorker } from './whisper.worker';

  interface Props {
    /** no switching models while a file is being transcribed */
    locked?: boolean;
    children: Snippet<[{ worker: ModelWorker<WhisperWorker>; spec: WhisperSpec }]>;
  }
  let { locked = false, children: tool }: Props = $props();

  const STORE = 'rounder:whisper-quality';
  const uid = $props.id();
  const worker = whisperWorker();
  let info = $state<DeviceInfo | null>(null);
  let accurate = $state(false);
  // raw: it is posted to the worker, and a reactive proxy can't be cloned
  let spec = $state.raw<WhisperSpec | null>(null);

  const key = $derived<WhisperKey>(accurate ? 'whisper-large-turbo' : 'whisper-base');
  const canAccurate = $derived(!!info?.webgpu && !info.isMobile);
  const size = (k: WhisperKey) => {
    const c = info && pickVariant(k, info);
    return c ? formatMB(totalDownloadSize(k, c.variant)) : '';
  };

  onMount(() => {
    detectDevice().then((d) => {
      info = d;
      try {
        accurate = !!d.webgpu && !d.isMobile && localStorage.getItem(STORE) === 'accurate';
      } catch {
        // storage blocked: start on the standard model
      }
    });
    return () => worker.terminate();
  });

  function choose(next: boolean) {
    accurate = next;
    try {
      localStorage.setItem(STORE, next ? 'accurate' : 'standard');
    } catch {
      // not remembered, that's all
    }
  }

  async function load(ctx: GateLoadContext) {
    const s: WhisperSpec = { key: ctx.key as WhisperKey, variant: ctx.variant, device: ctx.device };
    const r = await worker.call((api) => api.load(s, proxy(ctx.onProgress)), ctx.signal);
    spec = s;
    return { device: r.device };
  }
</script>

{#if !info}
  <div class="card wait mono" aria-busy="true">checking your device…</div>
{:else}
  <div class="grid gap-4">
    {#if canAccurate}
      <div class="quality">
        <span class="label" id={`${uid}-q`}>model</span>
        <div class="seg" role="group" aria-labelledby={`${uid}-q`}>
          <button type="button" aria-pressed={!accurate} disabled={locked} onclick={() => choose(false)}>Standard · {size('whisper-base')}</button>
          <button type="button" aria-pressed={accurate} disabled={locked} onclick={() => choose(true)}>Accurate · {size('whisper-large-turbo')}</button>
        </div>
        <span class="mono">{accurate ? `${MODELS['whisper-large-turbo'].name}: best with accents, noise and names; uses your graphics card` : `${MODELS['whisper-base'].name}: quick, good on clear speech`}</span>
      </div>
    {/if}
    {#key key}
      <ModelGate model={key} light={accurate ? null : undefined} {load}>
        {#snippet children()}
          {#if spec}{@render tool({ worker, spec })}{/if}
        {/snippet}
      </ModelGate>
    {/key}
  </div>
{/if}

<style>
  .wait {
    display: grid;
    place-items: center;
    min-height: 160px;
  }
  .quality {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    & .label {
      margin: 0;
    }
    & .seg button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
</style>
