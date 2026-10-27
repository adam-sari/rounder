<script lang="ts">
  /*
   * Basic mode: the browser's own voices (Web Speech API). Instant, no download, but the sound
   * goes straight to the speakers, so it can't be saved. Text is queued sentence by sentence,
   * which also avoids Chrome cutting long utterances off after ~15 seconds.
   */
  import { onMount } from 'svelte';
  import { splitParagraphs, splitSentences } from '@/tools/lib/text-to-speech/text';
  import { loadPrefs, MAX_SPEED, MIN_SPEED, savePrefs } from '@/tools/lib/text-to-speech/voices';

  let { text }: { text: string } = $props();
  const uid = $props.id();

  let supported = $state(true);
  let voices = $state.raw<SpeechSynthesisVoice[]>([]);
  let voiceURI = $state(loadPrefs().basicVoice ?? '');
  let rate = $state(1);
  let status = $state<'idle' | 'speaking' | 'paused'>('idle');
  let current = $state('');
  let error = $state('');
  /** online voices send the text to the browser maker, so they're opt-in */
  let online = $state(false);
  let run = 0;

  const usable = $derived(voices.filter((v) => v.localService || online));

  const voice = $derived(usable.find((v) => v.voiceURI === voiceURI));
  const langName = (lang: string) => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
    } catch {
      return lang;
    }
  };
  /** voices grouped by language, the visitor's own language first */
  const groups = $derived.by(() => {
    const mine = (navigator.language || 'en').split('-')[0];
    const map = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of usable) map.set(langName(v.lang), [...(map.get(langName(v.lang)) ?? []), v]);
    const rank = (list: SpeechSynthesisVoice[]) => (list[0].lang.startsWith(mine) ? 0 : list[0].lang.startsWith('en') ? 1 : 2);
    return [...map].sort(([a, x], [b, y]) => rank(x) - rank(y) || a.localeCompare(b));
  });

  onMount(() => {
    if (!('speechSynthesis' in window)) {
      supported = false;
      return;
    }
    const synth = window.speechSynthesis;
    const refresh = () => {
      // some engines list a voice twice; the keyed list below needs each URI once
      voices = [...new Map(synth.getVoices().map((v) => [v.voiceURI, v])).values()];
      // online voices stay opt-in even when they're all there is (then the box below explains)
      if (voices.length && !voices.some((v) => v.voiceURI === voiceURI && (v.localService || online))) {
        const lang = navigator.language || 'en-US';
        const pick = voices.find((v) => v.localService && v.lang === lang) ?? voices.find((v) => v.localService && v.lang.startsWith(lang.split('-')[0])) ?? voices.find((v) => v.localService);
        if (pick) voiceURI = pick.voiceURI;
      }
    };
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => {
      synth.removeEventListener('voiceschanged', refresh);
      run++;
      synth.cancel();
    };
  });

  // hiding online voices again moves the choice to one that is still listed
  $effect(() => {
    if (usable.length && !voice) voiceURI = usable[0].voiceURI;
  });

  $effect(() => {
    if (voiceURI) savePrefs({ basicVoice: voiceURI });
  });

  function speak() {
    const synth = window.speechSynthesis;
    synth.cancel();
    error = '';
    const my = ++run;
    const pieces = splitParagraphs(text).flatMap((p) => splitSentences(p, 200));
    pieces.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = rate;
      u.onstart = () => my === run && (current = piece);
      u.onend = () => {
        if (my === run && i === pieces.length - 1) stop();
      };
      u.onerror = (e) => {
        if (my !== run || e.error === 'canceled' || e.error === 'interrupted') return;
        error = e.error === 'network' ? "This online voice couldn't be reached. Pick one that isn't marked online." : `Your browser couldn't speak this (${e.error}). Try another voice.`;
        stop();
      };
      synth.speak(u);
    });
    status = pieces.length ? 'speaking' : 'idle';
  }

  function pause() {
    window.speechSynthesis.pause();
    status = 'paused';
  }

  function resume() {
    window.speechSynthesis.resume();
    status = 'speaking';
  }

  function stop() {
    run++;
    const synth = window.speechSynthesis;
    // Chrome stays paused after cancel(), so the next Play would stay silent
    if (synth.paused) synth.resume();
    synth.cancel();
    status = 'idle';
    current = '';
  }
</script>

{#if !supported}
  <p class="note">This browser has no built-in speech voices. Switch to the AI voice, which works in any modern browser.</p>
{:else}
  <div class="grid gap-5">
    <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
      <label class="grid min-w-[240px] flex-[2] gap-1.5">
        <span class="label mb-0!">voice · {usable.length} available</span>
        <select class="field" bind:value={voiceURI} disabled={!usable.length}>
          {#if !usable.length}<option value="">{voices.length ? 'no voices on this device: see below' : 'loading voices…'}</option>{/if}
          {#each groups as [lang, list] (lang)}
            <optgroup label={lang}>
              {#each list as v (v.voiceURI)}
                <option value={v.voiceURI}>{v.name}{v.localService ? '' : ' · online'}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <label class="grid min-w-[200px] flex-1 gap-1.5">
        <span class="label mb-0!">speed · {rate.toFixed(2)}×</span>
        <input type="range" min={MIN_SPEED} max={MAX_SPEED} step="0.05" bind:value={rate} class="w-full accent-(--color-ai)" aria-describedby={`${uid}-rate`} />
        <span id={`${uid}-rate`} class="mono">applies from the next play</span>
      </label>
    </div>

    {#if voices.some((v) => !v.localService)}
    <label class="mono flex items-center gap-2">
      <input type="checkbox" bind:checked={online} class="accent-(--color-ai)" />
      also show online voices (they send your text to your browser's maker to be spoken)
    </label>
    {/if}

    {#if voices.length && !usable.length}
      <p class="note">This browser only has online voices. Tick the box above to use them, or switch to the AI voice, which stays on your device.</p>
    {:else if voice && !voice.localService}
      <p class="note">
        "{voice.name}" is an online voice: your browser sends the text to its maker's servers to speak it. Pick a voice without "online" to keep everything on this
        device.
      </p>
    {/if}

    <div class="flex flex-wrap items-center gap-2">
      {#if status === 'idle'}
        <button type="button" class="btn btn-primary" disabled={!text.trim() || !voice} onclick={speak}>Play</button>
      {:else}
        <button type="button" class="btn btn-primary" onclick={status === 'paused' ? resume : pause}>{status === 'paused' ? 'Resume' : 'Pause'}</button>
        <button type="button" class="btn" onclick={stop}>Stop</button>
      {/if}
      <p class="mono">Basic voices play right away but can't be downloaded. For MP3 or WAV, use the AI voice.</p>
    </div>

    {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
    {#if current}
      <p class="now" aria-live="polite"><span class="label">now reading</span>{current}</p>
    {/if}
  </div>
{/if}

<style>
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
  }
  .now {
    font: 400 22px/1.35 var(--font-serif);
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel);
  }
</style>
