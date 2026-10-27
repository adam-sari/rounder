<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import {
    capabilities,
    containers,
    downloadName,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    isAbort,
    isAudioContainer,
    preloadFallback,
    probe,
    transcode,
    type Capabilities,
    type MediaInfo,
    type TranscodeResult,
  } from '@/engines/media';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import {
    AUDIO_OUTPUTS,
    QUALITIES,
    VIDEO_OUTPUTS,
    audioBitrateChoices,
    audioName,
    availability,
    codecChoices,
    codecHint,
    defaultAudioBitrate,
    describePlan,
    errorText,
    etaSeconds,
    isFastPath,
    isOutput,
    planConversion,
    resolutionChoices,
    resolutionLabel,
    sizeChange,
    videoName,
    type Output,
    type Settings,
  } from '@/tools/lib/video-converter/plan';

  interface Props {
    /** source format the page is about (mov, webm, mp4, avi, mkv): only changes the wording */
    from?: string;
    to?: Output;
  }

  let { from, to = 'mp4' }: Props = $props();

  const OUTPUT_HINT: Record<Output, string> = {
    mp4: 'plays almost everywhere',
    webm: 'open format for websites',
    mov: 'QuickTime, for Apple apps',
    mkv: 'flexible, for media players',
    mp3: 'sound only, plays everywhere',
    m4a: 'sound only, AAC',
    wav: 'sound only, uncompressed',
  };
  const ALL: Output[] = [...VIDEO_OUTPUTS, ...AUDIO_OUTPUTS];
  const fromLabel = $derived(from ? (from === 'webm' ? 'WebM' : from.toUpperCase()) : '');
  const initial = untrack(() => to);

  type Phase = 'empty' | 'probing' | 'ready' | 'working' | 'done';

  let phase = $state<Phase>('empty');
  let file = $state.raw<File | null>(null);
  let info = $state.raw<MediaInfo | null>(null);
  let caps = $state.raw<Capabilities | null>(null);
  let error = $state('');
  let announce = $state('');
  let inUrl = $state('');
  let inFailed = $state(false);
  let decoderReady = $state(false);
  let decoderProgress = $state<number | null>(null);

  let settings = $state<Settings>({ container: isOutput(initial) ? initial : 'mp4', codec: 'auto', quality: 'original', resolution: 0, keepAudio: true, audioBitrate: -1 });

  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let now = $state(0);
  let ctrl: AbortController | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;

  let result = $state.raw<(TranscodeResult & { name: string; fast: boolean; tookSec: number }) | null>(null);
  let outUrl = $state('');
  let outFailed = $state(false);

  onMount(() => {
    capabilities().then(
      (c) => (caps = c),
      () => (error = 'This browser can’t run the video engine. Try a recent Chrome, Edge, Safari or Firefox.'),
    );
    return () => {
      ctrl?.abort();
      clearInterval(ticker);
      revoke();
    };
  });

  function revoke() {
    if (inUrl) URL.revokeObjectURL(inUrl);
    if (outUrl) URL.revokeObjectURL(outUrl);
    inUrl = outUrl = '';
  }

  async function open(files: File[]) {
    const f = files[0];
    reset();
    file = f;
    phase = 'probing';
    try {
      let probed = await probe(f);
      if (probed.needsFallback && !probed.readable && decoderReady) probed = await probe(f, { fallback: true });
      if (file !== f) return;
      info = probed;
      inUrl = URL.createObjectURL(f);
      phase = 'ready';
    } catch (e) {
      if (file !== f) return;
      console.error(e);
      error = errorText(e);
      file = null;
      phase = 'empty';
    }
  }

  async function loadDecoder() {
    const f = file;
    if (!f || !info) return;
    error = '';
    decoderProgress = 0;
    try {
      await preloadFallback((p) => (decoderProgress = p));
      decoderReady = true;
      if (!info.readable) {
        phase = 'probing';
        const details = await probe(f, { fallback: true });
        if (file === f) info = details;
      }
    } catch (e) {
      console.error(e);
      if (file === f) error = errorText(e);
    } finally {
      decoderProgress = null;
      if (file === f && phase === 'probing') phase = 'ready';
    }
  }

  async function convert() {
    if (!file || !plan) return;
    const job = (ctrl = new AbortController());
    const fast = isFastPath(plan);
    error = announce = '';
    progress = 0;
    status = 'Starting…';
    phase = 'working';
    startedAt = now = performance.now();
    const tick = (ticker = setInterval(() => (now = performance.now()), 250));
    try {
      const out = await transcode(file, plan.options, {
        signal: job.signal,
        onProgress: (p) => {
          if (ctrl === job) progress = Math.max(progress, p);
        },
        onStatus: (s) => {
          if (ctrl === job) status = s;
        },
      });
      if (job.signal.aborted) return;
      result = { ...out, name: downloadName(file.name, out.container), fast, tookSec: (performance.now() - startedAt) / 1000 };
      outUrl = URL.createObjectURL(out.blob);
      outFailed = false;
      phase = 'done';
      announce = `Converted. ${result.name} is ${formatBytes(out.blob.size)}.`;
    } catch (e) {
      if (!job.signal.aborted && !isAbort(e)) {
        console.error(e);
        error = errorText(e, isAudioContainer(plan.options.container));
      }
      // a cancelled job settles late; by then a new job or file may own the UI
      if (ctrl === job) {
        if (phase === 'working') phase = 'ready';
        if (job.signal.aborted) announce = 'Conversion cancelled.';
      }
    } finally {
      clearInterval(tick);
      if (ctrl === job) ctrl = null;
    }
  }

  function cancel() {
    ctrl?.abort();
    phase = 'ready';
  }

  function backToSettings() {
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = '';
    result = null;
    phase = 'ready';
  }

  function reset() {
    ctrl?.abort();
    revoke();
    file = info = result = null;
    error = announce = '';
    inFailed = false;
    phase = 'empty';
  }

  const hasVideo = $derived(!!info?.video);
  const hasAudio = $derived(!!info?.audio);
  // a file only the fallback can read has no track details until the decoder is loaded
  const detailed = $derived(!!info && (info.readable || info.via === 'ffmpeg'));
  const avail = (c: Output) => (detailed ? availability(caps, c, hasVideo, hasAudio) : availability(caps, c, true, true));

  const audioOut = $derived(isAudioContainer(settings.container));
  const codecs = $derived(codecChoices(caps, settings.container));
  const bitrates = $derived(audioBitrateChoices(settings.container, info));
  const resolutions = $derived(info?.video ? resolutionChoices(info.video.displayWidth, info.video.displayHeight) : []);
  const effective = $derived<Settings>({
    ...settings,
    codec: settings.codec !== 'auto' && codecs.includes(settings.codec) ? settings.codec : 'auto',
    resolution: resolutions.includes(settings.resolution) ? settings.resolution : 0,
    audioBitrate: bitrates.includes(settings.audioBitrate) ? settings.audioBitrate : defaultAudioBitrate(bitrates),
  });
  const plan = $derived(info && detailed ? planConversion(info, effective, caps?.video.encode ?? []) : null);
  const planLines = $derived(plan ? describePlan(plan, effective, hasAudio) : []);
  const fast = $derived(!!plan && isFastPath(plan));
  // only streams that end up in the output have to be decoded (e.g. a silent copy skips odd audio)
  const undecodable = $derived(
    !info?.needsFallback ? null : !info.readable ? 'file' : !audioOut && info.video && !info.video.canDecode ? 'video' : plan?.audioCodec && info.audio && !info.audio.canDecode ? 'sound' : null,
  );
  const needsDecoder = $derived(!!undecodable && !decoderReady);
  const blocked = $derived(ALL.filter((c) => !avail(c).ok).map((c) => `${containers[c].label}: ${avail(c).reason}`));
  const hevcNote = $derived(!audioOut && plan?.videoCodec === 'hevc' && codecs.includes('avc') && settings.container !== 'mkv');

  // keep the chosen format valid once capabilities and the file's tracks are known
  $effect(() => {
    if (!info || avail(settings.container).ok) return;
    const first = ALL.find((c) => avail(c).ok);
    if (first) settings.container = first;
  });

  const elapsed = $derived(Math.max(0, (now - startedAt) / 1000));
  const eta = $derived(etaSeconds(elapsed, progress));
  const change = $derived(result && file ? sizeChange(file.size, result.blob.size) : null);
  const ext = $derived(file?.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? 'this');

  function facts(i: MediaInfo, f: File): string[] {
    const out = [formatBytes(f.size)];
    if (i.durationSec) out.push(formatTime(i.durationSec, 1));
    if (i.video) {
      out.push(`${i.video.displayWidth}×${i.video.displayHeight}`);
      if (i.video.fps) out.push(`${Math.round(i.video.fps * 100) / 100} fps`);
      out.push(videoName(i.video.codec));
    }
    out.push(i.audio ? `${audioName(i.audio.codec)} audio` : detailed ? 'no audio' : '');
    return out.filter(Boolean);
  }
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if phase === 'empty'}
      <Dropzone
        accept="video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv"
        title={fromLabel ? `Drop your ${fromLabel} video here` : 'Drop a video here'}
        hint="or click to choose · MP4, MOV, WebM, MKV, AVI and more"
        onfiles={open}
      />
      {#if from === 'avi'}
        <p class="mono">AVI files need a one-time {FALLBACK_DOWNLOAD_MB} MB decoder. We'll ask before downloading it.</p>
      {/if}
    {:else if file}
      <div class="stage">
        {#if phase === 'done' && result}
          {#if outFailed}
            <div class="noplay mono">This browser can't preview {containers[result.container].label} files. Download it to play it in your video app.</div>
          {:else if isAudioContainer(result.container)}
            <audio src={outUrl} controls class="w-full" onerror={() => (outFailed = true)}></audio>
          {:else}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={outUrl} controls playsinline class="player" aria-label="Converted video" onerror={() => (outFailed = true)}></video>
          {/if}
        {:else if phase === 'probing'}
          <div class="noplay mono" aria-busy="true">reading the file…</div>
        {:else if inFailed || !inUrl}
          <div class="noplay mono">No preview: this browser can't play {ext} files. The converted video will play here.</div>
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={inUrl} controls playsinline preload="metadata" class="player" aria-label="Original video" onerror={() => (inFailed = true)}></video>
        {/if}
      </div>

      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p class="min-w-0 truncate text-sm">{phase === 'done' && result ? result.name : file.name}</p>
        {#if phase === 'done' && result}
          <p class="mono">
            {containers[result.container].label}{result.width ? ` · ${result.width}×${result.height}` : ''} · {formatTime(result.durationSec, 1)} · {formatBytes(result.blob.size)}
          </p>
        {:else if info}
          <p class="mono">{facts(info, file).join(' · ')}</p>
        {/if}
      </div>

      {#if info && detailed && !info.video && phase !== 'done'}
        <p class="mono">This file has no video track. You can still save its sound as MP3, M4A or WAV, or try the <a href="/audio-converter" class="link">audio converter</a>.</p>
      {/if}
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    {#if phase === 'working'}
      <div class="grid gap-3">
        <span class="label">{status || 'Converting…'}</span>
        <span class="font-serif text-6xl leading-none tabular-nums">{Math.round(progress * 100)}<span class="text-3xl text-muted">%</span></span>
        <div class="track" role="progressbar" aria-label="Conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
          <span class="fill" style:transform={`scaleX(${progress})`}></span>
        </div>
        <p class="mono flex justify-between">
          <span>{formatTime(elapsed, 0)} elapsed</span>
          <span>{eta === null ? 'estimating…' : `about ${formatTime(eta, 0)} left`}</span>
        </p>
        <button type="button" class="btn" onclick={cancel}>Cancel</button>
        <p class="mono">Everything runs on your device. You can keep using this tab while it works.</p>
      </div>
    {:else if phase === 'done' && result && change}
      <div class="grid gap-4">
        <div class="done">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="tick"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          <span class="font-serif text-4xl leading-none">Converted</span>
        </div>
        <div class="grid gap-1">
          <span class="font-serif text-5xl leading-none" class:text-ok={change.smaller}>{change.text}</span>
          <span class="mono">{formatBytes(file!.size)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span> · took {formatTime(result.tookSec, 0)}</span>
          {#if result.fast}<span class="mono text-sun">copied without re-encoding, no quality lost</span>{/if}
          {#each result.notes as note}<span class="mono">{note}</span>{/each}
        </div>
        <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob, result!.name)}>Download {containers[result.container].label}</button>
        <button type="button" class="btn" onclick={backToSettings}>Try other settings</button>
        <button type="button" class="btn" onclick={reset}>Start over</button>
      </div>
    {:else}
      <div>
        <span class="label" id="vc-format">convert to</span>
        <div class="seg" role="group" aria-labelledby="vc-format">
          {#each VIDEO_OUTPUTS as c}
            {@const a = avail(c)}
            <button type="button" aria-pressed={settings.container === c} disabled={!a.ok} title={a.reason} onclick={() => (settings.container = c)}>{containers[c].label}</button>
          {/each}
        </div>
        <span class="label mt-3" id="vc-audio">audio only</span>
        <div class="seg" role="group" aria-labelledby="vc-audio">
          {#each AUDIO_OUTPUTS as c}
            {@const a = avail(c)}
            <button type="button" aria-pressed={settings.container === c} disabled={!a.ok} title={a.reason} onclick={() => (settings.container = c)}>{containers[c].label}</button>
          {/each}
        </div>
        <p class="mono mt-2">{containers[settings.container].label}: {OUTPUT_HINT[settings.container]}</p>
        {#if audioOut}
          <p class="mono mt-1">Just want the sound? The <a href="/video-to-mp3" class="link">video to MP3</a> tool is made for that.</p>
        {/if}
        {#if blocked.length && info}
          <p class="mono mt-1">{blocked.join(' · ')}</p>
        {/if}
      </div>

      {#if !audioOut}
        {#if codecs.length > 1}
          <div>
            <span class="label" id="vc-codec">video codec</span>
            <div class="seg" role="group" aria-labelledby="vc-codec">
              <button type="button" aria-pressed={effective.codec === 'auto'} onclick={() => (settings.codec = 'auto')}>auto</button>
              {#each codecs as c}
                <button type="button" aria-pressed={effective.codec === c} onclick={() => (settings.codec = c)}>{videoName(c)}</button>
              {/each}
            </div>
            <p class="mono mt-2">
              {effective.codec === 'auto' ? 'keeps the original when it fits, otherwise the most compatible' : codecHint[effective.codec]}
            </p>
          </div>
        {/if}

        <div>
          <span class="label" id="vc-quality">quality</span>
          <div class="seg" role="group" aria-labelledby="vc-quality">
            {#each QUALITIES as [q, label]}
              <button type="button" aria-pressed={effective.quality === q} onclick={() => (settings.quality = q)}>{label}</button>
            {/each}
          </div>
          <p class="mono mt-2">{effective.quality === 'original' ? 'no re-encode when possible, else as close to the source as it gets' : 'smaller settings give smaller files with softer detail'}</p>
        </div>

        {#if resolutions.length}
          <div>
            <span class="label" id="vc-size">resolution</span>
            <div class="seg" role="group" aria-labelledby="vc-size">
              <button type="button" aria-pressed={effective.resolution === 0} onclick={() => (settings.resolution = 0)}>original</button>
              {#each resolutions as r}
                <button type="button" aria-pressed={effective.resolution === r} onclick={() => (settings.resolution = r)}>{resolutionLabel(r)}</button>
              {/each}
            </div>
          </div>
        {/if}

        {#if hasAudio}
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={settings.keepAudio} class="mt-1" />
            <span>Keep the sound<span class="mono block">untick for a silent video</span></span>
          </label>
        {/if}
      {:else if bitrates.length}
        <div>
          <span class="label" id="vc-bitrate">audio quality</span>
          <div class="seg" role="group" aria-labelledby="vc-bitrate">
            {#each bitrates as b}
              <button type="button" aria-pressed={effective.audioBitrate === b} onclick={() => (settings.audioBitrate = b)}>{b ? `${b / 1000}k` : 'original'}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if plan}
        <div class="plan" class:fast>
          {#if fast}<span class="pill">fast copy</span>{/if}
          {#each planLines as line}<span class="mono block">{line}</span>{/each}
          <span class="mono block mt-1 text-soft">
            {fast ? 'Nothing is re-encoded, so this is quick and loses no quality.' : 'Re-encoding processes every frame, so long videos take a while.'}
          </span>
          {#if hevcNote}
            <span class="mono block mt-1 text-soft">HEVC plays on iPhones, Macs and most new devices, but some Windows PCs and older TVs can't open it. Pick H.264 for the widest support.</span>
          {/if}
        </div>
      {/if}

      {#if file && needsDecoder && phase === 'ready'}
        <div class="plan">
          <span class="text-sm">{undecodable === 'file' ? `This browser can't read ${ext} files on its own.` : `This browser can't decode the ${undecodable} in this file on its own.`}</span>
          <span class="mono block mt-1">Rounder can convert it with ffmpeg, a decoder that runs in your browser. It's a one-time {FALLBACK_DOWNLOAD_MB} MB download, and your video still never leaves your device.</span>
        </div>
        <button type="button" class="btn btn-primary" disabled={decoderProgress !== null} onclick={loadDecoder}>
          {decoderProgress === null ? `Download decoder (${FALLBACK_DOWNLOAD_MB} MB)` : `Downloading… ${Math.round(decoderProgress * 100)}%`}
        </button>
      {:else}
        <button type="button" class="btn btn-primary" disabled={phase !== 'ready' || !plan || !avail(settings.container).ok} onclick={convert}>
          Convert to {containers[settings.container].label}
        </button>
      {/if}
      {#if file}
        <button type="button" class="btn" onclick={reset}>Choose another file</button>
      {/if}
    {/if}
  </aside>
</div>

<p class="sr-only" aria-live="polite">{announce}</p>

<style>
  .stage {
    display: grid;
    place-items: center;
    min-height: 220px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #0c0b0a;
    overflow: hidden;
  }
  .player {
    display: block;
    width: 100%;
    max-height: min(62vh, 560px);
    background: #000;
  }
  .stage audio {
    width: calc(100% - 32px);
    margin: 16px;
  }
  .noplay {
    padding: 40px 24px;
    text-align: center;
    max-width: 44ch;
  }
  .error {
    color: var(--color-bad);
    font-size: 14px;
  }
  .link {
    color: var(--color-chalk);
    text-decoration: underline;
    text-underline-offset: 3px;
    &:hover { color: var(--color-sun); }
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    text-decoration: line-through;
  }
  .plan {
    padding: 12px 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: var(--color-panel-2);
    &.fast { border-color: #ffd25e66; }
  }
  .pill {
    display: inline-block;
    margin-bottom: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    font: 500 11.5px var(--font-mono);
    color: var(--color-bg);
    background: var(--color-sun);
  }
  .track {
    height: 8px;
    border-radius: 999px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #ffd25e, #ffb84a);
    transform-origin: left;
    transition: transform 0.3s linear;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    width: 40px;
    height: 40px;
    padding: 7px;
    border-radius: 50%;
    background: var(--color-ok);
    animation: pop 0.45s var(--ease-spring) both;
    & path {
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 22;
      stroke-dashoffset: 22;
      animation: draw 0.4s 0.2s ease-out forwards;
    }
  }
  @keyframes pop {
    from { transform: scale(0.4); opacity: 0; }
  }
  @keyframes draw {
    to { stroke-dashoffset: 0; }
  }
</style>
