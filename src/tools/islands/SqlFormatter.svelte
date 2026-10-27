<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { closeFormatter, formatSql, type FormatSettings } from '@/tools/lib/sql-formatter/client';

  const dialects: [FormatSettings['language'], string][] = [
    ['sql', 'Standard SQL'],
    ['postgresql', 'PostgreSQL'],
    ['mysql', 'MySQL'],
    ['mariadb', 'MariaDB'],
    ['sqlite', 'SQLite'],
    ['transactsql', 'SQL Server (T-SQL)'],
    ['bigquery', 'BigQuery'],
    ['snowflake', 'Snowflake'],
    ['plsql', 'Oracle PL/SQL'],
    ['redshift', 'Amazon Redshift'],
    ['spark', 'Spark SQL'],
    ['duckdb', 'DuckDB'],
    ['trino', 'Trino / Presto'],
    ['clickhouse', 'ClickHouse'],
  ];

  const SAMPLE = `select o.id, c.name as customer, sum(i.qty * i.price) as total from orders o join customers c on c.id = o.customer_id left join order_items i on i.order_id = o.id where o.created_at >= '2026-01-01' and c.country in ('US','CA') group by o.id, c.name having sum(i.qty * i.price) > 100 order by total desc limit 20; update customers set vip = true where id in (select customer_id from orders group by customer_id having count(*) > 10);`;

  let text = $state('');
  let fileName = $state('');
  let language = $state<FormatSettings['language']>('sql');
  let keywordCase = $state<FormatSettings['keywordCase']>('upper');
  let indent = $state<'2' | '4' | 'tab'>('2');
  let lines = $state(1);
  let minify = $state(false);

  let out = $state('');
  let error = $state('');
  let busy = $state(false);
  let seq = 0;
  let fileInput: HTMLInputElement;

  onMount(() => closeFormatter);

  // reformat once typing pauses; only the latest request gets to update the output
  $effect(() => {
    const sql = text;
    const settings: FormatSettings = {
      language, keywordCase, minify,
      tabWidth: indent === '4' ? 4 : 2,
      useTabs: indent === 'tab',
      linesBetweenQueries: lines,
    };
    const id = ++seq;
    if (!sql.trim()) {
      out = '';
      error = '';
      busy = false;
      return;
    }
    busy = true;
    const t = setTimeout(() => {
      formatSql(sql, settings).then(
        (result) => {
          if (id !== seq) return;
          out = result;
          error = '';
          busy = false;
        },
        (e: Error) => {
          if (id !== seq || e.name === 'AbortError') return;
          out = '';
          error = e.message;
          busy = false;
        },
      );
    }, 150);
    return () => clearTimeout(t);
  });

  async function openFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    text = await file.text();
    fileName = file.name;
  }

  function download() {
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'query';
    downloadBlob(new Blob([out], { type: 'application/sql' }), `${base}-${minify ? 'min' : 'formatted'}.sql`);
  }

  const stats = $derived(out ? `${out.split('\n').length.toLocaleString('en-US')} lines · ${formatBytes(new TextEncoder().encode(out).length)}` : '');

  const cases = [['upper', 'UPPER'], ['lower', 'lower'], ['preserve', 'as typed']] as const;
  const indents = [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'tabs']] as const;
</script>

<div class="grid gap-5">
  <div class="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
    <label class="lg:w-56">
      <span class="label">dialect</span>
      <select class="field" bind:value={language}>
        {#each dialects as [value, label]}<option {value}>{label}</option>{/each}
      </select>
    </label>
    <div>
      <span class="label" id="sql-case">keywords</span>
      <div class="seg" role="group" aria-labelledby="sql-case">
        {#each cases as [value, label]}
          <button type="button" aria-pressed={keywordCase === value} onclick={() => (keywordCase = value)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class:dim={minify}>
      <span class="label" id="sql-indent">indent</span>
      <div class="seg" role="group" aria-labelledby="sql-indent">
        {#each indents as [value, label]}
          <button type="button" aria-pressed={indent === value} disabled={minify} onclick={() => (indent = value)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class:dim={minify}>
      <span class="label" id="sql-lines">blank lines between queries</span>
      <div class="seg" role="group" aria-labelledby="sql-lines">
        {#each [0, 1, 2] as n}
          <button type="button" aria-pressed={lines === n} disabled={minify} onclick={() => (lines = n)}>{n}</button>
        {/each}
      </div>
    </div>
    <label class="flex items-center gap-2 self-end pb-2 text-sm">
      <input type="checkbox" class="accent-(--color-sun)" bind:checked={minify} /> minify
    </label>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="grid content-start">
      <div class="flex items-center justify-between gap-2">
        <label for="sql-in" class="label">your SQL{fileName ? ` · ${fileName}` : ''}</label>
        <button type="button" class="mono mb-1.5 cursor-pointer underline decoration-line-2 underline-offset-4 hover:text-chalk" onclick={() => fileInput.click()}>open .sql file</button>
        <input bind:this={fileInput} type="file" accept=".sql,.txt,.ddl,text/plain" hidden onchange={openFile} />
      </div>
      <textarea
        id="sql-in"
        class="field min-h-[380px]!"
        bind:value={text}
        placeholder="SELECT * FROM paste_your_query_here"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="grid content-start">
      <div class="label flex items-center justify-between gap-2">
        <span>
          {#if !text.trim()}result{:else if busy}<span class="text-sun">formatting…</span>{:else if error}<span class="text-bad">✕ couldn't format</span>{:else}<span class="text-ok">✓ {minify ? 'minified' : 'formatted'}</span>{/if}
        </span>
        <span>{stats}</span>
      </div>
      {#if error}
        <div class="field min-h-[380px] text-bad" role="alert">{error}</div>
      {:else if !text.trim()}
        <div class="field grid min-h-[380px] place-content-center justify-items-center gap-3 text-center">
          <p class="font-serif text-2xl text-soft">Tidy SQL shows up here.</p>
          <p class="mono max-w-xs">Paste a query on the left, or try one we made messy on purpose.</p>
          <button type="button" class="btn mt-1" onclick={() => ((text = SAMPLE), (fileName = ''))}>Try a sample</button>
        </div>
      {:else}
        <textarea class="field min-h-[380px]!" class:stale={busy} readonly value={out} spellcheck="false" aria-label="Formatted SQL"></textarea>
      {/if}
    </div>
  </div>

  <div class="flex flex-wrap gap-2">
    <CopyButton text={() => (error ? '' : out)} class="btn-primary" label="Copy result" />
    <button type="button" class="btn" onclick={download} disabled={!out || !!error}>Download .sql</button>
    <button type="button" class="btn" onclick={() => (text = out)} disabled={!out || !!error || busy}>Use as input</button>
  </div>
</div>

<style>
  .dim { opacity: 0.45; }
  .stale { opacity: 0.6; transition: opacity 0.2s; }
</style>
