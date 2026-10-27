<script lang="ts">
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { capabilities, ensureDecodable, FALLBACK_DOWNLOAD_MB, MediaError, preloadFallback, probe, type Capabilities, type MediaInfo } from '@/engines/media';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { clock, errorMessage, level, signed } from '@/tools/lib/loudness/format';
  import type { Loudness } from '@/tools/lib/loudness/lufs';
  import { ACCEPT, AUDIO_FORMATS, DEFAULT_SETTINGS, FORMAT_LABEL, formatSupport, planGain, sameAudioFormat, TARGETS, type AudioFormat, type NormalizeSettings, type OutputFormat } from '@/tools/lib/loudness/presets';
  import type { Rendered } from '@/tools/lib/loudness/process';
  import LoudnessProgress from './LoudnessProgress.svelte';

  type Status = 'probing' | 'needs-decoder' | 'converting' | 'to-measure' | 'measuring' | 'ready' | 'queued' | 'working' | 'done' | 'error';

  interface Item {
    id: number;
    file: File;
    info?: MediaInfo;
    /** what we decode: the file itself, or its converted copy for odd formats */
    source?: Blob;
    status: Status;
    progress: number;
    measured?: Loudness;
    /** `key` is the settings it was made with, so changed settings can be spotted */
    result?: Rendered & { url: string; key: string; gainDb: number };
    error?: string;
  }

  let items = $state<Item[]>([]);
  let settings = $state<NormalizeSettings>({ ...DEFAULT_SETTINGS });
  let format = $state<'same' | AudioFormat>('same');
  let caps = $state<Capabilities | null>(null);
  let decoderAllowed = $state(false);
  let run = $state<{ ids: number[]; startedAt: number } | null>(null);
  let status = $state('');
  let selectedId = $state<number | null>(null);
  let zipping = $state(false);
  let announce = $state('');
  let nextId = 0;
  let running = false;
  let destroyed = false;
  /** the one job in flight, so cancelling or removing a file aborts only its own job */
  let active: { id: number; ctrl: AbortController } | null = null;
  let fallback: Promise<void> | null = null;
  let lib: Promise<typeof import('@/tools/lib/loudness/process')> | undefined;

  $effect(() => {
    capabilities().then((c) => (caps = c), () => {});
  });

  function add(files: File[]) {
    for (const file of files) items.push({ id: nextId++, file, status: 'probing', progress: 0 });
    void pump();
  }

  // one job at a time: decoded audio is big, and the engine shares one worker anyway
  async function pump() {
    if (running) return;
    running = true;
    try {
      for (let item = next(); item && !destroyed; item = next()) {
        await step(item);
        finishRun();
      }
    } finally {
      running = false;
    }
  }

  const next = () =>
    items.find((i) => i.status === 'probing') ??
    (decoderAllowed ? items.find((i) => i.status === 'needs-decoder') : undefined) ??
    items.find((i) => i.status === 'to-measure') ??
    items.find((i) => i.status === 'queued');

  async function step(item: Item) {
    const job = new AbortController();
    active = { id: item.id, ctrl: job };
    const { signal } = job;
    try {
      if (item.status === 'probing') {
        const info = await probe(item.file, { signal });
        if (info.readable && !info.audio) throw new MediaError('no-tracks', 'This file has no audio.');
        item.info = info;
        item.source = info.needsFallback ? undefined : item.file;
        item.status = info.needsFallback ? 'needs-decoder' : 'to-measure';
      } else if (item.status === 'needs-decoder') {
        item.status = 'converting';
        item.progress = 0;
        await (fallback ??= preloadFallback((p) => (item.progress = 0.5 * p)));
        const c = await ensureDecodable(item.file, { signal, onProgress: (p) => (item.progress = 0.5 + 0.5 * p) });
        if (!c.info.audio) throw new MediaError('no-tracks', 'This file has no audio.');
        // keep the original container so a normalized AVI comes back as MP4, not our temporary MKV
        item.info = { ...c.info, container: item.info!.container };
        item.source = c.file;
        item.status = 'to-measure';
      } else if (item.status === 'to-measure') {
        item.status = 'measuring';
        item.progress = 0;
        const { analyze } = await (lib ??= import('@/tools/lib/loudness/process'));
        item.measured = await analyze(item.source!, { signal, onProgress: (p) => (item.progress = p) });
        item.status = 'ready';
      } else if (item.status === 'queued') {
        await normalize(item, signal);
      }
    } catch (e) {
      if (signal.aborted) {
        // put the file back in line so a later pass picks it up again
        if (item.status === 'measuring') item.status = 'to-measure';
        else if (item.status === 'converting') item.status = 'needs-decoder';
        else if (item.status === 'working') item.status = item.result ? 'done' : 'ready';
        return;
      }
      fallback = null;
      item.status = 'error';
      item.error = errorMessage(e) ?? 'Cancelled.';
    } finally {
      if (active?.ctrl === job) active = null;
    }
  }

  async function normalize(item: Item, signal: AbortSignal) {
    const key = settingsKey;
    const plan = planGain(item.measured!, settings);
    item.status = 'working';
    item.progress = 0;
    const { render } = await (lib ??= import('@/tools/lib/loudness/process'));
    const r = await render(
      item.source!,
      item.file.name,
      item.info!,
      { format: outputFor(item.info!), gainDb: plan.gainDb, ceilingDb: settings.ceilingDb, limit: plan.limited, suffix: '-normalized', measureAfter: true },
      { signal, onProgress: (p) => (item.progress = p), onStatus: (s) => (status = s) },
    );
    if (signal.aborted) return;
    if (item.result) URL.revokeObjectURL(item.result.url);
    item.result = { ...r, url: URL.createObjectURL(r.blob), key, gainDb: plan.gainDb };
    item.status = 'done';
    selectedId ??= item.id;
  }

  function finishRun() {
    if (!run || run.ids.some((id) => ['queued', 'working'].includes(items.find((i) => i.id === id)?.status ?? ''))) return;
    const ok = run.ids.filter((id) => items.find((i) => i.id === id)?.status === 'done').length;
    announce = `Normalized ${ok} of ${run.ids.length} file${run.ids.length === 1 ? '' : 's'}.`;
    run = null;
  }

  function outputFor(info: MediaInfo): OutputFormat {
    if (info.video) return 'video';
    const f = format === 'same' ? sameAudioFormat(info.container) : format;
    return formatSupport(f, caps, FALLBACK_DOWNLOAD_MB).ok ? f : 'mp3';
  }

  function normalizeAll() {
    const ids = pending.map((i) => i.id);
    for (const item of pending) item.status = 'queued';
    run = { ids, startedAt: performance.now() };
    status = '';
    void pump();
  }

  function cancelRun() {
    // files added mid-run may be measuring right now; leave those running
    const busy = active && items.find((i) => i.id === active!.id);
    if (busy?.status === 'working') active!.ctrl.abort();
    for (const item of items) if (item.status === 'queued' || item.status === 'working') item.status = item.result ? 'done' : 'ready';
    run = null;
    void pump();
  }

  function allowDecoder() {
    decoderAllowed = true;
    void pump();
  }

  function remove(item: Item) {
    if (active?.id === item.id) active.ctrl.abort();
    if (item.result) URL.revokeObjectURL(item.result.url);
    items.splice(items.indexOf(item), 1);
    if (selectedId === item.id) selectedId = null;
    if (run) run.ids = run.ids.filter((id) => id !== item.id);
    void pump();
  }

  function clear() {
    for (const item of [...items]) remove(item);
    run = null;
  }

  async function downloadAll() {
    if (fresh.length === 1) return downloadBlob(fresh[0].result!.blob, fresh[0].result!.name);
    zipping = true;
    try {
      downloadBlob(await zipFiles(fresh.map((i) => ({ name: i.result!.name, blob: i.result!.blob }))), 'normalized-audio.zip');
    } finally {
      zipping = false;
    }
  }

  $effect(() => () => {
    destroyed = true;
    active?.ctrl.abort();
    for (const item of items) if (item.result) URL.revokeObjectURL(item.result.url);
  });

  // ---------------------------------------------------------------- derived

  const settingsKey = $derived(JSON.stringify([settings, format]));
  const stale = (i: Item) => !!i.result && i.result.key !== settingsKey;
  const pending = $derived(items.filter((i) => i.measured && (i.status === 'ready' || (i.status === 'done' && stale(i))) && !planGain(i.measured, settings).silent));
  const fresh = $derived(items.filter((i) => i.status === 'done' && !stale(i)));
  const waitingForDecoder = $derived(items.filter((i) => i.status === 'needs-decoder').length);
  const runProgress = $derived.by(() => {
    if (!run?.ids.length) return 0;
    let sum = 0;
    for (const id of run.ids) {
      const i = items.find((x) => x.id === id);
      sum += i?.status === 'done' ? 1 : i?.status === 'working' ? i.progress : 0;
    }
    return sum / run.ids.length;
  });
  const runIndex = $derived(run ? run.ids.findIndex((id) => items.find((i) => i.id === id)?.status === 'working') + 1 : 0);
  const selected = $derived(items.find((i) => i.id === selectedId && i.result));

  // the original, for A/B listening against the result
  let beforeUrl = $state('');
  $effect(() => {
    const src = selected?.source;
    if (!src) return;
    const url = URL.createObjectURL(src);
    beforeUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  const outputNote = $derived.by(() => {
    if (format !== 'same') return formatSupport(format, caps, FALLBACK_DOWNLOAD_MB).note ?? 'videos keep their picture and format';
    // FLAC stays FLAC, and without a native encoder that means the one-time ffmpeg download
    const flac = items.some((i) => !i.info?.video && i.info?.container === 'flac') && formatSupport('flac', caps, FALLBACK_DOWNLOAD_MB).note;
    return `each file keeps its format; videos keep their picture${flac ? ` · ${flac}` : ''}`;
  });
  /** reasons for the disabled buttons, since a title tooltip never shows on touch screens */
  const unavailable = $derived(caps ? AUDIO_FORMATS.map((f) => formatSupport(f, caps, FALLBACK_DOWNLOAD_MB)).filter((s) => !s.ok).map((s) => s.note!) : []);
  const ceilings = [-2, -1, -0.1];
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if items.length === 0}
      <Dropzone accept={ACCEPT} multiple title="Drop audio or video files" hint="one or a whole batch · MP3, WAV, M4A, MP4…" onfiles={add} />
    {:else}
      {#if waitingForDecoder}
        <div class="panel grid gap-3">
          <p class="text-sm">
            {waitingForDecoder === 1 ? 'One file is' : `${waitingForDecoder} files are`} in a format your browser can't open on its own. Rounder can convert
            {waitingForDecoder === 1 ? 'it' : 'them'} on your device with a one-time {FALLBACK_DOWNLOAD_MB} MB decoder download.
          </p>
          <div><button type="button" class="btn btn-primary" onclick={allowDecoder} disabled={decoderAllowed}>Download decoder ({FALLBACK_DOWNLOAD_MB} MB)</button></div>
        </div>
      {/if}

      <ul class="grid gap-2" aria-label="Files">
        {#each items as item (item.id)}
          {@const m = item.measured}
          {@const plan = m ? planGain(m, settings) : null}
          {@const r = item.result}
          <li class="row" class:picked={selectedId === item.id && r}>
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-2 text-sm">
                <span class="truncate">{item.file.name}</span>
                {#if item.info?.video}<span class="badge">video</span>{/if}
              </p>
              <p class="mono">
                {#if item.status === 'error'}
                  <span class="text-bad">{item.error}</span>
                {:else if item.status === 'probing'}
                  reading…
                {:else if item.status === 'needs-decoder'}
                  needs the extra decoder · {formatBytes(item.file.size)}
                {:else if item.status === 'converting'}
                  <span class="text-sun">converting with the decoder…</span>
                {:else if item.status === 'to-measure' || item.status === 'measuring'}
                  <span class={item.status === 'measuring' ? 'text-sun' : ''}>{item.status === 'measuring' ? 'measuring loudness…' : 'waiting to measure…'}</span>
                {:else if m}
                  {clock(m.durationSec)} · <span class="text-chalk">{level(m.integrated)} LUFS</span> · peak {level(m.truePeak)} dBTP{m.range ? ` · range ${m.range.toFixed(0)} LU` : ''}
                {/if}
              </p>
              {#if plan && m && item.status !== 'error'}
                <p class="mono">
                  {#if plan.silent}
                    silent · left as it is
                  {:else if item.status === 'done' && r && !stale(item)}
                    <span class="text-ok">→ {r.after ? `${level(r.after.integrated)} LUFS · peak ${level(r.after.truePeak)} dBTP` : 'done'}</span>
                    · {signed(r.gainDb)} dB{r.reductionDb > 0.1 ? ` · limited ${r.reductionDb.toFixed(1)} dB` : ''} · {formatBytes(r.blob.size)}
                  {:else}
                    plan: {signed(plan.gainDb)} dB{plan.limited ? ' + limiter' : ''}{plan.shortBy > 0.05 ? ` · ${plan.shortBy.toFixed(1)} LU short (limiter off)` : ''}{stale(item) ? ' · settings changed' : ''}
                  {/if}
                </p>
              {/if}
              {#if ['converting', 'measuring', 'working'].includes(item.status)}
                <div class="track" role="progressbar" aria-label={`Processing ${item.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(item.progress * 100)}>
                  <span class="fill" style:transform={`scaleX(${item.progress})`}></span>
                </div>
              {/if}
            </div>
            {#if r && !stale(item)}
              <button type="button" class="btn px-3! py-2! text-sm!" aria-pressed={selectedId === item.id} onclick={() => (selectedId = item.id)} aria-label={`Compare before and after for ${item.file.name}`}>A/B</button>
              <button type="button" class="btn px-3! py-2!" onclick={() => downloadBlob(r.blob, r.name)} aria-label={`Download ${r.name}`}>↓</button>
            {/if}
            <button type="button" class="btn px-3! py-2!" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
          </li>
        {/each}
      </ul>

      {#if selected?.result}
        {@const r = selected.result}
        <div class="panel grid gap-3 sm:grid-cols-2">
          {#each [{ label: 'before', url: beforeUrl, lufs: selected.measured?.integrated }, { label: 'after', url: r.url, lufs: r.after?.integrated }] as ab (ab.label)}
            <div class="grid min-w-0 content-start gap-2">
              <span class="label mb-0!">{ab.label}{ab.lufs === undefined ? '' : ` · ${level(ab.lufs)} LUFS`}</span>
              {#if ab.url}
                {#if selected.info?.video}
                  <video src={ab.url} controls playsinline class="media"><track kind="captions" /></video>
                {:else}
                  <audio src={ab.url} controls class="w-full"></audio>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <Dropzone accept={ACCEPT} multiple title="Add more files" hint="or click to choose" paste={false} onfiles={add} />
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    <div>
      <span class="label" id="target-label">normalize for</span>
      <div class="grid gap-2" role="group" aria-labelledby="target-label">
        {#each TARGETS as t (t.id)}
          <button type="button" class="level" aria-pressed={settings.target === t.id} onclick={() => (settings.target = t.id)}>
            <span class="text-[15px]">{t.name}</span>
            <span class="mono">{t.hint}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if settings.target === 'custom'}
      <label>
        <span class="label">target · {level(settings.customLufs)} LUFS</span>
        <input type="range" min="-36" max="-6" step="0.5" bind:value={settings.customLufs} class="w-full accent-(--color-sun)" />
        <span class="mono flex justify-between"><span>quieter</span><span>louder</span></span>
      </label>
    {/if}

    <div>
      <span class="label" id="ceiling-label">{settings.target === 'peak' ? 'peak level (dBFS)' : 'true-peak ceiling (dBTP)'}</span>
      <div class="seg" role="group" aria-labelledby="ceiling-label">
        {#each ceilings as c (c)}
          <button type="button" aria-pressed={settings.ceilingDb === c} onclick={() => (settings.ceilingDb = c)}>{level(c, c === -0.1 ? 1 : 0)}</button>
        {/each}
      </div>
    </div>

    {#if settings.target !== 'peak'}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" bind:checked={settings.limit} class="mt-1" />
        <span>Limit peaks to reach the target<span class="mono block">off: files with loud peaks stop short of the target instead</span></span>
      </label>
    {/if}

    <div>
      <span class="label" id="out-label">save audio as</span>
      <div class="seg" role="group" aria-labelledby="out-label">
        <button type="button" aria-pressed={format === 'same'} onclick={() => (format = 'same')}>same</button>
        {#each AUDIO_FORMATS as f (f)}
          {@const s = formatSupport(f, caps, FALLBACK_DOWNLOAD_MB)}
          <button type="button" aria-pressed={format === f} disabled={!s.ok} title={s.note} onclick={() => (format = f)}>{FORMAT_LABEL[f]}</button>
        {/each}
      </div>
      <p class="mono mt-2">{outputNote}</p>
      {#each unavailable as note (note)}<p class="mono">{note}</p>{/each}
    </div>

    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if run}
          <LoudnessProgress
            progress={runProgress}
            status={runIndex ? `File ${runIndex} of ${run.ids.length} · ${status}` : 'Waiting…'}
            startedAt={run.startedAt}
            label="Normalizing"
            oncancel={cancelRun}
          />
        {:else}
          {#if fresh.length && !pending.length}
            <p class="done mono"><span class="check" aria-hidden="true">✓</span> {fresh.length} file{fresh.length === 1 ? '' : 's'} normalized</p>
          {/if}
          <button type="button" class="btn btn-primary" disabled={!pending.length} onclick={normalizeAll}>
            {pending.length ? `Normalize ${pending.length} file${pending.length === 1 ? '' : 's'}` : items.some((i) => i.status === 'measuring' || i.status === 'to-measure') ? 'Measuring…' : 'Normalize'}
          </button>
        {/if}
        <button type="button" class="btn" disabled={!fresh.length || zipping || !!run} onclick={downloadAll}>
          {zipping ? 'Zipping…' : fresh.length > 1 ? `Download all (${fresh.length}) as .zip` : 'Download'}
        </button>
        <button type="button" class="btn" onclick={clear}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<p class="sr-only" aria-live="polite">{announce}</p>

<style>
  .panel {
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: #141312;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    transition: border-color 0.2s;
    &.picked {
      border-color: var(--color-sun);
    }
  }
  .badge {
    flex: none;
    font: 400 10.5px var(--font-mono);
    padding: 1px 6px;
    border-radius: 6px;
    color: var(--color-video);
    background: #ff6b4a1f;
  }
  .media {
    width: 100%;
    max-height: 280px;
    border-radius: 10px;
    background: #000;
  }
  .track {
    height: 4px;
    margin-top: 8px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    transform-origin: left;
    background: var(--color-sun);
    transition: transform 0.3s ease-out;
  }
  .level {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-sun);
      background: #ffd25e12;
      & .mono {
        color: var(--color-soft);
      }
    }
  }
  .seg :global(button:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-ok);
    animation: rise 0.5s ease-out both;
  }
  .check {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
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
