<script lang="ts">
  import { onMount } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import PdfPageGrid from '@/components/tool/PdfPageGrid.svelte';
  import { formatPageRanges, isAbort, PageRangeError, pageRefs, parsePageRangeGroups, type PageRef } from '@/engines/pdf';
  import { downloadResult, formatBytes, uniqueNames } from '@/tools/lib/files';
  import { everyN, groupLabel, halves, leftOut, outputName } from '@/tools/lib/split-pdf/plan';
  import { Splitter } from '@/tools/lib/split-pdf/client';

  type Mode = 'ranges' | 'every' | 'select' | 'size';
  interface Part {
    name: string;
    blob: Blob;
    indices: number[];
    over?: boolean;
  }

  const MODES: [Mode, string, string][] = [
    ['ranges', 'Custom ranges', 'one PDF per range'],
    ['every', 'Every N pages', 'equal chunks'],
    ['select', 'Pick pages', 'click thumbnails'],
    ['size', 'By file size', 'e.g. for email'],
  ];
  const COLORS = ['--color-sun', '--color-image', '--color-pdf', '--color-dev', '--color-everyday', '--color-ai', '--color-text', '--color-files'];
  const MB = 1024 * 1024;
  const uid = $props.id();
  const SIZE_PRESETS = [5, 10, 20, 25];

  let pdf = $state.raw<OpenedPdf | null>(null);
  let pages = $state<PageRef[]>([]);
  let selected = $state<string[]>([]);
  let mode = $state<Mode>('ranges');
  let rangeInput = $state('');
  let rangeText = $state('');
  let every = $state(1);
  let separate = $state(false);
  let limitMb = $state(10);

  let splitter: Splitter | undefined;
  let job = $state<{ done: number; total: number; sizing: boolean } | null>(null);
  let parts = $state.raw<Part[] | null>(null);
  let zip: Blob | undefined;
  let zipping = $state(false);
  let error = $state('');

  const numPages = $derived(pdf?.doc.numPages ?? 0);
  const base = $derived(pdf?.file.name.replace(/\.pdf$/i, '').trim() || 'document');
  const color = (g: number) => `var(${COLORS[g % COLORS.length]})`;
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  // typing "1-" on the way to "1-5" shouldn't flash an error
  $effect(() => {
    const text = rangeInput;
    const t = setTimeout(() => (rangeText = text), 150);
    return () => clearTimeout(t);
  });

  const picked = $derived.by(() => {
    const on = new Set(selected);
    return pages.filter((p) => on.has(p.id)).map((p) => p.pageIndex);
  });

  const plan = $derived.by((): { groups: number[][]; problem: string } => {
    if (!numPages) return { groups: [], problem: '' };
    if (mode === 'ranges') {
      if (!rangeText.trim()) return { groups: [], problem: '' };
      try {
        return { groups: parsePageRangeGroups(rangeText, numPages), problem: '' };
      } catch (e) {
        return { groups: [], problem: e instanceof PageRangeError ? e.message : String(e) };
      }
    }
    if (mode === 'every') return { groups: every >= 1 ? everyN(numPages, every) : [], problem: every >= 1 ? '' : 'Enter a number of pages, 1 or more.' };
    if (mode === 'select') return { groups: separate ? picked.map((i) => [i]) : picked.length ? [picked] : [], problem: '' };
    return { groups: parts?.map((p) => p.indices) ?? [], problem: limitMb > 0 ? '' : 'Enter a size above 0 MB.' };
  });

  // page index → the files it goes into
  const membership = $derived.by(() => {
    const m = new Map<number, number[]>();
    plan.groups.forEach((g, gi) => {
      for (const i of g) {
        const list = m.get(i) ?? [];
        if (list.at(-1) !== gi) list.push(gi);
        m.set(i, list);
      }
    });
    return m;
  });

  const skipped = $derived(mode === 'ranges' || mode === 'every' ? leftOut(plan.groups, numPages) : []);

  const action = $derived.by(() => {
    const n = plan.groups.length;
    if (mode === 'size') return `Split into files under ${limitMb || 0} MB`;
    if (mode === 'select' && !picked.length) return 'Pick pages to extract';
    if (!n) return mode === 'ranges' ? 'Enter page ranges' : 'Split PDF';
    if (n === 1) return `Extract ${plural(plan.groups[0].length, 'page')}`;
    return `Split into ${plural(n, 'PDF')}`;
  });
  const canSplit = $derived(!!pdf && !job && !plan.problem && (mode === 'size' ? limitMb > 0 : plan.groups.length > 0));

  // any change to the plan makes the finished files out of date
  $effect(() => {
    void [mode, rangeText, every, separate, limitMb, selected];
    parts = null;
    zip = undefined;
    error = '';
  });

  onMount(() => () => {
    splitter?.dispose();
    void pdf?.doc.destroy();
  });

  function open(next: OpenedPdf) {
    splitter?.dispose();
    void pdf?.doc.destroy();
    // starts reading the file into the worker now, so Split is quick
    splitter = new Splitter(next.file, next.doc.numPages, next.password);
    pdf = next;
    pages = pageRefs(next.doc);
    selected = [];
    rangeInput = rangeText = halves(next.doc.numPages);
    every = 1;
    job = null;
    parts = null;
    zip = undefined;
    error = '';
  }

  function cancel() {
    if (!pdf) return;
    // the worker can't be interrupted mid-save, so start a fresh one
    splitter?.dispose();
    splitter = new Splitter(pdf.file, numPages, pdf.password);
    job = null;
  }

  const toBlob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });

  async function split() {
    // a click within the typing debounce would split by the ranges from before the last keystroke
    rangeText = rangeInput;
    if (!canSplit || !splitter) return;
    const s = splitter;
    error = '';
    parts = null;
    zip = undefined;
    try {
      let out: Part[];
      if (mode === 'size') {
        const limit = limitMb * MB;
        // start from the pages that would fit if every page were average-sized
        const guess = Math.max(1, Math.floor((limit / Math.max(1, pdf!.file.size / numPages)) * 0.9));
        job = { done: 0, total: numPages, sizing: true };
        const sized = await s.bySize(limit, guess, (done) => job && (job.done = done));
        out = sized.map((p, i) => ({ name: outputName(base, p.indices, i), blob: toBlob(p.bytes), indices: p.indices, over: p.over }));
      } else {
        const groups = plan.groups;
        job = { done: 0, total: groups.length, sizing: false };
        out = [];
        for (const [i, g] of groups.entries()) {
          out.push({ name: outputName(base, g, i), blob: toBlob(await s.build(g)), indices: g });
          if (job) job.done = i + 1;
        }
      }
      const names = uniqueNames(out.map((p) => p.name));
      parts = out.map((p, i) => ({ ...p, name: names[i] }));
    } catch (e) {
      if (!isAbort(e)) error = (e as Error).message;
    } finally {
      if (splitter === s) job = null;
    }
  }

  async function downloadAll() {
    if (!parts || !splitter || zipping) return;
    zipping = true;
    try {
      zip ??= new Blob([(await splitter.zip(parts.map((p) => ({ name: p.name, data: p.blob })))) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
      downloadResult(zip, `${base}-split.zip`);
    } catch (e) {
      if (!isAbort(e)) error = (e as Error).message;
    } finally {
      zipping = false;
    }
  }

  const totalSize = $derived(parts?.reduce((s, p) => s + p.blob.size, 0) ?? 0);
</script>

{#snippet tag(page: PageRef)}
  {@const groups = membership.get(page.pageIndex)}
  {#if groups?.length}
    {#if mode !== 'select'}<span class="tint" style:--c={color(groups[0])}></span>{/if}
    <span class="chips">
      {#each groups.slice(0, 3) as g (g)}
        <span class="chip" style:--c={color(g)}>{g + 1}</span>
      {/each}
      {#if groups.length > 3}<span class="chip more">+{groups.length - 3}</span>{/if}
    </span>
  {:else if skipped.length && plan.groups.length}
    <span class="skip"><span class="mono">left out</span></span>
  {/if}
{/snippet}

{#if !pdf}
  <PdfDrop title="Drop a PDF to split" onopen={open} />
{:else}
  <div class="layout">
    <aside class="grid content-start gap-5">
      <div class="file">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.75h8.5L19.25 7.5v13.75H6z" /><path d="M14.25 2.75V7.5h5" /></svg>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium" title={pdf.file.name}>{pdf.file.name}</p>
          <p class="mono">{plural(numPages, 'page')} · {formatBytes(pdf.file.size)}</p>
        </div>
      </div>

      <fieldset>
        <legend class="label">how to split</legend>
        <div class="modes">
          {#each MODES as [value, title, sub] (value)}
            <button type="button" class="mode" aria-pressed={mode === value} disabled={!!job} onclick={() => (mode = value)}>
              <span class="font-medium">{title}</span>
              <span class="mono">{sub}</span>
            </button>
          {/each}
        </div>
      </fieldset>

      {#if mode === 'ranges'}
        <div>
          <label class="label" for="{uid}-ranges">page ranges</label>
          <input id="{uid}-ranges" class="field mono-input" type="text" bind:value={rangeInput} placeholder="1-3, 4-7, 8-" spellcheck="false" autocomplete="off" aria-invalid={!!plan.problem} aria-describedby="{uid}-ranges-hint" disabled={!!job} />
          <p id="{uid}-ranges-hint" class="mono mt-2">Each range becomes its own PDF. “8-” means page 8 to the end.</p>
        </div>
      {:else if mode === 'every'}
        <div>
          <label class="label" for="{uid}-every">pages per file</label>
          <div class="stepper">
            <button type="button" class="btn" aria-label="Fewer pages per file" disabled={!!job || every <= 1} onclick={() => (every = Math.max(1, every - 1))}>−</button>
            <input id="{uid}-every" class="field" type="number" min="1" max={numPages} step="1" inputmode="numeric" bind:value={every} disabled={!!job} />
            <button type="button" class="btn" aria-label="More pages per file" disabled={!!job || every >= numPages} onclick={() => (every = Math.min(numPages, every + 1))}>+</button>
          </div>
          <span class="mono mt-2 block">{every === 1 ? 'Every page becomes its own PDF.' : `A new PDF starts every ${every} pages.`}</span>
        </div>
      {:else if mode === 'select'}
        <div>
          <span class="label">save the picked pages as</span>
          <div class="seg" role="group" aria-label="Save the picked pages as">
            <button type="button" aria-pressed={!separate} disabled={!!job} onclick={() => (separate = false)}>one PDF</button>
            <button type="button" aria-pressed={separate} disabled={!!job} onclick={() => (separate = true)}>a PDF per page</button>
          </div>
          <span class="mono mt-2 block">Click pages to pick them. Shift-click picks a run.</span>
        </div>
      {:else}
        <div>
          <label class="label" for="{uid}-size">largest file size</label>
          <div class="relative">
            <input id="{uid}-size" class="field pr-12!" type="number" min="0.1" step="0.5" inputmode="decimal" bind:value={limitMb} disabled={!!job} />
            <span class="unit mono" aria-hidden="true">MB</span>
          </div>
          <div class="seg mt-2" role="group" aria-label="Size presets">
            {#each SIZE_PRESETS as mb (mb)}
              <button type="button" aria-pressed={limitMb === mb} disabled={!!job} onclick={() => (limitMb = mb)}>{mb} MB</button>
            {/each}
          </div>
          <span class="mono mt-2 block">
            {#if limitMb > 0 && pdf.file.size <= limitMb * MB}
              This PDF is already under {limitMb} MB, so you'll most likely get one file.
            {:else}
              Each file is measured as it's built and kept at or under the limit. Pages stay in order.
            {/if}
          </span>
        </div>
      {/if}

      {#if plan.problem}
        <p class="text-sm text-bad" role="alert">{plan.problem}</p>
      {:else if plan.groups.length && !parts}
        <div class="plan" aria-live="polite">
          <ul>
            {#each plan.groups.slice(0, 6) as g, gi (gi)}
              <li>
                <span class="dot" style:--c={color(gi)}></span>
                <span class="mono">file {gi + 1}</span>
                <span class="truncate">{g.length === 1 ? 'page' : 'pages'} {groupLabel(g)}</span>
              </li>
            {/each}
          </ul>
          {#if plan.groups.length > 6}<p class="mono">and {plural(plan.groups.length - 6, 'more file')}</p>{/if}
          {#if skipped.length}
            <p class="mono warn">{skipped.length === 1 ? 'Page' : 'Pages'} {formatPageRanges(skipped)} {skipped.length === 1 ? "isn't" : "aren't"} in any file.</p>
          {/if}
        </div>
      {/if}

      {#if job}
        <div class="progress" role="status">
          <div class="flex items-center justify-between gap-3">
            <span class="mono">
              {job.sizing ? `Fitting pages… ${job.done} of ${numPages}` : `Building file ${Math.min(job.done + 1, job.total)} of ${job.total}…`}
            </span>
            <button type="button" class="link" onclick={cancel}>Cancel</button>
          </div>
          <span class="bar"><span style:width="{job.total ? (job.done / job.total) * 100 : 0}%"></span></span>
        </div>
      {:else if !parts}
        <button type="button" class="btn btn-primary w-full" disabled={!canSplit} onclick={split}>{action}</button>
      {/if}

      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

      {#if parts}
        <section class="done" aria-label="Your files">
          <header class="flex items-center gap-3">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
            <div class="min-w-0">
              <p class="font-medium">{plural(parts.length, 'PDF')} ready</p>
              <p class="mono">{formatBytes(totalSize)} in total</p>
            </div>
          </header>
          {#if parts.length > 1}
            <button type="button" class="btn btn-primary w-full" disabled={zipping} onclick={downloadAll}>{zipping ? 'Zipping…' : 'Download all (.zip)'}</button>
          {:else}
            <button type="button" class="btn btn-primary w-full" onclick={() => downloadResult(parts![0].blob, parts![0].name)}>Download PDF</button>
          {/if}
          <ul class="parts">
            {#each parts as p, i (p.name)}
              <li style:--i={Math.min(i, 12)}>
                <span class="dot" style:--c={color(i)}></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm" title={p.name}>{p.name}</span>
                  <span class="mono block">{plural(p.indices.length, 'page')} · {formatBytes(p.blob.size)}</span>
                  {#if p.over}<span class="mono block text-bad!">This page alone is over {limitMb} MB.</span>{/if}
                </span>
                <button type="button" class="btn icon" aria-label="Download {p.name}" title="Download" onclick={() => downloadResult(p.blob, p.name)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" /></svg>
                </button>
              </li>
            {/each}
          </ul>
          <button type="button" class="link justify-self-start" onclick={() => (parts = null)}>Change how it's split</button>
        </section>
      {/if}

      <PdfDrop compact title="Split another PDF" onopen={open} />
    </aside>

    <section class="pages" aria-label="Pages of {pdf.file.name}">
      <PdfPageGrid
        bind:pages
        bind:selected
        selectable={mode === 'select' && !job}
        toolbar={mode === 'select'}
        size={128}
        overlay={tag}
        ariaLabel="Pages of {pdf.file.name}"
      />
    </section>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    gap: 24px;
  }
  /* controls come first on phones; on wide screens they sit beside a scrolling page grid */
  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 320px;
      & > aside {
        grid-column: 2;
        grid-row: 1;
      }
      & > .pages {
        grid-column: 1;
        grid-row: 1;
        max-height: 78vh;
        overflow-y: auto;
        padding: 4px 8px 4px 4px;
        scrollbar-width: thin;
      }
    }
  }

  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel-2);
    & svg {
      flex: none;
      width: 28px;
      height: 28px;
      fill: none;
      stroke: var(--color-pdf);
      stroke-width: 1.5;
      stroke-linejoin: round;
    }
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .mode {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-chalk);
    font-size: 14px;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    & .mono {
      font-size: 11.5px;
    }
    &:hover:not(:disabled) {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      background: #ffd25e12;
      box-shadow: 0 0 0 1px var(--color-sun);
    }
    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
  }

  .mono-input {
    font-family: var(--font-mono);
    &[aria-invalid='true'] {
      border-color: var(--color-bad);
    }
  }
  .stepper {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 6px;
    & .btn {
      padding: 0;
      justify-content: center;
      font-size: 18px;
    }
    & input {
      text-align: center;
    }
  }
  .unit {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .plan {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border: 1px dashed var(--color-line-2);
    border-radius: 14px;
    & ul {
      display: grid;
      gap: 6px;
    }
    & li {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
  }
  .warn {
    color: var(--color-everyday);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--c);
    flex: none;
  }

  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 4px 2px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .progress {
    display: grid;
    gap: 10px;
  }
  .bar {
    display: block;
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.3s ease-out;
    }
  }

  .done {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel-2);
  }
  .tick {
    flex: none;
    width: 30px;
    height: 30px;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 63;
      animation: draw 0.5s ease-out both;
    }
    & path {
      stroke-dasharray: 14;
      animation: draw-tick 0.3s 0.35s ease-out both;
    }
  }
  /* one keyframe per length: an offset past the dash length would flicker through the pattern */
  @keyframes draw {
    from { stroke-dashoffset: 63; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes draw-tick {
    from { stroke-dashoffset: 14; }
    to { stroke-dashoffset: 0; }
  }
  .parts {
    display: grid;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    margin: 0 -6px;
    scrollbar-width: thin;
    & li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px;
      border-radius: 10px;
      animation: rise 0.35s calc(var(--i) * 35ms) ease-out both;
      &:hover {
        background: #f2ede40a;
      }
    }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px); }
  }
  .icon {
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
    & svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }

  /* layers over each thumbnail */
  .tint {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 0 0 2px var(--c);
    background: color-mix(in srgb, var(--c) 9%, transparent);
    transition: box-shadow 0.25s, background-color 0.25s;
  }
  .chips {
    position: absolute;
    top: 7px;
    right: 7px;
    display: flex;
    gap: 3px;
    pointer-events: none;
  }
  .chip {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--c);
    color: var(--color-bg);
    font: 600 11px/18px var(--font-mono);
    text-align: center;
    box-shadow: 0 2px 6px #0008;
    animation: pop 0.3s var(--ease-spring);
    &.more {
      background: var(--color-chalk);
    }
  }
  @keyframes pop {
    from { transform: scale(0.6); opacity: 0; }
  }
  .skip {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: end center;
    padding-bottom: 8px;
    pointer-events: none;
    background: #131211b0;
    & .mono {
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 99px;
      background: var(--color-panel);
      border: 1px solid var(--color-line-2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tick circle,
    .tick path,
    .parts li,
    .chip {
      animation: none;
    }
    .tint,
    .bar span {
      transition: none;
    }
  }
</style>
