<script lang="ts">
  import { tick } from 'svelte';
  import { flag, searchCurrencies } from '@/tools/lib/currency-converter/rates';

  let {
    value = null,
    codes,
    nameOf,
    onpick,
    label,
    add = false,
    align = 'start',
  }: {
    value?: string | null;
    codes: string[];
    nameOf: (code: string) => string;
    onpick: (code: string) => void;
    label: string;
    /** renders as a compact "add currency" button instead of a select-like field */
    add?: boolean;
    align?: 'start' | 'end';
  } = $props();

  const uid = $props.id();
  let open = $state(false);
  let query = $state('');
  let active = $state(0);
  let root: HTMLDivElement;
  let trigger = $state<HTMLButtonElement>();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLUListElement>();

  const results = $derived(searchCurrencies(query, codes, nameOf));

  async function show() {
    query = '';
    active = Math.max(0, value ? codes.indexOf(value) : 0);
    open = true;
    await tick();
    input?.focus();
  }

  function close(refocus: boolean) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function pick(code: string) {
    onpick(code);
    close(true);
  }

  function onkey(e: KeyboardEvent) {
    const last = results.length - 1;
    if (e.key === 'ArrowDown') active = Math.min(last, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'PageDown') active = Math.min(last, active + 6);
    else if (e.key === 'PageUp') active = Math.max(0, active - 6);
    else if (e.key === 'Enter' && results[active]) pick(results[active]);
    else if (e.key === 'Escape') close(true);
    else return;
    e.preventDefault();
  }

  $effect(() => {
    if (open) list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function onfocusout(e: FocusEvent) {
    if (!root.contains(e.relatedTarget as Node | null)) open = false;
  }
</script>

<svelte:window onpointerdown={(e) => open && !root.contains(e.target as Node) && (open = false)} />

<div class="relative min-w-0" bind:this={root} {onfocusout}>
  {#if add}
    <button bind:this={trigger} type="button" class="btn w-full py-2.5! text-sm!" aria-haspopup="listbox" aria-expanded={open} onclick={() => (open ? close(false) : show())}>
      <span aria-hidden="true" class="text-sun">+</span> {label}
    </button>
  {:else}
    <button
      bind:this={trigger}
      type="button"
      class="field trigger flex items-center gap-2.5 text-left"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={value ? `${label}: ${value}, ${nameOf(value)}` : label}
      onclick={() => (open ? close(false) : show())}
    >
      {#if value}
        <span class="flag text-[22px] leading-none" aria-hidden="true">{flag(value)}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium leading-tight">{value}</span>
          <span class="block truncate text-xs text-muted">{nameOf(value)}</span>
        </span>
      {:else}
        <span class="flex-1 text-muted">Choose</span>
      {/if}
      <svg class="chev shrink-0 text-muted" class:up={open} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  {/if}

  {#if open}
    <!-- keep focus in the search box on mouse/touch picks: otherwise the blur closes the list before the click lands -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pop card" class:end={align === 'end'} onmousedown={(e) => e.target !== input && e.preventDefault()}>
      <input
        bind:this={input}
        bind:value={query}
        oninput={() => (active = 0)}
        onkeydown={onkey}
        class="field py-2.5!"
        type="search"
        placeholder="Search code or name"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-label={`Search currencies for ${label.toLowerCase()}`}
        aria-expanded="true"
        aria-controls={`${uid}-list`}
        aria-activedescendant={results[active] ? `${uid}-${results[active]}` : undefined}
      />
      <ul bind:this={list} id={`${uid}-list`} role="listbox" aria-label={label} class="mt-2 max-h-72 overflow-y-auto overscroll-contain">
        {#each results as code, i (code)}
          <!-- options are driven from the search box via aria-activedescendant -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id={`${uid}-${code}`}
            data-i={i}
            role="option"
            aria-selected={code === value}
            class="opt"
            class:active={i === active}
            onpointermove={() => (active = i)}
            onclick={() => pick(code)}
          >
            <span class="flag text-xl leading-none" aria-hidden="true">{flag(code)}</span>
            <span class="w-11 font-medium">{code}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-soft">{nameOf(code)}</span>
            {#if code === value}<span class="text-sun" aria-hidden="true">✓</span>{/if}
          </li>
        {:else}
          <li class="mono px-3 py-4 text-center">No currency matches “{query}”</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .trigger {
    min-height: 54px;
    padding-block: 8px;
    cursor: pointer;
  }
  .trigger:hover {
    border-color: var(--color-muted);
  }
  .flag {
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  }
  .chev {
    transition: transform 0.2s var(--ease-spring);
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: min(340px, calc(100vw - 32px));
    padding: 8px;
    box-shadow: 0 18px 50px -12px #000c;
    animation: pop 0.18s var(--ease-spring);
    transform-origin: top left;
  }
  .pop.end {
    left: auto;
    right: 0;
    transform-origin: top right;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
  }
  .opt.active {
    background: var(--color-panel-2);
    box-shadow: inset 0 0 0 1px var(--color-line-2);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
</style>
