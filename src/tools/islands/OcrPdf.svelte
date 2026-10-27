<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { formatPageRanges, getThumbnail, isAbort, loadEditablePdf, pdfName, savePdf, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import type { OcrEngine } from '@/tools/lib/ocr/engine';
  import { addTextLayers, documentText, hasRealText, renderForOcr } from '@/tools/lib/ocr/pdf';
  import { pageText } from '@/tools/lib/ocr/text';
  import { pageToText } from '@/tools/lib/pdf-text/format';
  import { readPage } from '@/tools/lib/pdf-text/read';
  import OcrSetup from './OcrSetup.svelte';

  type Status = 'checking' | 'has-text' | 'queued' | 'reading' | 'done' | 'failed';
  interface Page {
    status: Status;
    /** text it already had (pdf.js), or what OCR read */
    existing?: string;
    text?: string;
    /** Tesseract's invisible-text page, when it found any text */
    layer?: Uint8Array;
    progress: number;
  }

  // two pages at a time on roomy desktops; Tesseract is single-threaded per worker
  const lanes = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 2) >= 6 && !/Mobi|Android/i.test(navigator.userAgent) ? 2 : 1;

  let engine = $state<OcrEngine | null>(null);
  // PdfDoc is a class and the bytes are big: kept raw, never proxied
  let pdf = $state.raw<OpenedPdf | null>(null);
  let pages = $state<Page[]>([]);
  let force = $state(false);
  let running = $state(false);
  let building = $state(false);
  let error = $state('');
  let selected = $state(0);
  let thumb = $state<string>();
  let started = 0;
  let settled = 0;
  let eta = $state<number | null>(null);
  let ctl: AbortController | null = null;

  const checking = $derived(pages.some((p) => p.status === 'checking'));
  const withText = $derived(pages.flatMap((p, i) => (p.status === 'has-text' ? [i] : [])));
  const todo = $derived(pages.flatMap((p, i) => (p.status === 'queued' || p.status === 'reading' || (force && p.status === 'has-text') ? [i] : [])));
  const done = $derived(pages.filter((p) => p.status === 'done'));
  const failed = $derived(pages.flatMap((p, i) => (p.status === 'failed' ? [i] : [])));
  const blank = $derived(pages.flatMap((p, i) => (p.status === 'done' && !p.text ? [i] : [])));
  const reading = $derived(pages.filter((p) => p.status === 'reading'));
  const total = $derived(done.length + todo.length);
  const fraction = $derived(total ? (done.length + reading.reduce((s, p) => s + p.progress, 0)) / total : 0);
  const fullText = $derived(documentText(pages.map((p) => (p.status === 'done' ? p.text : p.existing))));
  const page = $derived(pages[selected]);

  async function open(opened: OpenedPdf) {
    reset();
    pdf = opened;
    pages = Array.from({ length: opened.doc.numPages }, () => ({ status: 'checking', progress: 0 }));
    for (let i = 0; i < opened.doc.numPages; i++) {
      let next: Page;
      try {
        const existing = pageToText((await readPage(opened.doc, i)).paragraphs, false);
        next = { status: hasRealText(existing) ? 'has-text' : 'queued', existing, progress: 0 };
      } catch {
        // unreadable text layer: let OCR have a go
        next = { status: 'queued', progress: 0 };
      }
      if (pdf !== opened) return;
      pages[i] = next;
    }
  }

  async function run() {
    if (!pdf || !engine) return;
    const doc = pdf.doc;
    const ocr = engine;
    const job = (ctl = new AbortController());
    const order = [...todo];
    running = true;
    error = '';
    started = performance.now();
    settled = 0;
    eta = null;
    let next = 0;
    // elapsed time per finished page already reflects the lanes running side by side
    const tick = () => {
      settled++;
      eta = Math.round((((performance.now() - started) / settled) * (order.length - settled)) / 1000);
    };
    const lane = async () => {
      while (next < order.length && !job.signal.aborted) {
        const i = order[next++];
        const p = pages[i];
        p.status = 'reading';
        p.progress = 0;
        try {
          const { image, dpi } = await renderForOcr(doc, i, job.signal);
          const result = await ocr.recognize({ image, pdf: true, params: { user_defined_dpi: String(dpi) }, onProgress: (f) => (p.progress = f) }, job.signal);
          const text = pageText(result);
          Object.assign(p, { status: 'done', text, layer: text && result.pdf ? new Uint8Array(result.pdf) : undefined, progress: 1 });
          tick();
        } catch (e) {
          const err = toAiError(e);
          if (err.code === 'aborted' || isAbort(e)) {
            p.status = p.existing && hasRealText(p.existing) ? 'has-text' : 'queued';
            p.progress = 0;
            if (!job.signal.aborted) job.abort(); // the engine went away: stop this run
            return;
          }
          console.error(e);
          p.status = 'failed';
          tick();
          if (err.code === 'out-of-memory') {
            error = 'Your device ran out of memory. Close other tabs and press Continue, or split the PDF into smaller parts.';
            job.abort();
          }
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, lane));
    if (ctl === job) {
      ctl = null;
      running = false;
    }
  }

  // `running` stays on until the lanes have unwound, so Continue can't start a run over pages still being read
  const stop = () => ctl?.abort();

  async function download() {
    if (!pdf) return;
    building = true;
    error = '';
    try {
      const { doc } = await loadEditablePdf(pdf.file, { password: pdf.password });
      const layers = new Map<number, Uint8Array>();
      pages.forEach((p, i) => p.status === 'done' && p.layer && layers.set(i, p.layer));
      await addTextLayers(doc, layers);
      downloadBlob(await savePdf(doc), pdfName(pdf.file.name, '-searchable'));
    } catch (e) {
      console.error(e);
      error = (e as Error)?.message || "The searchable PDF couldn't be made.";
    } finally {
      building = false;
    }
  }

  function reset() {
    stop();
    void pdf?.doc.destroy();
    pdf = null;
    pages = [];
    force = false;
    error = '';
    selected = 0;
    thumb = undefined;
  }

  $effect(() => () => {
    ctl?.abort();
    void pdf?.doc.destroy();
  });

  // the selected page's picture beside its text
  $effect(() => {
    const doc: PdfDoc | undefined = pdf?.doc;
    if (!doc || !pages.length) return;
    const c = new AbortController();
    getThumbnail(doc, selected, { width: Math.round(220 * devicePixelRatio), signal: c.signal })
      .then((t) => (thumb = t.url))
      .catch((e) => !isAbort(e) && (thumb = undefined));
    return () => c.abort();
  });

  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const minutes = (s: number) => (s < 60 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`);
  const label: Record<Status, string> = { checking: 'checking', 'has-text': 'already has text', queued: 'to read', reading: 'reading', done: 'read', failed: "couldn't read" };
  const pageLabel = (p: Page) => (p.status === 'done' && !p.text ? 'no text found' : label[p.status]);
</script>

<OcrSetup bind:engine workers={lanes} locked={running} speed="3–8 seconds per page">
  {#if !pdf}
    <PdfDrop title="Drop a scanned PDF here" hint="or click to choose · read on your device, no upload" onopen={open} />
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div class="grid min-w-0 content-start gap-4">
        <div class="file">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{pdf.file.name}</p>
            <p class="mono" aria-live="polite">
              {#if checking}checking which pages need OCR…
              {:else if running}
                <span class="text-ai">reading {plural(total, 'page')} · {Math.round(fraction * 100)}%</span>{#if eta !== null && eta > 0} · about {minutes(eta)} left{/if}
              {:else}
                {plural(pages.length, 'page')} · {formatBytes(pdf.file.size)}{#if done.length} · {done.length} read{/if}
              {/if}
            </p>
            {#if running}
              <div class="track" role="progressbar" aria-label="Reading the PDF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
                <span style:transform={`scaleX(${fraction})`}></span>
              </div>
            {/if}
          </div>
          {#if running}<button type="button" class="btn px-3! py-2! text-sm!" onclick={stop}>Stop</button>{/if}
        </div>

        {#if error}<p class="note bad" role="alert">{error}</p>{/if}

        <div class="pages" role="group" aria-label="Pages">
          {#each pages as p, i (i)}
            <button
              type="button"
              class={`sq ${p.status}`}
              class:empty={p.status === 'done' && !p.text}
              class:sel={selected === i}
              style:--p={p.progress}
              title={`Page ${i + 1}: ${pageLabel(p)}`}
              aria-label={`Page ${i + 1}: ${pageLabel(p)}`}
              aria-current={selected === i}
              onclick={() => (selected = i)}>{i + 1}</button
            >
          {/each}
        </div>
        <p class="mono legend">
          <span class="key queued"></span>to read <span class="key done"></span>read <span class="key has-text"></span>already has text
          {#if failed.length}<span class="key failed"></span>failed{/if}
        </p>

        {#if page}
          <div class="page-view">
            <div class="sheet" aria-hidden="true">{#if thumb}<img src={thumb} alt="" />{/if}</div>
            <div class="grid min-w-0 content-start gap-2">
              <p class="mono">Page {selected + 1} · {pageLabel(page)}</p>
              {#if page.status === 'done' || page.status === 'has-text'}
                {@const text = (page.status === 'done' ? page.text : page.existing) ?? ''}
                {#if text}
                  <label>
                    <span class="sr-only">Text of page {selected + 1}</span>
                    <textarea class="field output" dir="auto" readonly value={text}></textarea>
                  </label>
                  <div><CopyButton text={text} label={`Copy page ${selected + 1}`} class="py-2! text-sm!" /></div>
                {:else}
                  <p class="note">No text was found on this page. It may be a picture, blank, or in a language not picked above.</p>
                {/if}
              {:else if page.status === 'failed'}
                <p class="note bad">This page couldn't be read. It's left as it was.</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <aside class="grid content-start gap-5">
        {#if !checking}
          <div class="grid gap-2 text-sm">
            {#if withText.length}
              <p class="note">
                {withText.length === pages.length ? 'Every page' : `${withText.length === 1 ? 'Page' : 'Pages'} ${formatPageRanges(withText)}`} already {withText.length === 1 ? 'has' : 'have'} selectable text, so
                {withText.length === 1 ? 'it is' : 'they are'} left as {withText.length === 1 ? 'it is' : 'they are'}.
              </p>
              <label class="flex items-start gap-2">
                <input type="checkbox" bind:checked={force} disabled={running} class="accent mt-1" />
                <span>Read those pages too<span class="mono block">only if their text is garbled; they get a second text layer</span></span>
              </label>
            {/if}
          </div>
          <div class="grid gap-2 border-t border-line pt-5">
            {#if todo.length && !running}
              <button type="button" class="btn btn-ai" disabled={!engine} onclick={run}>
                {done.length ? `Continue: read ${plural(todo.length, 'page')}` : `Read ${plural(todo.length, 'page')}`}
              </button>
              {#if !engine}<p class="mono">waiting for the OCR engine (see above)</p>{/if}
            {/if}
            {#if !running && done.length}
              {#if todo.length}<p class="mono">{plural(todo.length, 'page')} still unread; the PDF keeps them as they are.</p>{/if}
              <button type="button" class="btn btn-primary" disabled={building} onclick={download}>{building ? 'Making the PDF…' : 'Download searchable PDF'}</button>
              <button type="button" class="btn" onclick={() => downloadBlob(new Blob([fullText], { type: 'text/plain;charset=utf-8' }), pdfName(pdf!.file.name, '', 'txt'))}>
                Download text (.txt)
              </button>
              <CopyButton text={() => fullText} label="Copy all text" />
              {#if blank.length}<p class="mono">No text found on {blank.length === 1 ? 'page' : 'pages'} {formatPageRanges(blank)}.</p>{/if}
              {#if pdf.password}<p class="mono">The searchable copy isn't password-protected.</p>{/if}
            {:else if !todo.length && !running && !done.length}
              <p class="note">This PDF is already searchable: every page has text you can select and search.</p>
            {/if}
            <button type="button" class="btn" onclick={reset}>Start over</button>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</OcrSetup>

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
    & span {
      display: block;
      height: 100%;
      background: var(--color-ai);
      transform-origin: left;
      transition: transform 0.25s ease-out;
    }
  }
  .pages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
    gap: 6px;
    max-height: 260px;
    overflow-y: auto;
    padding: 2px;
  }
  .sq {
    position: relative;
    height: 38px;
    border-radius: 8px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    font: 400 11.5px var(--font-mono);
    color: var(--color-soft);
    cursor: pointer;
    overflow: hidden;
    &.sel {
      outline: 2px solid var(--color-chalk);
      outline-offset: 1px;
    }
    &.has-text {
      border-style: dashed;
      color: var(--color-muted);
    }
    &.reading::before {
      content: '';
      position: absolute;
      inset: auto 0 0 0;
      height: calc(var(--p) * 100%);
      background: color-mix(in srgb, var(--color-ai) 30%, transparent);
      transition: height 0.2s ease-out;
    }
    &.reading {
      border-color: var(--color-ai);
      color: var(--color-chalk);
    }
    &.done {
      border-color: color-mix(in srgb, var(--color-ok) 55%, transparent);
      background: color-mix(in srgb, var(--color-ok) 12%, #141312);
      color: var(--color-chalk);
    }
    &.done.empty {
      border-color: var(--color-line-2);
      background: #141312;
    }
    &.failed {
      border-color: var(--color-bad);
      color: var(--color-bad);
    }
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .key {
    display: inline-block;
    width: 12px;
    height: 10px;
    border-radius: 3px;
    border: 1.5px solid var(--color-line-2);
    margin-left: 6px;
    &:first-child {
      margin-left: 0;
    }
    &.done {
      border-color: var(--color-ok);
      background: color-mix(in srgb, var(--color-ok) 25%, transparent);
    }
    &.has-text {
      border-style: dashed;
    }
    &.failed {
      border-color: var(--color-bad);
    }
  }
  .page-view {
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr);
    @media (min-width: 640px) {
      grid-template-columns: 180px minmax(0, 1fr);
    }
  }
  .sheet {
    display: none;
    @media (min-width: 640px) {
      display: block;
    }
    & img {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--color-line);
      background: #fff;
    }
  }
  .output {
    min-height: 260px;
    font-family: var(--font-sans);
    font-size: 14.5px;
    line-height: 1.55;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
    &.bad {
      border-color: var(--color-bad);
    }
  }
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .accent {
    accent-color: var(--color-ai);
  }
  @media (prefers-reduced-motion: reduce) {
    .sq.reading::before,
    .track span {
      transition: none;
    }
  }
</style>
