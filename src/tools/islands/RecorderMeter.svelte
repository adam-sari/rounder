<script lang="ts">
  /* A small live input meter for a microphone stream, shared by the recorders. */
  import { levelMeter } from '@/tools/lib/recorder/audio';

  let { stream, muted = false }: { stream: MediaStream; muted?: boolean } = $props();

  let level = $state(0);

  $effect(() => {
    if (!stream.getAudioTracks().length) return;
    let meter: ReturnType<typeof levelMeter>;
    try {
      meter = levelMeter(stream);
    } catch {
      // e.g. Firefox refuses a mic whose sample rate differs from the output's; the meter is only a nicety
      return;
    }
    let frame = 0;
    let shown = 0;
    const loop = () => {
      // fall back slowly so speech reads as a steady bar rather than flicker
      level = shown = Math.max(meter.read(), shown * 0.85);
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      meter.close();
      level = 0;
    };
  });
</script>

<span class="meter" class:muted class:hot={level > 0.9} role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={muted ? 0 : Math.round(level * 100)}>
  <span style:width="{muted ? 0 : level * 100}%"></span>
</span>

<style>
  .meter {
    display: block;
    width: 100%;
    height: 6px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-ok);
      transition: background 0.2s;
    }
    &.hot span {
      background: var(--color-sun);
    }
    &.muted {
      opacity: 0.4;
    }
  }
</style>
