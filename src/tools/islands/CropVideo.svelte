<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilities, transcode, type Capabilities, type Rect, type StatusControl } from '@/engines/media';
  import { dragRect, maxBox, placeBox, resizeTo, type Handle } from '@/tools/lib/crop-image/geometry';
  import { cropAspects, evenCrop, ratioLabel, scaleChoices, scaleToShortSide } from '@/tools/lib/crop-video/geometry';
  import { infoChips, pickFormat, videoFormats, type Opened, type VideoFormat } from '@/tools/lib/crop-video/job';
  import { stillFrames } from '@/tools/lib/crop-video/stills';
  import ReframeJob from './ReframeJob.svelte';
  import ReframeOpen from './ReframeOpen.svelte';
  import ReframeTransport from './ReframeTransport.svelte';
  import ReframeVideo from './ReframeVideo.svelte';

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let video = $state.raw<(Opened & { url: string }) | null>(null);
  let caps = $state.raw<Capabilities | null>(null);
  let capsFailed = $state(false);
  let time = $state(0);
  let playing = $state(false);
  let stills = $state.raw<ReturnType<typeof stillFrames> | null>(null);
  let still = $state<string | null>(null);

  let rect = $state<Rect>({ x: 0, y: 0, width: 2, height: 2 });
  let ratio = $state('free');
  let side = $state(0);
  let wanted = $state<VideoFormat | null>(null);
  let exporting = $state(false);

  let stage = $state<HTMLDivElement>();
  let box = $state<HTMLButtonElement>();
  let drag = $state<{ id: number; handle: Handle; start: Rect; x: number; y: number; min: number } | null>(null);

  // display size: what a player shows, phone rotation included; the crop box lives in these pixels
  const W = $derived(video?.info.video?.displayWidth ?? 2);
  const H = $derived(video?.info.video?.displayHeight ?? 2);
  const aspect = $derived(cropAspects.find((a) => a.key === ratio)?.ratio ?? null);
  const crop = $derived(evenCrop(rect, W, H));
  const choices = $derived(scaleChoices(crop.width, crop.height));
  const outSide = $derived(choices.some((c) => c.side === side) ? side : 0);
  const out = $derived(outSide ? scaleToShortSide(crop.width, crop.height, outSide) : crop);
  const formats = $derived(videoFormats(caps, capsFailed));
  const format = $derived(pickFormat(formats, wanted, video?.info.container ?? 'mp4'));
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const boxStyle = $derived(`left:${pct(rect.x, W)};top:${pct(rect.y, H)};width:${pct(rect.width, W)};height:${pct(rect.height, H)}`);

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
    ratio = 'free';
    side = 0;
    wanted = null;
    rect = placeBox(W / 2, H / 2, W * 0.8, H * 0.8, W, H, null);
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

  // the browser can't play this file: show decoded stills at the scrubber's position instead
  function fail() {
    if (stills || !video) return;
    playing = false;
    stills = stillFrames(video.playable, W >= H ? { width: Math.min(W, 1280) } : { height: Math.min(H, 1280) }, (url) => (still = url));
  }

  /** pointer position in full-resolution display pixels */
  function point(e: PointerEvent) {
    const b = stage!.getBoundingClientRect();
    const scale = W / b.width;
    return { x: (e.clientX - b.left) * scale, y: (e.clientY - b.top) * scale, scale };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    const p = point(e);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
    // outside the box: draw a fresh one from this point
    const start = handle ? rect : { x: Math.round(p.x), y: Math.round(p.y), width: 0, height: 0 };
    drag = { id: e.pointerId, handle: handle ?? 'se', start, x: p.x, y: p.y, min: Math.max(2, Math.round(24 * p.scale)) };
    stage!.setPointerCapture(e.pointerId);
    box?.focus({ preventScroll: true });
  }

  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const p = point(e);
    rect = dragRect(drag.start, drag.handle, p.x - drag.x, p.y - drag.y, W, H, aspect, drag.min);
  }

  function up(e: PointerEvent) {
    if (drag?.id === e.pointerId) drag = null;
  }

  function key(e: KeyboardEvent) {
    const dir = arrows[e.key];
    if (!dir) return;
    e.preventDefault();
    const step = e.shiftKey ? Math.max(10, Math.round(Math.max(W, H) / 100)) : 2;
    const [dx, dy] = [dir[0] * step, dir[1] * step];
    const handle: Handle = e.ctrlKey || e.metaKey ? (dx ? 'e' : 's') : 'move';
    rect = dragRect(rect, handle, dx, dy, W, H, aspect, 2);
  }

  /** a locked ratio starts as the biggest box of that shape around the current centre */
  function setRatio(next: string) {
    ratio = next;
    if (!aspect) return;
    const m = maxBox(aspect, W, H);
    rect = placeBox(rect.x + rect.width / 2, rect.y + rect.height / 2, m.width, m.height, W, H, aspect);
  }

  function setField(field: keyof Rect, input: HTMLInputElement) {
    const v = Math.round(Number(input.value));
    if (input.value !== '' && Number.isFinite(v)) {
      rect =
        field === 'width' || field === 'height'
          ? resizeTo(rect, field, Math.max(2, v), W, H, aspect)
          : dragRect(rect, 'move', field === 'x' ? v - rect.x : 0, field === 'y' ? v - rect.y : 0, W, H, aspect);
    }
    input.value = String(rect[field]); // show the clamped value even when the box didn't change
  }

  function run(ctl: StatusControl) {
    const scale = outSide ? { ...scaleToShortSide(crop.width, crop.height, outSide), fit: 'fill' as const } : {};
    return transcode(video!.playable, { container: format, video: { crop, ...scale } }, ctl);
  }

  function swatch(a: number | null) {
    if (!a) return 'width:16px;height:12px';
    return a >= 1 ? `width:16px;height:${16 / a}px` : `width:${16 * a}px;height:16px`;
  }
</script>

{#if !video}
  <ReframeOpen title="Drop a video to crop" onready={ready} />
{:else if exporting}
  <ReframeJob
    run={run}
    name={video.file.name}
    suffix="-cropped"
    sourceSize={video.file.size}
    verb="Cropping"
    onback={() => (exporting = false)}
    onreset={reset}
  />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
    <div class="grid min-w-0 content-start gap-3">
      <p class="mono flex flex-wrap gap-x-3 gap-y-1">
        <span class="max-w-full truncate text-chalk">{video.file.name}</span>
        {#each infoChips(video.info) as chip}<span>{chip}</span>{/each}
      </p>
      <div class="frame">
        <div
          class="stage"
          style:--r={W / H}
          bind:this={stage}
          role="presentation"
          onpointerdown={down}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onlostpointercapture={up}
        >
          <ReframeVideo src={video.url} {still} bind:time bind:playing lead style="object-fit: fill" onfail={fail} />
          <div class="shade" aria-hidden="true"><div class="hole" style={boxStyle}></div></div>
          <button
            type="button"
            class="box"
            class:active={!!drag}
            style={boxStyle}
            bind:this={box}
            data-handle="move"
            onkeydown={key}
            aria-label={`Crop area ${crop.width} by ${crop.height} pixels at ${crop.x}, ${crop.y}. Arrow keys move it, Shift moves further, Ctrl or Command with arrows resizes.`}
          >
            <span class="thirds" aria-hidden="true"></span>
            <span class="tag" aria-hidden="true">{crop.width} × {crop.height}</span>
            {#each handles as h}<span class="h {h}" data-handle={h} aria-hidden="true"></span>{/each}
          </button>
        </div>
      </div>
      <ReframeTransport bind:time bind:playing duration={video.info.durationSec} canPlay={!stills} />
      {#if stills}<p class="mono">This browser can't play the file, so the preview shows still frames. Drag the slider to check other moments.</p>{/if}
      <p class="mono">Drag outside the box to draw a new one. Arrow keys nudge it; Ctrl or ⌘ with arrows resizes.</p>
    </div>

    <aside class="grid content-start gap-5">
      <div>
        <span class="label">aspect ratio</span>
        <div class="ratios" role="group" aria-label="Aspect ratio">
          {#each cropAspects as a}
            <button type="button" aria-pressed={ratio === a.key} onclick={() => setRatio(a.key)}>
              <i class:free={!a.ratio} style={swatch(a.ratio)}></i>
              <span><b>{a.key}</b><small>{a.hint}</small></span>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <span class="label">exact size & position (px)</span>
        <div class="grid grid-cols-2 gap-2">
          {#each [['width', 'W'], ['height', 'H'], ['x', 'X'], ['y', 'Y']] as const as [field, tag]}
            <label class="num">
              <span aria-hidden="true">{tag}</span>
              <input class="field" type="number" min={field === 'width' || field === 'height' ? 2 : 0} value={rect[field]} aria-label={`Crop ${field}`} onchange={(e) => setField(field, e.currentTarget)} />
            </label>
          {/each}
        </div>
        <button
          type="button"
          class="mono mt-2 cursor-pointer underline decoration-line-2 underline-offset-4 hover:text-chalk"
          onclick={() => {
            ratio = 'free';
            rect = { x: 0, y: 0, width: W, height: H };
          }}>select the whole frame</button
        >
      </div>

      <div>
        <span class="label">output size</span>
        <div class="seg" role="group" aria-label="Output size">
          <button type="button" aria-pressed={outSide === 0} onclick={() => (side = 0)}>as cropped</button>
          {#each choices as c}
            <button type="button" aria-pressed={outSide === c.side} onclick={() => (side = c.side)}>{c.side}p</button>
          {/each}
        </div>
        <p class="mono mt-2">{out.width} × {out.height} · {ratioLabel(out.width, out.height)}{outSide ? ' · smaller file' : ' · full detail'}</p>
      </div>

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
          onclick={() => {
            playing = false;
            exporting = true;
          }}>Crop video</button
        >
        <button type="button" class="btn" onclick={reset}>Choose another video</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .frame {
    display: flex;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: #0d0c0b;
  }
  /* sized from the video's display ratio so the overlay lines up with the picture exactly */
  .stage {
    position: relative;
    flex: none;
    width: min(100%, calc(min(62vh, 600px) * var(--r)));
    aspect-ratio: var(--r);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: crosshair;
    background: #000;
  }
  .shade {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .hole {
    position: absolute;
    box-shadow: 0 0 0 100vmax #0b0a09b8;
  }
  .box {
    position: absolute;
    padding: 0;
    background: none;
    border: 0;
    outline: 1.5px solid var(--color-sun);
    outline-offset: 0;
    cursor: move;
    color: inherit;
    &:focus-visible {
      outline-width: 2.5px;
    }
  }
  .thirds {
    position: absolute;
    inset: 0;
    opacity: 0.3;
    background:
      linear-gradient(90deg, transparent calc(33.33% - 0.5px), #f2ede4 calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent 0),
      linear-gradient(90deg, transparent calc(66.66% - 0.5px), #f2ede4 calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent 0),
      linear-gradient(transparent calc(33.33% - 0.5px), #f2ede4 calc(33.33% - 0.5px) calc(33.33% + 0.5px), transparent 0),
      linear-gradient(transparent calc(66.66% - 0.5px), #f2ede4 calc(66.66% - 0.5px) calc(66.66% + 0.5px), transparent 0);
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .tag {
    position: absolute;
    left: 50%;
    bottom: 8px;
    translate: -50% 0;
    padding: 3px 8px;
    border-radius: 6px;
    font: 400 11.5px var(--font-mono);
    color: var(--color-bg);
    background: var(--color-sun);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .box.active .thirds {
    opacity: 0.7;
  }
  .box.active .tag,
  .box:focus-visible .tag {
    opacity: 1;
  }
  .h {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    background: var(--color-sun);
    border: 2px solid var(--color-bg);
    border-radius: 4px;
    /* a bigger invisible target for fingers */
    &::after {
      content: '';
      position: absolute;
      inset: -12px;
    }
  }
  .n, .s { left: 50%; width: 22px; margin-left: -11px; height: 10px; margin-top: -5px; }
  .e, .w { top: 50%; height: 22px; margin-top: -11px; width: 10px; margin-left: -5px; }
  .nw, .n, .ne { top: 0; }
  .sw, .s, .se { top: 100%; }
  .nw, .w, .sw { left: 0; }
  .ne, .e, .se { left: 100%; }
  .nw, .se { cursor: nwse-resize; }
  .ne, .sw { cursor: nesw-resize; }
  .n, .s { cursor: ns-resize; }
  .e, .w { cursor: ew-resize; }

  .ratios {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    & button {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 50px;
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
      &.free {
        border-style: dashed;
      }
    }
    & span {
      display: grid;
      min-width: 0;
    }
    & b {
      font: 500 13px var(--font-mono);
    }
    & small {
      font-size: 11px;
      line-height: 1.3;
      color: var(--color-muted);
    }
  }
  .num {
    position: relative;
    & span {
      position: absolute;
      left: 12px;
      top: 50%;
      translate: 0 -50%;
      font: 400 12px var(--font-mono);
      color: var(--color-sun);
      pointer-events: none;
    }
    & input {
      padding-left: 30px;
      font-variant-numeric: tabular-nums;
    }
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
