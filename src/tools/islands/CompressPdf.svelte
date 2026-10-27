<script lang="ts">
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { getThumbnail, isAbort, pdfName } from '@/engines/pdf';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { DEFAULT_SETTINGS, LEVELS, type CompressSettings } from '@/tools/lib/compress-pdf/settings';
  import type { CompressResult, Progress } from '@/tools/lib/compress-pdf/compress';

  interface Item {
    id: number;
    file: File;
    pages: number;
    password?: string;
    /** permissions-only encryption (no password), which the output drops */
    restricted?: boolean;
    /** our own object URL */
    thumb?: string;
    status: 'queued' | 'working' | 'done' | 'error';
    progress: Progress | null;
    result?: CompressResult & { name: string };
    error?: string;
  }

  let items = $state<Item[]>([]);
  let settings = $state<CompressSettings>({ ...DEFAULT_SETTINGS });
  let zipping = $state(false);
  let announce = $state('');
  let nextId = 0;
  let running = false;
  let ctrl: AbortController | undefined;
  let lib: Promise<typeof import('@/tools/lib/compress-pdf/compress')> | undefined;

  function add({ file, doc, password }: OpenedPdf) {
    items.push({ id: nextId++, file, pages: doc.numPages, password, status: 'queued', progress: null });
    const item = items[items.length - 1];
    // pdf.js keeps a full copy of the file, so it only stays open for the thumbnail
    const restricted = doc.proxy.getPermissions().then((p) => (item.restricted = !password && p !== null));
    const thumb = getThumbnail(doc, 0, { width: Math.round(48 * devicePixelRatio) })
      .then((t) => fetch(t.url))
      .then((r) => r.blob())
      .then((b) => {
        if (items.includes(item)) item.thumb = URL.createObjectURL(b);
      });
    void Promise.allSettled([restricted, thumb]).then(() => doc.destroy());
    void pump();
  }

  // one file at a time: big PDFs need all the memory they can get
  async function pump() {
    if (running) return;
    running = true;
    try {
      for (let item = next(); item; item = next()) await run(item);
    } finally {
      running = false;
    }
  }
  const next = () => items.find((i) => i.status === 'queued');

  async function run(item: Item) {
    const job = (ctrl = new AbortController());
    item.status = 'working';
    item.progress = null;
    try {
      const { compressPdf } = await (lib ??= import('@/tools/lib/compress-pdf/compress'));
      const result = await compressPdf(item.file, $state.snapshot(settings), {
        password: item.password,
        signal: job.signal,
        onprogress: (p) => {
          if (!job.signal.aborted) item.progress = p;
        },
      });
      if (job.signal.aborted) return;
      item.result = { ...result, name: result.kept ? item.file.name : pdfName(item.file.name, '-compressed') };
      item.status = 'done';
      announce = result.kept ? `${item.file.name} was already compact.` : `${item.file.name} is ${change(item.file.size, result.blob.size).text} smaller.`;
    } catch (e) {
      // whoever aborted has already re-queued or removed the item
      if (job.signal.aborted || isAbort(e)) return;
      console.error(e);
      item.error = (e as Error)?.message || 'Something went wrong with this file.';
      item.status = 'error';
    }
  }

  // new settings: redo every file, once the user stops fiddling
  let applied: string | undefined;
  $effect(() => {
    const key = JSON.stringify(settings);
    applied ??= key;
    // toggling something back within the pause shouldn't redo anything
    if (key === applied) return;
    const t = setTimeout(() => {
      applied = key;
      ctrl?.abort();
      for (const item of items) {
        item.status = 'queued';
        item.result = item.error = undefined;
      }
      void pump();
    }, 400);
    return () => clearTimeout(t);
  });

  function remove(item: Item) {
    if (item.status === 'working') ctrl?.abort();
    items.splice(items.indexOf(item), 1);
    if (item.thumb) URL.revokeObjectURL(item.thumb);
  }

  function clear() {
    for (const item of [...items]) remove(item);
  }

  $effect(() => () => {
    ctrl?.abort();
    for (const item of items) if (item.thumb) URL.revokeObjectURL(item.thumb);
  });

  async function downloadAll() {
    if (done.length === 1) return downloadBlob(done[0].result!.blob, done[0].result!.name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((i) => ({ name: i.result!.name, blob: i.result!.blob }))), 'compressed-pdfs.zip');
    } finally {
      zipping = false;
    }
  }

  function change(before: number, after: number) {
    const pct = Math.round((1 - after / before) * 100);
    return pct >= 0 ? { text: `−${pct}%`, good: pct > 0 } : { text: `+${-pct}%`, good: false };
  }

  function stage(p: Progress | null) {
    if (!p) return { text: 'reading…', frac: 0.04 };
    if (p.stage === 'optimize') return { text: 'optimizing structure…', frac: 0.92 };
    if (!p.total) return { text: 'looking for photos…', frac: 0.1 };
    return { text: `recompressing images · ${p.done}/${p.total}`, frac: 0.1 + (0.78 * p.done) / p.total };
  }

  function notes(item: Item, r: CompressResult) {
    const out: string[] = [];
    if (r.kept) out.push('already compact · kept the original');
    else if (r.images?.replaced) out.push(`${r.images.replaced} of ${r.images.found} image${r.images.found === 1 ? '' : 's'} recompressed`);
    else if (r.images?.found) out.push('images left as they were');
    if (!r.kept && (r.decrypted || item.restricted)) out.push(item.password ? 'saved without its password' : 'permission restrictions removed');
    return out;
  }

  const done = $derived(items.filter((i) => i.status === 'done'));
  const busy = $derived(items.some((i) => i.status === 'queued' || i.status === 'working'));
  const totals = $derived({
    before: done.reduce((s, i) => s + i.file.size, 0),
    after: done.reduce((s, i) => s + (i.result?.blob.size ?? 0), 0),
  });
  const saved = $derived(totals.before ? change(totals.before, totals.after) : null);
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if items.length === 0}
      <PdfDrop multiple title="Drop PDFs here" hint="or click to choose · batches welcome" onopen={add} />
    {:else}
      <ul class="grid gap-2" aria-label="PDFs">
        {#each items as item (item.id)}
          {@const r = item.result}
          <li class="row">
            <div class="thumb" aria-hidden="true">
              {#if item.thumb}
                <img src={item.thumb} alt="" />
              {:else}
                <span class="mono">PDF</span>
              {/if}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{r?.name ?? item.file.name}</p>
              <p class="mono">
                {#if item.status === 'done' && r}
                  {@const c = change(item.file.size, r.blob.size)}
                  {formatBytes(item.file.size)} → <span class="text-chalk">{formatBytes(r.blob.size)}</span>
                  <span class={c.good ? 'text-ok' : 'text-soft'}>{c.text}</span>
                {:else if item.status === 'error'}
                  <span class="text-bad">{item.error}</span>
                {:else if item.status === 'working'}
                  <span class="text-sun">{stage(item.progress).text}</span>
                {:else}
                  waiting… · {formatBytes(item.file.size)} · {item.pages} page{item.pages === 1 ? '' : 's'}
                {/if}
              </p>
              {#if item.status === 'working'}
                <div class="track" role="progressbar" aria-label={`Compressing ${item.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(stage(item.progress).frac * 100)}>
                  <span class="fill working" style:transform={`scaleX(${stage(item.progress).frac})`}></span>
                </div>
              {:else if item.status === 'done' && r}
                <div class="track" aria-hidden="true">
                  <span class="fill result" style:--r={Math.min(1, r.blob.size / item.file.size)}></span>
                </div>
                {@const n = notes(item, r)}
                {#if n.length}<p class="mono mt-1">{n.join(' · ')}</p>{/if}
              {/if}
            </div>
            {#if r}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadBlob(r.blob, r.name)} aria-label={`Download ${r.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>
      <div><PdfDrop multiple compact onopen={add} /></div>
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    <div>
      <span class="label" id="level-label">compression level</span>
      <div class="grid gap-2" role="group" aria-labelledby="level-label">
        {#each LEVELS as level (level.id)}
          <button type="button" class="level" aria-pressed={settings.level === level.id} onclick={() => (settings.level = level.id)}>
            <span class="text-[15px]">{level.name}</span>
            <span class="mono">{level.hint}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if settings.level === 'custom'}
      <label>
        <span class="label">image resolution · {settings.dpi} dpi</span>
        <input type="range" min="50" max="300" step="10" bind:value={settings.dpi} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
      </label>
      <label>
        <span class="label">JPEG quality · {settings.quality}</span>
        <input type="range" min="30" max="95" bind:value={settings.quality} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>smaller</span><span>cleaner</span></span>
      </label>
    {/if}

    <div class="grid gap-3">
      {#if settings.level !== 'light'}
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" bind:checked={settings.grayscale} class="mt-1" />
          <span>Grayscale images<span class="mono block">text and drawings keep their color</span></span>
        </label>
      {/if}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={settings.stripMetadata} class="mt-1" />
        <span>Remove metadata<span class="mono block">title, author, software and XMP data</span></span>
      </label>
    </div>

    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if saved && !busy}
          <div class="total">
            <span class="font-serif text-5xl leading-none" class:text-ok={saved.good}>{saved.text}</span>
            <span class="mono">{formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span>{done.length > 1 ? ` · ${done.length} files` : ''}</span>
          </div>
        {/if}
        <button type="button" class="btn btn-primary" disabled={!done.length || busy || zipping} onclick={downloadAll}>
          {zipping ? 'Zipping…' : busy ? 'Compressing…' : done.length > 1 ? `Download all (${done.length}) as .zip` : 'Download'}
        </button>
        <button type="button" class="btn" onclick={clear}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<p class="sr-only" aria-live="polite">{announce}</p>

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
  .thumb {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 60px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    & .mono {
      font-size: 10.5px;
      color: var(--color-pdf);
    }
  }
  .track {
    height: 4px;
    margin-top: 8px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    transform-origin: left;
  }
  .fill.working {
    background: var(--color-sun);
    transition: transform 0.4s ease-out;
  }
  /* the bar starts at the original size and shrinks to the new one */
  .fill.result {
    background: var(--color-ok);
    transform: scaleX(var(--r));
    animation: shrink 1.1s var(--ease-spring) both;
  }
  @keyframes shrink {
    from {
      transform: scaleX(1);
      background: var(--color-muted);
    }
  }
  .level {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      background: #ffd25e12;
      & .mono {
        color: var(--color-soft);
      }
    }
  }
  .total {
    display: grid;
    gap: 6px;
    margin-bottom: 6px;
    animation: rise 0.5s ease-out both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
