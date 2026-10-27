<script lang="ts">
  import { timing } from '@/tools/lib/loudness/format';

  interface Props {
    /** 0–1 */
    progress: number;
    status: string;
    /** performance.now() when the job started */
    startedAt: number;
    label: string;
    oncancel: () => void;
  }

  let { progress, status, startedAt, label, oncancel }: Props = $props();

  let now = $state(performance.now());
  $effect(() => {
    const t = setInterval(() => (now = performance.now()), 500);
    return () => clearInterval(t);
  });

  const pct = $derived(Math.round(Math.min(1, Math.max(0, progress)) * 100));
  const time = $derived(timing(now - startedAt, progress));
</script>

<div class="job" role="group" aria-label={label}>
  <div class="flex items-baseline justify-between gap-3">
    <span class="truncate text-sm">{status || 'Working…'}</span>
    <span class="font-serif text-3xl leading-none tabular-nums">{pct}<span class="text-lg text-muted">%</span></span>
  </div>
  <div class="track" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
    <span class="fill" style:transform={`scaleX(${pct / 100})`}></span>
  </div>
  <div class="flex items-center justify-between gap-3">
    <span class="mono">{time.elapsed} elapsed{time.left ? ` · about ${time.left} left` : ''}</span>
    <button type="button" class="btn px-3! py-2! text-sm!" onclick={oncancel}>Cancel</button>
  </div>
</div>

<style>
  .job {
    display: grid;
    gap: 10px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
  }
  .track {
    height: 6px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    transform-origin: left;
    background: linear-gradient(90deg, #ffd25e99, var(--color-sun));
    transition: transform 0.35s ease-out;
  }
</style>
