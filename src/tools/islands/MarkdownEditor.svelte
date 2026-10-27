<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { DOMPurify } from 'dompurify';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import {
    applyEdit,
    continueList,
    cycleHeading,
    insertLink,
    insertTable,
    toggleCode,
    toggleInline,
    toggleLines,
    type Edit,
  } from '@/tools/lib/markdown-editor/format';
  import { buildMap, mapScroll, type ScrollMap } from '@/tools/lib/markdown-editor/sync';
  import { countWords, docTitle, fileBase, standaloneHtml } from '@/tools/lib/markdown-editor/export';

  const SAMPLE = `# Welcome to the Markdown editor

Write here and the formatted preview updates as you type. Your draft **saves automatically** in this browser.

## What you can use

- **Bold**, *italic*, ~~strikethrough~~ and \`inline code\`
- [Links](https://roundertools.com) and images
- Task lists:
  - [x] Write a first draft
  - [ ] Export it as HTML

> Tip: press Enter at the end of a list item and the next one starts for you.

| Shortcut | What it does |
| -------- | ------------ |
| Ctrl+B   | Bold         |
| Ctrl+I   | Italic       |
| Ctrl+K   | Link         |

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

When you're done, download it as a \`.md\` file or a styled \`.html\` page.
`;

  const KEY = 'rounder:markdown-editor';
  const MAX_BYTES = 25 * 1024 * 1024;
  const MIRROR_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

  type View = 'split' | 'edit' | 'preview';
  type Action = { id: string; label: string; key?: string; run: (t: string, s: number, e: number) => Edit };

  const actions: Action[][] = [
    [
      { id: 'bold', label: 'Bold', key: 'B', run: (t, s, e) => toggleInline(t, s, e, '**', 'bold text') },
      { id: 'italic', label: 'Italic', key: 'I', run: (t, s, e) => toggleInline(t, s, e, '*', 'italic text') },
      { id: 'heading', label: 'Heading (press again for smaller)', run: cycleHeading },
    ],
    [
      { id: 'link', label: 'Link', key: 'K', run: insertLink },
      { id: 'code', label: 'Code', run: toggleCode },
      { id: 'quote', label: 'Quote', run: (t, s, e) => toggleLines(t, s, e, 'quote') },
    ],
    [
      { id: 'ul', label: 'Bulleted list', run: (t, s, e) => toggleLines(t, s, e, 'ul') },
      { id: 'ol', label: 'Numbered list', run: (t, s, e) => toggleLines(t, s, e, 'ol') },
      { id: 'table', label: 'Table', run: (t, _s, e) => insertTable(t, e) },
    ],
  ];

  let text = $state(SAMPLE);
  let name = $state<string | null>(null);
  let mode = $state<View>('split');
  let narrow = $state(false);
  let sync = $state(true);
  let html = $state('');
  let stats = $state({ words: 0, lines: 0 });
  let saved = $state<'idle' | 'saved' | 'full'>('idle');
  let notice = $state('');
  let error = $state('');
  let loaded = $state(false);
  let ready = $state(false);
  let dragging = $state(false);
  let mac = $state(false);

  // phones get Editor / Preview tabs instead of side by side
  const view = $derived<View>(narrow && mode === 'split' ? 'edit' : mode);
  const views = $derived(
    narrow
      ? ([['edit', 'Edit'], ['preview', 'Preview']] as const)
      : ([['split', 'Split'], ['edit', 'Editor'], ['preview', 'Preview']] as const),
  );

  let ta: HTMLTextAreaElement;
  let pane: HTMLDivElement;
  let article: HTMLDivElement;
  let mirror: HTMLDivElement;
  let fileInput: HTMLInputElement;

  let worker: Worker | undefined;
  let purify: DOMPurify | undefined;
  let seq = 0;
  let rendered = false;
  let renderedSrc = '';
  let offsets: number[] = [];
  let renderTimer: ReturnType<typeof setTimeout>;
  let saveTimer: ReturnType<typeof setTimeout>;
  let measureTimer: ReturnType<typeof setTimeout>;
  let noticeTimer: ReturnType<typeof setTimeout>;

  // live preview: debounced, parsed in a worker, sanitized here
  $effect(() => {
    const src = text;
    if (!ready) return;
    clearTimeout(renderTimer);
    const wait = !rendered ? 0 : src.length > 200_000 ? 350 : 120;
    renderTimer = setTimeout(() => worker?.postMessage({ id: ++seq, src }), wait);
  });

  async function onRendered(e: MessageEvent<{ id: number; src: string; html: string; offsets: number[] }>) {
    if (e.data.id !== seq || !purify) return;
    rendered = true;
    renderedSrc = e.data.src;
    offsets = e.data.offsets;
    // raw HTML is allowed in Markdown, but nothing that could restyle or script this page
    html = purify.sanitize(e.data.html, { FORBID_TAGS: ['style', 'form'] });
    await tick();
    stats = { words: countWords(article.textContent ?? ''), lines: renderedSrc ? renderedSrc.split('\n').length : 0 };
    measure();
  }

  // autosave
  let unsaved = false;
  function save() {
    clearTimeout(saveTimer);
    unsaved = false;
    try {
      // the untouched sample isn't a draft, so nothing is stored (or claimed)
      if (text === SAMPLE && !name) {
        localStorage.removeItem(KEY);
        saved = 'idle';
      } else {
        localStorage.setItem(KEY, JSON.stringify({ text, name }));
        saved = 'saved';
      }
    } catch {
      saved = 'full';
    }
  }

  $effect(() => {
    void text;
    void name;
    if (!loaded) return;
    unsaved = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  });

  $effect(() => {
    void view;
    if (ready) tick().then(measure);
  });

  /* ---------- synced scrolling ---------- */

  let maps: { ed: ScrollMap; pv: ScrollMap } | null = null;
  let active: 'ed' | 'pv' = 'ed';
  let raf = 0;

  /**
   * Finds where each Markdown block sits in both panes. The editor side is
   * measured with a hidden copy of the textarea, since wrapped lines make
   * line numbers useless for this.
   */
  function measure() {
    maps = null;
    if (view !== 'split' || !ta || ta.offsetParent === null || pane.offsetParent === null) return;
    const cs = getComputedStyle(ta);
    for (const p of MIRROR_STYLE) mirror.style[p] = cs[p];
    mirror.style.width = `${ta.clientWidth}px`;

    const src = renderedSrc;
    const frag = document.createDocumentFragment();
    frag.append(src.slice(0, offsets[0] ?? src.length));
    const spans: HTMLSpanElement[] = [];
    for (let k = 0; k < offsets.length; k++) {
      const span = document.createElement('span');
      span.textContent = src.slice(offsets[k], offsets[k + 1] ?? src.length);
      spans.push(span);
      frag.append(span);
    }
    mirror.replaceChildren(frag);
    const edTops = spans.map((s) => s.offsetTop);
    mirror.replaceChildren();

    const pvTops = offsets.map(() => NaN);
    const top = pane.getBoundingClientRect().top - pane.scrollTop;
    for (const el of Array.from(article.children) as HTMLElement[]) {
      const k = Number(el.dataset.b);
      if (k >= 0) pvTops[k] = el.getBoundingClientRect().top - top;
    }
    const edMax = ta.scrollHeight - ta.clientHeight;
    const pvMax = pane.scrollHeight - pane.clientHeight;
    maps = { ed: buildMap(edTops, pvTops, edMax, pvMax), pv: buildMap(pvTops, edTops, pvMax, edMax) };
    if (sync && active === 'ed') pane.scrollTop = mapScroll(maps.ed, ta.scrollTop);
  }

  function remeasure() {
    clearTimeout(measureTimer);
    measureTimer = setTimeout(measure, 150);
  }

  // only the pane the reader is using drives the other, so the two never fight
  function follow(from: 'ed' | 'pv') {
    if (!sync || !maps || active !== from) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!maps) return;
      if (from === 'ed') pane.scrollTop = mapScroll(maps.ed, ta.scrollTop);
      else ta.scrollTop = mapScroll(maps.pv, pane.scrollTop);
    });
  }

  function toggleSync() {
    sync = !sync;
    if (sync && maps) pane.scrollTop = mapScroll(maps.ed, ta.scrollTop);
  }

  /* ---------- editing ---------- */

  /** Applies an edit through execCommand so Ctrl+Z still works; returns false if undo isn't available */
  function apply(e: Edit): boolean {
    ta.focus({ preventScroll: true });
    if (document.activeElement !== ta) {
      text = applyEdit(text, e);
      return false;
    }
    ta.setSelectionRange(e.from, e.to);
    const ok = e.insert ? document.execCommand('insertText', false, e.insert) : e.from === e.to || document.execCommand('delete');
    if (!ok) {
      ta.setRangeText(e.insert, e.from, e.to);
      text = ta.value;
    }
    ta.setSelectionRange(e.selStart, e.selEnd);
    return ok;
  }

  function run(a: Action) {
    if (view === 'preview') return;
    apply(a.run(ta.value, ta.selectionStart, ta.selectionEnd));
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const a = actions.flat().find((x) => x.key?.toLowerCase() === e.key.toLowerCase());
      if (a) {
        e.preventDefault();
        run(a);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && ta.selectionStart === ta.selectionEnd) {
      const edit = continueList(ta.value, ta.selectionStart);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
    }
  }

  function replaceAll(value: string): boolean {
    // execCommand on megabytes of text is slow, so huge files skip the undo history
    const undoable = value.length < 1_000_000 && ta.value.length < 1_000_000 && apply({ from: 0, to: ta.value.length, insert: value, selStart: 0, selEnd: 0 });
    if (!undoable) text = value;
    ta.scrollTop = 0;
    pane.scrollTop = 0;
    return undoable;
  }

  function flash(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 4000);
  }

  function clearAll() {
    error = '';
    const undoable = replaceAll('');
    name = null;
    flash(undoable ? `Cleared. Press ${mac ? '⌘Z' : 'Ctrl+Z'} to undo.` : 'Cleared.');
  }

  async function open(file: File | undefined) {
    if (!file) return;
    error = '';
    if (!/\.(md|markdown|mdown|mkdn?|mdx|txt|text)$/i.test(file.name) && !file.type.startsWith('text/')) {
      error = `“${file.name}” isn't a Markdown or text file. Open a .md or .txt file instead.`;
      return;
    }
    if (file.size > MAX_BYTES) {
      error = `“${file.name}” is ${formatBytes(file.size)}. Files over 25 MB are too big to edit smoothly in a browser text box.`;
      return;
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch {
      error = `“${file.name}” couldn't be read. It may have been moved or deleted, so try opening it again.`;
      return;
    }
    if (raw.slice(0, 8192).includes('\0')) {
      error = `“${file.name}” doesn't look like a text file.`;
      return;
    }
    replaceAll(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
    name = file.name;
    flash(`Opened ${file.name}`);
  }

  /* ---------- export ---------- */

  function baseName() {
    return name ? name.replace(/\.[^.]+$/, '') || 'document' : fileBase(docTitle(text));
  }

  /** The preview's html without the scroll-sync markers */
  function cleanHtml() {
    const clone = article.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll('[data-b]')) el.removeAttribute('data-b');
    return clone.innerHTML.trim();
  }

  function downloadMd() {
    downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${baseName()}.md`);
  }

  function downloadHtml() {
    const page = standaloneHtml(docTitle(text) || baseName(), cleanHtml());
    downloadBlob(new Blob([page], { type: 'text/html;charset=utf-8' }), `${baseName()}.html`);
  }

  onMount(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    try {
      const draft = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (draft && typeof draft.text === 'string') {
        text = draft.text;
        name = typeof draft.name === 'string' ? draft.name : null;
      }
    } catch {
      // storage blocked or an unreadable draft: start from the sample
    }
    loaded = true;

    const mq = matchMedia('(max-width: 767px)');
    const onMq = () => (narrow = mq.matches);
    onMq();
    mq.addEventListener('change', onMq);

    worker = new Worker(new URL('../lib/markdown-editor/render.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = onRendered;
    worker.onerror = () => (error = 'The preview failed to load. Reloading the page usually fixes this.');
    import('dompurify')
      .then(({ default: createDOMPurify }) => {
        purify = createDOMPurify(window);
        ready = true;
      })
      .catch(() => (error = 'The preview failed to load. Check your connection and reload the page.'));

    // closing or leaving the tab inside the autosave delay would lose the last few keystrokes
    const flush = () => unsaved && save();
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);

    const ro = new ResizeObserver(remeasure);
    ro.observe(ta);
    ro.observe(pane);
    // images change the preview's height as they load
    pane.addEventListener('load', remeasure, true);
    // links in the preview open in a new tab so the draft stays put
    const onLink = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a');
      const href = a?.getAttribute('href');
      if (!a || !href || href.startsWith('#')) return;
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
    };
    pane.addEventListener('click', onLink);

    return () => {
      worker?.terminate();
      ro.disconnect();
      mq.removeEventListener('change', onMq);
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
      pane.removeEventListener('load', remeasure, true);
      pane.removeEventListener('click', onLink);
      for (const t of [renderTimer, saveTimer, measureTimer, noticeTimer]) clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  });

  const empty = $derived(!text.trim());
  const shortcut = (key: string) => (mac ? `⌘${key}` : `Ctrl+${key}`);
</script>

{#snippet icon(id: string)}
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if id === 'bold'}
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    {:else if id === 'italic'}
      <path d="M11 5h7M6 19h7M14.5 5l-5 14" />
    {:else if id === 'heading'}
      <path d="M6 5v14M17 5v14M6 12h11" />
    {:else if id === 'link'}
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    {:else if id === 'code'}
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
    {:else if id === 'quote'}
      <path d="M5 17c2.5-1 4-3 4-6.5V7H5v4h4M15 17c2.5-1 4-3 4-6.5V7h-4v4h4" />
    {:else if id === 'ul'}
      <path d="M10 6h10M10 12h10M10 18h10" />
      <circle cx="5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    {:else if id === 'ol'}
      <path d="M11 6h9M11 12h9M11 18h9M4 5l1.5-1v5M3.5 15a1.5 1.5 0 0 1 3 .2c0 1.1-3 2.3-3 3.8h3" />
    {:else}
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 9.5h18M3 14.5h18M10 4.5v15" />
    {/if}
  </svg>
{/snippet}

<div class="grid gap-3">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
      {#each actions as group, g}
        {#if g}<span class="mx-1 h-5 w-px bg-line-2" aria-hidden="true"></span>{/if}
        {#each group as a (a.id)}
          <button
            type="button"
            class="tb"
            aria-label={a.label}
            title={a.key ? `${a.label} (${shortcut(a.key)})` : a.label}
            disabled={view === 'preview'}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => run(a)}
          >
            {@render icon(a.id)}
          </button>
        {/each}
      {/each}
    </div>
    <div class="seg" role="group" aria-label="Layout">
      {#each views as [value, label] (value)}
        <button type="button" aria-pressed={view === value} onclick={() => (mode = value)}>{label}</button>
      {/each}
    </div>
  </div>

  <!-- a file dropped anywhere on the editor or preview opens here instead of replacing the page -->
  <div
    class="frame"
    class:split={view === 'split'}
    role="group"
    aria-label="Editor and preview"
    ondragover={(e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dragging = false;
    }}
    ondrop={(e) => {
      dragging = false;
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      open(e.dataTransfer.files[0]);
    }}
  >
    <div class="pane relative" class:hidden={view === 'preview'}>
      <div class="bar mono">
        <span class="truncate">{name ?? 'draft.md'}</span>
        <span>markdown</span>
      </div>
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <textarea
          bind:this={ta}
          bind:value={text}
          class="editor"
          aria-label="Markdown"
          placeholder="Start writing Markdown here, or drop a .md file…"
          spellcheck="true"
          {onkeydown}
          onscroll={() => follow('ed')}
          onpointerenter={() => (active = 'ed')}
          onfocus={() => (active = 'ed')}
          ontouchstart={() => (active = 'ed')}
          onwheel={() => (active = 'ed')}
        ></textarea>
        <div bind:this={mirror} class="mirror" aria-hidden="true"></div>
      </div>
    </div>

    <div class="pane" class:hidden={view === 'edit'}>
      <div class="bar mono">
        <span>preview</span>
        {#if view === 'split'}
          <label class="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" class="accent-(--color-sun)" checked={sync} onchange={toggleSync} />
            sync scroll
          </label>
        {/if}
      </div>
      <!-- the preview scrolls, so it has to be reachable by keyboard -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={pane}
        class="relative min-h-0 flex-1 overflow-y-auto"
        tabindex="0"
        role="region"
        aria-label="Preview"
        onscroll={() => follow('pv')}
        onpointerenter={() => (active = 'pv')}
        onfocus={() => (active = 'pv')}
        ontouchstart={() => (active = 'pv')}
        onwheel={() => (active = 'pv')}
      >
        {#if empty}
          <div class="grid h-full place-content-center gap-1 p-6 text-center">
            <p class="font-serif text-3xl text-soft">Nothing to preview yet</p>
            <p class="mono">{view === 'split' ? 'start typing on the left' : 'write something in the editor'}, or open a .md file</p>
          </div>
        {/if}
        <div bind:this={article} class="md-body" class:hidden={empty}>{@html html}</div>
      </div>
    </div>
    {#if dragging}
      <div class="drop-hint" aria-hidden="true"><span class="font-serif text-2xl">Drop to open</span></div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
    <p class="mono" aria-live="polite">
      {stats.words.toLocaleString('en-US')} words · {Math.ceil(stats.words / 238)} min read · {stats.lines.toLocaleString('en-US')} lines
      {#if notice}<span class="text-chalk"> · {notice}</span>{/if}
    </p>
    {#if saved === 'saved'}
      <p class="mono flex items-center gap-1.5"><span class="dot"></span> draft saved in this browser</p>
    {:else if saved === 'full'}
      <p class="mono text-bad!">too large to autosave, download a copy to keep it</p>
    {/if}
  </div>

  {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

  <div class="flex flex-wrap items-center gap-2">
    <button type="button" class="btn btn-primary" onclick={downloadMd} disabled={empty}>Download .md</button>
    <button type="button" class="btn" onclick={downloadHtml} disabled={empty}>Download .html</button>
    <CopyButton text={cleanHtml} label="Copy HTML" />
    <button type="button" class="btn" onclick={() => fileInput.click()}>Open file</button>
    <button type="button" class="btn" onclick={clearAll} disabled={empty}>Clear</button>
    <a class="ml-auto text-sm text-soft underline-offset-4 hover:text-chalk hover:underline" href="/markdown-to-pdf">Need a PDF? Markdown to PDF →</a>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    accept=".md,.markdown,.mdown,.mkd,.mkdn,.mdx,.txt,text/markdown,text/plain"
    hidden
    onchange={(e) => {
      open(e.currentTarget.files?.[0]);
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  .tb {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--color-soft);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s, transform 0.2s var(--ease-spring);
    &:hover:not(:disabled) { background: var(--color-panel-2); color: var(--color-chalk); }
    &:active:not(:disabled) { transform: scale(0.92); }
    &:disabled { opacity: 0.35; cursor: not-allowed; }
  }

  .frame {
    position: relative;
    display: grid;
    height: clamp(380px, 68vh, 680px);
    background: #141312;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    overflow: hidden;
    transition: border-color 0.2s;
    &:focus-within { border-color: #ffd25e66; }
  }
  @media (min-width: 768px) {
    .frame.split { grid-template-columns: 1fr 1fr; }
    .frame.split .pane + .pane { border-left: 1px solid var(--color-line-2); }
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    &.hidden { display: none; }
  }
  .bar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-line);
    background: var(--color-panel);
    white-space: nowrap;
  }

  .editor,
  .mirror {
    font: 400 14px/1.7 var(--font-mono);
    padding: 18px 20px 40vh;
    tab-size: 4;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .editor {
    display: block;
    width: 100%;
    height: 100%;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-chalk);
    &::placeholder { color: #6e6960; }
  }
  .mirror {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    visibility: hidden;
    pointer-events: none;
  }
  .drop-hint {
    position: absolute;
    inset: 10px;
    display: grid;
    place-items: center;
    border: 1.5px dashed var(--color-sun);
    border-radius: 12px;
    background: #ffd25e14;
    pointer-events: none;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-ok);
    animation: pop 0.5s var(--ease-spring);
  }
  @keyframes pop {
    from { transform: scale(0); }
  }

  /* the rendered document; contain keeps any position:fixed in raw HTML inside the pane */
  .md-body {
    contain: content;
    padding: 22px 26px 40vh;
    font-size: 16px;
    line-height: 1.7;
    color: var(--color-soft);
    overflow-wrap: break-word;
    &.hidden { display: none; }
    & > :global(:first-child) { margin-top: 0; }
    & :global(:is(h1, h2, h3, h4, h5, h6)) { color: var(--color-chalk); line-height: 1.2; margin: 1.6em 0 0.5em; }
    & :global(:is(h1, h2, h3)) { font-family: var(--font-serif); font-weight: 400; letter-spacing: -0.01em; }
    & :global(h1) { font-size: 2.4em; }
    & :global(h2) { font-size: 1.8em; padding-bottom: 0.2em; border-bottom: 1px solid var(--color-line); }
    & :global(h3) { font-size: 1.4em; }
    & :global(:is(h4, h5, h6)) { font-size: 1em; font-weight: 600; }
    & :global(:is(p, ul, ol, blockquote, pre, table)) { margin: 0 0 1em; }
    & :global(:is(ul, ol)) { padding-left: 1.5em; }
    & :global(ul) { list-style: disc; }
    & :global(ol) { list-style: decimal; }
    & :global(li > :is(ul, ol)) { margin-bottom: 0; }
    & :global(li::marker) { color: var(--color-muted); }
    & :global(li:has(> input[type='checkbox'], > p > input[type='checkbox'])) { list-style: none; margin-left: -1.4em; }
    & :global(input[type='checkbox']) { accent-color: var(--color-sun); margin-right: 0.4em; vertical-align: -0.1em; }
    & :global(:is(strong, b)) { color: var(--color-chalk); font-weight: 600; }
    & :global(em) { color: inherit; }
    & :global(a) { color: var(--color-sun); text-decoration: underline; text-underline-offset: 3px; }
    & :global(img) { max-width: 100%; height: auto; border-radius: 8px; }
    & :global(hr) { border: 0; border-top: 1px solid var(--color-line-2); margin: 2em 0; }
    & :global(blockquote) { padding: 0.2em 1em; border-left: 3px solid var(--color-sun); color: var(--color-muted); }
    & :global(code) { font: 0.86em/1.5 var(--font-mono); color: var(--color-chalk); background: var(--color-panel-2); padding: 0.15em 0.4em; border-radius: 6px; }
    & :global(pre) { background: var(--color-panel); border: 1px solid var(--color-line-2); border-radius: 12px; padding: 14px 16px; overflow-x: auto; }
    & :global(pre code) { background: none; padding: 0; font-size: 13px; line-height: 1.65; }
    & :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 0.94em; }
    & :global(:is(th, td)) { border: 1px solid var(--color-line-2); padding: 6px 12px; text-align: left; }
    & :global(th) { background: var(--color-panel-2); color: var(--color-chalk); font-weight: 600; }
    & :global(del) { color: var(--color-muted); }
  }
</style>
