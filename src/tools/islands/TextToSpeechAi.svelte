<script lang="ts">
  /*
   * Kokoro mode. The text becomes paragraphs of sentences; a worker speaks them one by one in
   * order while playback follows right behind (it waits when it catches up). Each paragraph keeps
   * the voice and speed it was made with, so one can be redone in another voice. "Update speech"
   * reuses every sentence whose text, voice and speed didn't change.
   */
  import { onDestroy } from 'svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { detectDevice } from '@/engines/ai/device';
  import { pickVariant, totalDownloadSize } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { VENDOR } from '@/engines/ai/vendor.generated';
  import { modelWorker, proxy } from '@/engines/ai/worker-utils';
  import { writeWav } from '@/engines/media/dsp';
  import { formatTime } from '@/engines/media/math';
  import { downloadBlob } from '@/tools/lib/files';
  import { fileStem, joinAudio, PAUSE, SAMPLE_RATE, splitParagraphs, splitSentences } from '@/tools/lib/text-to-speech/text';
  import type { Opts, TtsWorker } from '@/tools/lib/text-to-speech/tts.worker';
  import { DEFAULT_VOICE, loadPrefs, MAX_SPEED, MIN_SPEED, previewLine, savePrefs, voiceById, type VoiceId } from '@/tools/lib/text-to-speech/voices';
  import TextToSpeechVoices from './TextToSpeechVoices.svelte';

  let { text }: { text: string } = $props();

  interface Sentence {
    text: string;
    audio: Float32Array<ArrayBuffer> | null;
  }
  interface Para {
    id: number;
    text: string;
    voice: VoiceId;
    speed: number;
    sentences: Sentence[];
    error: string;
  }

  /** first-run download: the model for this device plus kokoro's own speech engine (not counted by the model card) */
  const firstRun = (variant: string) => formatMB(totalDownloadSize('kokoro', variant) + VENDOR.jsep.files['ort-wasm-simd-threaded.jsep.wasm'].bytes);
  let FIRST_RUN = $state(firstRun('q8'));
  $effect(() => {
    detectDevice().then((d) => (FIRST_RUN = firstRun(pickVariant('kokoro', d)?.variant ?? 'q8')));
  });
  const FATAL = new Set(['network', 'rate-limited', 'storage-full', 'out-of-memory']);

  const worker = modelWorker<TtsWorker>(() => new Worker(new URL('../lib/text-to-speech/tts.worker.ts', import.meta.url), { type: 'module', name: 'text-to-speech' }));
  let opts: Opts = { variant: 'q8', device: 'wasm' };
  let ready = $state(false);

  const prefs = loadPrefs();
  let voice = $state<VoiceId>(prefs.voice ?? DEFAULT_VOICE);
  let speed = $state(prefs.speed ?? 1);
  $effect(() => savePrefs({ voice, speed }));

  let paras = $state<Para[]>([]);
  /** the text the list was made from */
  let source = $state('');
  let rendering = $state(false);
  let halted = $state(false);
  let error = $state('');
  let exporting = $state<'wav' | 'mp3' | null>(null);
  /** seconds of audio made per second of work, for an honest speed figure */
  let pace = $state({ audio: 0, work: 0 });
  let nextId = 0;

  const count = $derived(paras.reduce((n, p) => n + p.sentences.length, 0));
  const made = $derived(paras.reduce((n, p) => n + p.sentences.filter((s) => s.audio).length, 0));
  const pending = $derived(paras.reduce((n, p) => n + (p.error ? 0 : p.sentences.filter((s) => !s.audio).length), 0));
  const failed = $derived(paras.filter((p) => p.error).length);
  const seconds = $derived(paras.reduce((n, p) => n + p.sentences.reduce((m, s) => m + (s.audio?.length ?? 0), 0), 0) / SAMPLE_RATE);
  const stale = $derived(paras.length > 0 && (text !== source || paras.some((p) => p.voice !== voice || p.speed !== speed)));
  const firstSentence = $derived(splitSentences(splitParagraphs(text)[0] ?? '')[0] ?? '');

  async function loadModel({ variant, device, onProgress, signal }: GateLoadContext) {
    opts = { variant, device };
    return (opts = await worker.call((api) => api.load(opts, proxy(onProgress)), signal));
  }

  // ── making speech ──

  const gapAfter = (p: Para, i: number) => (i === p.sentences.length - 1 ? PAUSE.paragraph : PAUSE.sentence) / p.speed;

  function sentencesOf(t: string, v: VoiceId, s: number, reuse = new Map<string, Float32Array<ArrayBuffer>>()): Sentence[] {
    return splitSentences(t).map((text) => ({ text, audio: reuse.get(`${v}|${s}|${text}`) ?? null }));
  }

  function generate() {
    const reuse = new Map(paras.flatMap((p) => p.sentences.flatMap((s) => (s.audio ? [[`${p.voice}|${p.speed}|${s.text}`, s.audio] as const] : []))));
    stop();
    paras = splitParagraphs(text).map((t) => ({ id: nextId++, text: t, voice, speed, sentences: sentencesOf(t, voice, speed, reuse), error: '' }));
    source = text;
    error = '';
    halted = false;
    pace = { audio: 0, work: 0 };
    pump();
    play(0);
  }

  function redo(p: Para) {
    Object.assign(p, { voice, speed, error: '', sentences: sentencesOf(p.text, voice, speed) });
    halted = false;
    pump();
  }

  const nextJob = () => {
    for (const p of paras) {
      const s = p.error ? undefined : p.sentences.find((x) => !x.audio);
      if (s) return { p, s };
    }
    return null;
  };

  /** speaks waiting sentences in reading order until none are left (or the visitor stops it) */
  async function pump() {
    if (rendering) return;
    rendering = true;
    try {
      for (let job = nextJob(); job && !halted; job = nextJob()) {
        const { p, s } = job;
        const t0 = performance.now();
        try {
          const audio = await worker.call((api) => api.speak(s.text, p.voice, p.speed, opts));
          // a paragraph redone meanwhile has new sentences; this audio belongs to none of them
          if (p.sentences.includes(s)) s.audio = audio;
          pace = { audio: pace.audio + audio.length / SAMPLE_RATE, work: pace.work + (performance.now() - t0) / 1000 };
        } catch (err) {
          const e = toAiError(err);
          if (FATAL.has(e.code)) {
            error = e.message;
            halted = true;
          } else p.error = e.message;
        }
        wake();
      }
    } finally {
      rendering = false;
      wake();
    }
  }

  // ── playback (Web Audio, so pauses between sentences are exact and match the export) ──

  let ctx: AudioContext | null = null;
  let node: AudioBufferSourceNode | null = null;
  let token = 0;
  let at = $state<{ p: number; s: number } | null>(null);
  let paused = $state(false);
  let buffering = $state(false);
  let preview = $state<{ id: VoiceId; making: boolean } | null>(null);
  const previews = new Map<string, Float32Array<ArrayBuffer>>();

  const waiters = new Set<() => void>();
  function wake() {
    const all = [...waiters];
    waiters.clear();
    all.forEach((w) => w());
  }
  const changed = () => new Promise<void>((r) => waiters.add(r));

  /** created inside a click, so browsers let it make sound */
  function output() {
    // iOS mutes Web Audio with the ring/silent switch unless the page asks for media playback
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    ctx ??= new AudioContext();
    paused = false;
    ctx.resume();
    return ctx;
  }

  function clip(c: AudioContext, pcm: Float32Array<ArrayBuffer>, gap: number) {
    return new Promise<void>((resolve) => {
      const buf = c.createBuffer(1, pcm.length + Math.round(gap * SAMPLE_RATE), SAMPLE_RATE);
      buf.copyToChannel(pcm, 0);
      const n = (node = c.createBufferSource());
      n.buffer = buf;
      n.connect(c.destination);
      n.onended = () => resolve();
      n.start();
    });
  }

  function stop() {
    token++;
    node?.stop();
    node = null;
    at = preview = null;
    buffering = paused = false;
    wake();
  }

  async function play(fromP: number) {
    stop();
    const my = token;
    const c = output();
    for (let p = fromP; p < paras.length && my === token; p++) {
      for (let s = 0; my === token; s++) {
        const para = paras[p];
        if (!para || s >= para.sentences.length) break;
        at = { p, s };
        while (my === token && !para.error && !para.sentences[s]?.audio) {
          if (halted && !rendering) return stop();
          buffering = true;
          await changed();
        }
        buffering = false;
        const pcm = para.sentences[s]?.audio;
        if (my !== token || !pcm) break;
        await clip(c, pcm, gapAfter(para, s));
      }
    }
    if (my === token) at = null;
  }

  function toggle() {
    if (!at) return play(0);
    if (paused) output();
    else {
      ctx?.suspend();
      paused = true;
    }
  }

  async function previewVoice(id: VoiceId) {
    const wasThis = preview?.id === id;
    stop();
    if (wasThis) return;
    const my = token;
    const c = output();
    const line = previewLine(voiceById(id)!, firstSentence);
    const key = `${id}|${speed}|${line}`;
    preview = { id, making: !previews.has(key) };
    try {
      const pcm = previews.get(key) ?? (await worker.call((api) => api.speak(line, id, speed, opts)));
      previews.set(key, pcm);
      if (my !== token) return;
      preview = { id, making: false };
      await clip(c, pcm, 0);
      if (my === token) preview = null;
    } catch (err) {
      if (my === token) {
        preview = null;
        error = toAiError(err).message;
      }
    }
  }

  // ── export ──

  async function save(format: 'wav' | 'mp3') {
    exporting = format;
    error = '';
    try {
      const clips = paras.flatMap((p) => p.sentences.flatMap((s, i) => (s.audio ? [{ audio: s.audio, gap: gapAfter(p, i) }] : [])));
      const pcm = { sampleRate: SAMPLE_RATE, channels: [joinAudio(clips)] };
      const blob =
        format === 'wav' ? new Blob([writeWav(pcm)], { type: 'audio/wav' }) : await (await import('@/engines/media')).encodeAudio(pcm, { format: 'mp3', bitrate: 128_000 });
      downloadBlob(blob, `${fileStem(source)}.${format}`);
    } catch (err) {
      error = (err as Error).message || "The audio file couldn't be made. Try WAV instead.";
    } finally {
      exporting = null;
    }
  }

  function startOver() {
    stop();
    halted = true;
    paras = [];
    source = error = '';
  }

  onDestroy(() => {
    halted = true;
    stop();
    worker.terminate();
    ctx?.close();
  });

  const paraSeconds = (p: Para) => p.sentences.reduce((n, s) => n + (s.audio?.length ?? 0), 0) / SAMPLE_RATE;
  const status = $derived.by(() => {
    if (!at) return pending ? 'Stopped' : 'Ready to play';
    if (buffering) return `Making paragraph ${at.p + 1}…`;
    return `${paused ? 'Paused at' : 'Reading'} paragraph ${at.p + 1} of ${paras.length}`;
  });
</script>

{#if !ready}
  <p class="mono -mb-2">The first run downloads about {FIRST_RUN} (the voice model and its speech engine). After that it works offline.</p>
{/if}

<ModelGate model="kokoro" light={null} load={loadModel} bind:ready>
  {#snippet children()}
    <div class="grid gap-5">
      <TextToSpeechVoices bind:value={voice} {preview} onpreview={previewVoice} />

      <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
        <label class="grid min-w-[220px] flex-1 gap-1.5">
          <span class="label mb-0!">speed · {speed.toFixed(2)}×</span>
          <input type="range" min={MIN_SPEED} max={MAX_SPEED} step="0.05" bind:value={speed} class="w-full accent-(--color-ai)" />
          <span class="mono flex justify-between" aria-hidden="true"><span>0.5× slow</span><span>1×</span><span>2× fast</span></span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-ai" disabled={!text.trim()} onclick={generate}>
            {paras.length && stale ? 'Update speech' : paras.length ? 'Read again' : 'Read aloud'}
          </button>
          {#if paras.length}<button type="button" class="btn" onclick={startOver}>Start over</button>{/if}
        </div>
      </div>
      {#if stale}
        <p class="note">
          {text !== source ? 'The text changed.' : 'The voice or speed changed.'} "Update speech" redoes only what changed; ↻ on a paragraph redoes just that one in the current voice.
        </p>
      {/if}
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}

      {#if paras.length}
        <section class="result card" aria-label="Your speech">
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="big" onclick={toggle} aria-label={at && !paused ? 'Pause' : 'Play'}>
              {#if at && !paused}
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
              {:else}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              {/if}
            </button>
            <div class="min-w-0 flex-1">
              <p class="font-serif text-[26px] leading-tight" aria-live="polite">{status}</p>
              <p class="mono">
                {made} of {count} sentences ready · {formatTime(seconds, 0)} of audio{#if pace.work > 1}
                  · making it at {(pace.audio / pace.work).toFixed(1)}× real time{/if}{#if failed}
                  · {failed} paragraph{failed > 1 ? 's' : ''} failed{/if}
              </p>
            </div>
            {#if at}<button type="button" class="btn py-2! text-sm!" onclick={stop}>Stop</button>{/if}
          </div>

          {#if pending}
            <div class="flex flex-wrap items-center gap-3">
              <div class="bar" role="progressbar" aria-label="Speech made" aria-valuemin={0} aria-valuemax={count} aria-valuenow={made}>
                <span style={`width: ${(made / count) * 100}%`}></span>
              </div>
              {#if halted && !rendering}
                <button type="button" class="btn py-2! text-sm!" onclick={() => ((halted = false), pump())}>Continue</button>
              {:else}
                <button type="button" class="btn py-2! text-sm!" onclick={() => ((halted = true), wake())}>Pause making</button>
              {/if}
            </div>
          {/if}

          <ol class="paras">
            {#each paras as p, i (p.id)}
              <li class:current={at?.p === i}>
                <button type="button" class="from" onclick={() => play(i)} aria-label={`Play from paragraph ${i + 1}`}>{i + 1}</button>
                <div class="min-w-0 flex-1">
                  <p class="body">
                    {#each p.sentences as s, j}<span class:now={at?.p === i && at.s === j} class:waiting={!s.audio}>{s.text}</span>{' '}{/each}
                  </p>
                  <p class="mono">
                    {voiceById(p.voice)?.name} · {p.speed.toFixed(2)}× ·
                    {#if p.error}<span class="text-bad">{p.error}</span>
                    {:else if p.sentences.every((s) => s.audio)}{formatTime(paraSeconds(p), 0)}
                    {:else}{p.sentences.filter((s) => s.audio).length}/{p.sentences.length} sentences{/if}
                  </p>
                </div>
                <button type="button" class="redo" onclick={() => redo(p)} aria-label={`Redo paragraph ${i + 1} with ${voiceById(voice)?.name} at ${speed.toFixed(2)}×`} title="Redo with the current voice and speed">↻</button>
              </li>
            {/each}
          </ol>

          <div class="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button type="button" class="btn btn-primary" disabled={!!pending || !made || !!exporting} onclick={() => save('mp3')}>
              {exporting === 'mp3' ? 'Making MP3…' : 'Download MP3'}
            </button>
            <button type="button" class="btn" disabled={!!pending || !made || !!exporting} onclick={() => save('wav')}>
              {exporting === 'wav' ? 'Making WAV…' : 'Download WAV'}
            </button>
            <p class="mono">
              {pending
                ? `available once all ${count} sentences are ready`
                : failed
                  ? `the ${failed} failed paragraph${failed > 1 ? 's are' : ' is'} left out: press ↻ on ${failed > 1 ? 'them' : 'it'} to try again`
                  : 'mono, 24 kHz, with natural pauses between sentences and paragraphs'}
            </p>
          </div>
        </section>
      {/if}
    </div>
  {/snippet}
</ModelGate>

<style>
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
  }
  .result {
    display: grid;
    gap: 16px;
    padding: clamp(16px, 3vw, 24px);
  }
  .big {
    flex: none;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 99px;
    border: 0;
    background: var(--color-ai);
    color: var(--color-bg);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:active {
      transform: scale(0.95);
    }
    & svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
  }
  .bar {
    position: relative;
    flex: 1;
    min-width: 160px;
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: var(--color-ai);
      transition: width 0.25s ease-out;
    }
  }
  .paras {
    display: grid;
    gap: 4px;
    max-height: 480px;
    overflow-y: auto;
    margin: 0 -8px;
    padding: 0;
    list-style: none;
    scrollbar-width: thin;
    & li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 8px;
      border-radius: 12px;
      transition: background 0.2s;
    }
    & li.current {
      background: color-mix(in srgb, var(--color-ai) 8%, transparent);
    }
  }
  .from,
  .redo {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: transparent;
    color: var(--color-muted);
    font: 400 12px var(--font-mono);
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .current .from {
    color: var(--color-bg);
    background: var(--color-ai);
    border-color: var(--color-ai);
  }
  .redo {
    font-size: 16px;
  }
  .body {
    font-size: 15.5px;
    line-height: 1.55;
    color: var(--color-soft);
    margin-bottom: 2px;
    & .waiting {
      color: var(--color-muted);
    }
    & .now {
      color: var(--color-chalk);
      background: color-mix(in srgb, var(--color-ai) 22%, transparent);
      border-radius: 4px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      padding: 0 2px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span,
    .paras li,
    .big {
      transition: none;
    }
  }
</style>
