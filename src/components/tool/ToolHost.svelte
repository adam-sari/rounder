<script lang="ts">
  import type { Component } from 'svelte';

  // Every tool island is its own chunk; only the one this page needs is fetched.
  const islands = import.meta.glob<{ default: Component<any> }>('../../tools/islands/*.svelte');

  let { island, props = {} }: { island: string; props?: Record<string, unknown> } = $props();

  const pending = $derived.by(() => {
    const load = islands[`../../tools/islands/${island}.svelte`];
    return load ? load() : Promise.reject(new Error(`Unknown tool island: ${island}`));
  });
</script>

{#await pending}
  <div class="loading mono" aria-busy="true">warming up the tool…</div>
{:then mod}
  <mod.default {...props} />
{:catch err}
  <div class="loading mono" role="alert">Couldn't load this tool. Try refreshing. ({err.message})</div>
{/await}

<style>
  .loading {
    display: grid;
    place-items: center;
    min-height: 320px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
</style>
