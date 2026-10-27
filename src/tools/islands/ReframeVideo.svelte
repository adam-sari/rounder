<script lang="ts">
  /*
   * One layer of a video preview, kept on a shared clock (`time`, `playing`). The lead layer
   * drives the clock and plays the sound; others (a blurred backdrop) follow it muted.
   * With `still` set it shows that image instead, for videos the browser can't play.
   */
  interface Props {
    src: string;
    still?: string | null;
    time: number;
    playing: boolean;
    lead?: boolean;
    style?: string;
    onfail?: () => void;
  }

  let { src, still = null, time = $bindable(0), playing = $bindable(false), lead = false, style = '', onfail }: Props = $props();

  let el = $state<HTMLVideoElement>();

  // seek when the clock moved away from this element (a scrub, or a follower drifting)
  $effect(() => {
    if (!el) return;
    if (Math.abs(el.currentTime - time) > (playing ? 0.3 : 0.02)) el.currentTime = time;
  });

  $effect(() => {
    if (!el) return;
    if (playing) el.play().catch(() => lead && (playing = false));
    else el.pause();
  });

  // the lead reports its position every frame while playing, for a smooth scrubber
  $effect(() => {
    if (!lead || !el || !playing) return;
    const video = el;
    let id = requestAnimationFrame(function tick() {
      time = video.currentTime;
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  });
</script>

{#if still}
  <img src={still} alt="" {style} />
{:else}
  <video
    bind:this={el}
    src={`${src}#t=0.001`}
    {style}
    muted={!lead}
    playsinline
    preload="auto"
    disablepictureinpicture
    onended={() => {
      if (!lead) return;
      playing = false;
      time = el!.currentTime;
    }}
    onerror={() => onfail?.()}
  ><track kind="captions" /></video>
{/if}

<style>
  video,
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
</style>
