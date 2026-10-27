<script module lang="ts">
  import type { PdfDoc } from '@/engines/pdf';

  export interface StampItem {
    id: number;
    file: File;
    /** open in pdf.js for the preview */
    doc: PdfDoc;
    password?: string;
  }
  export interface StampOutput {
    blob: Blob;
    name: string;
    note?: string;
  }
  /** Stamps one file with the settings captured when the run started */
  export type Stamp = (item: StampItem, onprogress: (fraction: number) => void) => Promise<StampOutput>;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { getThumbnail } from '@/engines/pdf';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';

  interface Props {
    /** primary button, e.g. "Add page numbers" */
    action: string;
    /** shown while running, e.g. "Numbering" */
    verb: string;
    zipName: string;
    /** serialized settings: outputs made with other settings are out of date */
    settingsKey: string;
    /** why the tool can't run yet (empty text, bad page range…) */
    blocker?: string;
    /** snapshots the settings and returns the function that stamps one file */
    begin: () => Stamp;
    /** the preview of the selected file */
    preview: Snippet<[StampItem]>;
    /** the settings panel */
    children: Snippet;
    /** the previewed file changed (null once the list is empty) */
    onselect?: (item: StampItem | null) => void;
  }

  let { action, verb, zipName, settingsKey, blocker = '', begin, preview, children, onselect }: Props = $props();

  interface Item extends StampItem {
    thumb?: string;
    status: 'idle' | 'working' | 'done' | 'error';
    progress: number;
    out?: StampOutput;
    error?: string;
    /** settings the last attempt used */
    key?: string;
  }

  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let running = $state(false);
  let zipping = $state(false);
  let announce = $state('');
  let nextId = 0;

  function add({ file, doc, password }: OpenedPdf) {
    items.push({ id: nextId++, file, doc, password, status: 'idle', progress: 0 });
    const item = items[items.length - 1];
    selected ??= item.id;
    getThumbnail(doc, 0, { width: Math.round(48 * devicePixelRatio) })
      .then((t) => (item.thumb = t.url))
      .catch(() => {});
  }

  const stale = (i: Item) => i.key !== settingsKey;
  const due = (i: Item, key: string) => i.key !== key || i.status === 'error';
  const todo = $derived(items.filter((i) => i.status !== 'working' && due(i, settingsKey)));
  const done = $derived(items.filter((i) => i.status === 'done' && !stale(i)));
  const current = $derived(items.find((i) => i.id === selected));
  $effect(() => {
    onselect?.(current ?? null);
  });

  // one file at a time: big PDFs need all the memory they can get
  async function runAll() {
    if (running || blocker) return;
    running = true;
    const key = settingsKey;
    const stamp = begin();
    // failed files get one more try per run, not an endless loop
    const tried = new Set<number>();
    const next = () => items.find((i) => !tried.has(i.id) && due(i, key));
    try {
      for (let it = next(); it; it = next()) {
        tried.add(it.id);
        Object.assign(it, { key, status: 'working', progress: 0, out: undefined, error: undefined });
        try {
          const out = await stamp(it, (f) => (it.progress = f));
          if (!items.includes(it)) continue;
          it.out = out;
          it.status = 'done';
          it.progress = 1;
          announce = `${out.name} is ready.`;
        } catch (e) {
          if (!items.includes(it)) continue;
          if (!(e instanceof Error) || !/^(PdfError|PdfPasswordError|PageRangeError|StampError)$/.test(e.name)) console.error(e);
          it.error = (e as Error)?.message || 'Something went wrong with this file.';
          it.status = 'error';
        }
      }
    } finally {
      running = false;
    }
  }

  function remove(item: Item) {
    items.splice(items.indexOf(item), 1);
    if (selected === item.id) selected = items[0]?.id ?? null;
    void item.doc.destroy();
  }

  function clear() {
    for (const item of [...items]) remove(item);
  }

  $effect(() => () => {
    for (const item of items) void item.doc.destroy();
  });

  async function downloadAll() {
    if (done.length === 1) return downloadBlob(done[0].out!.blob, done[0].out!.name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), zipName);
    } finally {
      zipping = false;
    }
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if current}
      {@render preview(current)}
    {/if}

    {#if items.length}
      <ul class="grid gap-2" aria-label="PDFs">
        {#each items as item (item.id)}
          {@const fresh = item.status === 'done' && !stale(item) && item.out}
          <li class="row" class:sel={items.length > 1 && item.id === selected}>
            <button type="button" class="pick" onclick={() => (selected = item.id)} aria-label={`Preview ${item.file.name}`} aria-pressed={item.id === selected}>
              <span class="thumb" aria-hidden="true">
                {#if item.thumb}
                  <img src={item.thumb} alt="" onerror={() => (item.thumb = undefined)} />
                {:else}
                  <span class="mono">PDF</span>
                {/if}
                {#if fresh}<span class="seal">✓</span>{/if}
              </span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm">{fresh ? fresh.name : item.file.name}</span>
                <span class="mono block">
                  {#if item.status === 'working'}
                    <span class="text-sun">{verb}… {Math.round(item.progress * 100)}%</span>
                  {:else if item.status === 'error' && !stale(item)}
                    <span class="text-bad">{item.error}</span>
                  {:else if fresh}
                    {formatBytes(fresh.blob.size)}{fresh.note ? ` · ${fresh.note}` : ''}
                  {:else}
                    {plural(item.doc.numPages, 'page')} · {formatBytes(item.file.size)}{item.key !== undefined ? ' · settings changed' : ''}
                  {/if}
                </span>
              </span>
            </button>
            {#if item.status === 'working'}
              <span class="track" role="progressbar" aria-label={`${verb} ${item.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(item.progress * 100)}>
                <span class="fill" style:transform={`scaleX(${Math.max(0.04, item.progress)})`}></span>
              </span>
            {/if}
            {#if fresh}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadBlob(fresh.blob, fresh.name)} aria-label={`Download ${fresh.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- one instance throughout, so a batch still opening keeps its queue and password prompts -->
    <div>
      <PdfDrop multiple compact={items.length > 0} title={items.length ? undefined : 'Drop PDFs here'} hint="or click to choose · batches welcome" onopen={add} />
    </div>
  </div>

  <aside class="grid content-start gap-5">
    {@render children()}

    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if todo.length || running}
          <button type="button" class="btn btn-primary" disabled={running || !!blocker} onclick={runAll}>
            {#if running}
              {verb}…
            {:else}
              {action}{items.length > 1 ? ` · ${plural(todo.length, 'file')}` : ''}
            {/if}
          </button>
          {#if blocker}<p class="text-sm text-bad" role="alert">{blocker}</p>{/if}
        {/if}
        {#if done.length && !running}
          <button type="button" class="btn" class:btn-primary={!todo.length} disabled={zipping} onclick={downloadAll}>
            {zipping ? 'Zipping…' : done.length > 1 ? `Download all (${done.length}) as .zip` : 'Download PDF'}
          </button>
        {/if}
        <button type="button" class="btn" onclick={clear}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<p class="sr-only" aria-live="polite">{announce}</p>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    transition: border-color 0.2s;
    &.sel {
      border-color: var(--color-sun);
    }
  }
  .pick {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 12px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: 10px;
  }
  .thumb {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 60px;
    border-radius: 8px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & img {
      width: 100%;
      height: 100%;
      border-radius: inherit;
      object-fit: cover;
      object-position: top;
    }
    & .mono {
      font-size: 10.5px;
      color: var(--color-pdf);
    }
  }
  /* a little rubber stamp lands on the file when it's done */
  .seal {
    position: absolute;
    right: -7px;
    bottom: -7px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    color: var(--color-bg);
    background: var(--color-ok);
    box-shadow: 0 0 0 3px #141312;
    animation: stamp 0.45s var(--ease-spring) both;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(2.2) rotate(-25deg);
    }
  }
  .track {
    position: absolute;
    left: 68px;
    right: 56px;
    bottom: 7px;
    height: 3px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--color-sun);
    transform-origin: left;
    transition: transform 0.3s ease-out;
  }
</style>
