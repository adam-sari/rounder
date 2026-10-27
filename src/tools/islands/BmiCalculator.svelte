<script lang="ts">
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { CLASSES, bmi, classify, healthyRange, toCm, toFeetInches, toKg, toLb } from '../lib/bmi/bmi';

  type Num = number | null | undefined;
  const n = (x: Num) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

  let units = $state<'metric' | 'imperial'>(typeof navigator !== 'undefined' && navigator.language === 'en-US' ? 'imperial' : 'metric');
  let adult = $state(true);
  let cm = $state<Num>(null);
  let kg = $state<Num>(null);
  let ft = $state<Num>(null);
  let inch = $state<Num>(null);
  let lb = $state<Num>(null);

  function setUnits(u: typeof units) {
    if (u === units) return;
    // carry the numbers over so switching never loses what was typed
    if (u === 'imperial') {
      if (n(cm) > 0) {
        const fi = toFeetInches(n(cm));
        ft = fi.feet;
        inch = fi.inches;
      }
      if (n(kg) > 0) lb = Math.round(toLb(n(kg)) * 10) / 10;
    } else {
      if (heightCm > 0) cm = Math.round(heightCm * 10) / 10;
      if (n(lb) > 0) kg = Math.round(toKg(n(lb)) * 10) / 10;
    }
    units = u;
  }

  const heightCm = $derived(units === 'metric' ? n(cm) : toCm(n(ft), n(inch)));
  const weightKg = $derived(units === 'metric' ? n(kg) : toKg(n(lb)));
  // anything outside these is almost certainly a typo or the wrong unit
  const plausible = $derived(heightCm >= 50 && heightCm <= 272 && weightKg >= 10 && weightKg <= 640);
  const value = $derived(plausible ? bmi(weightKg, heightCm) : null);
  const cls = $derived(value ? classify(value) : null);
  const range = $derived(plausible ? healthyRange(heightCm) : null);

  const weight = (kgs: number) => (units === 'metric' ? `${kgs.toFixed(1)} kg` : `${toLb(kgs).toFixed(1)} lb`);
  const height = $derived(units === 'metric' ? `${Math.round(heightCm)} cm` : `${n(ft)} ft ${n(inch)} in`);

  const gap = $derived.by(() => {
    if (!range || !value) return '';
    if (weightKg < range[0]) return `about ${weight(range[0] - weightKg)} below that range`;
    if (weightKg > range[1]) return `about ${weight(weightKg - range[1])} above that range`;
    return 'within that range';
  });

  // scale runs from BMI 15 to 40
  const MIN = 15;
  const MAX = 40;
  const pos = (b: number) => ((Math.min(MAX, Math.max(MIN, b)) - MIN) / (MAX - MIN)) * 100;
  const BANDS = [
    { from: MIN, to: 18.5, color: '#3d8bd0' },
    { from: 18.5, to: 25, color: 'var(--color-ok)' },
    { from: 25, to: 30, color: 'var(--color-sun)' },
    { from: 30, to: MAX, color: 'var(--color-bad)' },
  ];
  const tone = $derived(!cls ? '' : cls.id === 'under' ? '#7cc4ff' : cls.id === 'healthy' ? 'var(--color-ok)' : cls.id === 'over' ? 'var(--color-sun)' : 'var(--color-bad)');

  const shown = new Tween(0, { duration: 500, easing: cubicOut });
  $effect(() => {
    shown.set(value ?? 0, { duration: prefersReducedMotion.current ? 0 : 500 });
  });

  const rangeOf = (i: number) => {
    const c = CLASSES[i];
    const next = CLASSES[i + 1];
    return i === 0 ? `under ${next.from}` : next ? `${c.from} – ${(next.from - 0.1).toFixed(1)}` : `${c.from} or more`;
  };
</script>

<div class="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
  <div class="grid content-start gap-5">
    <div class="flex flex-wrap gap-3">
      <div class="seg" role="group" aria-label="Units">
        <button type="button" aria-pressed={units === 'metric'} onclick={() => setUnits('metric')}>cm · kg</button>
        <button type="button" aria-pressed={units === 'imperial'} onclick={() => setUnits('imperial')}>ft · lb</button>
      </div>
      <div class="seg" role="group" aria-label="Age">
        <button type="button" aria-pressed={adult} onclick={() => (adult = true)}>adult, 20+</button>
        <button type="button" aria-pressed={!adult} onclick={() => (adult = false)}>under 20</button>
      </div>
    </div>

    {#if units === 'metric'}
      <label>
        <span class="label">height · cm</span>
        <input class="field big" type="number" inputmode="decimal" min="0" step="any" placeholder="175" bind:value={cm} />
      </label>
      <label>
        <span class="label">weight · kg</span>
        <input class="field big" type="number" inputmode="decimal" min="0" step="any" placeholder="70" bind:value={kg} />
      </label>
    {:else}
      <fieldset class="grid grid-cols-2 gap-3">
        <legend class="label">height</legend>
        <label class="unit"><input class="field big" type="number" inputmode="numeric" min="0" step="1" placeholder="5" aria-label="feet" bind:value={ft} /><span>ft</span></label>
        <label class="unit"><input class="field big" type="number" inputmode="decimal" min="0" max="11.9" step="any" placeholder="9" aria-label="inches" bind:value={inch} /><span>in</span></label>
      </fieldset>
      <label class="unit">
        <span class="label">weight</span>
        <input class="field big" type="number" inputmode="decimal" min="0" step="any" placeholder="160" bind:value={lb} /><span>lb</span>
      </label>
    {/if}

    <p class="mono">Height without shoes and your usual weight give the most useful number.</p>
  </div>

  <div class="grid content-start gap-4">
    <div class="rounded-2xl border border-line-2 bg-[#141312] p-5">
      <!-- announce the final figure once, not every frame of the count-up -->
      <span class="sr-only" aria-live="polite">{value ? `BMI ${value.toFixed(1)}${adult && cls ? `, ${cls.label}` : ''}` : ''}</span>
      {#if value}
        <span class="mono">your BMI</span>
        <div class="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
          <output class="font-serif text-[clamp(56px,10vw,80px)] leading-[0.9] tabular-nums" aria-hidden="true">{shown.current.toFixed(1)}</output>
          {#if adult && cls}
            <span class="pill mb-2" style:--tone={tone}>{cls.label}</span>
          {/if}
        </div>

        {#if adult}
          <div class="scale mt-6" aria-hidden="true">
            <div class="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
              {#each BANDS as b}<span style:flex={b.to - b.from} style:background={b.color}></span>{/each}
            </div>
            <span class="marker" style:left={`${pos(value)}%`}></span>
            <div class="relative mt-2 h-4">
              {#each [18.5, 25, 30, 35] as t}
                <span class="tick" style:left={`${pos(t)}%`}>{t}</span>
              {/each}
            </div>
          </div>
          {#if range}
            <p class="mt-5 text-[15px] text-soft">
              At {height}, a healthy weight is <strong class="text-chalk">{weight(range[0])} – {weight(range[1])}</strong> (BMI 18.5 – 24.9). You're {gap}.
            </p>
          {/if}
        {:else}
          <p class="mt-4 text-[15px] text-soft">
            For children and teens, BMI is read differently: it's compared with other young people of the same age and sex on a growth chart, as a percentile. The adult categories below don't apply. A doctor, or the CDC's BMI calculator for children and teens, can work out the percentile for you.
          </p>
        {/if}
      {:else}
        <div class="grid min-h-[180px] place-items-center text-center">
          <div>
            <div class="font-serif text-6xl leading-none text-muted/50">—.—</div>
            <p class="mt-3 text-soft">
              {#if heightCm > 0 && weightKg > 0}Those numbers look off. Check the units?{:else}Enter your height and weight.{/if}
            </p>
          </div>
        </div>
      {/if}
    </div>

    <div class="overflow-hidden rounded-2xl border border-line-2">
      <table class="w-full text-sm">
        <caption class="sr-only">WHO BMI categories for adults</caption>
        <thead><tr><th>Adult category (WHO)</th><th>BMI</th></tr></thead>
        <tbody>
          {#each CLASSES as c, i}
            <tr class:active={adult && cls?.id === c.id}><td>{c.label}</td><td class="tabular-nums">{rangeOf(i)}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <section class="grid gap-3 border-t border-line pt-6 lg:col-span-2" aria-labelledby="bmi-limits">
    <h2 id="bmi-limits" class="text-2xl">What BMI can't tell you</h2>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="note"><strong>Muscle weighs too.</strong> BMI can't tell muscle from fat, so athletes and very muscular people can read as overweight while being lean.</div>
      <div class="note"><strong>Age changes the picture.</strong> Older adults often lose muscle, so a "healthy" BMI can hide extra body fat.</div>
      <div class="note"><strong>Background matters.</strong> Health risks start at a lower BMI for some groups. UK NICE guidance, for example, uses 23 and 27.5 as the overweight and obesity thresholds for people of South Asian, Chinese, Middle Eastern, Black African or African-Caribbean family background.</div>
      <div class="note"><strong>Not for pregnancy or children.</strong> BMI isn't meant for pregnancy, and under 20 it needs age- and sex-specific growth charts.</div>
    </div>
    <p class="mono">BMI is a quick screening number, not a diagnosis. For advice about your own health, talk to a doctor.</p>
  </section>
</div>

<style>
  .big {
    font-size: 22px;
    padding-block: 12px;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    position: relative;
    display: block;
  }
  .unit > span:last-child {
    position: absolute;
    right: 14px;
    bottom: 15px;
    font: 400 13px var(--font-mono);
    color: var(--color-muted);
    pointer-events: none;
  }
  .pill {
    font: 500 14px var(--font-sans);
    padding: 5px 12px;
    border-radius: 999px;
    color: var(--tone);
    border: 1px solid color-mix(in srgb, var(--tone) 50%, transparent);
    background: color-mix(in srgb, var(--tone) 10%, transparent);
  }
  .scale {
    position: relative;
  }
  .marker {
    position: absolute;
    top: -5px;
    width: 4px;
    height: 20px;
    margin-left: -2px;
    border-radius: 2px;
    background: var(--color-chalk);
    box-shadow: 0 0 0 2px #141312;
    transition: left 0.6s var(--ease-spring);
  }
  .tick {
    position: absolute;
    transform: translateX(-50%);
    font: 400 11px var(--font-mono);
    color: var(--color-muted);
  }
  table th,
  table td {
    padding: 8px 14px;
    text-align: left;
  }
  table th {
    font: 400 12px var(--font-mono);
    color: var(--color-muted);
    background: var(--color-panel-2);
  }
  table tbody tr {
    border-top: 1px solid var(--color-line);
    transition: background 0.2s;
  }
  tr.active {
    background: #ffd25e14;
  }
  tr.active td:first-child {
    color: var(--color-sun);
  }
  .note {
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    padding: 14px 16px;
    font-size: 14.5px;
    color: var(--color-soft);
  }
  .note strong {
    display: block;
    margin-bottom: 2px;
    font-weight: 500;
    color: var(--color-chalk);
  }
</style>
