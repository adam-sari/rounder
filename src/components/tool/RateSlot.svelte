<script lang="ts">
  import type { Component } from 'svelte';

  // The space under the tool for the rating prompt (RatePrompt.svelte, built separately). Astro can't hydrate a
  // component it only finds through a glob, so this island loads it; [slug].astro renders it only once the file exists.
  const prompts = import.meta.glob<{ default: Component<{ slug: string }> }>('./RatePrompt.svelte');
  const load = Object.values(prompts)[0];

  let { slug }: { slug: string } = $props();
</script>

{#if load}
  {#await load() then mod}
    <mod.default {slug} />
  {/await}
{/if}
