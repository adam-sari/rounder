<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import DeviceNote from '@/components/tool/DeviceNote.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { deviceLabel, detectDevice, type DeviceInfo } from '@/engines/ai/device';
  import { toAiError } from '@/engines/ai/errors';
  import { MODELS, pickVariant, totalDownloadSize, type Device, type ModelKey } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { decodeImage, encodeImage, formatInfo, imageKind, outputFormatFor, resizeImage, type OutputFormat } from '@/engines/image/client';
  import { checkDevice, deviceMessage } from '@/tools/lib/device-guard';
  import { downloadResult, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import ZoomCompare from '@/tools/lib/image-upscaler/ZoomCompare.svelte';
  import { blendTile, copyAlpha, crop, estimateSeconds, fitWithin, formatDuration, hasTransparency, maxInputSide, planTiles, tiling, type Scale } from '@/tools/lib/image-upscaler/tiles';
  import type { UpscalerWorker } from '@/tools/lib/image-upscaler/upscaler.worker';

  const MODEL: Record<Scale, ModelKey> = { 2: 'swin2sr-x2-light', 4: 'swin2sr-x4-realworld' };
  const SCALES: [Scale, string, string][] = [
    [2, '2× · quick', 'A small, fast model. Best for clean images: screenshots, art, renders.'],
    [4, '4× · photos', 'A larger model trained on real photos. It also cleans up blur, noise and JPEG blocks.'],
  ];
  const FORMATS: OutputFormat[] = ['jpeg', 'png', 'webp'];

  const worker = modelWorker<UpscalerWorker>(() => new Worker(new URL('../lib/image-upscaler/upscaler.worker.ts', import.meta.url), { type: 'module' }));

  let info = $state<DeviceInfo | null>(null);
  let scale = $state<Scale>(4);
  /** the model the gate loaded and where it really runs */
  let choice = $state<{ key: ModelKey; variant: string; device: Device } | null>(null);
  /** which model the worker holds right now (cancelling terminates it) */
  let loadedFor: ModelKey | null = null;

  let file = $state<File | null>(null);
  let format = $state<OutputFormat>('jpeg');
  let quality = $state(92);
  let original = $state.raw<ImageData | null>(null);
  /** what gets upscaled: the original, or a copy shrunk to the size limit */
  let input = $state.raw<ImageData | null>(null);
  let beforeImg = $state.raw<ImageBitmap | null>(null);
  let opening = 0;
  let loading = $state(false);

  let phase = $state<'idle' | 'preparing' | 'running' | 'done'>('idle');
  let done = $state(0);
  let total = $state(0);
  let left = $state<number | null>(null);
  let output = $state.raw<HTMLCanvasElement | null>(null);
  let result = $state.raw<ImageData | null>(null);
  let version = $state(0);
  let controller: AbortController | null = null;

  let saving = $state(false);
  let saved = $state('');
  let error = $state('');

  const mobile = $derived(info?.isMobile ?? false);
  const limit = $derived(maxInputSide(scale, mobile));
  const tooBig = $derived(!!original && Math.max(original.width, original.height) > limit);
  const busy = $derived(phase === 'preparing' || phase === 'running');
  // low-end devices: the stitched result is the big part, so warn about (or stop) an output this device can't hold
  const deviceFit = $derived(input ? checkDevice('upscale', { width: input.width * scale, height: input.height * scale, tip: `Try ${scale === 4 ? '2× instead of 4×, or ' : ''}a smaller or cropped image.` }) : null);
  const tiles = $derived.by(() => {
    if (!input || !choice) return [];
    const { tile, overlap } = tiling(choice.device, scale, info?.maxBufferSize ?? 0);
    return planTiles(input.width, input.height, tile, overlap);
  });
  const estimate = $derived(choice ? estimateSeconds(tiles, choice.device, scale, mobile) : 0);
  const pct = $derived(total ? Math.round((done / total) * 100) : 0);

  /** download size of a scale's model on this device, for the picker */
  function sizeOf(s: Scale) {
    const c = info && pickVariant(MODEL[s], info);
    return c ? formatMB(totalDownloadSize(MODEL[s], c.variant)) : '';
  }

  onMount(() => {
    detectDevice().then((d) => {
      info = d;
      // on phones and without a graphics card, 4× takes many minutes, so start at 2×
      if (d.isMobile || !d.webgpu) scale = 2;
    });
    return () => {
      controller?.abort();
      worker.terminate();
      beforeImg?.close();
    };
  });

  async function load({ key, variant, device, onProgress, signal }: GateLoadContext) {
    const r = await worker.call((api) => api.load(key, { variant, device }, gpuTile(), proxy(onProgress)), signal);
    choice = { key, variant: r.variant, device: r.device };
    loadedFor = key;
    return { device: r.device };
  }

  /** the tile size on the graphics card, for the worker's warm-up run */
  const gpuTile = () => tiling('webgpu', scale, info?.maxBufferSize ?? 0).tile;

  async function useInput(img: ImageData | null) {
    input = img;
    const bitmap = img && (await createImageBitmap(img));
    // a newer image may have been picked while this one was converted
    if (input !== img) return bitmap?.close();
    const old = beforeImg;
    beforeImg = bitmap;
    old?.close();
  }

  function clearResult() {
    result = output = null;
    phase = 'idle';
    saved = error = '';
  }

  function setScale(s: Scale) {
    if (busy || s === scale) return;
    scale = s;
    clearResult();
    if (original) useInput(Math.max(original.width, original.height) <= maxInputSide(s, mobile) ? original : null);
  }

  async function open(files: File[]) {
    const f = files[0];
    const ticket = ++opening;
    loading = true;
    error = '';
    try {
      const [data, kind] = await Promise.all([decodeImage(f), imageKind(f)]);
      if (ticket !== opening) return;
      clearResult();
      file = f;
      original = data;
      const fmt = outputFormatFor(kind);
      format = hasTransparency(data) ? 'png' : FORMATS.includes(fmt) ? fmt : 'webp';
      await useInput(Math.max(data.width, data.height) <= limit ? data : null);
    } catch (err) {
      if (ticket === opening) error = deviceMessage('image-ai', err) ?? "Couldn't read that image. Try a JPG, PNG, WebP, AVIF or HEIC file.";
    } finally {
      if (ticket === opening) loading = false;
    }
  }

  async function shrink() {
    const src = original;
    if (!src) return;
    loading = true;
    error = '';
    try {
      const small = await resizeImage(src, { ...fitWithin(src.width, src.height, limit), method: 'lanczos3' });
      if (src === original) await useInput(small);
    } catch {
      if (src === original) error = "Couldn't shrink the image. Try cropping it first.";
    } finally {
      loading = false;
    }
  }

  function reset() {
    controller?.abort();
    opening++;
    loading = false;
    file = original = null;
    useInput(null);
    clearResult();
  }

  async function run() {
    const src = input;
    const c = choice;
    if (!src || !c) return;
    const s = scale;
    const ctl = (controller = new AbortController());
    const { tile, overlap } = tiling(c.device, s, info?.maxBufferSize ?? 0);
    const plan = planTiles(src.width, src.height, tile, overlap);
    clearResult();
    phase = 'preparing';
    done = 0;
    total = plan.length;
    left = null;
    try {
      const W = src.width * s;
      const H = src.height * s;
      const out = new ImageData(W, H);
      const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = canvas.getContext('2d')!;
      // after a cancel the worker was stopped; the model comes back from the browser cache
      if (loadedFor !== c.key) {
        await worker.call((api) => api.load(c.key, { variant: c.variant, device: c.device }, gpuTile(), proxy(() => {})), ctl.signal);
        loadedFor = c.key;
      }
      output = canvas;
      phase = 'running';
      const start = performance.now();
      let first = 0;
      for (const t of plan) {
        const piece = crop(src, t.x, t.y, t.w, t.h);
        const up = await worker.call((api) => api.upscale(transfer(piece, [piece.data.buffer]), s), ctl.signal);
        blendTile(out, up, t.x * s, t.y * s, t.left * s, t.top * s);
        ctx.putImageData(out, 0, 0, t.x * s, t.y * s, up.width, up.height);
        version++;
        done++;
        // the first tile includes warm-up (shader compilation on the GPU), so it's left out of the pace once there are others
        const elapsed = performance.now() - start;
        if (done === 1) first = elapsed;
        const pace = done > 1 ? (elapsed - first) / (done - 1) : first;
        left = (pace * (total - done)) / 1000;
      }
      if (hasTransparency(src)) {
        // the model only sees color; transparency is enlarged the ordinary way
        copyAlpha(out, await resizeImage(src, { width: W, height: H, method: 'mitchell' }));
        ctx.putImageData(out, 0, 0);
        version++;
      }
      // a cancel during the transparency resize above can't stop it, so check before showing the result
      ctl.signal.throwIfAborted();
      result = out;
      phase = 'done';
    } catch (err) {
      loadedFor = null;
      if (ctl !== controller) return;
      const e = toAiError(err);
      output = null;
      phase = 'idle';
      if (e.code === 'out-of-memory') error = `Your device ran out of memory. Try ${s === 4 ? '2×, or ' : ''}a smaller image.`;
      else if (e.code !== 'aborted') error = e.message;
    } finally {
      if (ctl === controller) controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  async function save() {
    const img = result;
    if (!img || !file) return;
    saving = true;
    saved = error = '';
    try {
      const blob = await encodeImage(img, { format, quality, background: '#ffffff' });
      if (img !== result) return;
      const name = withSuffix(withExtension(file.name, formatInfo[format].ext), `-upscaled-${scale}x`);
      downloadResult(blob, name);
      saved = `${name} · ${formatBytes(blob.size)}`;
    } catch {
      error = "Couldn't save the image. Try JPG or WebP, which need less memory than PNG.";
    } finally {
      saving = false;
    }
  }

  const px = (w: number, h: number) => `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')}`;
  const mp = (w: number, h: number) => `${((w * h) / 1e6).toFixed(1)} MP`;
</script>

<div class="grid gap-5">
  <div class="grid gap-2">
    <span class="label">upscale by</span>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="seg" role="group" aria-label="Upscale by">
        {#each SCALES as [s, label]}
          <button type="button" aria-pressed={scale === s} disabled={busy} onclick={() => setScale(s)}>{label}</button>
        {/each}
      </div>
      <p class="text-sm text-soft">
        {SCALES.find(([s]) => s === scale)?.[2]}
        {#if sizeOf(scale)}<span class="mono"> · {sizeOf(scale)} model</span>{/if}
      </p>
    </div>
  </div>

  {#if info}
    {#key scale}
      <ModelGate model={MODEL[scale]} light={null} {load}>
        {#snippet children()}
          {@render tool()}
        {/snippet}
      </ModelGate>
    {/key}
  {:else}
    <p class="mono" aria-live="polite">checking your device…</p>
  {/if}
</div>

{#snippet tool()}
  {#if !original || !file}
    <Dropzone accept="image/*,.heic,.heif,.avif" title={loading ? 'Opening…' : 'Drop an image to upscale'} hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={open} />
    {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
  {:else if !input}
    <div class="card grid gap-3 p-5">
      <h3 class="text-2xl">This image is too big for {scale}×</h3>
      <p class="text-soft">
        It's {px(original.width, original.height)} px. {scale}× would make it {px(original.width * scale, original.height * scale)} ({mp(original.width * scale, original.height * scale)}),
        and {mobile ? 'a phone browser' : 'a browser'} runs out of memory for a picture that size. We upscale images up to {limit.toLocaleString('en-US')} px on the long side.
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" disabled={loading} onclick={shrink}>{loading ? 'Shrinking…' : `Shrink to ${limit.toLocaleString('en-US')} px, then upscale`}</button>
        {#if scale === 4 && Math.max(original.width, original.height) <= maxInputSide(2, mobile)}
          <button type="button" class="btn" onclick={() => setScale(2)}>Use 2× instead</button>
        {/if}
        <button type="button" class="btn" onclick={reset}>Use another image</button>
      </div>
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      <p class="mono">tip: crop to the part you need first, and it can stay full size</p>
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div class="min-w-0">
        {#if beforeImg}
          <ZoomCompare before={beforeImg} after={output} width={input.width * scale} height={input.height * scale} {version} live={phase === 'running'} afterLabel={`AI ${scale}×`} />
        {/if}
      </div>

      <div class="grid content-start gap-5">
        <dl class="grid gap-3 text-sm">
          <div>
            <dt class="label">size</dt>
            <dd>{px(input.width, input.height)} → <strong class="text-chalk">{px(input.width * scale, input.height * scale)}</strong> px</dd>
            {#if input !== original}<dd class="mono">shrunk from {px(original.width, original.height)}</dd>{/if}
          </div>
          {#if choice && phase === 'idle'}
            <div>
              <dt class="label">time</dt>
              <dd>{tiles.length} tile{tiles.length === 1 ? '' : 's'} · {formatDuration(estimate)} on {deviceLabel(choice.device)}</dd>
              <dd class="mono">a rough estimate; it firms up once tiles finish</dd>
            </div>
          {/if}
        </dl>

        {#if phase === 'idle'}
          {#if choice?.device === 'wasm' && estimate > 180}
            <p class="note">
              That's a long wait on the processor. {scale === 4 ? '2× is about four times quicker. ' : ''}A smaller image helps too, as does Chrome or Edge on a computer with WebGPU. Keep this tab open while it works.
            </p>
          {/if}
          <DeviceNote verdict={deviceFit} />
          <button type="button" class="btn btn-primary" onclick={run} disabled={deviceFit?.level === 'block'}>Upscale {scale}×</button>
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
          <button type="button" class="btn py-2! text-sm!" onclick={reset}>Use another image</button>
        {:else if busy}
          <div class="grid gap-2" aria-live="polite">
            <div class="bar" role="progressbar" aria-label="Upscaling" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={`width: ${pct}%`}></span></div>
            <p class="mono">
              {#if phase === 'preparing'}getting the model ready…
              {:else}tile {Math.min(done + 1, total)} of {total} · {pct}%{left !== null ? ` · ${formatDuration(left)} left` : ''}{/if}
            </p>
          </div>
          <button type="button" class="btn" onclick={cancel}>Cancel</button>
        {:else}
          <p class="mono text-ok!" role="status">done · {px(input.width * scale, input.height * scale)} px</p>
          <div>
            <span class="label">save as</span>
            <div class="seg" role="group" aria-label="Output format">
              {#each FORMATS as f}
                <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{formatInfo[f].label}</button>
              {/each}
            </div>
          </div>
          {#if formatInfo[format].lossy}
            <label>
              <span class="label">quality · {quality}</span>
              <input type="range" min="60" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
            </label>
          {/if}
          <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : `Download ${formatInfo[format].label}`}</button>
          {#if saved}<p class="mono text-ok!" role="status">{saved}</p>{/if}
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
          <p class="mono">AI adds detail it predicts, so check faces, text and fine patterns before you use it.</p>
          <button type="button" class="btn py-2! text-sm!" onclick={reset}>Upscale another image</button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<style>
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid var(--color-sun);
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
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
