<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { PDFDocument } from 'pdf-lib';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import PdfPageGrid from '@/components/tool/PdfPageGrid.svelte';
  import { assemblePdf, getPageSize, loadEditablePdf, loadPdfLib, openPdf, pageRefs, parsePageRanges, pdfName, PdfError, savePdf, type PageRef, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { blankPdf, blankSize } from '@/tools/lib/organize-pdf/blank';
  import { createHistory, record, redo as redoStep, undo as undoStep, type History } from '@/tools/lib/organize-pdf/history';
  import { arrangeWithin, duplicatePages, insertAfter, insertionIndex, interleaveHalves, oddThenEven, removePages, reversePages, rotatePages, samePages } from '@/tools/lib/organize-pdf/ops';

  type Mode = 'organize' | 'rotate' | 'delete';
  let { mode = 'organize' }: { mode?: Mode } = $props();

  const COPY = {
    organize: { drop: 'Drop a PDF to organize', hint: 'Drag pages to reorder. Click to select, Shift+click for a run of pages.', suffix: '-organized', save: 'Save PDF' },
    rotate: { drop: 'Drop a PDF to rotate', hint: 'Turn every page at once, or select some pages first. The ↻ on a page turns just that one.', suffix: '-rotated', save: 'Save rotated PDF' },
    delete: { drop: 'Drop a PDF to remove pages from', hint: 'Click the pages you want gone (or type their numbers), then delete them. Undo brings them back.', suffix: '-edited', save: 'Save PDF' },
  } as const;
  const copy = $derived(COPY[mode]);

  /* ---------- documents ---------- */

  // where each open doc's pages come from at save time: the dropped file, or a generated blank page
  interface Source {
    file?: File;
    password?: string;
    bytes?: Uint8Array;
  }
  const sources = new Map<string, Source>();
  const editable = new Map<string, Promise<{ doc: PDFDocument; decrypted: boolean }>>();
  const blanks = new Map<string, Promise<PdfDoc>>();
  const blankIds = new Set<string>();
  let seq = 0;
  // bumped by Start over, so async work that finishes afterwards is dropped
  let session = 0;

  let opened = $state.raw<PdfDoc[]>([]);
  let pages = $state.raw<PageRef[]>([]);
  let selected = $state.raw<string[]>([]);
  let history = $state.raw<History<PageRef[]>>(createHistory([]));
  let status = $state('');

  const loaded = $derived(opened.length > 0);
  const chosen = $derived(new Set(selected));
  const files = $derived(opened.filter((d) => pages.some((p) => p.doc === d)));
  // typed numbers mean the numbers under the thumbnails while those are unambiguous
  // (one file, no copies or blanks); otherwise they count positions in the current order
  const byPageNumber = $derived(pages.length > 0 && !blankIds.has(pages[0].doc.id) && pages.every((p) => p.doc === pages[0].doc) && new Set(pages.map((p) => p.pageIndex)).size === pages.length);
  const renumbered = $derived(!byPageNumber && pages.some((p, i) => p.pageIndex !== i || p.doc !== pages[0].doc));

  function onopen({ file, doc, password }: OpenedPdf) {
    sources.set(doc.id, { file, password });
    opened = [...opened, doc];
    const refs = pageRefs(doc);
    // the first file is the starting point; later ones are an undoable "add"
    if (opened.length === 1) {
      pages = refs;
      history = createHistory(refs);
    } else {
      pages = [...pages, ...refs];
      say(`Added ${plural(refs.length)} from ${file.name}.`);
    }
  }

  function blankDoc(width: number, height: number) {
    const key = `${width}x${height}`;
    let doc = blanks.get(key);
    if (!doc) {
      const s = session;
      doc = blankPdf(width, height).then(async (bytes) => {
        const d = await openPdf(new File([bytes as Uint8Array<ArrayBuffer>], 'Blank page.pdf', { type: 'application/pdf' }));
        if (s !== session) {
          void d.destroy();
          throw new Error('Started over.');
        }
        sources.set(d.id, { bytes });
        blankIds.add(d.id);
        return d;
      });
      const p = doc;
      p.catch(() => blanks.get(key) === p && blanks.delete(key));
      blanks.set(key, doc);
    }
    return doc;
  }

  function reset() {
    session++;
    clearTimeout(confirmTimer);
    confirming = false;
    for (const d of opened) void d.destroy();
    for (const d of blanks.values()) void d.then((x) => x.destroy(), () => {});
    sources.clear();
    editable.clear();
    blanks.clear();
    blankIds.clear();
    opened = [];
    pages = [];
    selected = [];
    history = createHistory([]);
    result = null;
    error = '';
    range = '';
    rangeError = '';
  }

  // Start over can't be undone, so unsaved edits take a second click to discard
  let confirming = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  function startOver() {
    clearTimeout(confirmTimer);
    if (confirming || !history.past.length || isSaved) return reset();
    confirming = true;
    say('Unsaved edits. Press again to discard them.');
    confirmTimer = setTimeout(() => (confirming = false), 4000);
  }

  /* ---------- undo / redo ---------- */

  // a drag fires many moves while the pointer is down: they merge into one step
  let pointerDown = false;
  let gestureOwnsTop = false;

  // every change, from the toolbar or from the grid itself, lands here
  $effect(() => {
    const next = pages;
    untrack(() => {
      const h = record(history, next, { merge: pointerDown && gestureOwnsTop, equal: samePages });
      if (h === history) return;
      gestureOwnsTop = pointerDown && h.past.length >= history.past.length;
      history = h;
    });
  });

  function travel(step: typeof undoStep, done: string) {
    const h = step(history);
    if (h === history) return;
    history = h;
    pages = h.present;
    const ids = new Set(pages.map((p) => p.id));
    selected = selected.filter((id) => ids.has(id));
    say(done);
  }
  const undo = () => travel(undoStep, 'Undone.');
  const redo = () => travel(redoStep, 'Redone.');

  onMount(() => {
    const down = () => {
      pointerDown = true;
      gestureOwnsTop = false;
    };
    // after the grid's own pointerup/cancel handlers have run
    const up = () => setTimeout(() => (pointerDown = false));
    const onkey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu?.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
        return;
      }
      if (!loaded || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (history.past.length && !isSaved) e.preventDefault();
    };
    const outside = (e: PointerEvent) => {
      if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
    };
    addEventListener('pointerdown', down, true);
    addEventListener('pointerdown', outside);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    addEventListener('keydown', onkey);
    addEventListener('beforeunload', leaving);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('pointerdown', outside);
      removeEventListener('pointerup', up, true);
      removeEventListener('pointercancel', up, true);
      removeEventListener('keydown', onkey);
      removeEventListener('beforeunload', leaving);
      reset();
    };
  });

  /* ---------- edits ---------- */

  const plural = (n: number, word = 'page') => `${n} ${word}${n === 1 ? '' : 's'}`;
  const target = $derived(selected.length ? `${selected.length} selected` : 'all');

  // a fresh message each time, so screen readers repeat identical ones
  function say(msg: string) {
    status = '';
    queueMicrotask(() => (status = msg));
  }

  function rotate(by: number) {
    const n = selected.length || pages.length;
    pages = rotatePages(pages, by, chosen);
    say(`Rotated ${plural(n)} ${by === 180 ? '180°' : by === 90 ? '90° clockwise' : '90° counterclockwise'}.`);
  }

  function removeSelected() {
    const n = selected.length;
    pages = removePages(pages, chosen);
    selected = [];
    say(`Deleted ${plural(n)}. ${plural(pages.length)} left.`);
  }

  function duplicate() {
    const n = selected.length;
    pages = duplicatePages(pages, chosen, (p) => ({ ...p, id: `${p.doc.id}:${p.pageIndex}#${++seq}` }));
    say(`Duplicated ${plural(n)}.`);
  }

  let addingBlank = $state(false);
  async function addBlank() {
    const s = session;
    addingBlank = true;
    try {
      // matches the page it follows, as that page will look once saved
      const near = pages[insertionIndex(pages, chosen)] ?? { doc: opened[0], pageIndex: 0, rotation: 0 };
      const { width, height } = blankSize(await getPageSize(near.doc, near.pageIndex), near.rotation);
      const doc = await blankDoc(width, height);
      if (s !== session) return;
      const at = insertionIndex(pages, chosen);
      pages = insertAfter(pages, at, [{ id: `${doc.id}:0#${++seq}`, doc, pageIndex: 0, rotation: 0 }]);
      say(`Inserted a blank page at position ${at + 2}.`);
    } catch (e) {
      if (s === session) error = (e as Error).message;
    } finally {
      addingBlank = false;
    }
  }

  let menu = $state<HTMLDetailsElement>();
  const arrangeScope = $derived(selected.length > 1 ? `${selected.length} selected pages` : 'all pages');
  function arrange(fn: (items: PageRef[]) => PageRef[], done: string) {
    pages = arrangeWithin(pages, chosen, fn);
    if (menu) menu.open = false;
    say(done);
  }

  let range = $state('');
  let rangeError = $state('');
  function selectRange(e: SubmitEvent) {
    e.preventDefault();
    try {
      const picked = new Set(parsePageRanges(range, byPageNumber ? pages[0].doc.numPages : pages.length, { unique: true }));
      const hits = pages.filter((p, i) => picked.has(byPageNumber ? p.pageIndex : i));
      if (!hits.length) throw new Error(picked.size === 1 ? 'That page was already deleted.' : 'Those pages were already deleted.');
      selected = hits.map((p) => p.id);
      rangeError = '';
      const gone = picked.size - hits.length;
      say(`${plural(hits.length)} ${mode === 'delete' ? 'marked' : 'selected'}.${gone ? ` ${plural(gone)} already deleted.` : ''}`);
    } catch (err) {
      rangeError = (err as Error).message;
    }
  }

  /* ---------- labels ---------- */

  const short = (name: string) => {
    const n = name.replace(/\.pdf$/i, '') || 'file';
    return n.length > 14 ? `${n.slice(0, 12)}…` : n;
  };
  const label = (p: PageRef) => (blankIds.has(p.doc.id) ? 'blank' : files.length > 1 ? `${short(p.doc.name)} · ${p.pageIndex + 1}` : `${p.pageIndex + 1}`);

  /* ---------- save ---------- */

  let saving = $state(false);
  let error = $state('');
  let result = $state.raw<{ blob: Blob; name: string; pages: PageRef[]; decrypted: boolean } | null>(null);
  const isSaved = $derived(!!result && samePages(result.pages, pages));

  function editableFor(id: string) {
    let p = editable.get(id);
    if (!p) {
      const src = sources.get(id)!;
      p = src.bytes ? loadPdfLib(src.bytes).then((doc) => ({ doc, decrypted: false })) : loadEditablePdf(src.file!, { password: src.password });
      p.catch(() => editable.delete(id));
      editable.set(id, p);
    }
    return p;
  }

  async function save() {
    if (!pages.length || saving) return;
    const snapshot = pages;
    const s = session;
    saving = true;
    error = '';
    try {
      const ids = [...new Set(snapshot.map((p) => p.doc.id))];
      const docs = new Map<string, PDFDocument>();
      let decrypted = false;
      // one at a time: big files are held in memory while pages are copied
      for (const id of ids) {
        const e = await editableFor(id).catch((err) => {
          // with several files, say which one couldn't be read
          const name = sources.get(id)?.file?.name;
          throw err instanceof PdfError && name && files.length > 1 ? new PdfError(`${name}: ${err.message}`) : err;
        });
        docs.set(id, e.doc);
        decrypted ||= e.decrypted;
      }
      const out = await assemblePdf(snapshot, docs);
      if (s !== session) return;
      const main = snapshot.find((p) => !blankIds.has(p.doc.id))?.doc ?? opened[0];
      // keep the document's own title and author rather than leaving them blank
      const info = docs.get(main.id);
      const title = info?.getTitle();
      const author = info?.getAuthor();
      if (title) out.setTitle(title);
      if (author) out.setAuthor(author);
      const blob = await savePdf(out);
      if (s !== session) return;
      const name = pdfName(main.name || 'document.pdf', copy.suffix);
      result = { blob, name, pages: snapshot, decrypted };
      downloadBlob(blob, name);
    } catch (e) {
      if (s === session) error = e instanceof PdfError ? e.message : `Saving didn't work: ${(e as Error)?.message ?? e}`;
    } finally {
      saving = false;
    }
  }
</script>

{#snippet rotateGroup()}
  <div class="group" role="group" aria-label="Rotate {target} pages">
    <span class="mono glabel">Rotate {target}</span>
    <div class="row">
      <button type="button" class="btn tb" disabled={!pages.length} onclick={() => rotate(-90)} title="Rotate 90° counterclockwise">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5V7h3.5" /><path d="M3.4 7A5 5 0 1 1 4 10.5" /></svg>
        <span class="sr-only">90° counterclockwise</span><span aria-hidden="true">90°</span>
      </button>
      <button type="button" class="btn tb" disabled={!pages.length} onclick={() => rotate(90)} title="Rotate 90° clockwise">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3.5V7H9.5" /><path d="M12.6 7A5 5 0 1 0 12 10.5" /></svg>
        <span class="sr-only">90° clockwise</span><span aria-hidden="true">90°</span>
      </button>
      <button type="button" class="btn tb" disabled={!pages.length} onclick={() => rotate(180)} title="Rotate 180°">180°</button>
    </div>
  </div>
{/snippet}

{#snippet pagesGroup()}
  <div class="group" role="group" aria-label="Pages">
    <span class="mono glabel">{selected.length ? `${selected.length} selected` : 'Pages'}</span>
    <div class="row">
      <button type="button" class="btn tb" class:danger={mode === 'delete'} disabled={!selected.length} onclick={removeSelected}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
        Delete{selected.length ? ` ${selected.length}` : ''}
      </button>
      {#if mode !== 'delete'}
        <button type="button" class="btn tb" disabled={!selected.length} onclick={duplicate}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="7.5" height="8.5" rx="1.5" /><path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2h5" /></svg>
          Duplicate
        </button>
        <button type="button" class="btn tb" disabled={addingBlank} onclick={addBlank} title="Insert a blank page after the last selected page, or at the end">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5l3 3v9H4z" /><path d="M8 7.5v4M6 9.5h4" /></svg>
          Blank page
        </button>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet arrangeMenu()}
  <div class="group">
    <span class="mono glabel">Arrange</span>
    <details class="menu" bind:this={menu}>
      <summary class="btn tb">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5" /></svg>
        Order <span class="caret" aria-hidden="true">▾</span>
      </summary>
      <div class="menu-list">
        <p class="mono px-3 pt-1 pb-2">Applies to {arrangeScope}</p>
        <button type="button" onclick={() => arrange(reversePages, 'Reversed the page order.')}>
          Reverse order<small>last page first</small>
        </button>
        <button type="button" onclick={() => arrange(oddThenEven, 'Odd pages first, then even.')}>
          Odd pages, then even<small>1, 3, 5… then 2, 4, 6…</small>
        </button>
        <button type="button" onclick={() => arrange((p) => interleaveHalves(p, true), 'Interleaved the two halves, second half reversed.')}>
          Fix a duplex scan<small>fronts first, then backs last-to-first</small>
        </button>
        <button type="button" onclick={() => arrange((p) => interleaveHalves(p, false), 'Interleaved the two halves.')}>
          Interleave halves<small>fronts first, then backs in order</small>
        </button>
      </div>
    </details>
  </div>
{/snippet}

{#snippet rangeForm()}
  <form class="group range" onsubmit={selectRange}>
    <label class="mono glabel" for="organize-range">{mode === 'delete' ? 'Pages to delete' : 'Select pages'}</label>
    <div class="row">
      <input
        id="organize-range"
        class="field"
        bind:value={range}
        oninput={() => (rangeError = '')}
        placeholder="e.g. 2, 5-7, last"
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!rangeError}
        aria-describedby="organize-range-note"
      />
      <button type="submit" class="btn tb" disabled={!range.trim()}>{mode === 'delete' ? 'Mark' : 'Select'}</button>
    </div>
  </form>
{/snippet}

<div class="organizer">
  <div class="head" class:loaded>
    {#if loaded}
      <p class="files">
        <span class="font-medium text-chalk">{files[0]?.name ?? opened[0].name}</span>
        {#if files.length > 1}<span class="mono"> + {plural(files.length - 1, 'more file')}</span>{/if}
        <span class="mono"> · {plural(pages.length)}</span>
      </p>
    {/if}
    <PdfDrop multiple compact={loaded} title={loaded ? 'Add PDF' : copy.drop} hint="or click to choose · nothing is uploaded" {onopen} />
    {#if loaded}
      <div class="history">
        <button type="button" class="btn icon" onclick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" aria-label="Undo" aria-keyshortcuts="Control+Z">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3 2.5 6l3 3" /><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H7" /></svg>
        </button>
        <button type="button" class="btn icon" onclick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3l3 3-3 3" /><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h3" /></svg>
        </button>
        <button type="button" class="btn tb" class:danger={confirming} onclick={startOver} onblur={() => (confirming = false)}>
          {confirming ? 'Discard edits?' : 'Start over'}
        </button>
      </div>
    {/if}
  </div>

  {#if loaded}
    <div class="toolbar">
      {#if mode === 'rotate'}
        {@render rotateGroup()}
        {@render pagesGroup()}
        {@render arrangeMenu()}
        {@render rangeForm()}
      {:else if mode === 'delete'}
        {@render rangeForm()}
        {@render pagesGroup()}
        {@render rotateGroup()}
      {:else}
        {@render rotateGroup()}
        {@render pagesGroup()}
        {@render arrangeMenu()}
        {@render rangeForm()}
      {/if}
    </div>
    <p id="organize-range-note" class="mono note" class:err={rangeError} role={rangeError ? 'alert' : undefined}>
      {rangeError || (renumbered && range ? 'Numbers count pages in their current order.' : copy.hint)}
    </p>

    {#if pages.length}
      <PdfPageGrid
        bind:pages
        bind:selected
        selectable
        reorder
        rotate
        remove={mode !== 'rotate'}
        selectTone={mode === 'delete' ? 'bad' : 'sun'}
        {label}
        ariaLabel="Pages of the PDF"
      />
    {:else}
      <div class="empty">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l8 8v28H14z" /><path d="M28 6v8h8" /><path d="M20 27h10" /></svg>
        <p class="font-serif text-[24px] text-chalk">No pages left</p>
        <p class="mono">Undo to bring them back, or add another PDF.</p>
        <button type="button" class="btn tb mt-2" onclick={undo} disabled={!history.past.length}>Undo</button>
      </div>
    {/if}

    <div class="savebar">
      <div class="min-w-0">
        {#if saving}
          <p class="mono" role="status"><span class="spinner" aria-hidden="true"></span> Building your PDF…</p>
        {:else if result && isSaved}
          <p class="text-sm done" role="status">
            <span class="tick" aria-hidden="true">✓</span>
            <span class="font-medium break-all">{result.name}</span>
            <span class="mono">· {formatBytes(result.blob.size)} · <button type="button" class="link" onclick={() => downloadBlob(result!.blob, result!.name)}>download again</button></span>
          </p>
          {#if result.decrypted}
            <p class="mono mt-1">The saved copy has no password. Add one with <a class="link" href="/protect-pdf">Protect PDF</a> if you need it.</p>
          {/if}
        {:else}
          <p class="mono">{plural(pages.length)}{files.length > 1 ? ` from ${plural(files.length, 'file')}` : ''}{history.past.length ? ' · unsaved changes' : ''}</p>
        {/if}
        {#if error}<p class="text-sm text-bad mt-1" role="alert">{error}</p>{/if}
      </div>
      <button type="button" class="btn btn-primary" disabled={!pages.length || saving} onclick={save}>
        {saving ? 'Saving…' : copy.save}
      </button>
    </div>
  {/if}
</div>

<p class="sr-only" aria-live="polite">{status}</p>

<style>
  .organizer {
    display: grid;
    gap: 14px;
  }
  .head {
    display: grid;
    gap: 10px;
    &.loaded {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 12px;
    }
  }
  /* the unlock prompt and error list from the compact Add PDF button take a full row */
  .head.loaded > :global(.prompt),
  .head.loaded > :global(.errors) {
    flex-basis: 100%;
  }
  .files {
    flex: 1 1 200px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history {
    display: flex;
    gap: 6px;
  }

  .btn svg {
    width: 16px;
    height: 16px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tb {
    padding: 9px 12px;
    font-size: 14px;
    gap: 6px;
  }
  .icon {
    padding: 9px;
  }
  .danger:not(:disabled) {
    border-color: #ff7a6b80;
    color: var(--color-bad);
    &:hover {
      border-color: var(--color-bad);
    }
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 22px;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #1a1917f2;
    backdrop-filter: blur(8px);
    /* above the save bar, so the Order menu can drop over it */
    z-index: 6;
  }
  /* keeps the tools in reach on long documents; phones get the space back */
  @media (min-width: 720px) {
    .toolbar {
      position: sticky;
      top: 10px;
    }
  }
  .group {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .glabel {
    font-size: 11.5px;
    letter-spacing: 0.02em;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .range {
    flex: 1 1 220px;
    & .row {
      flex-wrap: nowrap;
    }
    & .field {
      padding: 7px 12px;
      font-size: 14px;
      min-width: 0;
    }
  }
  .note {
    margin-top: -4px;
    &.err {
      color: var(--color-bad);
    }
  }

  .menu {
    position: relative;
    & summary {
      list-style: none;
      &::-webkit-details-marker {
        display: none;
      }
    }
    &[open] summary {
      border-color: var(--color-sun);
    }
    &[open] .caret {
      transform: rotate(180deg);
    }
  }
  .caret {
    font-size: 10px;
    transition: transform 0.2s;
  }
  .menu-list {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: max-content;
    max-width: min(300px, calc(100vw - 48px));
    padding: 6px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel);
    box-shadow: 0 18px 40px -12px #000d;
    animation: drop 0.18s ease-out;
    & button {
      display: grid;
      width: 100%;
      gap: 2px;
      padding: 9px 12px;
      text-align: left;
      font: 500 14px var(--font-sans);
      color: var(--color-chalk);
      background: none;
      border: 0;
      border-radius: 9px;
      cursor: pointer;
      &:hover,
      &:focus-visible {
        background: var(--color-panel-2);
      }
    }
    & small {
      font: 400 12px var(--font-mono);
      color: var(--color-muted);
    }
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 48px 16px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
    & svg {
      width: 48px;
      height: 48px;
      margin-bottom: 6px;
      fill: none;
      stroke: var(--color-muted);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
  }

  .savebar {
    position: sticky;
    bottom: 10px;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 12px 12px 12px 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #22211ef2;
    backdrop-filter: blur(8px);
    box-shadow: 0 12px 32px -14px #000c;
    & > div {
      flex: 1 1 220px;
    }
  }
  .done {
    animation: appear 0.3s ease-out;
  }
  .tick {
    display: inline-block;
    color: var(--color-ok);
    animation: pop 0.45s var(--ease-spring);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-soft);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    vertical-align: -1px;
    border-radius: 50%;
    border: 2px solid var(--color-line-2);
    border-top-color: var(--color-sun);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .done,
    .tick,
    .menu-list,
    .caret {
      animation: none;
      transition: none;
    }
    .spinner {
      animation-duration: 2.4s;
    }
  }
</style>
