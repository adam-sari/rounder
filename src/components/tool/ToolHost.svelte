<script lang="ts">
  import type { Component } from 'svelte';
  import { presetFromHash } from '@/tools/presets';

  // Every tool island is its own chunk; only the one this page needs is fetched.
  const islands = import.meta.glob<{ default: Component<any> }>('../../tools/islands/*.svelte');

  // slug: the page's tool, read by toolSucceeded() (src/tools/lib/success.ts) so islands needn't know which page they're on
  // heights: the tool's first-screen height at phone, tablet and desktop widths (src/tools/island-heights.json), so the
  // placeholder the server renders takes the same room and nothing below it jumps when the tool loads
  let {
    island,
    slug,
    props = {},
    heights,
  }: { island: string; slug?: string; props?: Record<string, unknown>; heights?: readonly number[] } = $props();

  // a preset in the address hash (/compress-pdf#target=150kb, from the search box) overrides the page's own props;
  // islands render on the client only, so reading location here can't cause a hydration mismatch
  const merged = $derived({ ...props, ...(typeof location === 'undefined' ? {} : presetFromHash(island, location.hash)) });

  // Some tools pass through a shorter first state (an AI tool's "Checking your device…") before settling at the
  // measured height. Holding that height until the visitor first interacts keeps the page still meanwhile; after an
  // interaction a size change is expected and doesn't count as a layout shift.
  let held = $state(true);
  $effect(() => {
    const release = () => (held = false);
    const events = ['pointerdown', 'keydown', 'dragenter', 'paste'] as const;
    for (const e of events) addEventListener(e, release, { once: true, capture: true });
    return () => events.forEach((e) => removeEventListener(e, release, { capture: true }));
  });

  const reserve = $derived(heights ? `--h-s:${heights[0]}px;--h-m:${heights[1]}px;--h-l:${heights[2]}px` : undefined);

  const pending = $derived.by(() => {
    const load = islands[`../../tools/islands/${island}.svelte`];
    return load ? load() : Promise.reject(new Error(`Unknown tool island: ${island}`));
  });
</script>

<div class:held={held && reserve} style={reserve} data-tool-slug={slug}>
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
    min-height: var(--h-s, 320px);
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .held {
    min-height: var(--h-s);
  }
  @media (min-width: 640px) {
    .loading,
    .held {
      min-height: var(--h-m, 320px);
    }
  }
  @media (min-width: 1024px) {
    .loading,
    .held {
      min-height: var(--h-l, 320px);
    }
  }
</style>
