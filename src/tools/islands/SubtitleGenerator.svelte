<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { capabilities, containers, downloadName, formatBytes, formatTime, parseTime, toMediaError, transcode, type Capabilities, type Container, type Ctx2D } from '@/engines/media';
  import { downloadResult, withExtension } from '@/tools/lib/files';
  import { buildCues, longestLine, mergeCues, SHORT_CUES, splitCue, SUBTITLE_CUES, type TimedCue } from '@/tools/lib/subtitle-cues';
  import { captionAt, isValidCue, toSrt, toVtt, type Cue } from '@/tools/lib/subtitles/format';
  import { defaultStyle, drawCaption, fontCss, layoutCaption, type CaptionStyle, type Placement } from '@/tools/lib/subtitles/layout';
  import type { WhisperSpec } from '@/tools/lib/whisper/engine';
  import { Transcription } from '@/tools/lib/whisper/job.svelte';
  import { languageName, type LanguageChoice } from '@/tools/lib/whisper/languages';
  import { clock } from '@/tools/lib/whisper/transcript';
  import TranscribeProgress from '@/tools/lib/whisper/TranscribeProgress.svelte';
  import WhisperGate from '@/tools/lib/whisper/WhisperGate.svelte';
  import WhisperOptions from '@/tools/lib/whisper/WhisperOptions.svelte';

  interface Row extends TimedCue {
    id: number;
  }

  const ACCEPT = 'video/*,audio/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp,.mpeg,.mpg,.ts,.mp3,.m4a,.wav,.ogg,.flac';
  const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpe?g|ts)$/i;
  const HANDOFF = 'rounder:handoff:subtitles';
  const ENDS = ['start', 'end'] as const;
  const SIZES = { small: 0.045, medium: 0.055, large: 0.07 } as const;
  const PLACES: Placement[] = ['bottom', 'middle', 'top'];

  const job = new Transcription();
  let language = $state<LanguageChoice>('auto');
  let translate = $state(false);
  let short = $state(false);
  const cueOpts = $derived(short ? SHORT_CUES : SUBTITLE_CUES);

  let rows = $state<Row[]>([]);
  /** hand edits stop the cues from being rebuilt from the words */
  let edited = $state(false);
  let nextId = 1;

  let mediaUrl = $state('');
  let player = $state<HTMLMediaElement>();
  let overlay = $state<HTMLCanvasElement>();
  let list = $state<HTMLOListElement>();
  let time = $state(0);
  let paused = $state(true);
  let stageW = $state(0);
  let dims = $state<{ w: number; h: number } | null>(null);
  let previewError = $state('');
  let fontsLoaded = $state(0);

  let size = $state<keyof typeof SIZES>('medium');
  let position = $state<Placement>('bottom');
  let box = $state(false);
  const style = $derived<CaptionStyle>({ ...defaultStyle, size: SIZES[size], position, box });

  let caps = $state.raw<Capabilities | null>(null);
  let burning = $state(false);
  let burnProgress = $state(0);
  let burnStatus = $state('');
  let burnError = $state('');
  let result = $state.raw<{ blob: Blob; url: string; name: string } | null>(null);
  let burnCtl: AbortController | null = null;

  const isVideo = $derived(!!job.file && (job.file.type.startsWith('video/') || VIDEO.test(job.file.name)));
  const duration = $derived(job.duration);
  const cues = $derived(rows.filter(isValidCue));
  const activeIds = $derived(new Set(rows.filter((r) => time >= r.start && time < r.end).map((r) => r.id)));
  const container = $derived<Container | null>(!caps ? 'mp4' : (['mp4', 'webm'] as const).find((c) => caps!.containers[c] && caps!.video.encode.some((v) => containers[c].video.includes(v))) ?? null);
  const baseName = $derived(job.file?.name ?? 'subtitles');

  // cues follow the words as Whisper writes them, until someone edits them by hand
  $effect(() => {
    const built = buildCues(job.words, cueOpts);
    if (!untrack(() => edited)) rows = built.map((c) => ({ ...c, id: nextId++ }));
  });

  onMount(() => {
    capabilities().then(
      (c) => (caps = c),
      () => (caps = null),
    );
  });

  onDestroy(() => {
    job.reset();
    burnCtl?.abort();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    if (result) URL.revokeObjectURL(result.url);
  });

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function choose(files: File[]) {
    const f = files[0];
    if (!f) return;
    burnCtl?.abort();
    clearResult();
    job.setFile(f);
    edited = false;
    dims = null;
    previewError = burnError = '';
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(f);
    time = 0;
  }

  function startOver() {
    burnCtl?.abort();
    clearResult();
    job.reset();
    edited = false;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = '';
  }

  const confirmDiscard = () => !edited || confirm('This rebuilds the subtitles from what Whisper heard, and your edits will be lost. Continue?');

  function generate(worker: Parameters<Transcription['run']>[0], spec: WhisperSpec) {
    if (!confirmDiscard()) return;
    edited = false;
    clearResult();
    job.run(worker, spec, { language, translate: translate && spec.key !== 'whisper-large-turbo' });
  }

  function setShort(next: boolean) {
    if (next === short || !confirmDiscard()) return;
    edited = false;
    short = next;
  }

  // ---------------------------------------------------------------- editing

  const round = (t: number) => Math.round(t * 1000) / 1000;
  const clampTime = (t: number) => round(Math.min(Math.max(0, t), duration || t));
  const snap = (r: Row) => $state.snapshot(r) as Row;

  function touch() {
    edited = true;
    clearResult();
  }

  function editText(r: Row, value: string) {
    r.text = value;
    r.words = undefined;
    touch();
  }

  function editTime(r: Row, key: 'start' | 'end', input: HTMLInputElement) {
    const v = parseTime(input.value);
    if (v !== null) r[key] = clampTime(v);
    input.value = formatTime(r[key]);
    if (rows.some((x, i) => i && rows[i - 1].start > x.start)) rows = rows.slice().sort((a, b) => a.start - b.start);
    touch();
  }

  function split(i: number) {
    rows.splice(i, 1, ...splitCue(snap(rows[i]), cueOpts).map((c) => ({ ...c, id: nextId++ })));
    touch();
  }

  function merge(i: number) {
    rows.splice(i, 2, mergeCues(snap(rows[i]), snap(rows[i + 1]), cueOpts));
    touch();
  }

  function remove(i: number) {
    rows.splice(i, 1);
    touch();
  }

  function seek(t: number) {
    if (!player) return;
    player.currentTime = t;
    player.play().catch(() => {});
  }

  function exportAs(kind: 'srt' | 'vtt') {
    const plain = cues.map(({ start, end, text }) => ({ start, end, text }));
    const text = kind === 'srt' ? toSrt(plain) : toVtt(plain);
    downloadResult(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), withExtension(baseName, kind));
  }

  /** opens the full caption styler with these subtitles; the video has to be added there again */
  function handOff() {
    try {
      sessionStorage.setItem(HANDOFF, toSrt(cues));
    } catch {
      // storage blocked: the styler opens empty, the SRT download still works
    }
  }

  // keep the cue being played in view
  let lastScrolled = -1;
  $effect(() => {
    if (paused || !list) return;
    const id = rows.find((r) => activeIds.has(r.id))?.id;
    if (id === undefined || id === lastScrolled) return;
    lastScrolled = id;
    const el = list.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) list.scrollTo({ top: el.offsetTop - list.clientHeight / 3, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // ---------------------------------------------------------------- preview (same drawing code as the burn-in)

  const measureWith = (ctx: Ctx2D) => (s: string, px: number) => {
    ctx.font = fontCss(style.font, px);
    return ctx.measureText(s).width;
  };

  $effect(() => {
    document.fonts?.load(fontCss(style.font, 40)).then(
      () => fontsLoaded++,
      () => {},
    );
  });

  $effect(() => {
    const canvas = overlay;
    if (!canvas || !dims || !stageW) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(stageW * dpr);
    const h = Math.round(((stageW * dims.h) / dims.w) * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    void fontsLoaded;
    ctx.clearRect(0, 0, w, h);
    const text = captionAt(cues, time);
    const l = text ? layoutCaption(text, style, w, h, measureWith(ctx)) : null;
    if (l) drawCaption(ctx, l, style);
  });

  // a real captions track too, for screen readers and the player's own CC menu
  let trackUrl = $state('');
  $effect(() => {
    const url = URL.createObjectURL(new Blob([toVtt(cues)], { type: 'text/vtt' }));
    trackUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  // ---------------------------------------------------------------- burn in

  async function burn() {
    if (!job.file || !container || !cues.length || burning) return;
    player?.pause();
    const timed = cues.map(({ start, end, text }) => ({ start, end, text })) as Cue[];
    const st = { ...style };
    const ctl = (burnCtl = new AbortController());
    burning = true;
    burnError = burnStatus = '';
    burnProgress = 0;
    clearResult();
    await document.fonts?.load(fontCss(st.font, 64)).catch(() => {});
    let cache: { key: string; layout: ReturnType<typeof layoutCaption> } = { key: '', layout: null };
    const draw = (ctx: Ctx2D, f: { time: number; width: number; height: number }) => {
      const text = captionAt(timed, f.time);
      if (!text) return;
      const key = `${f.width}x${f.height}|${text}`;
      if (key !== cache.key) {
        const measure = (s: string, px: number) => {
          ctx.font = fontCss(st.font, px);
          return ctx.measureText(s).width;
        };
        cache = { key, layout: layoutCaption(text, st, f.width, f.height, measure) };
      }
      if (cache.layout) drawCaption(ctx, cache.layout, st);
    };
    try {
      const out = await transcode(job.file, { container, video: { quality: 'high', overlay: draw } }, { signal: ctl.signal, onProgress: (p) => (burnProgress = p), onStatus: (s) => (burnStatus = s) });
      if (ctl === burnCtl) result = { blob: out.blob, url: URL.createObjectURL(out.blob), name: downloadName(job.file.name, out.container, '-subtitled') };
    } catch (e) {
      if (!ctl.signal.aborted) burnError = toMediaError(e).message;
    } finally {
      if (ctl === burnCtl) {
        burning = false;
        burnCtl = null;
      }
    }
  }
</script>

<div class="tool">
  {#if !job.file}
    <Dropzone accept={ACCEPT} title="Drop a video" hint="MP4, MOV, WebM… (audio works too, for an SRT) · or click to choose" onfiles={choose} />
  {:else}
    <div class="filebar card">
      <div class="min-w-0">
        <div class="truncate font-medium">{job.file.name}</div>
        <div class="mono">
          {formatBytes(job.file.size)}{duration ? ` · ${clock(duration)}` : job.stage !== 'error' ? ' · reading…' : ''}{dims ? ` · ${dims.w}×${dims.h}` : ''}
        </div>
      </div>
      <button type="button" class="btn sm" onclick={startOver} disabled={burning}>Start over</button>
    </div>
  {/if}

  <WhisperGate locked={job.busy}>
    {#snippet children({ worker, spec })}
      <div class="card setup">
        <WhisperOptions bind:language bind:translate canTranslate={spec.key !== 'whisper-large-turbo'} disabled={job.busy} />
        <div class="flex flex-wrap items-end gap-4">
          <div>
            <span class="label" id="cue-shape">subtitle lines</span>
            <div class="seg" role="group" aria-labelledby="cue-shape">
              <button type="button" aria-pressed={!short} disabled={job.busy} onclick={() => setShort(false)}>2 lines · 42 characters</button>
              <button type="button" aria-pressed={short} disabled={job.busy} onclick={() => setShort(true)}>1 short line · social</button>
            </div>
          </div>
          <div class="go">
            <button type="button" class="btn btn-ai" disabled={!job.readable || job.busy || burning} onclick={() => generate(worker, spec)}>
              {rows.length ? 'Generate again' : 'Generate subtitles'}
            </button>
            <span class="mono">{job.file ? 'runs on this device · nothing is uploaded' : 'add a video above first'}</span>
          </div>
        </div>
      </div>
    {/snippet}
  </WhisperGate>

  {#if job.busy}<TranscribeProgress {job} />{/if}
  {#if job.error}<p class="msg bad" role="alert">{job.error}</p>{/if}
  {#if job.stage === 'stopped'}<p class="msg">Stopped. The subtitles made up to that point are below.</p>{/if}
  {#if job.stage === 'done' && !job.words.length}
    <p class="msg">No speech found. If someone does speak, try picking the language, or the accurate model.</p>
  {/if}

  {#if job.file && mediaUrl && (rows.length || job.busy)}
    <div class="workspace" inert={burning}>
      <div class="player">
        {#if isVideo}
          <div class="stage" bind:clientWidth={stageW} style:aspect-ratio={dims ? `${dims.w} / ${dims.h}` : '16 / 9'} style:width={dims ? `min(100%, calc(60vh * ${dims.w / dims.h}))` : '100%'}>
            <video
              bind:this={player}
              src={mediaUrl}
              controls
              playsinline
              preload="metadata"
              bind:currentTime={time}
              bind:paused
              onloadedmetadata={(e) => (dims = { w: e.currentTarget.videoWidth || 16, h: e.currentTarget.videoHeight || 9 })}
              onerror={() => (previewError = "This browser can't preview the video, but the subtitles and the burn-in still work.")}
            >
              <track kind="captions" src={trackUrl} label="Subtitles" />
            </video>
            <canvas bind:this={overlay} aria-hidden="true"></canvas>
          </div>
        {:else}
          <audio bind:this={player} src={mediaUrl} controls preload="metadata" bind:currentTime={time} bind:paused></audio>
        {/if}
        {#if previewError}<p class="mono text-(--color-bad)">{previewError}</p>{/if}

        {#if duration}
          <div class="strip" aria-hidden="true">
            {#each cues as c}
              <button type="button" tabindex="-1" class="cue" class:on={time >= c.start && time < c.end} style:left="{(c.start / duration) * 100}%" style:width="{((c.end - c.start) / duration) * 100}%" onclick={() => seek(c.start)} aria-label="Jump to {formatTime(c.start)}"></button>
            {/each}
            <span class="head" style:left="{(time / duration) * 100}%"></span>
          </div>
        {/if}
      </div>

      <section class="card editor" aria-labelledby="subs-heading" inert={job.busy}>
        <div class="editor-head">
          <h3 id="subs-heading" class="font-serif text-2xl">
            Subtitles <span class="mono">{cues.length}{job.language ? ` · ${languageName(job.language)}` : ''}{edited ? ' · edited' : ''}</span>
          </h3>
          <div class="flex gap-2">
            <button type="button" class="btn sm" disabled={!cues.length || job.busy} onclick={() => exportAs('srt')}>Download SRT</button>
            <button type="button" class="btn sm" disabled={!cues.length || job.busy} onclick={() => exportAs('vtt')}>VTT</button>
          </div>
        </div>
        <ol class="rows" bind:this={list}>
          {#each rows as r, i (r.id)}
            {@const long = longestLine(r.text) > cueOpts.maxLineChars || r.text.split('\n').length > cueOpts.maxLines}
            <li data-id={r.id} class:active={activeIds.has(r.id)} class:bad={r.end <= r.start}>
              <button type="button" class="idx mono" onclick={() => seek(r.start)} aria-label="Play from subtitle {i + 1}">{i + 1}</button>
              <div class="times">
                {#each ENDS as key}
                  <input class="field mono time" value={formatTime(r[key])} aria-label="{key === 'start' ? 'Start' : 'End'} of subtitle {i + 1}" onchange={(e) => editTime(r, key, e.currentTarget)} />
                {/each}
              </div>
              <textarea class="field text" class:long rows="2" value={r.text} oninput={(e) => editText(r, e.currentTarget.value)} aria-label="Text of subtitle {i + 1}" title={long ? `Longer than ${cueOpts.maxLines} line${cueOpts.maxLines > 1 ? 's' : ''} of ${cueOpts.maxLineChars} characters; fine, just harder to read` : undefined}></textarea>
              <div class="acts">
                <button type="button" class="act mono" onclick={() => split(i)} aria-label="Split subtitle {i + 1} in two">split</button>
                <button type="button" class="act mono" disabled={i === rows.length - 1} onclick={() => merge(i)} aria-label="Merge subtitle {i + 1} with the next one">merge ↓</button>
                <button type="button" class="act del" onclick={() => remove(i)} aria-label="Delete subtitle {i + 1}">×</button>
              </div>
            </li>
          {/each}
        </ol>
        <p class="mono">AI subtitles can mishear names and quiet words. Play it through and fix anything that's off; times are minutes:seconds.</p>
      </section>
    </div>

    {#if !job.busy && cues.length}
      {#if burning}
        <div class="card burn" role="status" aria-live="polite">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="font-serif text-2xl leading-none">Burning in subtitles</p>
            <span class="mono">{Math.round(burnProgress * 100)}%</span>
          </div>
          <div class="bar" role="progressbar" aria-label="Burn-in progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(burnProgress * 100)}>
            <span style:transform="scaleX({burnProgress})"></span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="mono">{burnStatus || 'Working…'}</span>
            <button type="button" class="btn sm" onclick={() => burnCtl?.abort()}>Cancel</button>
          </div>
        </div>
      {:else if result}
        <div class="card burn">
          <p class="font-serif text-2xl leading-none">Subtitles burned in</p>
          <!-- svelte-ignore a11y_media_has_caption -->
          <video class="out" src={result.url} controls playsinline></video>
          <p class="mono">{formatBytes(job.file.size)} → {formatBytes(result.blob.size)} · no watermark</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" onclick={() => result && downloadResult(result.blob, result.name)}>Download {result.name}</button>
            <button type="button" class="btn" onclick={clearResult}>Back to editing</button>
          </div>
        </div>
      {:else if isVideo}
        <div class="card burn">
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <span class="label" id="burn-size">size</span>
              <div class="seg" role="group" aria-labelledby="burn-size">
                {#each Object.keys(SIZES) as s}
                  <button type="button" aria-pressed={size === s} onclick={() => (size = s as keyof typeof SIZES)}>{s}</button>
                {/each}
              </div>
            </div>
            <div>
              <span class="label" id="burn-pos">position</span>
              <div class="seg" role="group" aria-labelledby="burn-pos">
                {#each PLACES as p}
                  <button type="button" aria-pressed={position === p} onclick={() => (position = p)}>{p}</button>
                {/each}
              </div>
            </div>
            <label class="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" bind:checked={box} class="accent-(--color-sun)" />
              Dark box behind the text
            </label>
          </div>
          {#if burnError}<p class="msg bad" role="alert">{burnError}</p>{/if}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" class="btn btn-primary" disabled={!container} onclick={burn}>Burn into video</button>
            <span class="mono">
              {container ? `${containers[container].label} · original resolution · no watermark` : "This browser can't encode video; the SRT download still works."}
            </span>
            <a class="more mono" href="/add-subtitles-to-video" onclick={handOff}>more caption styles →</a>
          </div>
        </div>
      {/if}
    {/if}
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
  .seg button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-left: auto;
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
  .workspace {
    display: grid;
    gap: 16px;
    align-items: start;
    @media (min-width: 980px) {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    }
  }
  .player {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .stage {
    position: relative;
    max-width: 100%;
    margin-inline: auto;
    border-radius: 14px;
    overflow: hidden;
    background: #000;
    border: 1px solid var(--color-line-2);
    & video,
    & canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    & canvas {
      pointer-events: none;
    }
  }
  audio {
    width: 100%;
  }
  .strip {
    position: relative;
    height: 14px;
    border-radius: 7px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
  }
  .cue {
    position: absolute;
    top: 2px;
    bottom: 2px;
    min-width: 2px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-ai) 45%, transparent);
    cursor: pointer;
    &.on {
      background: var(--color-sun);
    }
  }
  .head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--color-chalk);
    pointer-events: none;
  }

  .editor {
    display: grid;
    gap: 12px;
    padding: 16px;
    min-width: 0;
  }
  .editor-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .rows {
    display: grid;
    gap: 8px;
    max-height: 560px;
    overflow-y: auto;
    padding-right: 4px;
    & li {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      grid-template-areas: 'idx times' 'idx text' 'idx acts';
      gap: 6px 8px;
      padding: 10px;
      border: 1px solid var(--color-line);
      border-radius: 12px;
      background: var(--color-panel-2);
      transition: border-color 0.2s, background-color 0.2s;
    }
    & li.active {
      border-color: var(--color-sun);
      background: #ffd25e12;
    }
    & li.bad .time {
      border-color: var(--color-bad);
    }
  }
  .idx {
    grid-area: idx;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--color-line-2);
    background: transparent;
    cursor: pointer;
    &:hover {
      color: var(--color-sun);
      border-color: var(--color-sun);
    }
  }
  .times {
    grid-area: times;
    display: flex;
    gap: 6px;
  }
  .time {
    width: 96px;
    padding: 5px 8px;
    font-size: 13px;
    color: var(--color-chalk);
    border-radius: 9px;
  }
  .text {
    grid-area: text;
    min-height: 0;
    padding: 6px 10px;
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.4;
    resize: vertical;
    &.long {
      border-color: color-mix(in srgb, var(--color-sun) 70%, transparent);
    }
  }
  .acts {
    grid-area: acts;
    display: flex;
    gap: 4px;
  }
  .act {
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      border-color: var(--color-line-2);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    &.del {
      margin-left: auto;
      font-size: 18px;
      line-height: 1;
      &:hover {
        color: var(--color-bad);
      }
    }
  }

  .burn {
    display: grid;
    gap: 14px;
    padding: 18px;
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      transform-origin: left;
      background: linear-gradient(90deg, #ffd25eaa, var(--color-sun));
      transition: transform 0.3s ease-out;
    }
  }
  .out {
    width: 100%;
    max-height: 60vh;
    border-radius: 14px;
    background: #000;
    border: 1px solid var(--color-line-2);
  }
  .more {
    margin-left: auto;
    color: var(--color-ai);
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
</style>
