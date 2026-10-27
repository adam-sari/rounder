<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob, withExtension, withSuffix } from '@/tools/lib/files';
  import { isStopped, llmErrorMessage, type Llm } from '@/tools/lib/llm/engine';
  import LlmGate from '@/tools/lib/llm/LlmGate.svelte';
  import type { SummaryFormat, SummaryLength } from '@/tools/lib/llm/prompts';
  import { summarizeText, type Stage } from '@/tools/lib/llm/tasks';
  import { countWords } from '@/tools/lib/llm/text';
  import TextInput from '@/tools/lib/llm/TextInput.svelte';

  const FORMATS: [SummaryFormat, string][] = [
    ['paragraph', 'Paragraph'],
    ['points', 'Key points'],
    ['tldr', 'TL;DR'],
    ['headline', 'Headline'],
  ];
  const LENGTHS: SummaryLength[] = ['short', 'medium', 'long'];
  const MIN_WORDS = 25;

  let text = $state('');
  let name = $state('');
  let format = $state<SummaryFormat>('paragraph');
  let length = $state<SummaryLength>('medium');
  let output = $state('');
  let status = $state<'idle' | 'running' | 'done' | 'stopped' | 'error'>('idle');
  let stage = $state<Stage | null>(null);
  let error = $state('');
  let controller: AbortController | null = null;

  const words = $derived(countWords(text));
  const outWords = $derived(countWords(output));
  const fixedLength = $derived(format === 'tldr' || format === 'headline');
  const points = $derived(format === 'points' ? output.split('\n').map((l) => l.replace(/^-\s*/, '')).filter(Boolean) : []);
  const title = $derived(FORMATS.find(([f]) => f === format)![1]);

  async function run(llm: Llm) {
    controller?.abort();
    const ctl = (controller = new AbortController());
    status = 'running';
    output = error = '';
    stage = null;
    try {
      const result = await summarizeText(llm, text, { format, length }, {
        signal: ctl.signal,
        onText: (t) => ctl === controller && (output = t),
        onStage: (s) => ctl === controller && (stage = s),
      });
      if (ctl !== controller) return;
      output = result;
      status = 'done';
    } catch (err) {
      if (ctl !== controller) return;
      if (isStopped(err, ctl.signal)) status = 'stopped';
      else {
        console.error(err);
        error = llmErrorMessage(err);
        status = 'error';
      }
    } finally {
      if (ctl === controller) stage = null;
    }
  }

  function stop() {
    controller?.abort();
  }

  function reset() {
    controller?.abort();
    controller = null;
    text = name = output = error = '';
    status = 'idle';
  }

  function download() {
    downloadBlob(new Blob([`${output}\n`], { type: 'text/plain;charset=utf-8' }), name ? withSuffix(withExtension(name, 'txt'), '-summary') : 'summary.txt');
  }
</script>

<div class="grid gap-6">
  <TextInput bind:value={text} bind:name label="text to summarize" placeholder="Paste an article, report, essay or notes here…" disabled={status === 'running'} />

  <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
    <div>
      <span class="label">format</span>
      <div class="seg" role="group" aria-label="Summary format">
        {#each FORMATS as [value, label]}
          <button type="button" aria-pressed={format === value} onclick={() => (format = value)} disabled={status === 'running'}>{label}</button>
        {/each}
      </div>
    </div>
    <div>
      <span class="label">length</span>
      <div class="seg" role="group" aria-label="Summary length">
        {#each LENGTHS as value}
          <button type="button" aria-pressed={!fixedLength && length === value} onclick={() => (length = value)} disabled={fixedLength || status === 'running'}>{value}</button>
        {/each}
      </div>
    </div>
    {#if fixedLength}<p class="mono pb-2">{format === 'tldr' ? 'one sentence' : 'one line'}, whatever the length</p>{/if}
  </div>

  <LlmGate apis={['summarizer', 'prompt']}>
    {#snippet children(llm)}
      <div class="grid gap-4">
        <div class="flex flex-wrap items-center gap-3">
          {#if status === 'running'}
            <button type="button" class="btn" onclick={stop}>Stop</button>
          {:else}
            <button type="button" class="btn btn-primary" onclick={() => run(llm)} disabled={words < MIN_WORDS}>{status === 'done' ? 'Summarize again' : 'Summarize'}</button>
          {/if}
          <p class="mono" aria-live="polite">
            {#if status === 'running'}
              {stage ? `reading part ${stage.part} of ${stage.parts}…` : output ? 'writing…' : 'reading…'}
            {:else if words < MIN_WORDS}
              {words ? `add a few more sentences (at least ${MIN_WORDS} words)` : 'paste or open some text first'}
            {:else}
              {words.toLocaleString('en-US')} words in · any length works, long texts are summarized in parts
            {/if}
          </p>
        </div>

        {#if stage}
          <div class="bar" role="progressbar" aria-label="Reading long text" aria-valuemin={0} aria-valuemax={stage.parts} aria-valuenow={stage.part - 1}>
            <span style={`width: ${((stage.part - 1) / stage.parts) * 100}%`}></span>
          </div>
        {/if}

        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

        {#if output || status === 'running'}
          <section class="out card" aria-live={status === 'running' ? 'off' : 'polite'} aria-busy={status === 'running'}>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="text-2xl">{title}</h3>
              {#if outWords}<span class="mono">{outWords} words{words ? ` · ${Math.max(0, Math.round((1 - outWords / words) * 100))}% shorter` : ''}</span>{/if}
            </div>
            {#if format === 'points' && points.length}
              <ul class="points">
                {#each points as point}<li>{point}</li>{/each}
              </ul>
            {:else if format === 'headline'}
              <p class="headline">{output}</p>
            {:else}
              <div class="prose">{output}{#if status === 'running'}<span class="caret" aria-hidden="true"></span>{/if}</div>
            {/if}
            {#if status === 'stopped'}<p class="mono">stopped · this is what was written so far</p>{/if}
            {#if status !== 'running'}
              <div class="flex flex-wrap gap-2">
                <CopyButton text={output} />
                <button type="button" class="btn" onclick={download}>Download .txt</button>
                <button type="button" class="btn" onclick={reset}>Start over</button>
              </div>
            {/if}
            <p class="fine">Written by AI on your device. It can miss or misread things, so check names, numbers and quotes against the original.</p>
          </section>
        {/if}
      </div>
    {/snippet}
  </LlmGate>
</div>

<style>
  .out {
    display: grid;
    gap: 14px;
    padding: clamp(16px, 3vw, 24px);
    border-color: color-mix(in srgb, var(--color-ai) 30%, var(--color-line-2));
  }
  .prose {
    white-space: pre-wrap;
    font-size: 17px;
    line-height: 1.6;
  }
  .headline {
    font: 400 clamp(26px, 4vw, 34px) / 1.15 var(--font-serif);
  }
  .points {
    display: grid;
    gap: 8px;
    font-size: 17px;
    line-height: 1.5;
    & li {
      position: relative;
      padding-left: 22px;
    }
    & li::before {
      content: '';
      position: absolute;
      left: 4px;
      top: 0.62em;
      width: 7px;
      height: 7px;
      border-radius: 99px;
      background: var(--color-ai);
    }
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
  .bar {
    position: relative;
    height: 6px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    & span {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--color-ai);
      transition: width 0.3s ease-out;
    }
  }
  .fine {
    font-size: 13px;
    color: var(--color-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
    .bar span {
      transition: none;
    }
  }
</style>
