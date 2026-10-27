<script lang="ts">
  import { onMount } from 'svelte';
  import { ageOn, nextBirthday, parseTime, starSign } from '@/tools/lib/dates/age';
  import { chineseZodiac } from '@/tools/lib/dates/lunar';
  import { WEEKDAYS, compare, describeSpan, formatLong, formatShort, parseDate, plural, span, toIso, today, weekday, type Overflow } from '@/tools/lib/dates/civil';

  let birthText = $state('');
  let timeText = $state('');
  let mode = $state<'today' | 'date'>('today');
  let onText = $state(toIso(today()));
  let leap = $state<Overflow>('clamp');
  let now = $state(new Date());

  // a live clock, so the seconds count and midnight rollovers stay current
  onMount(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });

  const birth = $derived(parseDate(birthText));
  const birthTime = $derived(timeText ? parseTime(timeText) : null);
  const live = $derived(mode === 'today');
  const on = $derived(live ? today(now) : parseDate(onText));
  const seconds = $derived(now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
  const isLeapling = $derived(birth?.m === 2 && birth.d === 29);
  // the Feb 28 / Mar 1 choice is hidden for other birthdays, so it mustn't change their month-end counting
  const overflow = $derived<Overflow>(isLeapling ? leap : 'clamp');

  // a birth time only matters when measuring up to right now
  const timed = $derived(live && birthTime != null);
  const age = $derived(birth && on ? ageOn(birth, on, { birthTime: timed ? birthTime : null, time: seconds, leap: overflow }) : null);
  const next = $derived(birth && on && age ? nextBirthday(birth, on, overflow) : null);
  const extras = $derived(
    birth ? { born: WEEKDAYS[weekday(birth)], star: starSign(birth), chinese: birth.y >= 1000 && birth.y <= 3000 ? chineseZodiac(birth) : null } : null,
  );

  const n = (x: number) => x.toLocaleString('en-US');
  const ordinal = (x: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = x % 100;
    return `${x}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  };
  const clock = (h: number, m: number, s: number) => [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');

  const totals = $derived(
    age
      ? ([
          ['months', n(age.totalMonths)],
          ['weeks', `${n(age.totalWeeks)}${age.totalDays % 7 ? ` + ${age.totalDays % 7}d` : ''}`],
          ['days', n(age.totalDays)],
          ['hours', n(age.totalHours)],
          timed ? ['seconds', n(age.totalSeconds)] : ['minutes', n(age.totalHours * 60)],
        ] as const)
      : [],
  );
</script>

<div class="grid gap-8 lg:grid-cols-[minmax(0,300px)_1fr]">
  <div class="grid content-start gap-5">
    <div class="grid grid-cols-[1fr_auto] gap-3">
      <label>
        <span class="label">date of birth</span>
        <input class="field" type="date" bind:value={birthText} max={live ? toIso(today(now)) : undefined} />
      </label>
      <label>
        <span class="label">time <span class="opacity-70">(optional)</span></span>
        <input class="field w-[7.5rem]!" type="time" bind:value={timeText} />
      </label>
    </div>

    <div>
      <span class="label">age on</span>
      <div class="seg" role="group" aria-label="Measure age on">
        <button type="button" aria-pressed={live} onclick={() => (mode = 'today')}>today</button>
        <button type="button" aria-pressed={!live} onclick={() => (mode = 'date')}>another date</button>
      </div>
      {#if !live}
        <label class="mt-3 block">
          <span class="sr-only">Date to measure age on</span>
          <input class="field" type="date" bind:value={onText} />
        </label>
      {/if}
    </div>

    {#if isLeapling}
      <div class="rounded-xl border border-line-2 p-3.5">
        <span class="label">leap-day birthday: in common years, count it on</span>
        <div class="seg" role="group" aria-label="Leap-day birthday in common years">
          <button type="button" aria-pressed={leap === 'clamp'} onclick={() => (leap = 'clamp')}>Feb 28</button>
          <button type="button" aria-pressed={leap === 'roll'} onclick={() => (leap = 'roll')}>Mar 1</button>
        </div>
        <p class="mono mt-2">Customs differ: some places treat Mar 1 as the legal birthday.</p>
      </div>
    {/if}

    {#if live && birth && birthTime == null}
      <p class="mono">Add a birth time to count your age down to the second.</p>
    {:else if !live && birthTime != null}
      <p class="mono">The birth time only counts for your age today. On other dates, whole days are counted.</p>
    {/if}
  </div>

  <div>
    {#if !birth}
      <div class="empty grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-line-2 p-8 text-center">
        <div>
          <p class="font-serif text-4xl">How old, <em>exactly</em>?</p>
          <p class="mono mt-2">enter a date of birth to see it to the day</p>
        </div>
      </div>
    {:else if !on}
      <p class="text-bad text-sm" role="alert">Pick the date to measure the age on.</p>
    {:else if !age}
      <p class="text-bad text-sm" role="alert">
        {#if timed && compare(birth, on) === 0}
          That birth time is later than now. Check the time, or clear it.
        {:else}
          That birth date is after {live ? 'today' : formatShort(on)}. Pick an earlier date{live ? '' : ' or a later "age on" date'}.
        {/if}
      </p>
    {:else}
      {#key birthText}
        <div class="rise grid gap-4">
          <div class="rounded-2xl border border-line-2 bg-panel-2 p-5 sm:p-6">
            <p class="mono">{live ? 'your age today' : `age on ${formatLong(on)}`}</p>
            <div class="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2" aria-live="polite">
              {#each [[age.years, 'year'], [age.months, 'month'], [age.days, 'day']] as const as [value, unit]}
                <div class="flex items-baseline gap-2">
                  <span class="font-serif text-6xl leading-none text-sun sm:text-7xl">{value}</span>
                  <span class="text-soft">{unit}{value === 1 ? '' : 's'}</span>
                </div>
              {/each}
            </div>
            {#if timed}
              <p class="mono mt-3 tabular-nums">+ {clock(age.hours, age.minutes, age.seconds)} <span class="opacity-70">hh:mm:ss since your last whole day</span></p>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {#each totals as [label, value]}
              <div class="min-w-0 rounded-xl border border-line-2 px-3 py-2.5">
                <div class="truncate font-serif text-2xl leading-tight tabular-nums" title={value}>{value}</div>
                <div class="mono mt-0.5">total {label}</div>
              </div>
            {/each}
          </div>

          {#if next}
            <div class="rounded-2xl border border-line-2 p-5" class:party={next.inDays === 0}>
              {#if next.inDays === 0}
                <p class="font-serif text-4xl">Happy <em>birthday</em>!</p>
                <p class="mt-1 text-soft">{live ? `You turn ${next.turning} today.` : `The ${ordinal(next.turning)} birthday falls on this date.`}</p>
              {:else}
                <p class="mono">{ordinal(next.turning)} birthday</p>
                <p class="mt-1 font-serif text-4xl">
                  in <span class="text-sun">{plural(next.inDays, 'day')}</span>
                </p>
                <p class="mt-1 text-soft">
                  {formatLong(next.date)}{next.inDays > 31 ? ` · ${describeSpan(span(on, next.date))} away` : ''}
                </p>
              {/if}
            </div>
          {/if}

          {#if extras}
            <div class="grid gap-2 sm:grid-cols-3">
              <div class="rounded-xl border border-line-2 p-3.5">
                <div class="mono">born on a</div>
                <div class="font-serif text-2xl">{extras.born}</div>
              </div>
              <div class="rounded-xl border border-line-2 p-3.5">
                <div class="mono">star sign</div>
                <div class="font-serif text-2xl"><span aria-hidden="true" class="mr-1 text-sun">{extras.star.symbol}&#xFE0E;</span>{extras.star.name}</div>
              </div>
              {#if extras.chinese}
                <div class="rounded-xl border border-line-2 p-3.5">
                  <div class="mono">chinese zodiac</div>
                  <div class="font-serif text-2xl">{extras.chinese.element} {extras.chinese.animal}</div>
                  <div class="mono">year began {formatShort(extras.chinese.yearStart)}</div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/key}
    {/if}
  </div>
</div>

<style>
  .empty {
    background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--color-sun) 7%, transparent), transparent 70%);
  }
  .rise {
    animation: rise 0.45s var(--ease-spring) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .party {
    border-color: color-mix(in srgb, var(--color-sun) 60%, transparent);
    background: radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--color-sun) 16%, transparent), transparent 60%);
    animation: glow 2.4s ease-in-out infinite alternate;
  }
  @keyframes glow {
    to {
      box-shadow: 0 0 36px -8px color-mix(in srgb, var(--color-sun) 45%, transparent);
    }
  }
</style>
