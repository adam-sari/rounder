<script lang="ts">
  import { onMount } from 'svelte';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { GRADES, LEVELS, add, gpa, gradePoints, parseSaved, previousTotals, totals, type APlus, type Course, type Semester } from '../lib/gpa/gpa';

  type Num = number | null | undefined;
  const KEY = 'rounder:gpa-calculator';

  const course = (): Course => ({ name: '', credits: 3, grade: '', level: 'regular' });
  const semester = (i: number): Semester => ({ name: `Semester ${i}`, courses: [course(), course(), course(), course()] });

  let aPlus = $state<APlus>(4);
  let prevGpa = $state<Num>(null);
  let prevCredits = $state<Num>(null);
  let semesters = $state<Semester[]>([semester(1)]);
  let loaded = $state(false);
  let confirmReset = $state(false);

  onMount(() => {
    try {
      const saved = parseSaved(localStorage.getItem(KEY));
      if (saved?.semesters.length) {
        aPlus = saved.aPlus;
        prevGpa = saved.prevGpa;
        prevCredits = saved.prevCredits;
        semesters = saved.semesters;
      }
    } catch {
      // storage blocked (private mode, settings): start fresh
    }
    loaded = true;
  });

  // save a moment after the last edit
  $effect(() => {
    if (!loaded) return;
    const data = JSON.stringify({ aPlus, prevGpa, prevCredits, semesters });
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, data);
      } catch {
        // full or blocked storage just means nothing is remembered
      }
    }, 300);
    return () => clearTimeout(t);
  });

  const num = (x: Num) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const perSemester = $derived(semesters.map((s) => totals(s.courses, aPlus)));
  const previous = $derived(previousTotals(num(prevGpa), num(prevCredits)));
  const all = $derived(perSemester.reduce(add, previous));
  const result = $derived(gpa(all));
  const scaleMax = $derived(aPlus);

  const shown = new Tween(0, { duration: 500, easing: cubicOut });
  $effect(() => {
    shown.set(result?.unweighted ?? 0, { duration: prefersReducedMotion.current ? 0 : 500 });
  });

  const f2 = (x: number) => x.toFixed(2);
  const credits = (x: number) => `${+x.toFixed(2)} credit${x === 1 ? '' : 's'}`;

  function addSemester() {
    semesters.push(semester(semesters.length + 1));
  }

  function reset() {
    if (!confirmReset) return (confirmReset = true);
    semesters = [semester(1)];
    prevGpa = null;
    prevCredits = null;
    confirmReset = false;
  }
</script>

<div class="grid gap-8 lg:grid-cols-[1fr_290px]">
  <div class="grid content-start gap-5">
    {#each semesters as s, si}
      {@const t = perSemester[si]}
      {@const g = gpa(t)}
      <section class="sem rounded-2xl border border-line-2 p-4 sm:p-5" aria-label={s.name || `Semester ${si + 1}`}>
        <div class="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <input class="name font-serif" bind:value={s.name} aria-label="Semester name" placeholder={`Semester ${si + 1}`} />
          <p class="mono">
            {#if g}GPA <span class="text-chalk">{f2(g.unweighted)}</span> · weighted <span class="text-chalk">{f2(g.weighted)}</span> · {credits(t.credits)}{:else}add grades to see this semester's GPA{/if}
          </p>
        </div>

        <div class="row head mono" aria-hidden="true"><span>course</span><span>credits</span><span>grade</span><span>type</span><span></span></div>
        {#each s.courses as c, ci}
          <div class="row">
            <input class="field name-col" bind:value={c.name} placeholder={`Course ${ci + 1}`} aria-label={`Course ${ci + 1} name`} />
            <input class="field tabular-nums" type="number" inputmode="decimal" min="0" step="0.5" bind:value={c.credits} aria-label={`Course ${ci + 1} credits`} />
            <select class="field" bind:value={c.grade} aria-label={`Course ${ci + 1} grade`}>
              <option value="">—</option>
              {#each GRADES as gr}<option value={gr}>{gr}</option>{/each}
            </select>
            <select class="field" bind:value={c.level} aria-label={`Course ${ci + 1} type`}>
              {#each LEVELS as [id, label, bonus]}<option value={id}>{label}{bonus ? ` +${bonus}` : ''}</option>{/each}
            </select>
            <button type="button" class="remove" aria-label={`Remove course ${ci + 1}`} onclick={() => s.courses.splice(ci, 1)}>×</button>
          </div>
        {/each}

        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn py-2!" onclick={() => s.courses.push(course())}>+ Add course</button>
          {#if semesters.length > 1}
            <button type="button" class="btn py-2! text-muted" onclick={() => semesters.splice(si, 1)}>Remove semester</button>
          {/if}
        </div>
      </section>
    {/each}

    <button type="button" class="add-sem" onclick={addSemester}>+ Add a semester</button>
  </div>

  <aside class="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
    <div class="rounded-2xl border border-line-2 bg-[#141312] p-5 text-center">
      <span class="mono">cumulative GPA</span>
      <div class="relative mx-auto mt-2 size-40">
        <svg viewBox="0 0 120 120" class="size-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-panel-2)" stroke-width="7" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-sun)" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset={100 - Math.min(100, (shown.current / scaleMax) * 100)} />
        </svg>
        <output class="absolute inset-0 grid place-items-center font-serif text-5xl tabular-nums" aria-hidden="true">{result ? f2(shown.current) : '—'}</output>
        <span class="sr-only" aria-live="polite">{result ? `GPA ${f2(result.unweighted)}` : ''}</span>
      </div>
      <dl class="stats mt-3">
        <dt>weighted</dt><dd>{result ? f2(result.weighted) : '—'}</dd>
        <dt>credits</dt><dd>{+all.credits.toFixed(2)}</dd>
      </dl>
    </div>

    <div>
      <span class="label">A+ counts as</span>
      <div class="seg" role="group" aria-label="A+ counts as">
        <button type="button" aria-pressed={aPlus === 4} onclick={() => (aPlus = 4)}>4.0</button>
        <button type="button" aria-pressed={aPlus === 4.3} onclick={() => (aPlus = 4.3)}>4.3</button>
      </div>
    </div>

    <fieldset class="grid grid-cols-2 gap-3 rounded-2xl border border-line-2 p-4">
      <legend class="mono px-1.5">earlier semesters · optional</legend>
      <label><span class="label">GPA so far</span><input class="field tabular-nums" type="number" inputmode="decimal" min="0" max="5" step="0.01" bind:value={prevGpa} /></label>
      <label><span class="label">credits so far</span><input class="field tabular-nums" type="number" inputmode="decimal" min="0" step="0.5" bind:value={prevCredits} /></label>
      <p class="mono col-span-2">Counted in both totals as entered.</p>
    </fieldset>

    <details class="rounded-2xl border border-line-2 px-4 py-3">
      <summary class="cursor-pointer text-sm text-soft">Grade scale</summary>
      <div class="mt-3 grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-[13px]">
        {#each GRADES as gr}<span class="text-soft">{gr}</span><span class="text-right tabular-nums">{gradePoints(gr, aPlus).toFixed(1)}</span>{/each}
      </div>
      <p class="mono mt-3">Weighted adds 0.5 for honors and 1.0 for AP or IB courses (not to an F). Schools differ, so check yours.</p>
    </details>

    <div class="flex items-center justify-between gap-3">
      <p class="mono">saved in this browser only</p>
      <button type="button" class="btn py-2! text-sm" class:text-bad={confirmReset} onclick={reset} onblur={() => (confirmReset = false)}>
        {confirmReset ? 'Clear everything?' : 'Start over'}
      </button>
    </div>
  </aside>
</div>

<style>
  .name {
    min-width: 0;
    flex: 1 1 12rem;
    font-size: 26px;
    line-height: 1.2;
    color: var(--color-chalk);
    background: transparent;
    border: 0;
    border-bottom: 1px dashed transparent;
    padding: 0 0 2px;
    &:hover { border-bottom-color: var(--color-line-2); }
    &:focus { outline: none; border-bottom-color: var(--color-sun); }
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 36px;
    gap: 8px;
    margin-bottom: 8px;
    align-items: center;
  }
  .row .name-col {
    grid-column: 1 / -1;
  }
  .row .field {
    padding: 9px 10px;
  }
  .row.head {
    display: none;
    margin-bottom: 4px;
  }
  @media (min-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr) 5rem 5.5rem 8rem 36px;
    }
    .row .name-col {
      grid-column: auto;
    }
    .row.head {
      display: grid;
    }
  }
  @media (max-width: 639px) {
    .row {
      padding-bottom: 10px;
      border-bottom: 1px solid var(--color-line);
    }
  }
  .remove {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--color-muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    &:hover { color: var(--color-bad); background: var(--color-panel-2); }
  }
  .add-sem {
    padding: 18px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
    color: var(--color-soft);
    font: 500 15px var(--font-sans);
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover { border-color: var(--color-sun); color: var(--color-chalk); }
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin: 0;
    & dt { font: 400 12.5px var(--font-mono); color: var(--color-muted); grid-row: 2; }
    & dd { margin: 0; font: 400 26px/1.1 var(--font-serif); font-variant-numeric: tabular-nums; }
  }
</style>
