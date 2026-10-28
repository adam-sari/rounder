<script lang="ts">
  import type { Component } from 'svelte';
  import { presetFromHash } from '@/tools/presets';

  // Every tool island is its own chunk; only the one this page needs is fetched.
  const islands = import.meta.glob<{ default: Component<any> }>('../../tools/islands/*.svelte');

  // slug: the page's tool, read by toolSucceeded() (src/tools/lib/success.ts) so islands needn't know which page they're on
  let { island, slug, props = {} }: { island: string; slug?: string; props?: Record<string, unknown> } = $props();

  // a preset in the address hash (/compress-pdf#target=150kb, from the search box) overrides the page's own props;
  // islands render on the client only, so reading location here can't cause a hydration mismatch
  const merged = $derived({ ...props, ...(typeof location === 'undefined' ? {} : presetFromHash(island, location.hash)) });

  const pending = $derived.by(() => {
    const load = islands[`../../tools/islands/${island}.svelte`];
    return load ? load() : Promise.reject(new Error(`Unknown tool island: ${island}`));
  });
</script>

<div class="contents" data-tool-slug={slug}>
  {#await pending}
    <div class="loading mono" aria-busy="true">warming up the tool…</div>
  {:then mod}
    <mod.default {...merged} />
  {:catch err}
    <div class="loading mono" role="alert">Couldn't load this tool. Try refreshing. ({err.message})</div>
  {/await}
</div>

<style>
  .loading {
    display: grid;
    place-items: center;
    min-height: 320px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
</style>
