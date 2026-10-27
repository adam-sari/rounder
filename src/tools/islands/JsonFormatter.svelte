<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { locateJsonError } from '@/tools/lib/json-locate';

  let text = $state('');
  let indent = $state<'2' | '4' | 'tab' | 'min'>('2');
  let sortKeys = $state(false);

  function sortDeep(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]));
    }
    return v;
  }


  const result = $derived.by(() => {
    if (!text.trim()) return { ok: true, out: '', error: '' };
    try {
      let value = JSON.parse(text);
      if (sortKeys) value = sortDeep(value);
      const space = indent === 'min' ? undefined : indent === 'tab' ? '\t' : Number(indent);
      return { ok: true, out: JSON.stringify(value, null, space), error: '' };
    } catch (e) {
      const problem = locateJsonError(text);
      const error = problem
        ? `Line ${problem.line}, column ${problem.column}: ${problem.reason}.`
        : (e as Error).message;
      return { ok: false, out: '', error };
    }
  });

  const indents = [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'tabs'], ['min', 'minify']] as const;
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-center gap-4">
    <div class="seg" role="group" aria-label="Indent">
      {#each indents as [value, label]}
        <button type="button" aria-pressed={indent === value} onclick={() => (indent = value)}>{label}</button>
      {/each}
    </div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={sortKeys} /> sort keys</label>
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    <label>
      <span class="label">input</span>
      <textarea class="field min-h-[360px]!" bind:value={text} placeholder={'{"paste": "your JSON here"}'} spellcheck="false"></textarea>
    </label>
    <label>
      <span class="label">
        {#if !text.trim()}output{:else if result.ok}<span class="text-ok">✓ valid JSON</span>{:else}<span class="text-bad">✕ invalid</span>{/if}
      </span>
      {#if result.ok}
        <textarea class="field min-h-[360px]!" readonly value={result.out} spellcheck="false"></textarea>
      {:else}
        <div class="field min-h-[360px] text-bad" role="alert">{result.error}</div>
      {/if}
    </label>
  </div>
  <div class="flex gap-2">
    <CopyButton text={() => result.out} class="btn-primary" label="Copy result" />
    <button type="button" class="btn" onclick={() => result.ok && (text = result.out)} disabled={!result.ok || !result.out}>Use as input</button>
  </div>
</div>
