<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { foldText, pairLabel, type Granularity, type Part, type TextComparison } from '@/tools/lib/compare-pdf/text';

  interface Props {
    result: TextComparison;
    /** a newer comparison is on its way */
    busy: boolean;
    granularity: Granularity;
    /** names of files without any selectable text */
    textless: string[];
    onvisual: () => void;
  }

  let { result, busy, granularity = $bindable(), textless, onvisual }: Props = $props();

  /** page pairs rendered at a time; more on demand */
  const PAGE = 30;
  /** characters of unchanged text kept around each change */
  const KEEP = 220;

  let view = $state<'split' | 'inline'>('split');
  let showSame = $state(false);
  let limit = $state(PAGE);
  let current = $state(-1);
  const expanded = new SvelteSet<string>();
  let scroller = $state<HTMLElement>();

  $effect(() => {
    void result;
    untrack(() => {
      current = -1;
      limit = PAGE;
      expanded.clear();
    });
  });

  onMount(() => {
    if (matchMedia('(max-width: 639px)').matches) view = 'inline';
  });

  /** global number of each pair's first change */
  const offsets = $derived.by(() => {
    let n = 0;
    return result.pairs.map((p) => ((n += p.changes), n - p.changes));
  });
  const visible = $derived(result.pairs.flatMap((p, k) => (showSame || p.changes ? [k] : [])));
  const unchanged = $derived(result.pairs.length - result.changedPages);

  async function scrollTo(selector: string, fallback?: string) {
    await tick();
    const el = scroller?.querySelector<HTMLElement>(selector) ?? (fallback ? scroller?.querySelector<HTMLElement>(fallback) : null);
    if (!el || !scroller) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: top - scroller.clientHeight / 3, behavior: smooth ? 'smooth' : 'auto' });
  }

  function jump(dir: 1 | -1) {
    const n = result.changes;
    if (!n) return;
    current = current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n;
    const k = offsets.findLastIndex((o, i) => o <= current && result.pairs[i].changes);
    const at = visible.indexOf(k);
    if (at >= limit) limit = at + PAGE;
    // a new or removed page without text has no marked change to land on
    void scrollTo(`[data-change="${current}"]`, `[data-pair="${k}"]`);
  }

  function goTo(k: number) {
    const at = visible.indexOf(k);
    if (at >= limit) limit = at + PAGE;
    if (result.pairs[k].changes) current = offsets[k];
    void scrollTo(`[data-pair="${k}"]`);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as Element | null;
    if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'n' || e.key === 'j') jump(1);
    else if (e.key === 'p' || e.key === 'k') jump(-1);
  }

  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
</script>

<svelte:window onkeydown={onKey} />

{#snippet same(part: Part, key: string, j: number, last: number)}
  {@const f = expanded.has(key) ? null : foldText(part.text, j > 0 ? KEEP : 0, j < last ? KEEP : 0)}
  {#if f}{f.head}<button type="button" class="fold" onclick={() => expanded.add(key)}><span aria-hidden="true">⋯</span> {plural(f.hidden, 'unchanged word')}</button>{f.tail}{:else}{part.text}{/if}
{/snippet}

{#snippet flow(k: number, show: 'all' | 'del' | 'add')}
  {@const pair = result.pairs[k]}
  {@const last = pair.parts.length - 1}
  {#each pair.parts as part, j}
    {#if part.kind === 'same'}
      {@render same(part, `${k}:${j}`, j, last)}
    {:else if show === 'all' || show === part.kind}
      {@const id = offsets[k] + part.hunk}
      <span class={part.kind} class:current={id === current} data-change={id}><span class="sr-only">{part.kind === 'add' ? 'added: ' : 'removed: '}</span>{part.text}</span>
    {/if}
  {/each}
{/snippet}

<section class="card overflow-hidden" aria-label="Text differences" aria-busy={busy}>
  <header class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-2 px-4 py-3">
    {#key result}
      <div class="pop flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="font-serif text-3xl leading-none text-ok">+{result.added.toLocaleString()}</span>
        <span class="font-serif text-3xl leading-none text-bad">−{result.removed.toLocaleString()}</span>
        <span class="mono">words · {plural(result.changes, 'change')} on {plural(result.changedPages, 'page')}</span>
      </div>
    {/key}
    {#if busy}<span class="mono animate-pulse">comparing…</span>{/if}
    {#if result.changes}
      <div class="nav ml-auto" role="group" aria-label="Jump between changes">
        <button type="button" onclick={() => jump(-1)} aria-label="Previous change" title="Previous change (P)">↑</button>
        <span class="mono min-w-16 text-center" aria-live="polite">{current < 0 ? '–' : current + 1} / {result.changes}</span>
        <button type="button" onclick={() => jump(1)} aria-label="Next change" title="Next change (N)">↓</button>
      </div>
    {/if}
  </header>

  <div class="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-2 px-4 py-3">
    <div class="seg" role="group" aria-label="Compare by">
      <button type="button" aria-pressed={granularity === 'words'} onclick={() => (granularity = 'words')}>words</button>
      <button type="button" aria-pressed={granularity === 'lines'} onclick={() => (granularity = 'lines')}>lines</button>
    </div>
    <div class="seg" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'split'} onclick={() => (view = 'split')}>side by side</button>
      <button type="button" aria-pressed={view === 'inline'} onclick={() => (view = 'inline')}>inline</button>
    </div>
    {#if unchanged && result.changes}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="accent-(--color-sun)" bind:checked={showSame} /> show {plural(unchanged, 'unchanged page')}</label>
    {/if}
  </div>

  {#if (result.changes && textless.length) || result.approximate}
    <div class="mono grid gap-1 border-b border-line-2 px-4 py-2">
      {#each result.changes ? textless : [] as name}
        <p><span class="text-chalk">{name}</span> has no selectable text, so it may be a scan. <button type="button" class="link" onclick={onvisual}>Visual changes</button> works on scans.</p>
      {/each}
      {#if result.approximate}<p>Some pages were too different to compare word by word, so they're compared line by line.</p>{/if}
    </div>
  {/if}

  {#if !result.changes}
    <div class="same">
      {#if textless.length}
        <p class="font-serif text-4xl">No text to compare</p>
        <p class="mono max-w-md text-center">Neither PDF has selectable text. Compare how the pages look instead:</p>
      {:else}
        <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
          <circle cx="24" cy="24" r="21" />
          <path d="M15 24.5l6 6 12-13" />
        </svg>
        <p class="font-serif text-4xl">Same text</p>
        <p class="mono max-w-md text-center">
          All {plural(result.pairs.length, 'page')} have the same words. Spacing and line breaks are ignored. Images, colors and layout can still differ:
        </p>
      {/if}
      <button type="button" class="btn mt-1 px-3.5! py-2.5! text-sm!" onclick={onvisual}>Check visual changes</button>
    </div>
  {:else}
    <div class="body">
      <nav class="pages" aria-label="Pages">
        {#each visible as k (k)}
          {@const p = result.pairs[k]}
          <button type="button" onclick={() => goTo(k)} class:dim={!p.changes}>
            <span class="truncate">{pairLabel(p)}</span>
            {#if p.a < 0}<span class="tag add">new</span>
            {:else if p.b < 0}<span class="tag del">gone</span>
            {:else if p.changes}<span class="count">{p.changes}</span>{/if}
          </button>
        {/each}
      </nav>

      <div class="scroller" bind:this={scroller}>
        {#each visible.slice(0, limit) as k (k)}
          {@const p = result.pairs[k]}
          <article class="page" data-pair={k}>
            <h3 class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="font-serif text-xl">{pairLabel(p)}</span>
              {#if p.a < 0}<span class="mono">only in the changed PDF</span>
              {:else if p.b < 0}<span class="mono">only in the original PDF</span>
              {:else if p.changes}<span class="mono">{plural(p.changes, 'change')} · <span class="text-ok">+{p.added}</span> <span class="text-bad">−{p.removed}</span></span>
              {:else}<span class="mono">unchanged</span>{/if}
            </h3>
            {#if !p.parts.length}
              <p class="mono mt-2">No text on this page.</p>
            {:else if view === 'inline' || p.a < 0 || p.b < 0}
              <div class="text">{@render flow(k, 'all')}</div>
            {:else}
              <div class="cols">
                <div class="text" role="group" aria-label="Original">{@render flow(k, 'del')}</div>
                <div class="text" role="group" aria-label="Changed">{@render flow(k, 'add')}</div>
              </div>
            {/if}
          </article>
        {/each}
        {#if visible.length > limit}
          <button type="button" class="fold more" onclick={() => (limit += PAGE)}>show the next {Math.min(PAGE, visible.length - limit)} of {plural(visible.length - limit, 'remaining page')}</button>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
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
  .link {
    color: var(--color-sun);
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }

  .same {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 48px 20px;
    text-align: center;
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

  .body {
    display: grid;
    @media (min-width: 768px) {
      grid-template-columns: 11.5rem minmax(0, 1fr);
    }
  }
  .pages {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-line-2);
    @media (min-width: 768px) {
      flex-direction: column;
      gap: 2px;
      max-height: 72vh;
      overflow: auto;
      padding: 10px 8px;
      border-bottom: 0;
      border-right: 1px solid var(--color-line-2);
    }
    & button {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      font: 400 13px var(--font-mono);
      color: var(--color-soft);
      text-align: left;
      background: transparent;
      border: 1px solid var(--color-line);
      border-radius: 9px;
      cursor: pointer;
      transition: color 0.2s, background-color 0.2s;
      @media (min-width: 768px) {
        border-color: transparent;
      }
      &:hover {
        color: var(--color-chalk);
        background: var(--color-panel-2);
      }
      &.dim {
        color: var(--color-muted);
      }
    }
  }
  .count,
  .tag {
    flex: none;
    min-width: 22px;
    padding: 1px 6px;
    font-size: 11.5px;
    text-align: center;
    border-radius: 99px;
    color: var(--color-bg);
    background: var(--color-sun);
  }
  .tag.add {
    background: var(--color-ok);
  }
  .tag.del {
    background: var(--color-bad);
  }

  .scroller {
    max-height: 72vh;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 6px 16px 16px;
  }
  .page {
    padding-block: 14px;
    & + .page {
      border-top: 1px dashed var(--color-line-2);
    }
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 18px;
    & .text + .text {
      padding-left: 18px;
      border-left: 1px solid var(--color-line);
    }
  }
  .text {
    margin-top: 8px;
    font-size: 15px;
    line-height: 1.75;
    color: var(--color-soft);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .text .add,
  .text .del {
    color: var(--color-chalk);
    border-radius: 4px;
    padding-inline: 1px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .text .add {
    background: #9be58f33;
    box-shadow: inset 0 -1.5px 0 #9be58f99;
  }
  .text .del {
    background: #ff7a6b30;
    text-decoration: line-through;
    text-decoration-color: #ff7a6bb3;
  }
  .text .current {
    outline: 2px solid var(--color-sun);
    outline-offset: 1px;
    animation: flash 0.9s ease-out;
  }
  @keyframes flash {
    from {
      background-color: #ffd25e66;
    }
  }
  .fold {
    display: block;
    width: 100%;
    margin-block: 6px;
    padding: 4px 10px;
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
    margin-top: 12px;
  }
</style>
