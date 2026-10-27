<!-- Progress for a Transcription run: reading → detecting → transcribing, with time left and Cancel -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Transcription } from './job.svelte';
  import { languageName } from './languages';
  import { clock } from './transcript';

  let { job }: { job: Transcription } = $props();

  let now = $state(performance.now());
  onMount(() => {
    const t = setInterval(() => (now = performance.now()), 500);
    return () => clearInterval(t);
  });

  const elapsed = $derived(Math.max(0, (now - job.startedAt) / 1000));
  const pct = $derived(Math.round((job.stage === 'reading' ? job.readProgress : job.fraction) * 100));
  const left = $derived(job.stage === 'transcribing' && job.fraction > 0.04 ? (elapsed * (1 - job.fraction)) / job.fraction : null);
  const status = $derived.by(() => {
    if (job.stage === 'reading') return `Reading the audio · ${pct}%`;
    if (job.stage === 'detecting') return 'Listening for the language…';
    const lang = job.language ? `${languageName(job.language)} · ` : '';
    return job.total ? `${lang}${clock(job.done + (job.draft?.at ?? 0))} of ${clock(job.total)} of speech · ${pct}%` : `${lang}starting…`;
  });
</script>

<div class="run" role="status" aria-live="polite">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <p class="font-serif text-2xl leading-none">{job.stage === 'reading' ? 'Getting the audio ready' : 'Transcribing'}</p>
    <span class="pct font-serif" aria-hidden="true">{pct}<small>%</small></span>
  </div>
  <div class="bar" class:busy={job.stage === 'detecting'} role="progressbar" aria-label="Transcription progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
    <span style:transform="scaleX({pct / 100})"></span>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <span class="mono">{status} · {clock(elapsed)} elapsed{left !== null ? ` · about ${clock(left)} left` : ''}</span>
    <button type="button" class="btn sm" onclick={() => job.cancel()}>Cancel</button>
  </div>
</div>

<style>
  .run {
    display: grid;
    gap: 12px;
    padding: 18px;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--color-ai) 35%, var(--color-line-2));
    background: color-mix(in srgb, var(--color-ai) 5%, var(--color-panel));
  }
  .pct {
    font-size: 40px;
    line-height: 1;
    color: var(--color-ai);
    font-variant-numeric: tabular-nums;
    & small {
      font-size: 20px;
      color: var(--color-muted);
    }
  }
  .bar {
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      transform-origin: left;
      background: linear-gradient(90deg, color-mix(in srgb, var(--color-ai) 60%, transparent), var(--color-ai));
      transition: transform 0.4s ease-out;
    }
    &.busy span {
      transform: none !important;
      background: repeating-linear-gradient(-45deg, var(--color-ai) 0 10px, color-mix(in srgb, var(--color-ai) 60%, transparent) 10px 20px);
      background-size: 28px 28px;
      animation: stripes 0.9s linear infinite;
    }
  }
  @keyframes stripes {
    to {
      background-position: 28px 0;
    }
  }
  .btn.sm {
    padding: 8px 14px;
    font-size: 14px;
  }
</style>
