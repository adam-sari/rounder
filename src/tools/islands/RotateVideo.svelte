<script lang="ts">
  import { bitmapToBlob, downloadName, frameAt, transcode } from '@/engines/media';
  import { cssTransform, describe, engineOptions, fileSuffix, isIdentity, outputSize, previewBox, turn, type Orientation } from '@/tools/lib/rotate-video/orientation';
  import VideoRetouchShell, { type RetouchJob, type RetouchSource } from './VideoRetouchShell.svelte';
  import VideoRetouchTransport from './VideoRetouchTransport.svelte';

  let o = $state<Orientation>({ turns: 0, flipX: false, flipY: false });
  let tag = $state(0);
  let videoEl = $state<HTMLVideoElement | null>(null);
  // a still frame stands in when this browser's <video> can't play the file
  let still = $state('');
  let stageW = $state(600);
  let current: RetouchSource | null = null;

  const stageH = $derived(Math.round(Math.min(440, Math.max(220, stageW * 0.6))));

  function onsource(src: RetouchSource) {
    o = { turns: 0, flipX: false, flipY: false };
    tag = src.info.video?.rotation ?? 0;
    current = src;
    setStill('');
  }

  function setStill(url: string) {
    if (still) URL.revokeObjectURL(still);
    still = url;
  }
  $effect(() => () => setStill(''));

  async function showStill(src: RetouchSource) {
    try {
      const bitmap = await frameAt(src.file, Math.min(1, src.info.durationSec / 2), { height: 720 });
      const blob = await bitmapToBlob(bitmap, 'image/jpeg', 0.85);
      bitmap.close();
      // a newer file may have been dropped in while this frame decoded
      if (src === current) setStill(URL.createObjectURL(blob));
    } catch {
      // the editor still works without a picture; saving reports any real problem
    }
  }

  const blocked = $derived(isIdentity(o) && !tag ? 'Turn or flip the video first' : null);

  function run({ source, container, signal, onProgress, onStatus }: RetouchJob) {
    // quality forces a re-encode even with no turn, which is what bakes in a rotation tag
    return transcode(source.file, { container, video: { ...engineOptions(o), quality: 'high' } }, { signal, onProgress, onStatus });
  }

  const buttons = [
    { label: 'Rotate left 90°', act: () => (o = turn(o, false)), icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />' },
    { label: 'Rotate right 90°', act: () => (o = turn(o, true)), icon: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />' },
    { label: 'Rotate 180°', act: () => (o = { ...o, turns: o.turns + 2 }), icon: '' },
    { label: 'Flip horizontally', act: () => (o = { ...o, flipX: !o.flipX }), icon: '<path d="m3 7 5 5-5 5V7" /><path d="m21 7-5 5 5 5V7" /><path d="M12 2v2M12 8v2M12 14v2M12 20v2" />' },
    { label: 'Flip vertically', act: () => (o = { ...o, flipY: !o.flipY }), icon: '<path d="m17 3-5 5-5-5h10" /><path d="m17 21-5-5-5 5h10" /><path d="M2 12h2M8 12h2M14 12h2M20 12h2" />' },
  ];
</script>

<VideoRetouchShell action="Save rotated video" {blocked} {run} {onsource} outputName={(name, c) => downloadName(name, c, fileSuffix(o))}>
  {#snippet editor(src)}
    {@const w = src.info.video?.displayWidth || 16}
    {@const h = src.info.video?.displayHeight || 9}
    {@const box = previewBox(stageW - 24, stageH - 24, w, h, o)}
    {@const out = outputSize(w, h, o)}
    <div class="layout">
      <div class="grid gap-3">
        <div class="stage" style="height:{stageH}px" bind:clientWidth={stageW}>
          <div class="frame" style="width:{box.frame.width}px;height:{box.frame.height}px">
            {#if still}
              <img src={still} alt="A frame of your video with the current rotation" style="width:{box.element.width}px;height:{box.element.height}px;transform:{cssTransform(o)}" />
            {:else}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                bind:this={videoEl}
                src={src.url}
                playsinline
                loop
                preload="metadata"
                aria-label="Preview of your video with the current rotation"
                style="width:{box.element.width}px;height:{box.element.height}px;transform:{cssTransform(o)}"
                onerror={() => showStill(src)}
              ></video>
            {/if}
          </div>
        </div>
        {#if still}
          <p class="mono">This browser can't play this file as a preview, so here's a still frame. Saving works the same.</p>
        {:else}
          <VideoRetouchTransport video={videoEl} />
        {/if}
      </div>

      <div class="grid content-start gap-4">
        <div>
          <span class="label">rotate & flip</span>
          <div class="grid grid-cols-5 gap-2">
            {#each buttons as b}
              <button type="button" class="btn icon" onclick={b.act} aria-label={b.label} title={b.label}>
                {#if b.icon}
                  <svg viewBox="0 0 24 24" aria-hidden="true">{@html b.icon}</svg>
                {:else}
                  <span class="mono text-chalk!">180°</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="summary">
          <p class="flex items-center justify-between gap-2">
            <span aria-live="polite">{describe(o)}</span>
            <button type="button" class="reset mono" onclick={() => (o = { turns: 0, flipX: false, flipY: false })} disabled={isIdentity(o)}>reset</button>
          </p>
          <p class="mono">output {out.width}×{out.height}</p>
        </div>

        {#if tag}
          <p class="note">
            This video has a {tag}° rotation tag. Most players follow it, so the preview shows the video the way they do. Saving bakes the turn into the
            picture itself, so apps that ignore the tag show it the right way up too.
          </p>
        {/if}
      </div>
    </div>
  {/snippet}
</VideoRetouchShell>

<style>
  .layout {
    display: grid;
    gap: 20px;
    @media (min-width: 760px) {
      grid-template-columns: minmax(0, 1fr) 280px;
    }
  }
  .stage {
    display: grid;
    place-items: center;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #0d0c0b;
    overflow: hidden;
  }
  .frame {
    position: relative;
    outline: 1px solid var(--color-sun);
    border-radius: 2px;
    transition:
      width 0.3s ease,
      height 0.3s ease;
    & video,
    & img {
      position: absolute;
      left: 50%;
      top: 50%;
      max-width: none;
      object-fit: fill;
      background: #000;
      transition:
        transform 0.3s ease,
        width 0.3s ease,
        height 0.3s ease;
    }
  }
  .icon {
    padding: 0;
    height: 44px;
    & svg {
      width: 19px;
      height: 19px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
  .summary {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: #141312;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid var(--color-sun);
  }
  .reset {
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-sun);
    cursor: pointer;
    &:disabled {
      color: var(--color-muted);
      opacity: 0.5;
      cursor: default;
    }
  }
</style>
