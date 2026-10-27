<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import {
    capabilities,
    downloadName,
    FALLBACK_DOWNLOAD_MB,
    formatTime,
    isAbort,
    MediaError,
    probe,
    transcode,
    type Capabilities,
    type MediaInfo,
  } from '@/engines/media';
  import { downloadResult, formatBytes, zipFiles } from '@/tools/lib/files';
  import {
    acceptFor,
    batchProgress,
    bitrateChoices,
    bitrateHint,
    defaultBitrate,
    describeAudio,
    dropTitle,
    estimateBytes,
    etaSeconds,
    formatInfo,
    formatRate,
    friendlyError,
    isLossless,
    outFormats,
    planFormat,
    sampleRateChoices,
    shortDuration,
    transcodeOptions,
    type OutFormat,
    type SourceFormat,
    type WavDepth,
  } from '@/tools/lib/audio-converter/formats';

  let { from, to = 'mp3' }: { from?: SourceFormat; to?: OutFormat } = $props();

  interface Output {
    blob: Blob;
    url: string;
    name: string;
    /** settings it was made with, to spot stale results */
    key: string;
    notes: string[];
    playable: boolean;
  }

  interface Item {
    id: number;
    file: File;
    url: string;
    info?: MediaInfo;
    status: 'probing' | 'ready' | 'queued' | 'working' | 'done' | 'error';
    progress: number;
    error?: string;
    /** can't be converted at all (no audio, unreadable) */
    fatal?: boolean;
    playable: boolean;
    out?: Output;
  }

  // the page's target format is only the starting choice
  const initial = untrack(() => to);
  let format = $state<OutFormat>(initial);
  let depth = $state<WavDepth>('pcm-s16');
  let bitrate = $state(defaultBitrate(planFormat(initial, null).codec));
  let sampleRate = $state(0);
  let channels = $state<0 | 1 | 2>(0);
  let keepMetadata = $state(true);
  let caps = $state<Capabilities | null>(null);

  let items = $state<Item[]>([]);
  let selected = $state<number | null>(null);
  let nextId = 0;

  let running = $state(false);
  let batch = $state<number[]>([]);
  let elapsed = $state(0);
  let stage = $state('');
  let askDecoder = $state(false);
  let decoderOk = $state(false);
  let finished = $state(false);
  let zipping = $state(false);
  let zipError = $state('');
  let ctrl: AbortController | null = null;

  const plan = $derived(planFormat(format, caps, depth));
  const rates = $derived(bitrateChoices(plan.codec));
  const sampleRates = $derived(sampleRateChoices(plan.codec));
  const settings = $derived({ format, bitrate, depth, sampleRate, channels, keepMetadata });
  const options = $derived(transcodeOptions(settings, plan.codec));
  const key = $derived(JSON.stringify(options));

  // keep choices valid when the codec changes (e.g. OGG turns out to be Vorbis in this browser)
  $effect(() => {
    const codec = plan.codec;
    untrack(() => {
      const list = bitrateChoices(codec);
      if (list.length && !list.includes(bitrate)) bitrate = defaultBitrate(codec);
      if (!sampleRateChoices(codec).includes(sampleRate)) sampleRate = 0;
    });
  });

  $effect(() => {
    if (caps && !plan.available) format = 'mp3';
  });

  function pick(f: OutFormat) {
    if (f === format) return;
    format = f;
    bitrate = defaultBitrate(planFormat(f, caps, depth).codec);
  }

  const needsDecoder = (i: Item) => !!i.info?.needsFallback || plan.viaFallback;
  const convertible = (i: Item) =>
    i.status === 'ready' || (i.status === 'error' && !i.fatal) || (i.status === 'done' && i.out?.key !== key);

  function add(files: File[]) {
    finished = false;
    for (const file of files) {
      items.push({ id: nextId++, file, url: URL.createObjectURL(file), status: 'probing', progress: 0, playable: true });
      const item = items[items.length - 1];
      selected ??= item.id;
      probe(file)
        .then((info) => {
          item.info = info;
          if (item.status !== 'probing') return;
          if (info.readable && !info.audio) fail(item, 'This file has no audio track to convert.');
          else item.status = 'ready';
        })
        .catch((e) => fail(item, friendlyError(e instanceof MediaError ? e.code : undefined, e?.message)));
    }
  }

  function fail(item: Item, message: string) {
    item.status = 'error';
    item.fatal = true;
    item.error = message;
  }

  function setOutput(item: Item, blob: Blob, notes: string[], container: OutFormat, runKey: string) {
    if (item.out) URL.revokeObjectURL(item.out.url);
    item.out = { blob, url: URL.createObjectURL(blob), name: downloadName(item.file.name, container), key: runKey, notes, playable: true };
  }

  async function convert(decoder: 'ask' | 'allow' | 'skip' = 'ask') {
    askDecoder = false;
    if (decoder === 'allow') decoderOk = true;
    // whether FLAC needs the ffmpeg download is only known once capabilities are in
    caps ??= await capabilities().catch(() => null);
    let todo = items.filter(convertible);
    const blocked = decoderOk ? [] : todo.filter(needsDecoder);
    if (blocked.length && decoder === 'ask') {
      askDecoder = true;
      return;
    }
    for (const i of blocked) {
      i.status = 'error';
      i.error = `Skipped: needs the ${FALLBACK_DOWNLOAD_MB} MB extra converter.`;
    }
    todo = todo.filter((i) => !blocked.includes(i));
    if (!todo.length) return;

    const opts = options;
    const runKey = key;
    ctrl = new AbortController();
    const { signal } = ctrl;
    running = true;
    finished = false;
    stage = '';
    batch = todo.map((i) => i.id);
    for (const i of todo) {
      i.status = 'queued';
      i.progress = 0;
    }
    const startedAt = performance.now();
    elapsed = 0;
    const tick = setInterval(() => (elapsed = (performance.now() - startedAt) / 1000), 250);
    try {
      for (const item of todo) {
        if (signal.aborted) break;
        if (!items.includes(item)) continue;
        item.status = 'working';
        stage = '';
        try {
          const out = await transcode(item.file, opts, {
            signal,
            onProgress: (p) => (item.progress = p),
            onStatus: (s) => (stage = s),
          });
          // removed (or Start over) while it was converting: don't create a URL nobody revokes
          if (!items.includes(item)) continue;
          setOutput(item, out.blob, out.notes, opts.container as OutFormat, runKey);
          item.status = 'done';
          item.progress = 1;
          item.error = undefined;
        } catch (e) {
          if (isAbort(e)) break;
          console.error(e);
          item.status = 'error';
          item.error = friendlyError(e instanceof MediaError ? e.code : undefined, (e as Error)?.message ?? '');
        }
      }
    } finally {
      clearInterval(tick);
      // after Start over a newer run may own the shared state; leave it alone
      if (ctrl?.signal === signal) {
        for (const i of items) if (i.status === 'queued' || i.status === 'working') i.status = i.out ? 'done' : 'ready';
        finished = !signal.aborted;
        running = false;
        ctrl = null;
      }
    }
  }

  function cancel() {
    ctrl?.abort();
  }

  function release(item: Item) {
    URL.revokeObjectURL(item.url);
    if (item.out) URL.revokeObjectURL(item.out.url);
  }

  function remove(item: Item) {
    release(item);
    items.splice(items.indexOf(item), 1);
    if (selected === item.id) selected = items[0]?.id ?? null;
  }

  function startOver() {
    ctrl?.abort();
    ctrl = null;
    running = false;
    for (const item of items) release(item);
    items = [];
    batch = [];
    selected = null;
    finished = false;
    askDecoder = false;
    zipError = '';
  }

  async function downloadAll() {
    const ready = items.filter((i) => i.out);
    if (ready.length === 1) return downloadResult(ready[0].out!.blob, ready[0].out!.name);
    const exts = new Set(ready.map((i) => ext(i.out!.name).toLowerCase()));
    zipping = true;
    zipError = '';
    try {
      downloadResult(await zipFiles(ready.map((i) => ({ name: i.out!.name, blob: i.out!.blob }))), `converted-${exts.size === 1 ? [...exts][0] : 'audio'}.zip`);
    } catch (e) {
      console.error(e);
      zipError = "Couldn't build the zip; the files may be too big to hold in memory at once. Download them one at a time with the ↓ buttons.";
    } finally {
      zipping = false;
    }
  }

  onMount(() => {
    capabilities()
      .then((c) => (caps = c))
      .catch(() => {});
    return () => {
      ctrl?.abort();
      for (const item of items) release(item);
    };
  });

  const current = $derived(items.find((i) => i.id === selected));
  const pending = $derived(items.filter(convertible));
  const probing = $derived(items.some((i) => i.status === 'probing'));
  const outputs = $derived(items.filter((i) => i.out));
  const stale = $derived(outputs.some((i) => i.out!.key !== key));
  const blockedCount = $derived(decoderOk ? 0 : pending.filter(needsDecoder).length);
  const overall = $derived(
    batchProgress(
      items
        .filter((i) => batch.includes(i.id))
        .map((i) => ({
          weight: i.info?.durationSec || 1,
          progress: i.status === 'working' ? i.progress : i.status === 'queued' || i.status === 'ready' ? 0 : 1,
        })),
    ),
  );
  const eta = $derived(etaSeconds(elapsed, overall));
  const position = $derived.by(() => {
    const at = batch.findIndex((id) => items.find((i) => i.id === id)?.status === 'working');
    return at < 0 ? null : `file ${at + 1} of ${batch.length}`;
  });
  const totals = $derived({
    before: outputs.reduce((s, i) => s + i.file.size, 0),
    after: outputs.reduce((s, i) => s + i.out!.blob.size, 0),
  });

  function change(before: number, after: number) {
    const pct = Math.round((1 - after / before) * 100);
    return pct >= 0 ? { text: `−${pct}%`, smaller: true } : { text: `+${-pct}%`, smaller: false };
  }

  const ext = (name: string) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? '?').toUpperCase();
  const kbps = (bps: number) => `${bps / 1000}`;
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if items.length === 0}
      <Dropzone accept={acceptFor(from)} multiple title={dropTitle(from)} hint="or click to choose · batches welcome" onfiles={add} />
    {:else}
      {#if current}
        <section class="preview" aria-label="Preview">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3">
            <p class="min-w-0 truncate text-sm">{current.file.name}</p>
            {#if current.info?.durationSec}<span class="mono">{formatTime(current.info.durationSec, 0)}</span>{/if}
          </div>
          <p class="mono">
            {current.info ? describeAudio(current.info) : 'reading…'} · {formatBytes(current.file.size)}
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <span class="label">original</span>
              {#if current.playable}
                <audio controls preload="metadata" src={current.url} onerror={() => (current.playable = false)}></audio>
              {:else}
                <p class="mono">Your browser can't play this format, but it can still convert it.</p>
              {/if}
            </div>
            {#if current.out}
              <div>
                <span class="label">converted · {formatBytes(current.out.blob.size)}</span>
                {#if current.out.playable}
                  <audio controls preload="metadata" src={current.out.url} onerror={() => current.out && (current.out.playable = false)}></audio>
                {:else}
                  <p class="mono">Your browser can't play {ext(current.out.name)} itself; the file is fine to download.</p>
                {/if}
              </div>
            {/if}
          </div>
          {#each current.out?.notes ?? [] as note}<p class="mono">{note}</p>{/each}
        </section>
      {/if}

      <ul class="grid gap-2" aria-label="Files">
        {#each items as item (item.id)}
          {@const est = item.info && plan.available ? estimateBytes(item.info, settings, plan.codec) : null}
          <li class="row" class:sel={item.id === selected}>
            <button type="button" class="pick" onclick={() => (selected = item.id)} aria-label={`Preview ${item.file.name}`} aria-pressed={item.id === selected}>
              <span class="chips" aria-hidden="true">
                <span class="chip">{ext(item.file.name)}</span>
                {#if item.out}<span class="chip out">{ext(item.out.name)}</span>{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm">{item.out?.name ?? item.file.name}</span>
                <span class="mono block">
                  {#if item.status === 'probing'}
                    <span class="working">reading…</span> {formatBytes(item.file.size)}
                  {:else if item.status === 'error'}
                    <span class="text-bad">{item.error}</span>
                  {:else if item.out && (item.status === 'done' || !running)}
                    {@const c = change(item.file.size, item.out.blob.size)}
                    {formatBytes(item.file.size)} → <span class="text-chalk">{formatBytes(item.out.blob.size)}</span>
                    <span class={c.smaller ? 'text-ok' : ''}>{c.text}</span>
                    {#if item.out.key !== key}· <span class="text-sun">made with other settings</span>{/if}
                  {:else}
                    {#if item.info?.durationSec}{formatTime(item.info.durationSec, 0)} ·{/if}
                    {formatBytes(item.file.size)}
                    {#if est}→ ≈ {formatBytes(est)}{/if}
                    {#if item.status === 'working'}· <span class="working">{Math.round(item.progress * 100)}%</span>
                    {:else if item.status === 'queued'}· waiting{/if}
                  {/if}
                </span>
                {#if item.info?.needsFallback && item.status !== 'done' && !item.fatal}
                  <span class="mono block text-sun">Your browser can't read this format by itself; it needs a one-time {FALLBACK_DOWNLOAD_MB} MB extra converter.</span>
                {/if}
              </span>
            </button>
            {#if item.out}
              <button type="button" class="btn icon" onclick={() => downloadResult(item.out!.blob, item.out!.name)} aria-label={`Download ${item.out.name}`}>↓</button>
            {/if}
            <button type="button" class="btn icon" disabled={item.status === 'working'} onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
            {#if item.status === 'working' || item.status === 'queued'}
              <span class="bar" aria-hidden="true"><span style:transform={`scaleX(${item.progress})`}></span></span>
            {/if}
          </li>
        {/each}
      </ul>
      <Dropzone accept={acceptFor(from)} multiple title="Add more" hint="drop or click to choose" onfiles={add} />
    {/if}
  </div>

  <aside class="grid content-start gap-5">
    <div>
      <span class="label">convert to</span>
      <div class="seg" role="group" aria-label="Output format">
        {#each outFormats as f}
          {@const p = planFormat(f, caps, depth)}
          <button type="button" aria-pressed={format === f} disabled={!p.available} title={p.reason} onclick={() => pick(f)}>{formatInfo[f].label}</button>
        {/each}
      </div>
      <span class="mono mt-1.5 block">
        {formatInfo[format].blurb}{#if format === 'ogg'} · {plan.codec === 'opus' ? 'Opus' : 'Vorbis'} codec{/if}
      </span>
      {#each outFormats.map((f) => planFormat(f, caps, depth)).filter((p) => !p.available) as p}
        <span class="mono mt-1 block">{p.reason}</span>
      {/each}
      {#if plan.viaFallback}
        <span class="mono mt-1 block text-sun">FLAC isn't built into browsers yet, so it needs a one-time {FALLBACK_DOWNLOAD_MB} MB extra converter. We'll ask first.</span>
      {/if}
    </div>

    {#if rates.length}
      <div>
        <span class="label">quality · {kbps(bitrate)} kbps</span>
        <div class="seg" role="group" aria-label="Bitrate">
          {#each rates as r}
            <button type="button" aria-pressed={bitrate === r} onclick={() => (bitrate = r)}>{kbps(r)}</button>
          {/each}
        </div>
        <span class="mono mt-1.5 block">{bitrateHint(plan.codec, bitrate)}</span>
      </div>
    {:else if format === 'wav'}
      <div>
        <span class="label">bit depth</span>
        <div class="seg" role="group" aria-label="Bit depth">
          <button type="button" aria-pressed={depth === 'pcm-s16'} onclick={() => (depth = 'pcm-s16')}>16-bit</button>
          <button type="button" aria-pressed={depth === 'pcm-s24'} onclick={() => (depth = 'pcm-s24')}>24-bit</button>
        </div>
        <span class="mono mt-1.5 block">{depth === 'pcm-s16' ? 'CD quality, opens everywhere' : 'for editing projects that expect 24-bit'}</span>
      </div>
    {:else if isLossless(plan.codec)}
      <p class="mono">Lossless: sounds exactly like the source, so there's no quality setting.</p>
    {/if}

    <div>
      <span class="label">sample rate</span>
      {#if sampleRates.length}
        <div class="seg" role="group" aria-label="Sample rate">
          {#each sampleRates as r}
            <button type="button" aria-pressed={sampleRate === r} onclick={() => (sampleRate = r)}>{r ? formatRate(r) : 'keep'}</button>
          {/each}
        </div>
      {:else}
        <span class="mono block">Opus always plays at 48 kHz.</span>
      {/if}
    </div>

    <div>
      <span class="label">channels</span>
      <div class="seg" role="group" aria-label="Channels">
        <button type="button" aria-pressed={channels === 0} onclick={() => (channels = 0)}>keep</button>
        <button type="button" aria-pressed={channels === 2} onclick={() => (channels = 2)}>stereo</button>
        <button type="button" aria-pressed={channels === 1} onclick={() => (channels = 1)}>mono</button>
      </div>
      <span class="mono mt-1.5 block">
        {channels === 1 ? 'fine for voice; halves the size of WAV' : channels === 0 && format === 'flac' ? 'FLAC keeps surround as it is' : 'surround is mixed down to stereo'}
      </span>
    </div>

    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={keepMetadata} class="mt-1 accent-(--color-sun)" />
      <span>Keep title, artist and album tags<span class="mono block">where the format can hold them</span></span>
    </label>

    {#if items.length}
      <div class="grid gap-2 border-t border-line pt-5">
        {#if running}
          <div
            class="meter"
            role="progressbar"
            aria-label="Conversion progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall * 100)}
          >
            <span style:transform={`scaleX(${overall})`}></span>
          </div>
          <p class="mono flex justify-between gap-2">
            <span class="text-chalk">{Math.round(overall * 100)}%</span>
            <span>{shortDuration(elapsed)} elapsed{#if eta !== null} · ~{shortDuration(eta)} left{/if}</span>
          </p>
          <p class="mono" aria-live="polite">{stage && stage !== 'Converting…' ? stage : (position ?? 'starting…')}</p>
          <button type="button" class="btn" onclick={cancel}>Cancel</button>
        {:else if askDecoder && blockedCount}
          <div class="ask" role="group" aria-label="Extra converter needed">
            <p class="text-sm">
              {blockedCount === pending.length ? (blockedCount === 1 ? 'This file needs' : 'These files need') : `${files(blockedCount)} need`}
              a one-time {FALLBACK_DOWNLOAD_MB} MB download of ffmpeg, an extra converter{plan.viaFallback ? ' for FLAC' : ' for formats your browser can’t read'}.
            </p>
            <p class="mono">It comes from this site, and everything still runs on your device.</p>
            <button type="button" class="btn btn-primary" onclick={() => convert('allow')}>Download it and convert</button>
            {#if blockedCount < pending.length}
              <button type="button" class="btn" onclick={() => convert('skip')}>Convert the other {files(pending.length - blockedCount)}</button>
            {/if}
            <button type="button" class="btn" onclick={() => (askDecoder = false)}>Not now</button>
          </div>
        {:else}
          {#if finished && outputs.length && !pending.length}
            <div class="done" role="status">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <span>{outputs.length === items.length ? (outputs.length === 1 ? 'Converted' : `All ${outputs.length} converted`) : `${outputs.length} of ${items.length} converted`}</span>
            </div>
          {/if}
          {#if pending.length || !outputs.length}
            <button type="button" class="btn btn-primary" disabled={!pending.length || probing || !plan.available} onclick={() => convert()}>
              {probing ? 'Reading files…' : stale ? `Convert again as ${formatInfo[format].label}` : `Convert ${files(pending.length)} to ${formatInfo[format].label}`}
            </button>
          {/if}
        {/if}

        {#if outputs.length && !running}
          <p class="mono">
            {files(outputs.length)} · {formatBytes(totals.before)} → <span class="text-chalk">{formatBytes(totals.after)}</span>
            {#if totals.before}{@const c = change(totals.before, totals.after)}<span class={c.smaller ? 'text-ok' : ''}> {c.text}</span>{/if}
          </p>
          <button type="button" class={pending.length ? 'btn' : 'btn btn-primary'} disabled={zipping} onclick={downloadAll}>
            {zipping ? 'Zipping…' : outputs.length > 1 ? `Download all (${outputs.length}) as .zip` : 'Download'}
          </button>
          {#if zipError}<p class="mono text-bad" role="alert">{zipError}</p>{/if}
        {/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    {/if}
  </aside>
</div>

<style>
  .preview {
    display: grid;
    gap: 10px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel);
  }
  audio {
    display: block;
    width: 100%;
    height: 40px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    overflow: hidden;
    transition: border-color 0.2s;
  }
  .row.sel {
    border-color: var(--color-sun);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    text-align: left;
    color: inherit;
    background: none;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  .chips {
    display: grid;
    gap: 4px;
    flex: none;
    width: 48px;
  }
  .chip {
    font: 500 11px/1 var(--font-mono);
    text-align: center;
    padding: 5px 0;
    border-radius: 7px;
    border: 1px solid var(--color-line-2);
    color: var(--color-soft);
  }
  .chip.out {
    color: var(--color-bg);
    background: var(--color-audio);
    border-color: var(--color-audio);
    animation: pop 0.4s var(--ease-spring);
  }
  .icon {
    flex: none;
    padding: 8px 12px;
  }
  .bar,
  .meter {
    display: block;
    overflow: hidden;
    background: var(--color-line);
  }
  .bar {
    position: absolute;
    inset: auto 0 0 0;
    height: 3px;
  }
  .meter {
    height: 6px;
    border-radius: 99px;
  }
  .bar span,
  .meter span {
    display: block;
    height: 100%;
    background: var(--color-sun);
    transform-origin: left;
    transition: transform 0.25s linear;
  }
  .working {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .ask {
    display: grid;
    gap: 8px;
    padding: 14px;
    border: 1px solid var(--color-sun);
    border-radius: 14px;
    background: #ffd25e0d;
  }
  .done {
    display: flex;
    align-items: center;
    gap: 10px;
    font: 400 24px/1.1 var(--font-serif);
    & svg {
      width: 30px;
      height: 30px;
      padding: 5px;
      border-radius: 99px;
      background: var(--color-ok);
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 24;
      animation: draw 0.5s 0.1s ease-out backwards;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 24;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>
