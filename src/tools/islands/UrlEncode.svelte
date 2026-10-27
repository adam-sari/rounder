<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';

  let mode = $state<'encode' | 'decode'>('encode');
  let scope = $state<'component' | 'full'>('component');
  let text = $state('');

  const result = $derived.by(() => {
    try {
      if (mode === 'encode') return scope === 'component' ? encodeURIComponent(text) : encodeURI(text);
      return scope === 'component' ? decodeURIComponent(text.replace(/\+/g, ' ')) : decodeURI(text);
    } catch {
      return null;
    }
  });

  const parsed = $derived.by(() => {
    const candidate = mode === 'decode' ? result : text;
    if (!candidate) return null;
    try {
      const u = new URL(candidate.trim());
      return {
        parts: [['protocol', u.protocol], ['host', u.host], ['path', u.pathname], ['hash', u.hash]].filter(([, v]) => v),
        params: [...u.searchParams],
      };
    } catch {
      return null;
    }
  });
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap gap-3">
    <div class="seg" role="group" aria-label="Mode">
      <button type="button" aria-pressed={mode === 'encode'} onclick={() => (mode = 'encode')}>encode</button>
      <button type="button" aria-pressed={mode === 'decode'} onclick={() => (mode = 'decode')}>decode</button>
    </div>
    <div class="seg" role="group" aria-label="Scope">
      <button type="button" aria-pressed={scope === 'component'} onclick={() => (scope = 'component')}>component</button>
      <button type="button" aria-pressed={scope === 'full'} onclick={() => (scope = 'full')}>full URL</button>
    </div>
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    <label>
      <span class="label">input</span>
      <textarea class="field min-h-[160px]!" bind:value={text} spellcheck="false" placeholder="https://example.com/search?q=hello world"></textarea>
    </label>
    <label>
      <span class="label">result</span>
      {#if result === null}
        <div class="field min-h-[160px] text-bad" role="alert">That text has a broken percent-escape (like "%E0%A4%A") and can't be decoded.</div>
      {:else}
        <textarea class="field min-h-[160px]!" readonly value={result} spellcheck="false"></textarea>
      {/if}
    </label>
  </div>
  <div><CopyButton text={() => result ?? ''} class="btn-primary" label="Copy result" /></div>

  {#if parsed}
    <div class="grid gap-2">
      <span class="label">url breakdown</span>
      <table class="w-full text-sm">
        <tbody>
          {#each parsed.parts as [k, v]}
            <tr class="border-b border-line"><td class="mono py-1.5 pr-4">{k}</td><td class="break-all">{v}</td></tr>
          {/each}
          {#each parsed.params as [k, v]}
            <tr class="border-b border-line"><td class="mono py-1.5 pr-4">?{k}</td><td class="break-all">{v}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
