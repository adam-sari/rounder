<script lang="ts">
  import { searchUnits, type UnitMatch } from '@/tools/lib/units/convert';
  import { categories, type UnitCategory } from '@/tools/lib/units/units';

  let { category, value, label, onpick }: {
    category: UnitCategory;
    value: string;
    label: string;
    onpick: (m: UnitMatch) => void;
  } = $props();

  const id = $props.id();
  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let list = $state<HTMLUListElement>();

  const unit = $derived(category.units.find((u) => u.id === value) ?? category.units[0]);

  // options in display order; headers sit between them but are never selectable
  const rows = $derived.by(() => {
    const here = searchUnits(query, [category]);
    const elsewhere = query.trim() ? searchUnits(query, categories.filter((c) => c !== category)).slice(0, 8) : [];
    const out: { match: UnitMatch; header?: string; other?: boolean }[] = [];
    let group: string | undefined;
    for (const match of here) {
      const header = !query.trim() && match.unit.group !== group ? match.unit.group : undefined;
      group = match.unit.group;
      out.push({ match, header });
    }
    elsewhere.forEach((match, i) => out.push({ match, header: i === 0 ? 'other categories' : undefined, other: true }));
    return out;
  });

  function show() {
    query = '';
    open = true;
    active = Math.max(0, rows.findIndex((r) => r.match.unit.id === value && !r.other));
  }

  function close(refocus = false) {
    open = false;
    if (refocus) trigger.focus();
  }

  function pick(m: UnitMatch) {
    onpick(m);
    close(true);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      list?.querySelector(`#${CSS.escape(`${id}-${active}`)}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) pick(rows[active].match);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close();
    }
  }

  // close when clicking anywhere else
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  });

  $effect(() => {
    if (open && list) list.querySelector(`#${CSS.escape(`${id}-${active}`)}`)?.scrollIntoView({ block: 'nearest' });
  });

  const focus = (node: HTMLInputElement) => node.focus();
</script>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="trigger"
    bind:this={trigger}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={`${label}: ${unit.name}. Change unit`}
    onclick={() => (open ? close() : show())}
  >
    <span class="sym">{unit.symbol}</span>
    <span class="min-w-0 flex-1 truncate text-left text-soft">{unit.name}</span>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" class="shrink-0 text-muted"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>

  {#if open}
    <div class="pop">
      <input
        use:focus
        class="field"
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={rows.length ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        aria-label={`Search ${label.toLowerCase()} units`}
        placeholder="Search units, e.g. psi, cups, KiB"
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        oninput={() => (active = 0)}
        {onkeydown}
      />
      <ul id={`${id}-list`} role="listbox" aria-label={`${label} unit`} class="mt-2 max-h-72 overflow-y-auto overscroll-contain" bind:this={list}>
        {#each rows as row, i (`${row.match.category.id}/${row.match.unit.id}`)}
          {#if row.header}<li role="presentation" class="mono px-3 pt-3 pb-1 text-[11px]! uppercase tracking-wider">{row.header}</li>{/if}
          <!-- keyboard handled on the search box via aria-activedescendant -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id={`${id}-${i}`}
            role="option"
            aria-selected={!row.other && row.match.unit.id === value}
            class="option"
            class:active={i === active}
            onpointermove={() => (active = i)}
            onclick={() => pick(row.match)}
          >
            <span class="sym">{row.match.unit.symbol}</span>
            <span class="min-w-0 flex-1 truncate">{row.match.unit.name}</span>
            {#if row.other}<span class="mono shrink-0">{row.match.category.name.toLowerCase()}</span>{/if}
          </li>
        {:else}
          <li role="presentation" class="mono px-3 py-4">no unit matches “{query}”</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: #141312;
    color: var(--color-chalk);
    font-size: 14px;
    cursor: pointer;
    transition: border-color 0.2s;
    &:hover,
    &[aria-expanded='true'] {
      border-color: var(--color-muted);
    }
  }
  .sym {
    flex-shrink: 0;
    min-width: 3.2em;
    font: 500 13px var(--font-mono);
    color: var(--color-sun);
    white-space: nowrap;
  }
  .pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    min-width: min(300px, calc(100vw - 48px));
    padding: 8px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel);
    box-shadow: 0 18px 50px -12px rgb(0 0 0 / 0.7);
    animation: drop 0.18s var(--ease-spring);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 9px;
    font-size: 14px;
    cursor: pointer;
    &.active {
      background: var(--color-panel-2);
    }
    &[aria-selected='true'] {
      box-shadow: inset 2px 0 0 var(--color-sun);
    }
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
</style>
