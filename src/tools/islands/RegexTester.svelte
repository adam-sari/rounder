<script lang="ts">
  import { tick } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { FLAGS, compile, highlightSegments, parseLiteral, rebaseMatches, toLiteral, toggleFlag, type Match } from '@/tools/lib/regex-tester/regex';
  import { CHEAT_SHEET, PRESETS } from '@/tools/lib/regex-tester/presets';
  import { RegexTimeoutError, closeRegexWorker, runRegex } from '@/tools/lib/regex-tester/client';
  import type { RegexResponse } from '@/tools/lib/regex-tester/worker';

  let pattern = $state('');
  let flags = $state('g');
  let text = $state('');
  let mode = $state<'match' | 'replace'>('match');
  let replacement = $state('');
  // raw: thousands of matches don't need deep reactivity; `ranOn` is the text they were found in
  let result = $state.raw<RegexResponse | null>(null);
  let ranOn = '';
  let failure = $state<string | null>(null);
  let running = $state(false);
  let active = $state<number | null>(null);
  let shown = $state(100);

  let patternEl = $state<HTMLInputElement>();
  let replaceEl = $state<HTMLInputElement>();
  let textEl = $state<HTMLTextAreaElement>();
  let backdrop = $state<HTMLPreElement>();

  const compiled = $derived(pattern ? compile(pattern, flags) : null);
  // while a new run is pending, matches shift with the edit so the highlights don't drift
  const segments = $derived(highlightSegments(text, result ? rebaseMatches(ranOn, text, result.matches) : []));
  const flagNames = $derived(FLAGS.filter((f) => flags.includes(f.flag)).map((f) => `${f.flag} ${f.name}`).join(' · '));

  // results from a run that's been overtaken are dropped
  let runId = 0;

  $effect(() => {
    const request = { pattern, flags, text, replacement: mode === 'replace' ? replacement : null };
    const id = ++runId;
    if (!compiled?.ok) {
      closeRegexWorker(); // a slow run for the old pattern has nothing left to report
      result = null;
      failure = null;
      running = false;
      return;
    }
    const t = setTimeout(() => {
      running = true;
      runRegex(request)
        .then((r) => {
          if (id !== runId) return;
          ranOn = request.text;
          result = r;
          failure = null;
          shown = 100;
        })
        .catch((e) => {
          if (id !== runId || (e as Error)?.name === 'AbortError') return;
          result = null;
          failure = e instanceof RegexTimeoutError ? 'timeout' : (e as Error).message;
        })
        .finally(() => {
          if (id === runId) running = false;
        });
    }, 120);
    return () => clearTimeout(t);
  });

  $effect(() => closeRegexWorker);

  function applyPreset(name: string) {
    const preset = PRESETS.find((p) => p.name === name);
    if (!preset) return;
    pattern = preset.pattern;
    flags = preset.flags;
    // keep the user's own text; swap in the sample only over nothing or another sample
    if (!text.trim() || PRESETS.some((p) => p.sample === text)) text = preset.sample;
  }

  async function insert(token: string, into: 'pattern' | 'replacement') {
    if (into === 'replacement') mode = 'replace';
    await tick();
    const el = into === 'pattern' ? patternEl : replaceEl;
    const value = into === 'pattern' ? pattern : replacement;
    const clean = token.replace('…', '');
    const cut = token.indexOf('…');
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + clean + value.slice(end);
    if (into === 'pattern') pattern = next;
    else replacement = next;
    await tick();
    const caret = start + (cut >= 0 ? cut : clean.length);
    el?.focus();
    el?.setSelectionRange(caret, caret);
  }

  // a pasted literal like /ab+c/gi fills both the pattern and the flags
  function pastePattern(e: ClipboardEvent) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.selectionStart !== 0 || el.selectionEnd !== el.value.length) return;
    const literal = parseLiteral(e.clipboardData?.getData('text') ?? '');
    if (!literal) return;
    e.preventDefault();
    pattern = literal.pattern;
    flags = literal.flags;
  }

  function selectMatch(m: Match) {
    textEl?.focus();
    textEl?.setSelectionRange(m.start, m.end);
  }

  function syncScroll() {
    if (backdrop && textEl) backdrop.scrollTop = textEl.scrollTop;
  }

  const display = (v: string) => {
    if (v === '') return '(empty)';
    const s = v.replace(/\n/g, '↵').replace(/\t/g, '⇥');
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  };
  const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 'es'}`;
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <label class="min-w-0 flex-1 sm:max-w-[280px]">
      <span class="label">common patterns</span>
      <select
        class="field py-2.5!"
        value=""
        onchange={(e) => {
          applyPreset(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
      >
        <option value="" disabled>Load a preset…</option>
        {#each PRESETS as p}<option value={p.name}>{p.name}</option>{/each}
      </select>
    </label>
    <div class="seg" role="group" aria-label="Mode">
      <button type="button" aria-pressed={mode === 'match'} onclick={() => (mode = 'match')}>match</button>
      <button type="button" aria-pressed={mode === 'replace'} onclick={() => (mode = 'replace')}>replace</button>
    </div>
  </div>

  <div class="grid gap-2">
    <label for="rx-pattern" class="label m-0!">regular expression</label>
    <div class="pattern" class:bad={compiled && !compiled.ok}>
      <span class="slash" aria-hidden="true">/</span>
      <input
        id="rx-pattern"
        bind:this={patternEl}
        bind:value={pattern}
        onpaste={pastePattern}
        placeholder={'\\b(\\w+)@example\\.com'}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      />
      <span class="slash" aria-hidden="true">/{flags}</span>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="seg flags" role="group" aria-label="Flags">
        {#each FLAGS as f}
          <button type="button" aria-pressed={flags.includes(f.flag)} aria-label="{f.flag}: {f.name}" title="{f.name}: {f.info}" onclick={() => (flags = toggleFlag(flags, f.flag))}>{f.flag}</button>
        {/each}
      </div>
      <span class="mono">{flagNames || 'no flags'}</span>
    </div>
    {#if compiled && !compiled.ok}
      <div class="problem" role="alert">
        <p class="text-bad">{compiled.error}</p>
        {#if compiled.hint}<p class="text-sm text-soft">{compiled.hint}</p>{/if}
      </div>
    {/if}
  </div>

  {#if mode === 'replace'}
    <label>
      <span class="label">replace with <span class="opacity-70">($1, $&lt;name&gt;, $&amp; for the whole match)</span></span>
      <input class="field font-mono text-sm!" bind:this={replaceEl} bind:value={replacement} spellcheck="false" autocomplete="off" placeholder="$<year>/$<month>" />
    </label>
  {/if}

  <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
    <div class="grid content-start gap-4">
      <div class="grid gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <label for="rx-text" class="label m-0!">test string</label>
          <span class="mono" aria-live="polite">
            {#if !pattern}enter a pattern{:else if compiled && !compiled.ok}fix the pattern{:else if failure}stopped{:else if result}
              <span class={result.total ? 'text-sun' : ''}>{plural(result.total, 'match')}{result.capped ? '+' : ''}</span> · {result.ms < 1 ? '<1' : Math.round(result.ms)} ms
            {:else if running}matching…{/if}
          </span>
        </div>
        <div class="editor">
          <pre class="backdrop" aria-hidden="true" bind:this={backdrop}>{#each segments as s}{#if s.match === undefined}{s.text}{:else}<mark class:alt={s.match % 2 === 1} class:active={s.match === active} class:empty={s.text === ''}>{s.text}</mark>{/if}{/each}{' '}</pre>
          <textarea
            id="rx-text"
            class="field min-h-[320px]!"
            bind:this={textEl}
            bind:value={text}
            onscroll={syncScroll}
            placeholder="Paste or type the text to test against…"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
          ></textarea>
        </div>
        {#if failure === 'timeout'}
          <div class="problem" role="alert">
            <p class="text-bad">Stopped after 2 seconds, so your tab stays responsive.</p>
            <p class="text-sm text-soft">
              This usually means catastrophic backtracking: nested quantifiers like <code>(a+)+</code> or <code>(\w*)*</code> can match the same text in a huge number of ways.
              Make the inner part more specific, or anchor the pattern.
            </p>
          </div>
        {:else if failure}
          <p class="text-bad" role="alert">{failure}</p>
        {/if}
      </div>

      {#if mode === 'replace'}
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <span class="label m-0!">result</span>
            <CopyButton text={() => result?.replaced ?? ''} class="py-1.5! text-sm!" label="Copy result" />
          </div>
          <textarea class="field min-h-[160px]!" readonly value={result?.replaced ?? ''} aria-label="Replacement result" spellcheck="false"></textarea>
          {#if !flags.includes('g')}<p class="mono">Without the g flag only the first match is replaced.</p>{/if}
        </div>
      {/if}
    </div>

    <section class="matches" aria-label="Matches">
      <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span class="label m-0!">matches</span>
        {#if pattern && compiled?.ok}<CopyButton text={() => toLiteral(pattern, flags)} class="py-1! px-2.5! text-xs!" label="Copy as JS" />{/if}
      </div>
      {#if result?.matches.length}
        <ol class="list">
          {#each result.matches.slice(0, shown) as m, i}
            <li class:active={i === active}>
              <button type="button" class="hit" onmouseenter={() => (active = i)} onmouseleave={() => (active = null)} onfocus={() => (active = i)} onblur={() => (active = null)} onclick={() => selectMatch(m)}>
                <span class="mono flex justify-between gap-2"><span>#{i + 1}</span><span>{m.start}–{m.end}</span></span>
                <code class="value" class:muted={m.value === ''}>{display(m.value)}</code>
              </button>
              {#if m.groups.length}
                <div class="groups">
                  {#each m.groups as g}
                    <span class="gname">{g.name ?? g.n}</span>
                    {#if g.value === undefined}
                      <span class="text-muted italic">no match</span>
                    {:else}
                      <span class="gval"><code>{display(g.value)}</code> <span class="mono">{g.start}–{g.end}</span></span>
                    {/if}
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
        {#if result.matches.length > shown}
          <button type="button" class="btn m-3 py-2! text-sm!" onclick={() => (shown += 200)}>Show more ({(result.matches.length - shown).toLocaleString('en-US')} left)</button>
        {:else if result.total > result.matches.length}
          <p class="mono px-4 pb-3">Showing the first {result.matches.length.toLocaleString('en-US')}.</p>
        {/if}
      {:else}
        <div class="nothing">
          {#if !pattern}
            <p>Matches show up here as you type.</p>
            <p class="mono mt-1">Try a preset to see one in action.</p>
          {:else if result && text}
            <p>No matches.</p>
            {#if !flags.includes('i')}<p class="mono mt-1">Case matters; the i flag ignores it.</p>{/if}
          {:else if !text}
            <p>Add some text to test against.</p>
          {/if}
        </div>
      {/if}
    </section>
  </div>

  <details class="card cheats">
    <summary>Cheat sheet <span class="mono">click a token to insert it</span></summary>
    <div class="grid gap-5 px-4 pt-1 pb-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each CHEAT_SHEET as section}
        <div>
          <h3 class="label">{section.title.toLowerCase()}</h3>
          <ul class="grid gap-0.5">
            {#each section.items as [token, info]}
              <li>
                <button type="button" class="tok" onclick={() => insert(token, section.title === 'Replacement' ? 'replacement' : 'pattern')}>
                  <code>{token}</code><span>{info}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </details>
</div>

<style>
  .pattern {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #141312;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    padding: 0 14px;
    transition: border-color 0.15s;
    &:focus-within { border-color: var(--color-sun); }
    &.bad { border-color: var(--color-bad); }
    & input {
      flex: 1;
      min-width: 0;
      padding: 13px 0;
      background: transparent;
      border: 0;
      outline: none;
      font: 400 16px var(--font-mono);
      color: var(--color-chalk);
      &::placeholder { color: #6e6960; }
    }
  }
  .slash {
    font: 400 16px var(--font-mono);
    color: var(--color-muted);
    white-space: nowrap;
  }
  .flags button {
    min-width: 36px;
    padding-inline: 10px;
  }

  .problem {
    display: grid;
    gap: 4px;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-bad) 45%, transparent);
    background: color-mix(in srgb, var(--color-bad) 8%, transparent);
  }

  .editor {
    position: relative;
    border-radius: 12px;
    background: #141312;
  }
  /* the textarea and the highlight layer under it must lay text out identically */
  .editor textarea,
  .backdrop {
    font: 400 14px/1.6 var(--font-mono);
    padding: 11px 14px;
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    letter-spacing: 0;
    tab-size: 4;
    scrollbar-gutter: stable;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border: 1px solid transparent;
    pointer-events: none;
    color: var(--color-chalk);
  }
  .editor textarea {
    position: relative;
    display: block;
    overflow: auto;
    background: transparent;
    color: transparent;
    caret-color: var(--color-chalk);
  }
  mark {
    color: inherit;
    background: color-mix(in srgb, var(--color-sun) 30%, transparent);
    border-radius: 3px;
    &.alt { background: color-mix(in srgb, var(--color-dev) 28%, transparent); }
    &.active { box-shadow: 0 0 0 1.5px var(--color-sun); }
    /* an empty match is a thin caret between characters */
    &.empty { position: relative; background: none; }
    &.empty::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 0;
      bottom: 0;
      width: 2px;
      border-radius: 1px;
      background: var(--color-sun);
    }
  }

  .matches {
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    align-self: start;
    min-width: 0;
  }
  .list {
    max-height: 560px;
    overflow: auto;
    border-top: 1px solid var(--color-line);
    & li {
      border-bottom: 1px solid var(--color-line);
      animation: rise 0.25s ease-out both;
    }
    & li:last-child { border-bottom: 0; }
    & li.active { background: var(--color-panel-2); }
  }
  .hit {
    display: grid;
    gap: 3px;
    width: 100%;
    padding: 9px 16px 8px;
    text-align: left;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
  }
  .value {
    font: 400 13.5px/1.5 var(--font-mono);
    color: var(--color-sun);
    overflow-wrap: anywhere;
    &.muted { color: var(--color-muted); }
  }
  .groups {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px 10px;
    padding: 0 16px 10px;
    font-size: 13px;
  }
  .gname {
    font: 400 12px var(--font-mono);
    color: var(--color-dev);
  }
  .gval code {
    font: 400 13px var(--font-mono);
    color: var(--color-soft);
    overflow-wrap: anywhere;
  }
  .nothing {
    padding: 28px 16px 32px;
    text-align: center;
    color: var(--color-soft);
    border-top: 1px solid var(--color-line);
  }

  .cheats summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px;
    cursor: pointer;
    font-family: var(--font-serif);
    font-size: 20px;
  }
  .tok {
    display: grid;
    grid-template-columns: minmax(84px, auto) 1fr;
    gap: 10px;
    width: 100%;
    padding: 4px 6px;
    margin-inline: -6px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 8px;
    color: var(--color-soft);
    font-size: 13.5px;
    cursor: pointer;
    &:hover { background: var(--color-panel-2); color: var(--color-chalk); }
    & code {
      font: 400 13px var(--font-mono);
      color: var(--color-sun);
    }
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(4px); }
  }
</style>
