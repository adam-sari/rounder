<script lang="ts">
  import { proxy } from 'comlink';
  import { untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { csvWorker, stopCsvWorker } from '@/tools/lib/csv/client';
  import { columnCount, typeValue, uniqueHeaders } from '@/tools/lib/csv/convert';
  import { columnStats, detectType, sampleColumn, type ColumnStats, type ColumnType } from '@/tools/lib/csv/profile';
  import { delimiterName, delimiters, fileProblem } from '@/tools/lib/csv/text';
  import { downloadBlob, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';

  const ROW_H = 34;
  const HEAD_H = 48;
  const OVERSCAN = 8;
  // browsers cap element heights (Firefox near 17.9M px), so very long tables scroll a scaled spacer
  const MAX_SPACER = 8_000_000;

  const typeInfo: Record<ColumnType, [badge: string, label: string]> = {
    number: ['123', 'numbers'],
    date: ['date', 'dates'],
    boolean: ['y/n', 'true / false'],
    text: ['abc', 'text'],
    empty: ['—', 'empty'],
  };

  /*
   * The table lives outside Svelte's reactivity, since 100k proxied rows would crawl.
   * Deleted rows become null, so row numbers stay put and undo is trivial.
   * `version` is bumped on every change so the visible cells re-render.
   */
  let rows: (string[] | null)[] = [];
  /** lowercased row text for all-column search, built on demand */
  let hay: (string | undefined)[] = [];
  /** live rows in the current sort (or file) order */
  let order: number[] = [];
  let version = $state(0);

  let header = $state.raw<string[]>([]);
  let cols = $state(0);
  let widths = $state.raw<number[]>([]);
  let useHeader = $state(true);
  /** rows on screen after sorting and filtering */
  let view = $state.raw<number[]>([]);

  let source = $state.raw<File | string | null>(null);
  let name = $state('');
  let delimiter = $state('');
  let usedDelimiter = $state(',');
  let loading = $state(false);
  let progress = $state(0);
  let error = $state('');
  let warning = $state('');
  let dirty = $state(false);
  let pasting = $state(false);
  let pasted = $state('');

  let query = $state('');
  let applied = $state('');
  let scope = $state(-1);
  let sort = $state<{ col: number; desc: boolean } | null>(null);
  let sorting = $state(false);

  let activePos = $state(0);
  let activeCol = $state(0);
  let editing = $state(false);
  let draft = $state('');
  let replacing = false;
  let undo = $state.raw<{ index: number; row: string[]; orderAt: number; viewAt: number } | null>(null);
  let exporting = $state('');

  let scroller = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(560);

  let loads = 0;
  let sorts = 0;

  const total = $derived(view.length);
  const live = $derived.by(() => {
    void version;
    return order.length;
  });
  const bodyH = $derived(Math.max(ROW_H, height - HEAD_H));
  const realH = $derived(total * ROW_H);
  const spacerH = $derived(Math.min(realH, MAX_SPACER));
  const ratio = $derived(spacerH > bodyH ? (realH - bodyH) / (spacerH - bodyH) : 1);
  const first = $derived(Math.max(0, Math.floor((scrollTop * ratio) / ROW_H) - OVERSCAN));
  const offset = $derived(scrollTop - (scrollTop * ratio - first * ROW_H));
  const visible = $derived(view.slice(first, Math.min(total, first + Math.ceil(bodyH / ROW_H) + OVERSCAN * 2)));

  const colIdx = $derived(Array.from({ length: cols }, (_, c) => c));
  const numW = $derived.by(() => {
    void version;
    return Math.max(52, String(rows.length + 1).length * 8 + 26);
  });
  const template = $derived(`${numW}px ${widths.map((w) => `${w}px`).join(' ')}`);
  const totalW = $derived(widths.reduce((a, b) => a + b, numW));

  const types = $derived.by(() => {
    void version;
    return colIdx.map((c) => detectType(sampleColumn(rows, c)));
  });

  /** stats for one column; they scan every row, so they wait for arrow keys and edits to settle */
  let stats = $state.raw<(ColumnStats & { col: number; type: ColumnType }) | null>(null);
  $effect(() => {
    void version;
    const col = activeCol;
    const type = types[col];
    if (!cols || !live) {
      stats = null;
      return;
    }
    const t = setTimeout(() => {
      const values: string[] = [];
      for (const r of rows) if (r) values.push(r[col] ?? '');
      stats = { ...columnStats(values, type), col, type };
    }, 150);
    return () => clearTimeout(t);
  });

  const colName = (c: number) => (useHeader && header[c]?.trim()) || `Column ${c + 1}`;
  const cell = (i: number, c: number, _v: number) => rows[i]?.[c] ?? '';

  // filter once typing pauses
  $effect(() => {
    const q = query;
    const t = setTimeout(() => (applied = q), 150);
    return () => clearTimeout(t);
  });

  $effect(() => {
    void applied;
    void scope;
    untrack(() => {
      refresh();
      if (scroller) scroller.scrollTop = 0;
    });
  });

  // edits only live in this tab until exported
  $effect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  $effect(() => () => stopCsvWorker());

  function refresh() {
    const q = applied.trim().toLowerCase();
    if (!q) view = order.slice();
    else {
      const out: number[] = [];
      for (const i of order) {
        const r = rows[i];
        if (!r) continue;
        const text = scope < 0 ? (hay[i] ??= r.join('\u0001').toLowerCase()) : (r[scope] ?? '').toLowerCase();
        if (text.includes(q)) out.push(i);
      }
      view = out;
    }
    activePos = Math.min(activePos, Math.max(0, view.length - 1));
  }

  async function load(src: File | string, delim = delimiter, label = typeof src === 'string' ? 'data.csv' : src.name) {
    if (typeof src !== 'string') {
      const problem = fileProblem(src.name);
      if (problem) {
        error = problem;
        return;
      }
    }
    const id = ++loads;
    // a big parse can't be interrupted from inside, so abandon the worker instead
    if (loading) stopCsvWorker();
    loading = true;
    progress = 0;
    error = '';
    name = label;
    const incoming: string[][] = [];
    try {
      const info = await csvWorker().loadCsv(
        src,
        delim,
        proxy((batch: string[][]) => {
          if (id === loads) for (const r of batch) incoming.push(r);
        }),
        proxy((p: number) => {
          if (id === loads) progress = p;
        }),
      );
      if (id !== loads) return;
      if (!info.rowCount) throw new Error('There are no rows in this file.');
      source = src;
      delimiter = delim;
      usedDelimiter = info.delimiter;
      warning = info.warning;
      dirty = false;
      query = applied = '';
      scope = -1;
      setRows(incoming);
    } catch (e) {
      if (id === loads) error = (e as Error).message || 'This file couldn\'t be read.';
    } finally {
      if (id === loads) loading = false;
    }
  }

  function setRows(all: string[][]) {
    header = useHeader ? (all.shift() ?? []) : [];
    rows = all;
    hay = [];
    cols = Math.max(header.length, columnCount(all));
    widths = measure();
    sort = null;
    sorts++;
    sorting = false;
    undo = null;
    editing = false;
    stats = null;
    order = [];
    for (let i = 0; i < rows.length; i++) order.push(i);
    refresh();
    activePos = 0;
    activeCol = 0;
    version++;
    if (scroller) scroller.scrollTop = scroller.scrollLeft = 0;
  }

  function measure() {
    const n = Math.min(rows.length, 300);
    return Array.from({ length: cols }, (_, c) => {
      let len = colName(c).length + 4;
      for (let i = 0; i < n; i++) len = Math.max(len, rows[i]?.[c]?.length ?? 0);
      return Math.round(Math.min(320, Math.max(84, len * 7.6 + 28)));
    });
  }

  function toggleHeader() {
    if (editing) commit();
    const all = rows.filter((r) => r !== null);
    if (useHeader) all.unshift(header);
    useHeader = !useHeader;
    setRows(all);
  }

  function changeDelimiter(d: string) {
    if (!source || d === delimiter) return;
    if (dirty && !confirm('Reading the file again with a different delimiter discards your edits. Continue?')) return;
    load(source, d, name);
  }

  function reset() {
    if (dirty && !confirm('Close this file? Your edits haven\'t been exported.')) return;
    ++loads;
    if (loading) stopCsvWorker();
    source = null;
    rows = [];
    order = [];
    hay = [];
    view = [];
    cols = 0;
    dirty = false;
    loading = false;
    error = '';
    version++;
  }

  async function sortBy(col: number) {
    if (editing) commit();
    activeCol = col;
    const next = !sort || sort.col !== col ? { col, desc: false } : !sort.desc ? { col, desc: true } : null;
    sort = next;
    undo = null;
    const id = ++sorts;
    if (!next) {
      order = [];
      for (let i = 0; i < rows.length; i++) if (rows[i]) order.push(i);
      refresh();
      return;
    }
    sorting = true;
    const values = rows.map((r) => r?.[col] ?? '');
    try {
      const sorted = await csvWorker().sortOrder(values, types[col], next.desc);
      if (id !== sorts) return;
      order = [];
      for (const i of sorted) if (rows[i]) order.push(i);
      // rows added while the sort was running go at the end
      for (let i = values.length; i < rows.length; i++) if (rows[i]) order.push(i);
      refresh();
    } catch {
      if (id === sorts) error = 'Sorting failed. Try again.';
    } finally {
      if (id === sorts) sorting = false;
    }
  }

  // ---------- selection & editing ----------

  function reveal() {
    if (!scroller) return;
    const top = activePos * ROW_H;
    const realTop = scrollTop * ratio;
    if (top < realTop) scroller.scrollTop = top / ratio;
    else if (top + ROW_H > realTop + bodyH) scroller.scrollTop = (top + ROW_H - bodyH) / ratio;
    let left = numW;
    for (let c = 0; c < activeCol; c++) left += widths[c];
    const right = left + widths[activeCol];
    if (left - numW < scroller.scrollLeft) scroller.scrollLeft = left - numW;
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth;
  }

  function moveTo(pos: number, col: number) {
    activePos = Math.max(0, Math.min(total - 1, pos));
    activeCol = Math.max(0, Math.min(cols - 1, col));
    reveal();
  }

  function setCell(r: number, c: number, value: string) {
    const row = rows[r];
    if (!row || (row[c] ?? '') === value) return;
    while (row.length <= c) row.push('');
    row[c] = value;
    hay[r] = undefined;
    dirty = true;
    version++;
  }

  function startEdit(initial?: string) {
    if (!total) return;
    replacing = initial !== undefined;
    draft = initial ?? cell(view[activePos], activeCol, version);
    editing = true;
    reveal();
  }

  function commit() {
    if (!editing) return;
    editing = false;
    setCell(view[activePos], activeCol, draft);
  }

  function editorFocus(node: HTMLInputElement) {
    node.focus();
    if (replacing) node.setSelectionRange(node.value.length, node.value.length);
    else node.select();
  }

  function editKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commit();
      if (e.key === 'Enter') moveTo(activePos + (e.shiftKey ? -1 : 1), activeCol);
      else moveTo(activePos, activeCol + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
    } else return;
    scroller?.focus({ preventScroll: true });
  }

  function gridKey(e: KeyboardEvent) {
    if (editing || !total || e.target !== scroller) return;
    const page = Math.max(1, Math.floor(bodyH / ROW_H) - 1);
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-page, 0], PageDown: [page, 0],
    };
    const mod = e.ctrlKey || e.metaKey;
    if (steps[e.key]) moveTo(activePos + steps[e.key][0], activeCol + steps[e.key][1]);
    else if (e.key === 'Home') moveTo(mod ? 0 : activePos, 0);
    else if (e.key === 'End') moveTo(mod ? total - 1 : activePos, cols - 1);
    else if (e.key === 'Enter' || e.key === 'F2') startEdit();
    else if (e.key === 'Delete' || e.key === 'Backspace') setCell(view[activePos], activeCol, '');
    else if (e.key.length === 1 && !mod && !e.altKey) startEdit(e.key);
    else return;
    e.preventDefault();
  }

  function pick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-col]');
    if (!el) return;
    const pos = Number(el.dataset.pos);
    const col = Number(el.dataset.col);
    const again = pos === activePos && col === activeCol;
    if (editing && again) return;
    activePos = pos;
    activeCol = col;
    // touch has no reliable double-click, so tapping the selected cell again edits it
    if (e.detail === 2 || (again && (e as PointerEvent).pointerType === 'touch')) startEdit();
  }

  function addRow() {
    if (editing) commit();
    const r = rows.length;
    rows.push(Array(cols).fill(''));
    const at = total ? activePos + 1 : 0;
    const before = view[activePos];
    order.splice(total ? order.indexOf(before) + 1 : order.length, 0, r);
    const next = view.slice();
    next.splice(at, 0, r);
    view = next;
    dirty = true;
    version++;
    moveTo(at, 0);
    scroller?.focus({ preventScroll: true });
  }

  function deleteRow() {
    if (!total) return;
    editing = false;
    const r = view[activePos];
    const row = rows[r];
    if (!row) return;
    undo = { index: r, row, orderAt: order.indexOf(r), viewAt: activePos };
    rows[r] = null;
    hay[r] = undefined;
    order.splice(undo.orderAt, 1);
    const next = view.slice();
    next.splice(activePos, 1);
    view = next;
    activePos = Math.min(activePos, Math.max(0, next.length - 1));
    dirty = true;
    version++;
  }

  function restore() {
    if (!undo) return;
    const u = undo;
    rows[u.index] = u.row;
    order.splice(u.orderAt, 0, u.index);
    const next = view.slice();
    next.splice(u.viewAt, 0, u.index);
    view = next;
    undo = null;
    version++;
    moveTo(Math.min(u.viewAt, next.length - 1), activeCol);
  }

  // ---------- export ----------

  const csvDelimiter = $derived(usedDelimiter === '\t' ? ',' : usedDelimiter);

  async function exportAs(kind: 'csv' | 'tsv' | 'json') {
    if (editing) commit();
    exporting = kind;
    try {
      const { default: Papa } = await import('papaparse');
      const ids = view;
      const parts: string[] = [];
      const fill = (r: string[]) => (r.length >= cols ? r : [...r, ...Array(cols - r.length).fill('')]);
      // chunks with a pause between keep the page responsive on 100k rows
      const CHUNK = 5000;
      const pause = () => new Promise((resolve) => setTimeout(resolve));
      if (kind === 'json') {
        const keys = uniqueHeaders(useHeader ? header : [], cols);
        for (let s = 0; s < ids.length; s += CHUNK) {
          const lines = ids.slice(s, s + CHUNK).map((i) => {
            const r = rows[i] ?? [];
            const obj = Object.create(null) as Record<string, unknown>;
            keys.forEach((k, c) => (obj[k] = typeValue(r[c] ?? '')));
            return `  ${JSON.stringify(obj)}`;
          });
          parts.push(`${s ? ',\n' : '[\n'}${lines.join(',\n')}`);
          await pause();
        }
        parts.push(ids.length ? '\n]\n' : '[]\n');
      } else {
        const opts = { delimiter: kind === 'csv' ? csvDelimiter : '\t', newline: '\r\n' };
        if (useHeader) parts.push(`${Papa.unparse([fill(header)], opts)}\r\n`);
        for (let s = 0; s < ids.length; s += CHUNK) {
          parts.push(`${Papa.unparse(ids.slice(s, s + CHUNK).map((i) => fill(rows[i] ?? [])), opts)}\r\n`);
          await pause();
        }
      }
      const type = kind === 'json' ? 'application/json' : kind === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
      let out = withExtension(name || 'data.csv', kind);
      if (out === name && dirty) out = withSuffix(out, '-edited');
      downloadBlob(new Blob(parts, { type }), out);
      // a filtered export leaves the other rows' edits unsaved
      if (!applied) dirty = false;
    } catch {
      error = 'The export failed. Try again, or export fewer rows by filtering first.';
    } finally {
      exporting = '';
    }
  }

  // ---------- empty state ----------

  /** a reproducible made-up table, big enough to show off scrolling and stats */
  function sample() {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const products = ['Desk lamp', 'Notebook', 'Fountain pen', 'Coffee mug', 'Backpack', 'Headphones', 'Plant pot', 'Water bottle', 'Sketchbook', 'Phone stand'];
    const regions = ['North', 'South', 'East', 'West'];
    const lines = ['order_id,date,product,region,quantity,unit_price,paid'];
    for (let i = 1; i <= 5000; i++) {
      const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 365) * 864e5).toISOString().slice(0, 10);
      const p = Math.floor(rand() * products.length);
      lines.push([10000 + i, day, products[p], regions[Math.floor(rand() * 4)], 1 + Math.floor(rand() * 6), (4.5 + p * 3.25).toFixed(2), rand() > 0.1].join(','));
    }
    load(lines.join('\n'), '', 'sample-orders.csv');
  }
</script>

{#if !source}
  {#if loading}
    <div class="grid place-items-center gap-3 rounded-[18px] border border-line-2 px-5 py-16 text-center">
      <p class="font-serif text-3xl break-all">Reading {name}…</p>
      <div class="bar" role="progressbar" aria-label="Reading file" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style:width={`${progress * 100}%`}></span>
      </div>
      <p class="mono">{Math.round(progress * 100)}% · parsing on your device</p>
    </div>
  {:else}
    <Dropzone title="Drop a CSV or TSV file" hint="CSV, TSV or TXT · big files welcome" onfiles={(files) => load(files[0])} />
    <p class="mono mt-3 flex flex-wrap gap-x-3 gap-y-1">
      <span>or</span>
      <button type="button" class="link" onclick={() => (pasting = !pasting)} aria-expanded={pasting}>paste CSV text</button>
      <span>·</span>
      <button type="button" class="link" onclick={sample}>open a 5,000-row sample</button>
    </p>
    {#if pasting}
      <div class="mt-3 grid gap-2">
        <textarea class="field min-h-[180px]!" bind:value={pasted} aria-label="CSV text" spellcheck="false" placeholder="name,email&#10;Ada,ada@example.com"></textarea>
        <div><button type="button" class="btn btn-primary" disabled={!pasted.trim()} onclick={() => load(pasted)}>Open table</button></div>
      </div>
    {/if}
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p class="min-w-0">
        <span class="font-serif text-2xl break-all">{name}</span>
        <span class="mono ml-2">
          {live.toLocaleString()} rows × {cols} columns{typeof source !== 'string' ? ` · ${formatBytes(source.size)}` : ''}
          {#if dirty}<span class="text-sun">· edited</span>{/if}
        </span>
      </p>
      <button type="button" class="link" onclick={reset}>open another file</button>
    </div>

    <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
      <label class="min-w-[200px] flex-1">
        <span class="label">search</span>
        <input class="field" type="search" bind:value={query} placeholder="Filter rows…" />
      </label>
      <label>
        <span class="label">in</span>
        <select class="field" bind:value={scope}>
          <option value={-1}>all columns</option>
          {#each colIdx as c}<option value={c}>{colName(c)}</option>{/each}
        </select>
      </label>
      <div>
        <span class="label">delimiter{delimiter ? '' : ` · found ${delimiterName(usedDelimiter)}`}</span>
        <div class="seg" role="group" aria-label="Delimiter">
          {#each delimiters as [label, d]}
            <button type="button" aria-pressed={delimiter === d} disabled={loading} onclick={() => changeDelimiter(d)}>{label}</button>
          {/each}
        </div>
      </div>
      <label class="check pb-2.5 text-sm"><input type="checkbox" checked={useHeader} onchange={toggleHeader} /> first row is headers</label>
    </div>

    {#if warning}<p class="text-sm text-sun">Heads up: {warning}</p>{/if}
    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="grid-scroll"
      class:busy={sorting || loading}
      bind:this={scroller}
      bind:clientHeight={height}
      onscroll={() => scroller && (scrollTop = scroller.scrollTop)}
      onkeydown={gridKey}
      onclick={pick}
      tabindex="0"
      role="grid"
      aria-label={`${name}: arrows move, Enter edits, Delete clears a cell`}
      aria-rowcount={total + 1}
      aria-colcount={cols + 1}
      aria-activedescendant={visible.includes(view[activePos]) ? `cv-${activePos}-${activeCol}` : undefined}
    >
      <div class="head" role="row" aria-rowindex={1} style:grid-template-columns={template} style:width={`${totalW}px`}>
        <div class="rn corner" role="columnheader">#</div>
        {#each colIdx as c}
          <div role="columnheader" aria-sort={sort?.col === c ? (sort.desc ? 'descending' : 'ascending') : 'none'} class:picked={c === activeCol}>
            <button type="button" class="h" onclick={() => sortBy(c)} title={`Sort by ${colName(c)}`}>
              <span class="name">{colName(c)}</span>
              <span class="meta">
                <span>{typeInfo[types[c]][0]}</span>
                {#if sort?.col === c}<span class="text-sun">{sort.desc ? '↓' : '↑'}</span>{/if}
              </span>
            </button>
          </div>
        {/each}
      </div>
      <div class="body" style:height={`${spacerH}px`} style:width={`${totalW}px`}>
        <div class="rows" style:top={`${offset}px`}>
          {#each visible as i, k (i)}
            {@const pos = first + k}
            <div class="row" role="row" aria-rowindex={pos + 2} style:grid-template-columns={template}>
              <div class="rn" role="rowheader">{i + 1}</div>
              {#each colIdx as c}
                <div
                  class="cell"
                  class:num={types[c] === 'number'}
                  class:active={pos === activePos && c === activeCol}
                  role="gridcell"
                  id={`cv-${pos}-${c}`}
                  data-pos={pos}
                  data-col={c}
                >
                  {#if editing && pos === activePos && c === activeCol}
                    <input class="editor" bind:value={draft} onkeydown={editKey} onblur={commit} use:editorFocus aria-label={`Edit ${colName(c)}`} />
                  {:else}{cell(i, c, version)}{/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
        {#if !total}
          <p class="none mono">{applied ? `No rows match "${applied}".` : 'No rows left. Insert one below.'}</p>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <p class="mono mr-auto">
        {#if sorting}sorting…{:else if applied}{total.toLocaleString()} of {live.toLocaleString()} rows match{:else}click a header to sort · double-click or type to edit{/if}
      </p>
      {#if undo}
        <p class="mono" aria-live="polite">row {undo.index + 1} deleted · <button type="button" class="link text-sun!" onclick={restore}>undo</button></p>
      {/if}
      <button type="button" class="btn" onclick={addRow} title="Adds an empty row below the selected one">+ Insert row</button>
      <button type="button" class="btn" onclick={deleteRow} disabled={!total} title="Deletes the selected row">Delete row</button>
    </div>

    {#if stats}
      <section class="stats" aria-label={`Statistics for ${colName(stats.col)}`}>
        <div class="who">
          <span class="font-serif text-2xl break-all">{colName(stats.col)}</span>
          <span class="mono">{typeInfo[stats.type][1]}</span>
        </div>
        <dl>
          <div><dt>filled</dt><dd>{stats.count.toLocaleString()}</dd></div>
          <div><dt>empty</dt><dd>{stats.empty.toLocaleString()}</dd></div>
          <div><dt>unique</dt><dd>{stats.unique.toLocaleString()}</dd></div>
          {#if stats.min !== undefined}
            <div><dt>{stats.type === 'date' ? 'earliest' : 'min'}</dt><dd>{stats.min}</dd></div>
            <div><dt>{stats.type === 'date' ? 'latest' : 'max'}</dt><dd>{stats.max}</dd></div>
          {/if}
          {#if stats.mean !== undefined}
            <div><dt>mean</dt><dd>{stats.mean.toLocaleString(undefined, { maximumFractionDigits: 4 })}</dd></div>
          {/if}
        </dl>
        {#if stats.top.length}
          <p class="mono top">
            most common:
            {#each stats.top as [value, n], j}<span class="text-chalk">{value}</span> ×{n.toLocaleString()}{j < stats.top.length - 1 ? ' · ' : ''}{/each}
          </p>
        {/if}
      </section>
    {/if}

    <div class="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <span class="mono mr-2">export {applied ? `${total.toLocaleString()} matching` : 'all'} rows as</span>
      <button type="button" class="btn btn-primary" disabled={!!exporting} onclick={() => exportAs('csv')}>
        {exporting === 'csv' ? 'Saving…' : `CSV${csvDelimiter === ',' ? '' : ` (${delimiterName(csvDelimiter)})`}`}
      </button>
      <button type="button" class="btn" disabled={!!exporting} onclick={() => exportAs('tsv')}>{exporting === 'tsv' ? 'Saving…' : 'TSV'}</button>
      <button type="button" class="btn" disabled={!!exporting} onclick={() => exportAs('json')}>{exporting === 'json' ? 'Saving…' : 'JSON'}</button>
    </div>
  </div>
{/if}

<style>
  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
    text-decoration: underline;
    text-decoration-color: var(--color-line-2);
    text-underline-offset: 4px;
    cursor: pointer;
    &:hover { color: var(--color-chalk); }
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    & input { accent-color: var(--color-sun); }
  }
  .bar {
    width: min(280px, 100%);
    height: 4px;
    border-radius: 4px;
    background: var(--color-line-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.2s;
    }
  }

  .grid-scroll {
    position: relative;
    height: clamp(320px, 66vh, 620px);
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
    font: 400 13px/1 var(--font-mono);
    transition: opacity 0.2s;
    &.busy { opacity: 0.6; }
  }
  .head,
  .row {
    display: grid;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 48px;
    background: var(--color-panel-2);
    border-bottom: 1px solid var(--color-line-2);
    & > div { min-width: 0; border-right: 1px solid var(--color-line); }
    & .picked { box-shadow: inset 0 -2px var(--color-sun); }
  }
  .h {
    display: grid;
    align-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 0 10px;
    text-align: left;
    color: var(--color-chalk);
    cursor: pointer;
    &:hover { background: #f2ede40a; }
  }
  .name {
    font: 500 13.5px/1.1 var(--font-sans);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--color-muted);
  }
  .rn {
    position: sticky;
    left: 0;
    z-index: 1;
    display: grid;
    align-items: center;
    justify-items: end;
    padding: 0 10px;
    color: var(--color-muted);
    background: #181716;
    border-right: 1px solid var(--color-line-2);
  }
  .corner {
    z-index: 3;
    background: var(--color-panel-2);
  }
  .body {
    position: relative;
    /* clip, not hidden: hidden would turn it into the sticky row numbers' scroll box */
    overflow: clip;
  }
  .rows {
    position: absolute;
    left: 0;
    right: 0;
  }
  .row {
    height: 34px;
    border-bottom: 1px solid var(--color-line);
    &:hover .cell { background: #f2ede407; }
  }
  .cell {
    position: relative;
    min-width: 0;
    padding: 0 10px;
    line-height: 33px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-soft);
    border-right: 1px solid var(--color-line);
    cursor: cell;
    &.num { text-align: right; font-variant-numeric: tabular-nums; }
    &.active {
      color: var(--color-chalk);
      background: #ffd25e14 !important;
      box-shadow: inset 0 0 0 1.5px var(--color-sun);
    }
  }
  .editor {
    position: absolute;
    inset: 0;
    width: 100%;
    padding: 0 9px;
    font: inherit;
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 0;
    outline: 2px solid var(--color-sun);
    outline-offset: -2px;
  }
  .none {
    position: sticky;
    left: 0;
    padding: 32px 20px;
    text-align: center;
  }

  .stats {
    display: grid;
    grid-template-columns: minmax(140px, 220px) 1fr;
    gap: 6px 20px;
    align-items: center;
    padding: 14px 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    & .who { display: grid; min-width: 0; }
    & dl {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 22px;
      margin: 0;
    }
    & dt { font: 400 11.5px var(--font-mono); color: var(--color-muted); }
    & dd { margin: 0; font: 400 22px/1.15 var(--font-serif); overflow-wrap: anywhere; }
    & .top { grid-column: 1 / -1; overflow-wrap: anywhere; }
  }
  @media (max-width: 560px) {
    .stats { grid-template-columns: 1fr; }
  }
</style>
