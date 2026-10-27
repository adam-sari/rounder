<script lang="ts">
  import { onMount } from 'svelte';
  import { load, save } from '@/tools/lib/timers/store';
  import { createMetronome, type Metronome, type Voice } from '@/tools/lib/metronome/engine';
  import {
    BEATS_MAX, BPM_MAX, BPM_MIN, SIGNATURES, TAP_RESET_MS, UNITS, clampBpm, defaultAccents, parseSignature,
    subdivisionName, tapTempo, tempoName, trainerBpm, type Level, type Meter, type Pos, type Trainer,
  } from '@/tools/lib/metronome/rhythm';

  const KEY = 'rounder:metronome';
  const VOICES: [Voice, string][] = [['click', 'Click'], ['wood', 'Wood block'], ['beep', 'Beep']];
  const LEVEL_NAMES = ['silent', 'normal', 'medium accent', 'strong accent'];

  let bpm = $state(120);
  let sig = $state<string>('4/4');
  let custom = $state<Meter>({ beats: 4, unit: 4 });
  let accents = $state<Level[]>(defaultAccents({ beats: 4, unit: 4 }));
  let subs = $state(1);
  let voice = $state<Voice>('click');
  let volume = $state(0.8);
  let trainer = $state<Trainer>({ on: false, step: 5, every: 4, target: 160 });
  /** the bar the trainer counts from, so switching it on mid-run doesn't jump the tempo */
  let trainerFrom = $state(0);

  let running = $state(false);
  /** the beat last heard, for the display */
  let heard = $state<Pos | null>(null);
  let taps = $state<number[]>([]);
  let ready = $state(false);
  let reduced = false;
  let circle = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let metro: Metronome | undefined;

  const meter = $derived(sig === 'custom' ? custom : parseSignature(sig));
  const live = $derived(running && heard ? trainerBpm(bpm, heard.bar - trainerFrom, trainer) : bpm);
  const accentFirst = $derived(accents[0] === 3);
  const tapped = $derived(tapTempo(taps));
  const trainerNote = $derived.by(() => {
    if (!trainer.on) return '';
    if (!running || !heard) return `Starts at ${bpm} and adds ${trainer.step} BPM every ${trainer.every === 1 ? 'bar' : `${trainer.every} bars`} up to ${Math.max(bpm, trainer.target)}.`;
    if (live >= trainer.target || live === BPM_MAX) return `Bar ${heard.bar + 1} · holding at ${live} BPM`;
    const left = trainer.every - ((heard.bar - trainerFrom) % trainer.every);
    return `Bar ${heard.bar + 1} · +${trainer.step} BPM in ${left} ${left === 1 ? 'bar' : 'bars'}`;
  });

  onMount(() => {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = load(KEY, { bpm, sig, custom, accents: [] as Level[], subs, voice, volume, trainer });
    bpm = clampBpm(s.bpm);
    if (s.sig === 'custom' || SIGNATURES.includes(s.sig as never)) sig = s.sig;
    if (Number.isInteger(s.custom?.beats) && UNITS.includes(s.custom?.unit as never)) custom = { beats: Math.min(BEATS_MAX, Math.max(1, s.custom.beats)), unit: s.custom.unit };
    const m = sig === 'custom' ? custom : parseSignature(sig);
    accents = Array.isArray(s.accents) && s.accents.length === m.beats && s.accents.every((l) => [0, 1, 2, 3].includes(l)) ? s.accents : defaultAccents(m);
    if ([1, 2, 3, 4].includes(s.subs)) subs = s.subs;
    if (VOICES.some(([v]) => v === s.voice)) voice = s.voice;
    volume = Math.min(1, Math.max(0, Number(s.volume) || 0));
    const t: Partial<Trainer> = s.trainer ?? {};
    trainer = { on: t.on === true, step: int(t.step, 1, 50, 5), every: int(t.every, 1, 64, 4), target: clampBpm(t.target ?? 160) };
    // the scheduler reads these on every tick, so changes land on the very next click
    metro = createMetronome({
      pattern: (pos) => ({ bpm: trainerBpm(bpm, pos.bar - trainerFrom, trainer), accents, subs }),
      voice: () => voice,
      volume: () => volume,
    });
    ready = true;
    return () => metro?.close();
  });

  $effect(() => {
    if (ready) save(KEY, { bpm, sig, custom: $state.snapshot(custom), accents: $state.snapshot(accents), subs, voice, volume, trainer: $state.snapshot(trainer) });
  });

  function toggle() {
    if (!metro) return;
    if (running) {
      metro.stop();
      heard = null;
    } else {
      trainerFrom = 0;
      metro.start();
    }
    running = metro.running;
  }

  // follow the clicks the listener actually hears
  $effect(() => {
    if (!running) return;
    let frame = 0;
    const loop = () => {
      const t = metro?.heard();
      if (t && t.sub === 0) {
        heard = { bar: t.bar, beat: t.beat, sub: 0 };
        if (t.sound) pulse(t.sound === 'accent' ? 'var(--color-sun)' : t.sound === 'medium' ? 'color-mix(in srgb, var(--color-sun) 55%, var(--color-chalk))' : 'var(--color-chalk)');
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  });

  function pulse(color: string) {
    if (!circle) return;
    const beatMs = 60_000 / live;
    const fade = { duration: Math.min(320, beatMs * 0.85), easing: 'cubic-bezier(.2,.7,.3,1)' };
    circle.style.setProperty('--flash', color);
    circle.querySelector('.glow')?.animate([{ opacity: 1 }, { opacity: 0 }], fade);
    if (!reduced) circle.querySelector('.disc')?.animate([{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], fade);
  }

  const int = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

  function setBpm(v: number) {
    bpm = clampBpm(v);
  }

  function setMeter(next: string) {
    sig = next;
    accents = defaultAccents(next === 'custom' ? custom : parseSignature(next), accentFirst);
  }

  function setCustom(beats: number, unit: number) {
    custom = { beats: Math.min(BEATS_MAX, Math.max(1, Math.round(beats) || 1)), unit };
    accents = defaultAccents(custom, accentFirst);
  }

  function cycle(i: number) {
    accents[i] = ((accents[i] + 3) % 4) as Level;
  }

  function tap() {
    const now = performance.now();
    const last = taps.at(-1);
    taps = last !== undefined && now - last < TAP_RESET_MS ? [...taps.slice(-8), now] : [now];
    const t = tapTempo(taps);
    if (t) bpm = t;
  }

  function pickVoice(v: Voice) {
    voice = v;
    if (!running) metro?.preview(v);
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]')) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 5, ArrowDown: -5 }[e.key];
    // arrows scroll the page as usual unless the metronome is playing or being used
    if (step && (running || root?.contains(el))) {
      e.preventDefault();
      setBpm(bpm + step);
    } else if (e.key === ' ' && !e.repeat) {
      // a focused button already reacts to space by itself
      if (el.closest('button, a, summary')) return;
      e.preventDefault();
      toggle();
    } else if (e.key.toLowerCase() === 't' && !e.repeat) tap();
  }
</script>

<svelte:window onkeydown={onKey} />

<div bind:this={root} class="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
  <section class="stage grid content-center justify-items-center gap-5 rounded-2xl border border-line-2 px-4 py-8 sm:px-8" aria-label="Metronome">
    <div bind:this={circle} class="pulse" class:on={running} aria-hidden="true">
      <div class="glow"></div>
      <div class="disc">
        <span class="beat font-serif">{running && heard ? heard.beat + 1 : meter.beats}</span>
        <span class="mono">{running && heard ? `of ${meter.beats}` : `${meter.beats}/${meter.unit}`}</span>
      </div>
    </div>

    <div class="flex flex-wrap items-end justify-center gap-1.5" role="group" aria-label="Beats in the bar. Click a beat to change its accent.">
      {#each accents as level, i}
        <button
          type="button"
          class="bar"
          class:now={running && heard?.beat === i}
          style:--h="{[0.18, 0.45, 0.7, 1][level]}"
          onclick={() => cycle(i)}
          aria-label={`Beat ${i + 1}: ${LEVEL_NAMES[level]}`}
          title="Click to change the accent"
        ><span></span></button>
      {/each}
    </div>

    <div class="grid w-full max-w-sm justify-items-center gap-1">
      <div class="flex items-center gap-3">
        <button type="button" class="btn round" onclick={() => setBpm(bpm - 1)} aria-label="Slower by 1 BPM" disabled={bpm <= BPM_MIN}>−</button>
        <label class="grid justify-items-center">
          <span class="sr-only">Tempo in beats per minute</span>
          <input
            class="bpm font-serif"
            type="number"
            inputmode="numeric"
            min={BPM_MIN}
            max={BPM_MAX}
            value={bpm}
            onchange={(e) => {
              setBpm(e.currentTarget.valueAsNumber);
              e.currentTarget.value = String(bpm);
            }}
          />
          <span class="mono -mt-1">BPM · {tempoName(live)}</span>
        </label>
        <button type="button" class="btn round" onclick={() => setBpm(bpm + 1)} aria-label="Faster by 1 BPM" disabled={bpm >= BPM_MAX}>+</button>
      </div>
      <input type="range" class="mt-3 w-full accent-(--color-sun)" min={BPM_MIN} max={BPM_MAX} bind:value={bpm} aria-label="Tempo slider" />
      {#if trainer.on && running && live !== bpm}
        <p class="mono text-sun" aria-live="polite">now {live} BPM</p>
      {/if}
    </div>

    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn btn-primary min-w-[140px]" onclick={toggle} aria-pressed={running}>
        {#if running}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2h8v8H2z" fill="currentColor" /></svg> Stop
        {:else}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg> Start
        {/if}
      </button>
      <button type="button" class="btn min-w-[110px]" onclick={tap}>
        Tap{#if taps.length > 1 && tapped}<span class="mono">· {tapped}</span>{/if}
      </button>
    </div>

    <p class="keys mono text-center">
      <kbd>space</kbd> start / stop · <kbd>←</kbd><kbd>→</kbd> ±1 · <kbd>↑</kbd><kbd>↓</kbd> ±5 · <kbd>t</kbd> tap
    </p>
  </section>

  <div class="grid content-start gap-5">
    <div>
      <span class="label">time signature</span>
      <div class="seg" role="group" aria-label="Time signature">
        {#each SIGNATURES as s}
          <button type="button" aria-pressed={sig === s} onclick={() => setMeter(s)}>{s}</button>
        {/each}
        <button type="button" aria-pressed={sig === 'custom'} onclick={() => setMeter('custom')}>custom</button>
      </div>
      {#if sig === 'custom'}
        <div class="mt-3 flex items-end gap-2">
          <label class="w-24">
            <span class="label">beats</span>
            <input class="field" type="number" min="1" max={BEATS_MAX} value={custom.beats} onchange={(e) => {
                setCustom(e.currentTarget.valueAsNumber, custom.unit);
                e.currentTarget.value = String(custom.beats);
              }} />
          </label>
          <span class="pb-3 font-serif text-2xl text-muted">/</span>
          <label class="w-24">
            <span class="label">note value</span>
            <select class="field" value={custom.unit} onchange={(e) => setCustom(custom.beats, Number(e.currentTarget.value))}>
              {#each UNITS as u}<option value={u}>{u}</option>{/each}
            </select>
          </label>
        </div>
      {/if}
      <label class="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" class="accent-(--color-sun)" checked={accentFirst} onchange={(e) => (accents[0] = e.currentTarget.checked ? 3 : 1)} />
        Accent the first beat
      </label>
    </div>

    <div>
      <span class="label">subdivision</span>
      <div class="seg" role="group" aria-label="Subdivision">
        {#each [1, 2, 3, 4] as n}
          <button type="button" aria-pressed={subs === n} onclick={() => (subs = n)}>{subdivisionName(meter.unit, n)}</button>
        {/each}
      </div>
    </div>

    <div>
      <span class="label">sound</span>
      <div class="seg" role="group" aria-label="Sound">
        {#each VOICES as [v, name]}
          <button type="button" aria-pressed={voice === v} onclick={() => pickVoice(v)}>{name}</button>
        {/each}
      </div>
      <label class="mt-3 block">
        <span class="label">volume · {Math.round(volume * 100)}%</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={volume} class="w-full accent-(--color-sun)" />
      </label>
    </div>

    <fieldset class="grid gap-3 border-t border-line pt-5">
      <label class="flex items-center gap-2">
        <input type="checkbox" class="accent-(--color-sun)" bind:checked={trainer.on} onchange={() => running && (trainerFrom = (heard?.bar ?? 0) + 1)} />
        <span>Tempo trainer</span>
      </label>
      <div class="flex flex-wrap items-center gap-2 text-sm text-soft" class:dim={!trainer.on}>
        <span>Add</span>
        <input class="field small" type="number" min="1" max="50" aria-label="BPM to add" value={trainer.step} disabled={!trainer.on} onchange={(e) => (e.currentTarget.value = String((trainer.step = int(e.currentTarget.valueAsNumber, 1, 50, trainer.step))))} />
        <span>BPM every</span>
        <input class="field small" type="number" min="1" max="64" aria-label="Bars between steps" value={trainer.every} disabled={!trainer.on} onchange={(e) => (e.currentTarget.value = String((trainer.every = int(e.currentTarget.valueAsNumber, 1, 64, trainer.every))))} />
        <span>bars, up to</span>
        <input class="field small w-[4.5rem]!" type="number" min={BPM_MIN} max={BPM_MAX} aria-label="Target BPM" value={trainer.target} disabled={!trainer.on} onchange={(e) => (e.currentTarget.value = String((trainer.target = clampBpm(e.currentTarget.valueAsNumber))))} />
      </div>
      {#if trainerNote}<p class="mono">{trainerNote}</p>{/if}
    </fieldset>

    <p class="mono border-t border-line pt-5">
      Clicks are timed on your device's audio clock, so they stay steady even if the page is busy or in a background tab. Your settings are remembered in this browser.
    </p>
  </div>
</div>

<style>
  .stage {
    background: radial-gradient(circle at 50% 35%, var(--color-panel-2), transparent 70%);
  }
  .pulse {
    --flash: var(--color-sun);
    position: relative;
    width: clamp(180px, 46vw, 250px);
    aspect-ratio: 1;
  }
  .disc,
  .glow {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }
  .disc {
    display: grid;
    place-content: center;
    justify-items: center;
    border: 1px solid var(--color-line-2);
    background: radial-gradient(circle at 50% 40%, #2a2925, var(--color-panel) 75%);
    transition: border-color 0.3s;
  }
  .on .disc {
    border-color: var(--color-muted);
  }
  .glow {
    opacity: 0;
    background: radial-gradient(circle, color-mix(in srgb, var(--flash) 30%, transparent) 55%, transparent 71%);
    box-shadow: 0 0 0 2px var(--flash), 0 0 48px color-mix(in srgb, var(--flash) 45%, transparent);
  }
  .beat {
    font-size: clamp(64px, 18vw, 96px);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    display: flex;
    align-items: flex-end;
    width: clamp(18px, 6vw, 26px);
    height: 44px;
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--color-line);
    & span {
      display: block;
      width: 100%;
      height: calc(var(--h) * 100%);
      border-radius: 4px;
      background: var(--color-line-2);
      transition: background 0.08s, height 0.2s;
    }
    &:hover {
      border-color: var(--color-muted);
    }
    &.now span {
      background: var(--color-sun);
    }
  }
  .bpm {
    width: 4ch;
    font-size: clamp(64px, 16vw, 88px);
    line-height: 1;
    text-align: center;
    background: transparent;
    border: 0;
    border-bottom: 1px dashed transparent;
    color: var(--color-chalk);
    font-variant-numeric: tabular-nums;
    appearance: textfield;
    -moz-appearance: textfield;
    &:hover {
      border-bottom-color: var(--color-line-2);
    }
    &:focus {
      outline: none;
      border-bottom-color: var(--color-sun);
    }
    &::-webkit-inner-spin-button {
      display: none;
    }
  }
  .round {
    width: 48px;
    height: 48px;
    padding: 0;
    border-radius: 50%;
    font-size: 22px;
  }
  .small {
    width: 3.75rem;
    padding: 6px 8px;
    text-align: center;
  }
  .dim {
    opacity: 0.5;
  }
  kbd {
    font: inherit;
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-radius: 6px;
    padding: 1px 6px;
    margin-inline: 1px;
  }
</style>
