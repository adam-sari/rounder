<script lang="ts">
  import { onMount } from 'svelte';
  import ModelGate from '@/components/tool/ModelGate.svelte';
  import { formatMB, toAiError } from '@/engines/ai';
  import { capabilities, isAbort, MediaError, transcode, type Capabilities, type StatusControl } from '@/engines/media';
  import { errorText, infoChips, pickFormat, timing, videoFormats, type Opened, type VideoFormat } from '@/tools/lib/crop-video/job';
  import { stillFrames } from '@/tools/lib/crop-video/stills';
  import { FIRST_RUN_BYTES } from '@/tools/lib/reframe/models';
  import {
    buildPath,
    centerAt,
    clampCenter,
    clearShot,
    cropRect,
    cropSize,
    manualAt,
    outputSize,
    setKey,
    shotKeys,
    SMOOTHING,
    type Analysis,
    type Keyframe,
    type Kind,
    type Point,
    type SmoothingKey,
  } from '@/tools/lib/reframe/path';
  import type { Box } from '@/tools/lib/reframe/signal';
  import AutoReframeTimeline from './AutoReframeTimeline.svelte';
  import ReframeJob from './ReframeJob.svelte';
  import ReframeOpen from './ReframeOpen.svelte';
  import ReframeTransport from './ReframeTransport.svelte';
  import ReframeVideo from './ReframeVideo.svelte';

  const aspects = [
    { key: '9:16', ratio: 9 / 16, hint: 'TikTok · Reels · Shorts' },
    { key: '4:5', ratio: 4 / 5, hint: 'Instagram feed' },
    { key: '1:1', ratio: 1, hint: 'square post' },
  ];
  const motions: { key: SmoothingKey; label: string }[] = [
    { key: 'calm', label: 'Calm' },
    { key: 'balanced', label: 'Balanced' },
    { key: 'snappy', label: 'Snappy' },
  ];
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  /** a keyframe this close to the playhead counts as "here" */
  const NEAR = 0.15;

  let gateReady = $state(false);
  let video = $state.raw<(Opened & { url: string }) | null>(null);
  let phase = $state<'open' | 'analyzing' | 'edit' | 'export'>('open');
  let analysis = $state.raw<Analysis | null>(null);
  let progress = $state(0);
  let faceFrames = $state(0);
  let started = 0;
  let now = $state(0);
  let error = $state('');
  let preview = $state<HTMLCanvasElement>();
  let job: AbortController | null = null;

  let caps = $state.raw<Capabilities | null>(null);
  let capsFailed = $state(false);
  let time = $state(0);
  let playing = $state(false);
  let stills = $state.raw<ReturnType<typeof stillFrames> | null>(null);
  let still = $state<string | null>(null);

  let ratio = $state('9:16');
  let motion = $state<SmoothingKey>('balanced');
  let keys = $state.raw<Keyframe[]>([]);
  let selected = $state<number | null>(null);
  let short = $state(1080);
  let wanted = $state<VideoFormat | null>(null);

  let stage = $state<HTMLDivElement>();
  let win = $state<HTMLButtonElement>();
  let drag = $state<{ id: number; x: number; y: number; from: Point } | null>(null);

  const W = $derived(video?.info.video?.displayWidth ?? 16);
  const H = $derived(video?.info.video?.displayHeight ?? 9);
  const aspect = $derived(aspects.find((a) => a.key === ratio)!.ratio);
  const crop = $derived(cropSize(W, H, aspect));
  const path = $derived(analysis ? buildPath(analysis, crop.width / W, crop.height / H, SMOOTHING[motion]) : null);
  const center = $derived(path ? centerAt(path, keys, time) : { x: 0.5, y: 0.5 });
  const rect = $derived(cropRect(center, W, H, crop));
  const manual = $derived(path && keys.length ? manualAt(path, keys, time).weight : 0);
  const keyHere = $derived(keys.find((k) => Math.abs(k.t - time) <= NEAR) ?? null);
  const inShot = $derived(path ? shotKeys(path, keys, time).length : 0);
  /** what the AI is following right now (nearest analysed frame) */
  const nearest = $derived.by(() => {
    if (!analysis?.samples.length) return null;
    const s = analysis.samples.reduce((a, b) => (Math.abs(b.t - time) < Math.abs(a.t - time) ? b : a));
    return Math.abs(s.t - time) < 0.3 ? s : null;
  });
  const following = $derived.by(() => {
    let kind: Kind = 'center';
    for (const p of path?.track ?? []) {
      if (p.t > time + 0.1) break;
      kind = p.kind;
    }
    return kind;
  });
  const out = $derived(outputSize(aspect, short, crop));
  const formats = $derived(videoFormats(caps, capsFailed));
  const format = $derived(pickFormat(formats, wanted, video?.info.container ?? 'mp4'));
  const clock = $derived(timing(progress, now - started));
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const winStyle = $derived(`left:${pct(rect.x, W)};top:${pct(rect.y, H)};width:${pct(crop.width, W)};height:${pct(crop.height, H)}`);
  // the follower video, scaled and shifted so the window fills the preview
  const followStyle = $derived(
    `inset:auto;left:${-(rect.x / crop.width) * 100}%;top:${-(rect.y / crop.height) * 100}%;width:${(W / crop.width) * 100}%;height:${(H / crop.height) * 100}%;object-fit:fill`,
  );
  const faceLabel = { face: 'following a face', motion: 'following movement', center: 'holding the center' } as const;

  onMount(() => {
    capabilities().then(
      (c) => (caps = c),
      (e) => {
        console.error(e);
        capsFailed = true;
      },
    );
    return () => job?.abort();
  });

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

  function ready(v: Opened) {
    video = { ...v, url: URL.createObjectURL(v.playable) };
    keys = [];
    selected = null;
    time = 0;
    playing = false;
    wanted = null;
    void run(v);
  }

  async function run(v: Opened) {
    job?.abort();
    const ctl = (job = new AbortController());
    phase = 'analyzing';
    error = '';
    progress = 0;
    faceFrames = 0;
    started = now = performance.now();
    const tick = setInterval(() => (now = performance.now()), 250);
    try {
      const [{ loadDetector }, { analyze }] = await Promise.all([import('@/tools/lib/reframe/faces'), import('@/tools/lib/reframe/analyze')]);
      const detector = await loadDetector({ signal: ctl.signal });
      const result = await analyze(v.playable, v.info, detector, {
        signal: ctl.signal,
        onProgress: (p, faces) => {
          progress = p;
          faceFrames = faces;
        },
        onFrame: drawPreview,
      });
      if (ctl !== job) return;
      analysis = result;
      phase = 'edit';
    } catch (e) {
      if (ctl !== job || isAbort(e) || ctl.signal.aborted) return;
      console.error(e);
      error = e instanceof MediaError ? errorText(e) : toAiError(e).message;
      phase = 'open';
      video = null;
    } finally {
      clearInterval(tick);
    }
  }

  /** the frame being analysed, with the faces found, so the wait shows the AI at work */
  function drawPreview(frame: ImageBitmap, faces: Box[]) {
    const c = preview;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.drawImage(frame, 0, 0, c.width, c.height);
    ctx.strokeStyle = '#c8a6ff';
    ctx.lineWidth = 2;
    for (const f of faces) ctx.strokeRect(f.x * c.width, f.y * c.height, f.w * c.width, f.h * c.height);
  }

  function reset() {
    job?.abort();
    job = null;
    phase = 'open';
    video = null;
    analysis = null;
    stills = null;
    still = null;
    keys = [];
  }

  // the browser can't play this file: show decoded stills at the scrubber's position instead
  function fail() {
    if (stills || !video) return;
    playing = false;
    stills = stillFrames(video.playable, W >= H ? { width: Math.min(W, 1280) } : { height: Math.min(H, 1280) }, (url) => (still = url));
  }

  /** pins the window's centre at the playhead */
  function pin(p: Point) {
    if (!path) return;
    const c = clampCenter(p, path.cw, path.ch);
    keys = setKey(path, keys, { t: time, x: c.x, y: c.y }, NEAR);
    selected = keys.find((k) => Math.abs(k.t - time) <= NEAR)?.t ?? null;
  }

  function point(e: PointerEvent) {
    const b = stage!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag || !path) return;
    e.preventDefault();
    playing = false;
    const p = point(e);
    // outside the window: jump it to the pointer, then keep dragging from there
    const from = (e.target as HTMLElement).closest('.win') ? center : clampCenter(p, path.cw, path.ch);
    if (from !== center) pin(from);
    drag = { id: e.pointerId, x: p.x, y: p.y, from };
    stage!.setPointerCapture(e.pointerId);
    win?.focus({ preventScroll: true });
  }

  function move(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const p = point(e);
    pin({ x: drag.from.x + p.x - drag.x, y: drag.from.y + p.y - drag.y });
  }

  function up(e: PointerEvent) {
    if (drag?.id === e.pointerId) drag = null;
  }

  function key(e: KeyboardEvent) {
    const dir = arrows[e.key];
    if (!dir) return;
    e.preventDefault();
    playing = false;
    const step = e.shiftKey ? 0.05 : 0.01;
    pin({ x: center.x + dir[0] * step, y: center.y + dir[1] * step });
  }

  function resumeTracking() {
    if (!path) return;
    keys = setKey(path, keys, { t: time, x: center.x, y: center.y, track: true }, NEAR);
  }

  function deleteKey() {
    if (!keyHere) return;
    keys = keys.filter((k) => k !== keyHere);
    selected = null;
  }

  function exportVideo(ctl: StatusControl) {
    const p = path!;
    const pinned = keys;
    const [w, h, c] = [W, H, crop];
    return transcode(
      video!.playable,
      {
        container: format,
        video: {
          ...out,
          fit: 'fill',
          quality: 'high',
          render: (ctx, src, f) => {
            const r = cropRect(centerAt(p, pinned, f.time), w, h, c);
            ctx.imageSmoothingQuality = 'high';
            src.drawWithFit(ctx, { fit: 'fill', crop: { left: r.x, top: r.y, width: r.width, height: r.height } });
          },
        },
      },
      { ...ctl, onStatus: (s) => ctl.onStatus?.(s === 'Converting…' ? 'Reframing…' : s) },
    );
  }
</script>

{#if !gateReady}
  <p class="mono mb-3">AI face tracking · runs on your device · first use downloads about {formatMB(FIRST_RUN_BYTES)} once</p>
{/if}

<ModelGate
  model="face-detector"
  light={null}
  bind:ready={gateReady}
  load={async ({ onProgress, signal }) => {
    const { loadDetector } = await import('@/tools/lib/reframe/faces');
    await loadDetector({ onProgress, signal });
    return { device: 'wasm' };
  }}
>
  {#snippet children()}
    {#if phase === 'open' || !video}
      <ReframeOpen title="Drop a horizontal video to reframe" onready={ready} />
      {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
    {:else if phase === 'analyzing'}
      <div class="panel center" aria-busy="true">
        <p class="font-serif text-3xl">Watching your video…</p>
        <canvas
          bind:this={preview}
          class="scan"
          width={W >= H ? 480 : Math.round((360 * W) / H)}
          height={W >= H ? Math.round((480 * H) / W) : 360}
          aria-label="The frame being analyzed, with detected faces outlined"
        ></canvas>
        <div class="bar" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <i style:width={`${progress * 100}%`}></i>
        </div>
        <p class="mono" aria-live="polite">
          {progress < 0.92 ? 'Finding faces, movement and scene cuts' : 'Pinning the exact frame of each cut'} · {Math.round(progress * 100)}% · faces in {faceFrames} frame{faceFrames === 1 ? '' : 's'}
          {#if clock.left} · about {clock.left} left{/if}
        </p>
        <button type="button" class="btn" onclick={reset}>Cancel</button>
      </div>
    {:else if phase === 'export'}
      <ReframeJob
        run={exportVideo}
        name={video.file.name}
        suffix={`-${ratio.replace(':', 'x')}`}
        sourceSize={video.file.size}
        verb="Reframing"
        onback={() => (phase = 'edit')}
        onreset={reset}
      />
    {:else if path}
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
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
              <div class="shade" aria-hidden="true"><div class="hole" style={winStyle}></div></div>
              {#if nearest && !drag}
                {#each nearest.faces as f}
                  <span class="face" aria-hidden="true" style={`left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%`}></span>
                {/each}
              {/if}
              <button
                type="button"
                class="win"
                class:pinned={manual > 0.5}
                class:active={!!drag}
                style={winStyle}
                bind:this={win}
                onkeydown={key}
                aria-label={`${ratio} frame, ${manual > 0.5 ? 'pinned by you' : 'placed by the AI'}. Drag it, or use the arrow keys, to pin it at this moment; Shift moves further.`}
              >
                <span class="tag" aria-hidden="true">{manual > 0.5 ? 'pinned' : 'AI'}</span>
              </button>
            </div>
          </div>
          <ReframeTransport bind:time bind:playing duration={video.info.durationSec} canPlay={!stills} />
          <AutoReframeTimeline {path} {keys} duration={video.info.durationSec} bind:time bind:playing bind:selected />
          {#if stills}<p class="mono">This browser can't play the file, so the preview shows still frames. Drag the slider to check other moments.</p>{/if}
          <p class="mono">
            The AI guessed the framing and can be wrong. Drag the frame (or click where it should be) to pin it from that moment on; pins in a row pan between each
            other. Lilac outlines are the faces it found.
          </p>
        </div>

        <aside class="grid content-start gap-5">
          <div class="grid justify-items-center gap-2">
            <div class="out" style:--a={aspect}>
              <ReframeVideo src={video.url} {still} {time} {playing} style={followStyle} />
            </div>
            <p class="mono status" role="status">
              <span class="dot" class:pin={manual > 0.5} aria-hidden="true"></span>
              {manual > 0.5 ? 'pinned by you' : `AI ${faceLabel[following]}`}
            </p>
          </div>

          <div>
            <span class="label">shape</span>
            <div class="seg" role="group" aria-label="Output shape">
              {#each aspects as a}
                <button type="button" aria-pressed={ratio === a.key} title={a.hint} onclick={() => (ratio = a.key)}>{a.key}</button>
              {/each}
            </div>
            <p class="mono mt-1">{aspects.find((a) => a.key === ratio)?.hint}</p>
          </div>

          <div>
            <span class="label">camera</span>
            <div class="seg" role="group" aria-label="Camera movement">
              {#each motions as m}
                <button type="button" aria-pressed={motion === m.key} onclick={() => (motion = m.key)}>{m.label}</button>
              {/each}
            </div>
            <p class="mono mt-1">{motion === 'calm' ? 'moves only when it must' : motion === 'snappy' ? 'follows every move' : 'steady, follows clear moves'}</p>
          </div>

          <div class="grid gap-2">
            <span class="label">your edits{keys.length ? ` · ${keys.length} keyframe${keys.length === 1 ? '' : 's'}` : ''}</span>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn sm" disabled={!keyHere} onclick={deleteKey}>Delete keyframe</button>
              <button type="button" class="btn sm" disabled={manual <= 0 || keyHere?.track} onclick={resumeTracking}>Back to AI here</button>
              <button type="button" class="btn sm" disabled={!inShot} onclick={() => (keys = clearShot(path!, keys, time))}>Reset this shot</button>
              <button type="button" class="btn sm" disabled={!keys.length} onclick={() => (keys = [])}>Reset all</button>
            </div>
          </div>

          <div>
            <span class="label">output size</span>
            <div class="seg" role="group" aria-label="Output size">
              <button type="button" aria-pressed={short === 1080} onclick={() => (short = 1080)}>1080p</button>
              <button type="button" aria-pressed={short === 720} onclick={() => (short = 720)}>720p</button>
              <button type="button" aria-pressed={short === 0} onclick={() => (short = 0)}>as cropped</button>
            </div>
            <p class="mono mt-1">{out.width} × {out.height}{out.width > crop.width * 1.05 ? ' · scaled up from the source' : ''}</p>
          </div>

          <div class="grid gap-3 border-t border-line pt-5">
            <div>
              <span class="label">format</span>
              <div class="seg" role="group" aria-label="Output format">
                {#each formats as f}
                  <button type="button" aria-pressed={format === f.id} disabled={!f.ok} title={f.reason} onclick={() => (wanted = f.id)}>{f.label}</button>
                {/each}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => {
                playing = false;
                phase = 'export';
              }}>Export {ratio} video</button
            >
            <button type="button" class="btn" onclick={reset}>Choose another video</button>
          </div>
        </aside>
      </div>
    {/if}
  {/snippet}
</ModelGate>

<style>
  .panel {
    display: grid;
    gap: 16px;
    padding: clamp(20px, 4vw, 32px);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
  }
  .center {
    justify-items: center;
    text-align: center;
  }
  .scan {
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    background: #000;
    border: 1px solid var(--color-line-2);
  }
  .bar {
    width: min(420px, 100%);
    height: 6px;
    border-radius: 6px;
    background: var(--color-line);
    overflow: hidden;
    & i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-ai);
      transition: width 0.3s ease-out;
    }
  }
  .frame {
    display: flex;
    justify-content: center;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: #0d0c0b;
  }
  .stage {
    position: relative;
    flex: none;
    width: min(100%, calc(min(56vh, 540px) * var(--r)));
    aspect-ratio: var(--r);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
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
  .face {
    position: absolute;
    border: 1.5px solid #c8a6ffaa;
    border-radius: 6px;
    pointer-events: none;
  }
  .win {
    position: absolute;
    padding: 0;
    background: none;
    border: 0;
    outline: 2px solid var(--color-ai);
    cursor: grab;
    color: inherit;
    &.pinned {
      outline-color: var(--color-sun);
    }
    &.active {
      cursor: grabbing;
    }
    &:focus-visible {
      outline-width: 3px;
    }
  }
  .tag {
    position: absolute;
    left: 50%;
    top: 8px;
    translate: -50% 0;
    padding: 2px 8px;
    border-radius: 6px;
    font: 500 11px var(--font-mono);
    color: var(--color-bg);
    background: var(--color-ai);
    pointer-events: none;
  }
  .win.pinned .tag {
    background: var(--color-sun);
  }
  .out {
    position: relative;
    width: min(100%, calc(min(46vh, 400px) * var(--a)), 240px);
    aspect-ratio: var(--a);
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: #000;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-ai);
    &.pin {
      background: var(--color-sun);
    }
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .sm {
    padding: 8px 12px;
    font-size: 13px;
    border-radius: 10px;
  }
</style>
