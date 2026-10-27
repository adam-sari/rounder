<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import {
    capabilities,
    downloadName,
    FALLBACK_DOWNLOAD_MB,
    formatBitrate,
    formatTime,
    hasWebCodecs,
    isAbort,
    MediaError,
    preloadFallback,
    probe,
    transcode,
    videoCodecLabel,
    type MediaInfo,
    type VideoCodec,
  } from '@/engines/media';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import {
    codecInfo,
    errorText,
    etaSeconds,
    MB,
    planCompression,
    shortDuration,
    targetPresets,
    type CodecChoice,
    type FpsCap,
    type Mode,
    type Preset,
    type Resolution,
    type Settings,
  } from '@/tools/lib/video-compressor/plan';

  interface Result {
    blob: Blob;
    url: string;
    name: string;
    /** the original was handed back: it already fit, or compressing made it bigger */
    kept?: 'fits' | 'bigger';
    /** the target (MB) it already fit under */
    limitMB?: number;
    notes: string[];
    width?: number;
    height?: number;
    key: string;
    seconds: number;
  }

  interface Item {
    id: number;
    file: File;
    url: string;
    status: 'probing' | 'invalid' | 'ready' | 'queued' | 'working' | 'done' | 'error';
    info?: MediaInfo;
    /** only the ffmpeg.wasm fallback can decode it */
    decoder: boolean;
    playable: boolean;
    progress: number;
    stage: string;
    startedAt: number;
    result?: Result;
    error?: string;
    ctrl?: AbortController;
  }

  // settings
  let mode = $state<Mode>('target');
  let targetChoice = $state<number | 'custom'>(10);
  let customMB = $state<number | null>(30);
  let preset = $state<Preset>('balanced');
  let resolution = $state<Resolution>('auto');
  let fps = $state<FpsCap>('original');
  let codec = $state<CodecChoice>('avc');
  let removeAudio = $state(false);

  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let running = $state(false);
  let batch = $state({ index: 0, total: 0 });
  let stopRequested = false;
  let encodable = $state<VideoCodec[] | null>(null);
  let decoderState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let decoderProgress = $state(0);
  let zipping = $state(false);
  let now = $state(Date.now());
  let nextId = 0;

  const targetMB = $derived(targetChoice === 'custom' ? (customMB ?? 0) : targetChoice);
  const effResolution = $derived<Resolution>(mode === 'quality' && resolution === 'auto' ? 'original' : resolution);
  const settings = $derived<Settings>({ mode, targetMB, preset, resolution: effResolution, fps, codec, removeAudio });
  const settingsKey = $derived(JSON.stringify(settings));
  const validTarget = $derived(mode === 'quality' || targetMB > 0);

  const presets: [Preset, string][] = [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Smallest']];
  const resolutions = $derived<[Resolution, string][]>([
    ...(mode === 'target' ? [['auto', 'Auto'] as [Resolution, string]] : []),
    ['original', 'Original'],
    [1080, '1080p'],
    [720, '720p'],
    [480, '480p'],
  ]);
  const fpsOptions: [FpsCap, string][] = [['original', 'Original'], [30, '30'], [24, '24']];
  const codecs: CodecChoice[] = ['avc', 'hevc', 'av1', 'vp9'];
  // extensions too: files with no MIME type (common for .mov/.mkv) would otherwise be rejected
  const accept = 'video/*,.mp4,.mov,.webm,.mkv,.avi,.wmv,.flv,.m4v,.3gp,.mts,.m2ts,.mpg,.mpeg,.vob,.ogv';
  const canEncode = (c: CodecChoice) => c === 'avc' || !!encodable?.includes(c);

  $effect(() => {
    capabilities().then(
      // WebM also needs an Opus/Vorbis encoder, which containers.webm accounts for
      (c) => (encodable = c.containers.webm ? c.video.encode : c.video.encode.filter((x) => x !== 'vp9')),
      () => (encodable = []),
    );
  });

  // ticks the elapsed/ETA readout while a job runs
  $effect(() => {
    if (!running) return;
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });

  const blocked = (it: Item) => it.decoder && decoderState !== 'ready';
  const planFor = (it: Item) => (it.info?.video && validTarget && !blocked(it) ? planCompression(it.info, settings) : null);
  const isPending = (it: Item) =>
    !!it.info?.video && !blocked(it) && (it.status === 'ready' || it.status === 'error' || (it.status === 'done' && it.result?.key !== settingsKey));

  async function add(files: File[]) {
    const fresh = files.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file), status: 'probing' as const, decoder: false, playable: true, progress: 0, stage: '', startedAt: 0 }));
    items.push(...fresh);
    selected ??= fresh[0]?.id ?? null;
    for (const f of fresh) {
      const it = items.find((i) => i.id === f.id);
      if (it) await inspect(it);
    }
  }

  async function inspect(it: Item, fallback = false) {
    try {
      const info = await probe(it.file, { fallback });
      if (!items.includes(it)) return;
      it.info = info;
      it.decoder = info.needsFallback || !hasWebCodecs();
      if (info.readable && !info.video) {
        it.status = 'invalid';
        it.error = info.audio ? 'This is an audio file. Try the audio converter instead.' : 'No video track found in this file.';
      } else it.status = it.result ? 'done' : 'ready';
    } catch (e) {
      if (!items.includes(it)) return;
      it.status = 'invalid';
      it.error = errorText((e as MediaError).code, (e as Error).message);
    }
  }

  async function getDecoder() {
    decoderState = 'loading';
    try {
      await preloadFallback((p) => (decoderProgress = p));
      decoderState = 'ready';
      // files the browser couldn't open at all only get their details once ffmpeg reads them
      for (const it of items.filter((i) => i.decoder && !i.info?.readable)) await inspect(it, true);
    } catch {
      decoderState = 'error';
    }
  }

  async function compressAll() {
    const todo = items.filter(isPending);
    if (!todo.length) return;
    for (const it of todo) it.status = 'queued';
    running = true;
    stopRequested = false;
    batch.total = todo.length;
    for (const [i, it] of todo.entries()) {
      if (stopRequested) break;
      batch.index = i + 1;
      if (items.includes(it) && it.status === 'queued') await compress(it);
    }
    for (const it of items) if (it.status === 'queued') it.status = it.result ? 'done' : 'ready';
    running = false;
  }

  async function compress(it: Item) {
    const plan = planCompression(it.info!, settings);
    const key = settingsKey;
    const startedAt = Date.now();
    Object.assign(it, { status: 'working', progress: 0, stage: 'Starting…', startedAt, error: undefined, ctrl: new AbortController() });
    selected = it.id;
    const finish = (r: Omit<Result, 'url' | 'key' | 'seconds'>) => {
      if (it.result) URL.revokeObjectURL(it.result.url);
      it.result = { ...r, url: URL.createObjectURL(r.blob), key, seconds: (Date.now() - startedAt) / 1000 };
      it.status = 'done';
    };
    try {
      if (plan.skip) return finish({ blob: it.file, name: it.file.name, kept: 'fits', limitMB: settings.targetMB, notes: [] });
      const out = await transcode(it.file, plan.options, {
        signal: it.ctrl!.signal,
        onProgress: (p) => (it.progress = p),
        onStatus: (s) => (it.stage = s === 'Converting…' ? 'Compressing…' : s),
      });
      if (!items.includes(it)) return;
      // never hand back something bigger than what came in
      if (out.blob.size >= it.file.size) finish({ blob: it.file, name: it.file.name, kept: 'bigger', notes: [] });
      else finish({ blob: out.blob, name: downloadName(it.file.name, out.container, '-compressed'), notes: out.notes, width: out.width, height: out.height });
    } catch (e) {
      if (!items.includes(it)) return;
      if (isAbort(e)) it.status = it.result ? 'done' : 'ready';
      else {
        console.error(e);
        it.status = 'error';
        it.error = errorText((e as MediaError).code, (e as Error).message);
      }
    } finally {
      it.ctrl = undefined;
    }
  }

  function cancel() {
    stopRequested = true;
    for (const it of items) it.ctrl?.abort();
  }

  function remove(it: Item) {
    it.ctrl?.abort();
    URL.revokeObjectURL(it.url);
    if (it.result) URL.revokeObjectURL(it.result.url);
    items.splice(items.indexOf(it), 1);
    if (selected === it.id) selected = items[0]?.id ?? null;
  }

  function startOver() {
    cancel();
    for (const it of [...items]) remove(it);
  }

  async function downloadAll() {
    const ready = items.filter((i) => i.result);
    if (ready.length === 1) return downloadBlob(ready[0].result!.blob, ready[0].result!.name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(ready.map((i) => ({ name: i.result!.name, blob: i.result!.blob }))), 'compressed-videos.zip');
    } finally {
      zipping = false;
    }
  }

  $effect(() => () => {
    stopRequested = true;
    for (const it of items) {
      it.ctrl?.abort();
      URL.revokeObjectURL(it.url);
      if (it.result) URL.revokeObjectURL(it.result.url);
    }
  });

  const current = $derived(items.find((i) => i.id === selected));
  const currentPlan = $derived(current ? planFor(current) : null);
  const pending = $derived(items.filter(isPending));
  const needDecoder = $derived(items.filter((i) => i.decoder && i.status !== 'invalid').length);
  const finished = $derived(items.filter((i) => i.result));
  const totals = $derived({
    before: finished.reduce((s, i) => s + i.file.size, 0),
    after: finished.reduce((s, i) => s + i.result!.blob.size, 0),
  });

  const pct = (before: number, after: number) => Math.round((1 - after / before) * 100);
  const codecName = (c: string | null | undefined) => (c ? (videoCodecLabel[c as VideoCodec] ?? c.toUpperCase()) : 'unknown codec');

  function describe(info: MediaInfo) {
    const v = info.video;
    const bits = [formatTime(info.durationSec, 0)];
    if (v) bits.push(`${v.displayWidth}×${v.displayHeight}`, codecName(v.codec));
    if (v?.fps) bits.push(`${Math.round(v.fps)} fps`);
    if (v?.bitrate) bits.push(formatBitrate(v.bitrate));
    if (info.audio) bits.push(info.audio.codec ? `${info.audio.codec.toUpperCase()} audio` : 'audio');
    return bits.join(' · ');
  }

  function timing(it: Item) {
    const elapsed = (now - it.startedAt) / 1000;
    const eta = etaSeconds(now - it.startedAt, it.progress);
    return `${shortDuration(Math.max(0, elapsed))} elapsed${eta !== null ? ` · about ${shortDuration(eta)} left` : ''}`;
  }
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if items.length === 0}
      <Dropzone
        {accept}
        multiple
        title="Drop videos here"
        hint="or click to choose · MP4, MOV, WebM, MKV, AVI… · batches welcome"
        onfiles={add}
      />
    {:else}
      {#if needDecoder && decoderState !== 'ready'}
        <div class="notice" role="status">
          <p class="text-sm">
            {#if !hasWebCodecs()}
              This browser can't encode video natively, so compressing needs a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download. It runs on your device too, just more slowly.
            {:else}
              {needDecoder === 1 ? 'One video uses' : `${needDecoder} videos use`} a format this browser can't decode by itself (like AVI or WMV). Compressing {needDecoder === 1 ? 'it' : 'them'} needs a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download, which also runs on your device.
            {/if}
          </p>
          {#if decoderState === 'loading'}
            <div class="bar" role="progressbar" aria-label="Downloading decoder" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(decoderProgress * 100)}>
              <div class="fill" style:transform={`scaleX(${decoderProgress})`}></div>
            </div>
            <p class="mono">Downloading decoder… {Math.round(decoderProgress * 100)}%</p>
          {:else}
            <button type="button" class="btn" onclick={getDecoder}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB)</button>
            {#if decoderState === 'error'}<p class="mono text-bad">The download failed. Check your connection and try again.</p>{/if}
          {/if}
        </div>
      {/if}

      {#if current}
        {@const r = current.result}
        <section class="card stage" aria-label="Selected video">
          <div class="players" class:two={r && !r.kept}>
            <figure>
              <figcaption class="mono">{r && !r.kept ? 'original' : current.file.name} · {formatBytes(current.file.size)}</figcaption>
              {#if current.playable}
                <!-- the user's own clip: there is no caption track to offer -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={current.url} controls playsinline preload="metadata" onerror={() => (current.playable = false)}></video>
              {:else}
                <div class="noplay mono">No preview in this browser. It can still be compressed{current.decoder && decoderState !== 'ready' ? ' once the decoder is downloaded' : ''}.</div>
              {/if}
            </figure>
            {#if r && !r.kept}
              <figure>
                <figcaption class="mono">compressed · {formatBytes(r.blob.size)}</figcaption>
                <!-- the user's own clip: there is no caption track to offer -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={r.url} controls playsinline preload="metadata"></video>
              </figure>
            {/if}
          </div>

          {#if current.info?.video}
            <p class="mono">{describe(current.info)}</p>
          {:else if current.status === 'probing'}
            <p class="mono working">reading file…</p>
          {/if}

          {#if current.status === 'working'}
            <div class="grid gap-2">
              <div class="bar" role="progressbar" aria-label="Compressing" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(current.progress * 100)}>
                <div class="fill" style:transform={`scaleX(${current.progress})`}></div>
              </div>
              <p class="mono flex flex-wrap justify-between gap-x-4">
                <span class="text-chalk">{current.stage || 'Compressing…'} {Math.round(current.progress * 100)}%</span>
                <span>{timing(current)}</span>
              </p>
            </div>
          {:else if current.status === 'done' && r}
            {#if r.kept}
              <p class="kept text-sm">
                {r.kept === 'fits'
                  ? `Already under ${r.limitMB} MB, so the original is kept as is.`
                  : 'Compressing made this one bigger, so you get the original back, untouched.'}
              </p>
            {:else}
              {@const ratio = Math.max(0.01, r.blob.size / current.file.size)}
              <div class="done">
                <span class="check" aria-hidden="true">✓</span>
                <div class="grid min-w-0 flex-1 gap-1.5">
                  <p class="text-sm">
                    <strong class="font-medium">{pct(current.file.size, r.blob.size)}% smaller</strong>
                    <span class="mono">· {formatBytes(current.file.size)} → <span class="text-chalk">{formatBytes(r.blob.size)}</span>{#if r.width} · {r.width}×{r.height}{/if} · took {shortDuration(r.seconds)}</span>
                  </p>
                  <div class="sizes" aria-hidden="true">
                    <div class="before"></div>
                    <div class="after" style:width={`${ratio * 100}%`} style:--r={ratio}></div>
                  </div>
                </div>
              </div>
              {#if mode === 'target' && r.blob.size > targetMB * MB && r.key === settingsKey}
                <p class="mono text-bad">Came out over {targetMB} MB. Try a lower resolution, a shorter clip or a slightly smaller target.</p>
              {/if}
              {#each r.notes as note}<p class="mono">{note}</p>{/each}
            {/if}
            <button type="button" class="btn btn-primary justify-self-start" onclick={() => downloadBlob(r.blob, r.name)}>Download {r.name}</button>
          {:else if current.error}
            <p class="text-sm text-bad" role="alert">{current.error}</p>
          {/if}
        </section>
      {/if}

      <ul class="grid gap-2" aria-label="Videos">
        {#each items as it (it.id)}
          {@const p = planFor(it)}
          <li class="row" class:sel={it.id === selected}>
            <button type="button" class="thumb" onclick={() => (selected = it.id)} aria-label={`Show ${it.file.name}`}>
              {#if it.playable}
                <video src={`${it.url}#t=0.5`} muted playsinline preload="metadata" tabindex="-1" onerror={() => (it.playable = false)}></video>
              {:else}
                <span aria-hidden="true">▶</span>
              {/if}
            </button>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{it.result?.name ?? it.file.name}</p>
              <p class="mono">
                {#if it.status === 'working'}
                  <span class="working">{Math.round(it.progress * 100)}%</span> · {formatBytes(it.file.size)}
                {:else if it.status === 'done' && it.result}
                  {formatBytes(it.file.size)} →
                  {#if it.result.kept}<span class="text-chalk">kept original</span>{:else}<span class="text-chalk">{formatBytes(it.result.blob.size)}</span>
                    <span class="text-ok">−{pct(it.file.size, it.result.blob.size)}%</span>{/if}
                  {#if it.result.key !== settingsKey}· <span class="text-sun">settings changed</span>{/if}
                {:else if it.status === 'invalid' || it.status === 'error'}
                  <span class="text-bad">{it.error}</span>
                {:else if it.status === 'probing'}
                  <span class="working">reading…</span>
                {:else if blocked(it)}
                  {formatBytes(it.file.size)} · needs decoder
                {:else}
                  {formatBytes(it.file.size)}{#if p} → ~{p.skip ? formatBytes(it.file.size) : formatBytes(p.estimateBytes)}{/if}
                  {#if it.status === 'queued'}· <span class="working">waiting</span>{/if}
                {/if}
              </p>
            </div>
            {#if it.result}
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadBlob(it.result!.blob, it.result!.name)} aria-label={`Download ${it.result.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" onclick={() => remove(it)} aria-label={`Remove ${it.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>
      <Dropzone {accept} multiple title="Add more" hint="drop or click" onfiles={add} />
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    <fieldset class="grid gap-5" disabled={running}>
      <div>
        <span class="label">compress by</span>
        <div class="seg" role="group" aria-label="Compress by">
          <button type="button" aria-pressed={mode === 'target'} onclick={() => (mode = 'target')}>Target size</button>
          <button type="button" aria-pressed={mode === 'quality'} onclick={() => (mode = 'quality')}>Quality</button>
        </div>
      </div>

      {#if mode === 'target'}
        <div>
          <span class="label">target size</span>
          <div class="seg" role="group" aria-label="Target size">
            {#each targetPresets as t}
              <button type="button" aria-pressed={targetChoice === t.mb} onclick={() => (targetChoice = t.mb)} title={t.label}>{t.mb} MB</button>
            {/each}
            <button type="button" aria-pressed={targetChoice === 'custom'} onclick={() => (targetChoice = 'custom')}>Custom</button>
          </div>
          {#if targetChoice === 'custom'}
            <label class="mt-2 flex items-center gap-2">
              <input type="number" class="field" min="0.1" step="any" bind:value={customMB} aria-label="Target size in MB" />
              <span class="mono">MB</span>
            </label>
          {:else}
            <p class="mono mt-1.5">{targetPresets.find((t) => t.mb === targetChoice)?.label} · {targetChoice} MB</p>
          {/if}
        </div>
      {:else}
        <div>
          <span class="label">quality</span>
          <div class="seg" role="group" aria-label="Quality">
            {#each presets as [value, label]}
              <button type="button" aria-pressed={preset === value} onclick={() => (preset = value)}>{label}</button>
            {/each}
          </div>
        </div>
      {/if}

      <div>
        <span class="label">resolution · never upscales</span>
        <div class="seg" role="group" aria-label="Resolution">
          {#each resolutions as [value, label]}
            <button type="button" aria-pressed={effResolution === value} onclick={() => (resolution = value)}>{label}</button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">frame rate cap</span>
        <div class="seg" role="group" aria-label="Frame rate cap">
          {#each fpsOptions as [value, label]}
            <button type="button" aria-pressed={fps === value} onclick={() => (fps = value)}>{label}</button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">codec</span>
        <div class="seg" role="group" aria-label="Codec">
          {#each codecs as c}
            <button type="button" aria-pressed={codec === c} disabled={!canEncode(c)} onclick={() => (codec = c)}>{videoCodecLabel[c].replace(' / HEVC', '')}</button>
          {/each}
        </div>
        <p class="mono mt-1.5"><span class="text-chalk">{codecInfo[codec].label}.</span> {codecInfo[codec].note}</p>
        {#if encodable && codecs.some((c) => !canEncode(c))}
          <p class="mono mt-1">Not available in this browser: {codecs.filter((c) => !canEncode(c)).map((c) => videoCodecLabel[c].replace(' / HEVC', '')).join(', ')}.</p>
        {/if}
      </div>

      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={removeAudio} class="mt-1" />
        <span>Remove audio<span class="mono block">saves space for silent clips and screen recordings</span></span>
      </label>
    </fieldset>

    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if currentPlan && (current?.status !== 'done' || current.result?.key !== settingsKey)}
          <p class="mono">
            estimate for this video ·
            <span class="text-chalk">{currentPlan.skip ? `already under ${targetMB} MB` : `~${formatBytes(currentPlan.estimateBytes)}`}</span>
            {#if !currentPlan.skip}<br />{currentPlan.width}×{currentPlan.height}{#if currentPlan.autoSide} (auto){/if}{#if currentPlan.fps} · {Math.round(currentPlan.fps)} fps{/if} · {formatBitrate(currentPlan.videoBitrate)}{#if currentPlan.audioBitrate} + {formatBitrate(currentPlan.audioBitrate)} audio{/if}{/if}
          </p>
          {#if !currentPlan.feasible && !currentPlan.skip}
            <p class="mono text-bad">{targetMB} MB is very tight for {formatTime(current!.info!.durationSec, 0)} of video, so it will come out bigger. Trim it first or pick a larger target.</p>
          {/if}
        {/if}
        {#if !validTarget}<p class="mono text-bad">Enter a target size above 0 MB.</p>{/if}
        {#if finished.length}
          <p class="mono">
            {finished.length}/{items.length} done · {formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span>
            {#if totals.before > totals.after}<span class="text-ok"> −{pct(totals.before, totals.after)}%</span>{/if}
          </p>
        {/if}

        {#if running}
          <p class="mono">compressing {batch.index} of {batch.total}…</p>
          <button type="button" class="btn" onclick={cancel}>Cancel</button>
        {:else}
          <button type="button" class="btn btn-primary" disabled={!pending.length || !validTarget} onclick={compressAll}>
            {pending.length ? `Compress ${pending.length === 1 ? 'video' : `${pending.length} videos`}` : finished.length ? 'All done' : 'Compress'}
          </button>
        {/if}
        {#if finished.length > 1}
          <button type="button" class="btn" disabled={running || zipping} onclick={downloadAll}>{zipping ? 'Zipping…' : `Download all (${finished.length}) as .zip`}</button>
        {/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<style>
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    &:disabled {
      opacity: 0.6;
    }
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .notice {
    display: grid;
    gap: 10px;
    justify-items: start;
    padding: 14px 16px;
    border: 1px solid #ffd25e55;
    border-radius: 14px;
    background: #ffd25e0d;
  }
  .stage {
    display: grid;
    gap: 14px;
    padding: 14px;
  }
  .players {
    display: grid;
    gap: 12px;
    &.two {
      @media (min-width: 640px) {
        grid-template-columns: 1fr 1fr;
      }
    }
  }
  figure {
    display: grid;
    gap: 6px;
    margin: 0;
    min-width: 0;
  }
  figcaption {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  video {
    width: 100%;
    max-height: 420px;
    border-radius: 12px;
    background: #0b0a09;
  }
  .noplay {
    display: grid;
    place-items: center;
    min-height: 180px;
    padding: 16px;
    text-align: center;
    border: 1px dashed var(--color-line-2);
    border-radius: 12px;
  }
  .bar {
    height: 8px;
    width: 100%;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
  }
  .fill {
    height: 100%;
    background: var(--color-sun);
    transform-origin: left;
    transition: transform 0.35s linear;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .check {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-ok);
    color: var(--color-bg);
    font-weight: 700;
    animation: pop 0.5s var(--ease-spring) both;
  }
  .sizes {
    display: grid;
    gap: 4px;
    & div {
      height: 6px;
      border-radius: 99px;
      transform-origin: left;
    }
  }
  .before {
    background: var(--color-line-2);
  }
  .after {
    background: var(--color-ok);
    animation: shrink 0.9s 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .kept {
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--color-panel-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  .row.sel {
    border-color: var(--color-sun);
  }
  .thumb {
    display: grid;
    place-items: center;
    flex: none;
    width: 64px;
    height: 44px;
    border-radius: 10px;
    overflow: hidden;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: var(--color-muted);
    background: var(--color-panel-2);
    & video {
      width: 100%;
      height: 100%;
      max-height: none;
      object-fit: cover;
      border-radius: 0;
      pointer-events: none;
    }
  }
  .working {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @keyframes shrink {
    from {
      transform: scaleX(calc(1 / var(--r)));
    }
  }
</style>
