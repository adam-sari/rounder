<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilities, downloadName, FALLBACK_DOWNLOAD_MB, formatBytes, type Capabilities, type StatusControl } from '@/engines/media';
  import { defaultBitrate, estimateBytes, formatSupport, type OutFormat } from '@/tools/lib/audio-cutter/edit';
  import { intervalName, KEYS, MAX_CENTS, MAX_SEMITONES, pitchSuffix, semitoneLabel, totalSemitones, transposeKey, type Key } from '@/tools/lib/timestretch/labels';
  import { renderStretch } from '@/tools/lib/timestretch/render';
  import { frameSize, memoryNote, semitonesToRatio, type SoundKind } from '@/tools/lib/timestretch/stretch';
  import AudioEditShell, { type AudioSource } from './AudioEditShell.svelte';
  import StretchOutput from './StretchOutput.svelte';

  let caps = $state.raw<Capabilities | null>(null);
  let src = $state.raw<AudioSource | null>(null);
  let semitones = $state(0);
  let cents = $state(0);
  let kind = $state<SoundKind>('music');
  let songKey = $state<Key | ''>('');
  let format = $state<OutFormat>('mp3');
  let bitrate = $state(defaultBitrate('mp3')!);

  onMount(() => {
    capabilities().then((c) => (caps = c), () => {});
  });

  const total = $derived(totalSemitones(semitones, cents));
  const ratio = $derived(semitonesToRatio(semitones, cents));
  const audio = $derived(src?.info.audio);
  const settings = $derived({ tempo: 1, pitch: ratio, fftSize: frameSize(audio?.sampleRate ?? 44100, kind) });
  const support = $derived(formatSupport(format, caps, FALLBACK_DOWNLOAD_MB));
  const blocker = $derived(total === 0 ? 'Pick a new pitch first: at 0 semitones nothing changes.' : support.ok ? '' : (support.note ?? ''));
  const hint = $derived(
    [`about ${formatBytes(estimateBytes(format, src?.info.durationSec ?? 0, bitrate, audio?.sampleRate, audio?.channels))} · same length, new pitch`, memoryNote(src?.info.durationSec ?? 0, audio?.sampleRate ?? 44100, audio?.channels ?? 2, 1)]
      .filter(Boolean)
      .join(' · '),
  );
  const settingsKey = $derived(JSON.stringify([settings, format, bitrate]));
  const ticks = [-12, -6, 0, 6, 12];

  function onsource(s: AudioSource | null) {
    src = s;
    if (s) format = s.info.container === 'wav' ? 'wav' : 'mp3';
  }

  const nudge = (d: number) => (semitones = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, semitones + d)));

  function reset() {
    semitones = 0;
    cents = 0;
  }

  function begin(s: AudioSource) {
    const opts = { settings: { ...settings }, format, bitrate, label: 'Changing pitch…' };
    const name = downloadName(s.file.name, format, pitchSuffix(semitones, cents));
    return async (ctl: StatusControl) => {
      const out = await renderStretch(s.blob, opts, ctl);
      return { blob: out.blob, name, durationSec: out.durationSec, note: out.safetyDb ? `lowered ${Math.abs(out.safetyDb).toFixed(1)} dB to avoid clipping` : undefined };
    };
  }
</script>

<AudioEditShell action="Change pitch" {settingsKey} {blocker} {hint} {begin} {onsource}>
  {#snippet editor(s, media)}
    <div class="grid gap-4">
      <section class="card dial" aria-label="Pitch">
        <div class="flex items-center justify-between gap-3">
          <span class="label m-0">pitch</span>
          <button type="button" class="btn small" onclick={reset} disabled={total === 0}>Reset</button>
        </div>

        <div class="readout">
          <button type="button" class="btn step" onclick={() => nudge(-1)} disabled={semitones <= -MAX_SEMITONES} aria-label="Down one semitone">−</button>
          <div class="text-center min-w-0">
            <p class="big" class:moved={total !== 0}>{semitoneLabel(total)}</p>
            <p class="mono">{intervalName(semitones)}{cents ? `, ${cents > 0 ? '+' : '−'}${Math.abs(cents)} cents` : ''} · frequencies × {ratio.toFixed(3)}</p>
          </div>
          <button type="button" class="btn step" onclick={() => nudge(1)} disabled={semitones >= MAX_SEMITONES} aria-label="Up one semitone">+</button>
        </div>

        <div>
          <input type="range" min={-MAX_SEMITONES} max={MAX_SEMITONES} step="1" bind:value={semitones} aria-label="Semitones" aria-valuetext={semitoneLabel(semitones)} class="w-full accent-(--color-sun)" />
          <div class="ticks mono" aria-hidden="true">
            {#each ticks as t (t)}<span>{t > 0 ? `+${t}` : t}</span>{/each}
          </div>
        </div>

        <div class="extras">
          <label>
            <span class="label">fine-tune · {cents > 0 ? '+' : ''}{cents} cents</span>
            <input type="range" min={-MAX_CENTS} max={MAX_CENTS} step="1" bind:value={cents} class="w-full accent-(--color-sun)" />
          </label>
          <label>
            <span class="label">song key (optional)</span>
            <span class="flex items-center gap-3">
              <select class="field key" bind:value={songKey}>
                <option value="">not sure</option>
                {#each KEYS as k (k)}<option value={k}>{k}</option>{/each}
              </select>
              {#if songKey}
                <span class="mono whitespace-nowrap">→ <b class="to">{transposeKey(songKey, Math.round(total))}</b>{Math.round(total) !== total ? ' (approx.)' : ''}</span>
              {/if}
            </span>
          </label>
          <div>
            <span class="label">sound</span>
            <div class="seg" role="group" aria-label="Type of sound">
              <button type="button" aria-pressed={kind === 'music'} onclick={() => (kind = 'music')}>music</button>
              <button type="button" aria-pressed={kind === 'voice'} onclick={() => (kind = 'voice')}>voice</button>
            </div>
          </div>
        </div>
      </section>

      <StretchOutput source={s} {media} {settings} unchanged={total === 0} {caps} bind:format bind:bitrate />
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
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
  }
  .big {
    font: 400 clamp(34px, 7vw, 48px) / 1.05 var(--font-serif);
    color: var(--color-soft);
    transition: color 0.2s;
    &.moved {
      color: var(--color-sun);
    }
  }
  .step {
    width: 48px;
    height: 48px;
    padding: 0;
    font-size: 22px;
  }
  .small {
    padding: 7px 12px;
    font-size: 13px;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
    padding: 0 2px;
  }
  .extras {
    display: grid;
    grid-template-columns: 1.2fr 1fr auto;
    gap: 16px 24px;
    align-items: start;
  }
  @media (max-width: 720px) {
    .extras {
      grid-template-columns: 1fr;
    }
  }
  .key {
    width: auto;
    min-width: 120px;
    padding: 8px 12px;
  }
  .to {
    font-weight: 500;
    color: var(--color-sun);
  }
</style>
