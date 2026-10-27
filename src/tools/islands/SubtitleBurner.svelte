<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import {
    FALLBACK_DOWNLOAD_MB,
    capabilities,
    containers,
    downloadName,
    ensureDecodable,
    formatBytes,
    formatTime,
    MediaError,
    parseTime,
    probe,
    toMediaError,
    transcode,
    videoCodecLabel,
    type Capabilities,
    type Container,
    type Ctx2D,
    type MediaErrorCode,
    type MediaInfo,
    type VideoCodec,
  } from '@/engines/media';
  import { downloadBlob, withExtension } from '@/tools/lib/files';
  import { captionAt, decodeText, hasTimings, isValidCue, parseSubtitles, shiftCues, spreadText, toSrt, toVtt, type Cue } from '@/tools/lib/subtitles/format';
  import { defaultStyle, drawCaption, fontCss, fonts, layoutCaption, type CaptionStyle, type FontChoice, type Placement } from '@/tools/lib/subtitles/layout';

  type Phase = 'empty' | 'loading' | 'fallback' | 'converting' | 'edit' | 'burning' | 'done';
  interface Row extends Cue {
    id: number;
  }

  const OUTPUTS: Container[] = ['mp4', 'webm', 'mov'];
  const SAMPLE = 'Your subtitles will look like this';
  const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mpg,.mpeg';
  const SUB_ACCEPT = '.srt,.vtt,text/vtt,application/x-subrip';
  const outlines: [number, string][] = [[0, 'none'], [0.08, 'thin'], [0.14, 'medium'], [0.22, 'thick']];
  const placements: Placement[] = ['top', 'middle', 'bottom'];
  const ENDS = ['start', 'end'] as const;
  const swatches = ['#ffffff', '#ffd25e', '#000000'];
  const errorText: Partial<Record<MediaErrorCode, string>> = {
    'unsupported-input': "This browser can't read that video. An MP4 or WebM file usually works.",
    'unsupported-codec': "This browser can't encode video in that format. Try another output format.",
    'no-webcodecs': 'Burning in subtitles needs WebCodecs, which this browser is missing. Try a recent Chrome, Edge, Safari or Firefox.',
    'no-tracks': "That file has no video track. Pick a video to add subtitles to.",
    'ffmpeg-failed': "The fallback decoder couldn't convert this file.",
  };

  let phase = $state<Phase>('empty');
  let file = $state.raw<File | null>(null);
  /** what the player and the encoder read: the file itself, or an ffmpeg-converted copy */
  let source = $state.raw<Blob | null>(null);
  let info = $state.raw<MediaInfo | null>(null);
  let videoUrl = $state('');
  let previewError = $state('');
  let error = $state('');
  let burnError = $state('');
  let note = $state('');

  let rows = $state<Row[]>([]);
  let nextId = 1;
  let style = $state<CaptionStyle>({ ...defaultStyle });
  let styling = $state(false);
  let pasteOpen = $state(false);
  let pasteText = $state('');
  let shiftBy = $state(0.5);

  let video = $state<HTMLVideoElement>();
  let overlay = $state<HTMLCanvasElement>();
  let list = $state<HTMLOListElement>();
  let subInput = $state<HTMLInputElement>();
  let videoInput = $state<HTMLInputElement>();
  let time = $state(0);
  let paused = $state(true);
  let stageW = $state(0);
  let fontsLoaded = $state(0);
  let trackUrl = $state('');

  let caps = $state.raw<Capabilities | null>(null);
  let container = $state<Container>('mp4');
  let quality = $state<'high' | 'medium'>('high');
  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let result = $state.raw<{ blob: Blob; url: string; name: string; notes: string[] } | null>(null);
  let controller: AbortController | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  let loadSeq = 0;

  const duration = $derived(info?.durationSec ?? 0);
  const dims = $derived(info?.video ? { w: info.video.displayWidth, h: info.video.displayHeight } : null);
  const cues = $derived(rows.filter(isValidCue));
  const badTiming = $derived(rows.filter((r) => r.end <= r.start).length);
  const activeIds = $derived(new Set(rows.filter((r) => time >= r.start && time < r.end).map((r) => r.id)));
  const elapsed = $derived(Math.max(0, (now - startedAt) / 1000));
  const eta = $derived(progress > 0.03 && progress < 1 ? (elapsed * (1 - progress)) / progress : null);
  const baseName = $derived(file?.name ?? 'subtitles.mp4');

  onMount(() => {
    capabilities().then(
      (c) => {
        caps = c;
        if (!canWrite(container)) container = OUTPUTS.find(canWrite) ?? container;
      },
      () => (caps = null),
    );
    // subtitles handed over by the AI subtitle generator's "more caption styles" link
    try {
      const handed = sessionStorage.getItem('rounder:handoff:subtitles');
      if (handed) {
        sessionStorage.removeItem('rounder:handoff:subtitles');
        applyText(handed, 'the subtitle generator');
      }
    } catch {
      // storage can be blocked; the user can still load the file by hand
    }
  });

  onDestroy(() => {
    controller?.abort();
    clearInterval(clock);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (result) URL.revokeObjectURL(result.url);
  });

  function canWrite(c: Container) {
    if (!caps) return true;
    return caps.containers[c] && caps.video.encode.some((v) => containers[c].video.includes(v));
  }

  const cannotEncode = $derived(!!caps && !OUTPUTS.some(canWrite));

  function friendly(e: unknown) {
    const err = toMediaError(e);
    return errorText[err.code] ?? err.message;
  }

  // ---------------------------------------------------------------- loading

  const isSubtitleFile = (f: File) => /\.(srt|vtt)$/i.test(f.name) || f.type === 'text/vtt' || f.type === 'application/x-subrip';

  async function onfiles(files: File[]) {
    const subs = files.find(isSubtitleFile);
    const vid = files.find((f) => !isSubtitleFile(f));
    if (vid) await loadVideo(vid);
    if (subs) await importFile(subs);
  }

  function setPlayable(blob: Blob) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(blob);
    source = blob;
    previewError = '';
    time = 0;
  }

  async function loadVideo(f: File) {
    const seq = ++loadSeq;
    controller?.abort();
    clearResult();
    phase = 'loading';
    error = burnError = '';
    file = f;
    try {
      const probed = await probe(f);
      if (seq !== loadSeq) return;
      // files only ffmpeg can read come back without track details until they're converted
      if (probed.needsFallback) {
        info = probed;
        phase = 'fallback';
        return;
      }
      if (!probed.video) throw new MediaError('no-tracks', 'No video track.');
      info = probed;
      if (OUTPUTS.includes(probed.container as Container) && canWrite(probed.container as Container)) container = probed.container as Container;
      setPlayable(f);
      phase = 'edit';
    } catch (e) {
      if (seq !== loadSeq) return;
      error = friendly(e);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = '';
      file = null;
      source = null;
      info = null;
      phase = 'empty';
    }
  }

  function startJob() {
    controller = new AbortController();
    progress = 0;
    status = '';
    error = '';
    startedAt = now = performance.now();
    clock = setInterval(() => (now = performance.now()), 250);
    return controller.signal;
  }

  function endJob() {
    clearInterval(clock);
    controller = null;
  }

  async function convertForPreview() {
    if (!file) return;
    phase = 'converting';
    const signal = startJob();
    try {
      const r = await ensureDecodable(file, { signal, onProgress: (p) => (progress = p), onStatus: (s) => (status = s) });
      if (!r.info.video) throw new MediaError('no-tracks', 'No video track.');
      info = r.info;
      setPlayable(r.file);
      phase = 'edit';
    } catch (e) {
      error = signal.aborted ? '' : friendly(e);
      phase = 'fallback';
    } finally {
      endJob();
    }
  }

  // ---------------------------------------------------------------- subtitles in

  function setRows(list: Cue[]) {
    rows = list.map((c) => ({ id: nextId++, start: c.start, end: c.end, text: c.text }));
  }

  async function importFile(f: File) {
    try {
      applyText(decodeText(new Uint8Array(await f.arrayBuffer())), f.name);
    } catch {
      error = `Couldn't read ${f.name}.`;
    }
  }

  function applyText(text: string, from: string) {
    error = '';
    if (!hasTimings(text)) {
      if (!duration) return void (error = `No timings found in ${from}. Add the video first, then paste plain lines to spread them across it.`);
      const spread = spreadText(text, duration);
      if (!spread.length) return void (error = `There's no text in ${from}.`);
      setRows(spread);
      note = `No timings found, so ${spread.length} lines were spread across the video by length. Play it through and nudge the times below.`;
      pasteOpen = false;
      return;
    }
    const r = parseSubtitles(text);
    if (!r.cues.length) return void (error = `No readable subtitles in ${from}. Is it an SRT or VTT file?`);
    setRows(r.cues);
    const late = duration ? r.cues.filter((c) => c.start >= duration).length : 0;
    note = [
      `Loaded ${r.cues.length} subtitle${r.cues.length === 1 ? '' : 's'} from ${from}.`,
      r.skipped ? `${r.skipped} empty or broken ${r.skipped === 1 ? 'entry was' : 'entries were'} skipped.` : '',
      late ? `${late} start after the video ends; shift the timing if they're out of sync.` : '',
    ].filter(Boolean).join(' ');
    pasteOpen = false;
    pasteText = '';
  }

  function pickSubtitles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) importFile(f);
    input.value = '';
  }

  function pickVideo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) loadVideo(f);
    input.value = '';
  }

  // ---------------------------------------------------------------- editing

  const round = (t: number) => Math.round(t * 1000) / 1000;
  const clampTime = (t: number) => round(Math.min(Math.max(0, t), duration || t));

  function sortRows() {
    if (rows.every((r, i) => i === 0 || rows[i - 1].start <= r.start)) return;
    rows = rows.slice().sort((a, b) => a.start - b.start);
  }

  function editTime(r: Row, key: 'start' | 'end', input: HTMLInputElement) {
    const v = parseTime(input.value);
    if (v !== null) r[key] = clampTime(v);
    input.value = formatTime(r[key]);
    sortRows();
  }

  function markNow(r: Row, key: 'start' | 'end') {
    r[key] = clampTime(time);
    if (key === 'start' && r.end <= r.start) r.end = clampTime(r.start + 2);
    sortRows();
  }

  async function addRow() {
    const start = clampTime(Math.min(time, Math.max(0, duration - 0.5)));
    const next = rows.find((r) => r.start > start + 0.5);
    const end = clampTime(Math.min(start + 2.5, next?.start ?? Infinity));
    const id = nextId++;
    rows = [...rows, { id, start, end, text: '' }].sort((a, b) => a.start - b.start);
    await tick();
    document.getElementById(`sub-text-${id}`)?.focus();
  }

  function removeRow(id: number) {
    rows = rows.filter((r) => r.id !== id);
  }

  function shift(direction: 1 | -1) {
    const delta = direction * Math.abs(shiftBy || 0);
    if (delta) rows = shiftCues(rows, delta);
  }

  function seek(t: number) {
    if (video) video.currentTime = t;
  }

  function exportAs(kind: 'srt' | 'vtt') {
    const text = kind === 'srt' ? toSrt(cues) : toVtt(cues);
    downloadBlob(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), withExtension(baseName, kind));
  }

  // keep the row being spoken in view while the video plays
  let lastScrolled = -1;
  $effect(() => {
    if (paused || !list) return;
    const id = rows.find((r) => activeIds.has(r.id))?.id;
    if (id === undefined || id === lastScrolled) return;
    lastScrolled = id;
    const el = list.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (el) list.scrollTo({ top: el.offsetTop - list.clientHeight / 3, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // ---------------------------------------------------------------- preview

  const measureWith = (ctx: Ctx2D, font: FontChoice) => (s: string, px: number) => {
    ctx.font = fontCss(font, px);
    return ctx.measureText(s).width;
  };

  // canvas text doesn't trigger web-font loading by itself
  $effect(() => {
    const css = fontCss(style.font, 40);
    document.fonts?.load(css).then(
      () => fontsLoaded++,
      () => {},
    );
  });

  // the preview paints with the same layout + draw code the encoder uses, scaled to the player
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
    const text = captionAt(cues, time) || (!rows.length || styling ? SAMPLE : '');
    const l = text ? layoutCaption(text, style, w, h, measureWith(ctx, style.font)) : null;
    if (l) drawCaption(ctx, l, style);
  });

  // a real captions track too, for screen readers and the player's own CC menu
  $effect(() => {
    const url = URL.createObjectURL(new Blob([toVtt(cues)], { type: 'text/vtt' }));
    trackUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  // ---------------------------------------------------------------- burn in

  async function burn() {
    if (!source || !file || !cues.length || phase !== 'edit') return;
    video?.pause();
    const timed = $state.snapshot(cues) as Cue[];
    const st = $state.snapshot(style) as CaptionStyle;
    // switch phase before any await so a double click can't start two jobs
    phase = 'burning';
    burnError = '';
    const signal = startJob();
    status = 'Starting…';
    await document.fonts?.load(fontCss(st.font, 64)).catch(() => {});
    let cache: { key: string; layout: ReturnType<typeof layoutCaption> } = { key: '', layout: null };
    const draw = (ctx: Ctx2D, f: { time: number; width: number; height: number }) => {
      const text = captionAt(timed, f.time);
      if (!text) return;
      const key = `${f.width}x${f.height}|${text}`;
      if (key !== cache.key) cache = { key, layout: layoutCaption(text, st, f.width, f.height, measureWith(ctx, st.font)) };
      if (cache.layout) drawCaption(ctx, cache.layout, st);
    };
    try {
      const out = await transcode(source, { container, video: { quality, overlay: draw } }, { signal, onProgress: (p) => (progress = p), onStatus: (s) => (status = s) });
      progress = 1;
      result = { blob: out.blob, url: URL.createObjectURL(out.blob), name: downloadName(file.name, out.container, '-subtitled'), notes: out.notes };
      phase = 'done';
    } catch (e) {
      if (!signal.aborted) burnError = friendly(e);
      phase = 'edit';
    } finally {
      endJob();
    }
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function backToEditing() {
    clearResult();
    phase = 'edit';
  }

  function startOver() {
    loadSeq++;
    controller?.abort();
    clearResult();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = '';
    file = null;
    source = null;
    info = null;
    rows = [];
    note = '';
    error = burnError = '';
    pasteOpen = false;
    phase = 'empty';
  }

  const codecName = (c: string | null | undefined) => (c ? (videoCodecLabel[c as VideoCodec] ?? c.toUpperCase()) : 'unknown codec');
  const clockText = (s: number) => formatTime(s, 0);
  const sizeChange = (a: number, b: number) => {
    const pct = Math.round(((b - a) / a) * 100);
    return pct === 0 ? 'same size' : pct > 0 ? `${pct}% larger` : `${-pct}% smaller`;
  };
</script>

{#snippet job(title: string)}
  <div class="card job">
    <div class="job-head">
      <h3 class="font-serif text-2xl">{title}</h3>
      <span class="pct font-serif" aria-hidden="true">{Math.round(progress * 100)}<small>%</small></span>
    </div>
    <div class="bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <span style:transform="scaleX({progress})"></span>
    </div>
    <div class="job-foot">
      <span class="mono">{status || 'Working…'} · {clockText(elapsed)} elapsed{eta !== null ? ` · about ${clockText(eta)} left` : ''}</span>
      <button type="button" class="btn" onclick={() => controller?.abort()}>Cancel</button>
    </div>
  </div>
{/snippet}

<input bind:this={subInput} type="file" accept={SUB_ACCEPT} hidden onchange={pickSubtitles} />
<input bind:this={videoInput} type="file" accept={VIDEO_ACCEPT} hidden onchange={pickVideo} />

<div class="burner">
  {#if error}
    <p class="msg bad" role="alert">{error}</p>
  {/if}

  {#if phase === 'empty'}
    <Dropzone accept={`${VIDEO_ACCEPT},${SUB_ACCEPT}`} multiple title="Drop a video" hint="add its .srt or .vtt too if you have one · or click to choose" onfiles={onfiles} />
    {#if rows.length}
      <p class="msg">{note} Now add the video they belong to.</p>
    {/if}
  {:else if phase === 'loading'}
    <div class="card pad mono" aria-busy="true">Reading {file?.name}…</div>
  {:else if phase === 'fallback'}
    <div class="card pad grid gap-3">
      <h3 class="font-serif text-2xl">This video needs an extra decoder</h3>
      <p class="text-(--color-soft)">
        Your browser can't play <strong>{file?.name}</strong> on its own. A one-time
        {FALLBACK_DOWNLOAD_MB} MB decoder can convert it right here on your device first. Nothing is uploaded.
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" onclick={convertForPreview}>Download decoder &amp; continue</button>
        <button type="button" class="btn" onclick={startOver}>Choose another video</button>
      </div>
    </div>
  {:else if phase === 'converting'}
    {@render job('Preparing your video')}
  {:else if phase === 'done' && result && file}
    <div class="card pad grid gap-4 done">
      <div class="flex items-center gap-3">
        <span class="tick" aria-hidden="true">✓</span>
        <div>
          <h3 class="font-serif text-3xl leading-none">Subtitles burned in</h3>
          <p class="mono mt-1">{formatBytes(file.size)} → {formatBytes(result.blob.size)} · {sizeChange(file.size, result.blob.size)} · took {clockText(elapsed)}</p>
        </div>
      </div>
      <div class="stage-wrap">
        <video class="out" src={result.url} controls playsinline style:aspect-ratio={dims ? `${dims.w} / ${dims.h}` : undefined}>
          <track kind="captions" src={trackUrl} label="Subtitles (text copy)" />
        </video>
      </div>
      {#each result.notes as n}
        <p class="mono">{n}</p>
      {/each}
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary" onclick={() => result && downloadBlob(result.blob, result.name)}>Download {result.name}</button>
        <button type="button" class="btn" onclick={() => exportAs('srt')}>SRT</button>
        <button type="button" class="btn" onclick={() => exportAs('vtt')}>VTT</button>
        <button type="button" class="btn" onclick={backToEditing}>Back to editing</button>
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </div>
  {:else if info && dims}
    <div class="filebar card">
      <div class="min-w-0">
        <div class="truncate font-medium">{file?.name}</div>
        <div class="mono">
          {formatTime(duration, 1)} · {dims.w}×{dims.h} · {codecName(info.video?.codec)}{info.video?.fps ? ` · ${Math.round(info.video.fps)} fps` : ''} · {formatBytes(file?.size ?? 0)}
        </div>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn sm" onclick={() => videoInput?.click()} disabled={phase === 'burning'}>Change video</button>
        <button type="button" class="btn sm" onclick={startOver} disabled={phase === 'burning'}>Start over</button>
      </div>
    </div>

    <div class="workspace" inert={phase === 'burning'}>
      <div class="player">
        <div class="stage" bind:clientWidth={stageW} style:aspect-ratio="{dims.w} / {dims.h}" style:width="min(100%, calc(64vh * {dims.w / dims.h}))">
          <video bind:this={video} src={videoUrl} controls playsinline preload="metadata" bind:currentTime={time} bind:paused onerror={() => (previewError = "Your browser can't preview this video, but burning in may still work.")}>
            <track kind="captions" src={trackUrl} label="Subtitles" />
          </video>
          <canvas bind:this={overlay} aria-hidden="true"></canvas>
        </div>
        {#if previewError}<p class="mono text-(--color-bad)">{previewError}</p>{/if}

        <div class="strip" aria-hidden="true" hidden={!duration}>
          {#each cues as c}
            <button type="button" tabindex="-1" aria-label="Jump to {formatTime(c.start)}" class="cue" class:on={time >= c.start && time < c.end} style:left="{(c.start / duration) * 100}%" style:width="{((c.end - c.start) / duration) * 100}%" onclick={() => seek(c.start)}></button>
          {/each}
          <span class="head" style:left="{(time / duration) * 100}%"></span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-primary" onclick={addRow}>+ Add line at {formatTime(time, 1)}</button>
          <button type="button" class="btn" onclick={() => subInput?.click()}>Load .srt / .vtt</button>
          <button type="button" class="btn" aria-expanded={pasteOpen} onclick={() => (pasteOpen = !pasteOpen)}>Paste text</button>
        </div>

        {#if pasteOpen}
          <div class="grid gap-2">
            <label for="sub-paste" class="label">paste SRT or VTT, or plain lines without times (they'll be spread across the video)</label>
            <textarea id="sub-paste" class="field paste" bind:value={pasteText} placeholder={'1\n00:00:01,000 --> 00:00:03,000\nHello there!'}></textarea>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary" disabled={!pasteText.trim()} onclick={() => applyText(pasteText, 'the pasted text')}>Use this text</button>
              <button type="button" class="btn" onclick={() => (pasteOpen = false)}>Close</button>
            </div>
          </div>
        {/if}
        {#if note}<p class="msg">{note}</p>{/if}
      </div>

      <fieldset class="card style" onfocusin={() => (styling = true)} onfocusout={() => (styling = false)}>
        <legend class="sr-only">Subtitle style</legend>
        <div>
          <span class="label">font</span>
          <div class="seg" role="group" aria-label="Font">
            {#each Object.entries(fonts) as [key, f]}
              <button type="button" aria-pressed={style.font === key} style:font-family={f.family} style:font-weight={f.weight} onclick={() => (style.font = key as FontChoice)}>{f.label}</button>
            {/each}
          </div>
        </div>

        <label>
          <span class="label">size · {Math.round(style.size * 1000) / 10}% of the height</span>
          <input type="range" min="2.5" max="12" step="0.5" value={style.size * 100} oninput={(e) => (style.size = +e.currentTarget.value / 100)} class="w-full accent-(--color-sun)" />
        </label>

        <div>
          <span class="label">text color</span>
          <div class="flex items-center gap-2">
            <input type="color" bind:value={style.color} aria-label="Text color" class="swatch-input" />
            {#each swatches as c}
              <button type="button" class="swatch" style:background={c} aria-label="Use {c}" aria-pressed={style.color === c} onclick={() => (style.color = c)}></button>
            {/each}
          </div>
        </div>

        <div>
          <span class="label">outline</span>
          <div class="flex flex-wrap items-center gap-2">
            <div class="seg" role="group" aria-label="Outline">
              {#each outlines as [v, label]}
                <button type="button" aria-pressed={style.outline === v} onclick={() => (style.outline = v)}>{label}</button>
              {/each}
            </div>
            {#if style.outline}
              <input type="color" bind:value={style.outlineColor} aria-label="Outline color" class="swatch-input" />
            {/if}
          </div>
        </div>

        <div class="grid gap-2">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={style.box} />
            Background box
          </label>
          {#if style.box}
            <div class="flex items-center gap-3">
              <input type="color" bind:value={style.boxColor} aria-label="Box color" class="swatch-input" />
              <label class="grow">
                <span class="label">opacity · {Math.round(style.boxOpacity * 100)}%</span>
                <input type="range" min="0.2" max="1" step="0.05" bind:value={style.boxOpacity} class="w-full accent-(--color-sun)" />
              </label>
            </div>
          {/if}
        </div>

        <div>
          <span class="label">position</span>
          <div class="seg" role="group" aria-label="Position">
            {#each placements as p}
              <button type="button" aria-pressed={style.position === p} onclick={() => (style.position = p)}>{p}</button>
            {/each}
          </div>
        </div>

        <label>
          <span class="label">max width · {Math.round(style.maxWidth * 100)}% of the frame</span>
          <input type="range" min="0.4" max="1" step="0.02" bind:value={style.maxWidth} class="w-full accent-(--color-sun)" />
        </label>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={style.uppercase} />
          ALL CAPS
        </label>
      </fieldset>
    </div>

    <section class="card editor" inert={phase === 'burning'} aria-labelledby="subs-heading">
      <div class="editor-head">
        <h3 id="subs-heading" class="font-serif text-2xl">Subtitles <span class="mono">{cues.length} ready{badTiming ? ` · ${badTiming} end before they start` : ''}</span></h3>
        <div class="flex flex-wrap items-center gap-2">
          <div class="shift" role="group" aria-label="Shift all subtitles">
            <button type="button" class="btn sm" disabled={!rows.length} onclick={() => shift(-1)} aria-label="Shift all earlier by {shiftBy} seconds">− earlier</button>
            <label class="mono flex items-center gap-1">
              <input type="number" class="field num" min="0" step="0.1" bind:value={shiftBy} aria-label="Shift amount in seconds" />s
            </label>
            <button type="button" class="btn sm" disabled={!rows.length} onclick={() => shift(1)} aria-label="Shift all later by {shiftBy} seconds">later +</button>
          </div>
          <button type="button" class="btn sm" disabled={!cues.length} onclick={() => exportAs('srt')}>Download SRT</button>
          <button type="button" class="btn sm" disabled={!cues.length} onclick={() => exportAs('vtt')}>VTT</button>
        </div>
      </div>

      {#if rows.length}
        <ol class="rows" bind:this={list}>
          {#each rows as r, i (r.id)}
            <li data-id={r.id} class:active={activeIds.has(r.id)} class:bad={r.end <= r.start}>
              <button type="button" class="idx mono" onclick={() => seek(r.start)} aria-label="Play from subtitle {i + 1}">{i + 1}</button>
              <div class="times">
                {#each ENDS as key}
                  <div class="time">
                    <input
                      class="field mono"
                      value={formatTime(r[key])}
                      aria-label="{key === 'start' ? 'Start' : 'End'} of subtitle {i + 1}"
                      onchange={(e) => editTime(r, key, e.currentTarget)}
                    />
                    <button type="button" class="now mono" onclick={() => markNow(r, key)} title="Set {key} to the current time" aria-label="Set {key} of subtitle {i + 1} to the current time">now</button>
                  </div>
                {/each}
              </div>
              <textarea id="sub-text-{r.id}" class="field text" rows="2" bind:value={r.text} placeholder="Type the words…" aria-label="Text of subtitle {i + 1}"></textarea>
              <button type="button" class="del" onclick={() => removeRow(r.id)} aria-label="Delete subtitle {i + 1}">×</button>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="empty">
          <p>No subtitles yet. Load an .srt or .vtt file, paste some text, or play the video and press <strong>Add line</strong> wherever someone speaks.</p>
        </div>
      {/if}
      <p class="mono soon">✦ No subtitles yet? <a href="/subtitle-generator">Generate them with AI</a>, right on your device.</p>
    </section>

    {#if phase === 'burning'}
      {@render job('Burning in subtitles')}
    {:else}
      {#if burnError}
        <p class="msg bad" role="alert">{burnError}</p>
      {/if}
      <div class="card burnbar">
        <div>
          <span class="label">output format</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each OUTPUTS as c}
              <button type="button" aria-pressed={container === c} disabled={!canWrite(c)} title={canWrite(c) ? undefined : `Your browser can't encode ${containers[c].label} video`} onclick={() => (container = c)}>
                {containers[c].label}
              </button>
            {/each}
          </div>
        </div>
        <div>
          <span class="label">quality</span>
          <div class="seg" role="group" aria-label="Quality">
            <button type="button" aria-pressed={quality === 'high'} onclick={() => (quality = 'high')}>high</button>
            <button type="button" aria-pressed={quality === 'medium'} onclick={() => (quality = 'medium')}>smaller file</button>
          </div>
        </div>
        <div class="go">
          <button type="button" class="btn btn-primary" disabled={!cues.length || cannotEncode} onclick={burn}>Burn in subtitles</button>
          <span class="mono">
            {#if cannotEncode}
              This browser can't encode video. You can still download the subtitles as SRT or VTT.
            {:else if !cues.length}
              Add at least one subtitle first.
            {:else}
              {dims.w}×{dims.h} {containers[container].label} · no watermark
            {/if}
          </span>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .burner {
    display: grid;
    gap: 16px;
  }
  .pad {
    padding: 20px;
  }
  .msg {
    font-size: 14px;
    color: var(--color-soft);
    border-left: 2px solid var(--color-sun);
    padding: 4px 0 4px 12px;
  }
  .msg.bad {
    border-color: var(--color-bad);
    color: var(--color-bad);
  }
  .btn.sm {
    padding: 8px 12px;
    font-size: 13.5px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .filebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
  }

  .workspace {
    display: grid;
    gap: 16px;
    align-items: start;
  }
  @media (min-width: 860px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) 300px;
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
  }
  .stage video,
  .stage canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .stage canvas {
    pointer-events: none;
  }
  .stage-wrap {
    display: grid;
    justify-items: center;
  }
  .out {
    max-width: 100%;
    max-height: 64vh;
    border-radius: 14px;
    background: #000;
    border: 1px solid var(--color-line-2);
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
    background: #f2ede455;
    cursor: pointer;
  }
  .cue.on {
    background: var(--color-sun);
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

  .style {
    display: grid;
    gap: 16px;
    padding: 18px;
    min-width: 0;
  }
  .swatch,
  .swatch-input {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    padding: 0;
    background: none;
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--color-sun);
    outline-offset: 2px;
  }

  .editor {
    padding: 18px;
    display: grid;
    gap: 14px;
  }
  .editor-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .shift {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 70px;
    padding: 7px 8px;
    font-size: 13.5px;
  }
  .rows {
    position: relative;
    display: grid;
    gap: 8px;
    max-height: 440px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .rows li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 34px;
    grid-template-areas: 'idx times del' 'idx text text';
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-panel-2);
    transition: border-color 0.2s, background-color 0.2s;
  }
  @media (min-width: 720px) {
    .rows li {
      grid-template-columns: 34px auto minmax(0, 1fr) 34px;
      grid-template-areas: 'idx times text del';
      align-items: start;
    }
  }
  .rows li.active {
    border-color: var(--color-sun);
    background: #ffd25e12;
  }
  .rows li.bad .time .field {
    border-color: var(--color-bad);
  }
  .idx {
    grid-area: idx;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--color-line-2);
    background: transparent;
    cursor: pointer;
  }
  .idx:hover {
    color: var(--color-sun);
    border-color: var(--color-sun);
  }
  .times {
    grid-area: times;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .time {
    display: flex;
    align-items: stretch;
  }
  .time .field {
    width: 98px;
    padding: 6px 8px;
    font-size: 13.5px;
    color: var(--color-chalk);
    border-radius: 9px 0 0 9px;
  }
  .now {
    padding: 0 9px;
    border: 1px solid var(--color-line-2);
    border-left: 0;
    border-radius: 0 9px 9px 0;
    background: var(--color-panel);
    cursor: pointer;
  }
  .now:hover {
    color: var(--color-sun);
  }
  .text {
    grid-area: text;
    min-height: 0;
    padding: 6px 10px;
    font-family: var(--font-sans);
    font-size: 15px;
    resize: vertical;
  }
  .del {
    grid-area: del;
    height: 34px;
    font-size: 20px;
    line-height: 1;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
  }
  .del:hover {
    color: var(--color-bad);
    border-color: var(--color-line-2);
  }
  .paste {
    min-height: 140px;
  }
  .empty {
    padding: 22px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 12px;
    color: var(--color-soft);
    text-align: center;
  }
  .soon {
    color: var(--color-ai);
  }

  .burnbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 16px 24px;
    padding: 18px;
  }
  .burnbar .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .go {
    display: grid;
    gap: 6px;
    margin-left: auto;
    justify-items: end;
  }
  @media (max-width: 600px) {
    .go {
      margin-left: 0;
      justify-items: start;
      width: 100%;
    }
    .go .btn {
      width: 100%;
    }
  }

  .job {
    display: grid;
    gap: 14px;
    padding: 20px;
  }
  .job-head,
  .job-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .pct {
    font-size: 44px;
    line-height: 1;
    color: var(--color-sun);
    font-variant-numeric: tabular-nums;
  }
  .pct small {
    font-size: 22px;
    color: var(--color-muted);
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--color-panel-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, #ffd25eaa, var(--color-sun));
    transition: transform 0.3s ease-out;
  }

  .tick {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    flex: none;
    border-radius: 50%;
    font-size: 24px;
    color: var(--color-bg);
    background: var(--color-ok);
    animation: pop 0.5s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
</style>
