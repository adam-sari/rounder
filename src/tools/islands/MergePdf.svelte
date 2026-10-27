<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import PdfPageGrid from '@/components/tool/PdfPageGrid.svelte';
  import PdfPasswordPrompt from '@/components/tool/PdfPasswordPrompt.svelte';
  import { getThumbnail, isAbort, openPdf, pageRefs, pdfName, PdfPasswordError, type PageRef, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { disposeHelper, imageAsPdf, mergePdfs, type Progress } from '@/tools/lib/merge-pdf/client';
  import { baseName, compareNames, groupByFile, outputFileName } from '@/tools/lib/merge-pdf/order';

  interface Source {
    key: string;
    file: File;
    kind: 'pdf' | 'image';
    status: 'opening' | 'locked' | 'ready';
    doc?: PdfDoc;
    /** images: the one-page PDF made from them */
    bytes?: Uint8Array;
    password?: string;
    thumb?: string;
  }

  const ACCEPT = 'application/pdf,.pdf,image/*,.heic,.heif,.avif,.webp';
  const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp|svg)$/i;
  // the same order PdfPageGrid uses for its per-file stripes, so cards and pages match
  const DOC_COLORS = ['--color-image', '--color-everyday', '--color-dev', '--color-ai', '--color-pdf', '--color-text', '--color-files'];

  let sources = $state<Source[]>([]);
  let pages = $state<PageRef[]>([]);
  let errors = $state<string[]>([]);
  let view = $state<'files' | 'pages'>('files');
  let name = $state('');
  let bookmarks = $state(true);
  let keepInfo = $state(true);
  let asking = $state<{ key: string; name: string; wrong: boolean; busy: boolean; resolve: (pw: string | null) => void } | null>(null);
  let progress = $state<Progress | null>(null);
  let mergeError = $state('');
  let result = $state<{ blob: Blob; name: string; pages: number; key: string } | null>(null);
  let message = $state('');
  let reduceMotion = $state(false);
  let over = $state(false);
  let picker = $state<HTMLInputElement>();
  let listEl = $state<HTMLOListElement>();
  let downloadBtn = $state<HTMLButtonElement>();
  let ctrl: AbortController | undefined;
  let nextKey = 0;
  const uid = $props.id();

  const ready = $derived(sources.filter((s) => s.status === 'ready'));
  const byDoc = $derived(new Map(ready.map((s) => [s.doc!.id, s])));
  const counts = $derived(pages.reduce((m, p) => m.set(p.doc.id, (m.get(p.doc.id) ?? 0) + 1), new Map<string, number>()));
  const docOrder = $derived([...new Set(pages.map((p) => p.doc.id))]);
  const used = $derived(ready.filter((s) => counts.has(s.doc!.id)));
  const opening = $derived(sources.length > ready.length);
  const firstFile = $derived((pages.length && byDoc.get(pages[0].doc.id)?.file.name) || sources[0]?.file.name || 'merged');
  const fallbackName = $derived(pdfName(firstFile, '-merged'));
  const fileName = $derived(outputFileName(name, fallbackName));
  const planKey = $derived(JSON.stringify([pages.map((p) => `${p.id}@${p.rotation}`), bookmarks, keepInfo, fileName]));
  const done = $derived(result && result.key === planKey ? result : null);
  const percent = $derived(
    !progress ? 0 : progress.stage === 'reading' ? (progress.done / progress.total) * 15 : progress.stage === 'copying' ? 15 + (progress.done / progress.total) * 77 : 94,
  );

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const shortName = (file: string) => {
    const n = baseName(file);
    return n.length > 14 ? `${n.slice(0, 12)}…` : n;
  };
  const extOf = (file: string) => (/\.([a-z0-9]{1,5})$/i.exec(file)?.[1] ?? 'image').toUpperCase();
  const colorOf = (s: Source) => {
    const i = s.doc ? docOrder.indexOf(s.doc.id) : -1;
    return i < 0 ? 'var(--color-line-2)' : `var(${DOC_COLORS[i % DOC_COLORS.length]})`;
  };

  function pageLabel(p: PageRef) {
    const s = byDoc.get(p.doc.id);
    const n = shortName(s?.file.name ?? '');
    if (s?.kind === 'image') return n;
    return docOrder.length > 1 ? `${n} · ${p.pageIndex + 1}` : `${p.pageIndex + 1}`;
  }

  onMount(() => {
    // animate:flip runs through the Web Animations API, which the global reduced-motion CSS doesn't reach
    reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // our own paste handler (not the Dropzone's): it keeps working once files are in, and reports unsupported ones
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) addFiles(Array.from(e.clipboardData.files));
    };
    addEventListener('paste', onPaste);
    return () => {
      removeEventListener('paste', onPaste);
      endDrag();
      ctrl?.abort();
      for (const s of sources) void s.doc?.destroy();
      disposeHelper();
    };
  });

  /* ---------- adding and opening files, one at a time so password prompts come in order ---------- */

  const queue: Source[] = [];
  let draining = false;
  /** what the Dropzone passed on from the drop being handled, see the wrapper's ondrop */
  let taken: File[] = [];

  function addFiles(files: File[]) {
    for (const file of files) {
      const kind = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : file.type.startsWith('image/') || IMAGE_EXT.test(file.name) ? 'image' : null;
      if (!kind) {
        errors.push(`${file.name} isn't a PDF or an image.`);
        continue;
      }
      sources.push({ key: `f${++nextKey}`, file, kind, status: 'opening' });
      queue.push(sources[sources.length - 1]); // the reactive proxy, not the plain object
    }
    if (!draining) void drain();
  }

  async function drain() {
    draining = true;
    let s: Source | undefined;
    while ((s = queue.shift())) if (sources.includes(s)) await open(s);
    draining = false;
  }

  async function open(s: Source) {
    try {
      let doc: PdfDoc | null;
      if (s.kind === 'pdf') doc = await unlock(s);
      else {
        s.bytes = await imageAsPdf(s.file);
        doc = await openPdf(new File([s.bytes as Uint8Array<ArrayBuffer>], s.file.name, { type: 'application/pdf' }));
      }
      if (!doc) return removeSource(s); // skipped at the password prompt
      if (!sources.includes(s)) return void doc.destroy(); // removed while opening
      s.doc = doc;
      s.status = 'ready';
      insertPages(s, pageRefs(doc));
      loadThumb(s);
    } catch (e) {
      if (!sources.includes(s)) return;
      errors.push(`${s.file.name}: ${(e as Error).message}`);
      removeSource(s);
    }
  }

  // asks until the password works or the file is skipped
  async function unlock(s: Source): Promise<PdfDoc | null> {
    try {
      return await openPdf(s.file);
    } catch (e) {
      if (!(e instanceof PdfPasswordError)) throw e;
    }
    s.status = 'locked';
    let wrong = false;
    try {
      for (;;) {
        const password = await new Promise<string | null>((resolve) => (asking = { key: s.key, name: s.file.name, wrong, busy: false, resolve }));
        if (password === null) return null;
        asking!.busy = true;
        try {
          const doc = await openPdf(s.file, { password });
          s.password = password;
          return doc;
        } catch (e) {
          if (!(e instanceof PdfPasswordError)) throw e;
          wrong = true;
        }
      }
    } finally {
      asking = null;
    }
  }

  function loadThumb(s: Source) {
    if (s.doc && !s.doc.destroyed) getThumbnail(s.doc, 0, { width: 120 }).then((t) => (s.thumb = t.url), () => {});
  }

  /** puts a file's pages back in its place: before the first page of any file listed after it */
  function insertPages(s: Source, refs: PageRef[]) {
    const later = new Set(sources.slice(sources.indexOf(s) + 1).map((x) => x.doc?.id));
    const at = pages.findIndex((p) => later.has(p.doc.id));
    pages = at < 0 ? [...pages, ...refs] : [...pages.slice(0, at), ...refs, ...pages.slice(at)];
  }

  function restorePages(s: Source) {
    pages = pages.filter((p) => p.doc !== s.doc);
    insertPages(s, pageRefs(s.doc!));
    message = `All pages of ${s.file.name} are back.`;
  }

  function removeSource(s: Source) {
    sources = sources.filter((x) => x !== s);
    if (s.doc) {
      pages = pages.filter((p) => p.doc !== s.doc);
      void s.doc.destroy();
    }
    if (asking?.key === s.key) asking.resolve(null);
  }

  function clearAll() {
    ctrl?.abort();
    for (const s of sources) removeSource(s);
    errors = [];
    result = null;
    mergeError = '';
    view = 'files';
  }

  /* ---------- file order: drag the handle, arrow keys on it, or the nudge buttons ---------- */

  function setOrder(next: Source[]) {
    sources = next;
    pages = groupByFile(pages, next.flatMap((s) => (s.doc ? [s.doc.id] : [])));
  }

  function moveSource(from: number, to: number, announce = true) {
    if (to < 0 || to >= sources.length || to === from) return;
    const next = [...sources];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    setOrder(next);
    if (announce) message = `${s.file.name} moved to position ${to + 1} of ${next.length}.`;
  }

  async function focusHandle(key: string) {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-key="${key}"] .handle`)?.focus();
  }

  function onHandleKey(e: KeyboardEvent, i: number) {
    const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: sources.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const key = sources[i].key;
    moveSource(i, Math.max(0, Math.min(sources.length - 1, to)));
    void focusHandle(key);
  }

  let dragKey = $state<string | null>(null);
  let dragFrom = -1;
  let dragPointer = -1;
  let dragY = 0;
  let scrollFrame = 0;

  function startDrag(e: PointerEvent, s: Source) {
    if (e.button !== 0 || dragKey) return;
    e.preventDefault();
    dragKey = s.key;
    dragPointer = e.pointerId;
    dragFrom = sources.indexOf(s);
    dragY = e.clientY;
    // on window, not the handle: the row moves in the DOM as it is dragged, which can drop pointer capture
    addEventListener('pointermove', onDragMove);
    addEventListener('pointerup', endDrag);
    addEventListener('pointercancel', endDrag);
    autoScroll();
  }

  function onDragMove(e: PointerEvent) {
    if (!dragKey || e.pointerId !== dragPointer) return;
    dragY = e.clientY;
    hitRow();
  }

  // the target slot is how many other rows have their middle above the pointer (layout positions, so flip transforms don't matter)
  function hitRow() {
    if (!dragKey || !listEl) return;
    const y = dragY - listEl.getBoundingClientRect().top;
    const from = sources.findIndex((s) => s.key === dragKey);
    let to = 0;
    for (const [i, row] of [...listEl.children].entries()) {
      const r = row as HTMLElement;
      if (i !== from && r.offsetTop + r.offsetHeight / 2 < y) to++;
    }
    moveSource(from, to, false);
  }

  function autoScroll() {
    cancelAnimationFrame(scrollFrame);
    if (!dragKey) return;
    const edge = 70;
    const v = dragY < edge ? -(edge - dragY) / 4 : dragY > innerHeight - edge ? (dragY - innerHeight + edge) / 4 : 0;
    if (v) {
      scrollBy(0, v);
      hitRow();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function endDrag(e?: PointerEvent) {
    if (!dragKey || (e && e.pointerId !== dragPointer)) return;
    cancelAnimationFrame(scrollFrame);
    removeEventListener('pointermove', onDragMove);
    removeEventListener('pointerup', endDrag);
    removeEventListener('pointercancel', endDrag);
    const to = sources.findIndex((s) => s.key === dragKey);
    if (to !== dragFrom && to >= 0) message = `${sources[to].file.name} moved to position ${to + 1} of ${sources.length}.`;
    dragKey = null;
  }

  function sortByName() {
    setOrder([...sources].sort((a, b) => compareNames(a.file.name, b.file.name)));
    message = 'Files sorted by name.';
  }

  /* ---------- merging ---------- */

  async function merge() {
    const plan = pages.map((p) => ({ source: p.doc.id, pageIndex: p.pageIndex, rotation: p.rotation }));
    const inputs = used.map((s) => ({
      id: s.doc!.id,
      name: s.file.name,
      file: s.kind === 'pdf' ? s.file : new Blob([s.bytes as Uint8Array<ArrayBuffer>]),
      password: s.password,
      pages: s.doc!.numPages,
    }));
    const firstPdf = pages.map((p) => byDoc.get(p.doc.id)).find((s) => s?.kind === 'pdf');
    const key = planKey;
    const out = fileName;
    ctrl = new AbortController();
    mergeError = '';
    result = null;
    progress = { stage: 'reading', done: 0, total: inputs.length, name: inputs[0].name };
    try {
      const blob = await mergePdfs(
        inputs,
        plan,
        {
          title: baseName(out),
          metadataFrom: keepInfo ? firstPdf?.doc!.id : undefined,
          bookmarks: bookmarks ? Object.fromEntries(used.map((s) => [s.doc!.id, baseName(s.file.name)])) : undefined,
        },
        (p) => (progress = p),
        ctrl.signal,
      );
      result = { blob, name: out, pages: plan.length, key };
      await tick();
      downloadBtn?.focus();
    } catch (e) {
      if (!isAbort(e)) mergeError = (e as Error).message;
    } finally {
      progress = null;
      ctrl = undefined;
    }
  }
</script>

<div
  class="merge"
  class:over
  role="region"
  aria-label="Merge PDF"
  ondragover={(e) => {
    if (!sources.length || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    over = true;
  }}
  ondragleave={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) over = false;
  }}
  ondrop={(e) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    over = false;
    if (e.defaultPrevented) {
      // the empty-state Dropzone already took this drop (and added files, so don't add them twice);
      // pass on what its filter skipped so unsupported files get a message instead of vanishing
      const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
      const seen = new Set(taken.map(key));
      addFiles(files.filter((f) => !seen.has(key(f))));
    } else if (sources.length) {
      e.preventDefault();
      addFiles(files);
    }
    taken = [];
  }}
>
  {#if !sources.length}
    <Dropzone
      accept={ACCEPT}
      multiple
      paste={false}
      title="Drop PDFs or images here"
      hint="PDF, JPG, PNG, WebP or HEIC · or click to choose · ⌘V to paste"
      onfiles={(files) => {
        taken = files;
        addFiles(files);
      }}
    />
  {:else}
    <div class="head">
      <div class="min-w-0">
        <p class="font-serif text-[28px] leading-none">{plural(sources.length, 'file')}</p>
        <p class="mono mt-1">{plural(pages.length, 'page')} in the merged PDF{opening ? ' · opening…' : ''}</p>
      </div>
      <div class="seg" role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'files'} onclick={() => (view = 'files')}>Files</button>
        <button type="button" aria-pressed={view === 'pages'} onclick={() => (view = 'pages')}>Pages</button>
      </div>
    </div>

    {#if asking}
      <div class="mb-4">
        <PdfPasswordPrompt fileName={asking.name} wrong={asking.wrong} busy={asking.busy} onsubmit={(pw) => asking?.resolve(pw)} oncancel={() => asking?.resolve(null)} />
      </div>
    {/if}

    {#if view === 'files'}
      <p id="{uid}-keys" class="sr-only">Drag the handle, or focus it and press the up and down arrow keys, to change the order.</p>
      <ol bind:this={listEl} class="files" class:dragging={!!dragKey} aria-label="Files, in merge order">
        {#each sources as s, i (s.key)}
          {@const count = s.doc ? (counts.get(s.doc.id) ?? 0) : 0}
          <li class="row" class:lifted={dragKey === s.key} class:empty={s.status === 'ready' && !count} data-key={s.key} animate:flip={{ duration: reduceMotion ? 0 : 220 }}>
            <button
              type="button"
              class="handle"
              aria-label="Move {s.file.name}, position {i + 1} of {sources.length}"
              aria-describedby="{uid}-keys"
              onpointerdown={(e) => startDrag(e, s)}
              onkeydown={(e) => onHandleKey(e, i)}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" /></svg>
            </button>
            <span class="order mono" aria-hidden="true">{i + 1}</span>
            <span class="thumb" style:--dot={colorOf(s)}>
              {#if s.thumb}
                <img src={s.thumb} alt="" onerror={() => ((s.thumb = undefined), loadThumb(s))} />
              {:else if s.status === 'locked'}
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
              {:else}
                <span class="sheet"></span>
              {/if}
            </span>
            <span class="info">
              <span class="file-name" title={s.file.name}>{s.file.name}</span>
              <span class="mono meta">
                {#if s.status === 'opening'}
                  Opening…
                {:else if s.status === 'locked'}
                  Waiting for the password
                {:else if s.kind === 'image'}
                  {extOf(s.file.name)} image · 1 page · {formatBytes(s.file.size)}
                {:else}
                  PDF · {count === s.doc!.numPages ? plural(count, 'page') : `${count} of ${plural(s.doc!.numPages, 'page')}`} · {formatBytes(s.file.size)}{s.password ? ' · unlocked' : ''}
                {/if}
              </span>
            </span>
            {#if s.status === 'ready' && count < s.doc!.numPages}
              <button type="button" class="link mono" onclick={() => restorePages(s)}>{count ? 'Restore pages' : 'Add pages back'}</button>
            {/if}
            <span class="ctrl">
              <button type="button" tabindex="-1" class="nudge" aria-label="Move up" disabled={i === 0} onclick={() => moveSource(i, i - 1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
              </button>
              <button type="button" tabindex="-1" class="nudge" aria-label="Move down" disabled={i === sources.length - 1} onclick={() => moveSource(i, i + 1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
              </button>
              <button type="button" class="nudge del" aria-label="Remove {s.file.name}"
                onclick={() => {
                  // keep keyboard focus in the list instead of losing it with the removed row
                  const next = sources[i + 1] ?? sources[i - 1];
                  removeSource(s);
                  if (next) void focusHandle(next.key);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
              </button>
            </span>
          </li>
        {/each}
      </ol>
    {:else if pages.length}
      <p class="mono mb-3">Drag pages to reorder · hover a page to rotate or remove it · double-click for a closer look</p>
      <PdfPageGrid bind:pages reorder rotate remove size={128} label={pageLabel} ariaLabel="Pages, in merge order" />
    {:else}
      <p class="empty-pages mono">Every page has been removed. Switch to Files to add them back.</p>
    {/if}

    <div class="tools">
      <button type="button" class="btn add" onclick={() => picker?.click()}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        Add files
      </button>
      {#if view === 'files' && sources.length > 1}
        <button type="button" class="btn" onclick={sortByName}>Sort A–Z</button>
      {/if}
      <button type="button" class="btn ml-auto" onclick={clearAll}>Start over</button>
      <input bind:this={picker} type="file" accept={ACCEPT} multiple hidden onchange={(e) => (addFiles(Array.from(e.currentTarget.files ?? [])), (e.currentTarget.value = ''))} />
    </div>

    <div class="options">
      <label class="block min-w-0">
        <span class="label">file name</span>
        <input class="field" bind:value={name} placeholder={fallbackName} spellcheck="false" autocomplete="off" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={bookmarks} />
        <span>Bookmark each file<span class="mono block">jump to where every file starts</span></span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={keepInfo} />
        <span>Keep the first PDF's details<span class="mono block">title, author and creation date</span></span>
      </label>
    </div>

    {#if progress}
      <div class="progress" role="status">
        <div class="track" class:saving={progress.stage === 'saving'}><span style:width="{percent}%"></span></div>
        <div class="flex items-center justify-between gap-3">
          <span class="mono min-w-0 truncate">
            {#if progress.stage === 'reading'}
              Reading {progress.name} ({progress.done + 1} of {progress.total})
            {:else if progress.stage === 'copying'}
              Copying pages · {progress.done} of {progress.total}
            {:else}
              Writing the PDF…
            {/if}
          </span>
          <button type="button" class="btn cancel" onclick={() => ctrl?.abort()}>Cancel</button>
        </div>
      </div>
    {:else if done}
      <div class="result" role="status">
        <span class="stack" aria-hidden="true"><i></i><i></i><i></i></span>
        <div class="min-w-0 flex-1">
          <p class="font-serif text-[26px] leading-tight">Merged, all in one</p>
          <p class="mono break-all">{done.name} · {plural(done.pages, 'page')} · {formatBytes(done.blob.size)}</p>
        </div>
        <button type="button" class="btn btn-primary" bind:this={downloadBtn} onclick={() => downloadBlob(done.blob, done.name)}>Download PDF</button>
      </div>
    {:else}
      <div class="go">
        <button type="button" class="btn btn-primary" disabled={!pages.length || opening} onclick={merge}>
          {used.length > 1 ? `Merge ${used.length} files` : 'Save as PDF'}
        </button>
        <span class="mono">
          {#if opening}
            Waiting for files to open…
          {:else if used.length === 1}
            Add another file to merge it with this one.
          {:else}
            {plural(pages.length, 'page')} · nothing leaves your device
          {/if}
        </span>
      </div>
    {/if}
    {#if mergeError}
      <p class="error" role="alert">{mergeError}</p>
    {/if}
  {/if}

  {#if errors.length}
    <div class="errors" role="alert">
      <ul>
        {#each errors as msg, i (i)}
          <li>{msg}</li>
        {/each}
      </ul>
      <button type="button" class="mono link" onclick={() => (errors = [])}>Dismiss</button>
    </div>
  {/if}

  <p class="sr-only" aria-live="polite">{message}</p>
</div>

<style>
  .merge {
    position: relative;
    border-radius: 18px;
    outline: 1.5px dashed transparent;
    outline-offset: 6px;
    transition: outline-color 0.2s;
    &.over {
      outline-color: var(--color-sun);
    }
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  /* ---------- file list ---------- */
  .files {
    position: relative; /* rows' offsetParent, for hitRow() */
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .dragging {
    cursor: grabbing;
    user-select: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 68px;
    padding: 8px 10px 8px 4px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    transition: border-color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-spring), opacity 0.2s;
    &.lifted {
      border-color: var(--color-sun);
      box-shadow: 0 14px 30px -12px #000c, 0 0 0 1px var(--color-sun);
      transform: scale(1.015);
      position: relative;
      z-index: 1;
    }
    &.empty {
      opacity: 0.55;
    }
  }
  .handle {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 48px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--color-muted);
    cursor: grab;
    touch-action: none;
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.6;
      stroke-linecap: round;
    }
    &:hover {
      color: var(--color-chalk);
      background: #f2ede40d;
    }
  }
  .dragging .handle {
    cursor: grabbing;
  }
  .order {
    flex: none;
    width: 18px;
    text-align: right;
    font-size: 12px;
  }
  .thumb {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 52px;
    color: var(--color-muted);
    &::after {
      /* the file's color, as on its pages in the page view */
      content: '';
      position: absolute;
      left: -2px;
      bottom: -2px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--dot);
      box-shadow: 0 0 0 2px var(--color-panel-2);
    }
    & img {
      max-width: 100%;
      max-height: 100%;
      border-radius: 2px;
      background: #fff;
      box-shadow: 0 1px 2px #0006, 0 4px 10px -4px #000a;
      animation: arrive 0.35s ease-out;
    }
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
    }
  }
  .sheet {
    height: 100%;
    aspect-ratio: 1 / 1.414;
    border-radius: 2px;
    background: linear-gradient(100deg, #2a2926 30%, #34332f 50%, #2a2926 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .file-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 15px;
  }
  .meta {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ctrl {
    flex: none;
    display: flex;
    gap: 2px;
  }
  .nudge {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    & svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      border-color: var(--color-line-2);
    }
    &.del:hover {
      color: var(--color-bad);
      border-color: #ff7a6b55;
    }
    &:disabled {
      opacity: 0.3;
      cursor: default;
    }
  }
  .link {
    flex: none;
    background: none;
    border: 0;
    padding: 4px 6px;
    border-radius: 6px;
    color: var(--color-sun);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @media (max-width: 560px) {
    .order,
    .nudge:not(.del) {
      display: none;
    }
    .row {
      flex-wrap: wrap;
      row-gap: 0;
    }
    .row .link {
      order: 5;
      margin-left: 86px;
    }
  }

  .empty-pages {
    padding: 40px 16px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 16px;
  }

  /* ---------- tools, options, action ---------- */
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
    & .btn {
      padding: 10px 14px;
      font-size: 14px;
    }
  }
  .add {
    border-style: dashed;
  }
  .options {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) 1fr 1fr;
    align-items: end;
    gap: 16px 20px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--color-line);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    padding-bottom: 4px;
    & input {
      margin-top: 4px;
      accent-color: var(--color-sun);
    }
  }
  @media (max-width: 760px) {
    .options {
      grid-template-columns: 1fr;
    }
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    margin-top: 20px;
  }

  .progress {
    display: grid;
    gap: 10px;
    margin-top: 20px;
  }
  .track {
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-sun);
      transition: width 0.25s ease-out;
    }
    &.saving span {
      background: linear-gradient(90deg, var(--color-sun) 30%, #fff3c9 50%, var(--color-sun) 70%) 0 0 / 300% 100%;
      animation: shimmer 1.2s linear infinite;
    }
  }
  .cancel {
    flex: none;
    padding: 8px 12px;
    font-size: 13px;
  }

  .result {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 18px;
    margin-top: 20px;
    padding: 18px 20px;
    border-radius: 16px;
    border: 1px solid #9be58f55;
    background: linear-gradient(120deg, #9be58f12, transparent 60%), var(--color-panel-2);
    animation: arrive 0.4s var(--ease-spring);
  }
  /* three sheets that drop onto one pile */
  .stack {
    position: relative;
    flex: none;
    width: 46px;
    height: 54px;
    & i {
      position: absolute;
      inset: 4px 6px 0 4px;
      border-radius: 3px;
      background: #fff;
      box-shadow: 0 1px 2px #0006;
      animation: settle 0.6s var(--ease-spring) backwards;
    }
    & i:nth-child(1) {
      background: var(--color-pdf);
      transform: translate(6px, -4px) rotate(6deg);
      animation-delay: 0.05s;
    }
    & i:nth-child(2) {
      background: #f7e7c9;
      transform: translate(3px, -2px) rotate(-3deg);
      animation-delay: 0.12s;
    }
    & i:nth-child(3) {
      animation-delay: 0.19s;
      background: repeating-linear-gradient(#fff 0 6px, #e8e3da 6px 7px) 6px 10px / calc(100% - 12px) 60% no-repeat, #fff;
    }
  }
  @keyframes settle {
    from {
      opacity: 0;
      translate: 0 -18px;
    }
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }

  .error,
  .errors {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b12;
    color: var(--color-bad);
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .errors {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    & ul {
      flex: 1;
      min-width: 0;
    }
    & .link {
      color: var(--color-soft);
    }
  }
</style>
