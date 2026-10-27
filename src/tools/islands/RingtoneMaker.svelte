<script lang="ts">
  import { onMount } from 'svelte';
  import TrimTimeline from '@/components/tool/TrimTimeline.svelte';
  import { capabilities, downloadName, formatBytes, waveform, FALLBACK_DOWNLOAD_MB, type Capabilities, type Peaks, type StatusControl } from '@/engines/media';
  import { estimateBytes, formatSupport } from '@/tools/lib/audio-cutter/edit';
  import { renderAudio } from '@/tools/lib/audio-cutter/render';
  import { brandAsM4a, DEFAULT_SEC, guessPlatform, LENGTHS, limitSelection, loudestWindow, M4R_MIME, MAX_SEC, windowAt, type Platform } from '@/tools/lib/ringtone-maker/ringtone';
  import { withExtension, withSuffix } from '@/tools/lib/files';
  import AudioEditShell, { type AudioSource } from './AudioEditShell.svelte';
  import AudioFadeControls from './AudioFadeControls.svelte';

  const BITRATE = 192_000;

  let caps = $state.raw<Capabilities | null>(null);
  let src = $state.raw<AudioSource | null>(null);
  let peaks = $state.raw<Peaks | null>(null);
  let peaksFailed = $state(false);
  let start = $state(0);
  let end = $state(0);
  let loop = $state(true);
  let fadeIn = $state(0.5);
  let fadeOut = $state(1.5);
  let platform = $state<Platform>('iphone');
  let peaksJob: AbortController | null = null;

  onMount(() => {
    platform = guessPlatform(navigator.userAgent);
    capabilities().then((c) => (caps = c), () => {});
    return () => peaksJob?.abort();
  });

  const duration = $derived(src?.info.durationSec ?? 0);
  const len = $derived(Math.max(0, end - start));
  const m4a = $derived(formatSupport('m4a', caps, FALLBACK_DOWNLOAD_MB));
  const blocker = $derived(platform === 'iphone' && !m4a.ok ? (m4a.note ?? '') : len < 1 ? 'Pick at least one second.' : '');
  const hint = $derived(`${len.toFixed(1)} s of ${MAX_SEC} s max · about ${formatBytes(estimateBytes('mp3', len, BITRATE))}`);
  const settingsKey = $derived(JSON.stringify([start, end, fadeIn, fadeOut, platform]));

  // the handle being dragged stops at 40 s
  let prev = { start: 0, end: 0 };
  $effect(() => {
    const next = limitSelection(start, end, prev, MAX_SEC);
    prev = next;
    if (next.start !== start) start = next.start;
    if (next.end !== end) end = next.end;
  });

  function onsource(s: AudioSource | null) {
    src = s;
    peaks = null;
    peaksFailed = false;
    peaksJob?.abort();
    if (!s) return;
    ({ start, end } = windowAt(0, DEFAULT_SEC, s.info.durationSec));
    prev = { start, end };
    const job = (peaksJob = new AbortController());
    waveform(s.blob, 2000, {}, { signal: job.signal }).then(
      (p) => {
        if (job.signal.aborted) return;
        peaks = p;
        // nobody has moved the selection yet: start on the loudest stretch, usually the chorus
        if (start === 0 && Math.abs(end - Math.min(DEFAULT_SEC, s.info.durationSec)) < 1e-6) jumpToLoudest();
      },
      () => !job.signal.aborted && (peaksFailed = true),
    );
  }

  function jumpToLoudest() {
    if (!peaks) return;
    ({ start, end } = windowAt(loudestWindow(peaks.rms, duration, len), len, duration));
  }

  function setLength(l: number) {
    ({ start, end } = windowAt(start, l, duration));
  }

  function begin(s: AudioSource) {
    const opts = { segments: [{ start, end }], format: platform === 'iphone' ? ('m4a' as const) : ('mp3' as const), bitrate: BITRATE, fadeIn, fadeOut };
    const iphone = platform === 'iphone';
    return async (ctl: StatusControl) => {
      const out = await renderAudio(s.blob, opts, ctl);
      if (!iphone) return { blob: out.blob, name: downloadName(s.file.name, 'mp3', '-ringtone'), durationSec: out.durationSec };
      // .m4r is an .m4a with Apple's brand and a different extension; preview the plain copy
      const bytes = brandAsM4a(new Uint8Array(await out.blob.arrayBuffer()));
      return {
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: M4R_MIME }),
        preview: out.blob,
        name: withExtension(withSuffix(s.file.name, '-ringtone'), 'm4r'),
        durationSec: out.durationSec,
      };
    };
  }
</script>

<AudioEditShell action="Make ringtone" {settingsKey} {blocker} {hint} {begin} {onsource}>
  {#snippet editor(s, media)}
    <div class="grid gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="seg" role="group" aria-label="Ringtone length">
            {#each LENGTHS as l}
              {@const off = l > duration + 0.05 && l !== LENGTHS[0]}
              <button type="button" aria-pressed={!off && Math.abs(len - Math.min(l, duration)) < 0.05} disabled={off} onclick={() => setLength(l)}>{l} s</button>
            {/each}
          </div>
          <button type="button" class="btn loud" onclick={jumpToLoudest} disabled={!peaks || duration <= len}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 9v-2M5 12V4M8 14V2M11 11V5M14 9V7" /></svg>
            Jump to the loudest part
          </button>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={loop} />
          <span>Loop playback</span>
        </label>
      </div>

      <TrimTimeline kind="audio" {peaks} duration={s.info.durationSec} {media} {loop} step={0.01} bind:start bind:end />
      {#if !peaks}
        <p class="mono" aria-live="polite">{peaksFailed ? "The waveform couldn't be drawn, but the handles and export still work." : 'drawing waveform…'}</p>
      {/if}
      <p class="mono">Drag the handles or the whole selection. iPhone ringtones can be up to {MAX_SEC} seconds; 30 is a good length for a call.</p>

      <div class="settings card">
        <AudioFadeControls bind:fadeIn bind:fadeOut total={len} max={5} />
        <div>
          <span class="label">phone</span>
          <div class="seg" role="group" aria-label="Phone">
            <button type="button" aria-pressed={platform === 'iphone'} onclick={() => (platform = 'iphone')}>iPhone · .m4r</button>
            <button type="button" aria-pressed={platform === 'android'} onclick={() => (platform = 'android')}>Android · .mp3</button>
          </div>
          {#if platform === 'iphone' && !m4a.ok && caps}
            <p class="mono mt-1">{m4a.note} Choose Android for an MP3, which GarageBand can turn into a ringtone.</p>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet done(out)}
    <div class="how">
      {#if out.name.endsWith('.m4r')}
        <p class="font-serif text-xl">Put it on your iPhone</p>
        <ol>
          <li><b>Mac:</b> connect your iPhone, select it in the Finder sidebar, and drag the .m4r file onto its window. It syncs into your tones.</li>
          <li><b>Windows:</b> in iTunes, select your iPhone, open <i>Tones</i> under <i>On My Device</i>, and drag the file in.</li>
          <li><b>No computer:</b> choose <i>Android · .mp3</i> above to get an MP3, save it to Files, import it into a GarageBand project, then in <i>My Songs</i> touch and hold the project and choose <i>Share › Ringtone</i>. GarageBand keeps up to 30 seconds.</li>
          <li>Then pick it in <i>Settings › Sounds &amp; Haptics › Ringtone</i>.</li>
        </ol>
      {:else}
        <p class="font-serif text-xl">Put it on your Android phone</p>
        <ol>
          <li>Get the MP3 onto your phone: download it there directly, or copy it over USB into the <i>Ringtones</i> folder.</li>
          <li>Open <i>Settings › Sound &amp; vibration › Phone ringtone</i> and choose it. If it isn't listed, use the <i>+</i> or <i>Add</i> option to pick the file.</li>
          <li>Menu names vary a little between phone makers.</li>
        </ol>
      {/if}
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
  .loud {
    padding: 8px 12px;
    font-size: 13.5px;
    & svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: var(--color-sun);
      stroke-width: 1.8;
      stroke-linecap: round;
    }
  }
  .how {
    display: grid;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--color-line);
    & ol {
      display: grid;
      gap: 6px;
      padding-left: 20px;
      list-style: decimal;
      color: var(--color-soft);
      font-size: 14.5px;
    }
    & b {
      color: var(--color-chalk);
      font-weight: 500;
    }
    & i {
      font-style: normal;
      color: var(--color-chalk);
    }
  }
</style>
