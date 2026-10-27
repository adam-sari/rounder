<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import {
    capabilities,
    containers,
    decodeAudio,
    downloadName,
    ensureDecodable,
    FALLBACK_DOWNLOAD_MB,
    formatBytes,
    formatTime,
    isAbort,
    MediaError,
    parseTime,
    preloadFallback,
    probe,
    transcode,
    writeWav,
    type AudioCodec,
    type Container,
    type MediaInfo,
  } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import { canReplaceDirectly, musicBlocks, musicEnd, musicEnvelope, musicSource, musicTimeAt, PcmStream, renderMixWav, type MixPlan } from '@/tools/lib/add-audio-to-video/mix';
  import { describeMedia, errorMessage, etaSeconds, formatSeconds, keepContainer, rotatedPicture, sizeChange } from '@/tools/lib/mute-video/media';

  type Slot = 'video' | 'music';
  interface Source {
    file: File;
    /** what we actually read and play: the file itself, or a converted copy */
    src: Blob;
    info: MediaInfo;
    url: string;
    converted: boolean;
  }

  const VIDEO_ACCEPT = 'video/*,.mkv,.mov,.m4v,.avi,.wmv,.flv,.3gp,.ts,.mts,.mpg,.mpeg,.ogv';
  const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.ac3,.amr,.weba';
  const fadeIns = [0, 0.5, 1, 2];
  const fadeOuts = [0, 1, 2, 3, 5];

  let video = $state<Source | null>(null);
  let music = $state<Source | null>(null);
  let loading = $state<Record<Slot, boolean>>({ video: false, music: false });
  let error = $state('');

  let trimStart = $state(0);
  let trimEnd = $state(0);
  let offset = $state(0);
  let loop = $state(true);
  let fadeIn = $state(0);
  let fadeOut = $state(2);
  let musicVol = $state(100);
  let originalVol = $state(100);

  let videoEl = $state<HTMLVideoElement | null>(null);
  let musicEl = $state<HTMLAudioElement | null>(null);
  let videoTime = $state(0);
  let previewFailed = $state(false);

  let decoder = $state<'idle' | 'loading' | 'converting'>('idle');
  let decoderPct = $state(0);
  let decoderStatus = $state('');

  let working = $state(false);
  let progress = $state(0);
  let stage = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let result = $state<{ blob: Blob; name: string; url: string } | null>(null);
  let ctrl: AbortController | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;

  const duration = $derived(video?.info.durationSec ?? 0);
  const hasOriginal = $derived(!!video?.info.audio);
  const plan: MixPlan = $derived({
    duration,
    offset,
    musicLength: Math.max(0, trimEnd - trimStart),
    loop,
    fadeIn,
    fadeOut,
    musicGain: musicVol / 100,
    originalGain: hasOriginal ? originalVol / 100 : 0,
  });
  const blocks = $derived(duration > 0 ? musicBlocks(plan) : []);
  const needsDecoder = $derived(!!(video?.info.needsFallback || music?.info.needsFallback));
  const elapsed = $derived(working ? now - startedAt : 0);
  const eta = $derived(etaSeconds(progress, elapsed));
  const pct = (t: number) => (duration > 0 ? Math.min(100, (t / duration) * 100) : 0);

  // ---------------------------------------------------------------- files

  const looksLikeAudio = (f: File) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|aiff?|ac3|amr|weba)$/i.test(f.name);

  /** one file goes where it was dropped; two are sorted by type */
  function pick(files: File[], slot: Slot) {
    if (files.length === 1) return load(slot === 'video' && looksLikeAudio(files[0]) ? 'music' : slot, files[0]);
    const audio = files.find(looksLikeAudio);
    const vid = files.find((f) => !looksLikeAudio(f));
    if (vid) void load('video', vid);
    if (audio) void load('music', audio);
  }

  async function load(slot: Slot, file: File) {
    error = '';
    loading[slot] = true;
    try {
      const info = await probe(file);
      if (info.readable && slot === 'video' && !info.video) {
        if (info.audio && !music) return load('music', file);
        throw new MediaError('no-tracks', 'That file has no picture. Drop a video here, and the music in the other box.');
      }
      if (info.readable && slot === 'music' && !info.audio) throw new MediaError('no-tracks', 'That file has no sound to add.');
      setSource(slot, { file, src: file, info, url: URL.createObjectURL(file), converted: false });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading[slot] = false;
    }
  }

  function setSource(slot: Slot, s: Source) {
    const old = slot === 'video' ? video : music;
    if (old) URL.revokeObjectURL(old.url);
    clearResult();
    if (slot === 'video') {
      video = s;
      previewFailed = false;
      videoTime = 0;
      offset = Math.min(offset, Math.max(0, s.info.durationSec - 0.5));
    } else {
      music = s;
      trimStart = 0;
      trimEnd = s.info.durationSec;
    }
  }

  /** downloads ffmpeg.wasm once, then turns odd inputs into something the browser can play */
  let convertCtrl: AbortController | null = null;

  async function convertOddFiles() {
    decoder = 'loading';
    error = '';
    convertCtrl = new AbortController();
    const { signal } = convertCtrl;
    try {
      await preloadFallback((p) => (decoderPct = p));
      decoder = 'converting';
      const onStatus = (s: string) => (decoderStatus = s);
      if (video?.info.needsFallback) {
        const v = video;
        const { file: src, info } = await ensureDecodable(v.file, { onStatus, signal });
        // skip if the file was swapped meanwhile
        if (video?.file === v.file) setSource('video', { file: v.file, src, info, url: URL.createObjectURL(src), converted: true });
      }
      if (music?.info.needsFallback) {
        const m = music;
        decoderStatus = 'Decoding the music…';
        const wav = new Blob([writeWav(await decodeAudio(m.file, {}, { onStatus, signal }))], { type: 'audio/wav' });
        const info = await probe(wav);
        if (music?.file === m.file) setSource('music', { file: m.file, src: wav, info, url: URL.createObjectURL(wav), converted: true });
      }
    } catch (e) {
      if (!isAbort(e)) error = errorMessage(e);
    } finally {
      decoder = 'idle';
      decoderStatus = '';
      convertCtrl = null;
    }
  }

  // ---------------------------------------------------------------- preview: both tracks in sync

  // Web Audio lets the preview go above 100% and follow the fades; plain volume is the fallback
  let audioCtx: AudioContext | null = null;
  const gains = new WeakMap<HTMLMediaElement, GainNode>();
  let raf = 0;

  function route(el: HTMLMediaElement) {
    if (gains.has(el) || typeof AudioContext === 'undefined') return;
    try {
      audioCtx ??= new AudioContext();
      const gain = audioCtx.createGain();
      audioCtx.createMediaElementSource(el).connect(gain).connect(audioCtx.destination);
      gains.set(el, gain);
      // the gain node does the volume from here on
      el.volume = 1;
    } catch {
      // stays on element volume
    }
  }

  function setGain(el: HTMLMediaElement, value: number) {
    const g = gains.get(el);
    if (g && audioCtx) g.gain.setTargetAtTime(value, audioCtx.currentTime, 0.03);
    else el.volume = Math.min(1, value);
  }

  function sync() {
    cancelAnimationFrame(raf);
    const v = videoEl;
    const m = musicEl;
    if (!v) return;
    videoTime = v.currentTime;
    setGain(v, plan.originalGain);
    if (!m) return;
    const rel = musicTimeAt(plan, v.currentTime);
    if (v.paused || v.ended || rel === null) {
      if (!v.paused || v.ended) m.pause();
    } else {
      const target = trimStart + rel;
      if (Math.abs(m.currentTime - target) > 0.2) m.currentTime = target;
      setGain(m, plan.musicGain * musicEnvelope(plan, v.currentTime));
      if (m.paused) m.play().catch(() => {});
    }
    if (!v.paused) raf = requestAnimationFrame(sync);
  }

  function onVideoPlay() {
    if (videoEl) route(videoEl);
    if (musicEl) route(musicEl);
    void audioCtx?.resume();
    sync();
  }

  function onVideoPause() {
    cancelAnimationFrame(raf);
    musicEl?.pause();
    if (musicEl) setGain(musicEl, plan.musicGain);
  }

  /** the music on its own (trim timeline's play button) plays at its set volume */
  function onMusicPlay() {
    if (!musicEl) return;
    route(musicEl);
    void audioCtx?.resume();
    if (!videoEl || videoEl.paused) setGain(musicEl, plan.musicGain);
  }

  // ---------------------------------------------------------------- music lane: drag to place

  let lane = $state<HTMLDivElement>();
  let drag: { x: number; from: number } | null = null;

  const setOffset = (t: number) => (offset = Math.round(Math.min(Math.max(0, duration - 0.1), Math.max(0, t)) * 100) / 100);

  function laneDown(e: PointerEvent) {
    if (e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, from: offset };
  }

  function laneMove(e: PointerEvent) {
    if (!drag || !lane) return;
    setOffset(drag.from + ((e.clientX - drag.x) / lane.clientWidth) * duration);
  }

  function laneKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 1 : 0.1;
    const keys: Record<string, number> = { ArrowLeft: offset - step, ArrowDown: offset - step, ArrowRight: offset + step, ArrowUp: offset + step, Home: 0, End: duration };
    if (!(e.key in keys)) return;
    e.preventDefault();
    setOffset(keys[e.key]);
  }

  function seekVideo(e: PointerEvent) {
    if (!videoEl || !duration) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    videoEl.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
    sync();
  }

  function typeOffset(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const t = parseTime(input.value);
    if (t !== null) setOffset(t);
    input.value = formatTime(offset);
  }

  // ---------------------------------------------------------------- export

  async function outputFormat(): Promise<{ container: Container; codec?: AudioCodec }> {
    const caps = await capabilities().catch(() => null);
    let container = video!.converted ? 'mp4' : keepContainer(video!.info, caps?.containers);
    const codecFor = (c: Container) => containers[c].audio.find((a) => !caps || caps.audio.encode.includes(a));
    // e.g. WebM needs Opus or Vorbis; MP4 holds VP9/AV1 too, so it can take the same picture
    if (!codecFor(container)) container = 'mp4';
    return { container, codec: codecFor(container) };
  }

  async function exportVideo() {
    if (!video || !music) return;
    videoEl?.pause();
    musicEl?.pause();
    working = true;
    error = '';
    progress = 0;
    stage = 'Getting ready…';
    startedAt = now = performance.now();
    clock = setInterval(() => (now = performance.now()), 250);
    ctrl = new AbortController();
    const { signal } = ctrl;
    const span = (a: number, b: number) => (p: number) => (progress = a + (b - a) * p);
    const p = { ...plan };
    try {
      const { container, codec } = await outputFormat();
      let replace: Blob = music.src;
      let replaceOffset = trimStart;
      let gainDb: number | undefined = p.musicGain !== 1 ? 20 * Math.log10(p.musicGain) : undefined;
      let from = 0;
      if (!canReplaceDirectly(p, { start: trimStart, end: trimEnd }, music.info.durationSec, hasOriginal)) {
        // mix at the music's own rate when the encoder takes it, so the song isn't resampled
        const musicRate = music.info.audio?.sampleRate ?? 0;
        const rate = codec !== 'opus' && (musicRate === 44_100 || musicRate === 48_000) ? musicRate : 48_000;
        // both tracks are decoded a minute at a time while mixing, so long videos fit in memory
        const read = (src: Blob) => (start: number, end: number) => decodeAudio(src, { start, end }, { signal });
        stage = 'Reading the music…';
        // without looping, nothing past the video's end is ever heard
        const segEnd = p.loop ? trimEnd : Math.min(trimEnd, trimStart + Math.max(0, p.duration - p.offset));
        const tune = await musicSource(read(music.src), { start: trimStart, end: segEnd }, p.loop, rate);
        const original = p.originalGain > 0 ? new PcmStream(read(video.src), 0, p.duration, rate) : null;
        stage = 'Mixing the soundtrack…';
        replace = await renderMixWav(p, rate, tune, original, { signal, onProgress: span(0, 0.45) });
        replaceOffset = 0;
        gainDb = undefined;
        from = 0.45;
      }
      stage = 'Adding the soundtrack…';
      const r = await transcode(
        video.src,
        { container, audio: { replace, replaceOffset, gainDb, codec, bitrate: 192_000 } },
        { signal, onProgress: span(from, 1), onStatus: (s) => s !== 'Converting…' && (stage = s) },
      );
      result = { blob: r.blob, name: downloadName(video.file.name, container, '-with-music'), url: URL.createObjectURL(r.blob) };
    } catch (e) {
      if (!isAbort(e)) error = errorMessage(e);
    } finally {
      clearInterval(clock);
      working = false;
      ctrl = null;
    }
  }

  function clearResult() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
  }

  function startOver() {
    ctrl?.abort();
    clearResult();
    for (const s of [video, music]) if (s) URL.revokeObjectURL(s.url);
    video = music = null;
    offset = 0;
    error = '';
  }

  onDestroy(() => {
    ctrl?.abort();
    convertCtrl?.abort();
    clearInterval(clock);
    cancelAnimationFrame(raf);
    for (const s of [video, music]) if (s) URL.revokeObjectURL(s.url);
    if (result) URL.revokeObjectURL(result.url);
    void audioCtx?.close();
  });

  let videoPicker = $state<HTMLInputElement>();
  let musicPicker = $state<HTMLInputElement>();
  const fromPicker = (slot: Slot) => (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void load(slot, f);
  };

  const musicSummary = $derived.by(() => {
    if (!blocks.length) return 'the music starts after the video ends';
    const end = musicEnd(plan);
    const loops = loop && blocks.length > 1 ? ` · plays ${blocks.length}×` : '';
    const cut = !loop && trimEnd - trimStart > duration - offset ? ' · cut at the end' : '';
    const early = !loop && end < duration - 0.05 ? ' · silent after' : '';
    return `music ${formatTime(offset, 1)} → ${formatTime(end, 1)}${loops}${cut}${early}`;
  });
</script>

{#snippet card(slot: Slot, s: Source)}
  <div class="file">
    <span class="tag" class:audio={slot === 'music'} aria-hidden="true">{slot === 'video' ? '▶' : '♪'}</span>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm">{s.file.name}</p>
      <p class="mono truncate">{formatBytes(s.file.size)} · {describeMedia(s.info).join(' · ')}{s.converted ? ' · converted' : ''}</p>
    </div>
    <button type="button" class="btn px-3! py-2! text-sm!" disabled={working || loading.video || loading.music} onclick={() => (slot === 'video' ? videoPicker : musicPicker)?.click()}>
      change<span class="sr-only"> {slot}</span>
    </button>
  </div>
{/snippet}

<input bind:this={videoPicker} type="file" accept={VIDEO_ACCEPT} hidden onchange={fromPicker('video')} />
<input bind:this={musicPicker} type="file" accept={`${AUDIO_ACCEPT},video/*`} hidden onchange={fromPicker('music')} />

{#if !video || !music || needsDecoder}
  <div class="grid gap-4 sm:grid-cols-2">
    {#each ['video', 'music'] as const as slot}
      {@const s = slot === 'video' ? video : music}
      <div class="grid content-start gap-2">
        <span class="label">{slot === 'video' ? '1 · your video' : '2 · music or voiceover'}</span>
        {#if loading[slot]}
          <div class="placeholder"><p class="font-serif text-2xl working">Reading…</p></div>
        {:else if s}
          {@render card(slot, s)}
          {#if slot === 'video' && !s.info.needsFallback}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video class="mini" src={s.url} controls playsinline preload="metadata"></video>
          {/if}
        {:else}
          <Dropzone
            accept={slot === 'video' ? `${VIDEO_ACCEPT},${AUDIO_ACCEPT}` : `${AUDIO_ACCEPT},video/*`}
            multiple
            paste={false}
            title={slot === 'video' ? 'Drop your video' : 'Drop the music'}
            hint={slot === 'video' ? 'MP4, MOV, WebM, MKV… or both files at once' : 'MP3, WAV, M4A, OGG, FLAC…'}
            onfiles={(f) => pick(f, slot)}
          />
        {/if}
      </div>
    {/each}
  </div>
  {#if needsDecoder}
    <div class="note mt-4">
      <p class="text-sm">
        {video?.info.needsFallback && music?.info.needsFallback ? 'Both files use formats' : `Your ${video?.info.needsFallback ? 'video' : 'audio file'} uses a format`} this browser can't open by itself.
        A one-time {FALLBACK_DOWNLOAD_MB} MB decoder can convert it on your device; it stays cached for next time.
      </p>
      <button type="button" class="btn justify-self-start" disabled={decoder !== 'idle'} onclick={convertOddFiles}>
        {decoder === 'loading' ? `Downloading… ${Math.round(decoderPct * 100)}%` : decoder === 'converting' ? decoderStatus || 'Converting…' : `Download decoder (${FALLBACK_DOWNLOAD_MB} MB) & convert`}
      </button>
    </div>
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      {#if result}
        <figure class="player">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={result.url} controls playsinline preload="metadata"></video>
          <figcaption class="mono truncate">{result.name}</figcaption>
        </figure>
      {:else}
        <figure class="player">
          {#if previewFailed}
            <div class="noview">
              <p class="font-serif text-2xl">No preview for this format</p>
              <p class="mono">your browser can't play it, but the music can still be added</p>
            </div>
          {:else}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoEl}
              src={video.url}
              controls
              playsinline
              preload="auto"
              onplay={onVideoPlay}
              onpause={onVideoPause}
              onended={onVideoPause}
              onseeked={sync}
              ontimeupdate={() => videoEl && (videoTime = videoEl.currentTime)}
              onerror={() => (previewFailed = true)}
            ></video>
          {/if}
          <figcaption class="mono">press play to hear the mix · both tracks play in sync</figcaption>
        </figure>

        <div class="lanes" style:--head={pct(videoTime) / 100}>
          <div class="lane-row">
            <span class="lane-label mono">video</span>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="lane video-lane" class:quiet={!plan.originalGain} onpointerdown={seekVideo} title="Click to seek">
              <span class="mono">{hasOriginal ? (plan.originalGain ? `original sound ${originalVol}%` : 'original sound off') : 'no original sound'}</span>
            </div>
          </div>
          <div class="lane-row">
            <span class="lane-label mono">music</span>
            <div
              class="lane music-lane"
              bind:this={lane}
              role="slider"
              tabindex="0"
              aria-label="Music start time. Drag or use the arrow keys."
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 100) / 100}
              aria-valuenow={offset}
              aria-valuetext={formatTime(offset)}
              onpointerdown={laneDown}
              onpointermove={laneMove}
              onpointerup={() => (drag = null)}
              onpointercancel={() => (drag = null)}
              onkeydown={laneKey}
            >
              {#each blocks as b, i (i)}
                <span class="block" class:repeat={i > 0} style:left={`${pct(b.start)}%`} style:width={`${pct(b.end) - pct(b.start)}%`}></span>
              {/each}
              {#if blocks.length && (fadeIn || fadeOut)}
                <svg class="env" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={Array.from({ length: 201 }, (_, k) => `${k / 2},${10 - 9 * musicEnvelope(plan, (k / 200) * duration)}`).join(' ')} />
                </svg>
              {/if}
            </div>
          </div>
          <span class="head" aria-hidden="true"></span>
        </div>
        <p class="mono -mt-2">{musicSummary}</p>

        <div class="grid gap-2">
          {@render card('music', music)}
          <audio bind:this={musicEl} src={music.url} preload="auto" onplay={onMusicPlay}></audio>
          <span class="label mt-1">trim the music · drag the handles</span>
          <TrimTimeline duration={music.info.durationSec} file={music.src} kind="audio" media={musicEl} bind:start={trimStart} bind:end={trimEnd} minLength={0.5} disabled={working} />
        </div>
        {@render card('video', video)}
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      {#if result}
        <div class="done" aria-live="polite">
          <span class="check" aria-hidden="true">♪</span>
          <div>
            <p class="font-serif text-2xl leading-tight">Music added</p>
            <p class="mono">
              {formatBytes(video.file.size)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span>
              {#if sizeChange(video.file.size, result.blob.size).text}· {sizeChange(video.file.size, result.blob.size).text}{/if}
            </p>
          </div>
        </div>
        <button type="button" class="btn btn-primary" onclick={() => result && downloadBlob(result.blob, result.name)}>Download {result.name}</button>
        <button type="button" class="btn" onclick={clearResult}>Back to editing</button>
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      {:else}
        <fieldset class="grid gap-5" disabled={working}>
          <div>
            <label class="label" for="music-start">music starts at</label>
            <div class="flex gap-2">
              <input id="music-start" class="field mono" value={formatTime(offset)} onchange={typeOffset} />
              <button type="button" class="btn shrink-0 px-3! text-sm!" onclick={() => setOffset(videoEl?.currentTime ?? 0)} title="Start the music where the video is paused">at playhead</button>
            </div>
          </div>

          <label>
            <span class="label">music volume · {musicVol}%</span>
            <input type="range" min="0" max="200" step="5" bind:value={musicVol} class="w-full accent-(--color-sun)" />
          </label>

          <div>
            <label class="block">
              <span class="label">original sound · {hasOriginal ? `${originalVol}%` : 'none in this video'}</span>
              <input type="range" min="0" max="200" step="5" bind:value={originalVol} disabled={!hasOriginal} class="w-full accent-(--color-sun)" />
            </label>
            {#if hasOriginal}
              <span class="mono flex justify-between">
                <button type="button" class="link" onclick={() => (originalVol = 0)}>replace it (0%)</button>
                <button type="button" class="link" onclick={() => ((originalVol = 100), (musicVol = 30))}>music under speech</button>
              </span>
            {/if}
          </div>

          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={loop} class="mt-1" />
            <span>Loop the music to fill the video<span class="mono block">{trimEnd - trimStart >= duration - offset ? 'the music already covers the video' : 'otherwise it stops when the song ends'}</span></span>
          </label>

          <div>
            <span class="label">fade in</span>
            <div class="seg" role="group" aria-label="Fade in">
              {#each fadeIns as f}
                <button type="button" aria-pressed={fadeIn === f} onclick={() => (fadeIn = f)}>{f ? `${f} s` : 'off'}</button>
              {/each}
            </div>
          </div>
          <div>
            <span class="label">fade out at the end</span>
            <div class="seg" role="group" aria-label="Fade out">
              {#each fadeOuts as f}
                <button type="button" aria-pressed={fadeOut === f} onclick={() => (fadeOut = f)}>{f ? `${f} s` : 'off'}</button>
              {/each}
            </div>
          </div>
        </fieldset>

        <div class="grid gap-2 border-t border-line pt-5">
          {#if working}
            <div class="grid gap-2" aria-live="polite">
              <div class="progress" role="progressbar" aria-label="Adding music" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style:--p={progress}></span>
              </div>
              <p class="mono flex justify-between gap-2">
                <span class="text-chalk">{Math.round(progress * 100)}% · {stage}</span>
                <span class="text-right">{formatSeconds(elapsed / 1000)}{eta !== null ? ` · ~${formatSeconds(eta)} left` : ''}</span>
              </p>
              <button type="button" class="btn" onclick={() => ctrl?.abort()}>Cancel</button>
            </div>
          {:else}
            <button type="button" class="btn btn-primary" disabled={!blocks.length} onclick={exportVideo}>Add music to video</button>
            <p class="mono">
              {rotatedPicture(video.info) ? 'this phone clip is stored sideways, so the picture is re-encoded upright at high quality' : 'the picture is copied as is, so it stays sharp'}
            </p>
          {/if}
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
          <button type="button" class="btn" disabled={working} onclick={startOver}>Start over</button>
        </div>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .placeholder {
    display: grid;
    place-items: center;
    min-height: 190px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  .tag {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-video) 18%, transparent);
    color: var(--color-video);
    &.audio {
      background: color-mix(in srgb, var(--color-audio) 18%, transparent);
      color: var(--color-audio);
    }
  }
  .mini {
    width: 100%;
    max-height: 220px;
    border-radius: 12px;
    background: #0c0b0a;
  }
  .player {
    margin: 0;
    display: grid;
    gap: 8px;
    & video,
    .noview {
      width: 100%;
      max-height: 56vh;
      aspect-ratio: 16 / 9;
      border-radius: 14px;
      border: 1px solid var(--color-line-2);
      background: #0c0b0a;
      object-fit: contain;
    }
  }
  .noview {
    display: grid;
    place-content: center;
    gap: 4px;
    text-align: center;
    padding: 16px;
  }
  .lanes {
    position: relative;
    display: grid;
    gap: 6px;
    --label: 52px;
  }
  .lane-row {
    display: grid;
    grid-template-columns: var(--label) 1fr;
    align-items: center;
  }
  .lane {
    position: relative;
    height: 34px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    overflow: hidden;
  }
  .video-lane {
    display: flex;
    align-items: center;
    padding-inline: 10px;
    cursor: pointer;
    background: color-mix(in srgb, var(--color-video) 16%, #141312);
    &.quiet {
      background: repeating-linear-gradient(-45deg, #141312 0 8px, #1d1b19 8px 9px);
    }
  }
  .music-lane {
    cursor: grab;
    touch-action: none;
    &:active {
      cursor: grabbing;
    }
  }
  .block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--color-audio) 55%, transparent);
    border: 1px solid var(--color-audio);
    transition: left 0.08s, width 0.08s;
    &.repeat {
      background: color-mix(in srgb, var(--color-audio) 28%, transparent);
      border-style: dashed;
    }
  }
  .env {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    & polyline {
      fill: none;
      stroke: var(--color-chalk);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
  }
  .head {
    position: absolute;
    top: -4px;
    bottom: -4px;
    left: calc(var(--label) + (100% - var(--label)) * var(--head));
    width: 2px;
    margin-left: -1px;
    background: var(--color-chalk);
    border-radius: 2px;
    pointer-events: none;
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--color-line-2);
    text-underline-offset: 4px;
    &:hover {
      color: var(--color-chalk);
    }
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .note {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: 14px;
    border: 1px solid #ffd25e55;
    background: #ffd25e0d;
  }
  .progress {
    height: 10px;
    border-radius: 99px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transform-origin: left;
      transform: scaleX(var(--p));
      transition: transform 0.3s ease-out;
    }
  }
  .done {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: 14px;
    border: 1px solid #9be58f55;
    background: #9be58f0f;
  }
  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-ok);
    color: var(--color-bg);
    font-weight: 600;
    animation: pop 0.5s var(--ease-spring);
  }
  .working {
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>
