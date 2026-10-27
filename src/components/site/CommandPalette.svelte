<script lang="ts">
  import { onMount } from 'svelte';

  interface Entry {
    slug: string;
    name: string;
    tagline: string;
    category: string;
    kind: string;
    keywords: string;
  }

  let index = $state<Entry[]>([]);
  let loading: Promise<void> | undefined;

  /** the index is fetched on first use, so pages don't each carry every tool's name and keywords */
  function loadIndex() {
    loading ??= fetch('/search-index.json')
      .then((r) => r.json())
      .then((list: Entry[]) => void (index = list))
      .catch(() => void (loading = undefined));
    return loading;
  }

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state('');
  let active = $state(0);
  let recent = $state<string[]>([]);

  const RECENT_KEY = 'rounder:recent';

  function score(e: Entry, terms: string[]): number {
    const name = e.name.toLowerCase();
    // the whole query as a known phrase ("remove background") beats word-by-word matches
    const phrase = terms.join(' ');
    let total = terms.length > 1 && (name.includes(phrase) || e.keywords.includes(phrase)) ? 150 : 0;
    for (const t of terms) {
      if (name.startsWith(t)) total += 100;
      else if (name.includes(t)) total += 60;
      else if (e.keywords.includes(t)) total += 30;
      else if (e.category.toLowerCase().includes(t) || e.tagline.toLowerCase().includes(t)) total += 10;
      else return 0;
    }
    return total;
  }

  const results = $derived.by(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      const fromRecent = recent.map((s) => index.find((e) => e.slug === s)).filter((e): e is Entry => !!e);
      return fromRecent.length ? fromRecent : index.slice(0, 8);
    }
    return index
      .map((e) => ({ e, s: score(e, terms) }))
      .filter((r) => r.s > 0)
      // ties go to the shorter, more direct name
      .sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length)
      .slice(0, 10)
      .map((r) => r.e);
  });

  $effect(() => {
    query;
    active = 0;
  });

  function open() {
    try {
      recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      recent = [];
    }
    loadIndex();
    dialog.showModal();
    input.focus();
    input.select();
  }

  function go(e: Entry | undefined) {
    if (!e) return;
    try {
      const next = [e.slug, ...recent.filter((s) => s !== e.slug)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    location.href = `/${e.slug}`;
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      go(results[active]);
    }
  }

  onMount(() => {
    const onGlobalKey = (ev: KeyboardEvent) => {
      const typing = ev.target instanceof HTMLElement && ev.target.closest('input, textarea, [contenteditable]');
      if ((ev.key === 'k' && (ev.metaKey || ev.ctrlKey)) || (ev.key === '/' && !typing)) {
        ev.preventDefault();
        open();
      }
    };
    const onClick = (ev: MouseEvent) => {
      const trigger = (ev.target as HTMLElement).closest('[data-open-palette]');
      if (!trigger) return;
      ev.preventDefault();
      const seed = trigger.getAttribute('data-query');
      if (seed) query = seed;
      open();
    };
    window.addEventListener('keydown', onGlobalKey);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onGlobalKey);
      document.removeEventListener('click', onClick);
    };
  });
</script>

<dialog
  bind:this={dialog}
  class="palette"
  aria-label="Search tools"
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <div class="box">
    <label class="q">
      <span class="mono" aria-hidden="true">›</span>
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onKey}
        placeholder="What do you need to do?"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={results[active] ? `pr-${results[active].slug}` : undefined}
        autocomplete="off"
        spellcheck="false"
      />
      <kbd class="mono">esc</kbd>
    </label>
    {#if !query && recent.length}
      <p class="mono head">recent</p>
    {/if}
    <ul id="palette-results" role="listbox">
      {#each results as e, i (e.slug)}
        <!-- keyboard selection is handled by the search input (combobox pattern) -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`pr-${e.slug}`}
          role="option"
          aria-selected={i === active}
          class:on={i === active}
          onmousemove={() => (active = i)}
          onclick={() => go(e)}
        >
          <span class="dot" style={`background: var(--color-${e.kind})`}></span>
          <span class="name">{e.name}</span>
          <span class="mono">{e.category}</span>
        </li>
      {:else}
        <li class="empty">No tool for “{query}” yet. <span class="mono">we add new ones every week</span></li>
      {/each}
    </ul>
  </div>
</dialog>

<style>
  .palette {
    padding: 0;
    margin: 12vh auto auto;
    width: min(600px, calc(100vw - 32px));
    background: transparent;
    border: 0;
    color: var(--color-chalk);
  }
  .palette::backdrop {
    background: #0b0a09b3;
    backdrop-filter: blur(3px);
  }
  .box {
    background: #1c1b19;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    box-shadow: 0 30px 80px -30px #000, 0 0 0 6px #f2ede40a;
    overflow: hidden;
  }
  .q {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--color-line);
  }
  .q input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    color: inherit;
    font: 400 18px var(--font-sans);
  }
  .head {
    margin: 10px 18px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: min(60vh, 460px);
    overflow-y: auto;
  }
  li {
    display: grid;
    grid-template-columns: 10px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
  }
  li.on {
    background: #f2ede414;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .empty {
    display: block;
    cursor: default;
    color: var(--color-soft);
  }
  .empty .mono {
    display: block;
    margin-top: 4px;
  }
</style>
