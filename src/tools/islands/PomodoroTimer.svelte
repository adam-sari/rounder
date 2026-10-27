<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Dial from '@/tools/lib/timers/Dial.svelte';
  import { dayKey, elapsed, formatCountdown, formatHuman, idle, isRunning, pause, start, wholeOr0, type Clock } from '@/tools/lib/timers/clock';
  import { addToTally, advance, defaults, todays, type Phase, type PomodoroSettings, type Tally } from '@/tools/lib/timers/pomodoro';
  import { askToNotify, canNotify, chime, notify, unlockAudio, unlockOnInteraction } from '@/tools/lib/timers/alert';
  import { ticker, titleKeeper, wakeAt } from '@/tools/lib/timers/ticker';
  import { load, save } from '@/tools/lib/timers/store';

  const KEY = 'rounder:pomodoro';
  const names: Record<Phase, string> = { work: 'focus', short: 'short break', long: 'long break' };
  const tones: Record<Phase, string> = { work: 'var(--color-sun)', short: 'var(--color-ok)', long: 'var(--color-image)' };

  let settings = $state<PomodoroSettings>({ ...defaults });
  let phase = $state<Phase>('work');
  /** focus sessions finished in this round */
  let done = $state(0);
  let clock = $state<Clock>(idle());
  let task = $state('');
  let tally = $state<Tally | null>(null);
  let volume = $state(0.6);
  let notifyOn = $state(false);
  let notice = $state('');
  let now = $state(Date.now());
  let ready = $state(false);
  let keeper: ReturnType<typeof titleKeeper> | undefined;

  // number boxes can be empty mid-edit, so read lengths through a floor of one minute
  const minutes = (p: Phase) => Math.max(1, wholeOr0(settings[p]));
  const every = $derived(Math.min(12, Math.max(1, wholeOr0(settings.longEvery))));
  const duration = $derived(minutes(phase) * 60_000);
  const running = $derived(isRunning(clock));
  const remaining = $derived(duration - elapsed(clock, now));
  const today = $derived(todays(tally, dayKey(new Date(now))));
  const status = $derived(running ? 'running' : elapsed(clock, now) > 0 ? 'paused' : 'ready');

  onMount(() => {
    const saved = load(KEY, { settings: defaults, phase: 'work' as Phase, done: 0, clock: idle(), task: '', tally: null as Tally | null, volume: 0.6, notifyOn: false });
    settings = { ...defaults, ...saved.settings };
    if (saved.phase in names) phase = saved.phase;
    done = wholeOr0(saved.done);
    if (typeof saved.clock?.banked === 'number') clock = saved.clock;
    task = String(saved.task ?? '');
    tally = saved.tally;
    volume = Math.min(1, Math.max(0, Number(saved.volume) || 0));
    notifyOn = saved.notifyOn && canNotify() && Notification.permission === 'granted';
    now = Date.now();
    // a phase that ended while the page was closed still counts, just without a late chime
    if (running && remaining <= 0) complete(false);
    keeper = titleKeeper();
    ready = true;
    // a session that carried on through a reload can only chime once the page has been clicked or typed in
    const offUnlock = running ? unlockOnInteraction() : () => {};
    return () => {
      keeper?.restore();
      offUnlock();
    };
  });

  $effect(() => {
    if (ready) save(KEY, { settings: $state.snapshot(settings), phase, done, clock: $state.snapshot(clock), task, tally: $state.snapshot(tally), volume, notifyOn });
  });

  function check() {
    now = Date.now();
    if (running && remaining <= 0) complete(true);
  }

  function complete(alert: boolean) {
    const finished = phase;
    if (finished === 'work') tally = addToTally(tally, dayKey(new Date()), minutes('work'));
    const next = advance(finished, done, every);
    phase = next.phase;
    done = next.done;
    now = Date.now();
    // after a catch-up on reload, wait for the user rather than starting a phase out of the blue
    const auto = alert && (next.phase === 'work' ? settings.autoWork : settings.autoBreaks);
    clock = auto ? start(idle(), now) : idle();
    if (!alert) return;
    chime(volume, 'gentle');
    if (notifyOn) {
      const title = finished === 'work' ? 'Focus session done' : 'Break is over';
      notify(title, `${auto ? 'Started' : 'Up next'}: ${names[next.phase]} (${minutes(next.phase)} min)`);
    }
  }

  $effect(() => {
    if (running) return untrack(() => ticker(check));
  });

  // a one-off wake-up at the end, so the chime is on time in a background tab
  $effect(() => {
    if (clock.startedAt !== null) return wakeAt(clock.startedAt + duration - clock.banked, check);
  });

  const titleText = $derived(ready && status !== 'ready' ? `${formatCountdown(remaining)} ${names[phase]}` : null);
  $effect(() => keeper?.set(titleText));

  function toggle() {
    unlockAudio();
    now = Date.now();
    clock = running ? pause(clock, now) : start(clock, now);
  }

  function reset() {
    clock = idle();
    now = Date.now();
  }

  /** jump to the next phase; a skipped focus session doesn't go on today's tally */
  function skip() {
    const next = advance(phase, done, every);
    phase = next.phase;
    done = next.done;
    reset();
  }

  function choose(p: Phase) {
    phase = p;
    reset();
  }

  function startOver() {
    phase = 'work';
    done = 0;
    reset();
  }

  async function toggleNotify(e: Event) {
    const box = e.currentTarget as HTMLInputElement;
    const wanted = box.checked;
    notice = '';
    notifyOn = wanted && (await askToNotify());
    box.checked = notifyOn;
    if (wanted && !notifyOn) notice = canNotify() ? "Notifications are blocked for this site. You can allow them in your browser's site settings." : "This browser doesn't support notifications.";
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
    } else if (k === 'r') reset();
    else if (k === 's') skip();
  }

  const lengths: [Phase, string][] = [['work', 'focus'], ['short', 'short break'], ['long', 'long break']];
</script>

<svelte:window onkeydown={onKey} />

<div class="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
  <section class="stage grid content-center gap-5 rounded-2xl border border-line-2 px-4 py-8 sm:px-8" style:--glow={tones[phase]} aria-label="Pomodoro timer">
    <div class="seg mx-auto" role="group" aria-label="Phase">
      {#each ['work', 'short', 'long'] as const as p}
        <button type="button" aria-pressed={phase === p} onclick={() => choose(p)}>{names[p]}</button>
      {/each}
    </div>

    <Dial fraction={remaining / duration} time={formatCountdown(remaining)} caption={task.trim() || names[phase]} tone={tones[phase]}>
      <span class="mono">{task.trim() ? `${names[phase]} · ` : ''}{status}</span>
    </Dial>

    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary min-w-[128px]" onclick={toggle}>{running ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}</button>
      <button type="button" class="btn" onclick={reset} disabled={status === 'ready'}>Reset</button>
      <button type="button" class="btn" onclick={skip}>Skip</button>
    </div>

    <div class="grid justify-items-center gap-2">
      <div class="flex flex-wrap justify-center gap-1.5" role="img" aria-label={`${done} of ${every} focus sessions done before the long break`}>
        {#each Array.from({ length: every }, (_, i) => i) as i}
          <span class="pip" class:lit={i < done}></span>
        {/each}
      </div>
      <p class="mono text-center">
        <span class="text-chalk">{today.sessions}</span> {today.sessions === 1 ? 'session' : 'sessions'} today{#if today.minutes} · {formatHuman(today.minutes * 60_000)} of focus{/if}
      </p>
    </div>

    <p class="mono text-center"><kbd>space</kbd> start / pause · <kbd>r</kbd> reset · <kbd>s</kbd> skip</p>
  </section>

  <div class="grid content-start gap-5">
    <label>
      <span class="label">what are you working on? (optional)</span>
      <input class="field" maxlength="80" placeholder="e.g. Write the project brief" bind:value={task} />
    </label>

    <fieldset class="grid gap-3">
      <legend class="label">lengths in minutes</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each lengths as [k, name]}
          <label>
            <input class="field text-center" type="number" inputmode="numeric" min="1" max="600" bind:value={settings[k]} />
            <span class="mono mt-1 block text-center">{name}</span>
          </label>
        {/each}
        <label>
          <input class="field text-center" type="number" inputmode="numeric" min="1" max="12" bind:value={settings.longEvery} />
          <span class="mono mt-1 block text-center">long break every</span>
        </label>
      </div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={settings.autoBreaks} class="accent-(--color-sun)" /> Start breaks automatically</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={settings.autoWork} class="accent-(--color-sun)" /> Start focus sessions automatically</label>
    </fieldset>

    <div class="grid gap-3 border-t border-line pt-5">
      <div class="flex items-end gap-3">
        <label class="grow">
          <span class="label">chime volume · {Math.round(volume * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={volume} class="w-full accent-(--color-sun)" />
        </label>
        <button type="button" class="btn px-3! py-2!" onclick={() => chime(volume, 'gentle')}>Test</button>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notifyOn} onchange={toggleNotify} class="accent-(--color-sun)" />
        Also show a desktop notification
      </label>
      {#if notice}<p class="text-bad text-sm" role="alert">{notice}</p>{/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="mono">Settings and today's count stay in this browser.</p>
        <button type="button" class="mono hover:text-chalk" onclick={startOver} disabled={!done && phase === 'work' && status === 'ready'}>start a new round</button>
      </div>
    </div>
  </div>
</div>

<style>
  .stage {
    background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--glow) 9%, transparent), transparent 62%);
  }
  kbd {
    font: inherit;
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .pip {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid var(--color-line-2);
    transition: background 0.4s, border-color 0.4s, transform 0.4s var(--ease-spring);
  }
  .pip.lit {
    background: var(--color-sun);
    border-color: var(--color-sun);
    transform: scale(1.15);
  }
  button.mono:disabled {
    opacity: 0.4;
  }
</style>
