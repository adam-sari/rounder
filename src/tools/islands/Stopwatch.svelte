<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dial from '@/tools/lib/timers/Dial.svelte';
  import { elapsed, formatClock, idle, isRunning, lapStats, lapsCsv, pause, split, start, type Clock } from '@/tools/lib/timers/clock';
  import { ticker, titleKeeper } from '@/tools/lib/timers/ticker';
  import { load, save } from '@/tools/lib/timers/store';
  import { downloadBlob } from '@/tools/lib/files';

  const KEY = 'rounder:stopwatch';

  let clock = $state<Clock>(idle());
  /** total elapsed time at each press of Lap */
  let splits = $state<number[]>([]);
  let now = $state(Date.now());
  let ready = $state(false);
  let keeper: ReturnType<typeof titleKeeper> | undefined;

  const running = $derived(isRunning(clock));
  const total = $derived(elapsed(clock, now));
  const stats = $derived(lapStats(splits));
  const current = $derived(total - (splits.at(-1) ?? 0));
  const shown = $derived(formatClock(total, { centis: true }));
  const cs = $derived(String(split(total).cs).padStart(2, '0'));

  onMount(() => {
    const saved = load(KEY, { clock: idle(), splits: [] as number[] });
    if (typeof saved.clock?.banked === 'number') clock = saved.clock;
    if (Array.isArray(saved.splits)) splits = saved.splits.filter((n) => typeof n === 'number');
    now = Date.now();
    keeper = titleKeeper();
    ready = true;
    return () => keeper?.restore();
  });

  $effect(() => {
    if (ready) save(KEY, { clock: $state.snapshot(clock), splits: $state.snapshot(splits) });
  });

  $effect(() => {
    if (running) return untrack(() => ticker(() => (now = Date.now())));
  });

  const titleText = $derived(ready && running ? formatClock(total) : null);
  $effect(() => keeper?.set(titleText));

  function toggle() {
    now = Date.now();
    clock = running ? pause(clock, now) : start(clock, now);
  }

  function lap() {
    if (!running) return;
    now = Date.now();
    splits.push(elapsed(clock, now));
  }

  function reset() {
    clock = idle();
    splits = [];
    now = Date.now();
  }

  function exportCsv() {
    downloadBlob(new Blob([lapsCsv(splits)], { type: 'text/csv' }), 'stopwatch-laps.csv');
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      if (el.closest('button, a, summary')) return;
      e.preventDefault();
      toggle();
    } else if (k === 'l' || k === 'enter') {
      if (k === 'enter' && el.closest('button, a, summary')) return;
      lap();
    } else if (k === 'r' && !running) reset();
  }

  // newest first, as on a phone stopwatch
  const rows = $derived(stats.laps.map((t, i) => ({ n: i + 1, t, total: splits[i], i })).reverse());
</script>

<svelte:window onkeydown={onKey} />

<div class="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
  <section class="stage grid content-center gap-6 rounded-2xl border border-line-2 px-4 py-8 sm:px-8" aria-label="Stopwatch">
    <Dial fraction={(total % 60_000) / 60_000} time={shown.slice(0, -3)} tail={`.${cs}`} caption={splits.length ? `lap ${splits.length + 1}` : 'stopwatch'}>
      {#if splits.length}
        <span class="mono">this lap {formatClock(current, { centis: true })}</span>
      {:else}
        <span class="mono">{running ? 'running' : total ? 'stopped' : 'ready'}</span>
      {/if}
    </Dial>

    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary min-w-[128px]" onclick={toggle}>{running ? 'Stop' : total ? 'Resume' : 'Start'}</button>
      <button type="button" class="btn" onclick={lap} disabled={!running}>Lap</button>
      <button type="button" class="btn" onclick={reset} disabled={running || !total}>Reset</button>
    </div>

    <p class="keys mono text-center"><kbd>space</kbd> start / stop · <kbd>L</kbd> lap · <kbd>r</kbd> reset</p>
  </section>

  <div class="grid content-start gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="label mb-0!">laps{splits.length ? ` · ${splits.length}` : ''}</span>
      {#if splits.length}
        <div class="flex gap-2">
          <CopyButton text={() => lapsCsv(splits)} label="Copy" class="px-3! py-2! text-sm!" />
          <button type="button" class="btn px-3! py-2! text-sm!" onclick={exportCsv}>Export CSV</button>
        </div>
      {/if}
    </div>

    {#if splits.length}
      <div class="max-h-[420px] overflow-auto rounded-xl border border-line-2">
        <table class="w-full text-sm">
          <thead class="mono sticky top-0 bg-panel">
            <tr><th scope="col">lap</th><th scope="col">lap time</th><th scope="col">total</th></tr>
          </thead>
          <tbody>
            <tr class="live">
              <td>{splits.length + 1}</td>
              <td>{formatClock(current, { centis: true })}</td>
              <td>{shown}</td>
            </tr>
            {#each rows as r (r.n)}
              <tr class="lap" class:fast={r.i === stats.fastest} class:slow={r.i === stats.slowest}>
                <td>
                  {r.n}
                  {#if r.i === stats.fastest}<span class="tag">fastest</span>{:else if r.i === stats.slowest}<span class="tag">slowest</span>{/if}
                </td>
                <td>{formatClock(r.t, { centis: true })}</td>
                <td>{formatClock(r.total, { centis: true })}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty grid place-items-center gap-2 rounded-xl px-6 py-12 text-center">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="18" cy="20" r="12" /><path d="M18 20V13M15 4h6M18 4v4M28 9l2-2" stroke-linecap="round" />
        </svg>
        <p class="text-soft text-sm">Laps show up here. Press Lap or <kbd>L</kbd> while it runs.</p>
        <p class="mono">fastest and slowest get highlighted</p>
      </div>
    {/if}

    <p class="mono">Times come from the system clock, so it stays exact in a background tab. Your laps are saved in this browser until you reset.</p>
  </div>
</div>

<style>
  .stage {
    background: radial-gradient(circle at 50% 40%, var(--color-panel-2), transparent 70%);
  }
  kbd {
    font: 12px var(--font-mono);
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-radius: 6px;
    padding: 1px 6px;
  }
  th,
  td {
    padding: 9px 14px;
    text-align: right;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  th {
    font-weight: 400;
    border-bottom: 1px solid var(--color-line-2);
  }
  td {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--color-line);
  }
  .live td {
    color: var(--color-muted);
  }
  .lap {
    animation: drop 0.35s var(--ease-spring);
  }
  .fast td {
    color: var(--color-ok);
  }
  .slow td {
    color: var(--color-bad);
  }
  .tag {
    margin-left: 6px;
    font-size: 11px;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0 6px;
  }
  .empty {
    border: 1.5px dashed var(--color-line-2);
    color: var(--color-muted);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
</style>
