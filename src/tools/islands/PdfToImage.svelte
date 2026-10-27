<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import PdfPageGrid from '@/components/tool/PdfPageGrid.svelte';
  import { canvasToBlob, formatPageRanges, getPageSize, isAbort, pageRefs, parsePageRanges, pdfName, renderPage, type PageRef } from '@/engines/pdf';
  import { downloadResult, formatBytes } from '@/tools/lib/files';
  import { DESKTOP_LIMITS, IOS_LIMITS, pageImageName, planRender, type RenderPlan, type Sizing } from '@/tools/lib/pdf-to-jpg/render';
  import { zipBlobs } from '@/tools/lib/pdf-to-jpg/zip';

  type Format = 'jpeg' | 'png' | 'webp';
  let { format: initialFormat = 'jpeg' }: { format?: Format } = $props();

  const FORMATS: [Format, string, string, string][] = [
    ['jpeg', 'JPG', 'image/jpeg', 'jpg'],
    ['png', 'PNG', 'image/png', 'png'],
    ['webp', 'WebP', 'image/webp', 'webp'],
  ];
  const RESOLUTIONS = [
    [72, '72', 'screen size, smallest files'],
    [150, '150', 'sharp on screen, a good default'],
    [300, '300', 'print quality, large files'],
    ['custom', 'custom', 'any resolution from 36 to 1200 dpi'],
    ['width', 'by width', 'every page this many pixels wide'],
  ] as const;
  type Resolution = (typeof RESOLUTIONS)[number][0];

  let pdf = $state.raw<OpenedPdf | null>(null);
  let pages = $state<PageRef[]>([]);
  let selected = $state<string[]>([]);
  let pick = $state<'all' | 'some'>('all');
  let rangeText = $state('');
  let rangeError = $state('');

  let format = $state<Format>(untrack(() => initialFormat));
  let resolution = $state<Resolution>(150);
  let customDpi = $state(200);
  let width = $state(1600);
  let quality = $state(90);
  let transparent = $state(false);
  let limits = $state.raw(DESKTOP_LIMITS);

  interface Output {
    name: string;
    blob: Blob;
    width: number;
    height: number;
    page: number;
    plan: RenderPlan;
  }
  let progress = $state.raw<{ list: number[]; done: number; page: number } | null>(null);
  let result = $state.raw<{ key: string; files: Output[]; stopped: boolean } | null>(null);
  let error = $state('');
  let zipping = $state<number | null>(null);
  let ctrl: AbortController | undefined;

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || lo));
  const info = $derived(FORMATS.find((f) => f[0] === format)!);
  const lossy = $derived(format !== 'png');
  const sizing = $derived<Sizing>(
    resolution === 'width' ? { mode: 'width', width: clamp(width, 16, 16_384) } : { mode: 'dpi', dpi: resolution === 'custom' ? clamp(customDpi, 36, 1200) : resolution },
  );
  const chosen = $derived(new Set(selected));
  // pages stay in document order, so the selection does too
  const targets = $derived(pick === 'all' ? pages.map((p) => p.pageIndex) : pages.filter((p) => chosen.has(p.id)).map((p) => p.pageIndex));
  const background = $derived(transparent && format !== 'jpeg' ? 'transparent' : 'white');
  const jobKey = $derived(JSON.stringify([pdf?.doc.id, targets, format, sizing, lossy && quality, background]));

  onMount(() => {
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) limits = IOS_LIMITS;
    return () => {
      ctrl?.abort();
      void pdf?.doc.destroy();
    };
  });

  function open(next: OpenedPdf) {
    ctrl?.abort();
    void pdf?.doc.destroy();
    pdf = next;
    pages = pageRefs(next.doc);
    selected = [];
    rangeText = '';
    rangeError = '';
    result = null;
    error = '';
  }

  /* ---------- page choice: the range box and the thumbnails stay in sync ---------- */

  function parseRange(text: string) {
    return parsePageRanges(text, pages.length, { unique: true }).sort((a, b) => a - b);
  }

  function typed(text: string) {
    rangeText = text;
    if (!text.trim()) {
      rangeError = '';
      selected = [];
      return;
    }
    try {
      selected = parseRange(text).map((i) => pages[i].id);
      rangeError = '';
    } catch (e) {
      rangeError = (e as Error).message;
    }
  }

  $effect(() => {
    const indices = pages.filter((p) => chosen.has(p.id)).map((p) => p.pageIndex);
    untrack(() => {
      let current: number[] | null = null;
      try {
        current = rangeText.trim() ? parseRange(rangeText) : [];
      } catch {}
      if (current?.join() !== indices.join()) {
        rangeText = formatPageRanges(indices);
        rangeError = '';
      }
    });
  });

  /* ---------- size estimate for the first page ---------- */

  let estimate = $state<RenderPlan | null>(null);
  $effect(() => {
    const doc = pdf?.doc;
    const first = targets[0];
    const s = sizing;
    if (!doc || first === undefined) return void (estimate = null);
    let live = true;
    getPageSize(doc, first)
      .then((size) => live && (estimate = planRender(size.width, size.height, s, limits)))
      .catch(() => {});
    return () => (live = false);
  });

  $effect(() => {
    if (result && result.key !== jobKey) result = null;
  });

  /* ---------- convert ---------- */

  async function convert() {
    if (!pdf || !targets.length) return;
    const { doc, file } = pdf;
    const list = [...targets];
    const key = jobKey;
    const [fmt, , mime, ext] = info;
    const opts = { sizing, background, quality: lossy ? quality / 100 : undefined };
    const files: Output[] = [];
    ctrl = new AbortController();
    const { signal } = ctrl;
    error = '';
    result = null;
    progress = { list, done: 0, page: list[0] };
    try {
      for (const [k, i] of list.entries()) {
        progress = { list, done: k, page: i };
        const size = await getPageSize(doc, i);
        const plan = planRender(size.width, size.height, opts.sizing, limits);
        const canvas = await renderPage(doc, i, { scale: plan.scale, maxPixels: limits.maxPixels, background: opts.background, signal });
        const { width: w, height: h } = canvas;
        try {
          let blob = await canvasToBlob(canvas, mime, opts.quality);
          // Safari can't write WebP from a canvas; the image engine can
          if (blob.type !== mime) {
            const { encodeCanvas } = await import('@/engines/image/client');
            blob = await encodeCanvas(canvas, { format: fmt, quality });
          }
          files.push({ name: pageImageName(file.name, i, ext, list.length > 1 ? doc.numPages : 1), blob, width: w, height: h, page: i, plan });
        } finally {
          canvas.width = 0; // frees its pixels before the next page
        }
        if (signal.aborted) break;
      }
    } catch (e) {
      // after a cancel (or a new PDF), calls on the old document can fail in other ways
      if (!isAbort(e) && !signal.aborted) error = (e as Error).message || 'Something went wrong while converting.';
    }
    progress = null;
    if (files.length && pdf?.doc === doc) result = { key, files, stopped: files.length < list.length };
  }

  async function downloadAll() {
    if (!result || !pdf) return;
    const { files } = result;
    if (files.length === 1) return downloadResult(files[0].blob, files[0].name);
    zipping = 0;
    try {
      downloadResult(await zipBlobs(files, (n) => (zipping = n)), pdfName(pdf.file.name, `-${extOf(files[0])}`, 'zip'));
    } catch {
      error = "The zip couldn't be made. Try downloading the images one by one.";
    } finally {
      zipping = null;
    }
  }

  const total = $derived(result?.files.reduce((s, f) => s + f.blob.size, 0) ?? 0);
  const lowered = $derived(result?.files.filter((f) => f.plan.limited) ?? []);
  // pages finished in this run, or in the result on show
  const converted = $derived(new Set(progress ? progress.list.slice(0, progress.done) : result?.files.map((f) => f.page)));
  const extOf = (f: Output) => f.name.slice(f.name.lastIndexOf('.') + 1);
</script>

{#if !pdf}
  <PdfDrop onopen={open} title="Drop a PDF here" />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="filebar">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{pdf.file.name}</p>
          <p class="mono">{pages.length} page{pages.length === 1 ? '' : 's'} · {formatBytes(pdf.file.size)}</p>
        </div>
        <PdfDrop compact onopen={open} />
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div>
          <span class="label">pages to convert</span>
          <div class="seg" role="group" aria-label="Pages to convert">
            <button type="button" aria-pressed={pick === 'all'} disabled={!!progress} onclick={() => (pick = 'all')}>All pages</button>
            <button type="button" aria-pressed={pick === 'some'} disabled={!!progress} onclick={() => (pick = 'some')}>Choose pages</button>
          </div>
        </div>
        {#if pick === 'some'}
          <label class="min-w-[180px] flex-1">
            <span class="label">page numbers</span>
            <input class="field py-2!" value={rangeText} oninput={(e) => typed(e.currentTarget.value)} placeholder="e.g. 1-3, 5, 8-" disabled={!!progress} aria-invalid={!!rangeError} aria-describedby="range-hint" />
          </label>
        {/if}
      </div>
      {#if pick === 'some'}
        <p id="range-hint" class="mono" class:text-bad={!!rangeError} aria-live="polite">
          {rangeError || 'Type ranges, or click pages below. Shift-click selects a run of pages.'}
        </p>
      {/if}

      <!-- selection is locked while converting, or changing it would throw the finished images away -->
      <PdfPageGrid bind:pages bind:selected selectable={pick === 'some' && !progress} toolbar={pick === 'some'} size={130} ariaLabel="Pages of {pdf.file.name}">
        {#snippet overlay(page)}
          {#if progress?.page === page.pageIndex}
            <span class="badge now" aria-hidden="true"></span>
          {:else if converted.has(page.pageIndex)}
            <span class="badge done" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
            </span>
          {/if}
        {/snippet}
      </PdfPageGrid>
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid min-w-0 gap-5" disabled={!!progress}>
        <div>
          <span class="label">image format</span>
          <div class="seg" role="group" aria-label="Image format">
            {#each FORMATS as [value, label]}
              <button type="button" aria-pressed={format === value} onclick={() => (format = value)}>{label}</button>
            {/each}
          </div>
        </div>

        <div>
          <span class="label">{resolution === 'width' ? 'size' : 'resolution · dpi'}</span>
          <div class="seg" role="group" aria-label="Resolution">
            {#each RESOLUTIONS as [value, label]}
              <button type="button" aria-pressed={resolution === value} onclick={() => (resolution = value)}>{label}</button>
            {/each}
          </div>
          {#if resolution === 'custom'}
            <label class="mt-3 flex items-center gap-2">
              <input type="number" class="field w-24! py-2!" min="36" max="1200" step="1" bind:value={customDpi} aria-label="Dots per inch" />
              <span class="mono">dots per inch</span>
            </label>
          {:else if resolution === 'width'}
            <label class="mt-3 flex items-center gap-2">
              <input type="number" class="field w-28! py-2!" min="16" max="16384" step="10" bind:value={width} aria-label="Width in pixels" />
              <span class="mono">pixels wide</span>
            </label>
          {/if}
          <p class="mono mt-2">{RESOLUTIONS.find((r) => r[0] === resolution)?.[2]}</p>
        </div>

        {#if lossy}
          <label>
            <span class="label">quality · {quality}</span>
            <input type="range" min="40" max="100" bind:value={quality} class="w-full accent-(--color-sun)" />
            <span class="mono flex justify-between"><span>smaller</span><span>sharper</span></span>
          </label>
        {/if}

        {#if format !== 'jpeg'}
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={transparent} class="mt-1" />
            <span>Transparent background<span class="mono block">instead of white paper; most PDFs have a white page anyway</span></span>
          </label>
        {/if}

        {#if estimate}
          <p class="mono estimate">
            ≈ <span class="text-chalk">{estimate.width} × {estimate.height}</span> px{targets.length > 1 ? ` for page ${targets[0] + 1}` : ''}
            {#if resolution === 'width'}· {estimate.dpi} dpi{/if}
            {#if estimate.limited}
              <span class="block text-sun">Too big for your browser to draw, so this page will be made at {estimate.dpi} dpi instead.</span>
            {/if}
          </p>
        {/if}
      </fieldset>

      <div class="grid gap-3 border-t border-line pt-5">
        {#if progress}
          <div class="grid gap-2" role="status">
            <p class="mono">
              Page <span class="text-chalk">{progress.page + 1}</span> · {progress.done} of {progress.list.length} done
            </p>
            <div class="meter" role="progressbar" aria-label="Converting" aria-valuemin="0" aria-valuemax={progress.list.length} aria-valuenow={progress.done}>
              <span style:width="{(progress.done / progress.list.length) * 100}%"></span>
            </div>
            <button type="button" class="btn" onclick={() => ctrl?.abort()}>Cancel</button>
          </div>
        {:else if result}
          <div class="ready" role="status">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
            <div class="min-w-0">
              <p class="font-serif text-2xl leading-tight">
                {result.files.length} image{result.files.length === 1 ? '' : 's'} ready
              </p>
              <p class="mono">{formatBytes(total)}{result.stopped ? ' · stopped early' : ''}</p>
            </div>
          </div>
          {#if lowered.length}
            <p class="mono text-sun">
              {lowered.length === 1 ? `Page ${lowered[0].page + 1} was` : `${lowered.length} pages were`} too large to draw at full size, so {lowered.length === 1 ? 'it was' : 'they were'} made at {Math.min(...lowered.map((f) => f.plan.dpi))} dpi{lowered.length > 1 ? ' or more' : ''}.
            </p>
          {/if}
          <button type="button" class="btn btn-primary" disabled={zipping !== null} onclick={downloadAll}>
            {#if zipping !== null}
              Zipping… {zipping}/{result.files.length}
            {:else if result.files.length === 1}
              Download {extOf(result.files[0]).toUpperCase()}
            {:else}
              Download all as .zip
            {/if}
          </button>
          {#if result.files.length > 1}
            <details class="files">
              <summary class="mono">or one by one</summary>
              <ul>
                {#each result.files as f (f.page)}
                  <li>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm">{f.name}</span>
                      <span class="mono">{f.width}×{f.height} · {formatBytes(f.blob.size)}</span>
                    </span>
                    <button type="button" class="btn px-3! py-2!" onclick={() => downloadResult(f.blob, f.name)} aria-label="Download {f.name}">↓</button>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        {:else}
          <button type="button" class="btn btn-primary" disabled={!targets.length || (pick === 'some' && !!rangeError)} onclick={convert}>
            {targets.length ? `Convert ${targets.length} page${targets.length === 1 ? '' : 's'} to ${info[1]}` : 'Choose pages to convert'}
          </button>
        {/if}
        {#if error}<p class="mono text-bad" role="alert">{error}</p>{/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .filebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  fieldset:disabled {
    opacity: 0.6;
  }
  .estimate {
    line-height: 1.6;
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.25s ease-out;
    }
  }
  .ready {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    flex: none;
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 66;
      animation: draw 0.5s ease-out both;
    }
    & path {
      stroke-width: 2;
      stroke-dasharray: 16;
      animation: draw 0.35s 0.35s ease-out both;
    }
  }
  @keyframes draw {
    from { stroke-dashoffset: var(--len, 66); }
    to { stroke-dashoffset: 0; }
  }
  .tick path {
    --len: 16;
  }
  .files {
    & summary {
      cursor: pointer;
      width: fit-content;
    }
    & ul {
      display: grid;
      gap: 6px;
      margin-top: 10px;
      max-height: 320px;
      overflow-y: auto;
    }
    & li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 6px 6px 10px;
      border: 1px solid var(--color-line);
      border-radius: 12px;
    }
  }
  .badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }
  .badge.done {
    background: var(--color-ok);
    animation: pop 0.35s var(--ease-spring);
    & svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.4;
    }
  }
  .badge.now {
    border: 2px solid var(--color-line-2);
    border-top-color: var(--color-sun);
    animation: spin 0.8s linear infinite;
  }
  @keyframes pop {
    from { transform: scale(0.4); opacity: 0; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
