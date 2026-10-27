<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';

  let text = $state('');
  let dedupe = $state(true);
  let ignoreCase = $state(false);
  let trim = $state(true);
  let dropEmpty = $state(true);
  let sort = $state<'none' | 'az' | 'za' | 'length' | 'shuffle'>('none');

  const result = $derived.by(() => {
    let lines = text.split(/\r?\n/);
    if (trim) lines = lines.map((l) => l.trim());
    if (dropEmpty) lines = lines.filter((l) => l !== '');
    if (dedupe) {
      const seen = new Set<string>();
      lines = lines.filter((l) => {
        const k = ignoreCase ? l.toLowerCase() : l;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    if (sort === 'az') lines.sort(collator.compare);
    else if (sort === 'za') lines.sort((a, b) => collator.compare(b, a));
    else if (sort === 'length') lines.sort((a, b) => a.length - b.length);
    else if (sort === 'shuffle') {
      for (let i = lines.length - 1; i > 0; i--) {
        const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
    }
    return lines;
  });

  const before = $derived(text ? text.split(/\r?\n/).length : 0);
  const sorts = [['none', 'keep order'], ['az', 'A → Z'], ['za', 'Z → A'], ['length', 'by length'], ['shuffle', 'shuffle']] as const;
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={dedupe} /> remove duplicates</label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={ignoreCase} /> ignore case</label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={trim} /> trim spaces</label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={dropEmpty} /> drop empty lines</label>
  </div>
  <div class="seg" role="group" aria-label="Sort">
    {#each sorts as [value, label]}
      <button type="button" aria-pressed={sort === value} onclick={() => (sort = value)}>{label}</button>
    {/each}
  </div>
  <div class="grid gap-4 md:grid-cols-2">
    <label>
      <span class="label">input · {before} lines</span>
      <textarea class="field" bind:value={text} placeholder="One item per line…"></textarea>
    </label>
    <label>
      <span class="label">result · {result.length} lines{before ? ` · ${before - result.length} removed` : ''}</span>
      <textarea class="field" readonly value={result.join('\n')}></textarea>
    </label>
  </div>
  <div><CopyButton text={() => result.join('\n')} class="btn-primary" label="Copy result" /></div>
</div>
