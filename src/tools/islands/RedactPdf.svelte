<script lang="ts">
  import { onMount } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { getPageSize, getText, isAbort, pdfName, PdfError, renderPage, type PageSize, type PdfPageText } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { boxFrom, containsPoint, toDisplayed, toUnrotated, type Box } from '@/tools/lib/redact-pdf/geometry';
  import { readBack, redactPdf } from '@/tools/lib/redact-pdf/redact';
  import { buildIndex, compileQuery, findRanges, PRESETS, rangeBoxes, type Matcher, type Measure, type PageIndex, type PresetId } from '@/tools/lib/redact-pdf/search';
  import { verifyRedaction, type VerifyResult } from '@/tools/lib/redact-pdf/verify';

  interface Mark {
    id: number;
    page: number;
    /** unrotated top-left points */
    boxes: Box[];
    kind: 'text' | 'box' | 'page';
    /** the matched text, for search marks */
    text?: string;
    /** page and character range of a search match, so it isn't marked twice */
    key?: string;
  }
  interface Match {
    key: string;
    page: number;
    start: number;
    end: number;
    text: string;
  }

  const LIMIT = 5000;
  const COLORS = [
    ['#000000', 'Black'],
    ['#ffffff', 'White'],
    ['#7f7f7f', 'Gray'],
  ] as const;
  const QUALITY = [150, 200, 300];

  const uid = $props.id();
  let pdf = $state.raw<OpenedPdf | null>(null);
  let pageNo = $state(0);
  /** size of the page shown; until it catches up with pageNo, marks can't be placed */
  let info = $state.raw<(PageSize & { page: number }) | null>(null);

  // text of every page, read in the background after opening; textReady counts pages done
  let pageText: ({ text: PdfPageText; index: PageIndex } | undefined)[] = [];
  let textReady = $state(0);
  let textChars = $state(0);

  let marks = $state.raw<Mark[]>([]);
  let selected = $state<number | null>(null);
  let nextId = 0;

  let find = $state({ text: '', regex: false, matchCase: false, wholeWord: false });
  let presets = $state<PresetId[]>([]);
  let matches = $state.raw<Match[]>([]);
  /** matches with no position on the page (e.g. vertical text), which search alone can't redact */
  let unplaced = $state.raw(new Set<string>());

  let color = $state('#000000');
  let dpi = $state(200);
  let removeMeta = $state(true);
  let removeExtras = $state(true);
  let filled = $state(false);

  let busy = $state<string | null>(null);
  let error = $state('');
  let result = $state.raw<{ name: string; blob: Blob; pages: number; check: VerifyResult; unlocked: boolean } | null>(null);

  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let removeBtn = $state<HTMLButtonElement>();
  let stageWidth = $state(0);
  let drawing = $state(true);
  let draft = $state<Box | null>(null);
  let drag: { id: number; x: number; y: number } | null = null;

  const numPages = $derived(pdf?.doc.numPages ?? 0);
  const ready = $derived(info?.page === pageNo);
  /** the page's size before /Rotate, the space marks are stored in */
  const flat = $derived(info ? (info.rotate % 180 ? { W: info.height, H: info.width } : { W: info.width, H: info.height }) : { W: 1, H: 1 });
  const compiled = $derived(compileQuery({ ...find, presets }));
  const markedKeys = $derived(new Set(marks.map((m) => m.key)));
  const fresh = $derived(matches.filter((m) => !markedKeys.has(m.key) && !unplaced.has(m.key)));
  const unplacedHere = $derived(matches.filter((m) => unplaced.has(m.key)));
  const matchPages = $derived(new Set(matches.map((m) => m.page)).size);
  const reading = $derived(!!pdf && textReady < numPages);
  const noText = $derived(!!pdf && !reading && textChars === 0);
  const wholePage = $derived(marks.find((m) => m.page === pageNo && m.kind === 'page'));
  const markedPages = $derived(new Set(marks.map((m) => m.page)).size);
  const groups = $derived.by(() => {
    const byPage = new Map<number, Mark[]>();
    for (const m of marks) (byPage.get(m.page) ?? byPage.set(m.page, []).get(m.page)!).push(m);
    return [...byPage].sort((a, b) => a[0] - b[0]);
  });
  const shown = $derived(info && ready ? marks.filter((m) => m.page === pageNo).map((m) => ({ mark: m, boxes: m.boxes.map((b) => toDisplayed(b, info!.rotate, flat.W, flat.H)) })) : []);
  // matches found but not marked yet, outlined on the page as a preview
  const pending = $derived.by(() => {
    const data = textReady ? pageText[pageNo] : undefined;
    if (!data || !info || !ready) return [];
    return fresh.filter((m) => m.page === pageNo).flatMap((m) => rangeBoxes(data.text, data.index, m.start, m.end, measure).map((b) => toDisplayed(b, info!.rotate, flat.W, flat.H)));
  });
  const selectedBox = $derived(shown.find((s) => s.mark.id === selected)?.boxes[0]);

  // a canvas font gives closer character widths than counting characters
  let measureCtx: CanvasRenderingContext2D | null | undefined;
  const measure: Measure = (s) => {
    if (measureCtx === undefined) {
      measureCtx = document.createElement('canvas').getContext('2d');
      if (measureCtx) measureCtx.font = '100px Helvetica, Arial, sans-serif';
    }
    return measureCtx ? measureCtx.measureText(s).width : s.length;
  };

  let session = 0;
  function open(next: OpenedPdf) {
    void pdf?.doc.destroy();
    const id = ++session;
    pdf = next;
    pageNo = 0;
    info = null;
    drawing = true;
    marks = [];
    matches = [];
    unplaced = new Set();
    selected = null;
    result = null;
    error = '';
    pageText = [];
    textReady = 0;
    textChars = 0;
    void readText(next, id);
  }

  async function readText(p: OpenedPdf, id: number) {
    for (let i = 0; i < p.doc.numPages; i++) {
      try {
        const text = await getText(p.doc, i);
        if (id !== session) return;
        const index = buildIndex(text.items);
        pageText[i] = { text, index };
        textChars += index.text.replace(/\s/g, '').length;
      } catch {
        if (id !== session) return; // a page whose text can't be read is just not searchable
      }
      textReady = i + 1;
    }
  }

  onMount(() => () => {
    session++;
    void pdf?.doc.destroy();
  });

  $effect(() => {
    const p = pdf;
    const i = pageNo;
    if (!p) return;
    let live = true;
    getPageSize(p.doc, i).then(
      (s) => live && (info = { ...s, page: i }),
      (e) => live && (error = e instanceof PdfError ? e.message : `Page ${i + 1} couldn't be read.`),
    );
    return () => (live = false);
  });

  // draws the page to fit the stage, sharp on high-density screens
  $effect(() => {
    const p = pdf;
    const i = pageNo;
    const width = Math.min(2400, Math.round(stageWidth * (devicePixelRatio || 1)));
    if (!p || !canvas || !info || !width) return;
    const target = canvas;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const page = await renderPage(p.doc, i, { width, signal: ctrl.signal });
        target.width = page.width;
        target.height = page.height;
        target.getContext('2d')!.drawImage(page, 0, 0);
        page.width = 0;
        drawing = false;
      } catch (e) {
        if (!isAbort(e)) error = e instanceof PdfError ? e.message : `Page ${i + 1} couldn't be shown.`;
      }
    }, 60);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  function search(matchers: Matcher[], ready: number): Match[] {
    const out: Match[] = [];
    for (let p = 0; p < ready && out.length < LIMIT; p++) {
      const data = pageText[p];
      if (!data) continue;
      for (const r of findRanges(data.index.text, matchers, LIMIT - out.length)) {
        out.push({ key: `${p}:${r.start}-${r.end}`, page: p, start: r.start, end: r.end, text: data.index.text.slice(r.start, r.end) });
      }
    }
    return out;
  }

  $effect(() => {
    const { matchers } = compiled;
    const ready = textReady;
    if (!matchers.length) {
      matches = [];
      return;
    }
    const t = setTimeout(() => (matches = search(matchers, ready)), 150);
    return () => clearTimeout(t);
  });

  function add(list: Omit<Mark, 'id'>[]) {
    if (!list.length) return [];
    const added = list.map((m) => ({ ...m, id: ++nextId }));
    marks = [...marks, ...added];
    result = null;
    return added;
  }

  function markMatches(list: Match[]) {
    const missed = new Set(unplaced);
    add(
      list.flatMap((m) => {
        const data = pageText[m.page]!;
        const boxes = rangeBoxes(data.text, data.index, m.start, m.end, measure);
        if (!boxes.length) missed.add(m.key);
        return boxes.length ? [{ page: m.page, kind: 'text' as const, text: m.text, key: m.key, boxes }] : [];
      }),
    );
    if (missed.size !== unplaced.size) unplaced = missed;
  }

  function remove(id: number) {
    marks = marks.filter((m) => m.id !== id);
    if (selected === id) selected = null;
    result = null;
  }

  function clearAll() {
    marks = [];
    selected = null;
    result = null;
  }

  function goTo(i: number) {
    const next = Math.max(0, Math.min(numPages - 1, i));
    if (next === pageNo) return;
    pageNo = next;
    selected = null;
    drawing = true;
  }

  function toggleWholePage() {
    if (wholePage) remove(wholePage.id);
    else add([{ page: pageNo, kind: 'page', boxes: [{ x: 0, y: 0, width: flat.W, height: flat.H }] }]);
  }

  function togglePreset(id: PresetId) {
    presets = presets.includes(id) ? presets.filter((p) => p !== id) : [...presets, id];
  }

  /* ---------------- drawing boxes ---------------- */

  /** pointer position in displayed page points */
  function point(e: PointerEvent) {
    const b = stage!.getBoundingClientRect();
    const k = info!.width / b.width;
    return { x: Math.max(0, Math.min(info!.width, (e.clientX - b.left) * k)), y: Math.max(0, Math.min(info!.height, (e.clientY - b.top) * k)), k };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !info || !ready || busy || drag || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const p = point(e);
    drag = { id: e.pointerId, x: p.x, y: p.y };
    draft = boxFrom(p.x, p.y, p.x, p.y);
    stage!.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const p = point(e);
    draft = boxFrom(drag.x, drag.y, p.x, p.y);
  }

  function up(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const start = drag;
    const box = draft;
    drag = draft = null;
    if (!box || !info || e.type !== 'pointerup') return;
    const min = 6 * point(e).k; // 6 css px
    if (box.width >= min && box.height >= min) {
      const [mark] = add([{ page: pageNo, kind: 'box', boxes: [toUnrotated(box, info.rotate, flat.W, flat.H)] }]);
      selected = mark.id;
    } else {
      // a click: pick the mark under the pointer, topmost first
      const hit = shown.findLast((s) => s.boxes.some((b) => containsPoint(b, start.x, start.y)));
      selected = hit?.mark.id ?? null;
    }
    if (selected !== null) requestAnimationFrame(() => removeBtn?.focus({ preventScroll: true }));
  }

  function removeKey(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (selected !== null) remove(selected);
    } else if (e.key === 'Escape') selected = null;
  }

  /* ---------------- saving ---------------- */

  async function run() {
    const p = pdf;
    if (!p || !marks.length || busy) return;
    const boxes = new Map<number, Box[]>();
    for (const m of marks) boxes.set(m.page, [...(boxes.get(m.page) ?? []), ...m.boxes]);
    const textMarks = marks.flatMap((m) => (m.text ? [{ page: m.page, text: m.text }] : []));
    error = '';
    result = null;
    selected = null;
    busy = 'Preparing…';
    try {
      const blob = await redactPdf({ file: p.file, password: p.password, view: p.doc, boxes, color, dpi, metadata: removeMeta, extras: removeExtras, onprogress: (s) => (busy = s) });
      const name = pdfName(p.file.name, '-redacted');
      downloadBlob(blob, name);
      busy = 'Checking the saved file…';
      const { pages, extras } = await readBack(blob, (s) => (busy = s));
      if (pdf !== p) return;
      result = { name, blob, pages: boxes.size, check: verifyRedaction(textMarks, pages, [...boxes.keys()], extras), unlocked: !!p.password };
    } catch (e) {
      console.error(e);
      if (pdf === p) error = e instanceof PdfError ? e.message : 'Something went wrong while redacting. Try a lower image quality, or reload the page and try again.';
    } finally {
      busy = null;
    }
  }

  /** marks the copies the check found on pages that weren't redacted */
  function markLeftovers() {
    if (!result) return;
    const found: Match[] = [];
    for (const left of result.check.leftovers) {
      const { matchers } = compileQuery({ text: left.text, regex: false, matchCase: false, wholeWord: false, presets: [] });
      for (const page of left.pages) {
        const data = pageText[page];
        if (!data) continue;
        for (const r of findRanges(data.index.text, matchers)) {
          const key = `${page}:${r.start}-${r.end}`;
          if (!markedKeys.has(key)) found.push({ key, page, start: r.start, end: r.end, text: data.index.text.slice(r.start, r.end) });
        }
      }
    }
    markMatches(found);
  }

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const place = (b: Box) => (info ? `left:${pct(b.x, info.width)};top:${pct(b.y, info.height)};width:${pct(b.width, info.width)};height:${pct(b.height, info.height)}` : '');
  const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : /(s|x|z|ch|sh)$/.test(word) ? 'es' : 's'}`;
  const markLabel = (m: Mark) => (m.kind === 'text' ? m.text! : m.kind === 'page' ? 'Whole page' : 'Drawn box');
</script>

{#if !pdf}
  <PdfDrop title="Drop a PDF to redact" hint="or click to choose · it stays on your device" onopen={open} />
{:else}
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <p class="mono min-w-0 truncate">
      <span class="text-chalk">{pdf.file.name}</span> · {plural(numPages, 'page')} · {formatBytes(pdf.file.size)}
    </p>
    {#if !busy}<PdfDrop compact title="Open another PDF" onopen={open} />{/if}
  </div>

  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="pager" role="group" aria-label="Pages">
          <button type="button" class="btn" aria-label="Previous page" disabled={pageNo === 0} onclick={() => goTo(pageNo - 1)}>‹</button>
          <label class="mono flex items-center gap-2">
            page
            <input
              class="field w-16! px-2! py-1.5! text-center"
              type="number"
              min="1"
              max={numPages}
              value={pageNo + 1}
              aria-label="Page number"
              onchange={(e) => {
                goTo(Math.round(Number(e.currentTarget.value)) - 1 || 0);
                e.currentTarget.value = String(pageNo + 1);
              }}
            />
            of {numPages}
          </label>
          <button type="button" class="btn" aria-label="Next page" disabled={pageNo >= numPages - 1} onclick={() => goTo(pageNo + 1)}>›</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn chip" aria-pressed={!!wholePage} disabled={!!busy || !ready} onclick={toggleWholePage}>
            {wholePage ? 'Unmark whole page' : 'Redact whole page'}
          </button>
          <div class="seg" role="group" aria-label="Preview">
            <button type="button" aria-pressed={!filled} onclick={() => (filled = false)}>outline</button>
            <button type="button" aria-pressed={filled} onclick={() => (filled = true)}>filled</button>
          </div>
        </div>
      </div>

      <div class="frame">
        {#if info}
          <div
            class="stage"
            class:busy={!!busy}
            style:--r={info.width / info.height}
            style:--ink={color}
            bind:this={stage}
            bind:clientWidth={stageWidth}
            role="presentation"
            onpointerdown={down}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
          >
            <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
            <canvas bind:this={canvas} class:dim={drawing} role="img" aria-label={`Page ${pageNo + 1} of ${numPages}`}></canvas>
            {#each pending as b, i (i)}
              <div class="box pending" style={place(b)} aria-hidden="true"></div>
            {/each}
            {#each shown as { mark, boxes } (mark.id)}
              {#each boxes as b, i (i)}
                <div class="box mark" class:filled class:selected={mark.id === selected} style={place(b)} aria-hidden="true"></div>
              {/each}
            {/each}
            {#if draft}
              <div class="box draft" style={place(draft)} aria-hidden="true"></div>
            {/if}
            {#if selectedBox}
              <button
                bind:this={removeBtn}
                type="button"
                class="remove"
                style:left={pct(selectedBox.x + selectedBox.width, info.width)}
                style:top={pct(selectedBox.y, info.height)}
                aria-label="Remove this mark (Delete)"
                onclick={() => selected !== null && remove(selected)}
                onkeydown={removeKey}
              >
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              </button>
            {/if}
          </div>
        {:else}
          <div class="grid min-h-[320px] place-items-center"><p class="mono">Loading page…</p></div>
        {/if}
      </div>
      <p class="mono flex flex-wrap justify-between gap-x-4 gap-y-1">
        <span>drag on the page to draw a box · click a mark to select it</span>
        {#if shown.length}<span class="text-chalk">{plural(shown.length, 'mark')} on this page</span>{/if}
      </p>
    </div>

    <aside class="grid content-start gap-5">
      <section class="panel">
        <label class="label" for="{uid}-find">find text to redact</label>
        <input
          id="{uid}-find"
          class="field"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder={find.regex ? String.raw`e.g. ID-\d{6}` : 'A name, word or phrase'}
          bind:value={find.text}
          aria-invalid={!!compiled.error}
          aria-describedby="{uid}-status"
          onkeydown={(e) => e.key === 'Enter' && fresh.length && markMatches(fresh)}
        />
        <div class="toggles mt-2" role="group" aria-label="Search options">
          <button type="button" aria-pressed={find.matchCase} onclick={() => (find.matchCase = !find.matchCase)}>Match case</button>
          <button type="button" aria-pressed={find.wholeWord} onclick={() => (find.wholeWord = !find.wholeWord)}>Whole word</button>
          <button type="button" aria-pressed={find.regex} onclick={() => (find.regex = !find.regex)}>Regex</button>
        </div>

        <span class="label mt-4">or find every</span>
        <div class="presets" role="group" aria-label="Find common personal data">
          {#each Object.entries(PRESETS) as [id, p] (id)}
            <button type="button" aria-pressed={presets.includes(id as PresetId)} title={`e.g. ${p.example}`} onclick={() => togglePreset(id as PresetId)}>{p.label}</button>
          {/each}
        </div>

        <p id="{uid}-status" class="mono mt-3 min-h-[1.5em] {compiled.error ? 'text-bad!' : ''}" aria-live="polite">
          {#if compiled.error}
            {compiled.error}
          {:else if compiled.matchers.length}
            {#if matches.length}
              <span class="text-chalk">{plural(matches.length, 'match')}</span> on {plural(matchPages, 'page')}{matches.length >= LIMIT ? ' (showing the first 5,000)' : ''}
            {:else if !reading}
              No matches.
            {/if}
            {#if reading}<span class="block">reading text… {textReady} of {numPages} pages</span>{/if}
          {/if}
        </p>
        {#if unplacedHere.length}
          <p class="note mt-2">
            {plural(unplacedHere.length, 'match')} on page {[...new Set(unplacedHere.map((m) => m.page + 1))].slice(0, 8).join(', ')} couldn't be located on the page (vertical text, for example), so they aren't marked. Draw boxes over them or redact those whole pages.
          </p>
        {/if}
        {#if noText}
          <p class="note mt-2">No selectable text was found, so this may be a scanned document. Search can't see words in a scan; draw boxes over what you want to hide instead.</p>
        {/if}
        <button type="button" class="btn btn-primary mt-3 w-full" disabled={!fresh.length || !!busy} onclick={() => markMatches(fresh)}>
          {fresh.length ? `Mark ${plural(fresh.length, 'match')}` : matches.length ? 'All matches marked' : 'Mark matches'}
        </button>
      </section>

      <section class="panel">
        <div class="mb-2 flex items-baseline justify-between gap-2">
          <h3 class="text-[22px] leading-none">Marks</h3>
          {#if marks.length}
            <button type="button" class="mono cursor-pointer underline decoration-line-2 underline-offset-4 hover:text-chalk" disabled={!!busy} onclick={clearAll}>clear all</button>
          {/if}
        </div>
        {#if marks.length}
          <p class="mono mb-2">{plural(marks.length, 'mark')} on {plural(markedPages, 'page')}</p>
          <div class="review">
            {#each groups as [page, list] (page)}
              <div class="group">
                <button type="button" class="page-link mono" aria-current={page === pageNo ? 'page' : undefined} onclick={() => goTo(page)}>Page {page + 1}</button>
                <ul>
                  {#each list as m (m.id)}
                    <li class:selected={m.id === selected}>
                      <button
                        type="button"
                        class="what"
                        class:plain={m.kind !== 'text'}
                        onclick={() => {
                          goTo(m.page);
                          selected = m.id;
                        }}>{markLabel(m)}</button
                      >
                      <button type="button" class="x" aria-label={`Remove mark: ${markLabel(m)} on page ${m.page + 1}`} disabled={!!busy} onclick={() => remove(m.id)}>
                        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty">Nothing marked yet. Drag a box over anything on the page, or find text above. Every mark is listed here so you can check it before saving.</p>
        {/if}
      </section>

      <section class="grid gap-4">
        <div>
          <span class="label">box color</span>
          <div class="flex gap-2" role="group" aria-label="Box color">
            {#each COLORS as [value, name] (value)}
              <button type="button" class="swatch" aria-pressed={color === value} aria-label={name} title={name} style:--c={value} onclick={() => (color = value)}></button>
            {/each}
          </div>
        </div>
        <div>
          <span class="label">image quality of redacted pages</span>
          <div class="seg" role="group" aria-label="Image quality">
            {#each QUALITY as q (q)}
              <button type="button" aria-pressed={dpi === q} onclick={() => (dpi = q)}>{q} dpi</button>
            {/each}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={removeMeta} />
          <span>Remove metadata <span class="mono block">title, author, producer, dates and XMP</span></span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={removeExtras} />
          <span>Remove hidden extras <span class="mono block">comments, links, form fields, bookmarks, attachments and scripts</span></span>
        </label>

        <p class="note">Pages with marks are rebuilt as images at {dpi} dpi, so their text is truly gone and can't be selected or searched afterwards. Pages without marks keep their text and quality{removeExtras ? ', minus the hidden extras above' : ' exactly as they were'}.</p>

        <button type="button" class="btn btn-primary" disabled={!marks.length || !!busy} onclick={run}>
          {#if busy}<span class="spinner" aria-hidden="true"></span>{/if}
          {busy ? 'Working…' : marks.length ? `Redact ${plural(markedPages, 'page')} & download` : 'Redact & download'}
        </button>
        {#if busy}<p class="mono" role="status">{busy}</p>{/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      </section>
    </aside>
  </div>

  {#if result}
    {@const { check } = result}
    {@const clean = !check.leftovers.length && !check.textOnRedacted.length}
    <div class="result" class:warn={!clean} role="status">
      <svg class="tick" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" />
        <path d="M12.5 20.5l5 5 10-11" />
      </svg>
      <div class="min-w-0 flex-1">
        <h3 class="text-[26px] leading-tight">
          {#if check.total}
            {check.confirmed === check.total ? plural(check.total, 'match') : `${check.confirmed.toLocaleString('en-US')} of ${plural(check.total, 'match')}`} confirmed removed
          {:else}
            {plural(result.pages, 'page')} redacted
          {/if}
        </h3>
        <p class="mono mt-1 break-all">{result.name} · {formatBytes(result.blob.size)} · downloaded</p>
        {#if clean}
          <p class="mt-2 text-soft">
            We opened the saved file and read it back: the {plural(result.pages, 'redacted page')} hold no text, only the image you previewed{check.total ? ', and none of the marked text turns up anywhere else in the file' : ''}.
          </p>
        {:else}
          {#if check.textOnRedacted.length}
            <p class="mt-2 text-bad">Text could still be read on page {check.textOnRedacted.map((i) => i + 1).join(', ')}. Please don't share this file; reload the page and try again.</p>
          {/if}
          {#if check.leftovers.length}
            <p class="mt-2 text-soft">We read the saved file back. The marked pages are clean, but some of the same text appears elsewhere:</p>
            <ul class="leftovers">
              {#each check.leftovers.slice(0, 6) as left (left.text)}
                <li>
                  <span class="text-chalk">“{left.text}”</span>
                  {[left.pages.length ? `on page ${left.pages.map((i) => i + 1).join(', ')}` : '', ...left.places.map((w) => `in ${w}`)].filter(Boolean).join(' · ')}
                </li>
              {/each}
            </ul>
            {#if check.leftovers.length > 6}<p class="mono">and {check.leftovers.length - 6} more</p>{/if}
            {#if check.leftovers.some((l) => l.places.length)}
              <p class="mono mt-2">The cleanup options remove metadata, bookmarks and comments.</p>
            {/if}
          {/if}
        {/if}
        {#if result.unlocked}
          <p class="mono mt-2">The original needed a password; this copy doesn't. Add one with <a class="text-sun underline-offset-2 hover:underline" href="/protect-pdf">Protect PDF</a> if you need it.</p>
        {/if}
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn" onclick={() => result && downloadBlob(result.blob, result.name)}>Download again</button>
          {#if check.leftovers.some((l) => l.pages.length)}
            <button type="button" class="btn" onclick={markLeftovers}>Mark the remaining copies</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    gap: 8px;
    & .btn {
      width: 38px;
      height: 38px;
      padding: 0;
      font-size: 20px;
    }
  }
  .chip {
    padding: 9px 14px;
    font-size: 14px;
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .frame {
    display: flex;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: #0e0d0c;
  }
  /* sized from the page ratio so the marks line up with the canvas exactly */
  .stage {
    position: relative;
    flex: none;
    width: min(100%, calc(min(72vh, 820px) * var(--r)));
    aspect-ratio: var(--r);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: crosshair;
    box-shadow: 0 12px 40px #0008;
    &.busy {
      pointer-events: none;
    }
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: #fff;
    transition: opacity 0.2s;
    &.dim {
      opacity: 0.5;
    }
  }
  .box {
    position: absolute;
    pointer-events: none;
  }
  .mark {
    outline: 1.5px solid var(--color-pdf);
    background: repeating-linear-gradient(-45deg, #ff8fb84d 0 3px, #ff8fb81a 3px 7px);
    animation: ink 0.25s var(--ease-spring);
    &.filled {
      background: var(--ink);
      outline: 1px solid #ff8fb866;
    }
    &.selected {
      outline: 2px solid var(--color-sun);
      z-index: 1;
    }
  }
  .pending {
    outline: 1.5px dashed var(--color-sun);
    background: #ffd25e26;
  }
  .draft {
    outline: 1.5px dashed var(--color-pdf);
    background: #ff8fb826;
  }
  @keyframes ink {
    from {
      transform: scale(0.85);
      opacity: 0;
    }
  }
  .remove {
    position: absolute;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    translate: -50% -50%;
    border-radius: 50%;
    border: 2px solid var(--color-bg);
    background: var(--color-sun);
    color: var(--color-bg);
    cursor: pointer;
    &::after {
      content: '';
      position: absolute;
      inset: -10px;
    }
  }

  .panel {
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
  }
  .toggles,
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    & button {
      font: 400 12.5px var(--font-mono);
      color: var(--color-muted);
      background: #141312;
      border: 1px solid var(--color-line-2);
      border-radius: 999px;
      padding: 6px 11px;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s, background 0.2s;
      &:hover {
        border-color: var(--color-muted);
      }
      &[aria-pressed='true'] {
        color: var(--color-bg);
        background: var(--color-sun);
        border-color: var(--color-sun);
      }
    }
  }
  .note {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--color-soft);
    padding: 10px 12px;
    border-left: 2px solid var(--color-pdf);
    background: #ff8fb80d;
    border-radius: 0 10px 10px 0;
  }
  .empty {
    font-size: 14px;
    color: var(--color-muted);
  }
  .review {
    display: grid;
    gap: 10px;
    max-height: 340px;
    overflow-y: auto;
    margin-inline: -6px;
    padding-inline: 6px;
  }
  .page-link {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: var(--color-pdf);
    &[aria-current='page'] {
      color: var(--color-sun);
    }
    &:hover {
      text-decoration: underline;
    }
  }
  .group ul {
    display: grid;
    gap: 4px;
    margin-top: 4px;
  }
  .group li {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-line);
    border-radius: 9px;
    background: #141312;
    &.selected {
      border-color: var(--color-sun);
    }
  }
  .what {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    padding: 6px 0 6px 10px;
    font: 400 13px var(--font-mono);
    color: var(--color-chalk);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    &.plain {
      color: var(--color-muted);
      font-style: italic;
    }
  }
  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: 2px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    &:hover {
      color: var(--color-bad);
      background: #ff7a6b1a;
    }
  }
  .swatch {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--c);
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &[aria-pressed='true'] {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
    &:active {
      transform: scale(0.92);
    }
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 15px;
    cursor: pointer;
    & input {
      margin-top: 4px;
      width: 16px;
      height: 16px;
      accent-color: var(--color-sun);
    }
  }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #13121155;
    border-top-color: var(--color-bg);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .result {
    display: flex;
    gap: 16px;
    margin-top: 24px;
    padding: 20px;
    border: 1px solid #9be58f55;
    border-radius: 18px;
    background: #9be58f0d;
    animation: rise 0.4s var(--ease-spring);
    &.warn {
      border-color: #ffd25e55;
      background: #ffd25e0a;
      & .tick {
        stroke: var(--color-sun);
      }
    }
  }
  .tick {
    flex: none;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 114;
      animation: draw 0.6s ease-out both;
    }
    & path {
      stroke-dasharray: 26;
      animation: draw 0.35s 0.45s ease-out both;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: var(--len, 114);
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  .tick path {
    --len: 26;
  }
  @keyframes rise {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
  .leftovers {
    display: grid;
    gap: 4px;
    margin-top: 8px;
    font-size: 14px;
    color: var(--color-soft);
    overflow-wrap: anywhere;
    & li::before {
      content: '· ';
      color: var(--color-sun);
    }
  }
  @media (max-width: 420px) {
    .result {
      flex-direction: column;
    }
  }
</style>
