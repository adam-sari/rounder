<script lang="ts">
  import { checkLimits, graphemes, type LimitId } from '@/tools/lib/character-counter/limits';

  // focus 'chars' leads with the character counts (/character-counter); limits adds a meter per platform
  let { focus = 'words', limits = [] }: { focus?: 'words' | 'chars'; limits?: LimitId[] } = $props();
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
      // what you see: an emoji or an accented letter is one character
      chars: graphemes(text),
      charsNoSpace: graphemes(text.replace(/\s/g, '')),
      sentences,
      paragraphs,
      read: Math.ceil(words.length / 238),
      speak: Math.ceil(words.length / 140),
      top,
    };
  });

  const meters = $derived(checkLimits(text, limits));
  const tiles = $derived([
    ...(focus === 'chars'
      ? ([['characters', stats.chars], ['no spaces', stats.charsNoSpace], ['words', stats.words]] as const)
      : ([['words', stats.words], ['characters', stats.chars], ['no spaces', stats.charsNoSpace]] as const)),
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
  {#if meters.length}
    <ul class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Platform limits">
      {#each meters as m (m.id)}
        <li class="meter" data-state={m.state}>
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span>{m.label}</span>
            <span class="mono"><span class="count">{m.used.toLocaleString('en-US')}</span> / {m.soft ? '~' : ''}{m.max.toLocaleString('en-US')}</span>
          </div>
          <div class="bar" aria-hidden="true"><span style:width={`${Math.min(100, (m.used / m.max) * 100)}%`}></span></div>
          <p class="mono mt-1">
            {m.status}{m.detail ? ` · ${m.detail}` : ''}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
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

<style>
  .bar {
    height: 4px;
    margin-top: 6px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--color-line-2);
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.15s;
    }
  }
  .meter[data-state='over'] {
    & .bar span {
      background: var(--color-bad);
    }
    & .count {
      color: var(--color-bad);
    }
  }
</style>
