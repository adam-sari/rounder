<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { addBusinessDays, countBusinessDays, parseHolidays, SAT_SUN } from '@/tools/lib/dates/business';
  import {
    addDays, addMonths, compare, describeSpan, formatLong, parseDate, plural, span, toDays, toIso, today, WEEKDAYS,
  } from '@/tools/lib/dates/civil';

  const now = today();
  let mode = $state<'between' | 'add'>('between');

  let startText = $state(toIso(now));
  let endText = $state(toIso({ y: now.y + 1, m: 1, d: 1 }));
  let includeEnd = $state(false);

  let baseText = $state(toIso(now));
  let dir = $state<1 | -1>(1);
  let unit = $state<'calendar' | 'business'>('calendar');
  let amounts = $state({ years: 0, months: 0, weeks: 0, days: 30 });
  let businessDays = $state(10);

  let weekend = $state<number[]>([...SAT_SUN]);
  let holidaysText = $state('');
  const holidays = $derived(parseHolidays(holidaysText));
  const week = $derived({ weekend, holidays: holidays.dates });

  // whole numbers only, and a sane ceiling so a stray keypress can't run off to year 300000;
  // a typed negative flips the direction instead of being silently dropped
  const whole = (x: number | null | undefined, max: number) => Math.min(max, Math.max(-max, Math.trunc(Number(x) || 0)));

  const between = $derived.by(() => {
    const a = parseDate(startText);
    const b = parseDate(endText);
    if (!a || !b) return null;
    const backwards = compare(b, a) < 0;
    const [from, to] = backwards ? [b, a] : [a, b];
    const days = toDays(to) - toDays(from) + (includeEnd ? 1 : 0);
    const weeks = plural(Math.floor(days / 7), 'week');
    return {
      a, b, backwards, days,
      weeks: days % 7 ? `${weeks}, ${plural(days % 7, 'day')}` : weeks,
      calendar: span(from, includeEnd ? addDays(to, 1) : to),
      business: countBusinessDays(from, to, week, includeEnd),
    };
  });

  const added = $derived.by(() => {
    const base = parseDate(baseText);
    if (!base) return null;
    if (unit === 'business') {
      const date = addBusinessDays(base, dir * whole(businessDays, 100_000), week);
      return date && { base, date, clamped: false };
    }
    const months = whole(amounts.years, 10_000) * 12 + whole(amounts.months, 120_000);
    const shifted = addMonths(base, dir * months);
    const date = addDays(shifted, dir * (whole(amounts.weeks, 500_000) * 7 + whole(amounts.days, 3_650_000)));
    return { base, date, clamped: months !== 0 && shifted.d < base.d };
  });

  const showWorkweek = $derived(mode === 'between' || unit === 'business');
  const weekendLabel = $derived(weekend.length ? [...weekend].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d].slice(0, 3)).join(' + ') + ' off' : 'no weekend');

  function toggleDay(d: number) {
    weekend = weekend.includes(d) ? weekend.filter((x) => x !== d) : [...weekend, d];
  }
  function swap() {
    [startText, endText] = [endText, startText];
  }
</script>

<div class="grid gap-6">
  <div class="seg self-start" role="group" aria-label="Calculation">
    <button type="button" aria-pressed={mode === 'between'} onclick={() => (mode = 'between')}>days between dates</button>
    <button type="button" aria-pressed={mode === 'add'} onclick={() => (mode = 'add')}>add or subtract</button>
  </div>

  <div class="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,340px)_1fr]">
    <div class="grid content-start gap-5">
      {#if mode === 'between'}
        <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
          <label><span class="label">start date</span><input class="field" type="date" bind:value={startText} /></label>
          <button type="button" class="btn mb-0.5 px-3!" onclick={swap} aria-label="Swap start and end dates" title="Swap dates">⇄</button>
          <label><span class="label">end date</span><input class="field" type="date" bind:value={endText} /></label>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="accent-(--color-sun)" bind:checked={includeEnd} /> include the end date (adds 1 day)
        </label>
      {:else}
        <label><span class="label">start date</span><input class="field" type="date" bind:value={baseText} /></label>
        <div class="flex flex-wrap gap-3">
          <div class="seg" role="group" aria-label="Direction">
            <button type="button" aria-pressed={dir === 1} onclick={() => (dir = 1)}>+ add</button>
            <button type="button" aria-pressed={dir === -1} onclick={() => (dir = -1)}>− subtract</button>
          </div>
          <div class="seg" role="group" aria-label="Count">
            <button type="button" aria-pressed={unit === 'calendar'} onclick={() => (unit = 'calendar')}>calendar</button>
            <button type="button" aria-pressed={unit === 'business'} onclick={() => (unit = 'business')}>business days</button>
          </div>
        </div>
        {#if unit === 'calendar'}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {#each ['years', 'months', 'weeks', 'days'] as const as key}
              <label><span class="label">{key}</span><input class="field" type="number" inputmode="numeric" bind:value={amounts[key]} /></label>
            {/each}
          </div>
        {:else}
          <label><span class="label">business days</span><input class="field" type="number" inputmode="numeric" bind:value={businessDays} /></label>
        {/if}
      {/if}

      {#if showWorkweek}
        <details class="rounded-xl border border-line-2 px-4 py-3">
          <summary class="cursor-pointer text-sm">
            Weekends &amp; holidays <span class="mono ml-1">{weekendLabel} · {plural(holidays.dates.length, 'holiday')}</span>
          </summary>
          <div class="mt-4 grid gap-4">
            <div>
              <span class="label">days off each week</span>
              <div class="seg" role="group" aria-label="Weekend days">
                {#each [1, 2, 3, 4, 5, 6, 0] as d}
                  <button type="button" aria-pressed={weekend.includes(d)} onclick={() => toggleDay(d)} aria-label={WEEKDAYS[d]}>{WEEKDAYS[d].slice(0, 2)}</button>
                {/each}
              </div>
            </div>
            <label>
              <span class="label">holidays to skip, one per line (YYYY-MM-DD)</span>
              <textarea class="field min-h-[110px]!" bind:value={holidaysText} placeholder={'2026-12-25 Christmas\n2027-01-01 New Year'}></textarea>
            </label>
            {#if holidays.invalid.length}
              <p class="text-bad text-sm" role="alert">Couldn't read: {holidays.invalid.slice(0, 4).join(', ')}{holidays.invalid.length > 4 ? '…' : ''}. Use dates like 2026-12-25.</p>
            {/if}
          </div>
        </details>
      {/if}
    </div>

    <div class="min-w-0">
      {#if mode === 'between'}
        {#if !between}
          <p class="mono">Pick a start and an end date.</p>
        {:else}
          <div class="grid gap-4">
            <div class="rounded-2xl border border-line-2 bg-panel-2 p-5 sm:p-6">
              <p class="mono">{between.backwards ? 'counting back, the end date is earlier' : 'time between'}</p>
              {#key between.days}
                <p class="pop mt-1 font-serif text-6xl leading-none sm:text-7xl" aria-live="polite">
                  <span class="text-sun">{between.days.toLocaleString('en-US')}</span> <span class="text-3xl text-soft">day{between.days === 1 ? '' : 's'}</span>
                </p>
              {/key}
              <p class="mt-3 text-sm text-soft">
                {formatLong(between.a)} <span class="text-muted">→</span> {formatLong(between.b)}{includeEnd ? ', end date included' : ''}
              </p>
            </div>
            <div class="grid gap-2 sm:grid-cols-3">
              <div class="rounded-xl border border-line-2 p-3.5">
                <div class="font-serif text-2xl">{between.weeks}</div>
                <div class="mono">in weeks</div>
              </div>
              <div class="rounded-xl border border-line-2 p-3.5">
                <div class="font-serif text-2xl">{describeSpan(between.calendar)}</div>
                <div class="mono">in months &amp; years</div>
              </div>
              <div class="rounded-xl border border-line-2 p-3.5">
                <div class="font-serif text-2xl">{plural(between.business.days, 'business day')}</div>
                <div class="mono">
                  {weekendLabel.toLowerCase()}{between.business.holidaysSkipped ? ` · ${plural(between.business.holidaysSkipped, 'holiday')} skipped` : ''}
                </div>
              </div>
            </div>
            <p class="mono">{(between.days * 24).toLocaleString('en-US')} hours · {(between.days * 1440).toLocaleString('en-US')} minutes</p>
          </div>
        {/if}
      {:else if !added}
        <p class="mono">{parseDate(baseText) ? 'Every day is marked as a day off. Free up at least one weekday.' : 'Pick a start date.'}</p>
      {:else}
        {@const diff = toDays(added.date) - toDays(added.base)}
        <div class="grid gap-4">
          <div class="rounded-2xl border border-line-2 bg-panel-2 p-5 sm:p-6">
            <p class="mono">the date will be</p>
            {#key toIso(added.date)}
              <p class="pop mt-1 font-serif text-4xl leading-tight text-sun sm:text-5xl" aria-live="polite">{formatLong(added.date)}</p>
            {/key}
            <p class="mt-3 text-sm text-soft">
              {diff === 0 ? 'the same day' : `${plural(Math.abs(diff), 'calendar day')} ${diff > 0 ? 'after' : 'before'}`} {formatLong(added.base)}
            </p>
          </div>
          {#if added.clamped}
            <p class="text-sm text-soft">That month has no day {added.base.d}, so the result lands on its last day, the usual rule for adding months.</p>
          {/if}
          <div class="flex flex-wrap gap-2">
            <CopyButton text={() => formatLong(added.date)} class="btn-primary" label="Copy date" />
            <CopyButton text={() => toIso(added.date)} label="Copy {toIso(added.date)}" />
            <!-- date inputs only take years 1–9999 -->
            <button type="button" class="btn" disabled={added.date.y < 1 || added.date.y > 9999} onclick={() => (baseText = toIso(added.date))}>Use as start date</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .pop {
    animation: pop 0.4s var(--ease-spring) both;
  }
  @keyframes pop {
    from {
      opacity: 0.2;
      transform: translateY(6px);
    }
  }
  details[open] summary {
    color: var(--color-chalk);
  }
</style>
