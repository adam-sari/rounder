<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilities, clamp, evenize, transcode, type Capabilities, type StatusControl } from '@/engines/media';
  import { ratioLabel, scaleChoices, scaleToShortSide } from '@/tools/lib/crop-video/geometry';
  import { infoChips, pickFormat, videoFormats, type Opened, type VideoFormat } from '@/tools/lib/crop-video/job';
  import { stillFrames } from '@/tools/lib/crop-video/stills';
  import { customSide, MAX_SIDE, MIN_SIDE, overflowAxis, platforms, resizePlan, sameAspect, upscaleFactor, type FitMode } from '@/tools/lib/resize-video/layout';
  import { backdropRender } from '@/tools/lib/resize-video/render';
  import ReframeJob from './ReframeJob.svelte';
  import ReframeOpen from './ReframeOpen.svelte';
  import ReframeTransport from './ReframeTransport.svelte';
  import ReframeVideo from './ReframeVideo.svelte';

  type Tab = 'platform' | 'custom' | 'scale';
  const tabs: [Tab, string][] = [['platform', 'platform'], ['custom', 'custom size'], ['scale', 'scale down']];
  const modes: [FitMode, string][] = [['blur', 'blurred background'], ['color', 'solid color'], ['fill', 'fill & crop']];
  const resolutions = [1080, 720, 480];

  let video = $state.raw<(Opened & { url: string }) | null>(null);
  let caps = $state.raw<Capabilities | null>(null);
  let capsFailed = $state(false);
  let time = $state(0);
  let playing = $state(false);
  let stills = $state.raw<ReturnType<typeof stillFrames> | null>(null);
  let still = $state<string | null>(null);

  let tab = $state<Tab>('platform');
  let platform = $state('tiktok');
  let custom = $state({ w: 1080, h: 1920 });
  let side = $state(0);
  let mode = $state<FitMode>('blur');
  let color = $state('#000000');
  let focus = $state({ x: 0.5, y: 0.5 });
  let wanted = $state<VideoFormat | null>(null);
  let exporting = $state(false);

  let frame = $state<HTMLDivElement>();
  let pan = $state<{ id: number; x: number; y: number; from: { x: number; y: number } } | null>(null);

  const SW = $derived(video?.info.video?.displayWidth ?? 2);
  const SH = $derived(video?.info.video?.displayHeight ?? 2);
  const smaller = $derived(scaleChoices(SW, SH, resolutions));
  const scaleSide = $derived(smaller.some((c) => c.side === side) ? side : (smaller[0]?.side ?? 0));
  const target = $derived.by(() => {
    if (tab === 'platform') {
      const p = platforms.find((x) => x.key === platform) ?? platforms[0];
      return { width: p.width, height: p.height };
    }
    if (tab === 'custom') return { width: customSide(custom.w), height: customSide(custom.h) };
    return scaleSide ? scaleToShortSide(SW, SH, scaleSide) : { width: evenize(SW), height: evenize(SH) };
  });
  const reshape = $derived(tab !== 'scale' && !sameAspect(SW, SH, target.width, target.height));
  const effMode = $derived<FitMode>(reshape ? mode : 'fill');
  const axis = $derived(reshape && mode === 'fill' ? overflowAxis(SW, SH, target.width, target.height) : null);
  const upscale = $derived(upscaleFactor(SW, SH, target.width, target.height, effMode));
  const formats = $derived(videoFormats(caps, capsFailed));
  const format = $derived(pickFormat(formats, wanted, 'mp4'));
  const leadStyle = $derived(
    !reshape ? 'object-fit: fill' : mode === 'fill' ? `object-fit: cover; object-position: ${focus.x * 100}% ${focus.y * 100}%` : 'object-fit: contain',
  );
  const suffix = $derived(tab === 'platform' ? `-${platform}` : tab === 'custom' ? `-${target.width}x${target.height}` : `-${scaleSide}p`);

  onMount(() => {
    capabilities().then(
      (c) => (caps = c),
      (e) => {
        console.error(e);
        capsFailed = true;
      },
    );
  });

  function ready(v: Opened) {
    video = { ...v, url: URL.createObjectURL(v.playable) };
    time = 0;
    playing = false;
    focus = { x: 0.5, y: 0.5 };
    wanted = null;
    // people mostly reshape: landscape clips go vertical, upright clips go widescreen
    if (tab === 'platform') platform = SW >= SH ? 'tiktok' : 'youtube';
  }

  function reset() {
    exporting = false;
    video = null;
    stills = null;
    still = null;
  }

  $effect(() => {
    const url = video?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  });
  $effect(() => {
    const s = stills;
    return () => s?.close();
  });
  $effect(() => {
    stills?.show(time);
  });

  function fail() {
    if (stills || !video) return;
    playing = false;
    stills = stillFrames(video.playable, SW >= SH ? { width: Math.min(SW, 960) } : { height: Math.min(SH, 960) }, (url) => (still = url));
  }

  // fill mode: drag the picture to choose what stays in frame
  function panDown(e: PointerEvent) {
    if (!axis || e.button !== 0) return;
    e.preventDefault();
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { ...focus } };
    frame!.setPointerCapture(e.pointerId);
  }

  function panMove(e: PointerEvent) {
    if (pan?.id !== e.pointerId) return;
    const b = frame!.getBoundingClientRect();
    if (axis === 'x') {
      const over = (b.height * SW) / SH - b.width;
      if (over > 0) focus.x = clamp(pan.from.x - (e.clientX - pan.x) / over, 0, 1);
    } else {
      const over = (b.width * SH) / SW - b.height;
      if (over > 0) focus.y = clamp(pan.from.y - (e.clientY - pan.y) / over, 0, 1);
    }
  }

  function panUp(e: PointerEvent) {
    if (pan?.id === e.pointerId) pan = null;
  }

  function run(ctl: StatusControl) {
    const { backdrop, ...v } = resizePlan(SW, SH, target.width, target.height, effMode, focus);
    const render = backdrop ? backdropRender(v.width, v.height, backdrop === 'blur' ? 'blur' : { color }) : undefined;
    return transcode(video!.playable, { container: format, video: { ...v, render } }, ctl);
  }

  // applied on commit, so a half-typed "7" doesn't flash a 16 px sliver in the preview
  function setCustom(side: 'w' | 'h', input: HTMLInputElement) {
    if (input.value !== '') custom[side] = customSide(input.valueAsNumber);
    input.value = String(custom[side]);
  }

  function swatch(w: number, h: number) {
    return w >= h ? `width:18px;height:${(18 * h) / w}px` : `width:${(18 * w) / h}px;height:18px`;
  }
</script>

{#if !video}
  <ReframeOpen title="Drop a video to resize" onready={ready} />
{:else if exporting}
  <ReframeJob
    run={run}
    name={video.file.name}
    {suffix}
    sourceSize={video.file.size}
    verb="Resizing"
    onback={() => (exporting = false)}
    onreset={reset}
  />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="grid min-w-0 content-start gap-3">
      <p class="mono flex flex-wrap gap-x-3 gap-y-1">
        <span class="max-w-full truncate text-chalk">{video.file.name}</span>
        {#each infoChips(video.info) as chip}<span>{chip}</span>{/each}
      </p>
      <div class="stage">
        <div
          class="out"
          class:pannable={!!axis}
          class:panning={!!pan}
          style:--r={target.width / target.height}
          style:background={reshape && mode === 'color' ? color : '#000'}
          bind:this={frame}
          role="img"
          aria-label={`Preview of the ${target.width} by ${target.height} video${axis ? '. Drag to choose which part stays in frame.' : ''}`}
          onpointerdown={panDown}
          onpointermove={panMove}
          onpointerup={panUp}
          onpointercancel={panUp}
          onlostpointercapture={panUp}
        >
          {#if reshape && mode === 'blur'}
            <ReframeVideo src={video.url} {still} {time} {playing} style="object-fit: cover; filter: blur(14px) brightness(0.7); transform: scale(1.15)" />
          {/if}
          <ReframeVideo src={video.url} {still} bind:time bind:playing lead style={leadStyle} onfail={fail} />
          <span class="dims" aria-hidden="true">{target.width} × {target.height}</span>
        </div>
      </div>
      <ReframeTransport bind:time bind:playing duration={video.info.durationSec} canPlay={!stills} />
      {#if stills}<p class="mono">This browser can't play the file, so the preview shows still frames. Drag the slider to check other moments.</p>{/if}
      {#if axis}<p class="mono">Drag the preview or use the focus slider to choose what stays in frame.</p>{/if}
    </div>

    <aside class="grid content-start gap-5">
      <div>
        <span class="label">new size</span>
        <div class="seg" role="group" aria-label="How to choose the size">
          {#each tabs as [id, label]}
            <button type="button" aria-pressed={tab === id} onclick={() => (tab = id)}>{label}</button>
          {/each}
        </div>
      </div>

      {#if tab === 'platform'}
        <div class="presets" role="group" aria-label="Platform">
          {#each platforms as p}
            <button type="button" aria-pressed={platform === p.key} onclick={() => (platform = p.key)}>
              <i style={swatch(p.width, p.height)}></i>
              <span><b>{p.label}</b><small>{p.width} × {p.height} · {ratioLabel(p.width, p.height)}</small></span>
            </button>
          {/each}
        </div>
      {:else if tab === 'custom'}
        <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label><span class="label">width (px)</span><input class="field" type="number" min={MIN_SIDE} max={MAX_SIDE} step="2" value={custom.w} onchange={(e) => setCustom('w', e.currentTarget)} /></label>
          <button type="button" class="btn mb-px px-3!" title="Swap width and height" aria-label="Swap width and height" onclick={() => (custom = { w: custom.h, h: custom.w })}>⇄</button>
          <label><span class="label">height (px)</span><input class="field" type="number" min={MIN_SIDE} max={MAX_SIDE} step="2" value={custom.h} onchange={(e) => setCustom('h', e.currentTarget)} /></label>
        </div>
        <p class="mono -mt-2">even numbers, {MIN_SIDE}–{MAX_SIDE} px · {ratioLabel(target.width, target.height)}</p>
      {:else}
        <div>
          <div class="seg" role="group" aria-label="Resolution">
            {#each resolutions as r}
              {@const ok = smaller.some((c) => c.side === r)}
              <button type="button" aria-pressed={ok && scaleSide === r} disabled={!ok} title={ok ? undefined : 'Your video is already this size or smaller'} onclick={() => (side = r)}>{r}p</button>
            {/each}
          </div>
          <p class="mono mt-2">
            {#if smaller.length}keeps the shape · {target.width} × {target.height}{:else}Your video is already 480p or smaller, so there's nothing to scale down.{/if}
          </p>
        </div>
      {/if}

      {#if reshape}
        <div>
          <span class="label">fit</span>
          <div class="seg" role="group" aria-label="How to fit the video">
            {#each modes as [id, label]}
              <button type="button" aria-pressed={mode === id} onclick={() => (mode = id)}>{label}</button>
            {/each}
          </div>
          {#if mode === 'color'}
            <label class="mt-3 flex items-center gap-3">
              <input type="color" bind:value={color} class="swatch" />
              <span class="mono">background {color}</span>
            </label>
          {:else if mode === 'fill' && axis}
            <label class="mt-3 block">
              <span class="label">focus · {axis === 'x' ? 'left ↔ right' : 'top ↕ bottom'}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(focus[axis] * 100)}
                oninput={(e) => (focus[axis!] = Number(e.currentTarget.value) / 100)}
                aria-valuetext={`${Math.round(focus[axis] * 100)}%`}
                class="w-full accent-(--color-sun)"
              />
            </label>
          {/if}
          <p class="mono mt-2">
            {mode === 'fill' ? `The ${axis === 'x' ? 'sides are' : 'top and bottom are'} cropped so the frame has no bars.` : 'The whole video stays in view.'}
          </p>
        </div>
      {:else if tab !== 'scale'}
        <p class="mono">Your video already has this shape, so it's simply scaled to {target.width} × {target.height}.</p>
      {/if}

      {#if upscale > 1.05 && (tab !== 'scale' || smaller.length)}
        <p class="mono text-soft!">Your video is {SW} × {SH}, so it will be enlarged about {upscale.toFixed(1)}× and may look a little soft.</p>
      {/if}

      <div class="grid gap-3 border-t border-line pt-5">
        <div>
          <span class="label">format</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each formats as f}
              <button type="button" aria-pressed={format === f.id} disabled={!f.ok} title={f.reason} onclick={() => (wanted = f.id)}>{f.label}</button>
            {/each}
          </div>
          {#each formats.filter((f) => !f.ok && (caps || capsFailed)) as f}<p class="mono mt-1">{f.label}: {f.reason}</p>{/each}
        </div>
        <button
          type="button"
          class="btn btn-primary"
          disabled={tab === 'scale' && !smaller.length}
          onclick={() => {
            playing = false;
            exporting = true;
          }}>Resize video</button
        >
        <button type="button" class="btn" onclick={reset}>Choose another video</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .stage {
    display: flex;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    /* graph paper, so the new frame's edges read clearly */
    background:
      linear-gradient(#f2ede40a 1px, transparent 1px) 0 0 / 20px 20px,
      linear-gradient(90deg, #f2ede40a 1px, transparent 1px) 0 0 / 20px 20px,
      #0d0c0b;
  }
  .out {
    position: relative;
    flex: none;
    width: min(100%, calc(min(60vh, 560px) * var(--r)));
    aspect-ratio: var(--r);
    overflow: hidden;
    border-radius: 6px;
    outline: 1px solid var(--color-line-2);
    box-shadow: 0 18px 40px -18px #000;
    transition: background-color 0.2s;
    &.pannable {
      cursor: grab;
      touch-action: none;
    }
    &.panning {
      cursor: grabbing;
    }
  }
  .dims {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 3px 8px;
    border-radius: 6px;
    font: 400 11.5px var(--font-mono);
    color: var(--color-chalk);
    background: #0b0a09b3;
    pointer-events: none;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    & button {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 52px;
      padding: 8px 10px;
      text-align: left;
      color: var(--color-muted);
      background: #141312;
      border: 1px solid var(--color-line-2);
      border-radius: 10px;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s;
      &:hover {
        border-color: var(--color-muted);
      }
      &[aria-pressed='true'] {
        color: var(--color-chalk);
        border-color: var(--color-sun);
        & i {
          border-color: var(--color-sun);
          background: #ffd25e22;
        }
      }
    }
    & i {
      flex: none;
      display: block;
      border: 1.5px solid currentColor;
      border-radius: 3px;
    }
    & span {
      display: grid;
      min-width: 0;
    }
    & b {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.25;
    }
    & small {
      font: 400 11px var(--font-mono);
      color: var(--color-muted);
    }
  }
  .swatch {
    width: 44px;
    height: 36px;
    padding: 2px;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    background: #141312;
    cursor: pointer;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
