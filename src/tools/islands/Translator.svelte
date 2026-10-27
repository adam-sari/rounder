<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { MODELS } from '@/engines/ai/models';
  import { modelWorker, proxy } from '@/engines/ai/worker-utils';
  import { downloadBlob, withSuffix } from '@/tools/lib/files';
  import { builtinAvailability, builtinTranslator, detectLanguage, hasBuiltinTranslator, type Availability } from '@/tools/lib/translator/builtin';
  import { prepare, translateDoc } from '@/tools/lib/translator/doc';
  import { LANGUAGES, languageName, normalizeLanguage, opusCoverage, opusRoute, type Hop } from '@/tools/lib/translator/languages';
  import type { TranslatorWorker } from '@/tools/lib/translator/translator.worker';

  type Plan =
    | { kind: 'wait' | 'checking' | 'same' | 'none' }
    | { kind: 'builtin'; status: Availability }
    | { kind: 'opus'; hops: Hop[] };

  /** sentences per call to the worker: small enough for steady progress and a quick Cancel */
  const BATCH = 4;
  const MAX_FILE = 5e6;
  const PREFS = 'rounder:translator';
  const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
  const COVERAGE = opusCoverage();
  const COVERED = `${COVERAGE.both.join(', ')}${COVERAGE.intoEnglish.length ? `, plus ${COVERAGE.intoEnglish.join(' and ')} into English` : ''}`;

  const worker = modelWorker<TranslatorWorker>(() => new Worker(new URL('../lib/translator/translator.worker.ts', import.meta.url), { type: 'module' }));

  let input = $state('');
  let output = $state('');
  let from = $state('auto');
  let to = $state('es');
  let detected = $state<string | null>(null);
  let detecting = $state(false);
  let markdown = $state(false);
  let fileName = $state<string | null>(null);
  let builtin = $state(false);
  let plan = $state<Plan>({ kind: 'wait' });
  let busy = $state(false);
  let done = $state(0);
  let total = $state(0);
  let pack = $state<number | null>(null);
  let error = $state('');
  let used = $state<{ kind: 'builtin' } | { kind: 'opus'; hops: Hop[] } | null>(null);
  let dragging = $state(false);
  let restored = $state(false);
  /** the OPUS-MT route whose models the gate has loaded (so the visitor agreed to the download) */
  let readyRoute = $state('');
  let fileInput: HTMLInputElement;
  let controller: AbortController | null = null;

  const source = $derived(from === 'auto' ? detected : from);
  const gateKey = $derived(plan.kind === 'opus' ? plan.hops.map((h) => h.key).join('+') : '');
  const pct = $derived(total ? Math.round((done / total) * 100) : 0);
  const credits = $derived(used?.kind === 'opus' ? used.hops.map((h) => MODELS[h.key]) : []);

  onMount(() => {
    builtin = hasBuiltinTranslator();
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as { from?: string; to?: string } | null;
      if (saved?.from && (saved.from === 'auto' || normalizeLanguage(saved.from))) from = saved.from;
      if (saved?.to && normalizeLanguage(saved.to)) to = saved.to;
      else {
        const mine = normalizeLanguage(navigator.language);
        if (mine && mine !== 'en') to = mine;
      }
    } catch {
      // storage blocked: keep the defaults
    }
    restored = true;
    return () => {
      controller?.abort();
      worker.terminate();
    };
  });

  $effect(() => {
    const prefs = JSON.stringify({ from, to });
    if (!restored) return;
    try {
      localStorage.setItem(PREFS, prefs);
    } catch {
      // not important
    }
  });

  // detect the source language a moment after typing stops
  $effect(() => {
    if (from !== 'auto') return;
    const text = input.trim();
    if (!text) {
      detected = null;
      return;
    }
    detecting = true;
    const timer = setTimeout(async () => {
      const code = await detectLanguage(text);
      if (input.trim() !== text) return;
      detected = code;
      detecting = false;
    }, 350);
    return () => clearTimeout(timer);
  });

  // which engine can do this pair: the browser's own translator first, then the open models
  $effect(() => {
    const [s, t] = [source, to];
    if (!s) return void (plan = { kind: 'wait' });
    if (s === t) return void (plan = { kind: 'same' });
    let stale = false;
    if (hasBuiltinTranslator()) plan = { kind: 'checking' };
    (async () => {
      const status = hasBuiltinTranslator() ? await builtinAvailability(s, t) : 'unavailable';
      if (stale) return;
      const hops = opusRoute(s, t);
      plan = status !== 'unavailable' ? { kind: 'builtin', status } : hops ? { kind: 'opus', hops } : { kind: 'none' };
    })();
    return () => {
      stale = true;
    };
  });

  function loadModels({ models, onProgress, signal }: GateLoadContext) {
    const want = models.map(({ key, variant, device }) => ({ key, variant, device }));
    return worker.call((api) => api.load(want, proxy(onProgress)), signal);
  }

  function explain(err: unknown): string {
    if ((err as Error)?.name === 'NotAllowedError') return 'Your browser needs a click to download this language pack. Press Translate again.';
    const e = toAiError(err);
    if (e.code === 'out-of-memory') return 'Your device ran out of memory. Try translating a shorter piece of text.';
    if (e.code === 'failed') return "The translation didn't work. Try again, or translate a shorter piece of text.";
    return e.message;
  }

  async function translate() {
    const s = source;
    const current = plan;
    // Ctrl+Enter gets here without the gate's button: never start a model download the visitor hasn't agreed to
    if (!s || !input.trim() || busy || (current.kind !== 'builtin' && (current.kind !== 'opus' || readyRoute !== gateKey))) return;
    const ctl = (controller = new AbortController());
    const { signal } = ctl;
    busy = true;
    error = '';
    output = '';
    used = null;
    done = total = 0;
    try {
      let tr: (texts: string[]) => Promise<string[]>;
      if (current.kind === 'builtin') {
        pack = current.status === 'available' ? null : 0;
        const t = await builtinTranslator(s, to, (f) => (pack = Math.round(f * 100)), signal);
        pack = null;
        tr = async (texts) => {
          total += texts.length;
          const out: string[] = [];
          for (const text of texts) {
            signal.throwIfAborted();
            out.push(await t.translate(text, { signal }));
            done++;
          }
          return out;
        };
      } else {
        const hops = $state.snapshot(current.hops);
        tr = async (texts) => {
          total += texts.length;
          const out: string[] = [];
          for (let i = 0; i < texts.length; i += BATCH) {
            signal.throwIfAborted();
            out.push(...(await worker.call((api) => api.translate(hops, texts.slice(i, i + BATCH)))));
            done = Math.min(total, done + BATCH);
          }
          return out;
        };
      }
      const doc = prepare(input, { markdown, lang: s, ...(current.kind === 'builtin' ? { maxChars: 1500, group: true } : { maxChars: 400 }) });
      const result = await translateDoc(doc, tr, to);
      signal.throwIfAborted();
      output = result;
      used = current.kind === 'builtin' ? { kind: 'builtin' } : { kind: 'opus', hops: current.hops };
      if (current.kind === 'builtin' && plan === current) plan = { kind: 'builtin', status: 'available' };
    } catch (err) {
      if (!signal.aborted) error = explain(err);
    } finally {
      if (controller === ctl) controller = null;
      busy = false;
      pack = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  function swap() {
    const s = source;
    if (!s || busy) return;
    [from, to] = [to, s];
    if (output) [input, output] = [output, ''];
  }

  async function open(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE) return void (error = 'That file is over 5 MB. Split it into smaller parts first.');
    input = await file.text();
    fileName = file.name;
    markdown = /\.(md|markdown|mdx)$/i.test(file.name);
    output = error = '';
    used = null;
  }

  function download() {
    const ext = markdown ? 'md' : 'txt';
    const name = fileName ? withSuffix(fileName, `.${to}`) : `translation-${to}.${ext}`;
    downloadBlob(new Blob([output], { type: markdown ? 'text/markdown' : 'text/plain' }), name);
  }

  function clear() {
    input = output = error = '';
    fileName = null;
    used = null;
  }
</script>

{#snippet languageOptions()}
  {#each LANGUAGES as l (l.code)}
    <option value={l.code}>{l.name}</option>
  {/each}
{/snippet}

{#snippet actions()}
  <div class="actions">
    {#if busy}
      <button type="button" class="btn" onclick={cancel}>Cancel</button>
    {:else}
      <button type="button" class="btn btn-ai" disabled={!input.trim() || (plan.kind !== 'builtin' && plan.kind !== 'opus')} onclick={translate}>
        Translate{source && source !== to ? ` to ${languageName(to)}` : ''}
      </button>
    {/if}
    <span class="mono" role="status" aria-live="polite">
      {#if pack !== null}your browser is downloading the {languageName(source ?? '')} → {languageName(to)} language pack · {pack}%
      {:else if busy}translating{total ? ` · ${done} of ${total} ${total === 1 ? 'part' : 'parts'}` : '…'}
      {:else if output}done · AI translation, so check anything important{/if}
    </span>
  </div>
  {#if busy}
    <div class="bar" aria-hidden="true"><span style={`width: ${pack ?? pct}%`}></span></div>
  {/if}
{/snippet}

<div class="grid gap-4">
  <div class="langs">
    <label class="grow">
      <span class="label">from</span>
      <select class="field" bind:value={from} disabled={busy}>
        <option value="auto">{from === 'auto' && detected ? `Detected: ${languageName(detected)}` : 'Detect language'}</option>
        {@render languageOptions()}
      </select>
    </label>
    <button type="button" class="btn swap" onclick={swap} disabled={!source || busy} aria-label="Swap languages" title="Swap languages">⇄</button>
    <label class="grow">
      <span class="label">to</span>
      <select class="field" bind:value={to} disabled={busy}>
        {@render languageOptions()}
      </select>
    </label>
  </div>

  <div class="panes">
    <div
      class="pane card"
      class:dragging
      role="group"
      aria-label="Text to translate"
      ondragover={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        dragging = false;
        open(e.dataTransfer.files[0]);
      }}
    >
      <textarea
        class="text"
        bind:value={input}
        placeholder="Type or paste text, or drop a .txt or .md file here…"
        aria-label="Text to translate"
        dir="auto"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translate();
        }}
      ></textarea>
      <div class="foot">
        <span class="mono">{input.length.toLocaleString('en-US')} characters{fileName ? ` · ${fileName}` : ''}</span>
        <div class="flex flex-wrap items-center gap-2">
          <label class="mono check"><input type="checkbox" bind:checked={markdown} class="accent-(--color-ai)" /> Markdown</label>
          <button type="button" class="btn py-2! text-sm!" onclick={() => fileInput.click()}>Open file</button>
          {#if input}<button type="button" class="btn py-2! text-sm!" onclick={clear}>Clear</button>{/if}
        </div>
      </div>
    </div>

    <div class="pane card out" role="group" aria-label="Translation" aria-busy={busy}>
      <div class="text result" class:empty={!output} lang={output ? to : undefined} dir={output ? 'auto' : undefined}>{output || 'The translation appears here.'}</div>
      <div class="foot">
        <span class="mono">{output ? `${output.length.toLocaleString('en-US')} characters` : ''}</span>
        <div class="flex flex-wrap items-center gap-2">
          <CopyButton text={output} class="py-2! text-sm!" />
          <button type="button" class="btn py-2! text-sm!" disabled={!output} onclick={download}>Download</button>
        </div>
      </div>
    </div>
  </div>
  <input bind:this={fileInput} type="file" accept=".txt,.md,.markdown,.mdx,text/plain,text/markdown" hidden onchange={(e) => open(e.currentTarget.files?.[0])} />

  {#if plan.kind === 'opus'}
    {#key gateKey}
      <ModelGate model={plan.hops.map((h) => h.key)} light={null} load={loadModels} bind:ready={() => readyRoute === gateKey, (v) => (readyRoute = v ? gateKey : '')}>
        {#snippet children()}
          {@render actions()}
        {/snippet}
      </ModelGate>
    {/key}
    {#if plan.hops.length > 1 && source}
      <p class="note">There's no direct {languageName(source)} → {languageName(to)} model, so it translates through English with two models. That's slower and a little less accurate.</p>
    {/if}
  {:else}
    {@render actions()}
    {#if plan.kind === 'builtin'}
      <p class="chip mono"><span class="dot" aria-hidden="true"></span>your browser's built-in translator · runs on your device · nothing is uploaded</p>
      {#if plan.status !== 'available'}
        <p class="note">The first time, your browser downloads a language pack for {languageName(source ?? '')} → {languageName(to)}. It manages and keeps that pack itself.</p>
      {/if}
    {:else if plan.kind === 'wait'}
      <p class="note">
        {#if !input.trim()}Type or paste some text and the language is detected for you.
        {:else if detecting}Detecting the language…
        {:else}We can't tell the language yet. Type a little more, or pick it under “from”.{/if}
      </p>
    {:else if plan.kind === 'same'}
      <p class="note">That's already {languageName(to)}. Pick another language under “to”.</p>
    {:else if plan.kind === 'none'}
      <p class="note">
        {#if builtin}Your browser's built-in translator doesn't offer {languageName(source ?? '')} → {languageName(to)}, and our open models don't cover it either.
        {:else}{languageName(source ?? '')} → {languageName(to)} needs the translator built into Chrome or Edge on a computer.{/if}
        Here we can translate between English and {COVERED}.
      </p>
    {/if}
  {/if}

  {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

  {#if used}
    <p class="credit">
      {#if used.kind === 'builtin'}
        Machine translation by your browser's built-in, on-device translator.
      {:else}
        Machine translation by
        {#each credits as m, i (m.repo)}
          {i ? ' and ' : ''}<a href={`https://huggingface.co/${m.repo}`} target="_blank" rel="noopener noreferrer">{m.name}</a> by Helsinki-NLP, University of Helsinki
          (<a href={m.license.name === 'CC-BY-4.0' ? CC_BY : m.license.url} target="_blank" rel="noopener noreferrer">{m.license.name === 'CC-BY-4.0' ? 'CC BY 4.0' : m.license.name}</a>)
        {/each} in Xenova's quantized ONNX conversion, run on your device.
      {/if}
      AI can make mistakes; check anything important.
    </p>
  {/if}
</div>

<style>
  .langs {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: end;
    gap: 10px;
  }
  .swap {
    padding-inline: 14px;
    font-size: 18px;
  }
  .panes {
    display: grid;
    gap: 12px;
    @media (min-width: 900px) {
      grid-template-columns: 1fr 1fr;
    }
  }
  .pane {
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    overflow: hidden;
    transition: border-color 0.2s;
    &:focus-within,
    &.dragging {
      border-color: var(--color-sun);
    }
  }
  .out {
    border-color: color-mix(in srgb, var(--color-ai) 35%, var(--color-line-2));
    background:
      radial-gradient(120% 70% at 100% 0%, color-mix(in srgb, var(--color-ai) 7%, transparent), transparent 60%),
      var(--color-panel);
  }
  .text {
    width: 100%;
    min-height: 260px;
    max-height: 60vh;
    overflow: auto;
    padding: 18px 20px;
    font: 400 17px/1.6 var(--font-sans);
    color: var(--color-chalk);
    background: transparent;
    border: 0;
    resize: vertical;
    &:focus {
      outline: none;
    }
    &::placeholder {
      color: #6e6960;
    }
    @media (min-width: 900px) {
      min-height: 340px;
    }
  }
  .result {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    &.empty {
      color: #6e6960;
    }
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px 10px 20px;
    border-top: 1px solid var(--color-line);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .bar {
    height: 6px;
    margin-top: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    & span {
      display: block;
      height: 100%;
      background: var(--color-ai);
      transition: width 0.25s ease-out;
    }
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 99px;
    background: var(--color-ai);
    box-shadow: 0 0 10px var(--color-ai);
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
  }
  .credit {
    font-size: 13px;
    color: var(--color-muted);
    & a {
      color: var(--color-ai);
      text-decoration: underline dotted;
      text-underline-offset: 3px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pane,
    .bar span {
      transition: none;
    }
  }
</style>
