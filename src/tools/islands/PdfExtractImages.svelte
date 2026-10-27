<script lang="ts">
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { formatPageRanges, isAbort, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import type { FoundImage } from '@/tools/lib/pdf-images/client';

  interface Item {
    id: string;
    name: string;
    pages: number[];
    width: number;
    height: number;
    color: string;
    encoding: string;
    note?: string;
    /** what's saved: the original JPEG, a rebuilt PNG, or a PNG drawn by pdf.js */
    kind: 'JPG' | 'PNG';
    /** skipped = still waiting for pdf.js when the user pressed Stop */
    status: 'ready' | 'pending' | 'failed' | 'skipped';
    blob?: Blob;
    url?: string;
    selected: boolean;
  }

  let pdf = $state<{ file: File; doc: PdfDoc } | null>(null);
  let items = $state<Item[]>([]);
  let phase = $state<'idle' | 'scanning' | 'decoding' | 'done'>('idle');
  let progress = $state({ done: 0, total: 0 });
  let error = $state('');
  let hideTiny = $state(true);
  let zipping = $state(false);
  let stopped = $state(false);
  let preview = $state<Item | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let ctrl: AbortController | undefined;

  const TINY = 32;
  const isTiny = (i: Item) => i.width < TINY || i.height < TINY;
  const base = $derived(pdf?.file.name.replace(/\.pdf$/i, '').trim() || 'document');

  async function open({ file, doc, password }: OpenedPdf) {
    reset();
    pdf = { file, doc };
    phase = 'scanning';
    const job = (ctrl = new AbortController());
    const perPage = new Map<number, number>();
    try {
      const { extractImages, drawWithPdfjs } = await import('@/tools/lib/pdf-images/client');
      await extractImages(file, {
        password,
        signal: job.signal,
        onProgress: (done, total) => {
          if (!job.signal.aborted) progress = { done, total };
        },
        onImage: (image: FoundImage) => {
          if (job.signal.aborted) return;
          const page = image.pages[0];
          const n = (perPage.get(page) ?? 0) + 1;
          perPage.set(page, n);
          const kind = image.file?.ext === 'jpg' ? 'JPG' : 'PNG';
          const blob = image.file ? new Blob([image.file.bytes as Uint8Array<ArrayBuffer>], { type: kind === 'JPG' ? 'image/jpeg' : 'image/png' }) : undefined;
          items.push({
            id: image.id,
            name: `${base}-page${page + 1}-${n}.${kind.toLowerCase()}`,
            pages: image.pages,
            width: image.width,
            height: image.height,
            color: image.color,
            encoding: image.encoding,
            note: image.note,
            kind,
            status: blob ? 'ready' : 'pending',
            blob,
            url: blob && URL.createObjectURL(blob),
            selected: true,
          });
        },
      });

      // JPEG 2000, JBIG2, CMYK and the like: let pdf.js decode them
      const pending = items.filter((i) => i.status === 'pending');
      if (pending.length) {
        phase = 'decoding';
        const blobs = await drawWithPdfjs(doc, pending.map((i) => ({ pageIndex: i.pages[0], width: i.width, height: i.height })), job.signal);
        // stopped or reset while the last page was decoding: these items may be gone
        if (job.signal.aborted) return;
        blobs.forEach((blob, k) => {
          const item = pending[k];
          if (blob) Object.assign(item, { blob, url: URL.createObjectURL(blob), status: 'ready', note: item.note ?? `${item.encoding} saved as PNG` });
          else Object.assign(item, { status: 'failed', selected: false });
        });
      }
      phase = 'done';
    } catch (e) {
      if (job.signal.aborted || isAbort(e)) return;
      console.error(e);
      error = (e as Error)?.message || "This PDF's images couldn't be extracted.";
      phase = 'done';
    }
  }

  /** stops extracting but keeps what was found so far */
  function stop() {
    ctrl?.abort();
    for (const i of items) if (i.status === 'pending') Object.assign(i, { status: 'skipped', selected: false });
    stopped = true;
    phase = 'done';
  }

  function reset() {
    ctrl?.abort();
    ctrl = undefined;
    for (const i of items) if (i.url) URL.revokeObjectURL(i.url);
    void pdf?.doc.destroy();
    pdf = null;
    items = [];
    phase = 'idle';
    progress = { done: 0, total: 0 };
    error = '';
    stopped = false;
    preview = null;
  }

  $effect(() => () => {
    ctrl?.abort();
    for (const i of items) if (i.url) URL.revokeObjectURL(i.url);
    void pdf?.doc.destroy();
  });

  const visible = $derived(items.filter((i) => !hideTiny || !isTiny(i)));
  const tinyCount = $derived(items.filter(isTiny).length);
  const chosen = $derived(visible.filter((i) => i.selected && i.blob));
  const chosenBytes = $derived(chosen.reduce((n, i) => n + (i.blob?.size ?? 0), 0));
  const busy = $derived(phase === 'scanning' || phase === 'decoding');

  function selectAll(on: boolean) {
    for (const i of visible) if (i.status === 'ready') i.selected = on;
  }

  async function downloadChosen() {
    if (chosen.length === 1) return downloadBlob(chosen[0].blob!, chosen[0].name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(chosen.map((i) => ({ name: i.name, blob: i.blob! }))), `${base}-images.zip`);
    } catch (e) {
      console.error(e);
      error = "The zip couldn't be made. It may be too big for your browser's memory: try fewer images at a time.";
    } finally {
      zipping = false;
    }
  }

  function show(item: Item) {
    preview = item;
    dialog?.showModal();
  }

  const pagesLabel = (pages: number[]) => (pages.length === 1 ? `p. ${pages[0] + 1}` : pages.length > 4 ? `${pages.length} pages` : `pp. ${formatPageRanges(pages)}`);
</script>

{#if !pdf}
  <PdfDrop title="Drop a PDF here" hint="or click to choose · photos come out at full quality" onopen={open} />
{:else}
  <div class="grid gap-4">
    <div class="file">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm">{pdf.file.name}</p>
        <p class="mono">
          {#if phase === 'scanning'}
            <span class="text-sun">{progress.total ? `extracting image ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'looking for images…'}</span>
          {:else if phase === 'decoding'}
            <span class="text-sun">decoding {items.filter((i) => i.status === 'pending').length} more with the PDF renderer…</span>
          {:else}
            {pdf.doc.numPages} page{pdf.doc.numPages === 1 ? '' : 's'} · {items.length} image{items.length === 1 ? '' : 's'}{items.length ? ` · ${formatBytes(items.reduce((n, i) => n + (i.blob?.size ?? 0), 0))}` : ''}
          {/if}
        </p>
        {#if busy}
          <div class="track" role="progressbar" aria-label="Extracting images" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress.total ? (progress.done / progress.total) * 100 : 0)}>
            <span class="fill" class:indeterminate={!progress.total} style:transform={progress.total ? `scaleX(${progress.done / progress.total})` : undefined}></span>
          </div>
        {/if}
      </div>
      <button type="button" class="btn px-3! py-2! text-sm!" onclick={busy ? stop : reset}>{busy ? 'Stop' : 'Start over'}</button>
    </div>

    {#if error}
      <p class="note bad" role="alert">{error}</p>
    {:else if phase === 'done' && !items.length && stopped}
      <p class="mono text-center">Stopped before any images were found.</p>
    {:else if phase === 'done' && !items.length}
      <div class="empty">
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect x="6" y="9" width="36" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 3" />
          <path d="M12 33l9-10 7 7 4-4 6 7" fill="none" stroke="var(--color-muted)" stroke-width="1.6" stroke-linejoin="round" />
          <circle cx="32" cy="18" r="3" fill="var(--color-sun)" />
        </svg>
        <h3 class="text-3xl">No <em>images</em> in this PDF</h3>
        <p class="text-soft max-w-[48ch]">Text and vector drawings (charts, logos made of shapes) aren't stored as images. To save whole pages as pictures, use <a href="/pdf-to-jpg" class="underline">PDF to JPG</a>.</p>
      </div>
    {/if}

    {#if items.length}
      <div class="bar">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex gap-1">
            <button type="button" class="link mono" onclick={() => selectAll(true)}>Select all</button>
            <span class="mono" aria-hidden="true">/</span>
            <button type="button" class="link mono" onclick={() => selectAll(false)}>none</button>
          </div>
          {#if tinyCount}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={hideTiny} />
              <span>Hide tiny images <span class="mono">({tinyCount} under {TINY} px)</span></span>
            </label>
          {/if}
        </div>
        <button type="button" class="btn btn-primary" disabled={!chosen.length || busy || zipping} onclick={downloadChosen}>
          {zipping ? 'Zipping…' : chosen.length > 1 ? `Download ${chosen.length} as .zip` : chosen.length ? 'Download image' : 'Select images'}
          {#if chosen.length && !zipping}<span class="size">{formatBytes(chosenBytes)}</span>{/if}
        </button>
      </div>

      <ul class="gallery" aria-label="Images found">
        {#each visible as item, i (item.id)}
          <li class="tile" class:off={!item.selected} style:--d={`${(i % 12) * 30}ms`}>
            <button type="button" class="frame" onclick={() => show(item)} disabled={!item.url} aria-label={`Preview ${item.name}`}>
              {#if item.url}
                <img src={item.url} alt={`Image from page ${item.pages[0] + 1}, ${item.width} by ${item.height} pixels`} loading="lazy" decoding="async" />
              {:else if item.status === 'pending'}
                <span class="mono working">decoding…</span>
              {:else if item.status === 'skipped'}
                <span class="mono px-3 text-center">{item.encoding} image not decoded (stopped)</span>
              {:else}
                <span class="mono px-3 text-center">{item.encoding} image couldn't be decoded</span>
              {/if}
            </button>
            <label class="pick">
              <input type="checkbox" bind:checked={item.selected} disabled={item.status !== 'ready'} aria-label={`Select ${item.name}`} />
            </label>
            <div class="meta">
              <div class="min-w-0">
                <p class="text-sm">{item.width} × {item.height}</p>
                <p class="mono truncate" title={item.note}>{item.kind} · {pagesLabel(item.pages)}{item.color === 'CMYK' ? ' · CMYK' : ''}</p>
              </div>
              {#if item.blob}
                <button type="button" class="btn dl" onclick={() => downloadBlob(item.blob!, item.name)} aria-label={`Download ${item.name}`}>↓</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if hideTiny && tinyCount && !visible.length}
        <p class="mono text-center">All {tinyCount} images are tiny (icons or spacers). Untick “Hide tiny images” to see them.</p>
      {/if}
    {/if}
  </div>
{/if}

<dialog bind:this={dialog} class="viewer" onclose={() => (preview = null)} onclick={(e) => e.target === dialog && dialog.close()}>
  {#if preview}
    <img src={preview.url} alt={`Image from page ${preview.pages[0] + 1}`} />
    <div class="viewer-bar">
      <div class="min-w-0">
        <p class="truncate text-sm">{preview.name}</p>
        <p class="mono">
          {preview.width} × {preview.height} · {preview.color} · stored as {preview.encoding} · saved as {preview.kind}{preview.blob ? ` · ${formatBytes(preview.blob.size)}` : ''}
          · {preview.pages.length === 1 ? 'page' : 'pages'} {formatPageRanges(preview.pages)}
        </p>
        {#if preview.note}<p class="mono text-sun">{preview.note}</p>{/if}
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn btn-primary py-2!" onclick={() => preview?.blob && downloadBlob(preview.blob, preview.name)}>Download</button>
        <button type="button" class="btn py-2!" onclick={() => dialog?.close()} aria-label="Close preview">✕</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
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
    background: var(--color-sun);
    transition: transform 0.3s ease-out;
    &.indeterminate {
      width: 30%;
      animation: slide 1.2s ease-in-out infinite;
    }
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  .note.bad {
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b12;
    color: var(--color-bad);
    font-size: 14px;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 48px 20px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .link {
    background: none;
    border: 0;
    padding: 2px;
    cursor: pointer;
    color: var(--color-soft);
    text-decoration: underline;
    text-underline-offset: 3px;
    &:hover {
      color: var(--color-chalk);
    }
  }
  .size {
    font: 400 12px var(--font-mono);
    opacity: 0.6;
  }
  .gallery {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .tile {
    position: relative;
    display: grid;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
    overflow: hidden;
    transition: border-color 0.2s, opacity 0.2s;
    animation: pop 0.45s var(--ease-spring) both;
    animation-delay: var(--d);
    &:has(.pick input:checked) {
      border-color: #ffd25e99;
    }
    &.off .frame img {
      opacity: 0.45;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
  }
  .frame {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    padding: 10px;
    border: 0;
    cursor: zoom-in;
    color: var(--color-muted);
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 14px 14px;
    &:disabled {
      cursor: default;
    }
    & img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      image-rendering: auto;
      transition: opacity 0.2s, transform 0.3s var(--ease-spring);
    }
    &:hover img {
      transform: scale(1.03);
    }
  }
  .pick {
    position: absolute;
    top: 6px;
    left: 6px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: #131211cc;
    cursor: pointer;
    & input {
      width: 16px;
      height: 16px;
      accent-color: var(--color-sun);
      cursor: pointer;
    }
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-top: 1px solid var(--color-line);
  }
  .dl {
    margin-left: auto;
    flex: none;
    padding: 6px 10px;
    font-size: 14px;
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
  .viewer {
    margin: auto;
    width: min(960px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    padding: 0;
    color: var(--color-chalk);
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    overflow: hidden;
    &::backdrop {
      background: #0b0a09d9;
    }
    &[open] {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      animation: pop 0.3s var(--ease-spring);
    }
    & > img {
      width: 100%;
      height: 100%;
      max-height: calc(100dvh - 160px);
      object-fit: contain;
      background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    }
  }
  .viewer-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-top: 1px solid var(--color-line);
  }
</style>
