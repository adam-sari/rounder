<script lang="ts">
  import { tick, untrack } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import { embedFontWithFallback, isWinAnsi, loadEditablePdf, loadPdfLib, missingGlyphs, PdfError, pdfName, savePdf, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import type { FieldValue, FormField } from '@/tools/lib/fill-pdf-form/form';
  import { fontTexts, isFilled, overlayFontPt, sameValue } from '@/tools/lib/fill-pdf-form/values';

  /** one widget placed on a page; positions are % of the page, sizes in cqw so they scale with it */
  interface Box {
    field: number;
    widget: number;
    l: number;
    t: number;
    w: number;
    h: number;
    fs: number;
    cell?: number;
    option?: string;
  }
  interface PageView {
    ratio: number;
    boxes: Box[];
  }

  const formLib = () => import('@/tools/lib/fill-pdf-form/form');
  const uid = $props.id();

  let phase = $state<'idle' | 'loading' | 'edit' | 'flat' | 'xfa' | 'error'>('idle');
  let error = $state('');
  let file = $state.raw<File | null>(null);
  let pdf: PdfDoc | null = null;
  let bytes: Uint8Array | null = null;
  let decrypted = $state(false);
  let xfa = $state(false);
  let signatures = $state(0);
  let fields = $state.raw<FormField[]>([]);
  let values = $state<FieldValue[]>([]);
  let pages = $state.raw<PageView[]>([]);
  let images = $state<({ url: string; width: number } | undefined)[]>([]);
  let broken = $state<boolean[]>([]);

  let view = $state<'pages' | 'list'>('pages');
  let active = $state<number | null>(null);
  let flash = $state<number | null>(null);
  let flatten = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let result = $state.raw<{ blob: Blob; name: string; failed: string[] } | null>(null);
  let missing = $state<string[]>([]);
  let colWidth = $state(0);
  let listEl = $state<HTMLElement>();
  let session = 0;
  /** bumped on every edit, so a save that finishes after more typing doesn't claim to be current */
  let edits = 0;

  const copy = (v: FieldValue) => (Array.isArray(v) ? [...v] : v);
  const fillable = $derived(fields.filter((f) => !f.readOnly).length);
  const filled = $derived(fields.filter((f, i) => !f.readOnly && isFilled(values[i])).length);
  const changed = $derived(fields.filter((f, i) => !f.readOnly && !sameValue(values[i], f.value)).length);
  const emptyRequired = $derived(fields.flatMap((f, i) => (f.required && !f.readOnly && !isFilled(values[i]) ? [i] : [])));
  const placed = (f: FormField) => f.widgets.findIndex((w) => w.page >= 0 && w.page < pages.length);

  // fields for the list, grouped under the first page they appear on (unplaced ones last)
  const groups = $derived.by(() => {
    const map = new Map<number, number[]>();
    fields.forEach((f, i) => {
      const at = placed(f);
      const page = at < 0 ? -1 : f.widgets[at].page;
      map.set(page, [...(map.get(page) ?? []), i]);
    });
    return [...map].sort(([a], [b]) => (a < 0 ? Infinity : a) - (b < 0 ? Infinity : b));
  });

  /* ---------------- opening ---------------- */

  async function open({ file: f, doc, password }: OpenedPdf) {
    teardown();
    const id = session;
    file = f;
    pdf = doc;
    phase = 'loading';
    try {
      const [editable, { readForm }] = await Promise.all([loadEditablePdf(f, { password }), formLib()]);
      if (id !== session) return;
      const info = readForm(editable.doc);
      bytes = editable.bytes;
      decrypted = editable.decrypted;
      xfa = info.xfa;
      signatures = info.signatures;
      if (!info.fields.length) {
        phase = info.xfa ? 'xfa' : 'flat';
        return;
      }
      const views = await layout(doc, info.fields);
      if (id !== session) return;
      fields = info.fields;
      values = info.fields.map((x) => copy(x.value));
      pages = views;
      images = Array(doc.numPages).fill(undefined);
      broken = Array(doc.numPages).fill(false);
      phase = 'edit';
    } catch (e) {
      if (id !== session) return;
      error = e instanceof PdfError ? e.message : `This PDF couldn't be read (${(e as Error)?.message ?? e}).`;
      phase = 'error';
    }
  }

  /** Converts widget rectangles to page percentages using pdf.js's viewport (handles crop boxes and /Rotate) */
  async function layout(doc: PdfDoc, list: FormField[]): Promise<PageView[]> {
    const vps = await Promise.all(Array.from({ length: doc.numPages }, async (_, i) => (await doc.getPage(i)).getViewport({ scale: 1 })));
    const views: PageView[] = vps.map((vp) => ({ ratio: vp.width / vp.height, boxes: [] }));
    list.forEach((f, field) =>
      f.widgets.forEach((w, widget) => {
        const vp = vps[w.page];
        if (!vp) return;
        const [x1, y1] = vp.convertToViewportPoint(w.rect[0], w.rect[1]) as number[];
        const [x2, y2] = vp.convertToViewportPoint(w.rect[2], w.rect[3]) as number[];
        const [W, H] = [vp.width, vp.height];
        const [bw, bh] = [Math.abs(x2 - x1), Math.abs(y2 - y1)];
        views[w.page].boxes.push({
          field,
          widget,
          l: (Math.min(x1, x2) / W) * 100,
          t: (Math.min(y1, y2) / H) * 100,
          w: (bw / W) * 100,
          h: (bh / H) * 100,
          fs: (overlayFontPt(f, bh) / W) * 100,
          cell: f.comb && f.maxLength ? (bw / f.maxLength / W) * 100 : undefined,
          option: w.option,
        });
      }),
    );
    return views;
  }

  function teardown() {
    session++;
    for (const img of images) if (img) URL.revokeObjectURL(img.url);
    observer?.disconnect();
    observer = undefined;
    visible.clear();
    pumping = false;
    void pdf?.destroy();
    pdf = null;
    bytes = null;
    file = null;
    fields = [];
    pages = [];
    values = [];
    images = [];
    broken = [];
    result = null;
    error = saveError = '';
    missing = [];
    active = null;
    phase = 'idle';
  }

  $effect(() => () => teardown());

  /* ---------------- page images, rendered as they scroll into view ---------------- */

  let observer: IntersectionObserver | undefined;
  const visible = new Set<number>();
  let pumping = false;

  // a crisp render for the column width, in steps so resizing doesn't re-render constantly
  const target = $derived(Math.min(2400, Math.max(800, Math.ceil((colWidth * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) / 400) * 400)));

  function watchPage(node: HTMLElement) {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        void pump();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer?.unobserve(node);
  }

  $effect(() => {
    void target;
    untrack(() => void pump());
  });

  async function pump() {
    if (pumping || !pdf) return;
    pumping = true;
    const id = session;
    const doc = pdf;
    try {
      const { renderFormPage } = await import('@/tools/lib/fill-pdf-form/render');
      for (;;) {
        if (id !== session) return;
        const width = target;
        const next = [...visible].sort((a, b) => a - b).find((i) => !broken[i] && (images[i]?.width ?? 0) < width);
        if (next === undefined) break;
        try {
          const url = await renderFormPage(doc, next, width);
          if (id !== session) return URL.revokeObjectURL(url);
          const old = images[next];
          images[next] = { url, width };
          if (old) URL.revokeObjectURL(old.url);
          evict(next);
        } catch {
          if (id !== session) return;
          broken[next] = true;
        }
      }
    } catch {
      // the renderer chunk failed to load; pages keep their placeholders and the next scroll retries
    } finally {
      if (id === session) pumping = false;
    }
  }

  // full-width page images add up on long forms, so off-screen ones furthest from `near` are dropped and redrawn on return
  const KEEP_IMAGES = 24;
  function evict(near: number) {
    const held = images.flatMap((img, i) => (img && !visible.has(i) ? [i] : []));
    const extra = held.length + visible.size - KEEP_IMAGES;
    if (extra <= 0) return;
    for (const i of held.sort((a, b) => Math.abs(b - near) - Math.abs(a - near)).slice(0, extra)) {
      URL.revokeObjectURL(images[i]!.url);
      images[i] = undefined;
    }
  }

  /* ---------------- editing ---------------- */

  function set(field: number, value: FieldValue) {
    values[field] = value;
    edits++;
    result = null;
  }

  function resetValues() {
    values = fields.map((f) => copy(f.value));
    edits++;
    result = null;
  }

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Jumps from the list to the field on the page */
  async function locate(field: number) {
    const at = placed(fields[field]);
    // fields that aren't on any page can only be filled from the list
    view = at < 0 ? 'list' : 'pages';
    await tick();
    const el = at < 0 ? listEl?.querySelector<HTMLElement>(`[data-item="${field}"] :is(input, select, textarea)`) : document.getElementById(`${uid}-f${field}-${at}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    if (at < 0) return;
    flash = field;
    setTimeout(() => flash === field && (flash = null), 1200);
  }

  /** Keeps the list's matching row in sight while tabbing through the page */
  function revealInList(field: number) {
    const list = listEl;
    const row = list?.querySelector<HTMLElement>(`[data-item="${field}"]`);
    if (!list || !row || list.scrollHeight <= list.clientHeight) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: row.offsetTop - list.clientHeight / 3, behavior: reduced() ? 'auto' : 'smooth' });
    }
  }

  function focusIn(e: FocusEvent, fromPage: boolean) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-field]');
    if (!el) return;
    active = Number(el.dataset.field);
    if (fromPage) revealInList(active);
  }

  // warn about characters the bundled font can't draw (CJK, emoji…) before they turn into blanks
  $effect(() => {
    const text = fontTexts(fields, values).join('\n');
    if (isWinAnsi(text)) {
      missing = [];
      return;
    }
    let stale = false;
    const t = setTimeout(() => missingGlyphs(text).then((m) => !stale && (missing = m), () => !stale && (missing = [])), 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  // typed answers live only in this tab, so ask before leaving with unsaved ones
  $effect(() => {
    if (!changed || result) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });

  /* ---------------- saving ---------------- */

  async function save() {
    if (!bytes || !file || saving) return;
    saving = true;
    saveError = '';
    const id = session;
    // the answers as they are now; typing while it saves shouldn't half-apply
    const snapshot = $state.snapshot(values) as FieldValue[];
    const changes = fields.flatMap((f, i) => (f.readOnly || sameValue(snapshot[i], f.value) ? [] : [{ index: f.index, name: f.name, value: snapshot[i] }]));
    const texts = fontTexts(fields, snapshot);
    const name = pdfName(file.name, '-filled');
    const flat = flatten;
    const at = edits;
    try {
      const [{ fillForm }, doc] = await Promise.all([formLib(), loadPdfLib(bytes)]);
      const font = await embedFontWithFallback(doc, texts);
      const failed = fillForm(doc, changes, { font, flatten: flat });
      const blob = await savePdf(doc, { updateFieldAppearances: false });
      if (id !== session) return;
      downloadBlob(blob, name);
      result = at === edits && flat === flatten ? { blob, name, failed } : null;
    } catch (e) {
      if (id === session) saveError = e instanceof PdfError ? e.message : `The filled PDF couldn't be saved (${(e as Error)?.message ?? e}).`;
    } finally {
      saving = false;
    }
  }
</script>

{#snippet onPage(b: Box)}
  {@const f = fields[b.field]}
  {@const v = values[b.field]}
  {@const id = `${uid}-f${b.field}-${b.widget}`}
  <div
    class="fld"
    class:active={active === b.field}
    class:flash={flash === b.field}
    class:need={f.required && !f.readOnly && !isFilled(v)}
    data-field={b.field}
    style="left:{b.l}%;top:{b.t}%;width:{b.w}%;height:{b.h}%;--fs:{b.fs}cqw;{b.cell ? `--cell:${b.cell}cqw` : ''}"
  >
    {#if f.kind === 'text' && f.multiline}
      <textarea {id} value={v as string} maxlength={f.maxLength} disabled={f.readOnly} aria-label={f.label} aria-required={f.required} style:text-align={f.align} spellcheck="true" oninput={(e) => set(b.field, e.currentTarget.value)}></textarea>
    {:else if f.kind === 'text'}
      <input
        {id}
        type={f.password ? 'password' : 'text'}
        class:comb={b.cell}
        value={v as string}
        maxlength={f.maxLength}
        disabled={f.readOnly}
        aria-label={f.label}
        aria-required={f.required}
        style:text-align={b.cell ? undefined : f.align}
        autocomplete="off"
        oninput={(e) => set(b.field, e.currentTarget.value)}
      />
    {:else if f.kind === 'checkbox'}
      <input {id} type="checkbox" checked={v as boolean} disabled={f.readOnly} aria-label={f.label} aria-required={f.required} onchange={(e) => set(b.field, e.currentTarget.checked)} />
    {:else if f.kind === 'radio'}
      <input {id} type="radio" name="{uid}-p{b.field}" checked={!!b.option && v === b.option} disabled={f.readOnly} aria-label="{f.label}: {b.option}" onchange={() => set(b.field, b.option ?? '')} />
    {:else if f.kind === 'dropdown' && f.editable}
      <input {id} value={v as string} list="{uid}-dl{b.field}" disabled={f.readOnly} aria-label={f.label} aria-required={f.required} autocomplete="off" oninput={(e) => set(b.field, e.currentTarget.value)} />
    {:else if f.kind === 'dropdown'}
      <select {id} value={v} disabled={f.readOnly} aria-label={f.label} aria-required={f.required} onchange={(e) => set(b.field, e.currentTarget.value)}>
        <option value=""></option>
        {#if v && !f.options.includes(v as string)}<option value={v}>{v}</option>{/if}
        {#each f.options as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {:else}
      <select
        {id}
        multiple={f.multiSelect}
        size={Math.max(2, f.options.length)}
        disabled={f.readOnly}
        aria-label={f.label}
        onchange={(e) => set(b.field, Array.from(e.currentTarget.selectedOptions, (o) => o.value))}
      >
        {#each f.options as o (o)}<option value={o} selected={(v as string[]).includes(o)}>{o}</option>{/each}
      </select>
    {/if}
  </div>
{/snippet}

{#snippet inList(i: number)}
  {@const f = fields[i]}
  {@const v = values[i]}
  {@const id = `${uid}-s${i}`}
  <div class="item" class:active={active === i} data-item={i} data-field={i}>
    <div class="item-head">
      {#if f.kind === 'checkbox'}
        <label class="check">
          <input {id} type="checkbox" checked={v as boolean} disabled={f.readOnly} aria-required={f.required} onchange={(e) => set(i, e.currentTarget.checked)} />
          <span>{f.label}{#if f.required}<span class="req" aria-hidden="true">*</span>{/if}</span>
        </label>
      {:else if f.kind === 'radio' || (f.kind === 'list' && f.multiSelect)}
        <span class="label name" id="{id}-l">{f.label}{#if f.required}<span class="req" aria-hidden="true">*</span>{/if}</span>
      {:else}
        <label class="label name" for={id}>{f.label}{#if f.required}<span class="req" aria-hidden="true">*</span>{/if}</label>
      {/if}
      {#if placed(f) >= 0}
        <button type="button" class="locate" title="Show on the page" aria-label="Show {f.label} on the page" onclick={() => locate(i)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></svg>
        </button>
      {/if}
    </div>

    {#if f.kind === 'text' && f.multiline}
      <textarea {id} class="field small" rows="3" value={v as string} maxlength={f.maxLength} disabled={f.readOnly} aria-required={f.required} oninput={(e) => set(i, e.currentTarget.value)}></textarea>
    {:else if f.kind === 'text'}
      <input {id} class="field small" type={f.password ? 'password' : 'text'} value={v as string} maxlength={f.maxLength} disabled={f.readOnly} aria-required={f.required} autocomplete="off" oninput={(e) => set(i, e.currentTarget.value)} />
      {#if f.maxLength && !f.readOnly}<span class="mono count">{(v as string).length}/{f.maxLength}</span>{/if}
    {:else if f.kind === 'radio'}
      <div class="pills" role="radiogroup" aria-labelledby="{id}-l" aria-required={f.required}>
        {#each f.options as o (o)}
          <label class="pill" class:on={v === o}>
            <input type="radio" name="{uid}-s{i}" value={o} checked={v === o} disabled={f.readOnly} onchange={() => set(i, o)} />
            {o}
          </label>
        {/each}
        {#if v && !f.readOnly}<button type="button" class="clear mono" onclick={() => set(i, '')}>clear</button>{/if}
      </div>
    {:else if f.kind === 'dropdown' && f.editable}
      <input {id} class="field small" value={v as string} list="{uid}-dl{i}" disabled={f.readOnly} aria-required={f.required} autocomplete="off" oninput={(e) => set(i, e.currentTarget.value)} />
    {:else if f.kind === 'dropdown' || (f.kind === 'list' && !f.multiSelect)}
      {@const current = Array.isArray(v) ? (v[0] ?? '') : (v as string)}
      <select {id} class="field small" value={current} disabled={f.readOnly} aria-required={f.required} onchange={(e) => set(i, f.kind === 'list' ? (e.currentTarget.value ? [e.currentTarget.value] : []) : e.currentTarget.value)}>
        <option value="">Choose…</option>
        {#if current && !f.options.includes(current)}<option value={current}>{current}</option>{/if}
        {#each f.options as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {:else if f.kind === 'list'}
      <div class="checks" role="group" aria-labelledby="{id}-l">
        {#each f.options as o (o)}
          <label class="check">
            <input type="checkbox" checked={(v as string[]).includes(o)} disabled={f.readOnly} onchange={(e) => set(i, e.currentTarget.checked ? [...(v as string[]), o] : (v as string[]).filter((x) => x !== o))} />
            <span>{o}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="ff">
  {#if phase === 'idle'}
    <PdfDrop title="Drop a PDF form here" hint="or click to choose · nothing is uploaded" onopen={open} />
  {:else if phase === 'loading'}
    <div class="state" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <p class="mono">Reading the form fields in {file?.name}…</p>
    </div>
  {:else if phase === 'error'}
    <div class="state" role="alert">
      <p class="font-serif text-[24px] text-chalk">That didn't work</p>
      <p class="text-bad max-w-[52ch]">{error}</p>
      <button type="button" class="btn mt-2" onclick={teardown}>Try another PDF</button>
    </div>
  {:else if phase === 'flat' || phase === 'xfa'}
    <div class="state">
      <svg class="art" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M16 6h22l10 10v42H16z" /><path d="M38 6v10h10" /><path d="M23 28h18M23 36h18M23 44h10" class="ruled" />
        {#if phase === 'flat'}<path d="M42 50l10-10 4 4-10 10h-4z" class="pen" />{/if}
      </svg>
      {#if phase === 'flat'}
        <h3 class="text-[28px] leading-tight">No fillable fields here</h3>
        <p class="max-w-[54ch] text-soft">
          <span class="break-all text-chalk">{file?.name}</span> is a flat PDF: its boxes and lines are printed on the page rather than built in as form fields, so there's nothing to type into.
          {#if signatures}It does have {signatures === 1 ? 'a signature field' : `${signatures} signature fields`}, which you can sign with <a class="link" href="/sign-pdf">Sign PDF</a>.{/if}
        </p>
        <p class="max-w-[54ch] text-soft">You can still fill it in. Edit PDF lets you click anywhere on a page and type.</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <a class="btn btn-primary" href="/edit-pdf">Fill it with Edit PDF →</a>
          <button type="button" class="btn" onclick={teardown}>Try another PDF</button>
        </div>
        <p class="mono mt-1">You'll choose the file again there. It stays on your device either way.</p>
      {:else}
        <h3 class="text-[28px] leading-tight">This is an XFA form</h3>
        <p class="max-w-[56ch] text-soft">
          <span class="break-all text-chalk">{file?.name}</span> was built with Adobe LiveCycle (XFA). Its fields only exist inside Adobe's own form engine, so browsers and most PDF apps, including this tool, can't show or fill them.
        </p>
        <p class="max-w-[56ch] text-soft">Open it in the free Adobe Acrobat Reader to fill it in. If you can, ask whoever sent it for a standard PDF form, which will work here.</p>
        <button type="button" class="btn mt-3" onclick={teardown}>Try another PDF</button>
      {/if}
    </div>
  {:else}
    <div class="head">
      <p class="file">
        <span class="font-medium text-chalk">{file?.name}</span>
        <span class="mono"> · {pages.length} {pages.length === 1 ? 'page' : 'pages'} · {fields.length} {fields.length === 1 ? 'field' : 'fields'}</span>
      </p>
      <div class="flex gap-2">
        <button type="button" class="btn tb" disabled={!changed || saving} onclick={resetValues}>Undo changes</button>
        <button type="button" class="btn tb" disabled={saving} onclick={teardown}>Open another PDF</button>
      </div>
      <div class="progress" aria-hidden="true"><span style:width="{fillable ? (filled / fillable) * 100 : 0}%"></span></div>
    </div>

    {#if xfa || signatures}
      <div class="notes">
        {#if xfa}
          <p class="note">This form also carries an Adobe XFA version. Your copy keeps the standard fields only, so your answers show up in every PDF viewer.</p>
        {/if}
        {#if signatures}
          <p class="note">{signatures === 1 ? 'There is a signature field' : `There are ${signatures} signature fields`} too. Fill and download first, then sign with <a class="link" href="/sign-pdf">Sign PDF</a>.</p>
        {/if}
      </div>
    {/if}

    <div class="seg viewtoggle" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'pages'} onclick={() => (view = 'pages')}>On the page</button>
      <button type="button" aria-pressed={view === 'list'} onclick={() => (view = 'list')}>As a list</button>
    </div>

    <div class="layout" data-view={view}>
      <section class="pages" aria-label="Form pages" bind:clientWidth={colWidth} onfocusin={(e) => focusIn(e, true)}>
        {#each pages as p, i (i)}
          <div class="page" style:aspect-ratio={p.ratio} data-page={i} role="group" aria-label="Page {i + 1} of {pages.length}" {@attach watchPage}>
            {#if images[i]}
              <img src={images[i]!.url} alt="" draggable="false" />
            {:else}
              <span class="mono pending" class:bad={broken[i]}>{broken[i] ? `Page ${i + 1} couldn't be drawn` : `Page ${i + 1}`}</span>
            {/if}
            {#each p.boxes as b (`${b.field}-${b.widget}`)}
              {@render onPage(b)}
            {/each}
          </div>
        {/each}
      </section>

      <aside class="list" aria-label="All fields" bind:this={listEl} onfocusin={(e) => focusIn(e, false)}>
        <p class="mono tally">{filled} of {fillable} filled</p>
        {#each groups as [page, ids] (page)}
          <h3 class="mono group">{page < 0 ? 'Not shown on a page' : `Page ${page + 1}`}</h3>
          {#each ids as i (i)}
            {@render inList(i)}
          {/each}
        {/each}
      </aside>
    </div>

    {#each fields as f, i (i)}
      {#if f.kind === 'dropdown' && f.editable}
        <datalist id="{uid}-dl{i}">
          {#each f.options as o (o)}<option value={o}></option>{/each}
        </datalist>
      {/if}
    {/each}

    <div class="savebar">
      <label class="check flat">
        <input type="checkbox" bind:checked={flatten} onchange={() => (result = null)} />
        <span>Flatten <span class="mono">make answers part of the page, no longer editable</span></span>
      </label>
      <div class="status">
        {#if saving}
          <p class="mono" role="status"><span class="spinner sm" aria-hidden="true"></span> Writing your answers…</p>
        {:else if result}
          <p class="text-sm done" role="status">
            <span class="tick" aria-hidden="true">✓</span>
            <span class="font-medium break-all">{result.name}</span>
            <span class="mono">· {formatBytes(result.blob.size)} · <button type="button" class="link" onclick={() => downloadBlob(result!.blob, result!.name)}>download again</button></span>
          </p>
          {#if result.failed.length}
            <p class="mono mt-1 text-bad">Couldn't redraw {result.failed.join(', ')}; check {result.failed.length === 1 ? 'it' : 'them'} in your PDF viewer.</p>
          {/if}
          {#if decrypted}
            <p class="mono mt-1">The saved copy has no password. Add one with <a class="link" href="/protect-pdf">Protect PDF</a> if you need it.</p>
          {/if}
        {:else if emptyRequired.length}
          <p class="mono">
            {emptyRequired.length} required {emptyRequired.length === 1 ? 'field is' : 'fields are'} empty ·
            <button type="button" class="link" onclick={() => locate(emptyRequired[0])}>show</button>
          </p>
        {:else}
          <p class="mono">{changed ? `${changed} ${changed === 1 ? 'answer' : 'answers'} ready to save` : 'Click a field on the page, or use the list.'}</p>
        {/if}
        {#if missing.length}
          <p class="mono mt-1 text-bad">These characters can't be drawn in the PDF and will show as blanks: {missing.slice(0, 12).join(' ')}. Latin, Greek and Cyrillic work.</p>
        {/if}
        {#if saveError}<p class="text-sm text-bad mt-1" role="alert">{saveError}</p>{/if}
      </div>
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>
        {saving ? 'Saving…' : 'Download filled PDF'}
      </button>
    </div>
  {/if}
</div>

<style>
  .ff {
    container: ff / inline-size;
    display: grid;
    gap: 14px;
  }
  .state {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 48px 16px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .art {
    width: 64px;
    height: 64px;
    margin-bottom: 4px;
    fill: none;
    stroke: var(--color-muted);
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
    & .ruled {
      stroke-dasharray: 2 3;
    }
    & .pen {
      stroke: var(--color-sun);
    }
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .file {
    flex: 1 1 220px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tb {
    padding: 9px 13px;
    font-size: 14px;
  }
  .progress {
    flex-basis: 100%;
    height: 3px;
    border-radius: 3px;
    background: var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.4s var(--ease-spring);
    }
  }
  .notes {
    display: grid;
    gap: 6px;
  }
  .note {
    padding: 10px 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: var(--color-panel-2);
    color: var(--color-soft);
    font-size: 14px;
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
    &:hover {
      color: var(--color-chalk);
    }
  }

  .viewtoggle {
    justify-self: start;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 18px;
    align-items: start;
  }
  @container ff (min-width: 760px) {
    .viewtoggle {
      display: none;
    }
  }
  @container ff (max-width: 759px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .layout[data-view='list'] .pages,
    .layout[data-view='pages'] .list {
      display: none;
    }
    .list {
      position: static;
      max-height: none;
    }
  }

  /* ---------- pages ---------- */
  .pages {
    display: grid;
    gap: 16px;
  }
  .page {
    position: relative;
    container-type: inline-size;
    background: #fff;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 0 1px #0000001a, 0 14px 34px -16px #000;
    & img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      user-select: none;
    }
  }
  .pending {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #9a948a;
    &.bad {
      color: #c0392b;
    }
  }

  /* inputs laid over the page: printed-ink colours, the classic light-blue field tint */
  .fld {
    position: absolute;
    & input,
    & textarea,
    & select {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0 0.3em;
      box-sizing: border-box;
      font: 400 var(--fs) / 1.15 Helvetica, Arial, sans-serif;
      color: #111;
      background: #4a86e824;
      border: 1px solid #4a86e85c;
      border-radius: 2px;
      outline: none;
      transition: background 0.15s, box-shadow 0.15s;
      &:hover:not(:disabled) {
        background: #4a86e838;
      }
      &:focus-visible,
      &:focus {
        background: #ffd25e3d;
        border-color: #c99a1e;
        box-shadow: 0 0 0 2px var(--color-sun);
      }
      &:disabled {
        background: transparent;
        border-style: dashed;
        border-color: #0000002e;
        color: #333;
        cursor: not-allowed;
      }
    }
    & textarea {
      padding: 0.2em 0.3em;
      resize: none;
    }
    & select {
      appearance: none;
      padding-right: 1.1em;
      background-image: linear-gradient(45deg, transparent 50%, #333 50%), linear-gradient(-45deg, transparent 50%, #333 50%);
      background-size: 0.3em 0.3em;
      background-position: calc(100% - 0.55em) 50%, calc(100% - 0.25em) 50%;
      background-repeat: no-repeat;
    }
    & select[size] {
      padding: 0;
      background-image: none;
      & option {
        padding: 0 0.3em;
      }
    }
    & .comb {
      padding: 0 0 0 calc((var(--cell) - 1ch) / 2);
      font-family: ui-monospace, 'Geist Mono Variable', monospace;
      letter-spacing: calc(var(--cell) - 1ch);
    }
    & input[type='checkbox'],
    & input[type='radio'] {
      appearance: none;
      padding: 0;
      cursor: pointer;
    }
    & input[type='checkbox']:checked {
      background: #4a86e824 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23111' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 82% no-repeat;
      animation: tick 0.3s var(--ease-spring);
    }
    & input[type='radio'] {
      border-radius: 50%;
    }
    & input[type='radio']:checked {
      background: radial-gradient(circle, #111 0 34%, #4a86e824 38%);
      animation: tick 0.3s var(--ease-spring);
    }
    &.need > :is(input, textarea, select):not(:focus) {
      border-color: #e0604f99;
    }
    &.active > :is(input, textarea, select):not(:focus) {
      box-shadow: 0 0 0 2px #ffd25e99;
    }
    &.flash > * {
      animation: flash 1.1s ease-out;
    }
  }
  @keyframes tick {
    from { transform: scale(0.6); }
  }
  @keyframes flash {
    0%, 40% { box-shadow: 0 0 0 2px var(--color-sun), 0 0 0 10px #ffd25e40; }
  }

  /* ---------- list ---------- */
  .list {
    position: sticky;
    top: 16px;
    max-height: calc(100dvh - 140px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 14px 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel);
  }
  .tally {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0 -14px;
    padding: 10px 14px 8px;
    background: var(--color-panel);
    border-bottom: 1px solid var(--color-line);
  }
  .group {
    margin: 14px 0 6px;
    color: var(--color-sun);
  }
  .item {
    position: relative;
    padding: 8px 10px;
    margin: 0 -10px;
    border-radius: 10px;
    transition: background 0.2s;
    &.active {
      background: var(--color-panel-2);
    }
  }
  .item-head {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    & > :first-child {
      flex: 1;
      min-width: 0;
    }
  }
  .name {
    overflow-wrap: anywhere;
  }
  .req {
    margin-left: 3px;
    color: var(--color-sun);
  }
  .locate {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-top: -3px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    & svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
    }
    &:hover {
      color: var(--color-sun);
      background: var(--color-line);
    }
  }
  .field.small {
    padding: 8px 11px;
    font-size: 14px;
    border-radius: 10px;
  }
  textarea.field.small {
    min-height: 0;
    font-family: var(--font-sans);
  }
  .count {
    display: block;
    margin-top: 3px;
    text-align: right;
    font-size: 11px;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    color: var(--color-soft);
    cursor: pointer;
    & input {
      flex: none;
      width: 16px;
      height: 16px;
      margin-top: 3px;
      accent-color: var(--color-sun);
    }
  }
  .checks {
    display: grid;
    gap: 4px;
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .pill {
    position: relative;
    padding: 5px 11px;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    font-size: 13.5px;
    color: var(--color-soft);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    & input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    &:hover {
      border-color: var(--color-muted);
    }
    &.on {
      background: var(--color-chalk);
      border-color: var(--color-chalk);
      color: var(--color-bg);
    }
    &:has(input:focus-visible) {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .clear {
    padding: 0 4px;
    border: 0;
    background: none;
    text-decoration: underline;
    cursor: pointer;
  }

  /* ---------- save bar ---------- */
  .savebar {
    position: sticky;
    bottom: 10px;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 12px 12px 12px 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #22211ef2;
    backdrop-filter: blur(8px);
    box-shadow: 0 12px 32px -14px #000c;
  }
  .flat {
    flex: 0 1 230px;
    color: var(--color-chalk);
    & .mono {
      display: block;
      font-size: 11.5px;
    }
  }
  .status {
    flex: 1 1 220px;
    min-width: 0;
  }
  .done {
    animation: appear 0.3s ease-out;
  }
  .tick {
    display: inline-block;
    color: var(--color-ok);
    animation: pop 0.45s var(--ease-spring);
  }
  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--color-line-2);
    border-top-color: var(--color-sun);
    animation: spin 0.8s linear infinite;
    &.sm {
      display: inline-block;
      width: 12px;
      height: 12px;
      margin-right: 6px;
      vertical-align: -1px;
    }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes appear {
    from { opacity: 0; transform: translateY(4px); }
  }
  @keyframes pop {
    from { transform: scale(0.3); }
  }
</style>
