<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import type { LoadOptions } from '@/engines/ai/load';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { toDecodable } from '@/engines/image/client';
  import { ALT_LIMIT, finish, imgTag, MODES, toCsv, type Mode } from '@/tools/lib/alt-text-generator/text';
  import type { CaptionWorker } from '@/tools/lib/alt-text-generator/caption.worker';
  import { downloadBlob } from '@/tools/lib/files';

  interface Item {
    id: number;
    file: File;
    thumb: string;
    size: string;
    /** one editable result per mode, kept when switching back and forth */
    texts: Partial<Record<Mode, string>>;
    errors: Partial<Record<Mode, string>>;
    broken: string;
  }

  /** Florence-2 squashes every picture to this square, so we scale once on the page and send less */
  const SIDE = 768;
  const THUMB = 240;

  const worker = modelWorker<CaptionWorker>(() => new Worker(new URL('../lib/alt-text-generator/caption.worker.ts', import.meta.url), { type: 'module' }));
  let opts: Pick<LoadOptions, 'device' | 'variant'> = {};

  // the model check is running; the tips below wait for it so they don't jump down when the model panel opens
  let checking = $state(true);
  let mode = $state<Mode>('alt');
  let items = $state<Item[]>([]);
  let running = $state(false);
  let paused = $state(false);
  let current = $state<number | null>(null);
  /** the mode the live draft is written in; switching tabs mid-caption mustn't show it under another mode */
  let liveMode = $state<Mode>('alt');
  let live = $state('');
  let controller: AbortController | null = null;
  let nextId = 0;

  const done = $derived(items.filter((i) => i.texts[mode] !== undefined).length);
  const usable = $derived(items.filter((i) => !i.broken).length);
  const waiting = $derived(items.some((i) => !i.broken && i.texts[mode] === undefined && !i.errors[mode]));

  async function load({ variant, device, onProgress, signal }: GateLoadContext) {
    opts = await worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal);
    return opts;
  }

  async function thumbnail(item: Item) {
    try {
      const src = await toDecodable(item.file);
      const full = src instanceof ImageBitmap ? src : await createImageBitmap(src);
      const scale = Math.min(1, THUMB / Math.max(full.width, full.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(full.width * scale)), Math.max(1, Math.round(full.height * scale)));
      canvas.getContext('2d')!.drawImage(full, 0, 0, canvas.width, canvas.height);
      item.size = `${full.width}×${full.height}`;
      full.close();
      const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }));
      if (listed(item)) item.thumb = url;
      else URL.revokeObjectURL(url);
    } catch {
      item.broken = "Couldn't read this image. Try saving it as JPG or PNG first.";
    }
  }

  async function modelInput(file: File) {
    const src = await toDecodable(file);
    try {
      return await createImageBitmap(src, { resizeWidth: SIDE, resizeHeight: SIDE, resizeQuality: 'high' });
    } finally {
      if (src instanceof ImageBitmap) src.close();
    }
  }

  const listed = (item: Item) => items.some((i) => i.id === item.id);
  const next = () => items.find((i) => !i.broken && i.texts[mode] === undefined && !i.errors[mode]);

  /** captions the waiting pictures one by one, in the current mode */
  async function pump() {
    if (running || paused) return;
    running = true;
    try {
      for (let item = next(); item; item = next()) {
        const m = mode;
        const id = item.id;
        const ctl = (controller = new AbortController());
        current = id;
        liveMode = m;
        live = '';
        const picture = await modelInput(item.file).catch(() => null);
        if (!picture) {
          item.broken ||= "Couldn't read this image. Try saving it as JPG or PNG first.";
          continue;
        }
        try {
          const onText = proxy((t: string) => {
            if (current === id) live += t;
          });
          const raw = await worker.call((api) => api.caption(transfer(picture, [picture]), MODES[m].task, MODES[m].maxTokens, opts, onText), ctl.signal);
          item.texts[m] = finish(raw, m);
        } catch (err) {
          const e = toAiError(err);
          // Stop and Start over pause or empty the queue; removing the picture being captioned just moves on
          if (e.code === 'aborted') {
            if (paused) break;
            continue;
          }
          item.errors[m] = e.message;
        }
      }
    } finally {
      running = false;
      current = null;
      controller = null;
    }
  }

  async function add(files: File[]) {
    paused = false;
    const start = items.length;
    items.push(...files.map((file) => ({ id: nextId++, file, thumb: '', size: '', texts: {}, errors: {}, broken: '' })));
    const added = items.slice(start);
    pump();
    // skip pictures removed (or cleared by Start over) before their turn: decoding HEIC is heavy
    for (const item of added) if (listed(item)) await thumbnail(item);
  }

  function setMode(m: Mode) {
    mode = m;
    pump();
  }

  function stop() {
    paused = true;
    controller?.abort();
  }

  function resume() {
    paused = false;
    pump();
  }

  function redo(item: Item) {
    delete item.texts[mode];
    delete item.errors[mode];
    paused = false;
    pump();
  }

  function remove(item: Item) {
    if (current === item.id) controller?.abort();
    URL.revokeObjectURL(item.thumb);
    items = items.filter((i) => i.id !== item.id);
  }

  function reset() {
    controller?.abort();
    paused = false;
    items.forEach((i) => URL.revokeObjectURL(i.thumb));
    items = [];
  }

  function exportCsv() {
    const rows = items.filter((i) => i.texts[mode] !== undefined).map((i) => [i.file.name, i.texts[mode]!]);
    downloadBlob(new Blob([toCsv(['filename', MODES[mode].column], rows)], { type: 'text/csv;charset=utf-8' }), `${MODES[mode].column === 'alt' ? 'alt-text' : MODES[mode].column}.csv`);
  }

  onMount(() => () => {
    paused = true;
    controller?.abort();
    worker.terminate();
    items.forEach((i) => URL.revokeObjectURL(i.thumb));
  });
</script>

<div class="grid gap-6">
  <ModelGate model="florence2-base" light={null} {load} bind:checking>
    {#snippet children()}
      <div class="grid gap-5">
        <div class="grid gap-2">
          <span class="label" id="alt-mode">what to write</span>
          <div class="seg" role="group" aria-labelledby="alt-mode">
            {#each Object.entries(MODES) as [key, m] (key)}
              <button type="button" aria-pressed={mode === key} onclick={() => setMode(key as Mode)}>{m.label}</button>
            {/each}
          </div>
          <p class="text-sm text-soft">{MODES[mode].hint}</p>
        </div>

        <Dropzone accept="image/*,.heic,.heif,.avif" multiple title={items.length ? 'Add more images' : 'Drop images here'} hint="or click to choose · batches welcome" onfiles={add} />

        {#if items.length}
          <div class="bar">
            <p class="mono" aria-live="polite">
              {done} of {usable} done{running ? ' · writing…' : paused && waiting ? ' · paused' : ''}
            </p>
            <div class="flex flex-wrap gap-2">
              {#if running}
                <button type="button" class="btn py-2! px-3! text-sm!" onclick={stop}>Stop</button>
              {:else if waiting}
                <button type="button" class="btn py-2! px-3! text-sm!" onclick={resume}>Resume</button>
              {/if}
              <button type="button" class="btn btn-primary py-2! px-3! text-sm!" onclick={exportCsv} disabled={!done}>Download CSV</button>
              <button type="button" class="btn py-2! px-3! text-sm!" onclick={reset}>Start over</button>
            </div>
          </div>
          <p class="mono">AI drafts: check names, numbers and why the picture is on your page before you publish.</p>

          <ol class="list">
            {#each items as item (item.id)}
              {@const text = item.texts[mode]}
              <li class="item card">
                <div class="thumb">
                  {#if item.thumb}<img src={item.thumb} alt="" />{/if}
                </div>
                <div class="body">
                  <p class="name">
                    <span class="min-w-0 truncate">{item.file.name}</span>
                    {#if item.size}<span class="mono">{item.size}</span>{/if}
                  </p>

                  {#if item.broken}
                    <p class="text-sm text-bad">{item.broken}</p>
                  {:else if text !== undefined}
                    <textarea class="field out" rows={mode === 'alt' ? 2 : 4} bind:value={item.texts[mode]} aria-label={`${MODES[mode].label} for ${item.file.name}`}></textarea>
                    <div class="foot">
                      <span class="mono" class:over={mode === 'alt' && text.length > ALT_LIMIT}>
                        {text.length}{mode === 'alt' ? ` / ${ALT_LIMIT}` : ''} characters
                      </span>
                      <div class="flex flex-wrap gap-2">
                        <CopyButton text={() => item.texts[mode] ?? ''} class="py-2! px-3! text-sm!" />
                        {#if mode === 'alt'}<CopyButton text={() => imgTag(item.file.name, item.texts[mode] ?? '')} label="Copy <img>" class="py-2! px-3! text-sm!" />{/if}
                        <button type="button" class="btn py-2! px-3! text-sm!" onclick={() => redo(item)}>Rewrite</button>
                        <button type="button" class="btn py-2! px-3! text-sm!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
                      </div>
                    </div>
                  {:else if item.errors[mode]}
                    <p class="text-sm text-bad" role="alert">{item.errors[mode]}</p>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" class="btn py-2! px-3! text-sm!" onclick={() => redo(item)}>Try again</button>
                      <button type="button" class="btn py-2! px-3! text-sm!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
                    </div>
                  {:else if current === item.id && liveMode === mode}
                    <p class="draft" aria-busy="true">{live}<span class="caret" aria-hidden="true"></span></p>
                    <p class="mono">{live ? 'writing…' : 'looking at the picture…'}</p>
                  {:else}
                    <p class="mono">{paused ? 'paused' : 'waiting…'}</p>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    {/snippet}
  </ModelGate>

  <aside class="tips card" aria-labelledby="alt-tips" style:visibility={checking ? 'hidden' : null}>
    <h2 id="alt-tips" class="tips-title">Tips for good alt text</h2>
    <ul>
      <li><strong>Context matters.</strong> The same photo needs different words on a recipe blog and a news story. Say why the picture is there, not everything in it.</li>
      <li><strong>Skip "image of".</strong> Screen readers already announce an image, so start with the subject. We trim these openers for you.</li>
      <li><strong>Keep it short.</strong> One sentence, about {ALT_LIMIT} characters. Put longer detail in a caption or the text around it.</li>
      <li><strong>Include text that matters.</strong> If the picture shows a sign, a quote or a price, write it out word for word.</li>
      <li><strong>Decorative images get empty alt.</strong> Borders, dividers and background flourishes should use <code>alt=""</code> so screen readers skip them.</li>
      <li><strong>Check the facts.</strong> The AI can't know who people are or what your product is called, and it can get colors and counts wrong.</li>
    </ul>
  </aside>
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .list {
    display: grid;
    gap: 12px;
  }
  .item {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    @media (min-width: 640px) {
      grid-template-columns: 128px minmax(0, 1fr);
      gap: 18px;
      padding: 16px;
    }
  }
  .thumb {
    aspect-ratio: 1;
    border-radius: 12px;
    overflow: hidden;
    background: repeating-conic-gradient(var(--color-panel-2) 0 25%, var(--color-panel) 0 50%) 0 0 / 16px 16px;
    border: 1px solid var(--color-line);
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .body {
    display: grid;
    gap: 8px;
    align-content: start;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    font-size: 14px;
    color: var(--color-soft);
  }
  .out {
    min-height: 0;
    font: 400 15px/1.5 var(--font-sans);
    border-color: color-mix(in srgb, var(--color-ai) 30%, var(--color-line-2));
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .over {
    color: var(--color-sun);
  }
  .draft {
    font-size: 15px;
    line-height: 1.5;
    min-height: 1.5em;
  }
  .caret {
    display: inline-block;
    width: 8px;
    height: 1em;
    margin-left: 2px;
    vertical-align: -2px;
    border-radius: 2px;
    background: var(--color-ai);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }
  .tips {
    padding: clamp(18px, 3vw, 28px);
    & ul {
      display: grid;
      gap: 10px;
      margin-top: 14px;
      padding-left: 18px;
      list-style: disc;
      color: var(--color-soft);
    }
    & li::marker {
      color: var(--color-ai);
    }
    & strong {
      color: var(--color-chalk);
      font-weight: 500;
    }
    & code {
      font: 400 13px var(--font-mono);
      color: var(--color-chalk);
    }
  }
  .tips-title {
    font: 400 clamp(26px, 3.4vw, 32px) / 1.1 var(--font-serif);
  }
</style>
