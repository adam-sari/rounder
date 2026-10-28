<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SITE } from '@/site';
  import type { SearchManifest } from '@/search/build';
  import SearchResults from '@/search/ui/SearchResults.svelte';
  import { SearchSession, type Item } from '@/search/ui/session.svelte';
  import type { Hit } from '@/search/core/types';

  // The ⌘K palette. This shell is all a page loads; the engine, index and model arrive on first use (session).
  let { manifest }: { manifest: SearchManifest } = $props();

  // svelte-ignore state_referenced_locally
  const s = new SearchSession(manifest);
  const examples = ['compress pdf to 200kb', 'iphone photos to pdf', 'make video smaller for discord'];

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let active = $state(0);
  const items = $derived(s.items);
  const listId = 'palette-results';
  const r = $derived(s.result);
  const head = $derived(!r ? (s.recent.length ? 'recent' : '') : !r.hits.length ? '' : r.confident ? 'best match' : 'closest tools');

  // Chrome's built-in AI, only where the browser has it and only once the visitor turns it on
  let hasAi = $state(false);
  let aiOn = $state(false);
  let ai = $state.raw<{ query: string; state: 'idle' | 'working' | 'done' | 'none' | 'missing'; steps: Hit[]; summary: string }>({ query: '', state: 'idle', steps: [], summary: '' });
  let aiTimer: ReturnType<typeof setTimeout> | undefined;
  let aiCtrl: AbortController | undefined;
  type Prompt = typeof import('@/search/ai/prompt');
  let prompt: Promise<Prompt> | undefined;
  const loadPrompt = () => (prompt ??= import('@/search/ai/prompt'));

  // each keystroke: search and (maybe) plan; only the query is a dependency, the rest writes state
  $effect(() => {
    s.query;
    untrack(() => {
      active = 0;
      s.run();
      schedulePlan();
    });
  });

  function schedulePlan() {
    clearTimeout(aiTimer);
    aiCtrl?.abort();
    const res = s.result;
    // a plan belongs to the query it was made for; never leave an older one showing
    if (!aiOn || !res || ai.query !== res.query) ai = { query: '', state: 'idle', steps: [], summary: '' };
    if (!aiOn || !res) return;
    aiTimer = setTimeout(async () => {
      const p = await loadPrompt();
      if (!(await p.aiReady())) return void (ai = { query: res.query, state: 'missing', steps: [], summary: '' });
      if (!p.wantsPlan(res.query, res.confident, res.hinglish)) return;
      aiCtrl = new AbortController();
      ai = { query: res.query, state: 'working', steps: [], summary: '' };
      const plan = await p.planWithAi(res.query, s.shortlist(), { signal: aiCtrl.signal });
      if (s.result?.query !== res.query) return;
      const steps = plan?.steps.map((x) => s.hitFor(x.slug, x.preset)).filter((h): h is Hit => !!h) ?? [];
      ai = { query: res.query, state: steps.length ? 'done' : 'none', steps, summary: plan?.summary ?? '' };
    }, 700);
  }

  async function toggleAi(on: boolean) {
    aiOn = on;
    (await loadPrompt()).setAiEnabled(on);
    schedulePlan();
  }

  function open(seed?: string) {
    if (seed) s.query = seed;
    void s.warm();
    dialog.showModal();
    input.focus();
    input.select();
    if (hasAi) void loadPrompt().then((p) => (aiOn = p.aiEnabled()));
  }

  function pick(item: Item | undefined) {
    if (item) s.open(item);
  }

  // Enter pressed before the index arrived opens the best match as soon as there is one
  let enterPending = false;
  $effect(() => {
    if (s.ready && enterPending) untrack(() => ((enterPending = false), pick(items[0])));
  });

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = Math.max(0, Math.min(active + 1, items.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      clearTimeout(aiTimer);
      if (!s.ready) enterPending = !!s.query.trim();
      else pick(items[active]);
    }
  }

  onMount(() => {
    // set after hydration, so the server's HTML and the first client render agree
    hasAi = 'LanguageModel' in globalThis;
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
      open(trigger.getAttribute('data-query') ?? undefined);
    };
    // the home page's search box hands over to the palette on small screens
    const onOpen = (ev: Event) => open((ev as CustomEvent<{ query?: string }>).detail?.query);
    window.addEventListener('keydown', onGlobalKey);
    document.addEventListener('click', onClick);
    window.addEventListener('rounder:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onGlobalKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('rounder:open-palette', onOpen);
    };
  });
</script>

<dialog bind:this={dialog} class="palette" aria-label="Search tools" onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="box">
    <label class="q">
      <span class="mono" aria-hidden="true">›</span>
      <input
        bind:this={input}
        bind:value={s.query}
        onkeydown={onKey}
        placeholder="What do you need to do?"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
        autocomplete="off"
        spellcheck="false"
      />
      <kbd class="mono">esc</kbd>
    </label>
    <div class="body">
      {#if r?.note}<p class="note">{r.note}</p>{/if}
      <p class="mono head" aria-live="polite">{head}</p>
      {#if s.query.trim() && !s.ready}
        <p class="mono state">{s.failed ? "Search couldn't load. Check your connection and try again." : 'loading the tool index…'}</p>
      {:else if r && !r.hits.length}
        <p class="state">
          No tool for “{r.query}” yet.
          <a class="mono" href={`mailto:${SITE.email}?subject=${encodeURIComponent('Tool idea')}&body=${encodeURIComponent(r.query)}`}>suggest it</a>
        </p>
      {/if}
      <SearchResults {items} {active} {listId} categories={s.categories} confident={!!r?.confident} onpick={pick} onhover={(i) => (active = i)} />
      {#if !s.query.trim()}
        <p class="examples">
          <span class="mono">try</span>
          {#each examples as ex (ex)}
            <button type="button" class="chip" onclick={() => ((s.query = ex), input.focus())}>{ex}</button>
          {/each}
        </p>
      {/if}
    </div>
    {#if hasAi}
      <div class="ai">
        {#if aiOn}
          {#if ai.state === 'done'}
            <button type="button" class="plan" onclick={() => s.go(ai.steps[0].href)}>
              <span class="mono">plan</span>
              <span class="steps">{ai.steps.map((h) => h.name).join(' → ')}</span>
            </button>
          {:else}
            <p class="mono">
              {ai.state === 'working' ? 'planning on your device…' : ai.state === 'missing' ? "Chrome's built-in model isn't on this device yet" : 'long requests get a plan here'}
            </p>
          {/if}
        {/if}
        <label class="mono toggle">
          <input type="checkbox" checked={aiOn} onchange={(e) => toggleAi(e.currentTarget.checked)} />
          plan with Chrome's built-in AI (runs on this device)
        </label>
      </div>
    {/if}
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
  .body {
    max-height: min(60vh, 480px);
    overflow-y: auto;
  }
  .head {
    margin: 10px 18px 0;
    min-height: 1.2em;
    text-transform: lowercase;
  }
  .note,
  .state {
    margin: 10px 18px 0;
    color: var(--color-soft);
  }
  .state a {
    margin-left: 6px;
  }
  .examples {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    margin: 4px 18px 16px;
  }
  .ai {
    display: grid;
    gap: 8px;
    padding: 10px 18px 12px;
    border-top: 1px solid var(--color-line);
  }
  .ai > p,
  .plan {
    min-height: 32px;
    margin: 0;
    display: flex;
    align-items: center;
  }
  .plan {
    gap: 10px;
    width: 100%;
    padding: 0 10px;
    border: 1px dashed var(--color-line-2);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .steps {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
</style>
