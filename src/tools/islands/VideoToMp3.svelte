<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';
  import {
    audioCodecLabel,
    capabilities,
    downloadName,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    isAbort,
    preloadFallback,
    probe,
    transcode,
    videoCodecLabel,
    type AudioCodec,
    type Capabilities,
    type MediaInfo,
    type VideoCodec,
  } from '@/engines/media';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { AUDIO_FORMATS, audioBitrate, canCopy, clipLength, estimateAudioBytes, formatSpec, isLossless, type AudioFormat, type Bitrate } from '@/tools/lib/video-to-mp3/audio';
  import { mediaErrorText } from '@/tools/lib/video-to-mp3/job';

  const ACCEPT = 'video/*,audio/*,.mkv,.avi,.wmv,.flv,.m4v,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv,.vob';

  /** decoder = waiting for the ffmpeg download; unusable = can't be extracted at all; failed = the last run failed */
  type ItemState = 'probing' | 'decoder' | 'unusable' | 'ready' | 'working' | 'done' | 'failed';
  interface Item {
    id: number;
    file: File;
    url: string;
    info: MediaInfo | null;
    state: ItemState;
    error?: string;
    progress: number;
    trim: boolean;
    start: number;
    end: number;
    previewFailed: boolean;
    out?: { blob: Blob; url: string; name: string; copied: boolean };
  }

  let items = $state<Item[]>([]);
  let selectedId = $state<number | null>(null);
  let format = $state<AudioFormat>('mp3');
  let bitrate = $state<Bitrate>(192);
  let caps = $state.raw<Capabilities | null>(null);
  let decoder = $state<'idle' | 'loading' | 'ready'>('idle');
  let decoderProgress = $state(0);
  let decoderError = $state('');
  let job = $state<{ startedAt: number; progress: number; label: string; status: string } | null>(null);
  let runError = $state('');
  let zipping = $state(false);
  let media = $state<HTMLMediaElement | null>(null);
  let ctrl: AbortController | null = null;
  let nextId = 0;

  const spec = $derived(formatSpec(format));
  const sel = $derived(items.find((i) => i.id === selectedId) ?? null);
  const unavailable = (f: AudioFormat) => !!caps && !caps.containers[f];
  const flacNeedsDecoder = $derived(format === 'flac' && !caps?.audio.encode.includes('flac'));
  const waiting = $derived(items.filter((i) => i.state === 'decoder'));
  const queue = $derived(items.filter((i) => i.state === 'ready' || i.state === 'failed'));
  const done = $derived(items.filter((i) => i.state === 'done'));
  const canRun = $derived(!!queue.length && !job && !unavailable(format) && !(flacNeedsDecoder && decoder !== 'ready'));
  const allDone = $derived(!!done.length && !job && !queue.length && !items.some((i) => i.state === 'probing'));
  const copyable = $derived(items.filter((i) => canCopy(format, i.info?.audio?.codec, i.info?.audio?.channels)).length);
  const estimate = $derived(
    items.reduce((sum, i) => (i.info?.audio && i.state !== 'unusable' ? sum + estimateAudioBytes(format, bitrate, clipLength(i.info.durationSec, i.trim ? i : null), i.info.audio) : sum), 0),
  );
  const totals = $derived({ before: done.reduce((s, i) => s + i.file.size, 0), after: done.reduce((s, i) => s + (i.out?.blob.size ?? 0), 0) });

  onMount(() => {
    capabilities().then(
      (c) => {
        caps = c;
        if (!c.containers[format]) format = AUDIO_FORMATS.find((f) => c.containers[f.id])?.id ?? format;
      },
      () => {},
    );
  });

  onDestroy(() => {
    ctrl?.abort();
    for (const i of items) release(i);
  });

  // ---------------------------------------------------------------- files

  /** "decoder" files can't be read by the browser: an unreadable container, or audio it can't decode */
  const needsDecoder = (info: MediaInfo) => !info.readable || (!!info.audio && !info.audio.canDecode);

  async function add(files: File[]) {
    runError = '';
    items.push(...files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), info: null, state: 'probing' as const, progress: 0, trim: false, start: 0, end: 0, previewFailed: false })));
    // the pushed objects are now proxies; work on those so changes show up
    const fresh = items.slice(-files.length);
    selectedId ??= fresh[0]?.id ?? null;
    for (const item of fresh) await inspect(item);
  }

  async function inspect(item: Item) {
    // removed (or "Start over") while earlier files were still being read
    if (!items.includes(item)) return;
    item.state = 'probing';
    try {
      let info = await probe(item.file);
      if (!info.readable && decoder === 'ready') info = await probe(item.file, { fallback: true });
      if (!items.includes(item)) return;
      item.info = info;
      item.end = info.durationSec;
      if (info.container === 'gif') return unusable(item, 'GIFs have no sound to extract.');
      if (needsDecoder(info) && decoder !== 'ready') item.state = 'decoder';
      else if (!info.audio) unusable(item, 'This video has no audio track.');
      else item.state = 'ready';
    } catch (e) {
      unusable(item, mediaErrorText(e));
    }
  }

  function unusable(item: Item, why: string) {
    item.state = 'unusable';
    item.error = why;
  }

  async function getDecoder() {
    decoder = 'loading';
    decoderError = '';
    decoderProgress = 0;
    try {
      await preloadFallback((p) => (decoderProgress = p));
      decoder = 'ready';
      for (const item of items.filter((i) => i.state === 'decoder')) await inspect(item);
    } catch {
      decoder = 'idle';
      decoderError = "The decoder couldn't be downloaded. Check your connection and try again.";
    }
  }

  function release(item: Item) {
    URL.revokeObjectURL(item.url);
    clearOut(item);
  }

  function clearOut(item: Item) {
    if (!item.out) return;
    URL.revokeObjectURL(item.out.url);
    item.out = undefined;
    if (item.state === 'done') item.state = 'ready';
  }

  function remove(item: Item) {
    release(item);
    items.splice(items.indexOf(item), 1);
    if (selectedId === item.id) selectedId = items[0]?.id ?? null;
  }

  function startOver() {
    ctrl?.abort();
    for (const i of items) release(i);
    items = [];
    selectedId = null;
    runError = '';
  }

  // ---------------------------------------------------------------- settings

  function setFormat(f: AudioFormat) {
    if (f === format) return;
    format = f;
    const s = formatSpec(f);
    if (s.bitrates.length && bitrate !== 'copy' && !s.bitrates.includes(bitrate)) bitrate = s.defaultKbps;
    items.forEach(clearOut);
  }

  function setBitrate(b: Bitrate) {
    if (b === bitrate) return;
    bitrate = b;
    items.forEach(clearOut);
  }

  // ---------------------------------------------------------------- extract

  async function run() {
    if (!canRun) return;
    const list = [...queue];
    // weight progress by length so one long video doesn't make the bar jump
    const lengths = list.map((i) => Math.max(1, clipLength(i.info?.durationSec ?? 0, i.trim ? i : null)));
    const total = lengths.reduce((a, b) => a + b, 0);
    let before = 0;
    ctrl = new AbortController();
    const { signal } = ctrl;
    runError = '';
    job = { startedAt: performance.now(), progress: 0, label: '', status: '' };
    for (const [k, item] of list.entries()) {
      if (signal.aborted || !job) break;
      if (!items.includes(item)) continue;
      item.state = 'working';
      item.progress = 0;
      item.error = undefined;
      job.label = list.length > 1 ? `${k + 1} of ${list.length} · ${item.file.name}` : item.file.name;
      job.status = 'Starting…';
      const audio = item.info?.audio;
      try {
        const r = await transcode(
          item.file,
          { container: format, trim: item.trim ? { start: item.start, end: item.end } : undefined, audio: { bitrate: audioBitrate(format, bitrate, audio?.codec, audio?.channels) } },
          {
            signal,
            onProgress: (p) => {
              item.progress = p;
              if (job) job.progress = (before + p * lengths[k]) / total;
            },
            onStatus: (s) => job && (job.status = s),
          },
        );
        // cancelled, "Start over" or left the page just as it finished: drop the result
        if (signal.aborted) {
          item.state = 'ready';
          break;
        }
        item.out = { blob: r.blob, url: URL.createObjectURL(r.blob), name: downloadName(item.file.name, r.container), copied: bitrate === 'copy' && canCopy(format, audio?.codec, audio?.channels) };
        item.state = 'done';
      } catch (e) {
        // the ffmpeg path doesn't always report a cancel as 'aborted'
        if (signal.aborted || isAbort(e)) {
          item.state = 'ready';
          break;
        }
        console.error(e);
        item.state = 'failed';
        item.error = mediaErrorText(e);
        if (list.length === 1) runError = item.error;
      }
      before += lengths[k];
    }
    job = null;
    ctrl = null;
  }

  async function downloadAll() {
    if (done.length === 1) return downloadBlob(done[0].out!.blob, done[0].out!.name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), 'extracted-audio.zip');
    } catch {
      runError = "The zip couldn't be made. Try downloading the files one by one.";
    } finally {
      zipping = false;
    }
  }

  // ---------------------------------------------------------------- display

  const codecName = (c: string | null | undefined) => (c ? (audioCodecLabel[c as AudioCodec] ?? videoCodecLabel[c as VideoCodec] ?? c.toUpperCase()) : 'unknown');
  const channelName = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : n === 6 ? '5.1' : `${n} ch`);

  function details(info: MediaInfo) {
    const out: string[] = [];
    if (info.durationSec) out.push(formatTime(info.durationSec, 0));
    if (info.video) {
      out.push(`${info.video.displayWidth}×${info.video.displayHeight}`);
      out.push(codecName(info.video.codec));
      if (info.video.fps) out.push(`${Math.round(info.video.fps * 100) / 100} fps`);
    }
    if (info.audio) out.push(`${codecName(info.audio.codec)} ${channelName(info.audio.channels)} · ${Math.round(info.audio.sampleRate / 100) / 10} kHz`);
    return out;
  }

  const change = (a: number, b: number) => (a ? Math.round((1 - b / a) * 100) : 0);
</script>

{#if !items.length}
  <Dropzone accept={ACCEPT} multiple title="Drop videos here" hint="or click to choose · batches welcome" onfiles={add} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      {#if sel}
        {#key sel.id}
          <section class="stage" aria-label="Selected file">
            {#if sel.state === 'probing'}
              <div class="still mono">reading the file…</div>
            {:else if sel.state === 'decoder' || sel.previewFailed}
              <div class="still">
                <p class="font-serif text-2xl">No preview for this format</p>
                <p class="mono">
                  {sel.state === 'decoder' ? "Your browser can't read it on its own, but the decoder can." : "Your browser can't play it, but the audio can still be extracted."}
                </p>
              </div>
            {:else if sel.info?.video}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video bind:this={media} src={sel.url} controls playsinline preload="metadata" onerror={() => (sel.previewFailed = true)}></video>
            {:else}
              <audio bind:this={media} src={sel.url} controls preload="metadata" class="w-full" onerror={() => (sel.previewFailed = true)}></audio>
            {/if}

            <div class="grid gap-1 px-1">
              <p class="truncate text-sm">{sel.file.name}</p>
              <p class="mono">
                {#if sel.info?.readable || sel.info?.via === 'ffmpeg'}{details(sel.info).join(' · ')} · {/if}{formatBytes(sel.file.size)}
              </p>
            </div>

            {#if sel.out}
              <div class="result">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <p class="truncate text-sm">{sel.out.name}</p>
                  <p class="mono">
                    {formatBytes(sel.file.size)} → <span class="text-chalk">{formatBytes(sel.out.blob.size)}</span>
                    {#if change(sel.file.size, sel.out.blob.size) > 0}<span class="text-ok"> −{change(sel.file.size, sel.out.blob.size)}%</span>{/if}
                    {#if sel.out.copied}· copied, no re-encode{/if}
                  </p>
                </div>
                <audio src={sel.out.url} controls preload="metadata" class="w-full"></audio>
                <button type="button" class="btn btn-primary" onclick={() => downloadBlob(sel.out!.blob, sel.out!.name)}>Download {sel.out.name.split('.').pop()?.toUpperCase()}</button>
              </div>
            {/if}

            {#if sel.state !== 'unusable' && sel.state !== 'decoder' && sel.state !== 'probing' && sel.info && sel.info.durationSec > 0}
              <label class="flex items-start gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  class="mt-1"
                  bind:checked={sel.trim}
                  disabled={!!job}
                  onchange={() => clearOut(sel)}
                />
                <span>Only keep part of it<span class="mono block">drag the handles or type exact times</span></span>
              </label>
              {#if sel.trim}
                <TrimTimeline
                  file={sel.file}
                  kind="audio"
                  duration={sel.info.durationSec}
                  {media}
                  bind:start={sel.start}
                  bind:end={sel.end}
                  disabled={!!job}
                  onchange={() => clearOut(sel)}
                />
              {/if}
            {/if}
          </section>
        {/key}
      {/if}

      <ul class="grid gap-2" aria-label="Files">
        {#each items as item (item.id)}
          <li class="row" class:sel={item.id === selectedId} class:working={item.state === 'working'} style:--p={item.progress}>
            <button type="button" class="pick" onclick={() => (selectedId = item.id)} aria-pressed={item.id === selectedId} aria-label={`Show ${item.file.name}`}>
              <span class="badge" data-state={item.state} aria-hidden="true">
                {#if item.state === 'done'}
                  <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
                {:else if item.state === 'unusable' || item.state === 'failed'}
                  !
                {:else}
                  ♪
                {/if}
              </span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm">{item.out?.name ?? item.file.name}</span>
                <span class="mono block truncate">
                  {#if item.state === 'probing'}
                    reading…
                  {:else if item.state === 'unusable' || item.state === 'failed'}
                    <span class="text-bad">{item.error}</span>
                  {:else if item.state === 'decoder'}
                    <span class="text-sun">needs the decoder</span> · {formatBytes(item.file.size)}
                  {:else if item.state === 'working'}
                    <span class="text-sun">extracting… {Math.round(item.progress * 100)}%</span>
                  {:else if item.out}
                    {formatBytes(item.file.size)} → <span class="text-chalk">{formatBytes(item.out.blob.size)}</span>
                  {:else if item.info}
                    {formatTime(clipLength(item.info.durationSec, item.trim ? item : null), 0)}{item.trim ? ' (trimmed)' : ''} · {formatBytes(item.file.size)} → ≈ {formatBytes(
                      estimateAudioBytes(format, bitrate, clipLength(item.info.durationSec, item.trim ? item : null), item.info.audio),
                    )}
                  {/if}
                </span>
              </span>
            </button>
            {#if item.out}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadBlob(item.out!.blob, item.out!.name)} aria-label={`Download ${item.out.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" disabled={!!job} onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>
      {#if !job}
        <Dropzone accept={ACCEPT} multiple title="Add more" hint="drop or click to choose" onfiles={add} />
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid min-w-0 gap-5" disabled={!!job}>
        <div>
          <span class="label">audio format</span>
          <div class="seg" role="group" aria-label="Audio format">
            {#each AUDIO_FORMATS as f (f.id)}
              <button type="button" aria-pressed={format === f.id} disabled={unavailable(f.id)} title={unavailable(f.id) ? `Your browser can't create ${f.label} files` : undefined} onclick={() => setFormat(f.id)}>
                {f.label}
              </button>
            {/each}
          </div>
          <p class="mono mt-2">{spec.blurb}</p>
          {#if caps && AUDIO_FORMATS.some((f) => unavailable(f.id))}
            <p class="mono mt-1">Greyed out: your browser can't create {AUDIO_FORMATS.filter((f) => unavailable(f.id)).map((f) => f.label).join(' or ')} files.</p>
          {/if}
        </div>

        {#if !isLossless(format)}
          <div>
            <span class="label">bitrate · kbps</span>
            <div class="seg" role="group" aria-label="Bitrate">
              <button type="button" aria-pressed={bitrate === 'copy'} onclick={() => setBitrate('copy')}>original</button>
              {#each spec.bitrates as b (b)}
                <button type="button" aria-pressed={bitrate === b} onclick={() => setBitrate(b)}>{b}</button>
              {/each}
            </div>
            <p class="mono mt-2">
              {#if bitrate === 'copy'}
                Keeps {spec.copyFrom.map((c) => codecName(c)).join(' or ')} audio exactly as it is{items.length ? ` (${copyable} of ${items.length} file${items.length === 1 ? '' : 's'})` : ''}; anything else is encoded at {spec.defaultKbps} kbps.
              {:else}
                {bitrate >= 256 ? 'top quality, larger files' : bitrate >= 160 ? 'great for music' : 'fine for speech and podcasts'}
              {/if}
            </p>
          </div>
        {/if}

        {#if estimate}
          <p class="mono">≈ <span class="text-chalk">{formatBytes(estimate)}</span> of audio in total{format === 'flac' ? ' (FLAC varies a lot)' : ''}</p>
        {/if}
      </fieldset>

      {#if (waiting.length || flacNeedsDecoder) && decoder !== 'ready'}
        <div class="notice">
          <p class="text-sm">
            {#if waiting.length}
              {waiting.length === 1 ? 'One file uses' : `${waiting.length} files use`} a format your browser can't read on its own.
            {:else}
              Browsers can't write FLAC by themselves.
            {/if}
            Rounder can fetch a free decoder (ffmpeg, {FALLBACK_DOWNLOAD_MB} MB) once. It runs on this device; nothing is uploaded.
          </p>
          {#if decoder === 'loading'}
            <div class="meter" role="progressbar" aria-label="Downloading the decoder" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(decoderProgress * 100)}>
              <span style:width="{decoderProgress * 100}%"></span>
            </div>
            <p class="mono" role="status">Downloading… {Math.round(decoderProgress * 100)}%</p>
          {:else}
            <button type="button" class="btn" onclick={getDecoder}>Download decoder · {FALLBACK_DOWNLOAD_MB} MB</button>
          {/if}
          {#if decoderError}<p class="mono text-bad" role="alert">{decoderError}</p>{/if}
        </div>
      {/if}

      <div class="grid gap-3 border-t border-line pt-5">
        {#if job}
          <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label={job.label} status={job.status} oncancel={() => ctrl?.abort()} />
        {:else if allDone}
          <div class="ready" role="status">
            <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
            <div class="min-w-0">
              <p class="font-serif text-2xl leading-tight">{done.length === 1 ? 'Your audio is ready' : `${done.length} audio files ready`}</p>
              <p class="mono">{formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span></p>
            </div>
          </div>
        {:else}
          <button type="button" class="btn btn-primary" disabled={!canRun} onclick={run}>
            Extract audio{queue.length > 1 ? ` from ${queue.length} files` : ''} as {spec.label}
          </button>
          {#if flacNeedsDecoder && decoder !== 'ready'}
            <p class="mono">FLAC needs the decoder above first.</p>
          {:else if waiting.length && queue.length}
            <p class="mono">Files that need the decoder are skipped until it's downloaded.</p>
          {/if}
        {/if}
        {#if done.length && !job}
          <button type="button" class="btn {allDone ? 'btn-primary' : ''}" disabled={zipping} onclick={downloadAll}>
            {zipping ? 'Zipping…' : done.length > 1 ? `Download all (${done.length}) as .zip` : `Download ${done[0].out?.name.split('.').pop()?.toUpperCase()}`}
          </button>
        {/if}
        {#if runError}<p class="mono text-bad" role="alert">{runError}</p>{/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .stage {
    display: grid;
    gap: 14px;
    padding: 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
    & video {
      width: 100%;
      max-height: 420px;
      border-radius: 12px;
      background: #000;
    }
  }
  .still {
    display: grid;
    place-content: center;
    gap: 6px;
    min-height: 200px;
    padding: 24px;
    text-align: center;
    border-radius: 12px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px), #141312;
  }
  .result {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid #9be58f55;
    border-radius: 14px;
    background: #9be58f0d;
    animation: rise 0.4s var(--ease-spring) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 6px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    overflow: hidden;
  }
  .row.sel {
    border-color: var(--color-sun);
  }
  .row.working::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: calc(var(--p) * 100%);
    background: var(--color-sun);
    transition: width 0.3s ease-out;
  }
  .pick {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 12px;
    padding: 4px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--color-panel-2);
    color: var(--color-muted);
    font: 500 16px var(--font-mono);
    & svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.4;
    }
  }
  .badge[data-state='done'] {
    background: var(--color-ok);
    animation: pop 0.35s var(--ease-spring);
  }
  .badge[data-state='working'] {
    color: var(--color-sun);
  }
  .badge[data-state='unusable'],
  .badge[data-state='failed'] {
    color: var(--color-bad);
  }
  .notice {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid #ffd25e55;
    border-radius: 14px;
    background: #ffd25e0d;
  }
  .meter {
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      border-radius: inherit;
      transition: width 0.25s ease-out;
    }
  }
  .ready {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    flex: none;
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    & circle {
      stroke-dasharray: 66;
      animation: draw 0.5s ease-out both;
    }
    & path {
      --len: 16;
      stroke-width: 2;
      stroke-dasharray: 16;
      animation: draw 0.35s 0.35s ease-out both;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: var(--len, 66);
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  fieldset:disabled {
    opacity: 0.6;
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
