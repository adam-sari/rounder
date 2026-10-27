<script lang="ts">
  import { onMount } from 'svelte';
  import cronstrue from 'cronstrue';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { FIELDS, nextRuns, parseCron, type FieldName, type FieldSpec } from '@/tools/lib/cron/cron';
  import { compose, composeField, decompose, decomposeField, order, top, withMode, type Builder, type FieldState, type Mode } from '@/tools/lib/cron/builder';

  const START = '0 9 * * 1-5';

  let expr = $state(START);
  let builder = $state<Builder>(decompose(START.split(' ')));
  let seconds = $state(false);
  let active = $state<FieldName>('minute');
  let utc = $state(false);
  let now = $state<number | null>(null);
  let zone = $state('your time zone');

  const parsed = $derived(parseCron(expr));

  const description = $derived.by(() => {
    if (!parsed.ok) return '';
    try {
      return cronstrue.toString(parsed.schedule.fields.join(' '), { throwExceptionOnParseError: true, use24HourTimeFormat: false });
    } catch {
      return '';
    }
  });

  // floor to the schedule's resolution so the run list only recomputes when it can change
  const resolution = $derived(parsed.ok && parsed.schedule.hasSeconds ? 1000 : 60_000);
  const tick = $derived(now === null ? null : Math.floor(now / resolution) * resolution);
  const runs = $derived(parsed.ok && tick !== null ? nextRuns(parsed.schedule, new Date(tick), 10, utc) : []);
  const shown = $derived(parsed.ok ? parsed.schedule.fields : expr.trim().split(/\s+/));
  const bothDays = $derived(parsed.ok && !parsed.schedule.dayStar && !parsed.schedule.weekdayStar);

  onMount(() => {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  /** Typed or picked expressions flow back into the builder */
  function setExpr(text: string) {
    expr = text;
    const r = parseCron(text);
    const fields = r.ok ? r.schedule.fields : text.trim().split(/\s+/);
    if (!r.ok && (text.trim().startsWith('@') || fields.length < 5 || fields.length > 6)) return;
    builder = decompose(fields);
    seconds = fields.length === 6;
    if (!seconds && active === 'second') active = 'minute';
  }

  /** The fields as written, so editing one leaves the others exactly as typed (names, 7 for Sunday…) */
  function written(): string[] | null {
    const fields = parsed.ok ? parsed.schedule.fields : expr.trim().split(/\s+/);
    return fields.length === order(seconds).length ? [...fields] : null;
  }

  function update(name: FieldName, state: FieldState) {
    builder[name] = state;
    const fields = written();
    if (fields) {
      fields[order(seconds).indexOf(name)] = composeField(state, FIELDS[name]);
      expr = fields.join(' ');
    } else expr = compose(builder, seconds);
  }

  function toggleSeconds(on: boolean) {
    const fields = written();
    seconds = on;
    // a new seconds field starts at :00 so the schedule keeps its meaning
    if (on) builder.second = decomposeField('0', FIELDS.second);
    else if (active === 'second') active = 'minute';
    expr = fields ? (on ? ['0', ...fields] : fields.slice(1)).join(' ') : compose(builder, seconds);
  }

  const presets: [string, string][] = [
    ['every minute', '* * * * *'],
    ['every 5 minutes', '*/5 * * * *'],
    ['every 15 minutes', '*/15 * * * *'],
    ['every hour', '0 * * * *'],
    ['daily at midnight', '0 0 * * *'],
    ['daily at 9am', '0 9 * * *'],
    ['weekdays at 9am', '0 9 * * 1-5'],
    ['Sundays at midnight', '0 0 * * 0'],
    ['first of the month', '0 0 1 * *'],
    ['every quarter', '0 0 1 1,4,7,10 *'],
    ['once a year', '0 0 1 1 *'],
    ['every 30 seconds', '*/30 * * * * *'],
  ];

  const modes: [Mode, string][] = [['every', 'every'], ['specific', 'specific'], ['range', 'range'], ['step', 'step'], ['custom', 'custom']];

  const short: Record<FieldName, string> = { second: 'second', minute: 'minute', hour: 'hour', day: 'day', month: 'month', weekday: 'weekday' };
  const unit: Record<FieldName, string> = { second: 'seconds', minute: 'minutes', hour: 'hours', day: 'days', month: 'months', weekday: 'days' };

  const nameOf = (spec: FieldSpec, v: number) => {
    const n = spec.names?.[spec.name === 'month' ? v - 1 : v];
    return n ? n[0] + n.slice(1).toLowerCase() : String(v);
  };
  const valuesOf = (spec: FieldSpec) => Array.from({ length: top(spec) - spec.min + 1 }, (_, i) => spec.min + i);

  const invalid = (name: FieldName) => !parsed.ok && parsed.error.startsWith(FIELDS[name].label);

  const fmt = (timeZone?: string) =>
    new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', ...(seconds && { second: '2-digit' }), timeZone,
    });
  const localFmt = $derived(fmt());
  const utcFmt = $derived(fmt('UTC'));

  function until(ms: number) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `in ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
    const d = Math.floor(h / 24);
    return d < 730 ? `in ${d} days` : `in ${Math.floor(d / 365)} years`;
  }

  const cur = $derived(builder[active]);
  const spec = $derived(FIELDS[active]);
</script>

<div class="grid gap-6">
  <div class="grid gap-4 rounded-2xl border border-line-2 bg-panel-2 p-4 sm:p-6">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-0 flex-1 basis-64">
        <span class="label">cron expression</span>
        <input
          class="field font-mono! text-lg! tracking-wide"
          value={expr}
          oninput={(e) => setExpr(e.currentTarget.value)}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!parsed.ok}
          aria-describedby="cron-meaning"
        />
      </label>
      <CopyButton text={() => expr} label="Copy" />
    </div>

    <div id="cron-meaning" aria-live="polite">
      {#if parsed.ok}
        {#key description}
          <p class="reveal font-serif text-2xl leading-tight sm:text-3xl">{description || 'Valid cron expression'}</p>
        {/key}
        {#if bothDays}
          <p class="mono mt-2">Both day fields are set, so it runs when either the day of the month or the weekday matches (standard cron rule).</p>
        {/if}
      {:else}
        <p class="text-bad" role="alert">{parsed.error}</p>
      {/if}
    </div>
  </div>

  <div>
    <span class="label" id="cron-presets">presets</span>
    <div class="flex flex-wrap gap-2" role="group" aria-labelledby="cron-presets">
      {#each presets as [label, value]}
        <button type="button" class="chip" aria-pressed={expr.trim() === value} onclick={() => setExpr(value)}>{label}</button>
      {/each}
    </div>
  </div>

  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="label mb-0!">build it</span>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" class="accent-(--color-sun)" checked={seconds} onchange={(e) => toggleSeconds(e.currentTarget.checked)} />
        include seconds
      </label>
    </div>

    <div class="grid gap-2" style:grid-template-columns={`repeat(${seconds ? 6 : 5}, minmax(0, 1fr))`} role="group" aria-label="Field to edit">
      {#each order(seconds) as name, i}
        <button type="button" class="slot" class:bad={invalid(name)} aria-pressed={active === name} onclick={() => (active = name)}>
          <span class="block truncate font-mono text-base sm:text-xl">{shown[i] || '*'}</span>
          <span class="mono mt-1 block truncate text-[11px]!">{short[name]}</span>
        </button>
      {/each}
    </div>

    {#if cur}
      <div class="grid gap-4 rounded-2xl border border-line-2 p-4 sm:p-5" role="region" aria-label={`Edit ${spec.label.toLowerCase()}`}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-2xl">{spec.label}</h3>
          <div class="seg" role="group" aria-label={`${spec.label} mode`}>
            {#each modes as [mode, label]}
              <button type="button" aria-pressed={cur.mode === mode} onclick={() => update(active, withMode(cur, mode, spec))}>{label}</button>
            {/each}
          </div>
        </div>

        {#if cur.mode === 'every'}
          <p class="text-soft">Runs every {unit[active] === 'days' ? 'day' : unit[active].slice(0, -1)}{active === 'weekday' ? ' of the week' : ''}. Pick another mode to narrow it down.</p>
        {:else if cur.mode === 'specific'}
          <div class="grid gap-1.5 {active === 'minute' || active === 'second' ? 'grid-cols-10 sm:grid-cols-12' : active === 'month' ? 'grid-cols-4 sm:grid-cols-6' : active === 'weekday' ? 'grid-cols-4 sm:grid-cols-7' : active === 'day' ? 'grid-cols-7' : 'grid-cols-6 sm:grid-cols-12'}">
            {#each valuesOf(spec) as v}
              {@const on = cur.values.includes(v)}
              <button
                type="button"
                class="pick"
                aria-pressed={on}
                aria-label={`${spec.label} ${nameOf(spec, v)}`}
                onclick={() => update(active, { ...cur, values: on ? cur.values.filter((x) => x !== v) : [...cur.values, v] })}
              >{nameOf(spec, v)}</button>
            {/each}
          </div>
          {#if !cur.values.length}<p class="mono">Nothing picked, so this field matches everything.</p>{/if}
        {:else if cur.mode === 'range'}
          <div class="flex flex-wrap items-end gap-3">
            <label><span class="label">from</span>
              <select class="field w-auto!" value={cur.from} onchange={(e) => update(active, { ...cur, from: Number(e.currentTarget.value) })}>
                {#each valuesOf(spec) as v}<option value={v}>{nameOf(spec, v)}</option>{/each}
              </select>
            </label>
            <label><span class="label">to</span>
              <select class="field w-auto!" value={cur.to} onchange={(e) => update(active, { ...cur, to: Number(e.currentTarget.value) })}>
                {#each valuesOf(spec) as v}<option value={v}>{nameOf(spec, v)}</option>{/each}
              </select>
            </label>
          </div>
        {:else if cur.mode === 'step'}
          <div class="flex flex-wrap items-end gap-3">
            <label><span class="label">every</span>
              <input
                class="field w-24!"
                type="number"
                min="1"
                max={top(spec)}
                value={cur.every}
                oninput={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (n >= 1) update(active, { ...cur, every: Math.min(n, top(spec)) });
                }}
              />
            </label>
            <span class="pb-3 text-soft">{unit[active]}, starting at</span>
            <label><span class="label">start</span>
              <select class="field w-auto!" value={cur.start} onchange={(e) => update(active, { ...cur, start: Number(e.currentTarget.value) })}>
                {#each valuesOf(spec) as v}<option value={v}>{nameOf(spec, v)}</option>{/each}
              </select>
            </label>
          </div>
        {:else}
          <label><span class="label">field value (lists, ranges and steps, e.g. 1-5,10/15)</span>
            <input class="field font-mono!" value={cur.raw} oninput={(e) => update(active, { ...cur, raw: e.currentTarget.value })} spellcheck="false" />
          </label>
        {/if}
      </div>
    {/if}
  </div>

  <div class="grid gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-2xl">Next 10 runs</h3>
      <div class="seg" role="group" aria-label="Time zone the schedule runs in">
        <button type="button" aria-pressed={!utc} onclick={() => (utc = false)}>{zone}</button>
        <button type="button" aria-pressed={utc} onclick={() => (utc = true)}>UTC</button>
      </div>
    </div>
    <p class="mono -mt-1">Cron follows the clock of the machine it runs on. Pick the time zone your server uses.</p>

    {#if !parsed.ok}
      <p class="rounded-xl border border-line-2 px-4 py-6 text-center text-muted">Fix the expression to see when it runs.</p>
    {:else if now === null}
      <p class="rounded-xl border border-line-2 px-4 py-6 text-center text-muted">Working out run times…</p>
    {:else if !runs.length}
      <p class="rounded-xl border border-line-2 px-4 py-6 text-center text-soft">This schedule never runs, for example because it asks for February 30.</p>
    {:else}
      <ol class="overflow-hidden rounded-xl border border-line-2">
        <li class="row mono hidden! sm:grid!" aria-hidden="true"><span>#</span><span>{zone}</span><span>UTC</span><span class="text-right">when</span></li>
        {#each runs as run, i (run.getTime())}
          <li class="row" class:first={i === 0}>
            <span class="mono">{String(i + 1).padStart(2, '0')}</span>
            <span>{localFmt.format(run)}</span>
            <span class="mono col-start-2 sm:col-start-auto">{utcFmt.format(run)} UTC</span>
            <span class="when mono sm:text-right">{until(run.getTime() - now)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  .chip {
    font: 400 13px var(--font-mono);
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    padding: 6px 12px;
    background: transparent;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover { border-color: var(--color-muted); color: var(--color-chalk); }
    &[aria-pressed='true'] { border-color: var(--color-sun); color: var(--color-sun); }
  }
  .slot {
    min-width: 0;
    text-align: center;
    padding: 12px 6px 10px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    color: var(--color-chalk);
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s var(--ease-spring);
    &:hover { border-color: var(--color-muted); }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      box-shadow: inset 0 -3px 0 var(--color-sun);
      & .font-mono { color: var(--color-sun); }
    }
    &.bad { border-color: var(--color-bad); }
  }
  .pick {
    font: 400 13px var(--font-mono);
    color: var(--color-soft);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    padding: 7px 0;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.2s var(--ease-spring);
    &:hover { border-color: var(--color-muted); }
    &:active { transform: scale(0.94); }
    &[aria-pressed='true'] { background: var(--color-sun); border-color: var(--color-sun); color: var(--color-bg); }
  }
  .row {
    display: grid;
    grid-template-columns: 2.5rem 1fr auto;
    gap: 2px 12px;
    align-items: baseline;
    padding: 10px 14px;
    border-top: 1px solid var(--color-line);
    &:first-child { border-top: 0; }
    & .when { grid-column: 3; grid-row: 1; }
    &.first .when { color: var(--color-sun); }
  }
  @media (min-width: 640px) {
    .row {
      grid-template-columns: 2.5rem 1.3fr 1.2fr 7rem;
      & .when { grid-column: auto; grid-row: auto; }
    }
  }
  .reveal { animation: reveal 0.35s var(--ease-spring); }
  @keyframes reveal {
    from { opacity: 0; transform: translateY(6px); }
  }
</style>
