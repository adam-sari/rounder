<script lang="ts">
  import { onDestroy } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { checkNumbers, generateNumbers, listItems, MAX_COUNT, MAX_DECIMALS, numberGrid, pickFromList, randBelow, shuffle } from '@/tools/lib/random/rng';

  let mode = $state<'numbers' | 'list'>('numbers');

  // numbers
  let min = $state<number | null>(1);
  let max = $state<number | null>(100);
  let count = $state<number | null>(1);
  let kind = $state<'whole' | 'decimal'>('whole');
  let places = $state(2);
  let unique = $state(true);
  let sort = $state<'none' | 'asc' | 'desc'>('none');
  let results = $state.raw<string[]>([]);
  let recent = $state<string[]>([]);
  let shown = $state('');
  let stamp = $state(0);
  let sep = $state('\n');

  // list
  let listText = $state('Pizza\nTacos\nSushi\nCurry\nBurgers\nPho');
  let pickCount = $state<number | null>(1);
  let pickUnique = $state(true);
  let picks = $state.raw<string[]>([]);
  let listStamp = $state(0);

  const options = $derived({
    min: min ?? NaN,
    max: max ?? NaN,
    count: count ?? 0,
    decimals: kind === 'whole' ? 0 : places,
    unique,
    sort,
  });
  const problem = $derived(checkNumbers(options));
  const grid = $derived(problem ? null : numberGrid(options.min, options.max, options.decimals));
  const items = $derived(listItems(listText));

  const fmt = (v: number, d: number) => (d ? v.toFixed(d) : String(v));
  const pretty = (s: string) => {
    const [int, frac] = s.split('.');
    return Number(int).toLocaleString('en-US') + (frac ? `.${frac}` : '');
  };
  const n = (x: number) => x.toLocaleString('en-US');

  const presets: [string, number, number][] = [['1–6', 1, 6], ['1–10', 1, 10], ['1–100', 1, 100], ['1–1000', 1, 1000]];

  let scramble: ReturnType<typeof setInterval> | undefined;
  onDestroy(() => clearInterval(scramble));

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function generate(e?: Event) {
    e?.preventDefault();
    if (problem || !grid) return;
    const d = options.decimals;
    const values = generateNumbers(options).map((v) => fmt(v, d));
    clearInterval(scramble);
    if (values.length !== 1) {
      results = values;
      return;
    }

    // a quick slot-machine shuffle of decoy values before the real one lands
    const { lo, size, scale } = grid;
    const decoy = () => (shown = fmt((lo + randBelow(size)) / scale, d));
    const land = () => {
      clearInterval(scramble);
      shown = values[0];
      stamp++;
      recent = [values[0], ...recent].slice(0, 12);
    };
    if (reduced()) {
      results = values;
      return land();
    }
    decoy();
    results = values;
    let frames = 0;
    scramble = setInterval(() => {
      decoy();
      if (++frames >= 9) land();
    }, 45);
  }

  function pick(e?: Event) {
    e?.preventDefault();
    picks = pickFromList(items, Math.max(1, pickCount ?? 1), pickUnique);
    listStamp++;
  }

  function shuffleAll() {
    picks = shuffle([...items]);
    listStamp++;
  }

  const total = $derived(results.length > 1 ? results.reduce((s, v) => s + Number(v), 0) : 0);

  // one live region that outlives the keyed result blocks, so screen readers hear each draw
  const announce = $derived.by(() => {
    if (mode === 'list') return picks.length === 1 ? `Picked ${picks[0]}` : picks.length ? `Picked ${n(picks.length)} items: ${picks.slice(0, 10).join(', ')}` : '';
    if (results.length === 1) return shown === results[0] ? `Your number is ${results[0]}` : '';
    return results.length ? `Generated ${n(results.length)} numbers: ${results.slice(0, 10).join(', ')}` : '';
  });
</script>

<p class="sr-only" aria-live="polite">{announce}</p>

<div class="grid gap-6">
  <div class="seg self-start justify-self-start" role="group" aria-label="What to pick">
    <button type="button" aria-pressed={mode === 'numbers'} onclick={() => (mode = 'numbers')}>numbers</button>
    <button type="button" aria-pressed={mode === 'list'} onclick={() => (mode = 'list')}>from a list</button>
  </div>

  {#if mode === 'numbers'}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <form class="grid content-start gap-5" onsubmit={generate}>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label><span class="label">min</span><input class="field mono-input" type="number" step="any" bind:value={min} /></label>
          <label><span class="label">max</span><input class="field mono-input" type="number" step="any" bind:value={max} /></label>
          <label class="col-span-2 sm:col-span-1"><span class="label">how many</span><input class="field mono-input" type="number" min="1" max={MAX_COUNT} bind:value={count} /></label>
        </div>

        <div class="flex flex-wrap gap-2" role="group" aria-label="Quick ranges">
          {#each presets as [label, a, b]}
            <button type="button" class="chip" aria-pressed={min === a && max === b && kind === 'whole'} onclick={() => { min = a; max = b; kind = 'whole'; }}>{label}</button>
          {/each}
        </div>

        <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <span class="label">type</span>
            <div class="seg" role="group" aria-label="Number type">
              <button type="button" aria-pressed={kind === 'whole'} onclick={() => (kind = 'whole')}>whole</button>
              <button type="button" aria-pressed={kind === 'decimal'} onclick={() => (kind = 'decimal')}>decimal</button>
            </div>
          </div>
          {#if kind === 'decimal'}
            <label class="w-28">
              <span class="label">places</span>
              <select class="field py-2!" bind:value={places}>
                {#each Array.from({ length: MAX_DECIMALS }, (_, i) => i + 1) as p}<option value={p}>{p}</option>{/each}
              </select>
            </label>
          {/if}
          <div>
            <span class="label">order</span>
            <div class="seg" role="group" aria-label="Sort order">
              <button type="button" aria-pressed={sort === 'none'} onclick={() => (sort = 'none')}>as drawn</button>
              <button type="button" aria-pressed={sort === 'asc'} onclick={() => (sort = 'asc')}>low → high</button>
              <button type="button" aria-pressed={sort === 'desc'} onclick={() => (sort = 'desc')}>high → low</button>
            </div>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={unique} class="accent-(--color-sun)" /> no repeats</label>

        <div class="grid gap-2">
          <button type="submit" class="btn btn-primary w-full sm:w-auto sm:justify-self-start" disabled={!!problem}>Generate</button>
          {#if problem}
            <p class="text-bad text-sm" role="alert">{problem}</p>
          {:else if grid}
            <p class="mono">
              {n(grid.size)} possible value{grid.size === 1 ? '' : 's'}{options.count === 1 ? ` · each a 1 in ${n(grid.size)} chance` : ''}
            </p>
          {/if}
        </div>
      </form>

      <div class="result grid min-h-[280px] content-start gap-4 rounded-2xl border border-line-2 bg-[#141312] p-5">
        {#if results.length === 0}
          <div class="grid place-items-center self-stretch py-10 text-center">
            <div>
              <div class="ghost font-serif" aria-hidden="true">?</div>
              <p class="mono">press generate to draw</p>
            </div>
          </div>
        {:else if results.length === 1}
          <div class="grid place-items-center py-6 text-center">
            <span class="label">your number</span>
            {#key stamp}
              <output class="big font-serif" class:landed={shown === results[0]} aria-hidden="true">{pretty(shown)}</output>
            {/key}
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <CopyButton text={() => results[0]} />
            {#if recent.length > 1}
              <p class="mono min-w-0 truncate" title={recent.slice(1).join(', ')}>before: {recent.slice(1).join(' · ')}</p>
            {/if}
          </div>
        {:else}
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="label mb-0!">{n(results.length)} numbers</span>
            <span class="mono">sum {pretty(fmt(total, options.decimals))} · average {(total / results.length).toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>
          </div>
          {#if results.length <= 400}
            <ul class="flex max-h-[340px] flex-wrap content-start gap-1.5 overflow-auto" aria-label="Generated numbers">
              {#each results as v, i (i)}
                <li class="num" style={`animation-delay:${Math.min(i, 40) * 12}ms`}>{v}</li>
              {/each}
            </ul>
          {:else}
            <textarea class="field min-h-[300px]!" readonly value={results.join(sep)} aria-label="Generated numbers" spellcheck="false"></textarea>
          {/if}
          <div class="flex flex-wrap items-end gap-3">
            <label>
              <span class="label">separate with</span>
              <select class="field py-2!" bind:value={sep}>
                <option value={'\n'}>new lines</option><option value=", ">commas</option><option value=" ">spaces</option>
              </select>
            </label>
            <CopyButton text={() => results.join(sep)} class="btn-primary" label={`Copy all ${n(results.length)}`} />
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <form class="grid content-start gap-4" onsubmit={pick}>
        <label>
          <span class="label">your list · one per line · {n(items.length)} item{items.length === 1 ? '' : 's'}</span>
          <textarea class="field min-h-[240px]! font-sans!" bind:value={listText} spellcheck="false" placeholder="Paste names, options, anything…"></textarea>
        </label>
        <div class="flex flex-wrap items-end gap-4">
          <label class="w-28"><span class="label">pick</span><input class="field" type="number" min="1" max={MAX_COUNT} bind:value={pickCount} /></label>
          <label class="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" bind:checked={pickUnique} class="accent-(--color-sun)" /> no repeats</label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" disabled={!items.length}>Pick</button>
          <button type="button" class="btn" disabled={items.length < 2} onclick={shuffleAll}>Shuffle whole list</button>
        </div>
        {#if pickUnique && (pickCount ?? 1) > items.length && items.length > 0}
          <p class="mono">Only {n(items.length)} items, so you'll get each one once.</p>
        {/if}
      </form>

      <div class="result grid min-h-[280px] content-start gap-4 rounded-2xl border border-line-2 bg-[#141312] p-5">
        {#if picks.length === 0}
          <div class="grid place-items-center self-stretch py-10 text-center">
            <div>
              <div class="ghost font-serif" aria-hidden="true">?</div>
              <p class="mono">press pick to choose</p>
            </div>
          </div>
        {:else if picks.length === 1}
          <div class="grid place-items-center py-6 text-center">
            <span class="label">picked</span>
            {#key listStamp}
              <output class="big pick font-serif landed">{picks[0]}</output>
            {/key}
          </div>
          <CopyButton text={() => picks[0]} class="justify-self-start" />
        {:else}
          {#key listStamp}
            <ol class="grid max-h-[380px] gap-1 overflow-auto" aria-label="Picked items">
              {#each picks as item, i (i)}
                <li class="row" style={`animation-delay:${Math.min(i, 30) * 18}ms`}><span class="mono w-8 shrink-0 text-right">{i + 1}</span><span class="min-w-0 break-words">{item}</span></li>
              {/each}
            </ol>
          {/key}
          <CopyButton text={() => picks.join('\n')} class="btn-primary justify-self-start" label={`Copy all ${n(picks.length)}`} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .mono-input {
    font-family: var(--font-mono);
  }
  .chip {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: transparent;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .ghost {
    font-size: 96px;
    line-height: 1;
    color: var(--color-line-2);
  }
  .big {
    display: block;
    max-width: 100%;
    font-size: clamp(56px, 11vw, 120px);
    line-height: 1.05;
    color: var(--color-sun);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .big.pick {
    font-size: clamp(36px, 7vw, 72px);
    color: var(--color-chalk);
  }
  .landed {
    animation: land 0.5s var(--ease-spring);
  }
  @keyframes land {
    from {
      transform: scale(0.82);
      opacity: 0.4;
    }
  }
  .num {
    font: 400 14px var(--font-mono);
    font-variant-numeric: tabular-nums;
    padding: 5px 10px;
    border-radius: 8px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    animation: pop 0.35s var(--ease-spring) both;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: baseline;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--color-panel-2);
    animation: pop 0.35s var(--ease-spring) both;
  }
  @keyframes pop {
    from {
      transform: translateY(6px) scale(0.96);
      opacity: 0;
    }
  }
</style>
