<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { applyEdits, editSegments, type Edit } from '@/tools/lib/llm/diff';
  import { isStopped, llmErrorMessage, type Llm } from '@/tools/lib/llm/engine';
  import LlmGate from '@/tools/lib/llm/LlmGate.svelte';
  import { applyFixes, excerpt, quickCheck, type Issue } from '@/tools/lib/llm/quick-checks';
  import { proofreadText, type Stage } from '@/tools/lib/llm/tasks';
  import TextInput from '@/tools/lib/llm/TextInput.svelte';

  const uid = $props.id();
  let text = $state('');
  /** the text the AI checked, so the review stays put while the box is edited */
  let source = $state('');
  let corrected = $state('');
  let status = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  let stage = $state<Stage | null>(null);
  let error = $state('');
  let rejected = $state(new Set<number>());
  let controller: AbortController | null = null;

  const issues = $derived(quickCheck(text));
  const segments = $derived(status === 'done' ? editSegments(source, corrected) : []);
  const edits = $derived(segments.filter((s): s is Edit => s.kind === 'edit'));
  const result = $derived(applyEdits(segments, rejected));

  async function run(llm: Llm) {
    controller?.abort();
    const ctl = (controller = new AbortController());
    source = text;
    corrected = error = '';
    rejected = new Set();
    status = 'running';
    try {
      const out = await proofreadText(llm, source, {
        signal: ctl.signal,
        onText: (t) => ctl === controller && (corrected = t),
        onStage: (s) => ctl === controller && (stage = s),
      });
      if (ctl !== controller) return;
      corrected = out;
      status = 'done';
    } catch (err) {
      if (ctl !== controller) return;
      if (isStopped(err, ctl.signal)) status = 'idle';
      else {
        console.error(err);
        error = llmErrorMessage(err);
        status = 'error';
      }
    } finally {
      if (ctl === controller) stage = null;
    }
  }

  function toggle(id: number) {
    const next = new Set(rejected);
    if (!next.delete(id)) next.add(id);
    rejected = next;
  }

  function fix(issue: Issue) {
    text = applyFixes(text, [issue]);
  }

  function useResult() {
    text = result;
    status = 'idle';
  }

  /** whitespace-only edits made visible: · for a space, ↵ for a line break */
  const show = (s: string) => (s.trim() ? s : s.replace(/ /g, '·').replace(/\n/g, '↵\n'));
</script>

<div class="grid gap-6">
  <TextInput bind:value={text} label="your text" placeholder="Paste or type the text you want checked…" disabled={status === 'running'} />

  <section class="card panel" aria-labelledby={`${uid}-quick`}>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${uid}-quick`} class="text-2xl">Quick checks <span class="mono">· instant, no AI</span></h3>
      {#if issues.length > 1}<button type="button" class="btn py-2! text-sm!" onclick={() => (text = applyFixes(text, issues))}>Fix all {issues.length}</button>{/if}
    </div>
    {#if !text.trim()}
      <p class="text-soft">Repeated words, extra spaces, a/an, spacing around punctuation, common mix-ups (“could of”, “more then”) and misspellings show up here as you type.</p>
    {:else if !issues.length}
      <p class="text-soft">No quick-check issues. For grammar and wording, run the AI proofread below.</p>
    {:else}
      <ul class="issues">
        {#each issues.slice(0, 100) as issue (`${issue.start}:${issue.kind}`)}
          {@const x = excerpt(text, issue)}
          <li>
            <div class="grid gap-1">
              <span class="text-sm">{issue.message}</span>
              <span class="mono ctx">{x.before}<del>{x.target.replace(/ /g, '·')}</del><ins>{issue.replacement.replace(/ /g, '·')}</ins>{x.after}</span>
            </div>
            <button type="button" class="btn py-2! text-sm!" onclick={() => fix(issue)}>Fix</button>
          </li>
        {/each}
      </ul>
      {#if issues.length > 100}<p class="mono">and {issues.length - 100} more · fix these to see the rest</p>{/if}
    {/if}
  </section>

  <LlmGate apis={['proofreader', 'prompt']}>
    {#snippet children(llm)}
      <div class="grid gap-4">
        <div class="flex flex-wrap items-center gap-3">
          {#if status === 'running'}
            <button type="button" class="btn" onclick={() => controller?.abort()}>Stop</button>
            <p class="mono" aria-live="polite">{stage ? `proofreading part ${stage.part} of ${stage.parts}…` : 'proofreading…'}</p>
          {:else}
            <button type="button" class="btn btn-primary" onclick={() => run(llm)} disabled={!text.trim()}>{status === 'done' ? 'Proofread again' : 'Proofread with AI'}</button>
            <p class="mono">spelling, grammar, punctuation · you accept or reject each change</p>
          {/if}
        </div>
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

        {#if status === 'running' && corrected}
          <section class="card panel preview" aria-busy="true">
            <span class="label">corrected text, as it's written</span>
            <div class="prose">{corrected}</div>
          </section>
        {/if}

        {#if status === 'done'}
          <section class="card panel" aria-labelledby={`${uid}-ai`}>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${uid}-ai`} class="text-2xl">
                {edits.length ? `${edits.length} suggested change${edits.length === 1 ? '' : 's'}` : 'No changes suggested'}
                {#if edits.length}<span class="mono">· {edits.length - rejected.size} accepted</span>{/if}
              </h3>
              {#if edits.length > 1}
                <div class="flex gap-2">
                  <button type="button" class="btn py-2! text-sm!" onclick={() => (rejected = new Set())}>Accept all</button>
                  <button type="button" class="btn py-2! text-sm!" onclick={() => (rejected = new Set(edits.map((e) => e.id)))}>Reject all</button>
                </div>
              {/if}
            </div>
            {#if text !== source}<p class="mono warn">your text changed since this check · using the result replaces it with the checked version</p>{/if}
            {#if edits.length}
              <div class="prose">
                {#each segments as s}{#if s.kind === 'same'}{s.text}{:else}<span class="edit" class:off={rejected.has(s.id)}
                      >{#if s.from}<del>{show(s.from)}</del>{/if}{#if s.to}<ins>{show(s.to)}</ins>{/if}<button
                        type="button"
                        class="toggle"
                        aria-pressed={!rejected.has(s.id)}
                        aria-label={`${rejected.has(s.id) ? 'Accept' : 'Reject'} change from “${s.from.trim() || 'nothing'}” to “${s.to.trim() || 'nothing'}”`}
                        title={rejected.has(s.id) ? 'Rejected: click to accept' : 'Accepted: click to reject'}
                        onclick={() => toggle(s.id)}>{rejected.has(s.id) ? '✗' : '✓'}</button
                      ></span
                    >{/if}{/each}
              </div>
              <div class="flex flex-wrap gap-2">
                <CopyButton text={result} label="Copy corrected text" />
                <button type="button" class="btn" onclick={useResult}>Put it in the box</button>
              </div>
            {:else}
              <p class="text-soft">The AI found nothing to fix. It can miss mistakes, so the quick checks above are worth a look too.</p>
            {/if}
            <p class="fine">Suggestions come from AI on your device. They can be wrong or change your meaning, so accept only what you agree with.</p>
          </section>
        {/if}
      </div>
    {/snippet}
  </LlmGate>
</div>

<style>
  .panel {
    display: grid;
    gap: 14px;
    padding: clamp(16px, 3vw, 24px);
  }
  .preview {
    opacity: 0.75;
  }
  .prose {
    white-space: pre-wrap;
    font-size: 16px;
    line-height: 1.8;
  }
  .issues {
    display: grid;
    gap: 8px;
    max-height: 420px;
    overflow-y: auto;
    & li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--color-line-2);
      border-radius: 12px;
    }
  }
  .ctx {
    overflow-wrap: anywhere;
  }
  del {
    color: var(--color-bad);
    text-decoration-thickness: 1.5px;
  }
  ins {
    color: var(--color-ok);
    text-decoration: none;
  }
  .edit {
    padding: 1px 2px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--color-ai) 12%, transparent);
    & del {
      margin-right: 3px;
    }
    &.off {
      background: none;
      & ins {
        color: var(--color-muted);
        text-decoration: line-through;
      }
      & del {
        color: inherit;
        text-decoration: none;
      }
    }
  }
  .toggle {
    margin-left: 4px;
    width: 22px;
    height: 22px;
    font: 500 12px/1 var(--font-sans);
    color: var(--color-bg);
    background: var(--color-ok);
    border: 0;
    border-radius: 99px;
    cursor: pointer;
    vertical-align: 1px;
    .off & {
      color: var(--color-chalk);
      background: var(--color-panel-2);
      box-shadow: inset 0 0 0 1px var(--color-line-2);
    }
  }
  .warn {
    color: var(--color-sun);
  }
  .fine {
    font-size: 13px;
    color: var(--color-muted);
  }
</style>
