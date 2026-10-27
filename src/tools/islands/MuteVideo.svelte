<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { downloadName, FALLBACK_DOWNLOAD_MB, formatBytes, isAbort, MediaError, preloadFallback, probe, transcode, type MediaInfo } from '@/engines/media';
  import { downloadResult, zipFiles } from '@/tools/lib/files';
  import { describeMedia, errorMessage, etaSeconds, formatSeconds, keepContainer, muteNeedsDecoder, rotatedPicture, sizeChange } from '@/tools/lib/mute-video/media';

  type Status = 'probing' | 'ready' | 'needs-decoder' | 'silent' | 'working' | 'done' | 'error';
  interface Item {
    id: number;
    file: File;
    url: string;
    info: MediaInfo | null;
    status: Status;
    progress: number;
    stage: string;
    error: string;
    out: { blob: Blob; name: string; url: string } | null;
  }

  const ACCEPT = 'video/*,.mkv,.mov,.m4v,.avi,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.mpg,.mpeg,.ogv';

  let items = $state<Item[]>([]);
  let selectedId = $state(0);
  let view = $state<'original' | 'result'>('result');
  let batch = $state<number[]>([]);
  let running = $state(false);
  let startedAt = $state(0);
  let now = $state(0);
  let decoder = $state<'idle' | 'loading' | 'ready'>('idle');
  let decoderPct = $state(0);
  let notice = $state('');
  let zipping = $state(false);
  /** object URLs the browser couldn't play (e.g. AVI, or MKV in Safari) */
  let unplayable = $state<string[]>([]);
  let ids = 0;
  let ctrl: AbortController | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;

  const selected = $derived(items.find((i) => i.id === selectedId) ?? items[0]);
  const ready = $derived(items.filter((i) => i.status === 'ready'));
  const done = $derived(items.filter((i) => i.status === 'done'));
  const waitingForDecoder = $derived(items.filter((i) => i.status === 'needs-decoder'));
  const probing = $derived(items.some((i) => i.status === 'probing'));
  const overall = $derived.by(() => {
    const jobs = items.filter((i) => batch.includes(i.id));
    return jobs.length ? jobs.reduce((n, i) => n + (i.status === 'done' ? 1 : i.status === 'working' ? i.progress : 0), 0) / jobs.length : 0;
  });
  const elapsed = $derived(running ? now - startedAt : 0);
  const eta = $derived(etaSeconds(overall, elapsed));
  const totals = $derived(done.reduce((t, i) => ({ before: t.before + i.file.size, after: t.after + i.out!.blob.size }), { before: 0, after: 0 }));
  const allDone = $derived(!running && done.length > 0 && done.length === items.filter((i) => i.status !== 'silent' && i.status !== 'error').length);

  async function add(files: File[]) {
    notice = '';
    const first = ids + 1;
    for (const file of files) items.push({ id: ++ids, file, url: URL.createObjectURL(file), info: null, status: 'probing', progress: 0, stage: '', error: '', out: null });
    if (!selectedId) selectedId = first;
    for (const item of items.filter((i) => i.id >= first)) await inspect(item);
  }

  async function inspect(item: Item) {
    if (!items.some((i) => i.id === item.id)) return;
    try {
      const info = await probe(item.file, { fallback: decoder === 'ready' });
      item.info = info;
      const known = info.readable || info.via === 'ffmpeg';
      if (known && !info.video) throw new MediaError('no-tracks', 'This file has no video. It looks like an audio file.');
      if (muteNeedsDecoder(info) && decoder !== 'ready') item.status = 'needs-decoder';
      else item.status = known && !info.audio ? 'silent' : 'ready';
    } catch (e) {
      item.status = 'error';
      item.error = errorMessage(e);
    }
  }

  async function loadDecoder() {
    decoder = 'loading';
    notice = '';
    try {
      await preloadFallback((p) => (decoderPct = p));
      decoder = 'ready';
      for (const item of waitingForDecoder) {
        item.status = 'probing';
        await inspect(item);
      }
    } catch (e) {
      decoder = 'idle';
      notice = `Couldn't download the decoder. ${errorMessage(e)}`;
    }
  }

  async function run() {
    const queue = ready;
    if (!queue.length) return;
    batch = queue.map((i) => i.id);
    running = true;
    ctrl = new AbortController();
    const { signal } = ctrl;
    startedAt = now = performance.now();
    clock = setInterval(() => (now = performance.now()), 250);
    for (const item of queue) {
      if (signal.aborted) break;
      // removed from the list while waiting its turn
      if (!items.some((i) => i.id === item.id)) continue;
      item.status = 'working';
      item.progress = 0;
      try {
        const info = item.info!;
        const container = keepContainer({ container: info.container, needsFallback: muteNeedsDecoder(info) });
        // no video options: the picture is copied as is, only the sound track is dropped
        const r = await transcode(item.file, { container, audio: false }, { signal, onProgress: (p) => (item.progress = p), onStatus: (s) => (item.stage = s) });
        item.out = { blob: r.blob, name: downloadName(item.file.name, container, '-muted'), url: URL.createObjectURL(r.blob) };
        item.status = 'done';
      } catch (e) {
        item.status = isAbort(e) ? 'ready' : 'error';
        item.error = isAbort(e) ? '' : errorMessage(e);
      }
    }
    clearInterval(clock);
    running = false;
    ctrl = null;
  }

  function cancel() {
    ctrl?.abort();
  }

  function revoke(item: Item) {
    URL.revokeObjectURL(item.url);
    if (item.out) URL.revokeObjectURL(item.out.url);
  }

  function remove(item: Item) {
    revoke(item);
    items = items.filter((i) => i.id !== item.id);
    if (selectedId === item.id) selectedId = items[0]?.id ?? 0;
  }

  function clear() {
    cancel();
    items.forEach(revoke);
    items = [];
    batch = [];
    selectedId = 0;
    notice = '';
  }

  async function downloadAll() {
    if (done.length === 1) return downloadResult(done[0].out!.blob, done[0].out!.name);
    zipping = true;
    try {
      downloadResult(await zipFiles(done.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), 'muted-videos.zip');
    } catch (e) {
      notice = errorMessage(e);
    } finally {
      zipping = false;
    }
  }

  onDestroy(() => {
    ctrl?.abort();
    clearInterval(clock);
    items.forEach(revoke);
  });

  const previewUrl = $derived(selected?.out && view === 'result' ? selected.out.url : selected?.url);
</script>

{#if items.length === 0}
  <Dropzone accept={ACCEPT} multiple title="Drop videos to mute" hint="MP4, MOV, WebM, MKV, AVI… as many as you like" onfiles={add} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      {#if selected}
        <figure class="player">
          {#if !previewUrl || unplayable.includes(previewUrl)}
            <div class="noview">
              <p class="font-serif text-2xl">No preview for this one</p>
              <p class="mono">your browser can't play this format{selected.out ? '' : ', but it can still be muted'}</p>
            </div>
          {:else}
            {#key previewUrl}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={previewUrl} controls playsinline preload="metadata" onerror={() => previewUrl && unplayable.push(previewUrl)}></video>
            {/key}
          {/if}
          <figcaption class="mono flex flex-wrap items-center justify-between gap-2">
            <span class="truncate">{selected.out && view === 'result' ? selected.out.name : selected.file.name}</span>
            {#if selected.out}
              <span class="seg" role="group" aria-label="Preview">
                <button type="button" aria-pressed={view === 'original'} onclick={() => (view = 'original')}>original</button>
                <button type="button" aria-pressed={view === 'result'} onclick={() => (view = 'result')}>silent</button>
              </span>
            {/if}
          </figcaption>
        </figure>
      {/if}

      <ul class="grid gap-2" aria-label="Videos">
        {#each items as item (item.id)}
          <li class="row" class:sel={item.id === selected?.id}>
            <button type="button" class="pick" onclick={() => (selectedId = item.id)} aria-label={`Preview ${item.file.name}`} aria-current={item.id === selected?.id}>
              <span class="dot" class:ok={item.status === 'done'} class:bad={item.status === 'error'} aria-hidden="true">
                {item.status === 'done' ? '✓' : item.status === 'error' ? '!' : item.status === 'silent' ? '–' : '▶'}
              </span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-sm">{item.file.name}</span>
                <span class="mono block truncate">
                  {#if item.status === 'probing'}
                    <span class="working">reading…</span>
                  {:else if item.status === 'error'}
                    <span class="text-bad">{item.error}</span>
                  {:else if item.status === 'done' && item.out}
                    {formatBytes(item.file.size)} → <span class="text-chalk">{formatBytes(item.out.blob.size)}</span>
                    {@const c = sizeChange(item.file.size, item.out.blob.size)}
                    <span class={c.smaller ? 'text-ok' : ''}>{c.text}</span> · sound removed
                  {:else if item.status === 'working'}
                    <span class="working">{item.stage || 'removing audio…'}</span> {Math.round(item.progress * 100)}%
                  {:else}
                    {formatBytes(item.file.size)}
                    {#if item.info}· {describeMedia(item.info).join(' · ')}{/if}
                    {#if item.status === 'silent'}· <span class="text-sun">already silent</span>{/if}
                    {#if item.status === 'needs-decoder'}· <span class="text-sun">needs decoder</span>{/if}
                  {/if}
                </span>
              </span>
            </button>
            {#if item.out}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadResult(item.out!.blob, item.out!.name)} aria-label={`Download ${item.out.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" disabled={item.status === 'working'} onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
            {#if item.status === 'working'}
              <span class="bar" style:--p={item.progress} aria-hidden="true"></span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if !running}
        <Dropzone accept={ACCEPT} multiple title="Add more" hint="drop, click or paste" onfiles={add} />
      {/if}
    </div>

    <aside class="grid content-start gap-4">
      {#if waitingForDecoder.length}
        <div class="note">
          <p class="text-sm">
            {waitingForDecoder.length === 1 ? 'One video uses' : `${waitingForDecoder.length} videos use`} a format your browser can't open by itself. A one-time {FALLBACK_DOWNLOAD_MB} MB
            decoder can handle it; it stays cached for next time. These come out as MP4.
          </p>
          <button type="button" class="btn" disabled={decoder === 'loading'} onclick={loadDecoder}>
            {decoder === 'loading' ? `Downloading… ${Math.round(decoderPct * 100)}%` : `Download decoder (${FALLBACK_DOWNLOAD_MB} MB)`}
          </button>
        </div>
      {/if}

      {#if running}
        <div class="grid gap-2" aria-live="polite">
          <div class="progress" role="progressbar" aria-label="Removing audio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)}>
            <span style:--p={overall}></span>
          </div>
          <p class="mono flex justify-between">
            <span class="text-chalk">{Math.round(overall * 100)}%</span>
            <span>{formatSeconds(elapsed / 1000)} elapsed{eta !== null ? ` · about ${formatSeconds(eta)} left` : ''}</span>
          </p>
          <button type="button" class="btn" onclick={cancel}>Cancel</button>
        </div>
      {:else if allDone}
        <div class="done" aria-live="polite">
          <span class="check" aria-hidden="true">✓</span>
          <div>
            <p class="font-serif text-2xl leading-tight">{done.length === 1 ? 'Sound removed' : `${done.length} videos muted`}</p>
            <p class="mono">
              {formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span>
              {#if sizeChange(totals.before, totals.after).smaller}<span class="text-ok"> {sizeChange(totals.before, totals.after).text}</span>{/if}
            </p>
          </div>
        </div>
      {/if}

      {#if !running && ready.length}
        <button type="button" class="btn btn-primary" disabled={probing} onclick={run}>
          {ready.length > 1 ? `Remove audio from ${ready.length} videos` : 'Remove audio'}
        </button>
        <p class="mono">
          {ready.some((i) => i.info && (rotatedPicture(i.info) || muteNeedsDecoder(i.info)))
            ? 'the picture is copied as is where it can be; sideways-stored phone clips and older formats are re-encoded once at high quality'
            : 'the picture is copied as is, so no quality is lost'}
        </p>
      {/if}

      {#if done.length && !running}
        <button type="button" class={ready.length ? 'btn' : 'btn btn-primary'} disabled={zipping} onclick={downloadAll}>
          {zipping ? 'Zipping…' : done.length > 1 ? `Download all (${done.length}) as .zip` : `Download ${done[0].out!.name}`}
        </button>
      {/if}

      {#if notice}<p class="text-sm text-bad" role="alert">{notice}</p>{/if}
      <button type="button" class="btn" onclick={clear}>Start over</button>
    </aside>
  </div>
{/if}

<style>
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
    }
    & video {
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
    border-color: var(--color-line-2);
    background: var(--color-panel);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 4px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .dot {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    font-size: 13px;
    color: var(--color-muted);
    background: var(--color-panel-2);
    transition: background 0.3s, color 0.3s, transform 0.3s var(--ease-spring);
  }
  .sel .dot {
    border-color: var(--color-sun);
    color: var(--color-sun);
  }
  .dot.ok {
    background: var(--color-ok);
    border-color: var(--color-ok);
    color: var(--color-bg);
  }
  .dot.bad {
    color: var(--color-bad);
    border-color: var(--color-bad);
  }
  .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: 100%;
    background: var(--color-sun);
    transform-origin: left;
    transform: scaleX(var(--p));
    transition: transform 0.25s linear;
  }
  .working {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
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
