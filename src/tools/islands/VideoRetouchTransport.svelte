<script lang="ts">
  import { clock } from '@/tools/lib/video-retouch/job';

  interface Props {
    video: HTMLVideoElement | null;
    /** times are shown divided by this, i.e. on the output's timeline */
    rate?: number;
  }

  let { video, rate = 1 }: Props = $props();

  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);

  $effect(() => {
    const v = video;
    if (!v) return;
    let raf = 0;
    const sync = () => {
      time = v.currentTime;
      duration = Number.isFinite(v.duration) ? v.duration : 0;
      playing = !v.paused;
    };
    // timeupdate only fires a few times a second; follow playback per frame so the scrubber glides
    const loop = () => {
      sync();
      raf = v.paused ? 0 : requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const events = ['loadedmetadata', 'durationchange', 'pause', 'seeked', 'timeupdate', 'ended', 'emptied'];
    for (const e of events) v.addEventListener(e, sync);
    v.addEventListener('play', onPlay);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) v.removeEventListener(e, sync);
      v.removeEventListener('play', onPlay);
    };
  });

  function toggle() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
</script>

<div class="transport">
  <button type="button" class="play" onclick={toggle} disabled={!video} aria-label={playing ? 'Pause preview' : 'Play preview'}>
    {#if playing}
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
    {/if}
  </button>
  <input
    type="range"
    min="0"
    max={duration || 1}
    step="0.01"
    value={time}
    disabled={!duration}
    aria-label="Seek preview"
    oninput={(e) => video && (video.currentTime = Number(e.currentTarget.value))}
  />
  <span class="mono time">{clock(time / rate)} / {clock(duration / rate)}</span>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .play {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-chalk);
    cursor: pointer;
    & svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    &:hover:not(:disabled) {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }
  input {
    flex: 1;
    min-width: 0;
    accent-color: var(--color-sun);
  }
  .time {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
