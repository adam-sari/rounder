<script lang="ts">
  import { untrack } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import UnitPicker from './UnitPicker.svelte';
  import { convert, formatNumber, formula, isRounded, parseNumber, prettyNumber, toBase, type UnitMatch } from '@/tools/lib/units/convert';
  import { categories, categoryById, findUnit, type Unit } from '@/tools/lib/units/units';

  type Side = 'from' | 'to';

  let { category = 'length', from, to, table }: { category?: string; from?: string; to?: string; table?: number[] } = $props();

  // the page's preset is only the starting point; everything stays changeable
  const start = untrack(() => {
    const c = categoryById[category] ?? categories[0];
    const ok = (id?: string) => !!id && c.units.some((u) => u.id === id);
    return { c, from: ok(from) ? from! : c.defaults[0], to: ok(to) ? to! : c.defaults[1], table };
  });

  // raw: category objects are compared by identity, so they mustn't be wrapped in a proxy
  let cat = $state.raw(start.c);
  let ids = $state<Record<Side, string>>({ from: start.from, to: start.to });
  // the side the person last typed in; the other side is computed from it
  let anchor = $state<Side>('from');
  let text = $state('1');
  let digits = $state(6);
  let view = $state<'all' | 'table'>(start.table ? 'table' : 'all');
  let turns = $state(0);

  const units = $derived({ from: findUnit(cat, ids.from), to: findUnit(cat, ids.to) });
  const other = (s: Side): Side => (s === 'from' ? 'to' : 'from');

  const input = $derived(parseNumber(text));
  const valid = $derived(input !== null && Number.isFinite(input));
  const values = $derived.by(() => {
    if (!valid) return { from: NaN, to: NaN };
    const v = input as number;
    const out = convert(v, units[anchor], units[other(anchor)]);
    return anchor === 'from' ? { from: v, to: out } : { from: out, to: v };
  });
  const base = $derived(valid ? toBase(input as number, units[anchor]) : NaN);

  const shown = (s: Side) => (s === anchor ? text : formatNumber(values[s], digits));
  // the typed value is shown as typed; only the computed side gets rounded
  const sig = (s: Side) => (s === anchor ? 15 : digits);
  const name = (u: Unit, n: number) => (n === 1 ? u.name : u.plural);
  const computed = $derived(values[other(anchor)]);
  const approx = $derived(valid && isRounded(computed, digits));
  const tooBig = $derived(input !== null && !Number.isNaN(input) && !valid);
  const resultText = $derived(
    valid && Number.isFinite(computed)
      ? `${formatNumber(values.from, sig('from'))} ${units.from.symbol} ${approx ? '≈' : '='} ${formatNumber(values.to, sig('to'))} ${units.to.symbol}`
      : '',
  );

  const rows = $derived(cat.units.map((u) => ({ unit: u, value: valid ? convert(input as number, units[anchor], u) : NaN })));
  const quick = $derived((start.table && cat === start.c ? start.table : cat.quick).map((v) => [v, convert(v, units.from, units.to)] as const));

  function edit(s: Side, raw: string) {
    anchor = s;
    text = raw;
  }

  // ↑/↓ nudge the value by 1, or 10 with shift
  function nudge(s: Side, e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const v = s === anchor ? input : values[s];
    if (v === null || !Number.isFinite(v)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
    edit(s, formatNumber(v + step, 15));
  }

  function setCategory(id: string) {
    if (id === cat.id) return;
    cat = categoryById[id];
    ids = { from: cat.defaults[0], to: cat.defaults[1] };
    anchor = 'from';
    if (!valid) text = '1';
  }

  function pickUnit(s: Side, m: UnitMatch) {
    if (m.category !== cat) {
      // picked from another category's search results: switch over, keep a sensible partner
      cat = m.category;
      const partner = cat.defaults.find((d) => d !== m.unit.id) ?? cat.defaults[0];
      ids = s === 'from' ? { from: m.unit.id, to: partner } : { from: partner, to: m.unit.id };
      return;
    }
    // choosing the unit already on the other side swaps the two
    if (m.unit.id === ids[other(s)]) ids = { from: ids.to, to: ids.from };
    else ids[s] = m.unit.id;
  }

  function swap() {
    ids = { from: ids.to, to: ids.from };
    anchor = other(anchor);
    turns++;
  }

  function useValue(v: number) {
    anchor = 'from';
    text = formatNumber(v, 15);
  }

  function setTarget(u: Unit) {
    if (u.id === ids.from) swap();
    else ids.to = u.id;
  }

  const belowZero = $derived(cat.id === 'temperature' && base < 0);
</script>

<div class="grid gap-6">
  <div class="cats" role="group" aria-label="What to convert">
    {#each categories as c}
      <button type="button" aria-pressed={c === cat} onclick={() => setCategory(c.id)}>{c.name}</button>
    {/each}
  </div>

  <div class="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
    {#snippet side(s: Side)}
      {@const unit = units[s]}
      <div class="panel" class:anchor={s === anchor && valid}>
        <label class="label" for={`uc-${s}`}>{s === 'from' ? 'from' : 'to'}</label>
        <input
          id={`uc-${s}`}
          class="num"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          placeholder={s === anchor ? '0' : '—'}
          aria-label={`Value in ${unit.plural}`}
          aria-invalid={s === anchor && input !== null && !valid}
          value={shown(s)}
          oninput={(e) => edit(s, e.currentTarget.value)}
          onkeydown={(e) => nudge(s, e)}
        />
        <UnitPicker category={cat} value={ids[s]} label={s === 'from' ? 'From' : 'To'} onpick={(m) => pickUnit(s, m)} />
      </div>
    {/snippet}

    {@render side('from')}
    <button type="button" class="swap btn mx-auto" aria-label="Swap units" title="Swap units" onclick={swap}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" style:--t={`${turns * 180}deg`}>
        <path d="M4 7h12m0 0-3.5-3.5M16 7l-3.5 3.5M16 13H4m0 0 3.5-3.5M4 13l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    {@render side('to')}
  </div>

  <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-line pt-5">
    <div class="min-w-0" aria-live="polite">
      {#if input === null}
        <p class="font-serif text-3xl text-muted">Type a number to convert</p>
      {:else if tooBig}
        <p class="font-serif text-3xl text-bad">That number is too large to work with</p>
      {:else if !valid}
        <p class="font-serif text-3xl text-bad">That's not a number we can read</p>
        <p class="mono mt-1">try 12.5, 1,250, 3/4, 1½ or 2e6</p>
      {:else if !Number.isFinite(computed)}
        <p class="font-serif text-3xl text-muted">No finite answer for that value</p>
      {:else}
        <p class="result font-serif text-[clamp(26px,4vw,36px)] leading-tight">
          {prettyNumber(values.from, sig('from'))} {name(units.from, values.from)}
          <span class="text-muted">{approx ? '≈' : '='}</span>
          {#key `${ids.from}/${ids.to}`}<span class="flash text-sun">{prettyNumber(values.to, sig('to'))}</span>{/key}
          {name(units.to, values.to)}
        </p>
      {/if}
      <p class="mono mt-2">formula: {formula(units.from, units.to)}</p>
      {#if belowZero}<p class="mt-2 text-sm text-bad" role="alert">That's below absolute zero (−273.15 °C), the coldest anything can be.</p>{/if}
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <span class="label" id="uc-digits">significant digits</span>
        <div class="seg" role="group" aria-labelledby="uc-digits">
          {#each [4, 6, 10, 15] as d}
            <button type="button" aria-pressed={digits === d} onclick={() => (digits = d)}>{d}</button>
          {/each}
        </div>
      </div>
      <CopyButton text={() => resultText} label="Copy result" />
    </div>
  </div>

  <div class="grid gap-3">
    <div class="seg self-start" role="group" aria-label="Table">
      <button type="button" aria-pressed={view === 'all'} onclick={() => (view = 'all')}>all {cat.name.toLowerCase()} units</button>
      <button type="button" aria-pressed={view === 'table'} onclick={() => (view = 'table')}>{units.from.symbol} to {units.to.symbol} table</button>
    </div>

    {#if view === 'all'}
      <div class="overflow-x-auto rounded-2xl border border-line-2">
        <table class="w-full text-sm">
          <caption class="sr-only">{text || 'Nothing'} {units[anchor].plural} in every {cat.name.toLowerCase()} unit. Pick a row to convert to it.</caption>
          <tbody>
            {#each rows as { unit, value } (unit.id)}
              <tr class:is-from={unit.id === ids.from} class:is-to={unit.id === ids.to}>
                <th scope="row" class="w-1/2 font-normal">
                  <button type="button" class="pick" onclick={() => setTarget(unit)} aria-label={`Convert to ${unit.plural}`}>
                    {unit.name}
                    {#if unit.id === ids.from}<span class="tag">from</span>{:else if unit.id === ids.to}<span class="tag">to</span>{/if}
                  </button>
                </th>
                <td class="text-right font-mono tabular-nums">{prettyNumber(value, digits)}</td>
                <td class="w-[5.5em] font-mono text-muted">{unit.symbol}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <ul class="grid gap-x-6 sm:grid-cols-2" aria-label={`${units.from.plural} to ${units.to.plural}`}>
        {#each quick as [v, out]}
          <li class="border-b border-line">
            <button type="button" class="quick" onclick={() => useValue(v)}>
              <span class="font-mono tabular-nums">{prettyNumber(v, 15)} {units.from.symbol}</span>
              <span class="text-muted">=</span>
              <span class="font-mono tabular-nums text-chalk">{prettyNumber(out, digits)} {units.to.symbol}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .cats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    & button {
      font: 400 13px var(--font-mono);
      color: var(--color-soft);
      background: transparent;
      border: 1px solid var(--color-line-2);
      border-radius: 999px;
      padding: 7px 13px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, color 0.2s;
      &:hover { border-color: var(--color-muted); }
      &[aria-pressed='true'] {
        background: var(--color-sun);
        border-color: var(--color-sun);
        color: var(--color-bg);
      }
    }
  }
  .panel {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel-2);
    transition: border-color 0.2s;
    &:focus-within { border-color: var(--color-sun); }
    & .label { margin: 0; }
  }
  .num {
    width: 100%;
    min-width: 0;
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--color-chalk);
    font: 400 clamp(40px, 6vw, 56px) / 1.05 var(--font-serif);
    &:focus { outline: none; }
    &::placeholder { color: #6e6960; }
    &[aria-invalid='true'] { color: var(--color-bad); }
  }
  /* the swap arrows point sideways next to the panels, up/down when they stack */
  .swap {
    width: 48px;
    height: 48px;
    padding: 0;
    border-radius: 999px;
    --r: 90deg;
    & svg {
      transform: rotate(calc(var(--r) + var(--t, 0deg)));
      transition: transform 0.45s var(--ease-spring);
    }
  }
  @media (min-width: 768px) {
    .swap { --r: 0deg; }
  }
  .result { overflow-wrap: anywhere; }
  .flash {
    display: inline-block;
    animation: flash 0.4s var(--ease-spring);
  }
  @keyframes flash {
    from { opacity: 0.2; transform: translateY(6px); }
  }
  table {
    border-collapse: collapse;
  }
  tr {
    border-top: 1px solid var(--color-line);
    &:first-child { border-top: 0; }
    &.is-from, &.is-to { background: var(--color-panel-2); }
    &.is-to td:nth-child(2) { color: var(--color-sun); }
  }
  th, td {
    padding: 9px 10px;
    vertical-align: middle;
  }
  @media (min-width: 640px) {
    th, td { padding-inline: 14px; }
  }
  th { text-align: left; }
  td:last-child { padding-left: 0; }
  .pick {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    color: var(--color-soft);
    cursor: pointer;
    &:hover { color: var(--color-chalk); }
  }
  .tag {
    font: 400 11px var(--font-mono);
    color: var(--color-sun);
    border: 1px solid color-mix(in srgb, var(--color-sun) 45%, transparent);
    border-radius: 999px;
    padding: 1px 7px;
  }
  .quick {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 10px;
    padding: 9px 4px;
    background: none;
    border: 0;
    color: var(--color-soft);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    &:hover { color: var(--color-chalk); }
    & > :last-child { margin-left: auto; text-align: right; }
  }
</style>
