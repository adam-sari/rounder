<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { DiffResult, Granularity } from '@/tools/lib/diff-checker/diff';
  import { closeDiffer, diffTexts, patchTexts } from '@/tools/lib/diff-checker/client';
  import { patchFileName } from '@/tools/lib/diff-checker/names';
  import { buildRows, isFold, pieces, type View } from '@/tools/lib/diff-checker/rows';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';

  interface Side {
    text: string;
    name: string;
    size: number;
    error: string;
  }

  /** beyond this a textarea gets sluggish, so a loaded file shows as a card instead */
  const BIG = 1_000_000;
  /** rows rendered at a time; more appear on demand */
  const PAGE = 1000;
  const LABELS = ['original', 'changed'];
  const DEFAULT_NAMES = ['original.txt', 'changed.txt'];

  const blank = (): Side => ({ text: '', name: '', size: 0, error: '' });
  let sides = $state([blank(), blank()]);
  let granularity = $state<Granularity>('words');
  let view = $state<View>('split');
  let ignoreWhitespace = $state(false);
  let ignoreCase = $state(false);
  let collapse = $state(true);

  let shown = $state.raw<{ result: DiffResult; a: string; b: string } | null>(null);
  let busy = $state(false);
  let failure = $state('');
  let seq = 0;

  const expanded = new SvelteSet<number>();
  let limit = $state(PAGE);
  let current = $state(-1);
  let dragOver = $state(-1);
  let swaps = $state(0);
  let patchState = $state<'' | 'copied'>('');
  let patchError = $state('');
  let patchCache: { for: unknown; names: string; text: Promise<string> } | undefined;
  let patchTimer: ReturnType<typeof setTimeout>;

  let scroller = $state<HTMLElement>();
  const inputs: HTMLInputElement[] = [];

  $effect(() => {
    const a = sides[0].text;
    const b = sides[1].text;
    const options = { granularity, ignoreWhitespace, ignoreCase };
    const id = ++seq;
    if (!a || !b) {
      shown = null;
      busy = false;
      failure = '';
      return;
    }
    const timer = setTimeout(() => {
      busy = true;
      diffTexts(a, b, options)
        .then(
          (result) => {
            if (id !== seq) return;
            shown = { result, a, b };
            failure = '';
            expanded.clear();
            limit = PAGE;
            current = -1;
          },
          (err: Error) => {
            if (id === seq && err.name !== 'AbortError') failure = err.message;
          },
        )
        .finally(() => id === seq && (busy = false));
    }, 150);
    return () => clearTimeout(timer);
  });

  const rows = $derived(shown ? buildRows(shown.result.blocks, view, collapse, expanded) : []);
  /** row index where each change starts */
  const changeAt = $derived.by(() => {
    const at: number[] = [];
    rows.forEach((row, i) => !isFold(row) && row.change >= 0 && (at[row.change] = i));
    return at;
  });
  const digits = $derived(shown ? String(Math.max(shown.result.linesA.length, shown.result.linesB.length)).length : 1);

  onMount(() => {
    if (matchMedia('(max-width: 639px)').matches) view = 'unified';
    return () => {
      closeDiffer();
      clearTimeout(patchTimer);
    };
  });

  async function load(i: number, file: File) {
    sides[i].error = '';
    // assigned by index once read, so a swap or clear while reading can't send it to the wrong side
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bom16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
      if (!bom16 && bytes.subarray(0, 8000).includes(0)) {
        sides[i].error = `${file.name} looks like a binary file. The diff checker compares text, such as .txt, .md, .csv, .json or code.`;
        return;
      }
      const encoding = bom16 ? (bytes[0] === 0xff ? 'utf-16le' : 'utf-16be') : 'utf-8';
      sides[i] = { text: new TextDecoder(encoding).decode(bytes), name: file.name, size: file.size, error: '' };
    } catch {
      sides[i].error = `Couldn't read ${file.name}.`;
    }
  }

  function clear(i: number) {
    sides[i] = blank();
  }

  function swap() {
    sides.reverse();
    swaps++;
  }

  function example() {
    sides[0] = { ...blank(), text: 'Night Workshop opening hours\nMonday to Friday: 9am to 6pm\nSaturday: 10am to 4pm\nSunday: closed\n\nBring your own tools, or borrow ours.\nPlease clean up your bench before leaving.\n' };
    sides[1] = { ...blank(), text: 'Night Workshop opening hours\nMonday to Friday: 9am to 8pm\nSaturday: 10am to 4pm\nSunday: 12pm to 4pm\n\nBring your own tools, or borrow ours.\nFree coffee on Fridays.\nPlease tidy your bench before leaving.\n' };
  }

  async function jump(dir: 1 | -1) {
    const n = shown?.result.changes ?? 0;
    if (!n || !scroller) return;
    current = current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n;
    const row = changeAt[current];
    if (row >= limit) {
      limit = row + PAGE;
      await tick();
    }
    const el = scroller.querySelector<HTMLElement>(`[data-change="${current}"]`);
    if (!el) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: el.offsetTop - scroller.clientHeight / 3, behavior: smooth ? 'smooth' : 'auto' });
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as Element | null;
    if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'n' || e.key === 'j') jump(1);
    else if (e.key === 'p' || e.key === 'k') jump(-1);
  }

  const names = () => sides.map((s, i) => s.name || DEFAULT_NAMES[i]) as [string, string];

  function patch() {
    if (!shown) return Promise.reject(new Error('Nothing to compare yet.'));
    const n = names();
    if (patchCache?.for !== shown || patchCache.names !== n.join('\n')) {
      patchCache = { for: shown, names: n.join('\n'), text: patchTexts(shown.a, shown.b, ...n) };
    }
    return patchCache.text;
  }

  async function copyPatch() {
    patchError = '';
    const text = patch();
    try {
      // handing the clipboard a promise keeps the click's permission while the patch is built (Safari needs this)
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
    } catch {
      try {
        await navigator.clipboard.writeText(await text);
      } catch (e) {
        patchError = (e as Error).message || "Couldn't copy the patch.";
        return;
      }
    }
    patchState = 'copied';
    clearTimeout(patchTimer);
    patchTimer = setTimeout(() => (patchState = ''), 1400);
  }

  async function downloadPatch() {
    patchError = '';
    try {
      downloadBlob(new Blob([await patch()], { type: 'text/x-diff' }), patchFileName(...names()));
    } catch (e) {
      patchError = (e as Error).message;
    }
  }

  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:window onkeydown={onKey} />

{#snippet pane(side: Side, i: number)}
  <div
    class="pane"
    class:over={dragOver === i}
    role="group"
    aria-label="{LABELS[i]} text"
    ondragover={(e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragOver = i;
    }}
    ondragleave={() => (dragOver = -1)}
    ondrop={(e) => {
      dragOver = -1;
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      load(i, file);
    }}
  >
    <div class="mb-1.5 flex min-h-7 items-center justify-between gap-2">
      <label class="label mb-0! truncate" for="diff-{i}">
        {LABELS[i]}{#if side.name}<span class="text-soft"> · {side.name}</span>{/if}
      </label>
      <div class="flex shrink-0 gap-1">
        {#if side.text}<button type="button" class="mini" onclick={() => clear(i)}>clear</button>{/if}
        <button type="button" class="mini" onclick={() => inputs[i].click()}>open file</button>
      </div>
    </div>
    {#if side.text.length > BIG}
      <div id="diff-{i}" class="field bigfile">
        <span class="font-serif text-2xl leading-tight break-all">{side.name || 'Pasted text'}</span>
        <span class="mono">{side.size ? formatBytes(side.size) : plural(side.text.length, 'character')} · too big to edit here, but compared in full</span>
      </div>
    {:else}
      <textarea
        id="diff-{i}"
        class="field min-h-[200px]! md:min-h-[300px]!"
        bind:value={side.text}
        placeholder={i ? 'Paste the changed version, or drop a file here' : 'Paste the original text, or drop a file here'}
        spellcheck="false"
      ></textarea>
    {/if}
    {#if side.error}<p class="mt-1.5 text-sm text-bad" role="alert">{side.error}</p>{/if}
    <input
      bind:this={inputs[i]}
      type="file"
      hidden
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        if (file) load(i, file);
        e.currentTarget.value = '';
      }}
    />
  </div>
{/snippet}

{#snippet code(index: number, lines: string[], marks: Map<number, number[]>)}
  {#each pieces(lines[index], marks.get(index)) as p}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
{/snippet}

<div class="grid gap-4">
  <div class="grid gap-4 md:grid-cols-2">
    {#each sides as side, i}
      {@render pane(side, i)}
    {/each}
  </div>

  <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
    <div class="seg" role="group" aria-label="Compare by">
      <button type="button" aria-pressed={granularity === 'lines'} onclick={() => (granularity = 'lines')}>lines</button>
      <button type="button" aria-pressed={granularity === 'words'} onclick={() => (granularity = 'words')}>words</button>
      <button type="button" aria-pressed={granularity === 'chars'} onclick={() => (granularity = 'chars')}>characters</button>
    </div>
    <div class="seg" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'split'} onclick={() => (view = 'split')}>side by side</button>
      <button type="button" aria-pressed={view === 'unified'} onclick={() => (view = 'unified')}>unified</button>
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <label class="flex items-center gap-2"><input type="checkbox" class="accent-(--color-sun)" bind:checked={ignoreWhitespace} /> ignore whitespace</label>
      <label class="flex items-center gap-2"><input type="checkbox" class="accent-(--color-sun)" bind:checked={ignoreCase} /> ignore case</label>
      <label class="flex items-center gap-2"><input type="checkbox" class="accent-(--color-sun)" bind:checked={collapse} /> hide unchanged</label>
    </div>
    <button type="button" class="btn swap ml-auto px-3.5! py-2.5! text-sm!" onclick={swap} disabled={!sides[0].text && !sides[1].text}>
      <span class="swap-icon" style="--turns: {swaps}" aria-hidden="true">⇄</span> Swap sides
    </button>
  </div>

  {#if failure}
    <p class="text-bad" role="alert">{failure}</p>
  {/if}

  {#if shown}
    {@const r = shown.result}
    <section class="card overflow-hidden" aria-label="Differences" aria-busy={busy}>
      <header class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-2 px-4 py-3">
        {#key r}
          <div class="pop flex items-baseline gap-3">
            <span class="font-serif text-3xl leading-none text-ok">+{r.added.toLocaleString()}</span>
            <span class="font-serif text-3xl leading-none text-bad">−{r.removed.toLocaleString()}</span>
            <span class="mono">{plural(r.changes, 'change')}</span>
          </div>
        {/key}
        {#if busy}<span class="mono animate-pulse">comparing…</span>{/if}
        {#if r.changes}
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <div class="nav" role="group" aria-label="Jump between changes">
              <button type="button" onclick={() => jump(-1)} aria-label="Previous change" title="Previous change (P)">↑</button>
              <span class="mono min-w-14 text-center" aria-live="polite">{current < 0 ? '–' : current + 1} / {r.changes}</span>
              <button type="button" onclick={() => jump(1)} aria-label="Next change" title="Next change (N)">↓</button>
            </div>
            <button type="button" class="btn px-3.5! py-2.5! text-sm!" onclick={copyPatch} aria-live="polite" title="Unified diff of the exact texts">
              {patchState === 'copied' ? 'Copied ✓' : 'Copy patch'}
            </button>
            <button type="button" class="btn px-3.5! py-2.5! text-sm!" onclick={downloadPatch}>Download .diff</button>
          </div>
        {/if}
      </header>
      {#if patchError}<p class="border-b border-line-2 px-4 py-2 text-sm text-bad" role="alert">{patchError}</p>{/if}
      {#if r.approximate || (r.eolDiffers && r.changes)}
        <div class="mono grid gap-1 border-b border-line-2 px-4 py-2">
          {#if r.approximate}<p>These texts are heavily rearranged, so this is a quick match rather than the smallest possible diff.</p>{/if}
          {#if r.eolDiffers && r.changes}<p>Line endings differ (Windows CRLF vs Unix LF). They're ignored here, but the patch keeps them.</p>{/if}
        </div>
      {/if}

      {#if !r.changes}
        <div class="same">
          <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
            <circle cx="24" cy="24" r="21" />
            <path d="M15 24.5l6 6 12-13" />
          </svg>
          <p class="font-serif text-4xl">No differences</p>
          <p class="mono max-w-md text-center">
            {#if shown.a === shown.b}
              The two texts are exactly the same, all {plural(r.linesA.length, 'line')}.
            {:else if r.eolDiffers}
              Only the line endings differ (Windows CRLF vs Unix LF).
            {:else}
              They only differ in whitespace, letter case or a final newline, which this comparison ignores.
            {/if}
          </p>
        </div>
      {:else}
        <div class="scroller" bind:this={scroller} style="--nw: {digits + 1}ch">
          {#each rows.slice(0, limit) as row}
            {#if isFold(row)}
              <button type="button" class="fold" onclick={() => expanded.add(row.block)}>
                <span aria-hidden="true">⋯</span> show {plural(row.count, 'unchanged line')}
              </button>
            {:else if view === 'split'}
              <div class="row split" data-change={row.change >= 0 ? row.change : undefined} class:current={row.change >= 0 && row.change === current}>
                {#if row.a >= 0}
                  <span class="num" class:del={!row.equal}>{row.a + 1}</span>
                  <span class="code" class:del={!row.equal}>{#if !row.equal}<span class="sr-only">removed: </span>{/if}{@render code(row.a, r.linesA, r.marksA)}</span>
                {:else}
                  <span class="num"></span><span class="code empty"></span>
                {/if}
                {#if row.b >= 0}
                  <span class="num" class:add={!row.equal}>{row.b + 1}</span>
                  <span class="code" class:add={!row.equal}>{#if !row.equal}<span class="sr-only">added: </span>{/if}{@render code(row.b, r.linesB, r.marksB)}</span>
                {:else}
                  <span class="num"></span><span class="code empty"></span>
                {/if}
              </div>
            {:else}
              {@const kind = row.equal ? '' : row.a >= 0 ? 'del' : 'add'}
              <div class="row unified {kind}" data-change={row.change >= 0 ? row.change : undefined} class:current={row.change >= 0 && row.change === current}>
                <span class="num">{row.a >= 0 ? row.a + 1 : ''}</span>
                <span class="num">{row.b >= 0 ? row.b + 1 : ''}</span>
                <span class="sign" aria-hidden="true">{kind === 'del' ? '−' : kind === 'add' ? '+' : ''}</span>
                <span class="code">{#if kind === 'del'}<span class="sr-only">removed: </span>{@render code(row.a, r.linesA, r.marksA)}{:else}{#if kind === 'add'}<span class="sr-only">added: </span>{/if}{@render code(row.b, r.linesB, r.marksB)}{/if}</span>
              </div>
            {/if}
          {/each}
          {#if rows.length > limit}
            <button type="button" class="fold more" onclick={() => (limit += PAGE)}>
              show the next {Math.min(PAGE, rows.length - limit).toLocaleString()} of {plural(rows.length - limit, 'remaining row')}
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {:else if busy}
    <div class="empty mono" aria-busy="true"><span class="animate-pulse">comparing…</span></div>
  {:else}
    <div class="empty">
      <p class="font-serif text-3xl">Spot every change</p>
      <p class="mono max-w-sm text-center">Paste or drop text into both sides. Differences show up here as you type.</p>
      <button type="button" class="btn mt-2 px-3.5! py-2.5! text-sm!" onclick={example}>Try an example</button>
    </div>
  {/if}
</div>

<style>
  .pane {
    min-width: 0;
  }
  .pane.over :global(.field) {
    border-color: var(--color-sun);
    border-style: dashed;
    background-color: #ffd25e0d;
  }
  .mini {
    font: 400 12px var(--font-mono);
    color: var(--color-muted);
    padding: 4px 9px;
    border: 1px solid var(--color-line-2);
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .bigfile {
    display: grid;
    align-content: center;
    gap: 6px;
    min-height: 200px;
    @media (min-width: 768px) {
      min-height: 300px;
    }
  }
  .swap-icon {
    display: inline-block;
    transform: rotate(calc(var(--turns) * 180deg));
    transition: transform 0.45s var(--ease-spring);
  }

  .nav {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    & button {
      width: 38px;
      height: 38px;
      color: var(--color-chalk);
      background: transparent;
      border: 0;
      border-radius: 11px;
      cursor: pointer;
      &:hover {
        background: var(--color-panel-2);
        color: var(--color-sun);
      }
    }
  }

  .pop {
    animation: pop 0.35s var(--ease-spring);
  }
  @keyframes pop {
    from {
      opacity: 0.4;
      transform: translateY(4px);
    }
  }

  .empty,
  .same {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 48px 20px;
    text-align: center;
  }
  .empty {
    min-height: 220px;
    align-content: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px);
  }
  .same svg {
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      --len: 132;
      animation: draw 0.6s ease-out both;
    }
    & path {
      --len: 30;
      animation: draw 0.35s 0.45s ease-out both;
    }
    & * {
      stroke-dasharray: var(--len);
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: var(--len);
    }
  }

  .scroller {
    position: relative;
    max-height: 72vh;
    overflow: auto;
    overscroll-behavior: contain;
    font: 400 13px/1.6 var(--font-mono);
    padding-block: 6px;
    tab-size: 4;
  }
  .row {
    display: grid;
    min-width: 0;
  }
  .row.split {
    grid-template-columns: var(--nw) minmax(0, 1fr) var(--nw) minmax(0, 1fr);
  }
  .row.unified {
    grid-template-columns: var(--nw) var(--nw) 1.6ch minmax(0, 1fr);
  }
  .num {
    padding-inline: 0 0.8ch;
    text-align: right;
    color: #6e6960;
    user-select: none;
  }
  .split .num:nth-child(3) {
    border-left: 1px solid var(--color-line);
  }
  .sign {
    user-select: none;
  }
  .code {
    min-height: 1.6em;
    padding-inline: 0.6ch 1.4ch;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--color-soft);
  }
  .del {
    background: #ff7a6b17;
  }
  .add {
    background: #9be58f14;
  }
  .num.del,
  .num.add,
  .unified.del .num,
  .unified.add .num {
    color: var(--color-muted);
  }
  .code.del,
  .code.add,
  .unified.del .code,
  .unified.add .code {
    color: var(--color-chalk);
  }
  .unified.del .sign {
    color: var(--color-bad);
  }
  .unified.add .sign {
    color: var(--color-ok);
  }
  .del :global(mark) {
    background: #ff7a6b4d;
    color: inherit;
    border-radius: 3px;
  }
  .add :global(mark) {
    background: #9be58f45;
    color: inherit;
    border-radius: 3px;
  }
  .code.empty {
    background: repeating-linear-gradient(-45deg, transparent 0 6px, #f2ede40a 6px 7px);
  }
  .row.current {
    box-shadow: inset 3px 0 0 var(--color-sun);
    animation: flash 0.9s ease-out;
  }
  @keyframes flash {
    from {
      background-color: #ffd25e2e;
    }
  }
  .fold {
    display: block;
    width: 100%;
    margin-block: 4px;
    padding: 6px 12px;
    font: 400 12.5px var(--font-mono);
    color: var(--color-muted);
    text-align: center;
    background: #f2ede405;
    border: 0;
    border-block: 1px dashed var(--color-line-2);
    cursor: pointer;
    transition: color 0.2s, background-color 0.2s;
    &:hover {
      color: var(--color-sun);
      background: #ffd25e0d;
    }
  }
  .fold.more {
    margin-top: 8px;
  }
</style>
