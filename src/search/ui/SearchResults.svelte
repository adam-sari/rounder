<script lang="ts">
  import type { Item } from './session.svelte';

  // The listbox both search boxes render. Rows have fixed heights, so results arriving or changing never shift the
  // page; the input owns the keyboard (combobox pattern) and points at the active row with aria-activedescendant.
  let {
    items,
    active,
    listId,
    categories = {},
    confident = false,
    compact = false,
    rows = 0,
    onpick,
    onhover,
  }: {
    items: Item[];
    active: number;
    listId: string;
    categories?: Record<string, string>;
    confident?: boolean;
    /** the hero: one line per row, a fixed number of rows */
    compact?: boolean;
    rows?: number;
    onpick: (item: Item) => void;
    onhover: (i: number) => void;
  } = $props();

  const label = (item: Item) => {
    const h = item.hit;
    if (item.type === 'best') return `${confident ? 'Best match' : 'Closest tool'}: ${h.name}${confident ? `, ${h.why}` : ''}`;
    if (item.type === 'plan') return item.by === 'next' ? `Then: ${h.name}` : `Plan: ${item.steps!.map((s) => s.name).join(', then ')}`;
    return h.name;
  };
  const shown = $derived(rows ? items.slice(0, rows) : items);
</script>

<ul id={listId} role="listbox" aria-label="Search results" class:compact style={rows ? `--rows:${rows}` : undefined}>
  {#each shown as item, i (item.id)}
    <!-- keyboard selection is handled by the search input (combobox pattern) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <li
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === active}
      aria-label={label(item)}
      class={item.type}
      class:on={i === active}
      class:tall={item.type === 'best' && confident && !compact}
      onmousemove={() => onhover(i)}
      onclick={() => onpick(item)}
    >
      {#if item.type === 'plan'}
        <span class="mono tag">{item.by === 'next' ? 'then' : 'plan'}</span>
        <span class="steps">
          {#each item.steps! as s, k (s.slug)}
            {#if k}<span class="mono" aria-hidden="true">→</span>{/if}<span>{s.name}</span>
          {/each}
        </span>
        <span class="mono hint">{item.by === 'next' ? '' : '↵ start'}</span>
      {:else}
        <span class="dot" style={`background: var(--color-${item.hit.kind})`}></span>
        <span class="text">
          <span class="name">{item.hit.name}</span>
          {#if item.type === 'best' && confident}<span class="why mono">{item.hit.why}</span>{/if}
        </span>
        <span class="mono hint">{item.type === 'best' && !compact ? '↵ open' : (categories[item.hit.kind] ?? item.hit.kind)}</span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
  }
  ul.compact {
    min-height: calc(var(--rows) * 42px + 12px);
  }
  li {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    cursor: pointer;
  }
  .compact li {
    grid-template-columns: 26px minmax(0, 1fr) auto;
    height: 42px;
  }
  .compact .dot {
    justify-self: center;
  }
  li.on {
    background: #f2ede414;
  }
  li.tall {
    height: 64px;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .compact .text {
    flex-direction: row;
    align-items: baseline;
    gap: 10px;
  }
  .name,
  .why,
  .steps {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .best .name {
    font-weight: 500;
  }
  .why {
    margin-top: 3px;
  }
  .compact .why {
    margin-top: 0;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .plan {
    grid-template-columns: auto minmax(0, 1fr) auto;
    border: 1px dashed var(--color-line-2);
  }
  .tag {
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .steps {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .hint {
    white-space: nowrap;
  }
</style>
