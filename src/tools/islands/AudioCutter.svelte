<script lang="ts">
  import { onMount } from 'svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import { FALLBACK_DOWNLOAD_MB, capabilities, downloadName, formatBytes, segmentsDuration, type Capabilities, type Segment, type StatusControl } from '@/engines/media';
  import { bitrates, defaultBitrate, estimateBytes, formatLabel, formatSupport, isLossy, keptSegments, sameFormat, type OutFormat } from '@/tools/lib/audio-cutter/edit';
  import { renderAudio } from '@/tools/lib/audio-cutter/render';
  import AudioEditShell, { type AudioSource } from './AudioEditShell.svelte';
  import AudioFadeControls from './AudioFadeControls.svelte';

  // a preset from the address (/audio-cutter#start=10): where the kept part starts and ends, in seconds
  let { start: startAt = 0, end: endAt }: { start?: number; end?: number } = $props();

  let caps = $state.raw<Capabilities | null>(null);
  let src = $state.raw<AudioSource | null>(null);
  let mode = $state<'trim' | 'cut'>('trim');
  let start = $state(0);
  let end = $state(0);
  let cuts = $state<Segment[]>([]);
  let loop = $state(false);
  let fadeIn = $state(0);
  let fadeOut = $state(0);
  let choice = $state<'same' | OutFormat>('mp3');
  let rates = $state<Partial<Record<OutFormat, number>>>({});

  onMount(() => {
    capabilities().then((c) => (caps = c), () => {});
  });

  const duration = $derived(src?.info.durationSec ?? 0);
  const same = $derived(src && !src.converted ? sameFormat(src.info) : null);
  const format = $derived<OutFormat>(choice === 'same' && same ? same : choice === 'same' ? 'mp3' : choice);
  const kept = $derived(keptSegments(mode, start, end, cuts, duration));
  const keptLen = $derived(segmentsDuration(kept));
  const support = $derived(formatSupport(format, caps, FALLBACK_DOWNLOAD_MB));
  // the engine folds surround down to stereo, which means a re-encode
  const copy = $derived(choice === 'same' && kept.length === 1 && !fadeIn && !fadeOut && (src?.info.audio?.channels ?? 2) <= 2);
  const bitrate = $derived(rates[format] ?? defaultBitrate(format));

  const choices = $derived<['same' | OutFormat, string][]>([
    ...(same ? [['same', `same (${formatLabel[same]})`] as ['same', string]] : []),
    ...(['mp3', 'm4a', 'wav', 'ogg'] as OutFormat[]).map((f) => [f, formatLabel[f]] as [OutFormat, string]),
  ]);
  const unavailable = $derived(choices.filter(([c]) => c !== 'same' && !formatSupport(c, caps, FALLBACK_DOWNLOAD_MB).ok && caps));

  const blocker = $derived(
    keptLen < 0.1 ? 'Nothing left to export: the cuts cover the whole file.' : !support.ok ? (support.note ?? '') : '',
  );
  const hint = $derived.by(() => {
    // FLAC can only be written by the fallback encoder: lossless, but not a byte copy
    if (copy) return support.download ? `Same format, no fades: lossless, no quality loss · ${support.note}` : 'Same format, no fades: the audio is cut without re-encoding, so there is no quality loss.';
    const size = `about ${formatBytes(estimateBytes(format, keptLen, bitrate, src?.info.audio?.sampleRate, src?.info.audio?.channels))}`;
    return support.download ? `${size} · ${support.note}` : size;
  });
  const settingsKey = $derived(JSON.stringify([kept, fadeIn, fadeOut, format, copy, bitrate]));

  function onsource(s: AudioSource | null) {
    src = s;
    if (!s) return;
    mode = 'trim';
    start = startAt < s.info.durationSec ? startAt : 0;
    end = endAt && endAt > start && endAt < s.info.durationSec ? endAt : s.info.durationSec;
    cuts = [];
    choice = !s.converted && sameFormat(s.info) ? 'same' : 'mp3';
  }

  function setMode(m: 'trim' | 'cut') {
    mode = m;
    // start "remove parts" with one cut in the middle, so there's something to drag
    if (m === 'cut' && !cuts.length && duration > 1) cuts = [{ start: duration * 0.45, end: duration * 0.55 }];
  }

  function begin(s: AudioSource) {
    const opts = { segments: kept.map((k) => ({ ...k })), format, bitrate: isLossy(format) ? bitrate : undefined, fadeIn, fadeOut, sameAsSource: copy };
    const name = downloadName(s.file.name, format, '-cut');
    return async (ctl: StatusControl) => {
      const out = await renderAudio(s.blob, opts, ctl);
      return { blob: out.blob, name, durationSec: out.durationSec, note: out.copied ? (opts.format === 'flac' ? 'lossless' : 'no re-encoding') : undefined };
    };
  }
</script>

<AudioEditShell action="Cut audio" {settingsKey} {blocker} {hint} {begin} {onsource}>
  {#snippet editor(s, media)}
    <div class="grid gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="seg" role="group" aria-label="What to do with the selection">
          <button type="button" aria-pressed={mode === 'trim'} onclick={() => setMode('trim')}>keep selection</button>
          <button type="button" aria-pressed={mode === 'cut'} onclick={() => setMode('cut')}>remove parts</button>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={loop} />
          <span>Loop playback</span>
        </label>
      </div>

      <TrimTimeline
        file={s.blob}
        kind="audio"
        duration={s.info.durationSec}
        {media}
        {loop}
        step={0.01}
        mode={mode === 'trim' ? 'trim' : 'segments'}
        segmentKind="cut"
        bind:start
        bind:end
        bind:segments={cuts}
      />
      {#if mode === 'cut'}
        <p class="mono">Striped parts are removed and the rest is joined with a tiny crossfade, so there are no clicks. Add as many cuts as you need.</p>
      {/if}

      <div class="settings card">
        <AudioFadeControls bind:fadeIn bind:fadeOut total={keptLen} />

        <div class="grid gap-3 content-start">
          <div>
            <span class="label">output format</span>
            <div class="seg" role="group" aria-label="Output format">
              {#each choices as [value, label] (value)}
                {@const ok = value === 'same' || formatSupport(value, caps, FALLBACK_DOWNLOAD_MB).ok}
                <button type="button" aria-pressed={choice === value} disabled={!ok} onclick={() => (choice = value)}>{label}</button>
              {/each}
            </div>
            {#each unavailable as [f]}
              <p class="mono mt-1">{formatLabel[f as OutFormat]}: {formatSupport(f as OutFormat, caps, FALLBACK_DOWNLOAD_MB).note}</p>
            {/each}
          </div>

          {#if isLossy(format) && !copy}
            <div>
              <span class="label">quality</span>
              <div class="seg" role="group" aria-label="Bitrate">
                {#each bitrates[format] ?? [] as r}
                  <button type="button" aria-pressed={bitrate === r} onclick={() => (rates[format] = r)}>{r / 1000} kbps</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}
</AudioEditShell>

<style>
  .settings {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px 28px;
    padding: 18px;
  }
  @media (max-width: 720px) {
    .settings {
      grid-template-columns: 1fr;
    }
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
