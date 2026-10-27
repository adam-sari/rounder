<script lang="ts">
  /*
   * Text to speech: one text box, two engines. "AI voice" runs Kokoro 82M on the device (natural,
   * exportable); "Basic" uses the browser's built-in voices (instant, nothing to download, can't
   * be saved). The panels mount after hydration, so remembered choices never fight the SSR markup.
   */
  import { onMount } from 'svelte';
  import { formatSpoken, SAMPLE_TEXT, textStats } from '@/tools/lib/text-to-speech/text';
  import { loadPrefs, savePrefs, type Prefs } from '@/tools/lib/text-to-speech/voices';
  import TextToSpeechAi from './TextToSpeechAi.svelte';
  import TextToSpeechBasic from './TextToSpeechBasic.svelte';

  const uid = $props.id();
  let text = $state('');
  let mode = $state<Prefs['mode']>('ai');
  let mounted = $state(false);
  const stats = $derived(textStats(text));

  onMount(() => {
    mode = loadPrefs().mode ?? 'ai';
    mounted = true;
  });

  function pick(m: Prefs['mode']) {
    mode = m;
    savePrefs({ mode: m });
  }
</script>

<div class="grid gap-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="seg modes" role="group" aria-label="Voice engine">
      <button type="button" aria-pressed={mode === 'ai'} onclick={() => pick('ai')}>AI voice · natural</button>
      <button type="button" aria-pressed={mode === 'basic'} onclick={() => pick('basic')}>Basic · instant</button>
    </div>
    <p class="mono">
      {mode === 'ai' ? 'Kokoro AI model on your device · MP3 & WAV export' : "your browser's built-in voices · play only, no download"}
    </p>
  </div>

  <div>
    <div class="flex flex-wrap items-end justify-between gap-2">
      <label class="label mb-0!" for={`${uid}-text`}>your text</label>
      <div class="flex gap-2">
        {#if text}
          <button type="button" class="link mono" onclick={() => (text = '')}>clear</button>
        {:else}
          <button type="button" class="link mono" onclick={() => (text = SAMPLE_TEXT)}>try a sample</button>
        {/if}
      </div>
    </div>
    <textarea
      id={`${uid}-text`}
      class="field mt-1.5 min-h-[240px]! font-sans! text-base! leading-relaxed!"
      bind:value={text}
      placeholder="Type or paste anything: an article, a script, a chapter. There's no length limit."
      spellcheck="true"
    ></textarea>
    <p class="mono mt-1.5">
      {stats.chars.toLocaleString('en-US')} characters · {stats.words.toLocaleString('en-US')} words{#if stats.words}
        · about {formatSpoken(stats.seconds)} of speech at 1×{/if} · no limits
    </p>
  </div>

  {#if mounted}
    {#if mode === 'ai'}
      <TextToSpeechAi {text} />
    {:else}
      <TextToSpeechBasic {text} />
    {/if}
  {/if}
</div>

<style>
  .modes button[aria-pressed='true'] {
    background: var(--color-ai);
  }
  .link {
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 4px;
    &:hover {
      color: var(--color-chalk);
    }
  }
</style>
