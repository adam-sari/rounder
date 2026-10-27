<script lang="ts">
  import { onDestroy } from 'svelte';
  import { FALLBACK_DOWNLOAD_MB, formatTime, type Capabilities, type Pcm } from '@/engines/media';
  import { bitrates, defaultBitrate, errorText, formatLabel, formatSupport, isLossy, type OutFormat } from '@/tools/lib/audio-cutter/edit';
  import { decodePreview, pcmToWav, PREVIEW_SEC, renderPreview } from '@/tools/lib/timestretch/render';
  import type { StretchSettings } from '@/tools/lib/timestretch/stretch';
  import type { AudioSource } from './AudioEditShell.svelte';

  /*
   * The parts the pitch and speed tools share: a 10-second preview rendered with the real
   * algorithm (with an original/changed switch), and the output format picker.
   */

  interface Props {
    source: AudioSource;
    /** the shell's player: its position picks where the preview starts */
    media: HTMLAudioElement | null;
    settings: StretchSettings;
    /** at the identity setting there is nothing to preview */
    unchanged: boolean;
    caps: Capabilities | null;
    format: OutFormat;
    bitrate: number;
  }

  let { source, media, settings, unchanged, caps, format = $bindable(), bitrate = $bindable() }: Props = $props();

  const FORMATS: OutFormat[] = ['mp3', 'm4a', 'wav', 'ogg'];

  let playhead = $state(0);
  let slice = $state.raw<{ start: number; pcm: Pcm } | null>(null);
  let origUrl = $state('');
  let changedUrl = $state('');
  let madeWith = $state('');
  /** tempo of the rendered preview, for mapping positions between the two versions */
  let madeTempo = 1;
  let showing = $state<'changed' | 'original'>('changed');
  let busy = $state(false);
  let error = $state('');
  let player = $state<HTMLAudioElement | null>(null);
  let resume: { at: number; play: boolean } | null = null;
  let controller: AbortController | null = null;

  const key = $derived(JSON.stringify(settings));
  const duration = $derived(source.info.durationSec);
  const start = $derived(Math.max(0, Math.min(playhead, duration - PREVIEW_SEC)));

  $effect(() => {
    const m = media;
    if (!m) return;
    const sync = () => (playhead = m.currentTime);
    const onPlay = () => player?.pause();
    m.addEventListener('timeupdate', sync);
    m.addEventListener('seeked', sync);
    m.addEventListener('play', onPlay);
    return () => {
      m.removeEventListener('timeupdate', sync);
      m.removeEventListener('seeked', sync);
      m.removeEventListener('play', onPlay);
    };
  });

  // once there is a preview, keep it in step with the settings (back at the identity it plays the original)
  $effect(() => {
    if (!changedUrl || key === madeWith) return;
    const t = setTimeout(() => preview(slice?.start ?? start, false), 350);
    return () => clearTimeout(t);
  });

  /** where the player is, in seconds of the source */
  function sourceTime() {
    if (!player) return 0;
    return showing === 'changed' ? player.currentTime * madeTempo : player.currentTime;
  }

  async function preview(at: number, fresh: boolean) {
    controller?.abort();
    const ctl = (controller = new AbortController());
    const wasPlaying = !!player && !player.paused;
    const pos = fresh ? 0 : sourceTime();
    const snapshot = settings;
    const k = key;
    busy = true;
    error = '';
    try {
      if (!slice || slice.start !== at) {
        const pcm = await decodePreview(source.blob, at, { signal: ctl.signal });
        // a newer preview may have started (and decoded its own slice) meanwhile
        if (ctl !== controller) return;
        if (origUrl) URL.revokeObjectURL(origUrl);
        slice = { start: at, pcm };
        origUrl = URL.createObjectURL(pcmToWav(pcm));
      }
      const out = await renderPreview(slice.pcm, snapshot, { signal: ctl.signal });
      if (ctl !== controller) return;
      if (changedUrl) URL.revokeObjectURL(changedUrl);
      changedUrl = URL.createObjectURL(out.wav);
      madeWith = k;
      madeTempo = snapshot.tempo;
      showing = 'changed';
      resume = { at: pos, play: fresh || wasPlaying };
    } catch (e) {
      if (ctl === controller) error = errorText(e);
    } finally {
      if (ctl === controller) {
        busy = false;
        controller = null;
      }
    }
  }

  function show(which: 'changed' | 'original') {
    if (which === showing) return;
    resume = { at: sourceTime(), play: !!player && !player.paused };
    showing = which;
  }

  /** a new src has loaded: put the playhead back where the listener was */
  function onLoaded() {
    if (!player || !resume) return;
    const { at, play } = resume;
    resume = null;
    player.currentTime = showing === 'changed' ? at / madeTempo : at;
    if (play) player.play().catch(() => {});
  }

  function pick(f: OutFormat) {
    format = f;
    bitrate = defaultBitrate(f) ?? bitrate;
  }

  onDestroy(() => {
    controller?.abort();
    if (origUrl) URL.revokeObjectURL(origUrl);
    if (changedUrl) URL.revokeObjectURL(changedUrl);
  });
</script>

<div class="out">
  <section class="card panel" aria-label="Preview">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="label m-0">preview · {PREVIEW_SEC} s from {formatTime(slice && changedUrl ? slice.start : start, 0)}</span>
      {#if changedUrl}
        <div class="seg" role="group" aria-label="Which version to hear">
          <button type="button" aria-pressed={showing === 'original'} onclick={() => show('original')}>original</button>
          <button type="button" aria-pressed={showing === 'changed'} onclick={() => show('changed')}>changed</button>
        </div>
      {/if}
    </div>

    {#if changedUrl}
      <audio
        bind:this={player}
        src={showing === 'changed' ? changedUrl : origUrl}
        controls
        class="player"
        aria-label={showing === 'changed' ? 'Preview with the new settings' : 'Original preview section'}
        onloadedmetadata={onLoaded}
        onplay={() => media?.pause()}
      ></audio>
    {/if}

    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn" disabled={busy || unchanged} onclick={() => preview(start, true)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
        {changedUrl ? 'Preview from here' : `Preview ${PREVIEW_SEC} s`}
      </button>
      <span class="mono" aria-live="polite">
        {#if busy}<span class="dot" aria-hidden="true"></span>rendering…{:else if changedUrl && key !== madeWith}updating…{:else if unchanged}{changedUrl ? 'no change at this setting' : 'change a setting to hear it'}{:else}move the player above to choose the spot{/if}
      </span>
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </section>

  <section class="card panel" aria-label="Output">
    <div>
      <span class="label">output format</span>
      <div class="seg" role="group" aria-label="Output format">
        {#each FORMATS as f (f)}
          <button type="button" aria-pressed={format === f} disabled={!formatSupport(f, caps, FALLBACK_DOWNLOAD_MB).ok} onclick={() => pick(f)}>{formatLabel[f]}</button>
        {/each}
      </div>
      {#if caps}
        {#each FORMATS.filter((f) => !formatSupport(f, caps, FALLBACK_DOWNLOAD_MB).ok) as f (f)}
          <p class="mono mt-1">{formatLabel[f]}: {formatSupport(f, caps, FALLBACK_DOWNLOAD_MB).note}</p>
        {/each}
      {/if}
    </div>
    {#if isLossy(format)}
      <div>
        <span class="label">quality</span>
        <div class="seg" role="group" aria-label="Bitrate">
          {#each bitrates[format] ?? [] as r (r)}
            <button type="button" aria-pressed={bitrate === r} onclick={() => (bitrate = r)}>{r / 1000} kbps</button>
          {/each}
        </div>
      </div>
    {:else}
      <p class="mono">16-bit WAV: uncompressed, no further quality loss.</p>
    {/if}
  </section>
</div>

<style>
  .out {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 14px;
  }
  @media (max-width: 720px) {
    .out {
      grid-template-columns: 1fr;
    }
  }
  .panel {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 18px;
  }
  .player {
    width: 100%;
    height: 40px;
    color-scheme: dark;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    color: var(--color-bad);
    font-size: 14px;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 7px;
    border-radius: 50%;
    background: var(--color-sun);
    animation: pulse 0.9s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    from {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }
</style>
