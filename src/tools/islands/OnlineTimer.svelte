<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Dial from '@/tools/lib/timers/Dial.svelte';
  import { elapsed, formatClock, formatCountdown, formatHuman, idle, isRunning, pause, split, start, toMs, wholeOr0, type Clock } from '@/tools/lib/timers/clock';
  import { askToNotify, canNotify, chime, notify, unlockAudio, unlockOnInteraction } from '@/tools/lib/timers/alert';
  import { ticker, titleKeeper, wakeAt } from '@/tools/lib/timers/ticker';
  import { load, save } from '@/tools/lib/timers/store';

  interface Timer {
    id: number;
    name: string;
    duration: number;
    clock: Clock;
    /** reached zero on this run; the clock keeps going to show the overtime */
    done: boolean;
  }

  const KEY = 'rounder:online-timer';
  const MIN = 60_000;
  const presets = [1, 5, 10, 15, 25, 30, 60];

  let nextId = 1;
  const make = (duration: number): Timer => ({ id: nextId++, name: '', duration, clock: idle(), done: false });

  let timers = $state<Timer[]>([make(5 * MIN)]);
  let selectedId = $state(1);
  let now = $state(Date.now());
  let volume = $state(0.7);
  let notifyOn = $state(false);
  let notice = $state('');
  /** the timer whose alarm is sounding */
  let ringing = $state<number | null>(null);
  /** what the h/m/s boxes hold; null while a box is empty */
  let parts = $state<Record<'h' | 'm' | 's', number | null>>({ h: 0, m: 5, s: 0 });
  let ready = $state(false);
  let canFull = $state(false);
  let full = $state(false);
  let stage = $state<HTMLElement>();
  let keeper: ReturnType<typeof titleKeeper> | undefined;

  const sel = $derived(timers.find((t) => t.id === selectedId) ?? timers[0]);
  const remaining = (t: Timer) => t.duration - elapsed(t.clock, now);
  const label = (t: Timer) => t.name.trim() || `${formatHuman(t.duration)} timer`;
  const status = (t: Timer) => (t.done ? 'done' : isRunning(t.clock) ? 'running' : elapsed(t.clock, now) > 0 ? 'paused' : 'ready');
  const draftMs = () => toMs({ h: wholeOr0(parts.h), m: wholeOr0(parts.m), s: wholeOr0(parts.s) });

  const selStatus = $derived(status(sel));
  const fraction = $derived(sel.done || !sel.duration ? 0 : remaining(sel) / sel.duration);
  const endsAt = $derived(
    selStatus === 'running' ? new Date(now + remaining(sel)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
  );

  onMount(() => {
    const saved = load(KEY, { timers: [] as Timer[], selectedId: 0, volume: 0.7, notifyOn: false });
    const valid = Array.isArray(saved.timers) ? saved.timers.filter((t) => typeof t?.id === 'number' && typeof t.name === 'string' && typeof t.duration === 'number' && typeof t.clock?.banked === 'number') : [];
    if (valid.length) {
      const t0 = Date.now();
      // anything that ran out while the page was closed is shown as done, without a late alarm
      for (const t of valid) if (isRunning(t.clock) && t.duration - elapsed(t.clock, t0) <= 0) t.done = true;
      timers = valid;
      nextId = Math.max(...valid.map((t) => t.id)) + 1;
      selectedId = valid.some((t) => t.id === saved.selectedId) ? saved.selectedId : valid[0].id;
    }
    volume = Math.min(1, Math.max(0, Number(saved.volume) || 0));
    notifyOn = saved.notifyOn && canNotify() && Notification.permission === 'granted';
    canFull = document.fullscreenEnabled;
    keeper = titleKeeper();
    ready = true;

    const onFull = () => (full = !!stage && document.fullscreenElement === stage);
    document.addEventListener('fullscreenchange', onFull);
    // a timer that carried on through a reload can only chime once the page has been clicked or typed in
    const offUnlock = valid.some((t) => isRunning(t.clock) && !t.done) ? unlockOnInteraction() : () => {};
    return () => {
      keeper?.restore();
      offUnlock();
      document.removeEventListener('fullscreenchange', onFull);
    };
  });

  $effect(() => {
    if (ready) save(KEY, { timers: $state.snapshot(timers), selectedId, volume, notifyOn });
  });

  // keep the h/m/s boxes in step with the selected timer, without fighting the user mid-typing
  $effect.pre(() => {
    const d = sel.duration;
    if (untrack(draftMs) !== d) tidy();
  });

  function tidy() {
    const { h, m, s } = split(sel.duration);
    parts = { h, m, s };
  }

  function check() {
    now = Date.now();
    for (const t of timers) {
      if (!t.done && isRunning(t.clock) && remaining(t) <= 0) finish(t);
    }
  }

  function finish(t: Timer) {
    t.done = true;
    selectedId = t.id;
    ringing = t.id;
    if (notifyOn) notify(`${label(t)} is done`, "Time's up!");
  }

  // smooth display while anything runs; reads timestamps, so throttled background tabs stay exact
  $effect(() => {
    if (!timers.some((t) => isRunning(t.clock))) return;
    return untrack(() => ticker(check));
  });

  // a one-off wake-up at the next finish, so the alarm is on time even in a background tab
  $effect(() => {
    const ends = timers.filter((t) => !t.done && isRunning(t.clock)).map((t) => t.clock.startedAt! + t.duration - t.clock.banked);
    if (ends.length) return wakeAt(Math.min(...ends), check);
  });

  // ring a few times, then go quiet; the dial keeps pulsing until dismissed
  $effect(() => {
    if (ringing === null) return;
    let count = 0;
    const ring = () => {
      chime(untrack(() => volume));
      if (++count >= 6) clearInterval(timer);
    };
    const timer = setInterval(ring, 2600);
    ring();
    return () => clearInterval(timer);
  });

  const titleText = $derived.by(() => {
    if (!ready) return null;
    if (ringing !== null) return "Time's up!";
    const t = isRunning(sel.clock) && !sel.done ? sel : timers.find((x) => isRunning(x.clock) && !x.done);
    return t ? formatCountdown(remaining(t)) : null;
  });
  $effect(() => keeper?.set(titleText));

  function silence(t: Timer) {
    if (ringing === t.id) ringing = null;
  }

  function toggle(t: Timer) {
    unlockAudio();
    const at = Date.now();
    now = at;
    if (ringing === t.id) return silence(t);
    if (t.done) return restart(t, t.duration);
    t.clock = isRunning(t.clock) ? pause(t.clock, at) : start(t.clock, at);
  }

  function restart(t: Timer, duration: number) {
    unlockAudio();
    silence(t);
    now = Date.now();
    t.duration = duration;
    t.clock = start(idle(), now);
    t.done = false;
  }

  function reset(t: Timer) {
    silence(t);
    t.clock = idle();
    t.done = false;
  }

  function addMinute(t: Timer) {
    silence(t);
    // once it has run out, the extra minute counts from now rather than from zero
    t.duration = Math.max(t.duration, elapsed(t.clock, now)) + MIN;
    t.done = false;
  }

  function edit(k: keyof typeof parts, e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    parts[k] = Number.isFinite(v) ? v : null;
    sel.duration = draftMs();
    reset(sel);
  }

  function addTimer() {
    const t = make(5 * MIN);
    timers.push(t);
    selectedId = t.id;
  }

  function remove(t: Timer) {
    silence(t);
    timers = timers.filter((x) => x.id !== t.id);
    if (!timers.length) timers.push(make(5 * MIN));
    if (selectedId === t.id) selectedId = timers[0].id;
  }

  async function toggleNotify(e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    notice = '';
    const wanted = box.checked;
    notifyOn = wanted && (await askToNotify());
    box.checked = notifyOn;
    if (wanted && !notifyOn) notice = canNotify() ? "Notifications are blocked for this site. You can allow them in your browser's site settings." : "This browser doesn't support notifications.";
  }

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage?.requestFullscreen().catch(() => {});
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      // a focused button already reacts to space by itself
      if (el.closest('button, a, summary')) return;
      e.preventDefault();
      if (sel.duration) toggle(sel);
    } else if (k === 'r') reset(sel);
    else if (k === 'f' && canFull) toggleFull();
  }

  const primaryLabel = $derived(
    ringing === sel.id ? 'Stop alarm' : sel.done ? 'Restart' : selStatus === 'running' ? 'Pause' : selStatus === 'paused' ? 'Resume' : 'Start',
  );
</script>

<svelte:window onkeydown={onKey} />

<div class="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
  <section bind:this={stage} class="stage grid content-center gap-6 rounded-2xl border border-line-2 px-4 py-8 sm:px-8" class:full aria-label="Timer">
    <Dial
      {fraction}
      time={formatCountdown(remaining(sel))}
      caption={label(sel)}
      ringing={sel.done}
    >
      {#if sel.done}
        <span class="text-sun">time's up · +{formatClock(-remaining(sel))}</span>
      {:else if endsAt}
        <span class="mono">ends at {endsAt}</span>
      {:else}
        <span class="mono">{selStatus}</span>
      {/if}
    </Dial>

    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary min-w-[128px]" disabled={!sel.duration} onclick={() => toggle(sel)}>{primaryLabel}</button>
      <button type="button" class="btn" onclick={() => reset(sel)} disabled={selStatus === 'ready'}>Reset</button>
      <button type="button" class="btn" onclick={() => addMinute(sel)}>+1 min</button>
      {#if canFull}
        <button type="button" class="btn" onclick={toggleFull} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} title={full ? 'Exit fullscreen' : 'Fullscreen'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            {#if full}<path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" />{:else}<path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />{/if}
          </svg>
        </button>
      {/if}
    </div>

    <p class="keys mono text-center">
      <kbd>space</kbd> start / pause · <kbd>r</kbd> reset{#if canFull} · <kbd>f</kbd> fullscreen{/if}
    </p>
  </section>

  <div class="grid content-start gap-6">
    <fieldset class="grid gap-3">
      <legend class="label">set the time</legend>
      <div class="grid grid-cols-3 gap-2">
        {#each [['h', 'hours', 99], ['m', 'minutes', 59], ['s', 'seconds', 59]] as const as [k, name, max]}
          <label>
            <input
              class="field text-center font-serif text-3xl! leading-none!"
              type="number"
              inputmode="numeric"
              min="0"
              {max}
              aria-label={name}
              value={parts[k] ?? ''}
              oninput={(e) => edit(k, e)}
              onchange={tidy}
              disabled={selStatus === 'running'}
            />
            <span class="mono mt-1 block text-center">{name}</span>
          </label>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Quick start">
        {#each presets as m}
          <button type="button" aria-pressed={sel.duration === m * MIN} onclick={() => restart(sel, m * MIN)}>{m === 60 ? '1 h' : `${m} min`}</button>
        {/each}
      </div>
      <label>
        <span class="label">name (optional)</span>
        <input class="field" maxlength="60" placeholder={`${formatHuman(sel.duration)} timer`} bind:value={sel.name} />
      </label>
    </fieldset>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <span class="label mb-0!">timers</span>
        <button type="button" class="mono hover:text-chalk" onclick={addTimer}>+ add timer</button>
      </div>
      <ul class="grid gap-1.5">
        {#each timers as t (t.id)}
          {@const st = status(t)}
          <li class="row" class:on={t.id === sel.id} class:done={t.done}>
            <button type="button" class="pick" onclick={() => (selectedId = t.id)} aria-current={t.id === sel.id}>
              <span class="truncate">{label(t)}</span>
              <span class="mono shrink-0">{st === 'done' ? 'done' : formatCountdown(remaining(t))}</span>
            </button>
            <button type="button" class="icon" disabled={!t.duration} onclick={() => toggle(t)} aria-label={`${st === 'running' ? 'Pause' : 'Start'} ${label(t)}`}>
              {#if st === 'running' && ringing !== t.id}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
              {/if}
            </button>
            <button type="button" class="icon" onclick={() => remove(t)} aria-label={`Remove ${label(t)}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.5" /></svg>
            </button>
          </li>
        {/each}
      </ul>
    </div>

    <div class="grid gap-3 border-t border-line pt-5">
      <div class="flex items-end gap-3">
        <label class="grow">
          <span class="label">chime volume · {Math.round(volume * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={volume} class="w-full accent-(--color-sun)" />
        </label>
        <button type="button" class="btn px-3! py-2!" onclick={() => chime(volume)}>Test</button>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notifyOn} onchange={toggleNotify} class="accent-(--color-sun)" />
        Also show a desktop notification
      </label>
      {#if notice}<p class="text-bad text-sm" role="alert">{notice}</p>{/if}
      <p class="mono">Keeps time while this tab is in the background. Timers are saved in this browser, so a reload won't lose them.</p>
    </div>
  </div>
</div>

<style>
  .stage {
    background: radial-gradient(circle at 50% 40%, var(--color-panel-2), transparent 70%);
  }
  .stage.full {
    background: var(--color-bg);
    border: 0;
    border-radius: 0;
    --dial: min(74vh, 92vw);
  }
  kbd {
    font: inherit;
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    padding-right: 4px;
    transition: border-color 0.2s;
  }
  .row.on {
    border-color: var(--color-sun);
  }
  .row.done .mono {
    color: var(--color-sun);
  }
  .pick {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    text-align: left;
    font-size: 14px;
    border-radius: 11px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--color-muted);
  }
  .icon:hover:not(:disabled) {
    color: var(--color-chalk);
    background: var(--color-panel-2);
  }
  .icon:disabled {
    opacity: 0.4;
  }
  input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
    padding-inline: 4px;
  }
  input[type='number']::-webkit-inner-spin-button {
    display: none;
  }
</style>
