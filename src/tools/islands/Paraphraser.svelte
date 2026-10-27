<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { changedShare, changedSpans, editSegments, highlightRuns } from '@/tools/lib/llm/diff';
  import { isStopped, llmErrorMessage, type Llm } from '@/tools/lib/llm/engine';
  import LlmGate from '@/tools/lib/llm/LlmGate.svelte';
  import { alternativesPrompt, MODES, type Mode } from '@/tools/lib/llm/prompts';
  import { paraphraseText, type Stage } from '@/tools/lib/llm/tasks';
  import { countWords, parseAlternatives, splitSentences } from '@/tools/lib/llm/text';
  import TextInput from '@/tools/lib/llm/TextInput.svelte';

  const uid = $props.id();
  let text = $state('');
  let mode = $state<Mode>('standard');
  /** the text the current result was rewritten from */
  let source = $state('');
  let output = $state('');
  let status = $state<'idle' | 'running' | 'done' | 'stopped' | 'error'>('idle');
  let stage = $state<Stage | null>(null);
  let error = $state('');
  let highlight = $state(true);
  let controller: AbortController | null = null;

  // alternatives for one sentence of the result
  let picked = $state<number | null>(null);
  let alts = $state<string[]>([]);
  let altBusy = $state(false);
  let altError = $state('');
  let altController: AbortController | null = null;

  const finished = $derived(status === 'done' || status === 'stopped');
  const segments = $derived(finished ? editSegments(source, output) : []);
  const spans = $derived(changedSpans(segments));
  const share = $derived(changedShare(segments));
  const sentences = $derived(finished ? splitSentences(output).map((s) => ({ ...s, end: s.start + output.slice(s.start, s.end).trimEnd().length, next: s.end })) : []);
  const pickedText = $derived(picked === null ? '' : output.slice(sentences[picked].start, sentences[picked].end));

  async function run(llm: Llm) {
    controller?.abort();
    closeAlts();
    const ctl = (controller = new AbortController());
    source = text;
    status = 'running';
    output = error = '';
    try {
      const result = await paraphraseText(llm, source, mode, {
        signal: ctl.signal,
        onText: (t) => ctl === controller && (output = t),
        onStage: (s) => ctl === controller && (stage = s),
      });
      if (ctl !== controller) return;
      output = result;
      status = 'done';
    } catch (err) {
      if (ctl !== controller) return;
      if (isStopped(err, ctl.signal)) status = output ? 'stopped' : 'idle';
      else {
        console.error(err);
        error = llmErrorMessage(err);
        status = 'error';
      }
    } finally {
      if (ctl === controller) stage = null;
    }
  }

  async function alternatives(llm: Llm, index: number) {
    altController?.abort();
    const ctl = (altController = new AbortController());
    picked = index;
    alts = [];
    altError = '';
    altBusy = true;
    const sentence = output.slice(sentences[index].start, sentences[index].end);
    try {
      const raw = await llm.generate!({
        ...alternativesPrompt(mode, sentence),
        lang: await llm.language(sentence),
        signal: ctl.signal,
        onText: (t) => ctl === altController && (alts = parseAlternatives(t, sentence)),
      });
      if (ctl !== altController) return;
      alts = parseAlternatives(raw, sentence);
      if (!alts.length) altError = "The model didn't come up with other versions. Try again.";
    } catch (err) {
      if (ctl === altController && !isStopped(err, ctl.signal)) altError = llmErrorMessage(err);
    } finally {
      if (ctl === altController) altBusy = false;
    }
  }

  function useAlt(alt: string) {
    if (picked === null) return;
    const s = sentences[picked];
    output = output.slice(0, s.start) + alt + output.slice(s.end);
    closeAlts();
  }

  function closeAlts() {
    altController?.abort();
    picked = null;
    alts = [];
    altBusy = false;
    altError = '';
  }

  function reset() {
    controller?.abort();
    closeAlts();
    text = source = output = error = '';
    status = 'idle';
  }
</script>

<div class="grid gap-6">
  <div>
    <span class="label">mode</span>
    <div class="seg" role="group" aria-label="Paraphrasing mode">
      {#each Object.entries(MODES) as [value, m]}
        <button type="button" aria-pressed={mode === value} onclick={() => (mode = value as Mode)} disabled={status === 'running'}>{m.label}</button>
      {/each}
    </div>
    <p class="mono mt-2">{MODES[mode].label}: {MODES[mode].hint}</p>
  </div>

  <div class="grid items-start gap-4 lg:grid-cols-2">
    <TextInput bind:value={text} label="original" placeholder="Paste a sentence, paragraph or whole essay…" disabled={status === 'running'} />
    <LlmGate apis={['prompt']}>
      {#snippet children(llm)}
        <div class="grid gap-4">
          <section class="out card" aria-labelledby={`${uid}-out`} aria-busy={status === 'running'}>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`${uid}-out`} class="label mb-0!">rewritten · {MODES[mode].label.toLowerCase()}</h3>
              {#if finished}
                <label class="mono flex items-center gap-2"><input type="checkbox" bind:checked={highlight} /> highlight changes</label>
              {/if}
            </div>
            {#if finished}
              <div class="result">
                {#each sentences as s, i}{#if s.end > s.start}<span
                    class="sent"
                    class:active={picked === i}
                    role="button"
                    tabindex="0"
                    aria-label={`Other ways to say: ${output.slice(s.start, s.end)}`}
                    onclick={() => alternatives(llm, i)}
                    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), alternatives(llm, i))}
                    >{#each highlightRuns(output, spans, s.start, s.end) as r}{#if r.changed && highlight}<mark>{r.text}</mark>{:else}{r.text}{/if}{/each}</span
                    >{/if}{output.slice(s.end, s.next)}{/each}
              </div>
              <p class="mono">
                {countWords(output)} words (was {countWords(source)}){status === 'done' ? ` · ${Math.round(share * 100)}% of the original words changed` : ''} · click a sentence for other versions
              </p>
            {:else if output}
              <div class="result">{output}<span class="caret" aria-hidden="true"></span></div>
            {:else}
              <p class="empty">{status === 'running' ? 'Thinking…' : 'Your rewrite appears here, word by word.'}</p>
            {/if}
          </section>

          <div class="flex flex-wrap items-center gap-3">
            {#if status === 'running'}
              <button type="button" class="btn" onclick={() => controller?.abort()}>Stop</button>
              <p class="mono" aria-live="polite">{stage ? `rewriting part ${stage.part} of ${stage.parts}…` : 'rewriting…'}</p>
            {:else}
              <button type="button" class="btn btn-primary" onclick={() => run(llm)} disabled={!text.trim()}>{finished ? 'Rewrite again' : 'Paraphrase'}</button>
              {#if finished}
                <CopyButton text={output} />
                <button type="button" class="btn" onclick={() => (text = output)}>Use as original</button>
                <button type="button" class="btn" onclick={reset}>Start over</button>
              {/if}
            {/if}
          </div>
          {#if status === 'stopped'}<p class="mono">stopped · the rest of the text wasn't rewritten</p>{/if}
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

          {#if picked !== null}
            <section class="alts card" aria-live="polite" aria-busy={altBusy}>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <span class="label">other ways to say</span>
                  <p class="text-soft">“{pickedText}”</p>
                </div>
                <button type="button" class="btn py-2! text-sm!" onclick={closeAlts}>Close</button>
              </div>
              {#if alts.length}
                <ul class="grid gap-2">
                  {#each alts as alt}
                    <li class="alt">
                      <span>{alt}</span>
                      {#if !altBusy}<button type="button" class="btn py-2! text-sm!" onclick={() => useAlt(alt)}>Use this</button>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if altBusy && !alts.length}<p class="mono">writing alternatives…</p>{/if}
              {#if altError}<p class="text-sm text-bad" role="alert">{altError}</p>{/if}
              {#if !altBusy}<button type="button" class="btn justify-self-start py-2! text-sm!" onclick={() => alternatives(llm, picked!)}>More options</button>{/if}
            </section>
          {/if}

          <p class="fine">Rewritten by AI on your device. It can change the meaning or get facts wrong, so read it through before you use it.</p>
        </div>
      {/snippet}
    </LlmGate>
  </div>
</div>

<style>
  .out {
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 16px;
    min-height: 260px;
    border-color: color-mix(in srgb, var(--color-ai) 30%, var(--color-line-2));
  }
  .result {
    white-space: pre-wrap;
    font-size: 16px;
    line-height: 1.65;
  }
  .empty {
    color: var(--color-muted);
  }
  .sent {
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.15s;
    &:hover,
    &:focus-visible,
    &.active {
      background: color-mix(in srgb, var(--color-ai) 14%, transparent);
    }
    &:focus-visible {
      outline: 2px solid var(--color-ai);
      outline-offset: 1px;
    }
  }
  mark {
    color: inherit;
    background: none;
    text-decoration: underline 2px color-mix(in srgb, var(--color-ai) 80%, transparent);
    text-underline-offset: 4px;
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-left: 2px;
    vertical-align: -0.12em;
    background: var(--color-ai);
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .alts {
    display: grid;
    gap: 12px;
    padding: 16px;
  }
  .alt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
  }
  .fine {
    font-size: 13px;
    color: var(--color-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
    .sent {
      transition: none;
    }
  }
</style>
