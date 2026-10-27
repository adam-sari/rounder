<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { FALLBACK_DOWNLOAD_MB, formatBytes, formatTime, isAbort, probe, type MediaInfo } from '@/engines/media';
  import { downloadBlob } from '@/tools/lib/files';
  import type { Analysis } from '@/tools/lib/music-analysis/analyzer';
  import { ClickTrack } from '@/tools/lib/music-analysis/click-track';
  import { analyzeFile } from '@/tools/lib/music-analysis/client';
  import { confidenceLevel, errorText, formatBpm, needsDecoder, roundBpm, toCsv, type Confidence } from '@/tools/lib/music-analysis/format';
  import { camelot, keyName, keyShort, relativeKey } from '@/tools/lib/music-analysis/key';
  import { addTap, tapRelation, tapTempo, TAP_RESET_MS } from '@/tools/lib/music-analysis/tap';
  import BpmBeats from './BpmBeats.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';

  interface Item {
    id: number;
    file: File;
    url: string;
    info?: MediaInfo;
    /** decoder: waiting for permission to download the ffmpeg fallback */
    status: 'probing' | 'decoder' | 'queued' | 'working' | 'stopped' | 'done' | 'error';
    progress: number;
    stage: string;
    startedAt: number;
    error?: string;
    result?: Analysis;
    playable: boolean;
  }

  const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.aif,.aiff,.wma,.mkv,.webm';

  let items = $state<Item[]>([]);
  let selectedId = $state<number | null>(null);
  let decoderOk = $state(false);
  let sortBy = $state<'added' | 'bpm' | 'camelot'>('added');
  let nextId = 0;
  let running = false;
  let ctrl: AbortController | null = null;

  let audio = $state<HTMLAudioElement | null>(null);
  let time = $state(0);
  let playing = $state(false);
  let clicksOn = $state(false);
  let clickTrack: ClickTrack | null = null;

  let taps = $state<number[]>([]);
  let tapCount = $state(0);

  const current = $derived(items.find((i) => i.id === selectedId));
  const done = $derived(items.filter((i) => i.result));
  const tap = $derived(tapTempo(taps));
  const sorted = $derived.by(() => {
    if (sortBy === 'added') return items;
    const value = (i: Item) => {
      if (sortBy === 'bpm') return i.result?.tempo?.bpm ?? Infinity;
      const k = i.result?.key;
      if (!k) return Infinity;
      const code = camelot(k);
      return parseInt(code) * 2 + (code.endsWith('B') ? 1 : 0);
    };
    return [...items].sort((a, b) => value(a) - value(b));
  });

  function add(files: File[]) {
    for (const file of files) {
      items.push({ id: nextId++, file, url: URL.createObjectURL(file), status: 'probing', progress: 0, stage: '', startedAt: 0, playable: true });
      const item = items[items.length - 1];
      if (selectedId === null) select(item.id);
      probe(file).then(
        (info) => {
          if (!items.includes(item)) return;
          item.info = info;
          if (info.readable && !info.audio) return fail(item, 'This file has no audio track to analyze.');
          item.status = needsDecoder(info) && !decoderOk ? 'decoder' : 'queued';
          pump();
        },
        (e) => fail(item, errorText(e?.code, e?.message ?? '')),
      );
    }
  }

  function fail(item: Item, message: string) {
    item.status = 'error';
    item.error = message;
  }

  /** analyzes queued songs one at a time, in the order they were added */
  async function pump() {
    if (running) return;
    running = true;
    try {
      let item: Item | undefined;
      while ((item = items.find((i) => i.status === 'queued'))) {
        const job = item;
        const c = (ctrl = new AbortController());
        job.status = 'working';
        job.progress = 0;
        job.stage = 'Starting…';
        job.startedAt = performance.now();
        try {
          job.result = await analyzeFile(job.file, job.info!, { signal: c.signal, onProgress: (p) => (job.progress = p), onStatus: (s) => (job.stage = s) });
          job.status = 'done';
        } catch (e) {
          if (isAbort(e)) {
            if (job.status === 'working') job.status = 'stopped';
            continue;
          }
          console.error(e);
          const err = e as { code?: string; message?: string };
          fail(job, errorText(err.code, err.message ?? ''));
        }
      }
    } finally {
      running = false;
      ctrl = null;
    }
  }

  function stopAll() {
    for (const i of items) if (i.status === 'queued') i.status = 'stopped';
    ctrl?.abort();
  }

  function requeue(item: Item) {
    item.status = 'queued';
    pump();
  }

  function allowDecoder() {
    decoderOk = true;
    for (const i of items) if (i.status === 'decoder') i.status = 'queued';
    pump();
  }

  function release(item: Item) {
    URL.revokeObjectURL(item.url);
  }

  function remove(item: Item) {
    if (item.status === 'working') ctrl?.abort();
    release(item);
    items.splice(items.indexOf(item), 1);
    if (selectedId === item.id) select(items[0]?.id ?? null);
  }

  function select(id: number | null) {
    if (id === selectedId) return;
    stopClicks();
    selectedId = id;
    time = 0;
    playing = false;
  }

  function startOver() {
    stopAll();
    for (const i of items) release(i);
    items = [];
    select(null);
  }

  function exportCsv() {
    const rows = sorted.filter((i) => i.result).map((i) => ({ name: i.file.name, analysis: i.result! }));
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'bpm-and-key.csv');
  }

  // ── playback, beat pulse and click track ─────────────────────────────

  let raf = 0;
  function follow() {
    cancelAnimationFrame(raf);
    if (!audio) return;
    time = audio.currentTime;
    playing = !audio.paused;
    if (playing) raf = requestAnimationFrame(follow);
  }

  function seek(t: number) {
    if (!audio) return;
    audio.currentTime = t;
    time = t;
    clickTrack?.resync();
  }

  function toggleClicks() {
    const beats = current?.result?.tempo?.beats;
    if (clicksOn || !audio || !beats) return stopClicks();
    clickTrack = new ClickTrack(audio, beats);
    clickTrack.start();
    clicksOn = true;
  }

  function stopClicks() {
    clickTrack?.destroy();
    clickTrack = null;
    clicksOn = false;
  }

  /** index of the beat the playhead last passed, for the pulse next to the BPM */
  const beatIndex = $derived.by(() => {
    const beats = current?.result?.tempo?.beats;
    if (!beats || !playing) return -1;
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  });

  // ── tap tempo ────────────────────────────────────────────────────────

  function addTapAt(at: number) {
    taps = addTap(taps, at);
    tapCount++;
  }

  const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
      addTapAt(e.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      stopClicks();
      ctrl?.abort();
      for (const i of items) release(i);
    };
  });

  // ── display helpers ──────────────────────────────────────────────────

  function describe(info: MediaInfo) {
    if (!info.readable) return "a format your browser can't open by itself";
    const a = info.audio;
    const parts = [formatTime(info.durationSec, 0)];
    if (a) {
      if (a.codec) parts.push(a.codec.toUpperCase());
      if (a.sampleRate) parts.push(`${+(a.sampleRate / 1000).toFixed(1)} kHz`);
      parts.push(a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : `${a.channels} channels`);
    }
    if (info.video) parts.push('video');
    return parts.join(' · ');
  }

  const levelText: Record<Confidence, string> = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence' };
  const levelBars: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

  function summary(r: Analysis) {
    const parts = [r.tempo ? `${formatBpm(r.tempo.bpm)} BPM` : '', r.key ? `${keyName(r.key)} (${camelot(r.key)})` : ''];
    return parts.filter(Boolean).join(' · ');
  }

  function relationText(bpm: number) {
    if (!tap) return '';
    const rel = tapRelation(tap.bpm, bpm);
    const shown = formatBpm(bpm);
    if (rel === 'same') return `Matches the detected ${shown} BPM.`;
    if (rel === 'half') return `Half of the detected ${shown}: you're tapping every other beat, which is how half-time feels.`;
    if (rel === 'double') return `Double the detected ${shown}: you may be tapping eighth notes, or the song really is this fast.`;
    return `Differs from the detected ${shown} BPM. Try tapping along with the preview.`;
  }
</script>

{#snippet meter(level: Confidence)}
  <span class="meter" aria-hidden="true">
    {#each [1, 2, 3] as n}<span class:on={n <= levelBars[level]}></span>{/each}
  </span>
  <span>{levelText[level]}</span>
{/snippet}

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
  <div class="grid min-w-0 content-start gap-4">
    {#if !items.length}
      <Dropzone accept={ACCEPT} multiple title="Drop songs to find their BPM and key" hint="or click to choose · MP3, WAV, M4A, FLAC, OGG or a video · batches welcome" onfiles={add} />
    {:else}
      {#if current}
        {@const r = current.result}
        <section class="detail card" aria-label="Selected song">
          <div class="grid gap-1">
            <p class="min-w-0 truncate text-[15px]">{current.file.name}</p>
            <p class="mono">{current.info ? describe(current.info) : 'reading…'} · {formatBytes(current.file.size)}</p>
          </div>

          {#key current.id}
            {#if current.playable}
              <div class="player">
                <audio
                  bind:this={audio}
                  controls
                  preload="metadata"
                  src={current.url}
                  onplay={follow}
                  onpause={follow}
                  onseeked={() => {
                    follow();
                    clickTrack?.resync();
                  }}
                  ontimeupdate={() => audio?.paused && follow()}
                  onerror={() => {
                    current.playable = false;
                    stopClicks();
                  }}
                ></audio>
                {#if r?.tempo}
                  <button type="button" class="btn click" aria-pressed={clicksOn} onclick={toggleClicks}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 14 7.5 2h1L11 14zM8 9l4-5" /></svg>
                    Click track
                  </button>
                {/if}
              </div>
            {:else}
              <p class="mono">Your browser can't play this format, but it can still be analyzed.</p>
            {/if}
          {/key}

          {#if current.status === 'probing'}
            <p class="mono working">Reading the file…</p>
          {:else if current.status === 'decoder'}
            <div class="ask" role="group" aria-label="Extra decoder needed">
              <p class="text-sm">
                Your browser can't decode this format by itself. Analyzing it needs a one-time {FALLBACK_DOWNLOAD_MB} MB download of ffmpeg, an
                extra decoder.
              </p>
              <p class="mono">It comes from this site and runs on your device. Your file still isn't uploaded.</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary" onclick={allowDecoder}>Download it and analyze</button>
                <button type="button" class="btn" onclick={() => remove(current)}>Remove this file</button>
              </div>
            </div>
          {:else if current.status === 'queued'}
            <p class="mono">Waiting for the songs before it…</p>
          {:else if current.status === 'working'}
            <MediaJobProgress progress={current.progress} startedAt={current.startedAt} label={`Analyzing ${current.file.name}`} status={current.stage} oncancel={stopAll} />
          {:else if current.status === 'stopped'}
            <div class="flex flex-wrap items-center gap-3">
              <p class="mono">Analysis stopped.</p>
              <button type="button" class="btn" onclick={() => requeue(current)}>Analyze</button>
            </div>
          {:else if current.status === 'error'}
            <p class="text-sm text-bad" role="alert">{current.error}</p>
          {:else if r}
            <div class="results" role="status">
              <div class="stat">
                <span class="label">tempo</span>
                {#if r.tempo}
                  <p class="big">
                    <span class="font-serif">{formatBpm(r.tempo.bpm)}</span><span class="unit">BPM</span>
                    {#key beatIndex}<span class="pulse" class:beat={beatIndex >= 0} aria-hidden="true"></span>{/key}
                  </p>
                  <p class="mono conf">{@render meter(confidenceLevel(r.tempo.confidence))}</p>
                  <p class="mono">
                    Half time <span class="text-chalk">{formatBpm(roundBpm(r.tempo.bpm) / 2)}</span> · double time
                    <span class="text-chalk">{formatBpm(roundBpm(r.tempo.bpm) * 2)}</span>
                  </p>
                {:else}
                  <p class="big"><span class="font-serif">—</span></p>
                  <p class="mono">No steady beat found. Try the tap pad.</p>
                {/if}
              </div>
              <div class="stat">
                <span class="label">key</span>
                {#if r.key}
                  {@const rel = relativeKey(r.key)}
                  <p class="big">
                    <span class="font-serif">{keyName(r.key)}</span>
                    <span class="camelot" title="Camelot wheel code">{camelot(r.key)}</span>
                  </p>
                  <p class="mono conf">{@render meter(confidenceLevel(r.key.confidence))}</p>
                  <p class="mono">
                    Relative {rel.mode}: <span class="text-chalk">{keyName(rel)}</span> ({camelot(rel)})
                  </p>
                  <p class="mono">Runners-up: {r.key.runnersUp.slice(0, 2).map((k) => keyShort(k)).join(', ')}</p>
                  {#if Math.abs(r.key.tuningCents) >= 15}
                    <p class="mono">Tuned about {r.key.tuningCents > 0 ? '+' : '−'}{Math.round(Math.abs(r.key.tuningCents))} cents from A = 440 Hz</p>
                  {/if}
                {:else}
                  <p class="big"><span class="font-serif">—</span></p>
                  <p class="mono">No clear pitches to work from.</p>
                {/if}
              </div>
            </div>

            {#if r.tempo?.beats.length}
              <BpmBeats peaks={r.peaks} beats={r.tempo.beats} duration={r.durationSec} {time} onseek={seek} />
            {/if}

            <div class="flex flex-wrap gap-2">
              <CopyButton text={summary(r)} label="Copy result" />
            </div>
          {/if}
        </section>
      {/if}

      {#if items.length > 1}
        <section class="grid gap-2" aria-label="All songs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="label m-0">{items.length} songs · {done.length} analyzed</span>
            <div class="seg" role="group" aria-label="Sort by">
              <button type="button" aria-pressed={sortBy === 'added'} onclick={() => (sortBy = 'added')}>as added</button>
              <button type="button" aria-pressed={sortBy === 'bpm'} onclick={() => (sortBy = 'bpm')}>BPM</button>
              <button type="button" aria-pressed={sortBy === 'camelot'} onclick={() => (sortBy = 'camelot')}>Camelot</button>
            </div>
          </div>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col" class="hidden sm:table-cell">Length</th>
                  <th scope="col">BPM</th>
                  <th scope="col">Key</th>
                  <th scope="col">Camelot</th>
                  <th scope="col"><span class="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {#each sorted as item (item.id)}
                  {@const res = item.result}
                  <tr class:sel={item.id === selectedId}>
                    <td class="name">
                      <button type="button" aria-pressed={item.id === selectedId} onclick={() => select(item.id)}>
                        <span class="block truncate">{item.file.name}</span>
                        {#if item.status === 'working'}
                          <span class="mono working">{Math.round(item.progress * 100)}%</span>
                        {:else if item.status === 'error'}
                          <span class="mono text-bad">failed</span>
                        {:else if item.status === 'decoder'}
                          <span class="mono text-sun">needs extra decoder</span>
                        {:else if item.status !== 'done'}
                          <span class="mono">{item.status === 'stopped' ? 'stopped' : item.status === 'queued' ? 'waiting' : 'reading…'}</span>
                        {/if}
                      </button>
                    </td>
                    <td class="mono hidden sm:table-cell">{item.info?.readable ? formatTime(item.info.durationSec, 0) : item.result ? formatTime(item.result.durationSec, 0) : ''}</td>
                    <td class="num">{res?.tempo ? formatBpm(res.tempo.bpm) : res ? '—' : ''}</td>
                    <td>{res?.key ? keyShort(res.key) : res ? '—' : ''}</td>
                    <td>{#if res?.key}<span class="camelot sm">{camelot(res.key)}</span>{/if}</td>
                    <td>
                      <button type="button" class="x" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>✕</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <Dropzone accept={ACCEPT} multiple title="Add more songs" hint="drop, click or paste" onfiles={add} />
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn" disabled={!done.length} onclick={exportCsv}>Export CSV{done.length > 1 ? ` (${done.length})` : ''}</button>
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    {/if}
  </div>

  <aside class="tap card" aria-labelledby="tap-title">
    <span class="label" id="tap-title">tap tempo</span>
    <button
      type="button"
      class="pad"
      aria-describedby="tap-help"
      onpointerdown={(e) => e.button === 0 && addTapAt(e.timeStamp)}
      onkeydown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        if (!e.repeat) addTapAt(e.timeStamp);
      }}
    >
      {#key tapCount}<span class="ring" class:go={tapCount > 0}></span>{/key}
      <span class="font-serif tap-bpm">{tap ? formatBpm(tap.bpm) : 'Tap'}</span>
      <span class="mono">{tap ? 'BPM' : 'along to the beat'}</span>
    </button>
    <p class="mono" aria-live="polite">
      {#if tap}
        {formatBpm(tap.bpm)} BPM from {tap.used} taps{tap.spread > 4 ? ' · keep going to steady it' : ''}
      {:else if taps.length}
        {taps.length} tap{taps.length === 1 ? '' : 's'}, keep going…
      {:else}
        No song needed.
      {/if}
    </p>
    {#if tap && current?.result?.tempo}
      <p class="text-sm text-soft">{relationText(current.result.tempo.bpm)}</p>
    {/if}
    <p id="tap-help" class="mono">Click or touch the pad, press Space on it, or press T anywhere. Pause {TAP_RESET_MS / 1000} seconds to start a new count.</p>
    <button type="button" class="btn" disabled={!taps.length} onclick={() => (taps = [])}>Reset</button>
  </aside>
</div>

<style>
  .detail {
    display: grid;
    gap: 16px;
    padding: 18px;
  }
  .player {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    & audio {
      flex: 1 1 260px;
      min-width: 0;
      height: 40px;
    }
  }
  .click {
    padding: 9px 14px;
    font-size: 14px;
    & svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    &[aria-pressed='true'] {
      background: var(--color-sun);
      border-color: var(--color-sun);
      color: var(--color-bg);
    }
  }
  .results {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    animation: rise 0.45s var(--ease-spring) backwards;
  }
  @media (max-width: 560px) {
    .results {
      grid-template-columns: 1fr;
    }
  }
  .stat {
    display: grid;
    align-content: start;
    gap: 6px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel-2);
    & .label {
      margin: 0;
    }
  }
  .big {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    line-height: 1;
    & .font-serif {
      font-size: clamp(40px, 7vw, 56px);
      color: var(--color-chalk);
      font-variant-numeric: tabular-nums;
    }
  }
  .unit {
    font: 500 13px var(--font-mono);
    color: var(--color-muted);
  }
  .pulse {
    align-self: center;
    width: 10px;
    height: 10px;
    border-radius: 99px;
    background: var(--color-line-2);
    &.beat {
      background: var(--color-sun);
      animation: beat 0.35s ease-out forwards;
    }
  }
  @keyframes beat {
    from {
      transform: scale(1.6);
      box-shadow: 0 0 0 6px #ffd25e33;
    }
    to {
      transform: scale(1);
      background: #ffd25e66;
      box-shadow: 0 0 0 0 #ffd25e00;
    }
  }
  .camelot {
    align-self: center;
    font: 500 14px/1 var(--font-mono);
    padding: 6px 9px;
    border-radius: 8px;
    color: var(--color-bg);
    background: var(--color-audio);
    &.sm {
      font-size: 12px;
      padding: 4px 7px;
    }
  }
  .conf {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .meter {
    display: inline-flex;
    gap: 3px;
    & span {
      width: 14px;
      height: 5px;
      border-radius: 9px;
      background: var(--color-line-2);
      &.on {
        background: var(--color-sun);
      }
    }
  }
  .ask {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-sun);
    border-radius: 14px;
    background: #ffd25e0d;
  }
  .working {
    color: var(--color-sun);
    animation: fade 1.2s ease-in-out infinite;
  }
  .table {
    overflow-x: auto;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    & th {
      font: 400 12px var(--font-mono);
      color: var(--color-muted);
      text-align: left;
      padding: 10px 10px 8px;
      border-bottom: 1px solid var(--color-line);
    }
    & td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--color-line);
      white-space: nowrap;
    }
    & tbody tr:last-child td {
      border-bottom: 0;
    }
    & tr.sel td {
      background: #ffd25e0d;
    }
  }
  .name {
    width: 100%;
    max-width: 0;
    & button {
      display: block;
      width: 100%;
      min-width: 90px;
      padding: 4px 0;
      text-align: left;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
    }
  }
  .num {
    font-variant-numeric: tabular-nums;
    color: var(--color-chalk);
  }
  .x {
    padding: 6px 8px;
    color: var(--color-muted);
    background: none;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
    }
  }
  .tap {
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 18px;
    & .label {
      margin: 0;
    }
  }
  .pad {
    position: relative;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    width: min(100%, 220px);
    aspect-ratio: 1;
    justify-self: center;
    border-radius: 999px;
    border: 1px solid var(--color-line-2);
    background: radial-gradient(circle at 50% 40%, #2a2824, #1a1917 70%);
    color: var(--color-chalk);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    transition: transform 0.12s var(--ease-spring), border-color 0.2s;
    &:hover {
      border-color: var(--color-muted);
    }
    &:active {
      transform: scale(0.96);
    }
  }
  .tap-bpm {
    font-size: 48px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .ring {
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    border: 2px solid var(--color-sun);
    opacity: 0;
    pointer-events: none;
    &.go {
      animation: ring 0.5s ease-out;
    }
  }
  @keyframes ring {
    from {
      opacity: 0.9;
      transform: scale(0.94);
    }
    to {
      opacity: 0;
      transform: scale(1.08);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes fade {
    50% {
      opacity: 0.4;
    }
  }
</style>
