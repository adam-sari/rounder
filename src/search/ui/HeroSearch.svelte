<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { SearchManifest } from '../build';
  import SearchResults from './SearchResults.svelte';
  import { SearchSession, type Item } from './session.svelte';

  // The home page's search box. The server renders the input and the popular tools (children); results take the same
  // four fixed-height rows, so nothing moves while typing. Before hydration a click opens the ⌘K palette instead, and
  // on small screens it always hands over to the palette, so the phone keyboard never pushes the hero around.
  let { manifest, children }: { manifest: SearchManifest; children?: Snippet } = $props();

  const ROWS = 4;
  // svelte-ignore state_referenced_locally
  const s = new SearchSession(manifest, ROWS);
  let hydrated = $state(false);
  let active = $state(0);
  let input: HTMLInputElement;
  const listId = 'hero-results';
  const typed = $derived(!!s.query.trim());
  const items = $derived(typed ? s.items.filter((i) => i.type !== 'plan') : []);
  const showResults = $derived(typed && s.ready);

  onMount(() => (hydrated = true));

  $effect(() => {
    s.query;
    untrack(() => {
      active = 0;
      s.run();
    });
  });

  function onFocus() {
    if (matchMedia('(max-width: 639px)').matches) {
      input.blur();
      window.dispatchEvent(new CustomEvent('rounder:open-palette', { detail: { query: s.query } }));
      return;
    }
    void s.warm();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = Math.max(0, Math.min(active + 1, Math.min(items.length, ROWS) - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (items[active]) s.open(items[active]);
    } else if (ev.key === 'Escape') {
      s.query = '';
    }
  }
</script>

<label class="q" data-open-palette={hydrated ? undefined : ''}>
  <span class="mono" aria-hidden="true">›</span>
  <input
    bind:this={input}
    bind:value={s.query}
    onfocus={onFocus}
    onpointerenter={() => hydrated && void s.warm()}
    onkeydown={onKey}
    placeholder="What do you need to do?"
    aria-label="Search tools"
    role="combobox"
    aria-expanded={showResults && items.length > 0}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={showResults && items[active] ? `${listId}-${active}` : undefined}
    autocomplete="off"
    spellcheck="false"
  />
  <kbd class="mono">⌘K</kbd>
</label>
{#if showResults}
  {#if items.length}
    <SearchResults {items} {active} {listId} categories={s.categories} confident={!!s.result?.confident} compact rows={ROWS} onpick={(i: Item) => s.open(i)} onhover={(i) => (active = i)} />
  {:else}
    <p class="none" style={`--rows:${ROWS}`}>No tool for “{s.query.trim()}” yet. <span class="mono">press ⌘K for the full search</span></p>
  {/if}
{:else}
  {@render children?.()}
{/if}

<style>
  .q {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--color-line);
    cursor: text;
  }
  input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    color: inherit;
    font: 400 18px var(--font-sans);
    caret-color: var(--color-sun);
  }
  input::placeholder {
    color: var(--color-muted);
  }
  kbd {
    margin-left: auto;
  }
  .none {
    min-height: calc(var(--rows) * 42px + 12px);
    margin: 0;
    padding: 16px 18px;
    color: var(--color-soft);
  }
  .none .mono {
    display: block;
    margin-top: 4px;
  }
</style>
