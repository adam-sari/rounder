<script lang="ts">
  /*
   * The "done" panel shared by the screen and webcam recorders: playback, details, download
   * as recorded, and an optional conversion of WebM recordings to MP4 through the media engine.
   */
  import { onDestroy, onMount } from 'svelte';
  import { clamp, formatBytes, formatTime } from '@/engines/media/math';
  import { downloadBlob } from '@/tools/lib/files';
  import { conversionError } from '@/tools/lib/recorder/capture';
  import { etaSeconds } from '@/tools/lib/recorder/clock';
  import { codecLabel, recordedFormat } from '@/tools/lib/recorder/format';

  interface Props {
    blob: Blob;
    durationSec: number;
    /** file name without extension */
    baseName: string;
    title?: string;
    restartLabel?: string;
    onrestart: () => void;
    /** the user saved a copy (so leaving the page no longer loses work) */
    ondownload?: () => void;
  }

  let { blob, durationSec, baseName, title = 'Recording ready', restartLabel = 'Record another', onrestart, ondownload }: Props = $props();

  interface Output {
    blob: Blob;
    url: string;
    name: string;
    label: string;
    /** e.g. "VP9 · Opus" ('' when unknown) */
    codecs: string;
  }

  const format = $derived(recordedFormat(blob.type));
  const original = $derived<Output>({ blob, url: URL.createObjectURL(blob), name: `${baseName}.${format.ext}`, label: format.label, codecs: codecLabel(blob.type) });
  let mp4 = $state.raw<Output | null>(null);
  let view = $state<'original' | 'mp4'>('original');
  const shown = $derived(view === 'mp4' && mp4 ? mp4 : original);
  let size = $state<{ w: number; h: number } | null>(null);

  let plan = $state<'checking' | 'native' | 'fallback'>('checking');
  let fallbackMb = $state(31);
  let job = $state<{ progress: number; status: string; startedAt: number } | null>(null);
  let now = $state(0);
  let error = $state('');
  let note = $state('');
  let ctrl: AbortController | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const elapsed = $derived(job ? Math.max(0, now - job.startedAt) : 0);
  const eta = $derived(job ? etaSeconds(elapsed, job.progress) : null);

  $effect(() => {
    const url = original.url;
    return () => URL.revokeObjectURL(url);
  });

  onMount(() => {
    if (!format.convertible) return;
    import('@/engines/media')
      .then(async (m) => {
        fallbackMb = m.FALLBACK_DOWNLOAD_MB;
        const caps = await m.capabilities();
        plan = caps.video.encode.includes('avc') ? 'native' : 'fallback';
      })
      .catch(() => (plan = 'fallback'));
  });

  onDestroy(() => {
    ctrl?.abort();
    clearInterval(ticker);
    if (mp4) URL.revokeObjectURL(mp4.url);
  });

  function save(o: Output) {
    downloadBlob(o.blob, o.name);
    ondownload?.();
  }

  /** MediaRecorder WebM files carry no duration; seeking far past the end makes the browser work it out */
  function loaded(e: Event) {
    const v = e.currentTarget as HTMLVideoElement;
    size = v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
    if (Number.isFinite(v.duration)) return;
    v.addEventListener('timeupdate', () => (v.currentTime = 0), { once: true });
    v.currentTime = 1e101;
  }

  async function convert() {
    error = note = '';
    ctrl = new AbortController();
    const signal = ctrl.signal;
    job = { progress: 0, status: plan === 'fallback' ? 'Loading the converter…' : 'Converting…', startedAt: performance.now() };
    now = job.startedAt;
    ticker = setInterval(() => (now = performance.now()), 250);
    // keep roughly the recording's own bitrate: H.264 needs a touch more than VP9 for the same look
    const videoBps = durationSec > 1 ? (blob.size * 8) / durationSec - 128_000 : 0;
    try {
      const m = await import('@/engines/media');
      const out = await m.transcode(
        blob,
        {
          container: 'mp4',
          video: { codec: 'avc', ...(videoBps > 0 ? { bitrate: Math.round(clamp(videoBps * 1.2, 1_000_000, 20_000_000)) } : { quality: 'high' as const }) },
          audio: { codec: 'aac', bitrate: 160_000 },
        },
        {
          signal,
          engine: plan === 'fallback' ? 'ffmpeg' : 'auto',
          onProgress: (p) => job && (job.progress = p),
          onStatus: (s) => job && (job.status = s),
        },
      );
      if (signal.aborted) return;
      mp4 = { blob: out.blob, url: URL.createObjectURL(out.blob), name: `${baseName}.mp4`, label: 'MP4', codecs: codecLabel(out.mimeWithCodecs) };
      view = 'mp4';
    } catch (e) {
      const err = e as { code?: string; message?: string };
      error = conversionError(err?.code, err?.message ?? '');
      if (!error) note = 'Conversion cancelled.';
    } finally {
      clearInterval(ticker);
      job = null;
      ctrl = undefined;
    }
  }

  const clock = (ms: number) => formatTime(ms / 1000, 0);
</script>

<div class="result" role="region" aria-label="Your recording">
  <div class="head">
    <span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
    <div class="min-w-0 flex-1">
      <p class="font-serif text-[28px] leading-tight">{title}</p>
      <p class="mono break-all">{shown.name}</p>
    </div>
    {#if mp4}
      <div class="seg" role="group" aria-label="Preview">
        <button type="button" aria-pressed={view === 'mp4'} onclick={() => (view = 'mp4')}>MP4</button>
        <button type="button" aria-pressed={view === 'original'} onclick={() => (view = 'original')}>{format.label}</button>
      </div>
    {/if}
  </div>

  {#key shown.url}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video class="player" src={shown.url} controls playsinline preload="metadata" onloadedmetadata={loaded}></video>
  {/key}

  <dl class="stats">
    <div><dt class="mono">Length</dt><dd>{formatTime(durationSec, 0)}</dd></div>
    {#if size}<div><dt class="mono">Resolution</dt><dd>{size.w}×{size.h}</dd></div>{/if}
    <div>
      <dt class="mono">Format</dt>
      <dd>{shown.label}{#if shown.codecs}<span class="mono"> {shown.codecs}</span>{/if}</dd>
    </div>
    <div><dt class="mono">File size</dt><dd>{formatBytes(shown.blob.size)}</dd></div>
  </dl>

  {#if format.convertible && !mp4}
    <div class="convert">
      {#if job}
        <div class="progress" role="status">
          <div class="track" aria-hidden="true"><span style:width="{job.progress * 100}%"></span></div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="mono">
              {job.status} · {Math.round(job.progress * 100)}% · {clock(elapsed)} elapsed{eta !== null ? ` · about ${clock(eta * 1000)} left` : ''}
            </p>
            <button type="button" class="btn sm" onclick={() => ctrl?.abort()}>Cancel</button>
          </div>
        </div>
      {:else}
        <p class="text-sm text-soft">
          {format.label} plays in Chrome, Firefox, Edge and VLC. For QuickTime, iPhones, PowerPoint or most video editors, convert it to MP4 (H.264).
          {#if plan === 'fallback'}
            This browser can't encode H.264 by itself, so converting needs a one-time {fallbackMb} MB download and runs slower.
          {/if}
        </p>
        <button type="button" class="btn" disabled={plan === 'checking'} onclick={convert}>
          {plan === 'checking' ? 'Checking MP4 support…' : plan === 'fallback' ? `Download converter (${fallbackMb} MB) and convert` : 'Convert to MP4'}
        </button>
      {/if}
      {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      {#if note}<p class="mono" role="status">{note}</p>{/if}
    </div>
  {/if}

  {#if mp4}
    <p class="mono" role="status">
      MP4 ready · {format.label} {formatBytes(blob.size)} → <span class="text-chalk">MP4 {formatBytes(mp4.blob.size)}</span>
    </p>
  {/if}

  <div class="actions">
    {#if mp4}
      <button type="button" class="btn btn-primary" onclick={() => save(mp4!)}>{@render down()} Download MP4</button>
      <button type="button" class="btn" onclick={() => save(original)}>{@render down()} {format.label}</button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={() => save(original)}>{@render down()} Download {format.label}</button>
    {/if}
    <button type="button" class="btn ml-auto" disabled={!!job} onclick={onrestart}>{restartLabel}</button>
  </div>
</div>

{#snippet down()}
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
{/snippet}

<style>
  .result {
    display: grid;
    gap: 16px;
    padding: 20px;
    border-radius: 18px;
    border: 1px solid #9be58f55;
    background: linear-gradient(120deg, #9be58f12, transparent 60%), var(--color-panel-2);
    animation: arrive 0.4s var(--ease-spring);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
  }
  .tick {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--color-ok);
    animation: pop 0.5s var(--ease-spring) backwards 0.15s;
    & svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 24;
      animation: draw 0.4s ease-out backwards 0.35s;
    }
  }
  .player {
    width: 100%;
    max-height: 420px;
    border-radius: 12px;
    background: #000;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin: 0;
    & div {
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--color-line);
      background: #0000001f;
    }
    & dd {
      margin: 2px 0 0;
      font-size: 16px;
    }
  }
  .convert {
    display: grid;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: #0000001f;
    & > .btn {
      justify-self: start;
    }
  }
  .progress {
    display: grid;
    gap: 10px;
  }
  .track {
    height: 8px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--color-sun) 30%, #fff3c9 50%, var(--color-sun) 70%) 0 0 / 300% 100%;
      animation: shimmer 1.6s linear infinite;
      transition: width 0.3s ease-out;
    }
  }
  .btn.sm {
    padding: 7px 12px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 24;
    }
  }
  @keyframes shimmer {
    to {
      background-position: -300% 0;
    }
  }
</style>
