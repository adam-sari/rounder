<script module lang="ts">
  export interface BatchOutput {
    blob: Blob;
    name: string;
    width?: number;
    height?: number;
    /** short extra detail shown under the file name */
    note?: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dropzone from './Dropzone.svelte';
  import CompareSlider from './CompareSlider.svelte';
  import { downloadResult, formatBytes, zipFiles } from '@/tools/lib/files';

  interface Props {
    /** turns one dropped file into one output file */
    process: (file: File) => Promise<BatchOutput>;
    /** serialised settings; when it changes every file is processed again */
    settingsKey?: string;
    accept?: string;
    title?: string;
    hint?: string;
    zipName?: string;
    /** show a before/after slider for the selected file */
    compare?: boolean;
    /** the settings panel */
    children?: Snippet;
    /** the file shown in the compare view and highlighted in the list (null when empty) */
    onselect?: (file: File | null) => void;
    /** a file left the list, by its remove button or by "Start over" */
    onremove?: (file: File) => void;
  }

  let {
    process,
    settingsKey = '',
    accept = 'image/*,.heic,.heif,.avif',
    title = 'Drop images here',
    hint = 'or click to choose · batches welcome',
    zipName = 'rounder-images.zip',
    compare = false,
    children,
    onselect,
    onremove,
  }: Props = $props();

  interface Item {
    id: number;
    file: File;
    status: 'queued' | 'working' | 'done' | 'error';
    inputUrl: string;
    inputViewable: boolean;
    out?: BatchOutput & { url: string };
    error?: string;
    gen: number;
  }

  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let zipping = $state(false);
  let nextId = 0;
  let generation = 0;
  const CONCURRENCY = 4;
  let running = 0;

  /** also callable from code via bind:this, e.g. for pasted SVG markup turned into a File */
  export function add(files: File[]) {
    const fresh = files.map((file) => ({
      id: nextId++,
      file,
      status: 'queued' as const,
      inputUrl: URL.createObjectURL(file),
      inputViewable: true,
      gen: generation,
    }));
    items.push(...fresh);
    selected ??= fresh[0]?.id ?? null;
    pump();
  }

  function pump() {
    while (running < CONCURRENCY) {
      const item = items.find((i) => i.status === 'queued');
      if (!item) return;
      run(item);
    }
  }

  async function run(item: Item) {
    running++;
    item.status = 'working';
    const gen = generation;
    try {
      const out = await process(item.file);
      if (gen !== generation || !items.includes(item)) return;
      if (item.out) URL.revokeObjectURL(item.out.url);
      item.out = { ...out, url: URL.createObjectURL(out.blob) };
      item.error = undefined;
      item.status = 'done';
    } catch (e) {
      if (gen !== generation) return;
      console.error(e);
      item.error = (e as Error)?.message || 'Something went wrong with this file.';
      item.status = 'error';
    } finally {
      running--;
      // a run from an older generation leaves its item queued for the new settings
      if (gen !== generation && item.status === 'working') item.status = 'queued';
      pump();
    }
  }

  // reprocess everything when the settings change, once the user stops fiddling
  let lastKey: string | undefined;
  $effect(() => {
    const key = settingsKey;
    if (lastKey === undefined) {
      lastKey = key;
      return;
    }
    if (key === lastKey) return;
    lastKey = key;
    const t = setTimeout(() => {
      generation++;
      for (const item of items) if (item.status !== 'working') item.status = 'queued';
      // items still working finish under the old generation and are then re-queued
      pump();
    }, 300);
    return () => clearTimeout(t);
  });

  function remove(item: Item) {
    onremove?.(item.file);
    URL.revokeObjectURL(item.inputUrl);
    if (item.out) URL.revokeObjectURL(item.out.url);
    items.splice(items.indexOf(item), 1);
    if (selected === item.id) selected = items[0]?.id ?? null;
  }

  function clear() {
    for (const item of [...items]) remove(item);
    generation++;
  }

  async function downloadAll() {
    const done = items.filter((i) => i.out);
    if (done.length === 1) return downloadResult(done[0].out!.blob, done[0].out!.name);
    zipping = true;
    try {
      downloadResult(await zipFiles(done.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), zipName);
    } finally {
      zipping = false;
    }
  }

  const done = $derived(items.filter((i) => i.status === 'done'));
  const busy = $derived(items.some((i) => i.status === 'queued' || i.status === 'working'));
  const totals = $derived({
    before: done.reduce((s, i) => s + i.file.size, 0),
    after: done.reduce((s, i) => s + (i.out?.blob.size ?? 0), 0),
  });
  const current = $derived(items.find((i) => i.id === selected));

  $effect(() => {
    onselect?.(current?.file ?? null);
  });

  function change(before: number, after: number) {
    const pct = Math.round((1 - after / before) * 100);
    return pct >= 0 ? { text: `−${pct}%`, good: true } : { text: `+${-pct}%`, good: false };
  }

  $effect(() => () => {
    for (const item of items) {
      URL.revokeObjectURL(item.inputUrl);
      if (item.out) URL.revokeObjectURL(item.out.url);
    }
  });
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if items.length === 0}
      <Dropzone {accept} multiple {title} {hint} onfiles={add} />
    {:else}
      {#if compare && current?.out && current.inputViewable}
        <CompareSlider before={current.inputUrl} after={current.out.url} />
      {/if}

      <ul class="grid gap-2" aria-label="Files">
        {#each items as item (item.id)}
          <li class="row" class:sel={(compare || onselect) && item.id === selected}>
            <button type="button" class="thumb" onclick={() => (selected = item.id)} aria-label={`Show ${item.file.name}`}>
              {#if item.inputViewable}
                <img src={item.inputUrl} alt="" onerror={() => (item.inputViewable = false)} />
              {:else if item.out}
                <img src={item.out.url} alt="" />
              {/if}
            </button>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{item.out?.name ?? item.file.name}</p>
              <p class="mono">
                {#if item.status === 'done' && item.out}
                  {formatBytes(item.file.size)} → <span class="text-chalk">{formatBytes(item.out.blob.size)}</span>
                  {@const c = change(item.file.size, item.out.blob.size)}
                  <span class={c.good ? 'text-ok' : 'text-bad'}>{c.text}</span>
                  {#if item.out.width}· {item.out.width}×{item.out.height}{/if}
                  {#if item.out.note}· {item.out.note}{/if}
                {:else if item.status === 'error'}
                  <span class="text-bad">{item.error}</span>
                {:else}
                  <span class="working">{item.status === 'working' ? 'working' : 'waiting'}…</span> {formatBytes(item.file.size)}
                {/if}
              </p>
            </div>
            {#if item.out}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadResult(item.out!.blob, item.out!.name)} aria-label={`Download ${item.out.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>
      <Dropzone {accept} multiple title="Add more" hint="drop, click or paste" onfiles={add} />
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    {@render children?.()}
    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if done.length}
          <p class="mono">
            {done.length}/{items.length} done · {formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span>
            {#if totals.before}{@const c = change(totals.before, totals.after)}<span class={c.good ? 'text-ok' : 'text-bad'}> {c.text}</span>{/if}
          </p>
        {/if}
        <button type="button" class="btn btn-primary" disabled={!done.length || busy || zipping} onclick={downloadAll}>
          {zipping ? 'Zipping…' : busy ? 'Working…' : done.length > 1 ? `Download all (${done.length}) as .zip` : 'Download'}
        </button>
        <button type="button" class="btn" onclick={clear}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  .row.sel {
    border-color: var(--color-sun);
  }
  .thumb {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 10px;
    overflow: hidden;
    border: 0;
    padding: 0;
    cursor: pointer;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 12px 12px;
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .working {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>
