<!--
  PDF → Word, Excel or PowerPoint, on the device. Pages are read with pdf.js into page models
  (office/model.ts): paragraphs, headings, lists, tables and pictures. Scanned pages can be read with
  OCR (the same Tesseract setup as OCR PDF); without it they come across as pictures.
-->
<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { canvasToBlob, formatPageRanges, isAbort, openPdf, renderPage } from '@/engines/pdf';
  import { downloadBlob, withExtension } from '@/tools/lib/files';
  import { allTables, assignHeadings, buildPage, pageGrid, type PageModel } from '@/tools/lib/office/model';
  import type { ReadPage } from '@/tools/lib/office/pdf-read';
  import type { OcrEngine } from '@/tools/lib/ocr/engine';
  import { toolSucceeded } from '@/tools/lib/success';
  import OcrSetup from './OcrSetup.svelte';

  type Target = 'word' | 'excel' | 'powerpoint';
  /** from: 'images' takes photos and scans (JPG, PNG, WebP), one page each, read with OCR */
  let { to = 'word', from = 'pdf' }: { to?: Target; from?: 'pdf' | 'images' } = $props();

  const EXT = { word: 'docx', excel: 'xlsx', powerpoint: 'pptx' } as const;
  const LABEL = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' } as const;

  interface Page {
    read: ReadPage;
    /** recognized by OCR (replaces the empty text layer) */
    ocr?: ReadPage['input'];
  }

  let pdf = $state.raw<OpenedPdf | null>(null);
  let pages = $state.raw<Page[]>([]);
  let reading = $state(false);
  let working = $state('');
  let progress = $state(0);
  let error = $state('');
  let engine = $state<OcrEngine | null>(null);
  let wantOcr = $state(false);
  let ocrDone = $state(false);
  /** OCR was stopped or failed: it waits for another click (the engine stays loaded) */
  let ocrPaused = $state(false);
  // Word
  let pageBreaks = $state(true);
  // Excel
  let mode = $state<'tables' | 'all'>('tables');
  // PowerPoint
  let dpi = $state(150);
  let notes = $state(true);
  let ctl: AbortController | undefined;

  const scanned = $derived(pages.flatMap((p, i) => (p.read.scanned && !p.ocr ? [i] : [])));
  const inputs = $derived(pages.map((p) => p.ocr ?? (p.read.scanned ? fullPagePicture(p.read.input) : p.read.input)));
  const models = $derived.by(() => {
    const m = inputs.map((input) => buildPage(input));
    assignHeadings(m);
    return m;
  });
  const counts = $derived({
    headings: models.flatMap((m) => m.blocks).filter((b) => b.kind === 'paragraph' && b.heading).length,
    tables: allTables(models).length,
    pictures: models.flatMap((m) => m.blocks).filter((b) => b.kind === 'picture').length,
  });
  const firstTable = $derived(allTables(models)[0]?.table);

  /** a scanned page without OCR: the whole page as one picture, so nothing is lost */
  function fullPagePicture(input: ReadPage['input']): ReadPage['input'] {
    return { ...input, items: [], pictures: [{ x0: 0, x1: input.width, top: -input.height, bottom: 0 }] };
  }

  async function open(opened: OpenedPdf) {
    reset();
    pdf = opened;
    reading = true;
    const job = (ctl = new AbortController());
    try {
      const { readPageInput } = await import('@/tools/lib/office/pdf-read');
      const out: Page[] = [];
      for (let i = 0; i < opened.doc.numPages; i++) {
        let read: ReadPage;
        try {
          read = await readPageInput(opened.doc, i);
        } catch (e) {
          if (job.signal.aborted) break;
          console.warn(`Page ${i + 1}:`, e);
          const size = await opened.doc.getPage(i).then((p) => p.getViewport({ scale: 1 }));
          read = { input: { width: size.width, height: size.height, items: [], pictures: [] }, scanned: true, view: [0, 0, size.width, size.height] };
        }
        // Stop keeps the pages read so far; another file replaces them
        if (job.signal.aborted) break;
        out.push({ read });
        progress = (i + 1) / opened.doc.numPages;
        if (i % 8 === 7) pages = [...out];
      }
      if (pdf === opened) pages = out;
    } catch (e) {
      if (!isAbort(e) && !job.signal.aborted) error = (e as Error)?.message || "This PDF couldn't be read.";
    } finally {
      if (ctl === job) reading = false;
    }
  }

  /** Photos → a PDF with one Letter-wide page per image, so they go the same way as scanned pages */
  async function openImages(files: File[]) {
    error = '';
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      for (const f of files) {
        const bitmap = await createImageBitmap(f);
        const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const img = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer()));
        canvas.width = 0;
        const width = 612;
        const height = (width * img.height) / img.width;
        out.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
      }
      const bytes = await out.save();
      const name = files.length === 1 ? files[0].name : 'images.pdf';
      await open({ file: new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' }), doc: await openPdf(bytes) });
      wantOcr = true;
    } catch (e) {
      console.error(e);
      error = "These images couldn't be opened. Try JPG or PNG files.";
    }
  }

  async function runOcr() {
    if (!pdf || !engine) return;
    const { doc } = pdf;
    const ocr = engine;
    const job = (ctl = new AbortController());
    const todo = [...scanned];
    working = 'Reading scanned pages';
    progress = 0;
    error = '';
    try {
      const [{ renderForOcr }, { ocrInput }] = await Promise.all([import('@/tools/lib/ocr/pdf'), import('@/tools/lib/office/pdf-read')]);
      for (const [n, i] of todo.entries()) {
        const { image, dpi: at } = await renderForOcr(doc, i, job.signal);
        const result = await ocr.recognize({ image, layout: true, params: { user_defined_dpi: String(at) }, onProgress: (f) => (progress = (n + f) / todo.length) }, job.signal);
        const page = pages[i];
        pages = pages.with(i, { ...page, ocr: ocrInput(result, at, page.read.input.width, page.read.input.height) });
      }
      ocrDone = true;
    } catch (e) {
      const err = toAiError(e);
      if (err.code !== 'aborted' && !isAbort(e)) error = err.message;
      // stopped or failed: wait for another click rather than starting over on its own
      if (pdf?.doc === doc) ocrPaused = true;
    } finally {
      if (ctl === job) working = '';
    }
  }

  // OCR starts as soon as the engine is ready
  $effect(() => {
    if (wantOcr && !ocrPaused && engine && scanned.length && !working && !ocrDone) void runOcr();
  });

  const pageText = (m: PageModel) =>
    m.blocks
      .flatMap((b) => (b.kind === 'paragraph' ? [b.runs.map((r) => r.text).join('')] : b.kind === 'table' ? b.rows.map((r) => r.map((c) => c.text).join('\t')) : []))
      .join('\n');

  async function build(): Promise<Blob> {
    const { doc, file } = pdf!;
    const title = file.name.replace(/\.pdf$/i, '');
    if (to === 'word') {
      const [{ cropPictures }, { buildDocx, docxBlob }] = await Promise.all([import('@/tools/lib/office/pdf-read'), import('@/tools/lib/office/docx')]);
      const pictures = [];
      for (const [i, m] of models.entries()) {
        progress = i / models.length;
        pictures.push(m.blocks.some((b) => b.kind === 'picture') ? await cropPictures(doc, i, inputs[i], { dpi: pages[i].read.scanned && !pages[i].ocr ? 150 : 200, signal: ctl?.signal }) : []);
      }
      return docxBlob(buildDocx(models, { pictures, title, pageBreaks }));
    }
    if (to === 'excel') {
      const { buildXlsx, guessDecimal, xlsxBlob } = await import('@/tools/lib/office/xlsx');
      const tables = allTables(models);
      const many = (page: number) => tables.filter((t) => t.page === page).length > 1;
      const sheets =
        mode === 'tables' && tables.length
          ? tables.map(({ page, table }, k) => ({ name: `Page ${page + 1}${many(page) ? ` table ${tables.slice(0, k + 1).filter((t) => t.page === page).length}` : ''}`, rows: table.rows, header: table.header }))
          : models.map((m, i) => ({ name: `Page ${i + 1}`, rows: pageGrid(inputs[i], m) })).filter((s) => s.rows.length);
      const decimal = guessDecimal(sheets.flatMap((s) => s.rows.flat().map((c) => (typeof c === 'string' ? c : c.text))));
      return xlsxBlob(await buildXlsx(sheets, { decimal, title }));
    }
    const { buildPptx } = await import('@/tools/lib/office/pptx');
    const slides = [];
    for (let i = 0; i < models.length; i++) {
      progress = i / models.length;
      const canvas = await renderPage(doc, i, { dpi, signal: ctl?.signal });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
      canvas.width = 0;
      slides.push({ width: inputs[i].width, height: inputs[i].height, image: { data: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' as const }, notes: notes ? pageText(models[i]) : undefined });
    }
    return buildPptx(slides, { title });
  }

  async function download() {
    if (!pdf) return;
    const job = (ctl = new AbortController());
    working = `Writing the ${LABEL[to]} file`;
    progress = 0;
    error = '';
    try {
      const blob = await build();
      if (job.signal.aborted) return;
      downloadBlob(blob, withExtension(pdf.file.name, EXT[to]));
      toolSucceeded();
    } catch (e) {
      if (isAbort(e) || job.signal.aborted) return;
      console.error(e);
      error = `The ${LABEL[to]} file couldn't be made${(e as Error)?.message ? ` (${(e as Error).message})` : ''}.`;
    } finally {
      if (ctl === job) working = '';
    }
  }

  function reset() {
    ctl?.abort();
    void pdf?.doc.destroy();
    pdf = null;
    pages = [];
    reading = false;
    working = '';
    error = '';
    wantOcr = false;
    ocrDone = false;
    ocrPaused = false;
  }

  $effect(() => () => {
    ctl?.abort();
    void pdf?.doc.destroy();
  });

  const total = $derived(pdf?.doc.numPages ?? 0);
  /** reading was stopped part way: only the pages read so far go into the file */
  const partial = $derived(!reading && pages.length > 0 && pages.length < total);
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const busy = $derived(reading || !!working);

  const scanNote = $derived.by(() => {
    const n = scanned.length;
    const one = n === 1;
    const what =
      from === 'images' ? `${one ? 'The picture needs' : `The ${n} pictures need`} text recognition (OCR) to become editable text.`
      : `${n === pages.length ? 'This PDF is scanned' : `${one ? 'Page' : 'Pages'} ${formatPageRanges(scanned)} ${one ? 'is a scan' : 'are scans'}`}: pictures of text, with nothing to copy.`;
    const without = to === 'excel' ? ` Without OCR ${one ? 'it adds' : 'they add'} nothing to the workbook.` : ` Without OCR ${one ? 'it goes' : 'they go'} in as ${one ? 'a picture' : 'pictures'}.`;
    return what + (wantOcr && !ocrPaused ? '' : without);
  });
</script>

{#if !pdf}
  {#if from === 'images'}
    <Dropzone accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple title="Drop photos or scans of text" hint={`JPG, PNG or WebP · one page each · becomes a .${EXT[to]}`} onfiles={openImages} />
    {#if error}<p class="note bad mt-3" role="alert">{error}</p>{/if}
  {:else}
    <PdfDrop title="Drop a PDF here" hint={`or click to choose · becomes a .${EXT[to]}, no upload`} onopen={open} />
  {/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="file">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{pdf.file.name}</p>
          <p class="mono" aria-live="polite">
            {#if reading}<span class="text-sun">reading page {Math.min(pages.length + 1, total)} of {total}…</span>
            {:else if working}<span class="text-sun">{working.toLowerCase()} · {Math.round(progress * 100)}%</span>
            {:else}{plural(total, 'page')} · {plural(counts.headings, 'heading')} · {plural(counts.tables, 'table')} · {plural(counts.pictures, 'picture')}{/if}
          </p>
          {#if busy}
            <div class="track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
              <span class="fill" style:transform={`scaleX(${progress})`}></span>
            </div>
          {/if}
        </div>
        {#if busy}<button type="button" class="btn px-3! py-2! text-sm!" onclick={() => ctl?.abort()}>Stop</button>{/if}
      </div>

      {#if error}<p class="note bad" role="alert">{error}</p>{/if}
      {#if partial}<p class="note">Stopped after page {pages.length} of {total}, so only those pages go into the file. Choose “Convert another PDF” to start over.</p>{/if}

      {#if !reading && scanned.length && to !== 'powerpoint'}
        <div class="note grid gap-3">
          <p>{scanNote}</p>
          {#if !wantOcr || ocrPaused}
            <div><button type="button" class="btn btn-ai py-2! text-sm!" onclick={() => ((wantOcr = true), (ocrPaused = false))}>Recognize the text (OCR)</button></div>
          {/if}
        </div>
      {/if}
      {#if wantOcr && scanned.length}
        <OcrSetup bind:engine locked={!!working} speed="3–8 seconds per page">
          <span></span>
        </OcrSetup>
      {/if}

      {#if to === 'excel' && firstTable && !reading}
        <div class="preview">
          <p class="mono mb-2">first table found · {firstTable.rows.length} rows</p>
          <div class="overflow-x-auto">
            <table>
              <tbody>
                {#each firstTable.rows.slice(0, 8) as row, r (r)}
                  <tr>{#each row as cell, c (c)}<td class:head={firstTable.header && r === 0}>{cell.text}</td>{/each}</tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid gap-3" disabled={busy}>
        <legend class="label">Settings</legend>
        {#if to === 'word'}
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={pageBreaks} class="mt-1" />
            <span>Keep page breaks<span class="mono block">each PDF page starts a new page</span></span>
          </label>
        {:else if to === 'excel'}
          <label class="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="tables" bind:group={mode} class="mt-1" />
            <span>Tables only<span class="mono block">one sheet per table found</span></span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="all" bind:group={mode} class="mt-1" />
            <span>All text<span class="mono block">one sheet per page, every line a row</span></span>
          </label>
          {#if mode === 'tables' && !counts.tables && !reading}<p class="mono text-sun">No tables found, so every line goes in, one sheet per page.</p>{/if}
        {:else}
          <label class="grid gap-1 text-sm">
            Slide sharpness
            <select class="field py-2!" bind:value={dpi}>
              <option value={110}>Standard (smaller file)</option>
              <option value={150}>Sharp</option>
              <option value={220}>Extra sharp (for big screens)</option>
            </select>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={notes} class="mt-1" />
            <span>Page text in speaker notes<span class="mono block">keeps the deck searchable</span></span>
          </label>
        {/if}
      </fieldset>
      <div class="grid gap-2 border-t border-line pt-5">
        <button type="button" class="btn btn-primary" disabled={busy || !pages.length} onclick={download}>Download .{EXT[to]}</button>
        <button type="button" class="btn" onclick={reset}>Convert another {from === 'images' ? 'picture' : 'PDF'}</button>
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
  .preview {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    & table {
      border-collapse: collapse;
      font-size: 13px;
    }
    & td {
      padding: 4px 10px;
      border: 1px solid var(--color-line);
      white-space: nowrap;
      &.head {
        font-weight: 600;
        color: var(--color-chalk);
      }
    }
  }
</style>
