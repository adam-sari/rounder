<script lang="ts">
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { formatPageRanges, getThumbnail, isAbort, pdfName, type PdfDoc } from '@/engines/pdf';
  import { downloadResult } from '@/tools/lib/files';
  import { pageToText, stats, toMarkdown, toText } from '@/tools/lib/pdf-text/format';
  import type { PageResult } from '@/tools/lib/pdf-text/read';

  let pdf = $state<{ file: File; doc: PdfDoc } | null>(null);
  // replaced wholesale (throttled) while reading, never mutated: no deep proxy over big text
  let pages = $state.raw<PageResult[]>([]);
  let reading = $state(false);
  let error = $state('');
  let view = $state<'all' | 'page'>('all');
  let markers = $state(true);
  let join = $state(false);
  let current = $state(0);
  let thumb = $state<string>();
  let ctrl: AbortController | undefined;

  async function open({ file, doc }: OpenedPdf) {
    reset();
    pdf = { file, doc };
    reading = true;
    const job = (ctrl = new AbortController());
    const buffer: PageResult[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    try {
      const { readAll } = await import('@/tools/lib/pdf-text/read');
      await readAll(
        doc,
        (_, result) => {
          buffer.push(result);
          flush ??= setTimeout(() => {
            flush = undefined;
            if (!job.signal.aborted) pages = buffer.slice();
          }, 250);
        },
        job.signal,
      );
      pages = buffer;
    } catch (e) {
      // stopped: keep the pages read so far (a reset has already moved on)
      if (job.signal.aborted || isAbort(e)) {
        if (ctrl === job) pages = buffer.slice();
        return;
      }
      console.error(e);
      error = (e as Error)?.message || "This PDF's text couldn't be read.";
    } finally {
      clearTimeout(flush);
      if (ctrl === job) reading = false;
    }
  }

  function stop() {
    ctrl?.abort();
    reading = false;
  }

  function reset() {
    ctrl?.abort();
    ctrl = undefined;
    void pdf?.doc.destroy();
    pdf = null;
    pages = [];
    reading = false;
    error = '';
    current = 0;
    thumb = undefined;
  }

  $effect(() => () => {
    ctrl?.abort();
    void pdf?.doc.destroy();
  });

  const total = $derived(pdf?.doc.numPages ?? 0);
  const texts = $derived(pages.map((p) => p.paragraphs));
  const output = $derived(toText(texts, { markers, join }));
  // counted without the page markers, which would add two "words" per page
  const counts = $derived(stats(markers ? toText(texts, { markers: false, join }) : output));
  const scanned = $derived(pages.flatMap((p, i) => (p.scanned ? [i] : [])));
  const failed = $derived(pages.flatMap((p, i) => (p.failed ? [i] : [])));
  const withText = $derived(pages.filter((p) => p.paragraphs).length);
  const allScanned = $derived(!reading && pages.length > 0 && withText === 0 && scanned.length > 0);
  const page = $derived(pages[current]);
  const pageText = $derived(page ? pageToText(page.paragraphs, join) : '');

  // the page preview beside its text in page-by-page view
  $effect(() => {
    if (view !== 'page' || !pdf || !page) return;
    const ctrl = new AbortController();
    getThumbnail(pdf.doc, current, { width: Math.round(200 * devicePixelRatio), signal: ctrl.signal })
      .then((t) => (thumb = t.url))
      .catch((e) => !isAbort(e) && (thumb = undefined));
    return () => ctrl.abort();
  });

  function go(index: number) {
    if (Number.isNaN(index)) return;
    current = Math.max(0, Math.min(pages.length - 1, index));
  }

  function download(kind: 'txt' | 'md') {
    if (!pdf) return;
    const title = pdf.file.name.replace(/\.pdf$/i, '');
    const body = kind === 'txt' ? output : toMarkdown(texts, { markers, title });
    downloadResult(new Blob([body], { type: kind === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8' }), pdfName(pdf.file.name, '', kind));
  }

  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
</script>

{#if !pdf}
  <PdfDrop title="Drop a PDF here" hint="or click to choose · reads the text, no upload" onopen={open} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="file">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{pdf.file.name}</p>
          <p class="mono">
            {#if reading}
              <span class="text-sun">reading page {Math.min(pages.length + 1, total)} of {total}…</span>
            {:else}
              {plural(total, 'page')}{#if pages.length < total} · stopped after {pages.length}{/if} · {plural(counts.words, 'word')}
            {/if}
          </p>
          {#if reading}
            <div class="track" role="progressbar" aria-label="Reading the PDF" aria-valuemin="0" aria-valuemax={total} aria-valuenow={pages.length}>
              <span class="fill" style:transform={`scaleX(${total ? pages.length / total : 0})`}></span>
            </div>
          {/if}
        </div>
        {#if reading}
          <button type="button" class="btn px-3! py-2! text-sm!" onclick={stop}>Stop</button>
        {/if}
      </div>

      {#if error}
        <p class="note bad" role="alert">{error}</p>
      {/if}

      {#if allScanned}
        <div class="empty">
          <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
            <rect x="9" y="5" width="30" height="38" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M15 14h18M15 20h12M15 26h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="2 3" />
            <path d="M3 34h42" stroke="var(--color-sun)" stroke-width="1.8" stroke-linecap="round" class="scanline" />
          </svg>
          <h3 class="text-3xl">This PDF looks <em>scanned</em></h3>
          <p class="text-soft max-w-[46ch]">Its pages are pictures of text with no text layer, so there's nothing to copy out yet. To read it, run it through <a href="/ocr-pdf">OCR PDF</a> first, which adds a searchable text layer.</p>
        </div>
      {:else}
        {#if scanned.length && !reading}
          <p class="note">
            {scanned.length === 1 ? 'Page' : 'Pages'} {formatPageRanges(scanned)} {scanned.length === 1 ? 'looks' : 'look'} scanned: no text layer, so {scanned.length === 1 ? 'it was' : 'they were'} skipped. <a href="/ocr-pdf">OCR PDF</a> can make them searchable.
          </p>
        {/if}
        {#if failed.length && !reading}
          <p class="note bad">{failed.length === 1 ? 'Page' : 'Pages'} {formatPageRanges(failed)} couldn't be read. The file may be partly damaged.</p>
        {/if}

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'all'} onclick={() => (view = 'all')}>Whole document</button>
            <button type="button" aria-pressed={view === 'page'} onclick={() => (view = 'page')}>Page by page</button>
          </div>
          {#if view === 'page' && pages.length}
            <div class="pager">
              <button type="button" class="btn px-3! py-2!" disabled={current === 0} onclick={() => go(current - 1)} aria-label="Previous page">‹</button>
              <label class="mono flex items-center gap-2">
                <span class="sr-only">Page number</span>
                <input
                  type="number"
                  class="field w-16! px-2! py-1.5! text-center"
                  min="1"
                  max={pages.length}
                  value={current + 1}
                  onchange={(e) => go(e.currentTarget.valueAsNumber - 1)}
                />
                of {pages.length}
              </label>
              <button type="button" class="btn px-3! py-2!" disabled={current >= pages.length - 1} onclick={() => go(current + 1)} aria-label="Next page">›</button>
            </div>
          {/if}
        </div>

        {#if view === 'all'}
          <label>
            <span class="sr-only">Extracted text</span>
            <textarea class="field output" readonly value={output} placeholder={reading ? 'Reading…' : 'No text found.'}></textarea>
          </label>
        {:else if page}
          <div class="page-view">
            <div class="sheet" aria-hidden="true">
              {#if thumb}<img src={thumb} alt="" onerror={() => (thumb = undefined)} />{/if}
            </div>
            <div class="grid min-w-0 content-start gap-2">
              {#if page.paragraphs}
                <label>
                  <span class="sr-only">Text of page {current + 1}</span>
                  <textarea class="field output short" readonly value={pageText}></textarea>
                </label>
                <div><CopyButton text={pageText} label={`Copy page ${current + 1}`} class="py-2! text-sm!" /></div>
              {:else}
                <p class="note">
                  {page.scanned ? 'This page looks scanned: it has no text layer. OCR PDF can read it.' : page.failed ? "This page couldn't be read." : 'This page has no text.'}
                </p>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <div class="grid gap-3">
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" bind:checked={markers} class="mt-1" />
          <span>Page markers<span class="mono block">a “Page 3” line between pages</span></span>
        </label>
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" bind:checked={join} class="mt-1" />
          <span>Join wrapped lines<span class="mono block">one line per paragraph, mends split words</span></span>
        </label>
      </div>
      <div class="grid gap-2 border-t border-line pt-5">
        {#if !reading && counts.words}
          <div class="total">
            <span class="font-serif text-5xl leading-none">{counts.words.toLocaleString()}</span>
            <span class="mono">words · {counts.chars.toLocaleString()} characters{withText < pages.length ? ` · text on ${withText} of ${pages.length} pages` : ''}</span>
          </div>
        {/if}
        <button type="button" class="btn btn-primary" disabled={reading || !counts.chars} onclick={() => download('txt')}>Download .txt</button>
        <button type="button" class="btn" disabled={reading || !counts.chars} onclick={() => download('md')}>Download .md</button>
        <CopyButton text={() => output} label="Copy all text" />
        <button type="button" class="btn" onclick={reset}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

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
  }
  .note {
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid #ffd25e40;
    background: #ffd25e0d;
    color: var(--color-soft);
    font-size: 14px;
    &.bad {
      border-color: #ff7a6b55;
      background: #ff7a6b12;
      color: var(--color-bad);
    }
  }
  .output {
    min-height: 440px;
    font-size: 13.5px;
    line-height: 1.6;
    tab-size: 4;
    white-space: pre-wrap;
    &.short {
      min-height: 320px;
    }
  }
  .pager {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .page-view {
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr);
  }
  .sheet {
    display: none;
    align-self: start;
    min-height: 200px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & img {
      display: block;
      width: 100%;
      animation: rise 0.35s ease-out both;
    }
  }
  @media (min-width: 640px) {
    .page-view {
      grid-template-columns: 160px minmax(0, 1fr);
    }
    .sheet {
      display: block;
    }
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 48px 20px;
    text-align: center;
    color: var(--color-chalk);
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .scanline {
    animation: scan 2.4s ease-in-out infinite alternate;
  }
  @keyframes scan {
    from {
      transform: translateY(-26px);
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
