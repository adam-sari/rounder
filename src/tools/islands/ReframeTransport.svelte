<script lang="ts">
  import { formatTime } from '@/engines/media/math';

  interface Props {
    time: number;
    playing: boolean;
    duration: number;
    /** false when only still frames can be shown */
    canPlay?: boolean;
  }

  let { time = $bindable(0), playing = $bindable(false), duration, canPlay = true }: Props = $props();

  function toggle() {
    // at the end, play from the start again (otherwise the clock would seek every layer straight back to the end)
    if (!playing && duration && time >= duration - 0.05) time = 0;
    playing = !playing;
  }
</script>

<div class="transport">
  <button type="button" class="play" disabled={!canPlay} aria-label={playing ? 'Pause' : 'Play'} onclick={toggle}>
    {#if playing}
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
    {:else}
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.4-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7z" /></svg>
    {/if}
  </button>
  <input
    type="range"
    min="0"
    max={duration}
    step="0.01"
    value={time}
    style:--p={`${(time / (duration || 1)) * 100}%`}
    aria-label="Position in the video"
    aria-valuetext={formatTime(time, 1)}
    oninput={(e) => (time = Number(e.currentTarget.value))}
  />
  <span class="mono tabular-nums">{formatTime(time, 1)} / {formatTime(duration, 1)}</span>
</div>

<style>
  .transport {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }
  .play {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-chalk);
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s;
    &:hover:not(:disabled) {
      border-color: var(--color-sun);
    }
    &:active:not(:disabled) {
      transform: scale(0.94);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    & svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  }
  input[type='range'] {
    appearance: none;
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--color-sun) var(--p), var(--color-line-2) var(--p));
    cursor: pointer;
    &::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-chalk);
      border: 0;
    }
    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-chalk);
      border: 0;
    }
  }
</style>
