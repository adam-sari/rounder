<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import CurrencyPicker from './CurrencyPicker.svelte';
  import {
    API, convert, currencyForLocale, flag, formatMoney, formatRate, isFresh, isoDaysAgo, parseAmount,
    readCache, sparkPaths, toCache, toSeries, type Point, type RateCache,
  } from '@/tools/lib/currency-converter/rates';

  const RATES_KEY = 'rounder:fx-rates';
  const PREFS_KEY = 'rounder:fx-prefs';
  const DEFAULT_LIST = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'INR'];

  const uid = $props.id();
  const names = new Intl.DisplayNames('en', { type: 'currency' });
  const nameOf = (code: string) => names.of(code) ?? code;

  let cache = $state<RateCache | null>(null);
  let status = $state<'loading' | 'ready' | 'stale' | 'error'>('loading');
  let offline = $state(false);
  let refreshing = $state(false);
  let amountText = $state('100');
  let from = $state('USD');
  let to = $state('EUR');
  let favorites = $state<string[]>(DEFAULT_LIST);
  let turns = $state(0);
  let mounted = false;
  let guessLocale = true;

  const codes = $derived(cache ? Object.keys(cache.rates).sort() : []);
  const amount = $derived(parseAmount(amountText));
  const result = $derived(cache && amount !== null ? convert(amount, from, to, cache.rates) : null);
  const unit = $derived(cache ? convert(1, from, to, cache.rates) : null);
  const resultText = $derived(result === null ? '' : formatMoney(result, to));
  const list = $derived(favorites.filter((c) => c !== from && cache?.rates[c]));
  const rateDate = $derived(
    cache ? new Date(`${cache.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '',
  );

  function save(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode or storage full: the tool still works, it just won't remember
    }
  }

  function load(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    if (!cache) status = 'loading';
    try {
      // the API sends max-age=86400; revalidate so our own 12h window decides freshness.
      // The timeout keeps a hung connection from leaving the page stuck on "fetching".
      const res = await fetch(`${API}/latest?base=EUR`, { cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache = toCache(await res.json(), Date.now());
      save(RATES_KEY, cache);
      status = 'ready';
    } catch {
      status = cache ? 'stale' : 'error';
    }
    offline = !navigator.onLine;
    refreshing = false;
  }

  onMount(() => {
    cache = readCache(load(RATES_KEY));
    try {
      const p = JSON.parse(load(PREFS_KEY) ?? 'null');
      if (p) {
        const isCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
        if (isCode(p.from)) from = p.from;
        if (isCode(p.to)) to = p.to;
        if (Array.isArray(p.favorites)) favorites = p.favorites.filter(isCode);
        if (typeof p.amount === 'string') amountText = p.amount;
        guessLocale = false;
      }
    } catch {
      // unreadable prefs: start fresh
    }
    mounted = true;
    // saved rates show right away (with their real ECB date) while we check for newer ones
    if (cache) status = 'ready';
    if (!cache || !isFresh(cache, Date.now())) refresh();

    const back = () => status !== 'ready' && refresh();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  });

  $effect(() => {
    const prefs = { from, to, favorites: [...favorites], amount: amountText };
    // wait for rates so a failed first visit doesn't save defaults over the locale guess
    if (mounted && cache) save(PREFS_KEY, prefs);
  });

  // first visit: start from the visitor's own currency once we know what's published;
  // later visits: fall back if a saved currency is no longer published
  $effect(() => {
    if (!codes.length) return;
    if (guessLocale) {
      guessLocale = false;
      const local = currencyForLocale(navigator.language, codes);
      if (local) [from, to] = [local, local === 'EUR' ? 'USD' : 'EUR'];
    }
    if (!codes.includes(from)) from = codes.includes('USD') ? 'USD' : codes[0];
    if (!codes.includes(to)) to = from === 'EUR' ? 'USD' : 'EUR';
  });

  function swap() {
    [from, to] = [to, from];
    turns++;
  }

  const addFavorite = (code: string) => (favorites = [...favorites, code]);
  const removeFavorite = (code: string) => (favorites = favorites.filter((c) => c !== code));

  // ---- 30-day chart ----
  const seriesCache = new Map<string, Point[]>();
  let series = $state<Point[] | null>(null);
  let chartState = $state<'loading' | 'ready' | 'error'>('loading');
  let chartWidth = $state(0);
  let hover = $state<number | null>(null);
  const CHART_H = 150;

  $effect(() => {
    const pair = `${from}-${to}`;
    hover = null;
    if (!cache || from === to) return;
    const hit = seriesCache.get(pair);
    if (hit) {
      series = hit;
      chartState = 'ready';
      return;
    }
    // drop the previous pair's points so its values never show under the new labels
    series = null;
    chartState = 'loading';
    const [base, quote] = [from, to];
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/${isoDaysAgo(30, new Date())}..?base=${base}&symbols=${quote}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const s = toSeries(await res.json(), quote);
        seriesCache.set(pair, s);
        series = s;
        chartState = s.length > 1 ? 'ready' : 'error';
      } catch {
        if (!ctrl.signal.aborted) chartState = 'error';
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  const chart = $derived(series && series.length > 1 && chartWidth ? sparkPaths(series, chartWidth, CHART_H, 14) : null);
  const change = $derived(series && series.length > 1 ? (series.at(-1)!.value / series[0].value - 1) * 100 : 0);
  const shown = $derived(series && hover !== null ? series[hover] : series?.at(-1));
  const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function onChartMove(e: PointerEvent) {
    if (!series) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hover = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (series.length - 1));
  }

  function onChartKey(e: KeyboardEvent) {
    if (!series) return;
    const last = series.length - 1;
    const i = hover ?? last;
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    hover = Math.min(last, Math.max(0, next));
  }
</script>

{#if status === 'loading'}
  <div class="grid min-h-[320px] place-items-center rounded-2xl border border-dashed border-line-2" aria-busy="true">
    <p class="mono flex items-center gap-2"><span class="pulse" aria-hidden="true"></span> fetching today's reference rates…</p>
  </div>
{:else if status === 'error'}
  <div class="grid min-h-[320px] place-items-center rounded-2xl border border-dashed border-line-2 p-6 text-center" role="alert">
    <div class="grid max-w-sm justify-items-center gap-3">
      <p class="font-serif text-3xl">Rates are out of reach</p>
      <p class="text-soft">
        {offline ? "You're offline and there are no saved rates on this device yet." : "We couldn't reach the exchange-rate service. It may be a hiccup on their side or your connection."}
        Try again in a moment.
      </p>
      <button type="button" class="btn btn-primary" onclick={refresh} disabled={refreshing}>Try again</button>
    </div>
  </div>
{:else if cache}
  <div class="grid gap-5">
    <section class="rounded-2xl border border-line-2 p-4 sm:p-6" aria-label="Converter">
      <div class="grid items-end gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <label class="min-w-0">
          <span class="label">amount</span>
          <span class="relative block">
            <input class="field amount pr-14!" type="text" inputmode="decimal" autocomplete="off" bind:value={amountText} aria-invalid={amount === null && amountText.trim() !== ''} />
            <span class="mono pointer-events-none absolute top-1/2 right-4 -translate-y-1/2" aria-hidden="true">{from}</span>
          </span>
        </label>
        <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 sm:contents">
          <div class="min-w-0">
            <span class="label" aria-hidden="true">from</span>
            <CurrencyPicker value={from} {codes} {nameOf} label="From currency" onpick={(c) => (c === to ? swap() : (from = c))} />
          </div>
          <button type="button" class="swap" aria-label="Swap currencies" title="Swap" onclick={swap}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style:transform={`rotate(${turns * 180}deg)`}>
              <path d="M3 6h11m0 0l-3-3m3 3l-3 3M15 12H4m0 0l3-3m-3 3l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="min-w-0">
            <span class="label" aria-hidden="true">to</span>
            <CurrencyPicker value={to} {codes} {nameOf} label="To currency" align="end" onpick={(c) => (c === from ? swap() : (to = c))} />
          </div>
        </div>
      </div>

      <div class="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
        <div class="min-w-0" aria-live="polite">
          {#if result !== null && amount !== null}
            <p class="mono">{formatMoney(amount, from)} =</p>
            {#key `${from}${to}`}
              <p class="rise font-serif text-[clamp(2.4rem,7vw,3.75rem)] leading-[1.05] break-words">
                <span class="text-sun">{resultText}</span>
              </p>
            {/key}
          {:else}
            <p class="mono">{amountText.trim() ? 'enter a number, like 1,250.50' : 'type an amount to convert'}</p>
            <p class="font-serif text-[clamp(2.4rem,7vw,3.75rem)] leading-[1.05] text-muted">—</p>
          {/if}
          {#if unit !== null}
            <p class="mono mt-2">1 {from} = {formatRate(unit)} {to} · 1 {to} = {formatRate(1 / unit)} {from}</p>
          {/if}
        </div>
        <CopyButton text={() => resultText} label="Copy result" />
      </div>
    </section>

    <p class="mono -mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      {#if status === 'stale'}
        <span class="text-sun">{offline ? "You're offline." : "Couldn't refresh rates."} Showing saved ECB rates from {rateDate}.</span>
        <button type="button" class="underline decoration-line-2 underline-offset-4 hover:text-chalk" onclick={refresh} disabled={refreshing}>{refreshing ? 'Retrying…' : 'Retry'}</button>
      {:else}
        <span class="dot" aria-hidden="true"></span>
        ECB reference rates from {rateDate} · updated each working day around 16:00 CET
      {/if}
    </p>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section class="rounded-2xl border border-line-2 p-4 sm:p-5" aria-labelledby={`${uid}-trend`}>
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${uid}-trend`} class="text-2xl">30-day trend</h2>
          {#if chartState === 'ready' && series && from !== to}
            <span class="mono">
              <span class="text-chalk">{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span> {from} vs {to}
            </span>
          {/if}
        </div>

        {#if from === to}
          <p class="mono grid h-[150px] place-items-center">pick two different currencies to see a trend</p>
        {:else if chartState === 'error'}
          <p class="mono grid h-[150px] place-items-center text-center">the rate history isn't available right now{offline ? ' (offline)' : ''}</p>
        {:else}
          <p class="mt-1 text-sm text-soft">
            {#if shown}
              <span class="text-chalk">1 {from} = {formatRate(shown.value)} {to}</span> <span class="mono">on {shortDate(shown.date)}</span>
            {:else}&nbsp;{/if}
          </p>
          <div class="relative mt-3" bind:clientWidth={chartWidth}>
            {#if chart && series && chartState === 'ready'}
              <div
                class="chart"
                role="slider"
                tabindex="0"
                aria-label={`${from} to ${to} rate, last 30 days`}
                aria-valuemin={0}
                aria-valuemax={series.length - 1}
                aria-valuenow={hover ?? series.length - 1}
                aria-valuetext={shown ? `${shortDate(shown.date)}: 1 ${from} = ${formatRate(shown.value)} ${to}` : undefined}
                onpointerdown={onChartMove}
                onpointermove={onChartMove}
                onpointerleave={() => (hover = null)}
                onkeydown={onChartKey}
                onblur={() => (hover = null)}
              >
                <svg width={chartWidth} height={CHART_H} viewBox={`0 0 ${chartWidth} ${CHART_H}`} aria-hidden="true">
                  <defs>
                    <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stop-color="var(--color-sun)" stop-opacity="0.22" />
                      <stop offset="1" stop-color="var(--color-sun)" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  {#each [0.25, 0.5, 0.75] as f}
                    <line x1="0" x2={chartWidth} y1={CHART_H * f} y2={CHART_H * f} stroke="var(--color-line)" stroke-dasharray="2 4" />
                  {/each}
                  {#key `${from}${to}`}
                    <path class="area" d={chart.area} fill={`url(#${uid}-fill)`} />
                    <path class="line" d={chart.line} pathLength="1" fill="none" stroke="var(--color-sun)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                  {/key}
                  {#if hover !== null}
                    {@const [x, y] = chart.coords[hover]}
                    <line x1={x} x2={x} y1="0" y2={CHART_H} stroke="var(--color-line-2)" />
                    <circle cx={x} cy={y} r="5" fill="var(--color-bg)" stroke="var(--color-sun)" stroke-width="2" />
                  {:else}
                    {@const [x, y] = chart.coords.at(-1)!}
                    <circle cx={x - 1} cy={y} r="3.5" fill="var(--color-sun)" />
                  {/if}
                </svg>
              </div>
              <div class="mono mt-2 flex justify-between gap-2">
                <span>{shortDate(series[0].date)}</span>
                <span>low {formatRate(chart.min)} · high {formatRate(chart.max)}</span>
                <span>{shortDate(series.at(-1)!.date)}</span>
              </div>
            {:else}
              <div class="skeleton h-[150px] rounded-xl" aria-busy="true" aria-label="Loading rate history"></div>
              <div class="mono mt-2">&nbsp;</div>
            {/if}
          </div>
        {/if}
      </section>

      <section class="rounded-2xl border border-line-2 p-4 sm:p-5" aria-labelledby={`${uid}-list`}>
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${uid}-list`} class="text-2xl">Your list</h2>
          <span class="mono">{amount !== null ? formatMoney(amount, from) : '—'} in…</span>
        </div>
        <ul class="mt-3 grid gap-1.5">
          {#each list as code (code)}
            {@const v = amount !== null ? convert(amount, from, code, cache.rates) : null}
            <li class="row" class:current={code === to}>
              <button type="button" class="pick" onclick={() => (to = code)} aria-label={`Convert to ${nameOf(code)}`} aria-pressed={code === to}>
                <span class="flag text-xl leading-none" aria-hidden="true">{flag(code)}</span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium leading-tight">{code}</span>
                  <span class="block truncate text-xs text-muted">{nameOf(code)}</span>
                </span>
                <span class="text-right tabular-nums">{v === null ? '—' : formatMoney(v, code)}</span>
              </button>
              <button type="button" class="remove" aria-label={`Remove ${code} from your list`} onclick={() => removeFavorite(code)}>×</button>
            </li>
          {:else}
            <li class="mono rounded-xl border border-dashed border-line-2 px-4 py-6 text-center">add the currencies you check most</li>
          {/each}
        </ul>
        <div class="mt-3">
          <CurrencyPicker add codes={codes.filter((c) => !favorites.includes(c))} {nameOf} label="Add currency" onpick={addFavorite} />
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .amount {
    font: 400 1.9rem/1.2 var(--font-serif);
    padding-block: 7px;
    min-height: 54px;
  }
  .swap {
    display: grid;
    place-items: center;
    width: 44px;
    height: 54px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-chalk);
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    & svg {
      transition: transform 0.45s var(--ease-spring);
    }
    &:hover {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
  }
  .flag {
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  }
  .rise {
    animation: rise 0.45s var(--ease-spring);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  .dot,
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-ok);
    flex: none;
  }
  .pulse {
    background: var(--color-sun);
    animation: pulse 1.1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
  .chart {
    touch-action: pan-y;
    cursor: crosshair;
    border-radius: 10px;
    & svg {
      display: block;
      overflow: visible;
    }
  }
  .line {
    stroke-dasharray: 1;
    animation: draw 0.9s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .area {
    animation: fade 0.9s ease-out;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .skeleton {
    background: linear-gradient(90deg, transparent, var(--color-line), transparent) 0 0 / 200% 100%, var(--color-panel-2);
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0, 0 0;
    }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    transition: border-color 0.2s, background 0.2s;
    &:hover {
      border-color: var(--color-line-2);
    }
    &.current {
      border-color: color-mix(in srgb, var(--color-sun) 55%, transparent);
      background: color-mix(in srgb, var(--color-sun) 6%, transparent);
    }
  }
  .pick {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 10px;
    padding: 8px 4px 8px 12px;
    text-align: left;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    border-radius: 12px;
  }
  .remove {
    width: 36px;
    height: 36px;
    flex: none;
    border-radius: 10px;
    background: none;
    border: 0;
    color: var(--color-muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    &:hover {
      color: var(--color-bad);
    }
  }
</style>
