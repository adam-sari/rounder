<script lang="ts">
  import { fitFades } from '@/tools/lib/audio-cutter/edit';

  interface Props {
    fadeIn: number;
    fadeOut: number;
    /** output length in seconds: the envelope is drawn against it */
    total: number;
    max?: number;
    disabled?: boolean;
  }

  let { fadeIn = $bindable(0), fadeOut = $bindable(0), total, max = 10, disabled = false }: Props = $props();

  const fit = $derived(fitFades(fadeIn, fadeOut, total));
  const squeezed = $derived(fit.inSec < fadeIn - 1e-6);
  // envelope: silence → full → silence, in a 100 × 24 box
  const points = $derived.by(() => {
    const t = Math.max(total, 1e-6);
    const a = (fit.inSec / t) * 100;
    const b = 100 - (fit.outSec / t) * 100;
    return `0,${fit.inSec ? 22 : 3} ${a},3 ${b},3 100,${fit.outSec ? 22 : 3}`;
  });
  const label = (s: number) => (s ? `${s.toFixed(1)} s` : 'off');
</script>

<div class="fades">
  <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
    <polygon points={`${points} 100,24 0,24`} />
    <polyline points={points} />
  </svg>
  <label>
    <span class="label">fade in · {label(fadeIn)}</span>
    <input type="range" min="0" {max} step="0.1" bind:value={fadeIn} {disabled} class="w-full accent-(--color-sun)" />
  </label>
  <label>
    <span class="label">fade out · {label(fadeOut)}</span>
    <input type="range" min="0" {max} step="0.1" bind:value={fadeOut} {disabled} class="w-full accent-(--color-sun)" />
  </label>
  {#if squeezed}
    <p class="mono note">The fades are longer than the audio, so both are shortened to fit.</p>
  {/if}
</div>

<style>
  .fades {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 18px;
  }
  svg {
    grid-column: 1 / -1;
    width: 100%;
    height: 28px;
    overflow: visible;
    & polygon {
      fill: #ffd25e14;
    }
    & polyline {
      fill: none;
      stroke: var(--color-sun);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
    }
  }
  .note {
    grid-column: 1 / -1;
  }
</style>
