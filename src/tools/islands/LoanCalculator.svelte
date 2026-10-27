<script lang="ts">
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { amortize, byYear, escrowPerPayment, pmiPlan, scheduleCsv, PER_YEAR, type Frequency } from '../lib/loan/amortize';
  import { CURRENCIES, guessCurrency } from '../lib/loan/currency';
  import { downloadBlob } from '../lib/files';
  import LoanChart from './LoanChart.svelte';

  type Num = number | null | undefined;
  const n = (x: Num) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

  /** first of next month, the usual first payment date for a new loan */
  function nextMonth() {
    const d = new Date();
    return `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()}-${String(((d.getMonth() + 1) % 12) + 1).padStart(2, '0')}-01`;
  }

  const browserLocale = typeof navigator === 'undefined' ? 'en-US' : navigator.language;

  let mode = $state<'loan' | 'mortgage'>('loan');
  let amount = $state<Num>(25_000);
  let price = $state<Num>(400_000);
  let down = $state<Num>(20);
  let downUnit = $state<'%' | '$'>('%');
  let rate = $state<Num>(6.5);
  let term = $state<Num>(5);
  let termUnit = $state<'years' | 'months'>('years');
  let frequency = $state<Frequency>('monthly');
  let start = $state(nextMonth());
  let extra = $state<Num>(null);
  let extraYearly = $state<Num>(null);
  let tax = $state<Num>(null);
  let insurance = $state<Num>(null);
  let pmiRate = $state<Num>(null);
  let hoa = $state<Num>(null);
  let currency = $state(guessCurrency(browserLocale));

  function setMode(m: typeof mode) {
    // swap in a typical term unless it was changed
    if (termUnit === 'years' && term === (m === 'mortgage' ? 5 : 30)) term = m === 'mortgage' ? 30 : 5;
    mode = m;
  }

  const loanAmount = $derived(
    mode === 'loan' ? n(amount) : Math.max(0, n(price) - Math.max(0, downUnit === '%' ? (n(price) * n(down)) / 100 : n(down))),
  );
  const termMonths = $derived(termUnit === 'years' ? n(term) * 12 : n(term));

  const error = $derived.by(() => {
    if (mode === 'mortgage' && !(n(price) > 0)) return 'Enter the home price.';
    if (loanAmount <= 0) return mode === 'mortgage' ? 'The down payment covers the whole price, so there is nothing to borrow.' : 'Enter how much you want to borrow.';
    if (rate == null) return 'Enter the interest rate.';
    if (!(n(rate) >= 0) || n(rate) > 100) return 'Enter a yearly interest rate between 0 and 100%.';
    if (termMonths < 1) return 'Enter a term of at least one month.';
    if (termMonths > 600) return 'Terms up to 50 years are supported.';
    // date inputs report partial years such as 0002 or 0202 while the year is being typed
    const year = Number(start.slice(0, 4));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || year < 1900 || year > 2200) return 'Pick the date of the first payment.';
    return '';
  });

  const pmi = $derived(mode === 'mortgage' ? pmiPlan(n(price), loanAmount, n(pmiRate)) : undefined);
  const pmiSkipped = $derived(mode === 'mortgage' && n(pmiRate) > 0 && !pmi);
  const hasExtra = $derived(n(extra) > 0 || n(extraYearly) > 0);

  const input = $derived({ principal: loanAmount, rate: n(rate), termMonths, frequency, start, pmi });
  const base = $derived(error ? null : amortize(input));
  const plan = $derived(base && hasExtra ? amortize({ ...input, extra: n(extra), extraYearly: n(extraYearly) }) : base);
  const years = $derived(plan ? byYear(plan.rows) : []);
  const escrow = $derived(mode === 'mortgage' ? escrowPerPayment(n(tax), n(insurance), n(hoa), frequency) : undefined);

  const firstPmi = $derived(plan?.rows[0]?.pmi ?? 0);
  const pmiEnds = $derived(plan && firstPmi ? plan.rows.find((r) => r.pmi === 0)?.date : undefined);
  const escrowTotal = $derived(escrow ? escrow.tax + escrow.insurance + escrow.hoa : 0);
  const perPayment = $derived(plan ? plan.payment + firstPmi + escrowTotal : 0);

  const saved = $derived.by(() => {
    if (!base || !plan || plan === base) return null;
    const payments = base.rows.length - plan.rows.length;
    const interest = base.totalInterest - plan.totalInterest;
    // e.g. a yearly extra on a loan shorter than a year changes nothing
    if (payments <= 0 && interest < 0.005) return null;
    return { interest, pmi: base.totalPmi - plan.totalPmi, payments, months: Math.round((payments * 12) / PER_YEAR[frequency]) };
  });

  const span = (months: number) => {
    const y = Math.floor(months / 12);
    const m = months % 12;
    return [y && `${y} year${y > 1 ? 's' : ''}`, m && `${m} month${m > 1 ? 's' : ''}`].filter(Boolean).join(' ') || 'under a month';
  };

  const fmt = $derived.by(() => {
    const cur = { style: 'currency', currency } as const;
    const exact = new Intl.NumberFormat(browserLocale, cur);
    const whole = new Intl.NumberFormat(browserLocale, { ...cur, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const short = new Intl.NumberFormat(browserLocale, { ...cur, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
    const month = new Intl.DateTimeFormat(browserLocale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const day = new Intl.DateTimeFormat(browserLocale, { dateStyle: 'medium', timeZone: 'UTC' });
    return {
      money: (x: number) => exact.format(x),
      whole: (x: number) => whole.format(x),
      compact: (x: number) => short.format(x),
      month: (iso: string) => month.format(Date.parse(iso)),
      day: (iso: string) => day.format(Date.parse(iso)),
    };
  });

  // the headline number glides to its new value
  const shown = new Tween(0, { duration: 450, easing: cubicOut });
  $effect(() => {
    shown.set(perPayment, { duration: prefersReducedMotion.current ? 0 : 450 });
  });

  let view = $state<'year' | 'payment'>('year');
  let page = $state(0);
  const PAGE = 60;
  const pages = $derived(plan ? Math.ceil(plan.rows.length / PAGE) : 0);
  const current = $derived(Math.min(page, Math.max(0, pages - 1)));
  const pageRows = $derived(plan ? plan.rows.slice(current * PAGE, (current + 1) * PAGE) : []);

  function exportCsv() {
    if (!plan) return;
    const csv = scheduleCsv(plan.rows, escrow);
    // the byte-order mark makes Excel read the file as UTF-8
    downloadBlob(new Blob(['﻿', csv], { type: 'text/csv' }), `${mode}-schedule.csv`);
  }

  const freqLabel = $derived({ monthly: 'monthly', biweekly: 'every 2 weeks', weekly: 'weekly' }[frequency]);
</script>

{#snippet money(label: string, value: Num, set: (v: Num) => void, hint = '')}
  <label>
    <span class="label">{label}{#if hint}<span class="text-[#6e6960]"> · {hint}</span>{/if}</span>
    <input class="field tabular-nums" type="number" inputmode="decimal" min="0" step="any" placeholder="optional" bind:value={() => value, set} />
  </label>
{/snippet}

<div class="grid grid-cols-[minmax(0,1fr)] gap-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="seg" role="group" aria-label="Calculator">
      <button type="button" aria-pressed={mode === 'loan'} onclick={() => setMode('loan')}>loan</button>
      <button type="button" aria-pressed={mode === 'mortgage'} onclick={() => setMode('mortgage')}>mortgage</button>
    </div>
    <label class="flex items-center gap-2">
      <span class="mono">currency</span>
      <select class="field w-auto! py-1.5!" bind:value={currency}>
        {#each CURRENCIES as c}<option value={c}>{c}</option>{/each}
      </select>
    </label>
  </div>

  <div class="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <!-- inputs -->
    <div class="grid content-start gap-4">
      {#if mode === 'loan'}
        <label>
          <span class="label">loan amount</span>
          <input class="field tabular-nums" type="number" inputmode="decimal" min="0" step="any" bind:value={amount} />
        </label>
      {:else}
        <label>
          <span class="label">home price</span>
          <input class="field tabular-nums" type="number" inputmode="decimal" min="0" step="any" bind:value={price} />
        </label>
        <div>
          <div class="flex items-end justify-between gap-2">
            <label for="down" class="label">down payment</label>
            <div class="seg mb-1.5" role="group" aria-label="Down payment as">
              {#each ['%', '$'] as const as u}
                <button
                  type="button"
                  class="py-0.5! px-2.5!"
                  aria-pressed={downUnit === u}
                  onclick={() => {
                    if (downUnit === u) return;
                    // keep the same down payment when switching units
                    const p = n(price);
                    down = p > 0 ? Math.round(u === '$' ? (p * n(down)) / 100 : (n(down) / p) * 10000) / (u === '$' ? 1 : 100) : 0;
                    downUnit = u;
                  }}
                >{u === '$' ? 'amount' : '%'}</button>
              {/each}
            </div>
          </div>
          <input id="down" class="field tabular-nums" type="number" inputmode="decimal" min="0" step="any" bind:value={down} />
          <p class="mono mt-1.5">
            loan amount {fmt.whole(loanAmount)}
            {#if downUnit === '$' && n(price) > 0} · {((n(down) / n(price)) * 100).toFixed(1)}% down{:else if n(price) > 0} · {fmt.whole((n(price) * n(down)) / 100)} down{/if}
          </p>
        </div>
      {/if}

      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <label>
          <span class="label">interest rate · % a year</span>
          <input class="field tabular-nums" type="number" inputmode="decimal" min="0" max="100" step="0.01" bind:value={rate} />
        </label>
        <div>
          <div class="flex items-end justify-between gap-2">
            <label for="term" class="label">term</label>
            <div class="seg mb-1.5" role="group" aria-label="Term in">
              {#each ['years', 'months'] as const as u}
                <button
                  type="button"
                  class="py-0.5! px-2.5!"
                  aria-pressed={termUnit === u}
                  onclick={() => {
                    if (termUnit !== u) term = u === 'months' ? Math.round(n(term) * 12) : Math.round((n(term) / 12) * 100) / 100;
                    termUnit = u;
                  }}
                >{u === 'years' ? 'yr' : 'mo'}</button>
              {/each}
            </div>
          </div>
          <input id="term" class="field tabular-nums" type="number" inputmode="decimal" min="0" step="any" bind:value={term} />
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <span class="label">payments</span>
          <div class="seg" role="group" aria-label="Payment frequency">
            {#each [['monthly', 'monthly'], ['biweekly', 'biweekly'], ['weekly', 'weekly']] as const as [f, label]}
              <button type="button" aria-pressed={frequency === f} onclick={() => (frequency = f)}>{label}</button>
            {/each}
          </div>
        </div>
        <label>
          <span class="label">first payment</span>
          <input class="field" type="date" bind:value={start} />
        </label>
      </div>

      {#if mode === 'mortgage'}
        <fieldset class="grid gap-3 rounded-2xl border border-line-2 p-4 sm:grid-cols-2">
          <legend class="mono px-1.5">housing costs · all optional</legend>
          {@render money('property tax · per year', tax, (v) => (tax = v))}
          {@render money('home insurance · per year', insurance, (v) => (insurance = v))}
          {@render money('PMI · % of loan a year', pmiRate, (v) => (pmiRate = v), 'often 0.3–1.5')}
          {@render money('HOA fees · per month', hoa, (v) => (hoa = v))}
          {#if pmiSkipped}<p class="mono sm:col-span-2">No PMI with 20% or more down, so it's left out.</p>{/if}
        </fieldset>
      {/if}

      <fieldset class="grid gap-3 rounded-2xl border border-line-2 p-4 sm:grid-cols-2">
        <legend class="mono px-1.5">extra payments · optional</legend>
        {@render money('extra with every payment', extra, (v) => (extra = v))}
        {@render money('extra once a year', extraYearly, (v) => (extraYearly = v))}
        <p class="mono sm:col-span-2">Extra goes straight to principal. Check that your lender allows it without a prepayment fee.</p>
      </fieldset>
    </div>

    <!-- results -->
    <div class="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
      {#if error}
        <div class="grid min-h-[240px] place-items-center rounded-2xl border border-dashed border-line-2 p-6 text-center">
          <p class="text-soft" role="status">{error}</p>
        </div>
      {:else if plan}
        <div class="result rounded-2xl border border-line-2 bg-[#141312] p-5">
          <span class="mono">{mode === 'mortgage' ? 'total' : 'your'} payment · {freqLabel}</span>
          <output class="mt-1 block font-serif text-[clamp(44px,8vw,64px)] leading-none tabular-nums" aria-hidden="true">{fmt.money(shown.current)}</output>
          <!-- announce the final figure once, not every frame of the count-up -->
          <span class="sr-only" aria-live="polite">{fmt.money(perPayment)}</span>

          {#if mode === 'mortgage'}
            <dl class="breakdown mt-5">
              <dt>Principal & interest</dt><dd>{fmt.money(plan.payment)}</dd>
              {#if escrow?.tax}<dt>Property tax</dt><dd>{fmt.money(escrow.tax)}</dd>{/if}
              {#if escrow?.insurance}<dt>Home insurance</dt><dd>{fmt.money(escrow.insurance)}</dd>{/if}
              {#if firstPmi}<dt>PMI <span class="mono">until {pmiEnds ? fmt.month(pmiEnds) : 'payoff'}</span></dt><dd>{fmt.money(firstPmi)}</dd>{/if}
              {#if escrow?.hoa}<dt>HOA</dt><dd>{fmt.money(escrow.hoa)}</dd>{/if}
            </dl>
          {/if}
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="stat"><div class="value">{fmt.whole(plan.totalInterest)}</div><div class="mono">total interest</div></div>
          <div class="stat"><div class="value">{fmt.month(plan.rows.at(-1)!.date)}</div><div class="mono">paid off</div></div>
          <div class="stat"><div class="value">{fmt.whole(loanAmount + plan.totalInterest)}</div><div class="mono">principal + interest</div></div>
          <div class="stat"><div class="value">{plan.rows.length.toLocaleString(browserLocale)}</div><div class="mono">payments</div></div>
          {#if plan.totalPmi}<div class="stat col-span-2"><div class="value">{fmt.whole(plan.totalPmi)}</div><div class="mono">PMI paid in total</div></div>{/if}
        </div>

        {#if saved}
          <div class="saved rounded-2xl border border-sun/40 bg-sun/[0.06] p-4">
            <p class="text-[15px]">
              Your extra payments save <strong class="text-sun">{fmt.whole(saved.interest)}</strong> in interest{#if saved.pmi > 0}&nbsp;and {fmt.whole(saved.pmi)} in PMI{/if}{#if saved.payments > 0}, and clear the loan
              <strong class="text-sun">{span(saved.months)}</strong> sooner{/if}.
            </p>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  {#if plan && !error}
    <section class="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-6" aria-label="Chart">
      <h2 class="text-2xl">Balance over time</h2>
      <LoanChart rows={plan.rows} baseRows={saved ? base!.rows : undefined} {years} principal={loanAmount} {start} compact={fmt.compact} money={fmt.money} />
    </section>

    <section class="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-6" aria-label="Amortization schedule">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-2xl">Amortization schedule</h2>
        <div class="flex flex-wrap items-center gap-2">
          <div class="seg" role="group" aria-label="Schedule view">
            <button type="button" aria-pressed={view === 'year'} onclick={() => (view = 'year')}>by year</button>
            <button type="button" aria-pressed={view === 'payment'} onclick={() => (view = 'payment')}>every payment</button>
          </div>
          <button type="button" class="btn py-2!" onclick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div class="overflow-x-auto rounded-2xl border border-line-2">
        <table class="w-full min-w-[560px] text-sm tabular-nums">
          {#if view === 'year'}
            <thead>
              <tr><th>Year</th><th>Principal</th><th>Interest</th>{#if hasExtra}<th>of which extra</th>{/if}{#if plan.totalPmi}<th>PMI</th>{/if}<th>Balance</th></tr>
            </thead>
            <tbody>
              {#each years as y (y.year)}
                <tr><td>{y.year}</td><td>{fmt.money(y.principal)}</td><td>{fmt.money(y.interest)}</td>{#if hasExtra}<td>{fmt.money(y.extra)}</td>{/if}{#if plan.totalPmi}<td>{fmt.money(y.pmi)}</td>{/if}<td>{fmt.money(y.balance)}</td></tr>
              {/each}
            </tbody>
          {:else}
            <thead>
              <tr><th>#</th><th>Date</th><th>Payment</th><th>Principal</th><th>Interest</th>{#if hasExtra}<th>Extra</th>{/if}{#if plan.totalPmi}<th>PMI</th>{/if}<th>Balance</th></tr>
            </thead>
            <tbody>
              {#each pageRows as r (r.n)}
                <tr><td>{r.n}</td><td>{fmt.day(r.date)}</td><td>{fmt.money(r.payment)}</td><td>{fmt.money(r.principal)}</td><td>{fmt.money(r.interest)}</td>{#if hasExtra}<td>{fmt.money(r.extra)}</td>{/if}{#if plan.totalPmi}<td>{fmt.money(r.pmi)}</td>{/if}<td>{fmt.money(r.balance)}</td></tr>
              {/each}
            </tbody>
          {/if}
        </table>
      </div>

      {#if view === 'payment' && pages > 1}
        <nav class="flex flex-wrap items-center justify-between gap-3" aria-label="Schedule pages">
          <button type="button" class="btn py-2!" disabled={current === 0} onclick={() => (page = current - 1)}>← Earlier</button>
          <span class="mono">payments {current * PAGE + 1}–{Math.min((current + 1) * PAGE, plan.rows.length)} of {plan.rows.length}</span>
          <button type="button" class="btn py-2!" disabled={current >= pages - 1} onclick={() => (page = current + 1)}>Later →</button>
        </nav>
      {/if}
      <p class="mono">Interest is rounded to the cent each payment, like a lender's statement, so the last payment can differ by a few cents. Your lender's figures may vary slightly.</p>
    </section>
  {/if}
</div>

<style>
  .breakdown {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 16px;
    margin: 0;
    padding-top: 14px;
    border-top: 1px solid var(--color-line);
    font-size: 14.5px;
  }
  .breakdown dt {
    color: var(--color-soft);
  }
  .breakdown dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .stat {
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    padding: 10px 12px;
  }
  .stat .value {
    font-family: var(--font-serif);
    font-size: 26px;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .saved {
    animation: rise 0.45s var(--ease-spring) both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
  }
  table th,
  table td {
    padding: 9px 14px;
    text-align: right;
    white-space: nowrap;
  }
  table th:first-child,
  table td:first-child {
    text-align: left;
  }
  table th {
    font: 400 12px var(--font-mono);
    color: var(--color-muted);
    background: var(--color-panel-2);
    position: sticky;
    top: 0;
  }
  table tbody tr {
    border-top: 1px solid var(--color-line);
  }
  table tbody tr:hover {
    background: #f2ede40a;
  }
</style>
