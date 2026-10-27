<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob } from '@/tools/lib/files';
  import { LIMITS, extensions, generate, render, type Flavor, type Format, type Unit } from '@/tools/lib/lorem-ipsum/generate';

  const UNITS: { id: Unit; label: string }[] = [
    { id: 'paragraphs', label: 'Paragraphs' },
    { id: 'sentences', label: 'Sentences' },
    { id: 'words', label: 'Words' },
    { id: 'items', label: 'List items' },
  ];
  const FORMATS: { id: Format; label: string }[] = [
    { id: 'text', label: 'Plain text' },
    { id: 'html', label: 'HTML' },
    { id: 'markdown', label: 'Markdown' },
  ];
  const MIME: Record<Format, string> = { text: 'text/plain', html: 'text/html', markdown: 'text/markdown' };

  let unit = $state<Unit>('paragraphs');
  let counts = $state<Record<Unit, number>>({ paragraphs: 3, sentences: 5, words: 50, items: 5 });
  let flavor = $state<Flavor>('latin');
  let format = $state<Format>('text');
  let classicStart = $state(true);
  let seed = $state(1);

  const blocks = $derived(generate({ unit, count: counts[unit], flavor, classicStart, seed: Math.floor(seed) || 0 }));
  const output = $derived(render(blocks, unit, format));
  const words = $derived(blocks.reduce((n, b) => n + b.split(/\s+/).filter(Boolean).length, 0));

  const reroll = () => (seed = Math.floor(Math.random() * 1_000_000));
  const download = () => downloadBlob(new Blob([output], { type: `${MIME[format]};charset=utf-8` }), `${flavor === 'latin' ? 'lorem-ipsum' : 'placeholder-text'}.${extensions[format]}`);
</script>

<div class="grid gap-5">
  <div class="grid gap-4 md:grid-cols-[1fr_auto]">
    <div>
      <span class="label">generate</span>
      <div class="seg" role="group" aria-label="What to generate">
        {#each UNITS as u}
          <button type="button" aria-pressed={unit === u.id} onclick={() => (unit = u.id)}>{u.label}</button>
        {/each}
      </div>
    </div>
    <label class="w-32">
      <span class="label">how many</span>
      <input class="field" type="number" min="1" max={LIMITS[unit]} bind:value={counts[unit]} />
      {#if counts[unit] > LIMITS[unit]}
        <span class="mono mt-1 block">max {LIMITS[unit].toLocaleString('en-US')}</span>
      {/if}
    </label>
  </div>

  <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
    <div>
      <span class="label">flavor</span>
      <div class="seg" role="group" aria-label="Flavor">
        <button type="button" aria-pressed={flavor === 'latin'} onclick={() => (flavor = 'latin')}>Classic Latin</button>
        <button type="button" aria-pressed={flavor === 'english'} onclick={() => (flavor = 'english')}>Readable English</button>
      </div>
    </div>
    <div>
      <span class="label">format</span>
      <div class="seg" role="group" aria-label="Output format">
        {#each FORMATS as f}
          <button type="button" aria-pressed={format === f.id} onclick={() => (format = f.id)}>{f.label}</button>
        {/each}
      </div>
    </div>
    <label class="w-28">
      <span class="label">seed</span>
      <input class="field" type="number" min="0" bind:value={seed} />
    </label>
  </div>

  <label class="flex items-center gap-2 text-sm" class:opacity-50={flavor !== 'latin'}>
    <input type="checkbox" bind:checked={classicStart} disabled={flavor !== 'latin'} class="accent-(--color-sun)" />
    Start with “Lorem ipsum dolor sit amet…”
  </label>

  <div>
    <div class="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
      <span class="label mb-0!" id="lorem-out">your placeholder text</span>
      <span class="mono">{words.toLocaleString('en-US')} words · {output.length.toLocaleString('en-US')} characters</span>
    </div>
    {#key output}
      <textarea
        class={`field out min-h-[300px]! ${format === 'text' ? 'font-sans! text-base!' : ''}`}
        readonly
        value={output}
        aria-labelledby="lorem-out"
        spellcheck="false"
      ></textarea>
    {/key}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <CopyButton text={() => output} class="btn-primary" label="Copy text" />
    <button type="button" class="btn" onclick={reroll}>New text</button>
    <button type="button" class="btn" onclick={download}>Download .{extensions[format]}</button>
    <span class="mono ml-auto">Same seed and settings always give the same text.</span>
  </div>
</div>

<style>
  .out {
    animation: settle 0.35s ease-out;
  }
  @keyframes settle {
    from {
      opacity: 0.35;
      transform: translateY(4px);
    }
  }
</style>
