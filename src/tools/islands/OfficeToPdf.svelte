<!--
  Word, Excel or PowerPoint → PDF, on the device. The file is laid out by the browser (render.ts) in an
  off-screen stage, then painted into a PDF with real text (dom-pdf.ts). The preview shows the PDF itself.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { getThumbnail, isAbort, openPdf, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes, withExtension } from '@/tools/lib/files';
  import { FORMATS, readError, type OfficeFormat } from '@/tools/lib/office/formats';
  import type { SheetOptions } from '@/tools/lib/office/render';
  import { toolSucceeded } from '@/tools/lib/success';

  let { from = 'word' }: { from?: OfficeFormat } = $props();
  const format = $derived(FORMATS[from]);

  type Status = 'idle' | 'loading' | 'rendering' | 'painting' | 'done' | 'error';
  let status = $state<Status>('idle');
  let file = $state.raw<File | null>(null);
  let error = $state('');
  let done = $state(0);
  let total = $state(0);
  let result = $state.raw<{ blob: Blob; pages: number; pictured: number } | null>(null);
  let thumbs = $state<string[]>([]);
  let sheetNames = $state<string[]>([]);
  let stage = $state<HTMLDivElement>();
  let sheet = $state<SheetOptions>({ paper: 'letter', orientation: 'auto', fitWidth: true, gridlines: false, sheets: [] });
  let ctl: AbortController | undefined;
  let preview: PdfDoc | undefined;
  let dispose: (() => void) | undefined;
  // a remembered engine: once loaded it's cached by the browser, so later files skip the notice
  let loaded = false;

  const busy = $derived(status === 'loading' || status === 'rendering' || status === 'painting');

  function clearStage() {
    dispose?.();
    dispose = undefined;
    stage?.replaceChildren();
  }

  async function convert(f: File) {
    ctl?.abort();
    const job = (ctl = new AbortController());
    clearStage();
    void preview?.destroy();
    preview = undefined;
    file = f;
    result = null;
    thumbs = [];
    error = '';
    done = total = 0;
    status = loaded ? 'rendering' : 'loading';
    try {
      const data = await f.arrayBuffer();
      const problem = readError(from, new Uint8Array(data, 0, Math.min(8, data.byteLength)), f.name);
      if (problem) throw new Error(problem);
      const render = await import('@/tools/lib/office/render');
      const { paintPdf } = await import('@/tools/lib/office/dom-pdf');
      loaded = true;
      if (job.signal.aborted) return;
      status = 'rendering';
      let pages;
      if (from === 'word') pages = await render.renderDocx(data, stage!);
      else if (from === 'excel') {
        const wb = await render.readWorkbook(data);
        sheetNames = render.printableSheets(wb).map((s) => s.name);
        if (!sheetNames.length) throw new Error('This workbook has no cells with anything in them to print.');
        pages = await render.renderXlsx(wb, stage!, { ...sheet, sheets: sheet.sheets?.filter((s) => sheetNames.includes(s)) });
      } else {
        const r = await render.renderPptx(data, stage!);
        dispose = r.dispose;
        pages = r.pages;
      }
      if (job.signal.aborted) return;
      if (!pages.length) throw new Error(`There's nothing to convert in this ${format.noun}.`);
      status = 'painting';
      const out = await paintPdf(pages, { signal: job.signal, title: f.name.replace(/\.[^.]+$/, ''), onPage: (d, t) => job === ctl && ((done = d), (total = t)) });
      if (job.signal.aborted) return;
      result = { blob: new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), pages: out.pages, pictured: out.pictured };
      status = 'done';
      toolSucceeded();
      void showPreview(out.bytes, job);
    } catch (e) {
      if (job.signal.aborted || isAbort(e)) return;
      console.error(e);
      // our own messages are plain Errors; a RangeError or TypeError from a library means nothing to people
      const own = e instanceof Error && e.name === 'Error' && !/^[A-Z][a-z]+Error\b/.test(e.message) && e.message.length < 220;
      error = own ? (e as Error).message : format.broken;
      status = 'error';
    } finally {
      if (job === ctl) clearStage();
    }
  }

  async function showPreview(bytes: Uint8Array, job: AbortController) {
    try {
      const doc = await openPdf(bytes);
      if (job !== ctl) return void doc.destroy();
      preview = doc;
      const list: string[] = [];
      for (let i = 0; i < Math.min(doc.numPages, 6); i++) {
        list.push((await getThumbnail(doc, i, { width: Math.round(220 * devicePixelRatio) })).url);
        if (job === ctl) thumbs = [...list];
      }
    } catch (e) {
      if (!isAbort(e)) console.warn('preview', e);
    }
  }

  function reset() {
    ctl?.abort();
    clearStage();
    void preview?.destroy();
    preview = undefined;
    file = null;
    result = null;
    thumbs = [];
    status = 'idle';
    error = '';
  }

  // Excel settings change the layout: convert again
  let first = true;
  $effect(() => {
    void [sheet.paper, sheet.orientation, sheet.fitWidth, sheet.gridlines, sheet.sheets?.length];
    if (first) return void (first = false);
    untrack(() => from === 'excel' && file && !busy && void convert(file));
  });

  $effect(() => () => {
    ctl?.abort();
    clearStage();
    void preview?.destroy();
  });

  const outName = $derived(file ? withExtension(file.name, 'pdf') : 'document.pdf');
</script>

{#if !file}
  <Dropzone accept={format.accept} title={`Drop a ${format.label} file`} hint={`${format.extensions} · or click to choose`} onfiles={(f) => convert(f[0])} />
  <p class="mono mt-3 text-center leading-relaxed">
    Converted on your device. The first file loads the {format.label} reader once (about {format.downloadMb} MB); nothing is uploaded.
  </p>
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="file">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm">{file.name}</p>
          <p class="mono">
            {#if status === 'loading'}<span class="text-sun">loading the {format.label} reader · one-time {format.downloadMb} MB download…</span>
            {:else if status === 'rendering'}<span class="text-sun">laying out the {format.pages}…</span>
            {:else if status === 'painting'}<span class="text-sun">writing the PDF · {format.page} {Math.min(done + 1, total)} of {total}…</span>
            {:else if result}{result.pages} PDF page{result.pages === 1 ? '' : 's'} · {formatBytes(result.blob.size)}
            {:else}{formatBytes(file.size)}{/if}
          </p>
          {#if busy}
            <div class="track" role="progressbar" aria-label="Converting" aria-valuemin="0" aria-valuemax={total || 1} aria-valuenow={done}>
              <span class="fill" class:indeterminate={status !== 'painting'} style:transform={status === 'painting' ? `scaleX(${total ? done / total : 0})` : undefined}></span>
            </div>
          {/if}
        </div>
      </div>

      {#if error}
        <p class="note bad" role="alert">{error}</p>
      {/if}
      {#if result?.pictured}
        <p class="note">
          Some characters (for example Chinese, Arabic or emoji) aren't in the PDF fonts, so {result.pictured === 1 ? 'one word was' : `${result.pictured} words were`} drawn as small pictures: they look right but can't be selected. Most of the text is still real text.
        </p>
      {/if}

      {#if result}
        <ul class="sheets" aria-label="PDF preview">
          {#each thumbs as url, i (url)}
            <li><img src={url} alt={`Page ${i + 1} of the PDF`} /></li>
          {/each}
          {#if result.pages > thumbs.length && thumbs.length}
            <li class="more mono">+{result.pages - thumbs.length} more</li>
          {/if}
        </ul>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      {#if from === 'excel'}
        <fieldset class="grid gap-3" disabled={busy}>
          <legend class="label">Page setup</legend>
          <label class="grid gap-1 text-sm">
            Paper
            <select class="field py-2!" bind:value={sheet.paper}>
              <option value="letter">Letter (8.5 × 11 in)</option>
              <option value="a4">A4 (210 × 297 mm)</option>
            </select>
          </label>
          <label class="grid gap-1 text-sm">
            Orientation
            <select class="field py-2!" bind:value={sheet.orientation}>
              <option value="auto">Automatic (the sheet’s own, else landscape if wide)</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={sheet.fitWidth} class="mt-1" />
            <span>Fit all columns on one page<span class="mono block">shrinks wide sheets</span></span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={sheet.gridlines} class="mt-1" />
            <span>Print gridlines<span class="mono block">Excel leaves them off by default</span></span>
          </label>
          {#if sheetNames.length > 1}
            <div class="grid gap-1 text-sm">
              <span>Sheets</span>
              {#each sheetNames as name (name)}
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!sheet.sheets?.length || sheet.sheets.includes(name)}
                    onchange={(e) => {
                      const on = e.currentTarget.checked;
                      const now = sheet.sheets?.length ? sheet.sheets : sheetNames;
                      const next = on ? [...new Set([...now, name])] : now.filter((s) => s !== name);
                      if (next.length) sheet.sheets = next.length === sheetNames.length ? [] : next;
                      else e.currentTarget.checked = true;
                    }}
                  />
                  <span class="truncate">{name}</span>
                </label>
              {/each}
            </div>
          {/if}
        </fieldset>
      {/if}
      <div class="grid gap-2 border-t border-line pt-5">
        <button type="button" class="btn btn-primary" disabled={!result} onclick={() => result && downloadBlob(result.blob, outName)}>Download PDF</button>
        {#if busy}
          <button type="button" class="btn" onclick={reset}>Cancel</button>
        {:else}
          <button type="button" class="btn" onclick={reset}>Convert another file</button>
        {/if}
      </div>
    </aside>
  </div>
{/if}

<!-- the browser lays the pages out here, off screen, at full size -->
<div class="stage" bind:this={stage} aria-hidden="true"></div>

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
  .sheets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 14px;
    & li {
      animation: rise 0.35s ease-out both;
    }
    & img {
      display: block;
      width: 100%;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 8px 24px #0006;
    }
  }
  .more {
    display: grid;
    place-items: center;
    min-height: 120px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 6px;
  }
  .stage {
    position: fixed;
    top: 0;
    left: -40000px;
    pointer-events: none;
    background: #fff;
    color: #000;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
