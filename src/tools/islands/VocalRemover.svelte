<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import Waveform from '@/components/tool/Waveform.svelte';
  import MediaJobProgress from './MediaJobProgress.svelte';
  import { detectDevice, deviceLabel, type DeviceInfo } from '@/engines/ai/device';
  import { toAiError } from '@/engines/ai/errors';
  import { MODELS, totalDownloadSize, type Device } from '@/engines/ai/models';
  import { formatMB } from '@/engines/ai/progress';
  import { modelWorker, proxy, transfer } from '@/engines/ai/worker-utils';
  import { decodeAudio, encodeAudio, MediaError, probe, type Peaks } from '@/engines/media';
  import { deviceMessage, guard } from '@/tools/lib/device-guard';
  import { downloadBlob, zipFiles } from '@/tools/lib/files';
  import { formatClock, mediaErrorText } from '@/tools/lib/video-to-mp3/job';
  import type { DemucsWorker, LoadChoice } from '@/tools/lib/vocal-remover/demucs.worker';
  import { StemPlayer, stemBuffer, toDemucsInput } from '@/tools/lib/vocal-remover/mixer';
  import {
    effectiveGains,
    exportName,
    isSilent,
    LONG_SECONDS,
    matchPreset,
    MAX_SECONDS,
    mixStems,
    presetMix,
    PRESETS,
    RATE,
    segmentCount,
    STEM_IDS,
    STEMS,
    zipName,
    type ExportPart,
    type StemId,
  } from '@/tools/lib/vocal-remover/stems';

  const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.weba,.mkv,.mov,.m4v,.avi,.webm,.mp4';
  const MODEL_MB = formatMB(totalDownloadSize('demucs', 'fp32'));
  const ZIP_PARTS: ExportPart[] = ['instrumental', 'vocals', 'drums', 'bass', 'other'];
  /** single-threaded WebAssembly (no cross-origin isolation); the registry's hint is more optimistic */
  const CPU_SPEED = 'ten minutes or more for a 4-minute song';
  const TOO_LONG =`This tool takes songs up to ${MAX_SECONDS / 60} minutes. Cut it into parts with the audio cutter first.`;

  /** a problem with the file, explained as is */
  class FileProblem extends Error {}

  const worker = modelWorker<DemucsWorker>(() => new Worker(new URL('../lib/vocal-remover/demucs.worker.ts', import.meta.url), { type: 'module', name: 'demucs' }));
  /** what the gate loaded, so a fresh worker (after Cancel) reopens the same thing */
  let choice: LoadChoice = {};

  const uid = $props.id();
  let info = $state<DeviceInfo | null>(null);
  let anyway = $state(false);

  let file = $state<File | null>(null);
  let job = $state<{ progress: number; startedAt: number; status: string } | null>(null);
  let error = $state('');
  let result = $state<{ duration: number; peaks: Record<StemId, Peaks>; device: Device; ms: number } | null>(null);
  let mix = $state(presetMix('all'));
  let pos = $state(0);
  let playing = $state(false);
  let format = $state<'mp3' | 'wav'>('mp3');
  /** what saving is doing right now, null when idle */
  let exporting = $state<string | null>(null);
  let ctrl: AbortController | null = null;
  let player: StemPlayer | null = null;
  let buffers: Record<StemId, AudioBuffer> | null = null;

  const gains = $derived(effectiveGains(mix));
  const preset = $derived(matchPreset(mix));
  const lowMemory = $derived(!!info?.deviceMemory && info.deviceMemory <= 4);

  onMount(() => {
    detectDevice().then((d) => (info = d));
  });

  onDestroy(() => {
    ctrl?.abort();
    player?.destroy();
    worker.terminate();
  });

  $effect(() => {
    player?.setLevels(gains);
  });

  // playhead
  $effect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      pos = player?.position() ?? 0;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  async function loadModel({ variant, device, onProgress, signal }: GateLoadContext) {
    const r = await worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal);
    choice = r;
    return r;
  }

  function errorText(err: unknown): string {
    if (err instanceof FileProblem) return err.message;
    const device = deviceMessage('vocals', err);
    if (device) return device;
    if (err instanceof MediaError) return err.code === 'aborted' ? '' : mediaErrorText(err);
    const e = toAiError(err);
    if (e.code === 'aborted') return '';
    if (e.code === 'out-of-memory') return 'Your device ran out of memory. Close other tabs and try again, or try a shorter song (cut it first with the audio cutter).';
    return e.message;
  }

  async function split(f: File) {
    startOver();
    file = f;
    const ctl = (ctrl = new AbortController());
    job = { progress: 0, startedAt: performance.now(), status: 'Reading the song…' };
    try {
      const media = await probe(f, { signal: ctl.signal });
      if (media.readable && !media.audio) throw new FileProblem('This file has no sound to split.');
      if (media.durationSec > MAX_SECONDS) throw new FileProblem(TOO_LONG);
      // low-end devices: the song and its four stems sit in memory as raw samples
      guard('vocals', { bytes: f.size, seconds: media.durationSec || undefined });
      const pcm = await decodeAudio(f, {}, { signal: ctl.signal, onProgress: (p) => job && (job.progress = p), onStatus: (s) => job && (job.status = s) });
      const duration = (pcm.channels[0]?.length ?? 0) / pcm.sampleRate;
      if (!duration) throw new FileProblem('This file has no sound to split.');
      if (duration > MAX_SECONDS) throw new FileProblem(TOO_LONG);
      const [left, right] = await toDemucsInput(pcm);
      ctl.signal.throwIfAborted();

      const total = segmentCount(left.length);
      const long = duration > LONG_SECONDS ? ' · a long song, so this takes a while' : '';
      const started = performance.now();
      job = { progress: 0, startedAt: started, status: `Starting the model…${long}` };
      let last = 0;
      const onSegment = (done: number) => {
        if (!job) return;
        // the GPU gave up and the worker started over on the processor
        if (done < last) job.startedAt = performance.now();
        last = done;
        job.progress = Math.min(1, done / total);
        job.status = `Separating · part ${Math.min(done, total)} of ${total}${long}`;
      };
      const out = await worker.call((api) => api.separate(transfer(left, [left.buffer]), transfer(right, [right.buffer]), choice, proxy(onSegment)), ctl.signal);

      // drop each raw stem once it's copied into its AudioBuffer, so a long song isn't held twice
      buffers = Object.fromEntries(
        STEM_IDS.map((id) => {
          const buf = stemBuffer(out.stems[id]);
          out.stems[id] = [];
          return [id, buf];
        }),
      ) as Record<StemId, AudioBuffer>;
      player = new StemPlayer(buffers, gains);
      player.onended = () => {
        playing = false;
        pos = 0;
      };
      result = { duration: buffers.vocals.duration, peaks: out.peaks, device: out.device, ms: performance.now() - started };
    } catch (err) {
      if (ctl === ctrl) {
        error = errorText(err);
        if (!error) file = null;
      }
    } finally {
      if (ctl === ctrl) {
        job = null;
        ctrl = null;
      }
    }
  }

  function startOver() {
    ctrl?.abort();
    ctrl = null;
    player?.destroy();
    player = null;
    buffers = null;
    result = null;
    file = null;
    job = null;
    error = '';
    exporting = null;
    playing = false;
    pos = 0;
    mix = presetMix('all');
  }

  function toggle() {
    if (!player) return;
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
    pos = player.position();
  }

  function seek(sec: number) {
    player?.seek(sec);
    pos = sec;
  }

  function seekLane(e: MouseEvent) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (result) seek(((e.clientX - box.left) / box.width) * result.duration);
  }

  function setChannel(id: StemId, key: 'muted' | 'solo') {
    mix[id][key] = !mix[id][key];
  }

  async function encodePart(part: ExportPart): Promise<Blob> {
    const stems = Object.fromEntries(STEM_IDS.map((id) => [id, [0, 1].map((c) => buffers![id].getChannelData(c))])) as Record<StemId, Float32Array[]>;
    const channels =
      part === 'mix' ? mixStems(stems, gains) : part === 'instrumental' ? mixStems(stems, effectiveGains(presetMix('instrumental'))) : stems[part];
    return encodeAudio({ sampleRate: RATE, channels }, format === 'mp3' ? { format: 'mp3', bitrate: 256_000 } : { format: 'wav' });
  }

  async function download(part: ExportPart | 'zip') {
    if (!file || !buffers || exporting) return;
    const name = file.name;
    exporting = `Saving ${format.toUpperCase()}…`;
    const say = (status: string) => exporting && (exporting = status);
    error = '';
    try {
      if (part === 'zip') {
        const files = [];
        for (const [i, p] of ZIP_PARTS.entries()) {
          say(`Saving ${i + 1} of ${ZIP_PARTS.length} · ${p}`);
          files.push({ name: exportName(name, p, format), blob: await encodePart(p) });
        }
        say('Zipping…');
        downloadBlob(await zipFiles(files), zipName(name));
      } else {
        downloadBlob(await encodePart(part), exportName(name, part, format));
      }
    } catch (err) {
      error = errorText(err) || 'Saving failed. Try again, or pick WAV.';
    } finally {
      exporting = null;
    }
  }

  const clock = (sec: number) => formatClock(Math.floor(sec));
</script>

{#if !info}
  <div class="min-h-48" aria-busy="true"></div>
{:else if info.isMobile && !anyway}
  <section class="card phone" aria-labelledby={`${uid}-phone`}>
    <span class="pill mono"><span class="dot" aria-hidden="true"></span>made for computers</span>
    <h3 id={`${uid}-phone`} class="font-serif text-3xl leading-tight">This one needs a computer</h3>
    <p class="text-soft">
      Splitting a song runs a {MODEL_MB} AI model on your device and needs 1–2 GB of free memory for several minutes. Phones and tablets usually run out of memory or
      get very hot doing that, so we don't start it here.
    </p>
    <p class="text-soft">Open this page on a laptop or desktop in Chrome or Edge. It's just as free there, and the song still never leaves your device.</p>
    <div><button type="button" class="btn" onclick={() => (anyway = true)}>Try it anyway</button></div>
  </section>
{:else}
  <ModelGate model="demucs" light={null} load={loadModel}>
    {#snippet children({ device })}
      {#if !file}
        <div class="grid gap-3">
          <Dropzone accept={ACCEPT} title="Drop a song" hint={`MP3, WAV, FLAC, M4A or a video · up to ${MAX_SECONDS / 60} minutes`} onfiles={(f) => split(f[0])} />
          <p class="mono">
            Runs on {deviceLabel(device)}: typically {device === 'wasm' ? CPU_SPEED : MODELS.demucs.speed[device]}. Keep this tab open while it works; the page stays
            usable.
          </p>
          {#if lowMemory}
            <p class="note mono">Your device reports {info?.deviceMemory} GB of memory. Splitting needs 1–2 GB, so shorter songs are safer.</p>
          {/if}
        </div>
      {:else if job}
        <section class="stage" aria-label="Splitting">
          <MediaJobProgress progress={job.progress} startedAt={job.startedAt} label={file.name} status={job.status} oncancel={startOver} />
        </section>
      {:else if result}
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div class="grid min-w-0 content-start gap-4">
            <div class="ready" role="status">
              <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
              <div class="min-w-0">
                <p class="font-serif text-2xl leading-tight">Four stems, ready to mix</p>
                <p class="mono truncate">
                  {file.name} · {clock(result.duration)} · split in {clock(result.ms / 1000)} on {deviceLabel(result.device)}
                </p>
              </div>
            </div>
            {#if result.device !== device}
              <p class="note mono">WebGPU stopped partway, so it finished on your processor.</p>
            {/if}

            <section class="mixer" aria-label="Stem mixer">
              <div class="flex items-center gap-3">
                <button type="button" class="play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
                  {#if playing}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                  {/if}
                </button>
                <div class="grid min-w-0 flex-1 gap-1">
                  <input
                    type="range"
                    class="scrub"
                    min="0"
                    max={result.duration}
                    step="0.1"
                    value={pos}
                    oninput={(e) => seek(+e.currentTarget.value)}
                    aria-label="Position"
                    aria-valuetext={`${clock(pos)} of ${clock(result.duration)}`}
                  />
                  <p class="mono flex justify-between tabular-nums"><span>{clock(pos)}</span><span>{clock(result.duration)}</span></p>
                </div>
              </div>

              <div class="seg presets" role="group" aria-label="Quick mixes">
                {#each PRESETS as p (p.id)}
                  <button type="button" aria-pressed={preset === p.id} title={p.hint} onclick={() => (mix = presetMix(p.id))}>{p.label}</button>
                {/each}
              </div>

              <ul class="stems">
                {#each STEMS as s (s.id)}
                  <li class="stem" class:quiet={!gains[s.id]} style:--stem={s.color}>
                    <div class="name">
                      <span class="dot" aria-hidden="true"></span>
                      <span class="min-w-0">
                        <span class="block text-sm">{s.label}</span>
                        <span class="mono block truncate">{s.hint}</span>
                      </span>
                    </div>
                    <div class="lane" onclick={seekLane} role="presentation">
                      <Waveform peaks={result.peaks[s.id]} color={s.color} progress={pos / result.duration} />
                    </div>
                    <div class="ctl">
                      <button type="button" class="ms" aria-pressed={mix[s.id].muted} aria-label={`Mute ${s.label}`} title="Mute" onclick={() => setChannel(s.id, 'muted')}>M</button>
                      <button type="button" class="ms solo" aria-pressed={mix[s.id].solo} aria-label={`Solo ${s.label}`} title="Solo" onclick={() => setChannel(s.id, 'solo')}>S</button>
                      <input type="range" class="vol" min="0" max="1" step="0.01" bind:value={mix[s.id].volume} aria-label={`${s.label} volume`} aria-valuetext={`${Math.round(mix[s.id].volume * 100)}%`} />
                      <button type="button" class="ms" disabled={!!exporting} aria-label={`Download ${s.label} as ${format.toUpperCase()}`} title={`Download ${s.label}`} onclick={() => download(s.id)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" /></svg>
                      </button>
                    </div>
                  </li>
                {/each}
              </ul>
              <p class="mono">
                Separated by AI, so expect a little bleed between stems, especially with reverb or dense mixes. Listen before you download.
              </p>
            </section>
          </div>

          <aside class="grid content-start gap-4">
            <div>
              <span class="label">save as</span>
              <div class="seg" role="group" aria-label="File format">
                <button type="button" aria-pressed={format === 'mp3'} disabled={!!exporting} onclick={() => (format = 'mp3')}>MP3</button>
                <button type="button" aria-pressed={format === 'wav'} disabled={!!exporting} onclick={() => (format = 'wav')}>WAV</button>
              </div>
              <p class="mono mt-2">{format === 'mp3' ? 'MP3 256 kbps: small files for listening and sharing.' : 'WAV 16-bit: lossless, about 10 MB per minute, best for editing.'}</p>
            </div>
            <div class="grid gap-2">
              <button type="button" class="btn btn-primary" disabled={!!exporting} onclick={() => download('instrumental')}>Instrumental (karaoke)</button>
              <button type="button" class="btn" disabled={!!exporting} onclick={() => download('vocals')}>Vocals (acapella)</button>
              <button type="button" class="btn" disabled={!!exporting || isSilent(gains)} onclick={() => download('mix')}>This mix, as you hear it</button>
              <button type="button" class="btn" disabled={!!exporting} onclick={() => download('zip')}>All stems (ZIP)</button>
            </div>
            {#if exporting}<p class="mono" role="status">{exporting}</p>{/if}
            {#if error}<p class="mono text-bad" role="alert">{error}</p>{/if}
            <button type="button" class="btn" onclick={startOver}>Split another song</button>
          </aside>
        </div>
      {:else}
        <div class="grid gap-3">
          <p class="mono text-bad" role="alert">{error}</p>
          <div><button type="button" class="btn" onclick={startOver}>Try another song</button></div>
        </div>
      {/if}
    {/snippet}
  </ModelGate>
{/if}

<style>
  .phone {
    display: grid;
    gap: 12px;
    padding: 20px;
    border-color: color-mix(in srgb, var(--color-ai) 40%, transparent);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-self: start;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--color-ai) 45%, transparent);
    border-radius: 99px;
    color: var(--color-ai);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--stem, var(--color-ai));
  }
  .note {
    padding: 10px 12px;
    border: 1px solid #ffd25e55;
    border-radius: 12px;
    background: #ffd25e0d;
  }
  .stage,
  .mixer {
    display: grid;
    gap: 14px;
    padding: 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .play {
    flex: none;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 99px;
    background: var(--color-sun);
    color: var(--color-bg);
    cursor: pointer;
    transition: transform 0.15s var(--ease-spring);
    &:hover {
      transform: scale(1.06);
    }
    & svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
  }
  .scrub,
  .vol {
    width: 100%;
    accent-color: var(--color-sun);
  }
  .presets {
    justify-self: start;
  }
  .stems {
    display: grid;
    gap: 8px;
  }
  .stem {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'name ctl' 'lane lane';
    align-items: center;
    gap: 8px 12px;
    padding: 10px;
    border: 1px solid var(--color-line);
    border-left: 3px solid var(--stem);
    border-radius: 14px;
    background: #141312;
    transition: opacity 0.2s;
    &.quiet {
      opacity: 0.45;
    }
    @media (min-width: 720px) {
      grid-template-columns: 150px minmax(0, 1fr) auto;
      grid-template-areas: 'name lane ctl';
    }
  }
  .name {
    grid-area: name;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .lane {
    grid-area: lane;
    height: 52px;
    cursor: pointer;
  }
  .ctl {
    grid-area: ctl;
    display: flex;
    align-items: center;
    gap: 6px;
    & .vol {
      width: 84px;
    }
  }
  .ms {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--color-line-2);
    border-radius: 9px;
    background: transparent;
    color: var(--color-muted);
    font: 500 12px var(--font-mono);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    &:hover:not(:disabled) {
      color: var(--color-chalk);
    }
    &[aria-pressed='true'] {
      background: var(--color-bad);
      border-color: var(--color-bad);
      color: var(--color-bg);
    }
    &.solo[aria-pressed='true'] {
      background: var(--color-sun);
      border-color: var(--color-sun);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    & svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
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
  @media (prefers-reduced-motion: reduce) {
    .tick circle,
    .tick path {
      animation: none;
    }
    .play,
    .stem {
      transition: none;
    }
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
