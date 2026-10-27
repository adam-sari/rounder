<script lang="ts">
  /* Kokoro's English voices as a filterable radio grid; each has a preview made on demand */
  import { isTopPick, VOICES, type VoiceId } from '@/tools/lib/text-to-speech/voices';

  interface Props {
    value: VoiceId;
    /** the voice being previewed and whether its sample is still being made */
    preview: { id: VoiceId; making: boolean } | null;
    onpreview: (id: VoiceId) => void;
  }

  let { value = $bindable(), preview, onpreview }: Props = $props();
  const uid = $props.id();

  let accent = $state<'all' | 'US' | 'UK'>('all');
  let gender = $state<'all' | 'female' | 'male'>('all');
  const shown = $derived(VOICES.filter((v) => (accent === 'all' || v.accent === accent) && (gender === 'all' || v.gender === gender)));
</script>

<div class="grid gap-2.5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="label mb-0!" id={`${uid}-label`}>voice · {VOICES.length} English voices</p>
    <div class="flex flex-wrap gap-2">
      <div class="seg" role="group" aria-label="Accent">
        {#each [['all', 'all'], ['US', 'US'], ['UK', 'UK']] as const as [k, label]}
          <button type="button" aria-pressed={accent === k} onclick={() => (accent = k)}>{label}</button>
        {/each}
      </div>
      <div class="seg" role="group" aria-label="Voice type">
        {#each [['all', 'all'], ['female', 'female'], ['male', 'male']] as const as [k, label]}
          <button type="button" aria-pressed={gender === k} onclick={() => (gender = k)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>

  <div class="voices" role="radiogroup" aria-labelledby={`${uid}-label`}>
    {#each shown as v (v.id)}
      {@const busy = preview?.id === v.id}
      <div class="voice" class:on={value === v.id}>
        <label class="pick">
          <input type="radio" name={`${uid}-voice`} value={v.id} bind:group={value} class="sr-only" />
          <span class="name">{v.name}</span>
          <span class="mono">{v.accent} · {v.gender}{isTopPick(v) ? ' · top pick' : ''}</span>
        </label>
        <button
          type="button"
          class="play"
          class:busy
          aria-label={busy ? `Stop the ${v.name} preview` : `Preview ${v.name}`}
          title={busy ? (preview?.making ? 'Making a sample…' : 'Stop') : 'Preview'}
          onclick={() => onpreview(v.id)}
        >
          {#if busy && preview?.making}
            <span class="spin" aria-hidden="true"></span>
          {:else if busy}
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
          {/if}
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .voices {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    max-height: 300px;
    overflow-y: auto;
    padding: 2px;
    scrollbar-width: thin;
  }
  .voice {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: var(--color-panel-2);
    padding-right: 6px;
    transition: border-color 0.2s, background 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &.on {
      border-color: var(--color-ai);
      background: color-mix(in srgb, var(--color-ai) 12%, var(--color-panel-2));
    }
    &:has(input:focus-visible) {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 1px;
    padding: 9px 4px 9px 12px;
    cursor: pointer;
  }
  .name {
    font: 400 21px/1.1 var(--font-serif);
  }
  .on .name {
    color: var(--color-ai);
  }
  .play {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: transparent;
    color: var(--color-soft);
    cursor: pointer;
    & svg {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }
    &:hover,
    &.busy {
      color: var(--color-bg);
      background: var(--color-ai);
      border-color: var(--color-ai);
    }
  }
  .spin {
    width: 14px;
    height: 14px;
    border-radius: 99px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
      border-right-color: currentColor;
      opacity: 0.6;
    }
  }
</style>
