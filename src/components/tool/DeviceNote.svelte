<script lang="ts">
  // The low-end device check's answer (src/tools/lib/device-guard.ts): nothing when ok, a note when the job may be
  // too big for this device, an alert when it can't run here. Islands disable their start button on 'block'.
  import type { Verdict } from '@/tools/lib/device-guard';

  let { verdict }: { verdict: Verdict | null | undefined } = $props();
</script>

{#if verdict && verdict.level !== 'ok'}
  <p class="device-note" class:block={verdict.level === 'block'} role={verdict.level === 'block' ? 'alert' : 'status'} data-device-guard={verdict.level}>
    {verdict.message}
  </p>
{/if}

<style>
  .device-note {
    font-size: 14px;
    line-height: 1.5;
    color: var(--color-sun);
    border-left: 2px solid currentColor;
    padding-left: 10px;
    max-width: 62ch;
  }
  .block {
    color: var(--color-bad);
  }
</style>
