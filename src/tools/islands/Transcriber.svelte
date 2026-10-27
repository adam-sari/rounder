<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import DeviceNote from '@/components/tool/DeviceNote.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { MODELS } from '@/engines/ai/models';
  import { downloadResult, formatBytes, withExtension } from '@/tools/lib/files';
  import { Transcription } from '@/tools/lib/whisper/job.svelte';
  import { languageName, type LanguageChoice } from '@/tools/lib/whisper/languages';
  import { clock, toJson, toTxt, transcriptLines, transcriptSrt, transcriptVtt } from '@/tools/lib/whisper/transcript';
  import TranscribeProgress from '@/tools/lib/whisper/TranscribeProgress.svelte';
  import WhisperGate from '@/tools/lib/whisper/WhisperGate.svelte';
  import WhisperOptions from '@/tools/lib/whisper/WhisperOptions.svelte';
  import type { WhisperSpec } from '@/tools/lib/whisper/engine';

  const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.oga,.weba,.wma,.amr,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp,.mpeg,.mpg,.ts';
  const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpe?g|ts)$/i;
  const KINDS = ['txt', 'srt', 'vtt', 'json'] as const;

  const job = new Transcription();
  let language = $state<LanguageChoice>('auto');
  let translate = $state(false);
  let timestamps = $state(true);
  let ranWith = $state<{ spec: WhisperSpec; translate: boolean } | null>(null);

  let mediaUrl = $state('');
  let player = $state<HTMLMediaElement>();
  let time = $state(0);
  let paused = $state(true);
  let list = $state<HTMLOListElement>();

  const isVideo = $derived(!!job.file && (job.file.type.startsWith('video/') || VIDEO.test(job.file.name)));
  const lines = $derived(transcriptLines(job.words));
  const activeLine = $derived(paused && time === 0 ? -1 : lines.findLastIndex((l) => time >= l.start));
  const finished = $derived(job.stage === 'done' || job.stage === 'stopped');
  const took = $derived(job.finishedAt ? (job.finishedAt - job.startedAt) / 1000 : 0);
  const baseName = $derived(job.file?.name ?? 'transcript');
  const text = () => toTxt(job.words, timestamps);

  function choose(files: File[]) {
    const f = files[0];
    if (!f) return;
    job.setFile(f);
    ranWith = null;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(f);
    time = 0;
  }

  function startOver() {
    job.reset();
    ranWith = null;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = '';
  }

  onDestroy(() => {
    job.reset();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  });

  function run(worker: Parameters<Transcription['run']>[0], spec: WhisperSpec) {
    const canTranslate = spec.key !== 'whisper-large-turbo';
    ranWith = { spec, translate: translate && canTranslate };
    job.run(worker, spec, { language, translate: translate && canTranslate });
  }

  function seek(t: number) {
    if (!player) return;
    player.currentTime = t;
    player.play().catch(() => {});
  }

  function save(kind: 'txt' | 'srt' | 'vtt' | 'json') {
    const meta = { model: ranWith ? MODELS[ranWith.spec.key].name : 'Whisper', language: job.language ?? 'en', task: ranWith?.translate ? ('translate' as const) : ('transcribe' as const), duration: job.duration };
    const body = kind === 'txt' ? text() : kind === 'srt' ? transcriptSrt(job.words) : kind === 'vtt' ? transcriptVtt(job.words) : toJson(job.words, meta);
    const type = { txt: 'text/plain', srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json' }[kind];
    downloadResult(new Blob([body], { type: `${type};charset=utf-8` }), withExtension(baseName, kind));
  }

  // follow the transcript as it grows, unless the reader has scrolled up
  $effect(() => {
    void job.words;
    void job.draft;
    if (!list || !job.busy) return;
    const el = list;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) tick().then(() => (el.scrollTop = el.scrollHeight));
  });

  // keep the line being played in view
  let lastScrolled = -1;
  $effect(() => {
    if (paused || !list || activeLine < 0 || activeLine === lastScrolled) return;
    lastScrolled = activeLine;
    const el = list.querySelector<HTMLElement>(`[data-line="${activeLine}"]`);
    if (el) list.scrollTo({ top: el.offsetTop - list.clientHeight / 3, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
</script>

<div class="tool">
  {#if !job.file}
    <Dropzone accept={ACCEPT} title="Drop audio or video" hint="MP3, M4A, WAV, MP4, MOV, WebM… · or click to choose" onfiles={choose} />
  {:else}
    <div class="filebar card">
      <div class="min-w-0">
        <div class="truncate font-medium">{job.file.name}</div>
        <div class="mono">
          {formatBytes(job.file.size)}{job.duration ? ` · ${clock(job.duration)}` : job.stage !== 'error' ? ' · reading…' : ''}
        </div>
      </div>
      <button type="button" class="btn sm" onclick={startOver}>Start over</button>
    </div>
  {/if}

  <WhisperGate locked={job.busy}>
    {#snippet children({ worker, spec })}
      <div class="card setup">
        <WhisperOptions bind:language bind:translate canTranslate={spec.key !== 'whisper-large-turbo'} disabled={job.busy} />
        <div class="go">
          <button type="button" class="btn btn-ai" disabled={!job.readable || job.busy} onclick={() => run(worker, spec)}>
            {job.words.length || finished ? 'Transcribe again' : 'Transcribe'}
          </button>
          <span class="mono">{job.file ? 'runs on this device · nothing is uploaded' : 'add a file above first'}</span>
        </div>
      </div>
    {/snippet}
  </WhisperGate>

  {#if job.busy}<TranscribeProgress {job} />{/if}
  {#if !job.error}<DeviceNote verdict={job.deviceNote} />{/if}
  {#if job.error}<p class="msg bad" role="alert">{job.error}</p>{/if}
  {#if job.stage === 'stopped'}<p class="msg">Stopped. Everything transcribed up to that point is below.</p>{/if}
  {#if job.stage === 'done' && !job.words.length}
    <p class="msg">No speech found in this file. If someone does speak, try picking the language, or the accurate model.</p>
  {/if}

  {#if job.file && mediaUrl && (job.words.length || job.draft)}
    <section class="card result" aria-labelledby="transcript-heading">
      {#if isVideo}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={player} src={mediaUrl} controls playsinline preload="metadata" bind:currentTime={time} bind:paused></video>
      {:else}
        <audio bind:this={player} src={mediaUrl} controls preload="metadata" bind:currentTime={time} bind:paused></audio>
      {/if}

      <div class="head">
        <div>
          <h3 id="transcript-heading" class="font-serif text-3xl leading-none">Transcript</h3>
          <p class="mono mt-1">
            {job.words.length.toLocaleString('en-US')} words
            {#if job.language} · {languageName(job.language)}{language === 'auto' ? ' (detected)' : ''}{/if}
            {#if ranWith?.translate} · translated to English{/if}
            {#if ranWith} · {MODELS[ranWith.spec.key].name}{/if}
            {#if took && job.duration} · took {clock(took)} ({Math.max(0.1, Math.round((job.duration / took) * 10) / 10)}× real time){/if}
          </p>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={timestamps} class="accent-(--color-ai)" />
          Timestamps
        </label>
      </div>

      <ol class="lines" bind:this={list} aria-label="Transcript; select a time to play from there">
        {#each lines as l, i (i)}
          <li data-line={i} class:active={i === activeLine}>
            {#if timestamps}
              <button type="button" class="ts mono" onclick={() => seek(l.start)} aria-label="Play from {clock(l.start)}">{clock(l.start)}</button>
            {/if}
            <p>
              {#if i === activeLine && !paused}
                {#each l.words as w}<span class:on={time >= w.start && time < w.end}>{w.text}</span>{/each}
              {:else}
                {l.text}
              {/if}
            </p>
          </li>
        {/each}
        {#if job.draft?.text.trim()}
          <li class="draft" aria-hidden="true">
            {#if timestamps}<span class="ts mono">{clock(job.draft.start)}</span>{/if}
            <p>{job.draft.text.trim()}<span class="caret"></span></p>
          </li>
        {/if}
      </ol>

      <p class="mono note">AI transcripts can mishear names and quiet words, so check before you rely on them. There are no speaker labels: Whisper writes down what's said, not who said it.</p>

      <div class="flex flex-wrap gap-2" aria-label="Save the transcript">
        <CopyButton text={text} label="Copy text" class="btn-primary" disabled={job.busy || !job.words.length} />
        {#each KINDS as kind}
          <button type="button" class="btn" disabled={job.busy || !job.words.length} onclick={() => save(kind)}>{kind.toUpperCase()}</button>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .tool {
    display: grid;
    gap: 16px;
  }
  .filebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
  }
  .btn.sm {
    padding: 8px 12px;
    font-size: 13.5px;
  }
  .btn-ai {
    background: var(--color-ai);
    border-color: var(--color-ai);
    color: var(--color-bg);
    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-ai) 85%, white);
    }
  }
  .setup {
    display: grid;
    gap: 16px;
    padding: 18px;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .msg {
    font-size: 14px;
    color: var(--color-soft);
    border-left: 2px solid var(--color-ai);
    padding: 4px 0 4px 12px;
    &.bad {
      border-color: var(--color-bad);
      color: var(--color-bad);
    }
  }
  .result {
    display: grid;
    gap: 16px;
    padding: clamp(16px, 3vw, 24px);
  }
  video,
  audio {
    width: 100%;
    border-radius: 14px;
  }
  video {
    max-height: 52vh;
    background: #000;
    border: 1px solid var(--color-line-2);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 10px;
  }
  .lines {
    display: grid;
    gap: 2px;
    max-height: 520px;
    overflow-y: auto;
    padding: 4px;
    margin: 0 -4px;
    & li {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      align-items: baseline;
      padding: 8px 10px;
      border-radius: 10px;
      transition: background-color 0.2s;
    }
    & li.active {
      background: color-mix(in srgb, var(--color-ai) 10%, transparent);
    }
    & p {
      grid-column: -2;
      font-size: 16px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }
    & .on {
      color: var(--color-ai);
      text-decoration: underline 2px;
      text-underline-offset: 4px;
    }
  }
  .ts {
    min-width: 52px;
    padding: 2px 6px;
    text-align: left;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
  }
  button.ts:hover,
  .active button.ts {
    color: var(--color-ai);
  }
  .draft p {
    color: var(--color-muted);
  }
  .caret {
    display: inline-block;
    width: 8px;
    height: 1em;
    margin-left: 3px;
    vertical-align: -2px;
    background: var(--color-ai);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .note {
    color: var(--color-muted);
  }
</style>
