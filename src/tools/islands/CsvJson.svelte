<script lang="ts">
  import { proxy } from 'comlink';
  import { csvWorker, stopCsvWorker, type Output, type ParseInfo } from '@/tools/lib/csv/client';
  import { uniqueHeaders, type Shape } from '@/tools/lib/csv/convert';
  import { decodeText, delimiterName, delimiters, fileProblem } from '@/tools/lib/csv/text';
  import { downloadBlob, formatBytes, withExtension } from '@/tools/lib/files';

  let { dir = 'csv-json' }: { dir?: 'csv-json' | 'json-csv' } = $props();
  const toJson = $derived(dir === 'csv-json');

  // files up to this size open in the editor; bigger ones only go to the worker
  const INLINE = 512 * 1024;

  const samples = {
    csv: 'id,name,address.city,address.zip,active,score\n1,Ada Lovelace,London,01234,true,98.5\n2,"Hopper, Grace",New York,10001,false,\n3,Alan Turing,Wilmslow,SK9 1AA,true,87\n',
    json: JSON.stringify([
      { id: 1, name: 'Ada Lovelace', address: { city: 'London', zip: '01234' }, tags: ['math', 'poetry'], active: true },
      { id: 2, name: 'Grace Hopper', address: { city: 'New York' }, tags: ['navy', 'cobol'], active: false },
      { id: 3, name: 'Alan Turing', address: { city: 'Wilmslow', zip: 'SK9 1AA' }, tags: [], active: true, score: 87 },
    ], null, 2),
  };

  let text = $state('');
  let file = $state.raw<File | null>(null);
  let name = $state('');
  let over = $state(false);
  let picker = $state<HTMLInputElement>();

  // CSV → JSON
  let delimiter = $state('');
  let header = $state(true);
  let typed = $state(true);
  let nested = $state(false);
  let shape = $state<Shape>('objects');
  let keyColumn = $state(0);
  let pretty = $state(true);
  // JSON → CSV
  let outDelimiter = $state(',');
  let flatten = $state(true);
  let arrays = $state<'join' | 'json'>('join');
  let quoteAll = $state(false);
  let bom = $state(false);

  let info = $state.raw<ParseInfo | null>(null);
  let jsonLoaded = $state(0);
  let output = $state.raw<Output | null>(null);
  let error = $state('');
  let loading = $state(false);
  let progress = $state(0);
  let working = $state(false);
  let copied = $state(false);

  // a newer load or conversion wins over one still running
  let loads = 0;
  let converts = 0;

  const empty = $derived(!file && !text.trim());
  const ext = $derived(toJson ? 'json' : 'csv');
  const fileName = $derived(withExtension(name || 'data.txt', ext));

  // re-read the input when it (or the CSV delimiter) changes, once typing pauses
  $effect(() => {
    const source = file ?? text;
    const delim = toJson ? delimiter : '';
    if (empty) {
      // drop whatever is still running, or its result would land on the empty editor
      ++loads;
      abandon();
      loading = false;
      info = null;
      output = null;
      jsonLoaded = 0;
      error = '';
      return;
    }
    const t = setTimeout(() => load(source, delim), file ? 0 : 200);
    return () => clearTimeout(t);
  });

  // re-convert when an output option changes
  $effect(() => {
    const csvOpts = { header, typed, nested, shape, keyColumn, pretty };
    const jsonOpts = { flatten, arrays, delimiter: outDelimiter, quoteAll, bom };
    if (toJson ? !info : !jsonLoaded) return;
    const run = toJson ? () => csvWorker().csvToJson(csvOpts) : () => csvWorker().jsonToCsv(jsonOpts);
    const t = setTimeout(() => convert(run), 120);
    return () => clearTimeout(t);
  });

  $effect(() => () => stopCsvWorker());

  // a big parse can't be interrupted from inside, so drop the worker and any conversion queued on it
  function abandon() {
    stopCsvWorker();
    ++converts;
    working = false;
  }

  async function load(source: File | string, delim: string) {
    const id = ++loads;
    if (loading) abandon();
    loading = true;
    progress = 0;
    try {
      if (toJson) {
        const res = await csvWorker().loadCsv(source, delim, undefined, proxy((p: number) => id === loads && (progress = p)));
        if (id === loads) info = res;
      } else {
        await csvWorker().loadJson(source);
        if (id === loads) jsonLoaded++;
      }
      if (id === loads) error = '';
    } catch (e) {
      if (id !== loads) return;
      error = (e as Error).message || 'This input couldn\'t be read.';
      info = null;
      output = null;
      jsonLoaded = 0;
    } finally {
      if (id === loads) loading = false;
    }
  }

  async function convert(run: () => Promise<Output>) {
    const id = ++converts;
    working = true;
    try {
      const res = await run();
      if (id === converts) {
        output = res;
        error = '';
      }
    } catch (e) {
      if (id === converts) error = (e as Error).message || 'The conversion failed.';
    } finally {
      if (id === converts) working = false;
    }
  }

  async function open(f: File | undefined) {
    if (!f) return;
    const problem = fileProblem(f.name);
    if (problem) {
      error = problem;
      return;
    }
    if (f.size > INLINE) {
      name = f.name;
      text = '';
      file = f;
      return;
    }
    const t = decodeText(new Uint8Array(await f.arrayBuffer()));
    error = t.trim() ? fileProblem(f.name, t) : `${f.name} is empty.`;
    if (error) return;
    name = f.name;
    file = null;
    text = t;
  }

  function clear() {
    file = null;
    text = '';
    name = '';
  }

  async function copy() {
    if (!output) return;
    try {
      const value = output.truncated ? (await output.blob.text()).replace(/^﻿/, '') : output.text;
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      error = 'Your browser wouldn\'t copy that much text. Use Download instead.';
    }
  }

  const headers = $derived(info ? (header ? (info.preview[0] ?? []) : []) : []);

  // the tabular side: the parsed CSV going in, or the CSV coming out
  const table = $derived.by(() => {
    if (toJson) {
      if (!info) return null;
      const width = Math.min(info.columnCount, 200);
      return {
        head: uniqueHeaders(headers, width),
        rows: header ? info.preview.slice(1) : info.preview.slice(0, 100),
        total: header ? Math.max(0, info.rowCount - 1) : info.rowCount,
      };
    }
    if (!output?.preview) return null;
    return { head: (output.fields ?? []).slice(0, 200), rows: output.preview, total: output.count };
  });

  const countLabel = $derived.by(() => {
    if (!output) return '';
    const n = output.count.toLocaleString();
    if (!toJson) return `${n} row${output.count === 1 ? '' : 's'}`;
    const noun = shape === 'objects' ? 'object' : shape === 'arrays' ? 'array' : 'key';
    return `${n} ${noun}${output.count === 1 ? '' : 's'}`;
  });

  const shapes = [['objects', 'array of objects'], ['arrays', 'array of arrays'], ['keyed', 'keyed by column']] as const;
</script>

<div class="grid gap-5">
  <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
    {#if toJson}
      <div>
        <span class="label">delimiter</span>
        <div class="seg" role="group" aria-label="Delimiter">
          {#each delimiters as [label, d]}
            <button type="button" aria-pressed={delimiter === d} onclick={() => (delimiter = d)}>{label}</button>
          {/each}
        </div>
      </div>
      <div>
        <span class="label">output</span>
        <div class="seg" role="group" aria-label="Output shape">
          {#each shapes as [value, label]}
            <button type="button" aria-pressed={shape === value} onclick={() => (shape = value)}>{label}</button>
          {/each}
        </div>
      </div>
      <div>
        <span class="label">format</span>
        <div class="seg" role="group" aria-label="Format">
          <button type="button" aria-pressed={pretty} onclick={() => (pretty = true)}>pretty</button>
          <button type="button" aria-pressed={!pretty} onclick={() => (pretty = false)}>minified</button>
        </div>
      </div>
    {:else}
      <div>
        <span class="label">delimiter</span>
        <div class="seg" role="group" aria-label="Delimiter">
          {#each delimiters.slice(1) as [label, d]}
            <button type="button" aria-pressed={outDelimiter === d} onclick={() => (outDelimiter = d)}>{label}</button>
          {/each}
        </div>
      </div>
      <div>
        <span class="label">arrays</span>
        <div class="seg" role="group" aria-label="Arrays">
          <button type="button" aria-pressed={arrays === 'join'} onclick={() => (arrays = 'join')}>join with commas</button>
          <button type="button" aria-pressed={arrays === 'json'} onclick={() => (arrays = 'json')}>keep as JSON</button>
        </div>
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
    {#if toJson}
      <label class="check"><input type="checkbox" bind:checked={header} /> first row is headers</label>
      <label class="check"><input type="checkbox" bind:checked={typed} /> numbers, true/false &amp; null</label>
      {#if shape !== 'arrays'}
        <label class="check"><input type="checkbox" bind:checked={nested} /> nest dot keys <span class="mono">a.b → {'{a:{b}}'}</span></label>
      {/if}
      {#if shape === 'keyed'}
        <label class="flex items-center gap-2">
          <span class="mono">key column</span>
          <select class="field w-auto! py-1.5!" bind:value={keyColumn}>
            {#each table?.head ?? ['column1'] as h, i}<option value={i}>{h}</option>{/each}
          </select>
        </label>
      {/if}
    {:else}
      <label class="check"><input type="checkbox" bind:checked={flatten} /> flatten nested objects <span class="mono">a.b columns</span></label>
      <label class="check"><input type="checkbox" bind:checked={quoteAll} /> quote every field</label>
      <label class="check"><input type="checkbox" bind:checked={bom} /> add BOM for Excel</label>
    {/if}
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="min-w-0">
      <div class="head">
        <span class="label" id="csvjson-in">{toJson ? 'CSV' : 'JSON'} input</span>
        <span class="flex gap-3">
          <button type="button" class="link" onclick={() => picker?.click()}>open file</button>
          {#if empty}
            <button type="button" class="link" onclick={() => (text = toJson ? samples.csv : samples.json)}>try a sample</button>
          {:else}
            <button type="button" class="link" onclick={clear}>clear</button>
          {/if}
        </span>
      </div>
      <div
        class="drop"
        class:over
        role="region"
        aria-labelledby="csvjson-in"
        ondragover={(e) => {
          e.preventDefault();
          over = true;
        }}
        ondragleave={() => (over = false)}
        ondrop={(e) => {
          e.preventDefault();
          over = false;
          open(e.dataTransfer?.files[0]);
        }}
      >
        {#if file}
          <div class="field file">
            <p class="font-serif text-2xl break-all">{file.name}</p>
            <p class="mono">{formatBytes(file.size)} · too big to show here, converted in full</p>
            {#if loading}
              <div class="bar" role="progressbar" aria-label="Reading file" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style:width={`${progress * 100}%`}></span>
              </div>
            {/if}
          </div>
        {:else}
          <textarea
            class="field min-h-[320px]!"
            aria-labelledby="csvjson-in"
            bind:value={text}
            spellcheck="false"
            placeholder={toJson ? 'Paste CSV here, or drop a .csv file…' : 'Paste JSON here, or drop a .json file…'}
          ></textarea>
        {/if}
      </div>
    </div>

    <div class="min-w-0">
      <div class="head">
        <span class="label" id="csvjson-out">
          {toJson ? 'JSON' : 'CSV'} output
          {#if working || loading}<span class="text-sun">· working…</span>
          {:else if output}{#key output}<span class="pop text-ok">· {countLabel} · {formatBytes(output.blob.size)}</span>{/key}{/if}
        </span>
      </div>
      {#if error}
        <div class="field min-h-[320px] text-bad" role="alert">{error}</div>
      {:else}
        <textarea
          class="field min-h-[320px]!"
          aria-labelledby="csvjson-out"
          readonly
          value={output?.text ?? ''}
          spellcheck="false"
          placeholder={toJson ? 'Your JSON appears here as you type.' : 'Your CSV appears here as you type.'}
        ></textarea>
      {/if}
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button type="button" class="btn btn-primary" disabled={!output || !!error} onclick={copy} aria-live="polite">
      {copied ? 'Copied ✓' : `Copy ${toJson ? 'JSON' : 'CSV'}`}
    </button>
    <button type="button" class="btn" disabled={!output || !!error} onclick={() => output && downloadBlob(output.blob, fileName)}>
      Download {fileName}
    </button>
    <a class="link ml-auto" href={toJson ? '/json-to-csv' : '/csv-to-json'}>{toJson ? 'JSON to CSV' : 'CSV to JSON'} instead →</a>
  </div>

  {#if !error && (output?.truncated || output?.note || info?.warning || info)}
    <div class="grid gap-1 text-sm">
      {#if toJson && info}
        <p class="mono">
          read {info.rowCount.toLocaleString()} rows × {info.columnCount} columns · delimiter: {delimiterName(info.delimiter)}{delimiter ? '' : ' (detected)'}
        </p>
      {/if}
      {#if output?.truncated}<p class="mono">showing the start of the output · copy and download include all of it</p>{/if}
      {#if output?.note}<p class="text-soft">{output.note}</p>{/if}
      {#if info?.warning}<p class="text-sun">Heads up: {info.warning}</p>{/if}
    </div>
  {/if}

  {#if table && table.rows.length && !error}
    <div>
      <span class="label">
        preview · {table.rows.length < table.total ? `first ${table.rows.length} of ${table.total.toLocaleString()}` : table.total.toLocaleString()} rows
      </span>
      <div class="preview">
        <table>
          {#if table.head.length}
            <thead><tr><th class="n">#</th>{#each table.head as h}<th title={h}>{h}</th>{/each}</tr></thead>
          {/if}
          <tbody>
            {#each table.rows as row, r}
              <tr>
                <td class="n">{r + 1}</td>
                {#each (table.head.length ? table.head : row.slice(0, 200)) as _, c}<td title={row[c]}>{row[c] ?? ''}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<input
  bind:this={picker}
  type="file"
  hidden
  accept={toJson ? '.csv,.tsv,.txt,.tab,text/csv,text/plain' : '.json,.jsonl,.ndjson,.txt,application/json'}
  onchange={(e) => {
    open(e.currentTarget.files?.[0]);
    e.currentTarget.value = '';
  }}
/>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
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
  .drop {
    border-radius: 12px;
    transition: box-shadow 0.2s;
    &.over { box-shadow: 0 0 0 2px var(--color-sun); }
  }
  .file {
    display: grid;
    place-content: center;
    gap: 6px;
    min-height: 320px;
    text-align: center;
  }
  .bar {
    width: min(240px, 100%);
    height: 4px;
    margin: 10px auto 0;
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
  .pop {
    display: inline-block;
    animation: pop 0.45s var(--ease-spring);
  }
  @keyframes pop {
    from { opacity: 0; transform: translateY(3px); }
  }
  .preview {
    max-height: 380px;
    overflow: auto;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: #141312;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    font: 400 13px/1.4 var(--font-mono);
    min-width: 100%;
  }
  th, td {
    max-width: 260px;
    padding: 7px 12px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-bottom: 1px solid var(--color-line);
  }
  th {
    position: sticky;
    top: 0;
    background: var(--color-panel-2);
    color: var(--color-chalk);
    font-weight: 500;
    border-bottom-color: var(--color-line-2);
  }
  .n {
    color: var(--color-muted);
    text-align: right;
    width: 1%;
  }
  tbody tr:hover td { background: #f2ede40a; }
</style>
