<script lang="ts">
  import { onMount } from 'svelte';
  import CompareSlider from '@/components/tool/CompareSlider.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { deviceLabel } from '@/engines/ai/device';
  import { toAiError } from '@/engines/ai/errors';
  import { MODELS, type Device, type ModelSpec } from '@/engines/ai/models';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { decodeImage, encodeImage, formatInfo, resizeImage } from '@/engines/image/client';
  import { deviceMessage, guard } from '@/tools/lib/device-guard';
  import { downloadBlob, withExtension, withSuffix, zipFiles } from '@/tools/lib/files';
  import type { ColorizeWorker } from '@/tools/lib/photo-colorizer/colorize.worker';
  import { isOpaque, MODEL_SIZE } from '@/tools/lib/photo-colorizer/lab';

  /** longest side of the on-screen preview; downloads are always full size */
  const PREVIEW_MAX = 1200;
  const SPEED: ModelSpec['speed'] = MODELS['ddcolor-tiny'].speed;

  interface Item {
    id: number;
    file: File;
    status: 'queued' | 'working' | 'done' | 'error';
    /** the original, scaled to preview size */
    preview?: ImageData;
    before?: string;
    /** predicted a/b chroma, 2 × 512 × 512 */
    ab?: Float32Array;
    note?: string;
    error?: string;
  }

  const spawn = () => new Worker(new URL('../lib/photo-colorizer/colorize.worker.ts', import.meta.url), { type: 'module' });
  const worker = modelWorker<ColorizeWorker>(spawn);
  /** a second copy that never loads the model, so previews and downloads don't wait behind a batch */
  const painter = modelWorker<ColorizeWorker>(spawn);
  let opts: { variant?: string; device?: Device } = {};
  /** where the model really runs, once a WebGPU run has fallen back to the processor */
  let ranOn = $state<Device | null>(null);

  let items = $state<Item[]>([]);
  let selectedId = $state<number | null>(null);
  let saturation = $state(100);
  let format = $state<'jpeg' | 'png'>('jpeg');
  let after = $state<{ id: number; url: string } | null>(null);
  let busy = $state(false);
  let saving = $state('');
  let error = $state('');
  let controller = new AbortController();
  let nextId = 0;

  const selected = $derived(items.find((i) => i.id === selectedId));
  const finished = $derived(items.filter((i) => i.status === 'done'));
  const settled = $derived(items.filter((i) => i.status === 'done' || i.status === 'error').length);
  const statusText = { queued: 'waiting', working: 'coloring…', done: 'done', error: 'failed' };

  onMount(() => () => {
    controller.abort();
    worker.terminate();
    painter.terminate();
    for (const i of items) if (i.before) URL.revokeObjectURL(i.before);
    if (after) URL.revokeObjectURL(after.url);
  });

  async function load({ variant, device, onProgress, signal }: GateLoadContext) {
    opts = { variant, device };
    const r = await worker.call((api) => api.load(opts, proxy(onProgress)), signal);
    // a session that fell back to the processor while loading must reopen there after a cancel
    opts.device = r.device;
    return r;
  }

  function problem(err: unknown) {
    const code = toAiError(err).code;
    return code === 'out-of-memory'
      ? 'Your device ran out of memory. Close other tabs or try a smaller photo.'
      : code === 'network'
        ? toAiError(err).message
        : 'The AI hit a problem with this photo. Try again, or try another photo.';
  }

  async function toUrl(img: ImageData) {
    const canvas = new OffscreenCanvas(img.width, img.height);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob(isOpaque(img) ? { type: 'image/jpeg', quality: 0.9 } : { type: 'image/png' });
    return URL.createObjectURL(blob);
  }

  function add(files: File[]) {
    const fresh = files.map((file) => ({ id: nextId++, file, status: 'queued' as const }));
    items.push(...fresh);
    selectedId ??= fresh[0]?.id ?? null;
    pump();
  }

  /** colors the queue one photo at a time, so a batch never fights over memory */
  async function pump() {
    if (busy) return;
    busy = true;
    const { signal } = controller;
    for (let next: Item | undefined; !signal.aborted && (next = items.find((i) => i.status === 'queued')); ) await colorize(next, signal);
    if (signal === controller.signal) busy = false;
  }

  async function colorize(item: Item, signal: AbortSignal) {
    item.status = 'working';
    try {
      const full = await decodeImage(item.file);
      // low-end devices: saving works at full size, so stop here on a photo this device can't hold
      guard('image-ai', { width: full.width, height: full.height });
      const fit = Math.min(1, PREVIEW_MAX / Math.max(full.width, full.height));
      const [preview, small] = await Promise.all([
        fit < 1 ? resizeImage(full, { width: Math.max(1, Math.round(full.width * fit)), height: Math.max(1, Math.round(full.height * fit)) }) : full,
        resizeImage(full, { width: MODEL_SIZE, height: MODEL_SIZE }),
      ]);
      const before = await toUrl(preview);
      // cancelled while decoding: the item is already gone, so nothing would revoke this URL
      if (signal.aborted) return URL.revokeObjectURL(before);
      item.preview = preview;
      item.before = before;
      const { ab, device, ms } = await worker.call((api) => api.predict(small, opts), signal);
      // a WebGPU run that fell back to the processor stays there for the rest of the batch
      opts.device = ranOn = device;
      item.ab = ab;
      item.note = `colored in ${(ms / 1000).toFixed(1)} s on ${deviceLabel(device)}`;
      item.status = 'done';
    } catch (err) {
      if (signal.aborted) return;
      item.status = 'error';
      item.error = deviceMessage('image-ai', err) ?? (item.before ? problem(err) : "Couldn't open this image. Try a JPG, PNG, WebP or HEIC file.");
    }
  }

  // live preview: the predicted color over the preview-size original, redone when the strength changes.
  // One render at a time; while it runs only the latest request waits, so dragging never piles up work.
  type Paint = { id: number; preview: ImageData; ab: Float32Array; strength: number };
  let wanted: Paint | null = null;
  let painting = false;

  async function paint() {
    if (painting) return;
    painting = true;
    try {
      for (let job = wanted; job; job = wanted) {
        wanted = null;
        const { id, preview, ab, strength } = job;
        const out = await painter.call((api) => api.compose(preview, ab, strength));
        const url = await toUrl(new ImageData(out.data, out.width, out.height));
        // the photo was removed (start over / cancel) while it rendered
        if (!items.some((i) => i.id === id)) {
          URL.revokeObjectURL(url);
          continue;
        }
        if (after) URL.revokeObjectURL(after.url);
        after = { id, url };
      }
    } catch (err) {
      error = `Couldn't show the preview: ${problem(err)}`;
    } finally {
      painting = false;
    }
  }

  $effect(() => {
    const item = selected;
    const strength = saturation / 100;
    if (item?.status !== 'done' || !item.preview || !item.ab) return;
    wanted = { id: item.id, preview: item.preview, ab: item.ab, strength };
    paint();
  });

  async function save(list: Item[]) {
    error = '';
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const [n, item] of list.entries()) {
        saving = list.length > 1 ? `Preparing ${n + 1} of ${list.length}…` : 'Saving…';
        const full = await decodeImage(item.file);
        const src = { data: full.data, width: full.width, height: full.height };
        const out = await painter.call((api) => api.compose(transfer(src, [src.data.buffer]), item.ab!, saturation / 100));
        const blob = await encodeImage(new ImageData(out.data, out.width, out.height), { format, quality: 92, background: '#ffffff' });
        files.push({ name: withSuffix(withExtension(item.file.name, formatInfo[format].ext), '-colorized'), blob });
      }
      if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
      else downloadBlob(await zipFiles(files), 'rounder-colorized.zip');
    } catch (err) {
      error = `Couldn't save: ${problem(err)}`;
    } finally {
      saving = '';
    }
  }

  function forget(list: Item[]) {
    for (const i of list) if (i.before) URL.revokeObjectURL(i.before);
    const gone = new Set(list.map((i) => i.id));
    items = items.filter((i) => !gone.has(i.id));
    if (!items.some((i) => i.id === selectedId)) selectedId = items[0]?.id ?? null;
  }

  /** stops the photo being colored now and drops the ones still waiting; finished ones stay */
  function cancel() {
    controller.abort();
    controller = new AbortController();
    busy = false;
    forget(items.filter((i) => i.status === 'queued' || i.status === 'working'));
  }

  function reset() {
    cancel();
    forget(items);
    if (after) URL.revokeObjectURL(after.url);
    after = null;
    error = '';
    saturation = 100;
  }
</script>

<ModelGate model="ddcolor-tiny" light={null} {load}>
  {#snippet children({ device: gateDevice })}
    {@const device = ranOn ?? gateDevice}
    {#if !items.length}
      <Dropzone accept="image/*,.heic,.heif,.avif" multiple title="Drop black & white photos here" hint="or click to choose · JPG, PNG, WebP, HEIC · batches welcome" onfiles={add} />
      <p class="mono mt-3">typically {SPEED[device]} on {deviceLabel(device)} · full resolution out</p>
    {:else}
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div class="grid content-start gap-3">
          {#if selected?.status === 'done' && selected.before && after?.id === selected.id}
            <CompareSlider before={selected.before} after={after.url} beforeLabel="original" afterLabel="colorized" />
          {:else}
            <div class="stage" class:scan={selected?.status === 'working' || selected?.status === 'queued'}>
              {#if selected?.before}<img src={selected.before} alt={`${selected.file.name}, before coloring`} />{/if}
              <p class="mono state-msg" class:failed={selected?.status === 'error'}>
                {#if selected?.status === 'error'}{selected.error}
                {:else if selected?.status === 'done'}preparing the preview…
                {:else if selected?.status === 'working'}{selected.before ? 'adding color…' : 'opening…'}
                {:else}waiting its turn…{/if}
              </p>
            </div>
          {/if}

          <div class="flex flex-wrap items-center gap-x-4 gap-y-2" aria-live="polite">
            {#if busy}
              <span class="pulse" aria-hidden="true"></span>
              <p class="mono">
                coloring {Math.min(settled + 1, items.length)} of {items.length} · typically {SPEED[device]} on {deviceLabel(device)}
              </p>
              <button type="button" class="btn ml-auto py-2! text-sm!" onclick={cancel}>Cancel</button>
            {:else if selected?.note}
              <p class="mono">{selected.note} · colors are the AI's best guess</p>
            {/if}
          </div>
          {#if busy && device === 'wasm'}
            <p class="hint">Your browser can't use a graphics card here, so the model runs on your processor: each photo takes a little while, longer on a phone.</p>
          {/if}

          {#if items.length > 1}
            <ul class="strip" aria-label="Your photos">
              {#each items as item (item.id)}
                <li>
                  <button type="button" class="thumb" aria-pressed={item.id === selectedId} aria-label={`${item.file.name}: ${statusText[item.status]}`} title={item.file.name} onclick={() => (selectedId = item.id)}>
                    {#if item.before}<img src={item.before} alt="" />{/if}
                    <span class={`dot ${item.status}`} aria-hidden="true"></span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="grid content-start gap-5">
          <div>
            <label>
              <span class="label">color strength · {saturation}%</span>
              <input type="range" min="0" max="200" step="5" bind:value={saturation} class="w-full accent-(--color-ai)" />
            </label>
            <div class="mono flex justify-between">
              <span>muted</span>
              {#if saturation !== 100}<button type="button" class="underline decoration-dotted underline-offset-4 hover:text-chalk" onclick={() => (saturation = 100)}>reset</button>{/if}
              <span>vivid</span>
            </div>
          </div>

          <div class="grid gap-4 border-t border-line pt-5">
            <div>
              <span class="label">save as</span>
              <div class="seg" role="group" aria-label="Output format">
                {#each ['jpeg', 'png'] as const as f}
                  <button type="button" aria-pressed={format === f} onclick={() => (format = f)}>{formatInfo[f].label}</button>
                {/each}
              </div>
            </div>
            <button type="button" class="btn btn-primary" disabled={selected?.status !== 'done' || !!saving} onclick={() => selected && save([selected])}>
              Download {formatInfo[format].label}
            </button>
            {#if finished.length > 1}
              <button type="button" class="btn" disabled={!!saving} onclick={() => save(finished)}>Download all {finished.length} (zip)</button>
            {/if}
            {#if saving}<p class="mono" role="status">{saving}</p>{/if}
            {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
            <p class="mono">full resolution · detail from your original, color from the AI · metadata removed</p>
          </div>

          <div class="grid gap-3 border-t border-line pt-5">
            <Dropzone accept="image/*,.heic,.heif,.avif" multiple title="Add more photos" hint="drop, paste or click" onfiles={add} />
            <button type="button" class="btn py-2! text-sm!" onclick={reset}>Start over</button>
          </div>
        </div>
      </div>
    {/if}
  {/snippet}
</ModelGate>

<style>
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 240px;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    & img {
      display: block;
      width: 100%;
      max-height: 520px;
      object-fit: contain;
    }
  }
  .state-msg {
    position: absolute;
    bottom: 12px;
    left: 12px;
    right: 12px;
    width: fit-content;
    padding: 6px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-bg) 80%, transparent);
    &.failed {
      color: var(--color-bad);
    }
  }
  /* a slow lilac sweep while the model works */
  .scan::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--color-ai) 22%, transparent) 50%, transparent 70%) 0 0 / 250% 100%;
    animation: sweep 1.8s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -150% 0;
    }
  }
  .hint {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
  }
  .strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .thumb {
    position: relative;
    display: block;
    width: 64px;
    height: 64px;
    flex: none;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      box-shadow: 0 0 0 1px var(--color-sun);
    }
  }
  .dot {
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 9px;
    height: 9px;
    border-radius: 99px;
    border: 1.5px solid var(--color-bg);
    background: var(--color-muted);
    &.working {
      background: var(--color-ai);
      animation: pulse 1s ease-in-out infinite alternate;
    }
    &.done {
      background: var(--color-ok);
    }
    &.error {
      background: var(--color-bad);
    }
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--color-ai);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scan::after,
    .dot.working,
    .pulse {
      animation: none;
    }
  }
</style>
