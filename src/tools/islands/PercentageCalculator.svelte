<script lang="ts">
  import { untrack } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { applyPercent, fmt, parseNum, percentChange, percentOf, reversePercent, whatPercent } from '@/tools/lib/percentage/calc';

  // a preset from the address (/percentage-calculator#p=15&of=80) fills the first calculator
  let { p, of: ofValue }: { p?: number; of?: number } = $props();

  // each calculator starts with a worked example so the page reads at a glance
  let of = $state(untrack(() => ({ p: String(p ?? 20), y: String(ofValue ?? 150) })));
  let what = $state({ x: '30', y: '120' });
  let change = $state({ a: '80', b: '100' });
  let apply = $state({ x: '200', p: '15', dir: 1 as 1 | -1 });
  let reverse = $state({ x: '120', p: '20', dir: 1 as 1 | -1 });
  let pts = $state({ a: '4', b: '5' });

  type Result = { value: string; how: string; note?: string } | null;

  const r1: Result = $derived.by(() => {
    const p = parseNum(of.p), y = parseNum(of.y);
    return p == null || y == null ? null : { value: fmt(percentOf(p, y)), how: `${fmt(p)} ÷ 100 × ${fmt(y)}` };
  });

  const r2: Result = $derived.by(() => {
    const x = parseNum(what.x), y = parseNum(what.y);
    if (x == null || y == null) return null;
    const v = whatPercent(x, y);
    return v == null ? { value: '–', how: 'can’t divide by zero' } : { value: `${fmt(v)}%`, how: `${fmt(x)} ÷ ${fmt(y)} × 100` };
  });

  const r3: Result = $derived.by(() => {
    const a = parseNum(change.a), b = parseNum(change.b);
    if (a == null || b == null) return null;
    const v = percentChange(a, b);
    if (v == null) return { value: '–', how: 'a change from 0 has no percentage' };
    const word = v > 0 ? 'increase' : v < 0 ? 'decrease' : 'no change';
    return { value: v ? `${fmt(Math.abs(v))}%` : '0%', how: `(${fmt(b)} − ${fmt(a)}) ÷ ${fmt(Math.abs(a))} × 100`, note: `${v > 0 ? '↑ ' : v < 0 ? '↓ ' : ''}${word}` };
  });

  const r4: Result = $derived.by(() => {
    const x = parseNum(apply.x), p = parseNum(apply.p);
    if (x == null || p == null) return null;
    const sign = apply.dir > 0 ? '+' : '−';
    const v = applyPercent(x, p, apply.dir);
    // worded from the actual result, so "increased by -10%" reads as the drop it is
    return {
      value: fmt(v),
      how: `${fmt(x)} × (1 ${sign} ${fmt(p)} ÷ 100)`,
      note: v === x ? 'no change' : `a ${v > x ? 'rise' : 'drop'} of ${fmt(Math.abs(v - x))}`,
    };
  });

  const r5: Result = $derived.by(() => {
    const x = parseNum(reverse.x), p = parseNum(reverse.p);
    if (x == null || p == null) return null;
    const v = reversePercent(x, p, reverse.dir);
    if (v == null) return { value: '–', how: 'after taking off 100% everything is 0, so the original can’t be recovered' };
    const sign = reverse.dir > 0 ? '+' : '−';
    // the classic mistake is to apply the percentage to the final figure instead
    const naive = applyPercent(x, p, reverse.dir > 0 ? -1 : 1);
    return {
      value: fmt(v),
      how: `${fmt(x)} ÷ (1 ${sign} ${fmt(p)} ÷ 100)`,
      note: p ? `not ${fmt(naive)}: ${reverse.dir > 0 ? 'taking' : 'adding'} ${fmt(p)}% ${reverse.dir > 0 ? 'off' : 'on'} the final price uses the wrong starting point` : undefined,
    };
  });

  const r6 = $derived.by(() => {
    const a = parseNum(pts.a), b = parseNum(pts.b);
    if (a == null || b == null) return null;
    const diff = b - a;
    const rel = percentChange(a, b);
    return {
      points: `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt(Math.abs(diff))}`,
      percent: rel == null ? null : `${rel > 0 ? '+' : rel < 0 ? '−' : ''}${fmt(Math.abs(rel))}%`,
    };
  });
</script>

{#snippet num(get: () => string, set: (v: string) => void, label: string, wide = false)}
  <input class="field num" class:wide type="text" inputmode="decimal" aria-label={label} bind:value={get, set} />
{/snippet}

{#snippet dirToggle(get: () => 1 | -1, set: (v: 1 | -1) => void, up: string, down: string, label: string)}
  <span class="seg align-middle" role="group" aria-label={label}>
    <button type="button" aria-pressed={get() === 1} onclick={() => set(1)}>{up}</button>
    <button type="button" aria-pressed={get() === -1} onclick={() => set(-1)}>{down}</button>
  </span>
{/snippet}

{#snippet answer(r: Result, copyLabel: string)}
  <div class="mt-4 flex min-h-[3.25rem] flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
    {#if r}
      <div class="min-w-0">
        {#key r.value}
          <output class="pop block break-all font-serif text-4xl leading-none text-sun">{r.value}</output>
        {/key}
        <p class="mono mt-2">{#if r.note}<span class="text-soft">{r.note}</span> · {/if}{r.how}</p>
      </div>
      {#if r.value !== '–'}<CopyButton text={r.value} label="Copy" class="px-3! py-2! text-sm!" />{/if}
    {:else}
      <p class="mono">enter two numbers</p>
    {/if}
  </div>
  <span class="sr-only" aria-live="polite">{r ? `${copyLabel}: ${r.value}` : ''}</span>
{/snippet}

<div class="grid gap-4 md:grid-cols-2">
  <section class="calc">
    <h2 class="calc-title">Percentage of a number</h2>
    <p class="sentence">
      What is {@render num(() => of.p, (v) => (of.p = v), 'Percent')}% of {@render num(() => of.y, (v) => (of.y = v), 'Number', true)}?
    </p>
    {@render answer(r1, 'Result')}
  </section>

  <section class="calc">
    <h2 class="calc-title">What percent is it?</h2>
    <p class="sentence">
      {@render num(() => what.x, (v) => (what.x = v), 'Part', true)} is what % of {@render num(() => what.y, (v) => (what.y = v), 'Whole', true)}?
    </p>
    {@render answer(r2, 'Percent')}
  </section>

  <section class="calc">
    <h2 class="calc-title">Percentage change</h2>
    <p class="sentence">
      From {@render num(() => change.a, (v) => (change.a = v), 'Starting value', true)} to {@render num(() => change.b, (v) => (change.b = v), 'New value', true)} is a change of
    </p>
    {@render answer(r3, 'Change')}
  </section>

  <section class="calc">
    <h2 class="calc-title">Increase or decrease by a percentage</h2>
    <p class="sentence">
      {@render num(() => apply.x, (v) => (apply.x = v), 'Starting value', true)}
      {@render dirToggle(() => apply.dir, (v) => (apply.dir = v), 'increased', 'decreased', 'Increase or decrease')}
      by {@render num(() => apply.p, (v) => (apply.p = v), 'Percent')}% is
    </p>
    {@render answer(r4, 'Result')}
  </section>

  <section class="calc">
    <h2 class="calc-title">Reverse percentage <span class="mono ml-1">find the original</span></h2>
    <p class="sentence">
      After {@render dirToggle(() => reverse.dir, (v) => (reverse.dir = v), 'adding', 'taking off', 'Added or taken off')}
      {@render num(() => reverse.p, (v) => (reverse.p = v), 'Percent')}% the price is {@render num(() => reverse.x, (v) => (reverse.x = v), 'Final price', true)}. Before, it was
    </p>
    {@render answer(r5, 'Original')}
  </section>

  <section class="calc">
    <h2 class="calc-title">Percentage points vs percent</h2>
    <p class="sentence">
      A rate went from {@render num(() => pts.a, (v) => (pts.a = v), 'Old rate')}% to {@render num(() => pts.b, (v) => (pts.b = v), 'New rate')}%.
    </p>
    <div class="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4" aria-live="polite">
      {#if r6}
        <div>
          <div class="font-serif text-4xl leading-none text-sun">{r6.points}</div>
          <div class="mono mt-2">percentage points</div>
        </div>
        <div>
          <div class="font-serif text-4xl leading-none text-sun">{r6.percent ?? '–'}</div>
          <div class="mono mt-2">percent change</div>
        </div>
      {:else}
        <p class="mono col-span-2">enter two rates</p>
      {/if}
    </div>
    <p class="mt-3 text-sm text-soft">
      Points are the plain gap between two percentages. Percent change compares that gap to where you started, so 4% to 5% is
      1 point but a 25% rise.
    </p>
  </section>
</div>

<style>
  .calc {
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    padding: 20px;
    background: var(--color-panel-2);
    transition: border-color 0.2s;
    &:focus-within {
      border-color: color-mix(in srgb, var(--color-sun) 45%, transparent);
    }
  }
  .calc-title {
    font-size: 1.35rem;
    line-height: 1.2;
    margin-bottom: 12px;
  }
  .sentence {
    font-size: 17px;
    line-height: 2.6;
    color: var(--color-soft);
  }
  .num {
    display: inline-block;
    width: 4.5rem;
    padding: 6px 10px;
    text-align: center;
    font-family: var(--font-mono);
    line-height: 1.4;
    vertical-align: middle;
    &.wide {
      width: 7rem;
    }
  }
  .sentence :global(.seg button) {
    padding: 6px 10px;
  }
  .pop {
    animation: pop 0.4s var(--ease-spring) both;
  }
  @keyframes pop {
    from {
      opacity: 0.2;
      transform: translateY(6px);
    }
  }
</style>
