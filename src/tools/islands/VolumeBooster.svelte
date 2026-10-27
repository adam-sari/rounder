<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import { capabilities, containers, dbToGain, ensureDecodable, FALLBACK_DOWNLOAD_MB, MediaError, preloadFallback, probe, waveform, type Capabilities, type MediaInfo, type Peaks } from '@/engines/media';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { describeMedia, errorMessage, level, signed } from '@/tools/lib/loudness/format';
  import { ACCEPT, AUDIO_FORMATS, FORMAT_LABEL, formatSupport, sameAudioFormat, videoContainer, type OutputFormat } from '@/tools/lib/loudness/presets';
  import type { Rendered } from '@/tools/lib/loudness/process';
  import LoudnessProgress from './LoudnessProgress.svelte';

  /** true-peak ceiling for the export, in dBTP */
  const CEILING = -1;
  const MIN_DB = -20;
  const MAX_DB = 30;
  /** meter scale in dBFS */
  const METER_LO = -36;
  const METER_HI = 12;

  type Phase = 'empty' | 'probing' | 'needs-decoder' | 'converting' | 'ready' | 'working' | 'done';

  let phase = $state<Phase>('empty');
  let file = $state<File | null>(null);
  /** what we decode and play: the file itself, or its converted copy for odd formats */
  let source = $state<Blob | null>(null);
  let info = $state<MediaInfo | null>(null);
  let caps = $state<Capabilities | null>(null);
  let previewUrl = $state('');
  let previewFailed = $state(false);
  let peaks = $state<Peaks | null>(null);
  let gainDb = $state(6);
  let format = $state<OutputFormat>('mp3');
  let progress = $state(0);
  let status = $state('');
  let startedAt = $state(0);
  let result = $state<(Rendered & { url: string }) | null>(null);
  let error = $state('');
  let announce = $state('');
  /** reading, converting and the waveform for the current file; the export has its own */
  let fileCtrl: AbortController | null = null;
  let exportCtrl: AbortController | null = null;
  let lib: Promise<typeof import('@/tools/lib/loudness/process')> | undefined;

  // ---------------------------------------------------------------- loading

  async function open(files: File[]) {
    reset();
    const f = files[0];
    const job = (fileCtrl = new AbortController());
    file = f;
    phase = 'probing';
    try {
      caps ??= await capabilities().catch(() => null);
      const i = await probe(f, { signal: job.signal });
      if (i.readable && !i.audio) throw new MediaError('no-tracks', 'This file has no audio.');
      info = i;
      format = i.video ? 'video' : defaultFormat(i.container);
      if (i.needsFallback) phase = 'needs-decoder';
      else await ready(f, job.signal);
    } catch (e) {
      fail(e, job.signal);
    }
  }

  function defaultFormat(container: string): OutputFormat {
    const same = sameAudioFormat(container);
    return formatSupport(same, caps, FALLBACK_DOWNLOAD_MB).ok ? same : 'mp3';
  }

  async function allowDecoder() {
    const job = (fileCtrl = new AbortController());
    phase = 'converting';
    progress = 0;
    startedAt = performance.now();
    status = 'Downloading the decoder…';
    try {
      await preloadFallback((p) => (progress = 0.6 * p));
      if (job.signal.aborted) return;
      status = 'Converting so your browser can play it…';
      const c = await ensureDecodable(file!, { signal: job.signal, onProgress: (p) => (progress = 0.6 + 0.4 * p) });
      if (!c.info.audio) throw new MediaError('no-tracks', 'This file has no audio.');
      // keep the original container so a boosted AVI comes back as MP4, not as our temporary MKV
      info = { ...c.info, container: info!.container };
      await ready(c.file, job.signal);
    } catch (e) {
      fail(e, job.signal);
    }
  }

  async function ready(src: Blob, signal: AbortSignal) {
    source = src;
    previewUrl = URL.createObjectURL(src);
    phase = 'ready';
    try {
      const p = await waveform(src, 1600, {}, { signal });
      if (!signal.aborted && source === src) peaks = p;
    } catch {
      // the waveform is a nicety; the boost still works without it
    }
  }

  function fail(e: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    const msg = errorMessage(e);
    if (!msg) return;
    error = msg;
    if (phase !== 'ready') phase = source ? 'ready' : 'empty';
    if (phase === 'empty') file = null;
  }

  function reset() {
    fileCtrl?.abort();
    exportCtrl?.abort();
    fileCtrl = exportCtrl = null;
    player?.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
    phase = 'empty';
    file = source = info = peaks = result = null;
    previewUrl = error = status = '';
    previewFailed = live = false;
  }

  // ---------------------------------------------------------------- live preview (Web Audio)

  let player = $state<HTMLMediaElement | null>(null);
  let graph: { ctx: AudioContext; gain: GainNode; meter: AnalyserNode; limiter: DynamicsCompressorNode } | null = null;
  let routed: { el: HTMLMediaElement; node: MediaElementAudioSourceNode } | null = null;
  let live = $state(false);
  let meterDb = $state(-Infinity);
  let reductionDb = $state(0);
  let clipping = $state(false);
  let raf = 0;

  /** player → gain → meter → limiter → speakers; set up on the first play (browsers need a gesture) */
  function route() {
    if (!player) return;
    if (!graph) {
      const ctx = new AudioContext();
      const gain = new GainNode(ctx, { gain: dbToGain(gainDb) });
      const meter = new AnalyserNode(ctx, { fftSize: 2048 });
      // as close to a brickwall as the built-in compressor gets; its auto make-up gain keeps
      // the output a touch under 0 dBFS unless the boost is extreme
      const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
      gain.connect(meter).connect(limiter).connect(ctx.destination);
      graph = { ctx, gain, meter, limiter };
    }
    if (routed?.el !== player) {
      routed?.node.disconnect();
      const node = graph.ctx.createMediaElementSource(player);
      node.connect(graph.gain);
      routed = { el: player, node };
    }
    void graph.ctx.resume();
    live = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  $effect(() => {
    const g = dbToGain(gainDb);
    if (graph) graph.gain.gain.setTargetAtTime(g, graph.ctx.currentTime, 0.03);
  });

  let buf: Float32Array<ArrayBuffer> | null = null;
  let last = 0;
  let clipAt = -Infinity;
  function tick(t: number) {
    if (!graph) return;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    buf ??= new Float32Array(graph.meter.fftSize);
    graph.meter.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    const now = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    // fast attack, 24 dB/s fall, like a hardware peak meter
    meterDb = Math.max(now, meterDb - 24 * dt);
    reductionDb = -graph.limiter.reduction;
    if (now > 0) clipAt = t;
    clipping = t - clipAt < 1200;
    if ((!player || player.paused) && meterDb < METER_LO) {
      raf = last = 0;
      meterDb = -Infinity;
      reductionDb = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  $effect(() => () => {
    fileCtrl?.abort();
    exportCtrl?.abort();
    cancelAnimationFrame(raf);
    void graph?.ctx.close();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
  });

  // ---------------------------------------------------------------- export

  async function exportFile() {
    if (!source || !file || !info) return;
    const job = (exportCtrl = new AbortController());
    player?.pause();
    phase = 'working';
    progress = 0;
    status = '';
    error = '';
    startedAt = performance.now();
    try {
      const { render } = await (lib ??= import('@/tools/lib/loudness/process'));
      const r = await render(source, file.name, info, { format, gainDb, ceilingDb: CEILING, limit: true, suffix: gainDb >= 0 ? '-louder' : '-quieter' }, {
        signal: job.signal,
        onProgress: (p) => (progress = p),
        onStatus: (s) => (status = s),
      });
      if (job.signal.aborted) return;
      result = { ...r, url: URL.createObjectURL(r.blob) };
      phase = 'done';
      announce = `Done. ${r.name} is ready to download.`;
    } catch (e) {
      fail(e, job.signal);
    }
  }

  function cancel() {
    (phase === 'working' ? exportCtrl : fileCtrl)?.abort();
    phase = source ? 'ready' : 'needs-decoder';
  }

  function adjustAgain() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
    phase = 'ready';
  }

  // ---------------------------------------------------------------- derived

  const gain = $derived(dbToGain(gainDb));
  const peakDb = $derived.by(() => {
    if (!peaks) return null;
    let p = 0;
    for (let i = 0; i < peaks.max.length; i++) p = Math.max(p, peaks.max[i], -peaks.min[i]);
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  });
  /** the most gain that keeps every sample under the ceiling */
  const cleanDb = $derived(peakDb === null || !Number.isFinite(peakDb) ? null : Math.min(MAX_DB, Math.max(MIN_DB, Math.floor((CEILING - peakDb) * 2) / 2)));
  /** share of the waveform that would cross the ceiling at this gain */
  const overShare = $derived.by(() => {
    if (!peaks) return 0;
    const limit = dbToGain(CEILING) / gain;
    let over = 0;
    for (let i = 0; i < peaks.max.length; i++) if (peaks.max[i] > limit || -peaks.min[i] > limit) over++;
    return over / peaks.max.length;
  });
  const advice = $derived.by(() => {
    if (peakDb === null || !Number.isFinite(peakDb)) return null;
    const lands = peakDb + gainDb;
    if (lands <= CEILING) {
      return { tone: 'ok', text: `No limiting needed: the loudest peak lands at ${level(lands)} dB.` };
    }
    const amount = overShare < 0.01 ? 'A few short peaks go' : `About ${Math.round(overShare * 100)}% of the audio goes`;
    const heavy = lands - CEILING > 12;
    return {
      tone: heavy ? 'bad' : 'warn',
      text: `${amount} over full scale at this boost. The limiter holds them at ${CEILING} dB instead of clipping${heavy ? ', but this much limiting can sound flat or pumpy' : ''}.`,
    };
  });
  const isVideo = $derived(!!info?.video);
  const formats = $derived(
    info
      ? [
          ...(info.video ? [{ id: 'video' as OutputFormat, label: `${containers[videoContainer(info.container)].label} video`, ok: true, note: undefined }] : []),
          ...AUDIO_FORMATS.map((f) => ({ id: f as OutputFormat, label: info!.video ? `${FORMAT_LABEL[f]} audio` : FORMAT_LABEL[f], ...formatSupport(f, caps, FALLBACK_DOWNLOAD_MB) })),
        ]
      : [],
  );
  const formatNote = $derived(formats.find((f) => f.id === format)?.note);
  const meterPos = (db: number) => `${((Math.min(METER_HI, Math.max(METER_LO, db)) - METER_LO) / (METER_HI - METER_LO)) * 100}%`;
  const ceilingY = `${((1 - dbToGain(CEILING)) / 2) * 100}%`;
</script>

{#if phase === 'empty' || phase === 'probing'}
  {#if phase === 'empty'}
    <Dropzone accept={ACCEPT} title="Drop an audio or video file" hint="MP3, WAV, M4A, MP4, MOV… or click to choose" onfiles={open} />
  {:else}
    <div class="panel grid min-h-[220px] place-items-center"><p class="mono" aria-live="polite">reading {file?.name}…</p></div>
  {/if}
  {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
{:else if file && info}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-4">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="truncate">{file.name}</p>
          <p class="mono">{[describeMedia(info), formatBytes(file.size)].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" class="btn px-3! py-2!" onclick={reset} aria-label="Remove file and start over">✕</button>
      </div>

      {#if phase === 'needs-decoder' || phase === 'converting'}
        <div class="panel grid gap-4">
          <h2 class="text-2xl">This format needs an extra decoder</h2>
          <p class="text-sm text-soft">
            Your browser can't open this file on its own. Rounder can convert it right here with a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download. Like everything else,
            it runs on your device and nothing is uploaded.
          </p>
          {#if phase === 'converting'}
            <LoudnessProgress {progress} {status} {startedAt} label="Preparing the file" oncancel={cancel} />
          {:else}
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary" onclick={allowDecoder}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB) and continue</button>
              <button type="button" class="btn" onclick={reset}>Choose another file</button>
            </div>
          {/if}
        </div>
      {:else if phase === 'done' && result}
        <div class="panel grid gap-3 result">
          <span class="label">result · {result.name}</span>
          {#if isVideo && format === 'video'}
            <video src={result.url} controls playsinline class="media"><track kind="captions" /></video>
          {:else}
            <audio src={result.url} controls class="w-full"></audio>
          {/if}
        </div>
      {:else}
        <div class="panel grid gap-3">
          <span class="label">preview · plays with your boost{live ? '' : ' (press play)'}</span>
          {#if isVideo}
            <video bind:this={player} src={previewUrl} controls playsinline class="media" onplay={route} onerror={() => (previewFailed = true)}>
              <track kind="captions" />
            </video>
          {:else}
            <audio bind:this={player} src={previewUrl} controls class="w-full" onplay={route} onerror={() => (previewFailed = true)}></audio>
          {/if}
          {#if previewFailed}
            <p class="mono">Your browser can't play a preview of this file, but boosting and exporting still work.</p>
          {/if}

          <div class="wave" aria-hidden="true">
            {#if peaks}
              <Waveform {peaks} {gain} color="var(--color-audio)" />
            {:else}
              <span class="mono grid h-full place-items-center">reading waveform…</span>
            {/if}
            <span class="ceiling" style:top={ceilingY}></span>
            <span class="ceiling" style:bottom={ceilingY}></span>
          </div>

          <div class="grid gap-1.5">
            <div class="flex items-baseline justify-between gap-3">
              <span class="label mb-0!">live peak, before the limiter</span>
              <span class="mono tabular-nums">
                {#if clipping}<span class="tag">would clip</span>{/if}
                {Number.isFinite(meterDb) ? `${level(meterDb)} dB` : '—'}
              </span>
            </div>
            <div class="meter" role="meter" aria-label="Live peak level" aria-valuemin={METER_LO} aria-valuemax={METER_HI} aria-valuenow={Number.isFinite(meterDb) ? Math.round(meterDb) : METER_LO}>
              <span class="bar" style:--w={Number.isFinite(meterDb) ? meterPos(meterDb) : '0%'}></span>
              <span class="zero" style:left={meterPos(0)}></span>
            </div>
            <div class="scale mono" aria-hidden="true">
              <span style:left="0">{METER_LO}</span>
              <span style:left={meterPos(0)} class="-translate-x-1/2">0</span>
              <span style:right="0">+{METER_HI}</span>
            </div>
            <p class="mono">
              {reductionDb > 0.5 ? `limiter is turning peaks down by ${reductionDb.toFixed(1)} dB` : 'press play to hear the boost; the meter follows along'}
            </p>
          </div>
        </div>
      {/if}
    </div>

    <aside class="grid content-start gap-5">
      {#if phase === 'done' && result}
        <div class="grid gap-4 done">
          <div>
            <span class="check" aria-hidden="true">✓</span>
            <p class="font-serif text-5xl leading-none">{signed(gainDb)} <span class="text-2xl text-muted">dB</span></p>
            <p class="mono mt-2">
              {gainDb >= 0 ? 'louder' : 'quieter'}{result.reductionDb > 0.1 ? ` · limiter caught peaks by up to ${result.reductionDb.toFixed(1)} dB` : ' · no limiting needed'}
            </p>
          </div>
          <p class="mono">{formatBytes(file.size)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span></p>
          <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob, result!.name)}>Download {result.name.split('.').pop()?.toUpperCase()}</button>
          <button type="button" class="btn" onclick={adjustAgain}>Change the boost</button>
          <button type="button" class="btn" onclick={reset}>Start over</button>
        </div>
      {:else if phase === 'ready' || phase === 'working'}
        <div class="grid gap-3">
          <label for="boost" class="label mb-0!">boost</label>
          <output for="boost" class="font-serif text-6xl leading-none tabular-nums">{signed(gainDb)}<span class="text-2xl text-muted"> dB</span></output>
          <input id="boost" type="range" min={MIN_DB} max={MAX_DB} step="0.5" bind:value={gainDb} disabled={phase === 'working'} class="w-full accent-(--color-sun)" />
          <span class="mono flex justify-between"><span>{MIN_DB} dB</span><span>+{MAX_DB} dB</span></span>
          <div class="flex flex-wrap gap-2">
            {#if cleanDb !== null && cleanDb > 0}
              <button type="button" class="chip" disabled={phase === 'working'} onclick={() => (gainDb = cleanDb!)}>loudest clean · {signed(cleanDb)}</button>
            {/if}
            {#each [0, 6, 12] as v (v)}
              <button type="button" class="chip" aria-pressed={gainDb === v} disabled={phase === 'working'} onclick={() => (gainDb = v)}>{signed(v, 0)}</button>
            {/each}
          </div>
          {#if advice}
            <p class="advice {advice.tone}">{advice.text}</p>
          {/if}
        </div>

        <div>
          <span class="label" id="format-label">save as</span>
          <div class="seg" role="group" aria-labelledby="format-label">
            {#each formats as f (f.id)}
              <button type="button" aria-pressed={format === f.id} disabled={!f.ok || phase === 'working'} title={f.note} onclick={() => (format = f.id)}>{f.label}</button>
            {/each}
          </div>
          <p class="mono mt-2">
            {formatNote ?? (format === 'video' ? 'the picture is copied as is; only the sound is re-encoded' : `peaks are kept under ${CEILING} dB true peak`)}
          </p>
          {#if caps}
            {#each formats.filter((f) => !f.ok) as f (f.id)}<p class="mono">{f.note}</p>{/each}
          {/if}
        </div>

        {#if phase === 'working'}
          <LoudnessProgress {progress} {status} {startedAt} label="Exporting" oncancel={cancel} />
        {:else}
          <button type="button" class="btn btn-primary" onclick={exportFile}>{gainDb >= 0 ? 'Boost' : 'Lower'} and export</button>
        {/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      {/if}
    </aside>
  </div>
{/if}

<p class="sr-only" aria-live="polite">{announce}</p>

<style>
  .panel {
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #141312;
  }
  .media {
    width: 100%;
    max-height: 420px;
    border-radius: 12px;
    background: #000;
  }
  .wave {
    position: relative;
    height: 112px;
    border-radius: 12px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
  }
  .ceiling {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed #ff7a6b99;
    pointer-events: none;
  }
  .meter {
    position: relative;
    height: 10px;
    border-radius: 99px;
    overflow: hidden;
    background: linear-gradient(90deg, var(--color-line) 0 75%, #ff7a6b26 75% 100%);
  }
  /* full-width gradient revealed up to the level, so each colour sits at a fixed dB */
  .bar {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, var(--color-ok) 0 55%, var(--color-sun) 68% 74%, var(--color-bad) 75%);
    clip-path: inset(0 calc(100% - var(--w)) 0 0);
    transition: clip-path 60ms linear;
  }
  .scale {
    position: relative;
    height: 16px;
    font-size: 11px;
    & span {
      position: absolute;
      top: 0;
    }
  }
  .zero {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-chalk);
    opacity: 0.6;
  }
  .tag {
    margin-right: 6px;
    padding: 1px 6px;
    border-radius: 6px;
    background: #ff7a6b26;
    color: var(--color-bad);
  }
  .chip {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    padding: 6px 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 99px;
    background: transparent;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover:not(:disabled) {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
  .advice {
    font-size: 14px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--color-line);
    &.ok {
      color: var(--color-ok);
      background: #9be58f10;
    }
    &.warn {
      color: var(--color-sun);
      background: #ffd25e10;
    }
    &.bad {
      color: var(--color-bad);
      background: #ff7a6b12;
    }
  }
  .seg :global(button:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .done,
  .result {
    animation: rise 0.5s ease-out both;
  }
  .check {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    margin-bottom: 12px;
    border-radius: 99px;
    color: var(--color-bg);
    background: var(--color-ok);
    animation: pop 0.6s var(--ease-spring) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
</style>
