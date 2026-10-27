<script lang="ts">
  /* Progress card for long media jobs: smooth bar, elapsed time, ETA and a Cancel button. */
  import { etaSeconds, formatClock } from '@/tools/lib/video-to-mp3/job';

  interface Props {
    /** 0–1 */
    progress: number;
    /** performance.now() when the job began */
    startedAt: number;
    label: string;
    status?: string;
    oncancel: () => void;
  }

  let { progress, startedAt, label, status = '', oncancel }: Props = $props();

  let now = $state(performance.now());
  $effect(() => {
    const t = setInterval(() => (now = performance.now()), 500);
    return () => clearInterval(t);
  });

  const elapsed = $derived(Math.max(0, now - startedAt));
  const eta = $derived(etaSeconds(elapsed, progress));
  const pct = $derived(Math.round(Math.min(1, Math.max(0, progress)) * 100));
</script>

<div class="job">
  <div class="flex items-baseline justify-between gap-3">
    <p class="min-w-0 truncate text-sm">{label}</p>
    <p class="pct font-serif">{pct}<span>%</span></p>
  </div>
  <div class="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
    <span style:width="{pct}%"></span>
  </div>
  <p class="mono flex flex-wrap justify-between gap-x-3">
    <span role="status">{status || 'Working…'}</span>
    <span>{formatClock(elapsed / 1000)} elapsed{eta !== null ? ` · about ${formatClock(eta)} left` : ''}</span>
  </p>
  <button type="button" class="btn" onclick={oncancel}>Cancel</button>
</div>

<style>
  .job {
    display: grid;
    gap: 10px;
  }
  .pct {
    font-size: 30px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    & span {
      font-size: 18px;
      color: var(--color-muted);
    }
  }
  .meter {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #ffd25e 0%, #ffe9a8 50%, #ffd25e 100%) 0 0 / 200% 100%;
      transition: width 0.4s ease-out;
      animation: sheen 1.6s linear infinite;
    }
  }
  @keyframes sheen {
    to {
      background-position: -200% 0;
    }
  }
</style>
