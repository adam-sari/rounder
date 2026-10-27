<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { DOMPurify } from 'dompurify';
  import { pdfName } from '@/engines/pdf/lib';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { mdPdfWorker, stopMdPdfWorker } from '@/tools/lib/md-pdf/client';
  import { htmlToBlocks } from '@/tools/lib/md-pdf/dom';
  import { loadImage, type ImageResult } from '@/tools/lib/md-pdf/images';
  import { indentEdit, type Edit } from '@/tools/lib/md-pdf/indent';
  import type { ImageSize, Layout } from '@/tools/lib/md-pdf/layout';
  import { docTitle, fileBase, imageSources, type Block } from '@/tools/lib/md-pdf/model';
  import type { PdfImage } from '@/tools/lib/md-pdf/pdf';
  import { printDocument } from '@/tools/lib/md-pdf/print';
  import {
    MARGINS,
    NUMBER_LABELS,
    STACKS,
    THEMES,
    type FontKey,
    type MarginId,
    type NumberPos,
    type PageOptions,
    type PageSize,
    type ThemeId,
  } from '@/tools/lib/md-pdf/themes';

  let { mode = 'markdown' }: { mode?: 'markdown' | 'html' } = $props();
  const isHtml = untrack(() => mode === 'html');

  const MD_SAMPLE = `# Project notes

This page turns **Markdown** into a PDF right in your browser. Links stay clickable, like [Rounder](https://roundertools.com), and the text stays *selectable* and searchable.

## What carries over

- Headings, **bold**, *italic*, ~~strikethrough~~ and \`inline code\`
- Lists, including nested ones
  - like this one
- Quotes, code blocks, tables and images

> The preview shows exactly what Download PDF gives you, page for page.

## Checklist

- [x] Write the first draft
- [x] Pick a theme and page size
- [ ] Share the PDF

| Element | Markdown | In the PDF |
| :------ | :------- | :--------- |
| Bold    | \`**text**\` | **text** |
| Link    | \`[text](url)\` | a clickable link |
| Code    | backticks | monospace |

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

---

Want your browser to lay out the pages instead? Use **Print** and choose *Save as PDF*.
`;

  const HTML_SAMPLE = `<!doctype html>
<html>
<head>
  <title>Welcome pack</title>
  <style>
    h1 { letter-spacing: -0.5px; }
  </style>
</head>
<body>
  <h1>Welcome pack</h1>
  <p>Paste any <strong>HTML</strong> here, or open an <code>.html</code> file. The preview shows the PDF page by page, with clickable <a href="https://roundertools.com">links</a> and selectable text.</p>

  <h2>What carries over</h2>
  <ul>
    <li>Headings, paragraphs, <em>emphasis</em> and links</li>
    <li>Lists, tables, quotes and code</li>
    <li>Images with a full <code>https://</code> address</li>
  </ul>

  <table>
    <thead><tr><th>Tag</th><th>Becomes</th></tr></thead>
    <tbody>
      <tr><td>&lt;h1&gt; to &lt;h6&gt;</td><td>Headings</td></tr>
      <tr><td>&lt;table&gt;</td><td>A table that repeats its header row on each page</td></tr>
      <tr><td>&lt;script&gt;</td><td>Removed, never run</td></tr>
    </tbody>
  </table>

  <blockquote>Download PDF uses the theme you pick. Print also applies the page's own &lt;style&gt; rules.</blockquote>
</body>
</html>
`;

  const MAX_BYTES = 25 * 1024 * 1024;
  const ACCEPT = isHtml ? '.html,.htm,.xhtml,text/html' : '.md,.markdown,.mdown,.mkd,.mkdn,.mdx,.txt,text/markdown,text/plain';
  const KIND = isHtml ? 'HTML' : 'Markdown';
  const PARSE_ERROR = `This ${KIND} couldn't be read. Try removing the part you changed last.`;
  // markup that could restyle or script anything is dropped; the HTML's own CSS reaches only the print page
  const PURIFY = { FORBID_TAGS: ['style', 'form', 'link', 'base', 'meta'] };

  let text = $state(isHtml ? HTML_SAMPLE : MD_SAMPLE);
  let name = $state<string | null>(null);
  let theme = $state<ThemeId>('clean');
  let size = $state<PageSize>('A4');
  let margin = $state<MarginId>('normal');
  let numbers = $state<NumberPos>('bottom');

  let blocks = $state.raw<Block[]>([]);
  let htmlTitle = $state('');
  let images = $state.raw<Record<string, ImageResult>>({});
  let layout = $state.raw<Layout | null>(null);
  let missing = $state.raw<string[]>([]);
  let updating = $state(false);
  let exporting = $state(false);
  let saved = $state<{ name: string; pages: number; size: number } | null>(null);
  let error = $state('');
  let notice = $state('');
  let ready = $state(false);
  let parsed = $state(false);
  let narrow = $state(false);
  let tab = $state<'edit' | 'preview'>('edit');
  let dragging = $state(false);
  let mac = $state(false);

  let ta: HTMLTextAreaElement;
  let scroller = $state<HTMLDivElement>();
  let fileInput: HTMLInputElement;

  let purify: DOMPurify | undefined;
  /** the sanitized HTML, for printing */
  let clean = '';
  /** an HTML file's own <style> rules, for printing */
  let ownCss = '';
  let destroyed = false;
  let parseSeq = 0;
  let parseTimer: ReturnType<typeof setTimeout>;
  let noticeTimer: ReturnType<typeof setTimeout>;
  let imageTimer: ReturnType<typeof setTimeout>;
  let frame: HTMLIFrameElement | undefined;
  const imageJobs = new Map<string, Promise<ImageResult>>();

  const opts = $derived<PageOptions>({ theme, size, margin, numbers });
  const title = $derived((isHtml && htmlTitle) || docTitle(blocks));
  const empty = $derived(!text.trim());
  const sizes = $derived(Object.fromEntries(Object.entries(images).flatMap(([src, r]): [string, ImageSize][] => (r.ok ? [[src, { w: r.w, h: r.h }]] : []))));

  function failed() {
    stopMdPdfWorker();
    busy = false;
    updating = false;
    exporting = false;
    error = 'The PDF engine failed to load. Check your connection and reload the page.';
  }

  /* ---------- text → blocks: parsed in the worker, sanitized and walked here ---------- */

  $effect(() => {
    const src = text;
    if (!ready) return;
    clearTimeout(parseTimer);
    const first = untrack(() => !parsed);
    parseTimer = setTimeout(() => parse(src), first ? 0 : src.length > 200_000 ? 400 : 150);
  });

  async function parse(src: string) {
    const id = ++parseSeq;
    try {
      const raw = isHtml ? src : await mdPdfWorker(failed).markdown(src);
      if (id !== parseSeq || !purify) return;
      clean = purify.sanitize(raw, PURIFY);
      const next = htmlToBlocks(new DOMParser().parseFromString(clean, 'text/html').body);
      if (isHtml) {
        // parsed inert: nothing in it runs or loads
        const own = new DOMParser().parseFromString(src, 'text/html');
        ownCss = Array.from(own.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n');
        htmlTitle = own.title.replace(/\s+/g, ' ').trim();
      }
      // wait for typing to settle, so "https://exa…" isn't fetched one letter at a time
      clearTimeout(imageTimer);
      const srcs = imageSources(next);
      if (parsed) imageTimer = setTimeout(() => fetchImages(srcs), 800);
      else fetchImages(srcs);
      parsed = true;
      blocks = next;
      if (error === PARSE_ERROR) error = '';
    } catch {
      if (id === parseSeq) error = PARSE_ERROR;
    }
  }

  function fetchImages(srcs: string[]) {
    for (const src of srcs) {
      if (imageJobs.has(src)) continue;
      const job = loadImage(src);
      imageJobs.set(src, job);
      job.then((r) => {
        if (destroyed) {
          if (r.ok) URL.revokeObjectURL(r.url);
        } else images = { ...images, [src]: r };
      });
    }
  }

  /* ---------- blocks → pages, in the worker; one request at a time, always the latest ---------- */

  let busy = false;
  let dirty = false;

  $effect(() => {
    void blocks;
    void opts;
    void sizes;
    if (parsed) relayout();
  });

  async function relayout() {
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    updating = true;
    try {
      do {
        dirty = false;
        const res = await mdPdfWorker(failed).layout(blocks, opts, sizes);
        if (destroyed) return;
        if (!dirty) {
          layout = res.layout;
          missing = res.missing;
          if (error.startsWith('The layout')) error = '';
        }
      } while (dirty);
    } catch (e) {
      error = `The layout failed: ${(e as Error).message}`;
    } finally {
      busy = false;
      updating = false;
    }
  }

  /* ---------- export ---------- */

  function outName() {
    return name ? pdfName(name) : `${fileBase(title)}.pdf`;
  }

  async function downloadPdf() {
    exporting = true;
    error = '';
    saved = null;
    try {
      const srcs = imageSources(blocks);
      fetchImages(srcs);
      const results = await Promise.all(srcs.map((s) => imageJobs.get(s)!));
      const pdfImages: Record<string, PdfImage> = {};
      srcs.forEach((src, k) => {
        const r = results[k];
        if (r.ok) pdfImages[src] = { w: r.w, h: r.h, bytes: r.bytes, kind: r.kind };
      });
      const out = await mdPdfWorker(failed).pdf(blocks, opts, pdfImages, title);
      const file = outName();
      downloadBlob(out.blob, file);
      saved = { name: file, pages: out.pages, size: out.blob.size };
    } catch (e) {
      const err = e as Error;
      // PdfError messages are written for people; anything else gets context
      error = err.name === 'PdfError' ? err.message : `Couldn't build the PDF: ${err.message || 'unknown error'}. Try Print instead.`;
    } finally {
      exporting = false;
    }
  }

  function printDoc() {
    frame?.remove();
    const f = document.createElement('iframe');
    // no scripts can run in it; same-origin only so this page can call print()
    f.setAttribute('sandbox', 'allow-modals allow-same-origin');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.srcdoc = printDocument(clean, opts, title || name || 'Document', isHtml ? ownCss : '');
    f.onload = async () => {
      const doc = f.contentDocument;
      if (!doc || !f.contentWindow) return;
      // images and fonts have to be ready, or they're missing from the printout (lazy ones
      // never load in a 0×0 frame); a server that never answers mustn't hold printing back
      for (const img of doc.images) img.loading = 'eager';
      const loaded = Promise.all([...Array.from(doc.images, (img) => img.decode().catch(() => {})), doc.fonts?.ready]);
      await Promise.race([loaded, new Promise((r) => setTimeout(r, 10_000))]);
      // a newer print replaced this one, or the page was left meanwhile
      if (frame !== f || destroyed || !f.contentWindow) return;
      f.contentWindow.focus();
      f.contentWindow.print();
    };
    document.body.append(f);
    frame = f;
  }

  /* ---------- editing ---------- */

  let tabOut = false;

  /** Applies an edit through execCommand so Ctrl+Z still works */
  function apply(e: Edit): boolean {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(e.from, e.to);
    // execCommand edits whatever has focus: if the editor can't take it (hidden on the
    // Preview tab), a dropped file must not land in some other field on the page
    const focused = document.activeElement === ta;
    const ok = focused && (e.insert ? document.execCommand('insertText', false, e.insert) : e.from === e.to || document.execCommand('delete'));
    if (!ok) {
      ta.setRangeText(e.insert, e.from, e.to);
      text = ta.value;
    }
    ta.setSelectionRange(e.selStart, e.selEnd);
    return ok;
  }

  function onkeydown(e: KeyboardEvent) {
    // Tab indents; Esc then Tab leaves the editor, so keyboard users never get stuck
    if (e.key === 'Escape') {
      tabOut = true;
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !tabOut) {
      e.preventDefault();
      const edit = indentEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (edit.insert !== ta.value.slice(edit.from, edit.to)) apply(edit);
      return;
    }
    tabOut = false;
  }

  function replaceAll(value: string): boolean {
    // execCommand on megabytes of text is slow, so huge files skip the undo history
    const undoable = value.length < 1_000_000 && ta.value.length < 1_000_000 && apply({ from: 0, to: ta.value.length, insert: value, selStart: 0, selEnd: 0 });
    if (!undoable) text = value;
    ta.scrollTop = 0;
    return undoable;
  }

  function flash(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 4000);
  }

  function clearAll() {
    error = '';
    saved = null;
    const undoable = replaceAll('');
    name = null;
    flash(undoable ? `Cleared. Press ${mac ? '⌘Z' : 'Ctrl+Z'} to undo.` : 'Cleared.');
  }

  async function open(file: File | undefined) {
    if (!file) return;
    error = '';
    saved = null;
    const md = /\.(md|markdown|mdown|mkdn?|mdx)$/i.test(file.name);
    const html = /\.x?html?$/i.test(file.name);
    // files with no extension at all (README, LICENSE) are let through; the NUL check below catches binaries
    const plain = /\.(txt|text)$/i.test(file.name) || !/\.[^.]+$/.test(file.name) || (!md && !html && file.type.startsWith('text/'));
    if (isHtml ? md : html) {
      error = `“${file.name}” is ${isHtml ? 'a Markdown' : 'an HTML'} file. Open it in ${isHtml ? 'Markdown' : 'HTML'} to PDF instead.`;
      return;
    }
    if (!plain && !(isHtml ? html : md)) {
      error = `“${file.name}” isn't ${isHtml ? 'an HTML' : 'a Markdown or text'} file.`;
      return;
    }
    if (file.size > MAX_BYTES) {
      error = `“${file.name}” is ${formatBytes(file.size)}. Files over 25 MB are too big to edit smoothly in a browser.`;
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

  /* ---------- preview ---------- */

  // only pages near the visible area are drawn, so 300-page documents stay smooth
  const visible = new SvelteSet<number>();
  let io: IntersectionObserver | undefined;

  function sheet(node: HTMLElement, i: number) {
    node.dataset.i = String(i);
    io?.observe(node);
    return {
      update(n: number) {
        node.dataset.i = String(n);
      },
      destroy() {
        io?.unobserve(node);
      },
    };
  }

  const fontCss = new Map<string, string>();
  function fontStyle(font: FontKey, skew?: boolean) {
    const key = `${font}${skew ? '/' : ''}`;
    let css = fontCss.get(key);
    if (!css) {
      const [family, v] = font.split('-') as [keyof typeof STACKS, string];
      css = `font-family:${STACKS[family]};font-weight:${v.includes('b') ? 700 : 400};font-style:${v.includes('i') || skew ? 'italic' : 'normal'}`;
      fontCss.set(key, css);
    }
    return css;
  }

  const imageNotes = $derived.by(() => {
    const count = { relative: 0, blocked: 0, broken: 0 };
    for (const src of imageSources(blocks)) {
      const r = images[src];
      if (r && !r.ok) count[r.reason]++;
    }
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));
    const notes: string[] = [];
    if (count.relative) notes.push(`${plural(count.relative, 'An image uses', '# images use')} a relative path (like images/photo.png), which can't be found from here. Use a full https:// address instead.`);
    if (count.blocked) notes.push(`${plural(count.blocked, "An image couldn't", "# images couldn't")} be loaded: the site doesn't let other pages use its images, or it's offline.`);
    if (count.broken) notes.push(`${plural(count.broken, "An image couldn't", "# images couldn't")} be read. ${count.broken === 1 ? 'It' : 'They'} may be damaged or in a format your browser can't open.`);
    return notes;
  });

  onMount(() => {
    mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    try {
      // Letter where it's the norm, A4 everywhere else
      const region = new Intl.Locale(navigator.language).maximize().region;
      if (region && ['US', 'CA', 'MX', 'PH'].includes(region)) size = 'Letter';
    } catch {
      // unknown locale: keep A4
    }

    const mq = matchMedia('(max-width: 767px)');
    const onMq = () => (narrow = mq.matches);
    onMq();
    mq.addEventListener('change', onMq);

    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.i);
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
      },
      { root: scroller, rootMargin: '800px 0px' },
    );

    import('dompurify')
      .then(({ default: createDOMPurify }) => {
        purify = createDOMPurify(window);
        ready = true;
      })
      .catch(() => (error = 'The preview failed to load. Check your connection and reload the page.'));

    return () => {
      destroyed = true;
      mq.removeEventListener('change', onMq);
      io?.disconnect();
      frame?.remove();
      stopMdPdfWorker();
      for (const t of [parseTimer, noticeTimer, imageTimer]) clearTimeout(t);
      for (const r of Object.values(images)) if (r.ok) URL.revokeObjectURL(r.url);
    };
  });

  const showEditor = $derived(!narrow || tab === 'edit');
  const showPreview = $derived(!narrow || tab === 'preview');
  const pageCount = $derived(layout?.pages.length ?? 0);
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
    <div>
      <span class="label" id="mdpdf-theme">theme</span>
      <div class="seg" role="group" aria-labelledby="mdpdf-theme">
        {#each Object.values(THEMES) as t (t.id)}
          <button type="button" aria-pressed={theme === t.id} onclick={() => (theme = t.id)}>
            <span class="swatch" style="font-family:{STACKS[t.heading]}" aria-hidden="true">Aa</span>{t.label}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <span class="label" id="mdpdf-size">page size</span>
      <div class="seg" role="group" aria-labelledby="mdpdf-size">
        {#each ['A4', 'Letter'] as const as s (s)}
          <button type="button" aria-pressed={size === s} onclick={() => (size = s)}>{s}</button>
        {/each}
      </div>
    </div>
    <div>
      <span class="label" id="mdpdf-margin">margins</span>
      <div class="seg" role="group" aria-labelledby="mdpdf-margin">
        {#each Object.entries(MARGINS) as [id, m] (id)}
          <button type="button" aria-pressed={margin === id} title="{m.mm} mm" onclick={() => (margin = id as MarginId)}>{m.label}</button>
        {/each}
      </div>
    </div>
    <label class="min-w-48">
      <span class="label">page numbers</span>
      <select class="field py-[7px]! text-sm!" bind:value={numbers}>
        {#each Object.entries(NUMBER_LABELS) as [id, label] (id)}
          <option value={id}>{label}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if narrow}
    <div class="seg self-start" role="group" aria-label="View">
      <button type="button" aria-pressed={tab === 'edit'} onclick={() => (tab = 'edit')}>Edit</button>
      <button type="button" aria-pressed={tab === 'preview'} onclick={() => (tab = 'preview')}>Preview{pageCount ? ` · ${pageCount}` : ''}</button>
    </div>
  {/if}

  <!-- a file dropped anywhere on the editor or preview opens here instead of replacing the page -->
  <div
    class="frame"
    class:split={!narrow}
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
    <div class="pane" class:hidden={!showEditor}>
      <div class="bar mono">
        <span class="truncate">{name ?? (isHtml ? 'page.html' : 'notes.md')}</span>
        <span class="hidden sm:inline" id="mdpdf-keys">Tab indents · Esc, Tab to leave</span>
      </div>
      <textarea
        bind:this={ta}
        bind:value={text}
        class="editor"
        aria-label={KIND}
        aria-describedby="mdpdf-keys"
        placeholder={isHtml ? 'Paste HTML here, or drop an .html file…' : 'Write or paste Markdown here, or drop a .md file…'}
        spellcheck={!isHtml}
        {onkeydown}
        onblur={() => (tabOut = false)}
      ></textarea>
    </div>

    <div class="pane" class:hidden={!showPreview}>
      <div class="bar mono">
        <span>preview{pageCount && !empty ? ` · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · ${size}` : ''}</span>
        <span class="flex items-center gap-1.5" aria-live="polite">
          {#if updating}<span class="pulse"></span> updating{/if}
        </span>
      </div>
      <!-- the preview scrolls, so it has to be reachable by keyboard -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div bind:this={scroller} class="sheets" tabindex="0" role="region" aria-label="PDF preview">
        {#if empty}
          <div class="grid h-full place-content-center gap-1 p-6 text-center">
            <p class="font-serif text-3xl text-soft">A blank page</p>
            <p class="mono">write some {KIND}, or open a file</p>
          </div>
        {:else if !layout}
          <div class="grid h-full place-content-center p-6 text-center">
            <p class="mono">setting the type…</p>
          </div>
        {:else}
          {#each layout.pages as page, i (i)}
            {@const L = layout}
            <figure class="sheet-wrap">
              <div class="sheet" style="aspect-ratio:{L.width}/{L.height}" use:sheet={i}>
                {#if visible.has(i)}
                  <svg viewBox="0 0 {L.width} {L.height}" role="img" aria-label="Page {i + 1}">
                    {#each page.items as it, n (n)}
                      {#if it.k === 'text'}
                        <text x={it.x} y={it.y} font-size={it.size} fill={it.color} textLength={it.w} lengthAdjust="spacingAndGlyphs" style={fontStyle(it.font, it.skew)}>{it.text}</text>
                      {:else if it.k === 'rect'}
                        <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={it.r ?? 0} fill={it.fill ?? 'none'} stroke={it.stroke ?? 'none'} stroke-width={it.lw ?? 0} />
                      {:else if it.k === 'line'}
                        <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} stroke={it.color} stroke-width={it.lw} />
                      {:else if it.k === 'img'}
                        {@const im = images[it.src]}
                        {#if im?.ok}<image href={im.url} x={it.x} y={it.y} width={it.w} height={it.h} preserveAspectRatio="none" />{/if}
                      {/if}
                    {/each}
                  </svg>
                {/if}
              </div>
              <figcaption class="mono">{i + 1}</figcaption>
            </figure>
          {/each}
        {/if}
      </div>
    </div>
    {#if dragging}
      <div class="drop-hint" aria-hidden="true"><span class="font-serif text-2xl">Drop to open</span></div>
    {/if}
  </div>

  {#if missing.length}
    <p class="note" role="status">
      Download PDF can't draw {missing.slice(0, 8).join(' ')}{missing.length > 8 ? ' and more' : ''}: {missing.length === 1 ? "it isn't" : "they aren't"} in its fonts, so {missing.length === 1 ? 'it would show' : 'they would show'} as empty boxes. Print keeps them, because it uses your system's fonts.
    </p>
  {/if}
  {#each imageNotes as note (note)}
    <p class="note" role="status">{note}</p>
  {/each}
  {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

  <div class="flex flex-wrap items-center gap-2">
    <button type="button" class="btn btn-primary" onclick={downloadPdf} disabled={empty || exporting || !parsed}>
      {#if exporting}<span class="spinner" aria-hidden="true"></span> Building PDF…{:else}Download PDF{/if}
    </button>
    <button type="button" class="btn" onclick={printDoc} disabled={empty || !parsed}>Print / Save as PDF</button>
    <button type="button" class="btn" onclick={() => fileInput.click()}>Open file</button>
    <button type="button" class="btn" onclick={clearAll} disabled={empty}>Clear</button>
    <p class="mono ml-auto" aria-live="polite">
      {#if saved}
        <span class="saved"><span class="tick" aria-hidden="true">✓</span> Saved {saved.name} · {saved.pages} {saved.pages === 1 ? 'page' : 'pages'} · {formatBytes(saved.size)}</span>
      {:else if notice}{notice}{/if}
    </p>
  </div>
  <p class="mono leading-relaxed">
    Download PDF matches the preview, with selectable text and clickable links. Print uses your browser's own layout: pick “Save as PDF” as the printer and turn off “Headers and footers”.
  </p>
  <input
    bind:this={fileInput}
    type="file"
    accept={ACCEPT}
    hidden
    onchange={(e) => {
      open(e.currentTarget.files?.[0]);
      e.currentTarget.value = '';
    }}
  />
</div>

<style>
  @font-face {
    font-family: 'Rounder Noto Sans';
    src: url('/fonts/pdf/NotoSans-Regular.ttf') format('truetype');
    font-weight: 400;
    font-display: swap;
  }
  @font-face {
    font-family: 'Rounder Noto Sans';
    src: url('/fonts/pdf/NotoSans-Bold.ttf') format('truetype');
    font-weight: 700;
    font-display: swap;
  }

  .swatch {
    margin-right: 6px;
    font-size: 14px;
    line-height: 1;
  }

  .frame {
    position: relative;
    display: grid;
    height: clamp(420px, 72vh, 720px);
    background: #141312;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    overflow: hidden;
    transition: border-color 0.2s;
    &:focus-within { border-color: #ffd25e66; }
  }
  .frame.split {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    & .pane + .pane { border-left: 1px solid var(--color-line-2); }
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

  .editor {
    display: block;
    flex: 1;
    min-height: 0;
    width: 100%;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-chalk);
    font: 400 14px/1.7 var(--font-mono);
    padding: 18px 20px 30vh;
    tab-size: 4;
    &::placeholder { color: #6e6960; }
    &:focus-visible { box-shadow: inset 0 0 0 2px #ffd25e55; }
  }

  .sheets {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 22px clamp(14px, 4%, 30px) 28px;
    background:
      radial-gradient(120% 60% at 50% 0%, #ffd25e0a, transparent 60%),
      #100f0e;
    &:focus-visible { outline-offset: -2px; }
  }
  .sheet-wrap {
    margin: 0 auto 18px;
    max-width: 560px;
    animation: rise 0.45s var(--ease-spring) both;
  }
  .sheet {
    width: 100%;
    background: #fff;
    border-radius: 3px;
    box-shadow:
      0 1px 2px #0008,
      0 14px 30px -12px #000c;
    overflow: hidden;
    & svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    & text {
      white-space: pre;
    }
  }
  figcaption {
    margin-top: 6px;
    text-align: center;
    font-size: 11px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
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

  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding: 10px 14px;
    border: 1px solid #ffd25e40;
    border-radius: 12px;
    background: #ffd25e0d;
  }

  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-sun);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to { opacity: 0.25; }
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .saved {
    color: var(--color-chalk);
  }
  .tick {
    display: inline-block;
    color: var(--color-ok);
    animation: pop 0.5s var(--ease-spring);
  }
  @keyframes pop {
    from { transform: scale(0); }
  }
</style>
