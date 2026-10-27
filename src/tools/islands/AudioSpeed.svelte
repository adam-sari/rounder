<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilities, downloadName, FALLBACK_DOWNLOAD_MB, formatBytes, formatTime, type Capabilities, type StatusControl } from '@/engines/media';
  import { defaultBitrate, estimateBytes, formatSupport, type OutFormat } from '@/tools/lib/audio-cutter/edit';
  import { clampTempo, MAX_TEMPO, MIN_TEMPO, sliderToTempo, tapeSemitones, TEMPO_PRESETS, tempoSuffix, tempoToSlider } from '@/tools/lib/timestretch/labels';
  import { renderStretch } from '@/tools/lib/timestretch/render';
  import { frameSize, memoryNote, type SoundKind } from '@/tools/lib/timestretch/stretch';
  import AudioEditShell, { type AudioSource } from './AudioEditShell.svelte';
  import StretchOutput from './StretchOutput.svelte';

  let caps = $state.raw<Capabilities | null>(null);
  let src = $state.raw<AudioSource | null>(null);
  let tempo = $state(1);
  let mode = $state<'keep' | 'record'>('keep');
  let kind = $state<SoundKind>('music');
  let bpm = $state<number | null>(null);
  let format = $state<OutFormat>('mp3');
  let bitrate = $state(defaultBitrate('mp3')!);

  onMount(() => {
    capabilities().then((c) => (caps = c), () => {});
  });

  const audio = $derived(src?.info.audio);
  const duration = $derived(src?.info.durationSec ?? 0);
  const newDuration = $derived(duration / tempo);
  const settings = $derived({ tempo, pitch: mode === 'record' ? tempo : 1, fftSize: frameSize(audio?.sampleRate ?? 44100, kind) });
  const support = $derived(formatSupport(format, caps, FALLBACK_DOWNLOAD_MB));
  const blocker = $derived(tempo === 1 ? 'Pick a new speed first: at 1× nothing changes.' : support.ok ? '' : (support.note ?? ''));
  const hint = $derived(
    [`about ${formatBytes(estimateBytes(format, newDuration, bitrate, audio?.sampleRate, audio?.channels))}`, memoryNote(duration, audio?.sampleRate ?? 44100, audio?.channels ?? 2, tempo)].filter(Boolean).join(' · '),
  );
  const settingsKey = $derived(JSON.stringify([settings, format, bitrate]));
  const change = $derived(tempo > 1 ? `${Math.round((tempo - 1) * 100)}% faster` : tempo < 1 ? `${Math.round((1 - tempo) * 100)}% slower` : 'original speed');
  const shift = $derived(tapeSemitones(tempo));

  function onsource(s: AudioSource | null) {
    src = s;
    if (s) format = s.info.container === 'wav' ? 'wav' : 'mp3';
  }

  /** typed speeds snap into range; an empty or invalid entry puts the current speed back */
  function setExact(input: HTMLInputElement) {
    const v = input.valueAsNumber;
    if (Number.isFinite(v) && v > 0) tempo = clampTempo(v);
    input.value = String(tempo);
  }

  function begin(s: AudioSource) {
    const opts = { settings: { ...settings }, format, bitrate, label: mode === 'record' ? 'Changing speed…' : 'Changing tempo…' };
    const name = downloadName(s.file.name, format, tempoSuffix(tempo));
    return async (ctl: StatusControl) => {
      const out = await renderStretch(s.blob, opts, ctl);
      return { blob: out.blob, name, durationSec: out.durationSec, note: out.safetyDb ? `lowered ${Math.abs(out.safetyDb).toFixed(1)} dB to avoid clipping` : undefined };
    };
  }
</script>

<AudioEditShell action="Change speed" {settingsKey} {blocker} {hint} {begin} {onsource}>
  {#snippet editor(s, media)}
    <div class="grid gap-4">
      <section class="card dial" aria-label="Speed">
        <div class="flex items-center justify-between gap-3">
          <span class="label m-0">speed</span>
          <button type="button" class="btn small" onclick={() => (tempo = 1)} disabled={tempo === 1}>Reset</button>
        </div>

        <div class="readout">
          <p class="big" class:moved={tempo !== 1}>{tempo}×</p>
          <p class="mono">{change} · {formatTime(s.info.durationSec, 0)} → <b class="to">{formatTime(newDuration, 0)}</b></p>
        </div>

        <div class="seg presets" role="group" aria-label="Speed presets">
          {#each TEMPO_PRESETS as p (p)}
            <button type="button" aria-pressed={tempo === p} onclick={() => (tempo = p)}>{p}×</button>
          {/each}
        </div>

        <div class="slider">
          <input
            type="range"
            min={tempoToSlider(MIN_TEMPO)}
            max={tempoToSlider(MAX_TEMPO)}
            step="0.005"
            value={tempoToSlider(tempo)}
            oninput={(e) => (tempo = sliderToTempo(+e.currentTarget.value))}
            aria-label="Speed"
            aria-valuetext={`${tempo} times, ${change}`}
            class="w-full accent-(--color-sun)"
          />
          <label class="exact">
            <span class="sr-only">Exact speed</span>
            <input type="number" class="field" min={MIN_TEMPO} max={MAX_TEMPO} step="0.01" value={tempo} onchange={(e) => setExact(e.currentTarget)} />
            <span class="mono">×</span>
          </label>
        </div>

        <div class="extras">
          <div>
            <span class="label">pitch</span>
            <div class="seg" role="group" aria-label="What happens to the pitch">
              <button type="button" aria-pressed={mode === 'keep'} onclick={() => (mode = 'keep')}>keep pitch</button>
              <button type="button" aria-pressed={mode === 'record'} onclick={() => (mode = 'record')}>like a record</button>
            </div>
            <p class="mono mt-1">
              {mode === 'keep' ? 'Voices and notes stay where they are.' : shift ? `Pitch moves ${Math.abs(shift)} semitone${Math.abs(shift) === 1 ? '' : 's'} ${shift > 0 ? 'up' : 'down'}, like a turntable.` : 'Pitch follows the speed, like a turntable.'}
            </p>
          </div>
          {#if mode === 'keep'}
            <div>
              <span class="label">sound</span>
              <div class="seg" role="group" aria-label="Type of sound">
                <button type="button" aria-pressed={kind === 'music'} onclick={() => (kind = 'music')}>music</button>
                <button type="button" aria-pressed={kind === 'voice'} onclick={() => (kind = 'voice')}>voice</button>
              </div>
            </div>
          {/if}
          <label>
            <span class="label">song BPM (optional)</span>
            <span class="flex items-center gap-3">
              <input type="number" class="field bpm" min="20" max="400" step="0.1" placeholder="e.g. 120" bind:value={bpm} />
              {#if bpm && bpm > 0}<span class="mono whitespace-nowrap">→ <b class="to">{Math.round(bpm * tempo * 10) / 10} BPM</b></span>{/if}
            </span>
          </label>
        </div>
      </section>

      <StretchOutput source={s} {media} {settings} unchanged={tempo === 1} {caps} bind:format bind:bitrate />
    </div>
  {/snippet}
</AudioEditShell>

<style>
  .dial {
    display: grid;
    gap: 16px;
    padding: 18px;
  }
  .readout {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
  .big {
    font: 400 clamp(40px, 8vw, 56px) / 1 var(--font-serif);
    color: var(--color-soft);
    font-variant-numeric: tabular-nums;
    transition: color 0.2s;
    &.moved {
      color: var(--color-sun);
    }
  }
  .presets {
    width: fit-content;
    max-width: 100%;
  }
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 16px;
  }
  .exact {
    display: flex;
    align-items: center;
    gap: 6px;
    & .field {
      width: 88px;
      padding: 8px 10px;
    }
  }
  .small {
    padding: 7px 12px;
    font-size: 13px;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .extras {
    display: grid;
    grid-template-columns: 1.3fr auto 1fr;
    gap: 16px 24px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .extras {
      grid-template-columns: 1fr;
    }
  }
  .bpm {
    width: 110px;
    padding: 8px 12px;
  }
  .to {
    font-weight: 500;
    color: var(--color-sun);
  }
</style>
