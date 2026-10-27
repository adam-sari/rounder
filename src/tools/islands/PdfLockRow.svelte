<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    name: string;
    meta: string;
    thumb?: string;
    note?: string;
    tone?: 'muted' | 'ok' | 'bad' | 'sun';
    /** the padlock on the thumbnail; its shackle swings when this changes */
    lock?: 'none' | 'open' | 'closed';
    busy?: boolean;
    actions?: Snippet;
  }

  let { name, meta, thumb, note, tone = 'muted', lock = 'none', busy = false, actions }: Props = $props();
</script>

<li class="row">
  <div class="thumb" class:busy>
    {#if thumb}
      <img src={thumb} alt="" />
    {:else}
      <span class="mono">PDF</span>
    {/if}
    {#if lock !== 'none'}
      <svg class="lock {lock}" class:ok={tone === 'ok'} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path class="shackle" d="M8 11.5V8.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <rect x="5" y="11" width="14" height="10" rx="3" fill="currentColor" />
        <circle cx="12" cy="16" r="1.5" fill="var(--color-bg)" />
      </svg>
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <p class="truncate font-medium" title={name}>{name}</p>
    <p class="mono truncate">{meta}</p>
    {#if note}
      <p class="note {tone}">{note}</p>
    {/if}
  </div>
  {#if busy}
    <span class="spinner" role="status" aria-label="Working"></span>
  {/if}
  {@render actions?.()}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px 10px 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #141312;
    animation: rise 0.35s var(--ease-spring);
  }
  .thumb {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 58px;
    border-radius: 6px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      border-radius: 5px;
    }
    &.busy img {
      opacity: 0.55;
      transition: opacity 0.3s;
    }
  }
  .lock {
    position: absolute;
    right: -8px;
    bottom: -6px;
    padding: 2px;
    border-radius: 8px;
    background: var(--color-bg);
    color: var(--color-muted);
    transition: color 0.3s;
    &.closed {
      color: var(--color-soft);
    }
    &.ok {
      color: var(--color-ok);
    }
  }
  .shackle {
    transform-box: fill-box;
    transform-origin: right bottom;
    transition: transform 0.5s var(--ease-spring);
  }
  .open .shackle {
    transform: translateY(-2.5px) rotate(-22deg);
  }
  .note {
    margin-top: 2px;
    font-size: 13.5px;
    line-height: 1.4;
    &.muted { color: var(--color-soft); }
    &.ok { color: var(--color-ok); }
    &.bad { color: var(--color-bad); }
    &.sun { color: var(--color-sun); }
  }
  .spinner {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--color-line-2);
    border-top-color: var(--color-sun);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px); }
  }
</style>
