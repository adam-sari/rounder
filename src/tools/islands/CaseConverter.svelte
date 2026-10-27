<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';

  const SMALL = new Set('a an and as at but by for in nor of on or per the to vs via'.split(' '));

  const words = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s_\-.]+/)
      .filter(Boolean);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

  const modes: Record<string, (s: string) => string> = {
    'UPPER CASE': (s) => s.toUpperCase(),
    'lower case': (s) => s.toLowerCase(),
    'Title Case': (s) =>
      s.toLowerCase().replace(/\S+/g, (w, i: number) => (i > 0 && SMALL.has(w) ? w : cap(w))),
    'Sentence case': (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, p, c) => p + c.toUpperCase()),
    'camelCase': (s) => words(s).map((w, i) => (i ? cap(w) : w.toLowerCase())).join(''),
    'PascalCase': (s) => words(s).map(cap).join(''),
    'snake_case': (s) => words(s).map((w) => w.toLowerCase()).join('_'),
    'kebab-case': (s) => words(s).map((w) => w.toLowerCase()).join('-'),
    'CONSTANT_CASE': (s) => words(s).map((w) => w.toUpperCase()).join('_'),
    'aLtErNaTiNg': (s) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''),
  };

  let text = $state('');
  let mode = $state('Title Case');
  const out = $derived(modes[mode](text));
</script>

<div class="grid gap-4">
  <div class="seg" role="group" aria-label="Case">
    {#each Object.keys(modes) as m}
      <button type="button" aria-pressed={mode === m} onclick={() => (mode = m)}>{m}</button>
    {/each}
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    <label>
      <span class="label">input</span>
      <textarea class="field" bind:value={text} placeholder="Paste your text…"></textarea>
    </label>
    <label>
      <span class="label">{mode}</span>
      <textarea class="field" readonly value={out}></textarea>
    </label>
  </div>
  <div class="flex gap-2">
    <CopyButton text={() => out} class="btn-primary" label="Copy result" />
    <button type="button" class="btn" onclick={() => (text = out)}>Use as input</button>
  </div>
</div>
