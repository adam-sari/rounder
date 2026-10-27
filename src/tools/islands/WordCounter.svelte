<script lang="ts">
  let text = $state('');

  const STOP = new Set('the a an and or but of to in on at for with is are was were be it this that as by from i you he she we they not'.split(' '));

  const stats = $derived.by(() => {
    const words = text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
    const sentences = text.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim()).length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const counts = new Map<string, number>();
    for (const w of words) {
      const k = w.toLowerCase();
      if (k.length > 2 && !STOP.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      words: words.length,
      chars: text.length,
      charsNoSpace: text.replace(/\s/g, '').length,
      sentences,
      paragraphs,
      read: Math.ceil(words.length / 238),
      speak: Math.ceil(words.length / 140),
      top,
    };
  });

  const tiles = $derived([
    ['words', stats.words],
    ['characters', stats.chars],
    ['no spaces', stats.charsNoSpace],
    ['sentences', stats.sentences],
    ['paragraphs', stats.paragraphs],
    ['reading', `${stats.read} min`],
    ['speaking', `${stats.speak} min`],
  ] as const);
</script>

<div class="grid gap-4">
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
    {#each tiles as [label, value]}
      <div class="rounded-xl border border-line-2 px-3 py-2.5">
        <div class="font-serif text-3xl leading-none">{value}</div>
        <div class="mono mt-1">{label}</div>
      </div>
    {/each}
  </div>
  <label>
    <span class="label">your text</span>
    <textarea class="field min-h-[300px]! font-sans! text-base!" bind:value={text} placeholder="Start typing or paste your text here…"></textarea>
  </label>
  {#if stats.top.length}
    <div>
      <span class="label">most used words</span>
      <div class="flex flex-wrap gap-2">
        {#each stats.top as [word, n]}
          <span class="rounded-full border border-line-2 px-3 py-1 text-sm">{word} <span class="mono">×{n} · {((n / stats.words) * 100).toFixed(1)}%</span></span>
        {/each}
      </div>
    </div>
  {/if}
</div>
