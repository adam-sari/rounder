<script lang="ts">
  import { onMount } from 'svelte';
  import CompareSlider from '@/components/tool/CompareSlider.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ModelGate, { type GateLoadContext } from '@/components/tool/ModelGate.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { modelWorker, proxy } from '@/engines/ai/worker-utils';
  import { decodeImage, resizeImage } from '@/engines/image/client';
  import { downloadBlob, formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import { COLORMAPS, colorize, dilate, type Colormap } from '@/tools/lib/depth-map/colormap';
  import type { DepthWorker } from '@/tools/lib/depth-map/depth.worker';
  import type { LoopFormat } from '@/tools/lib/depth-map/export';
  import { cameraAt, cameraFrom, MOTIONS, overscan, type Camera, type Motion } from '@/tools/lib/depth-map/motion';
  import { Parallax, type DepthMap } from '@/tools/lib/depth-map/parallax';

  /** longest side the model and the 3D view work at; the depth PNG is upscaled to the original */
  const PREVIEW_MAX = 1600;
  const FORMATS: [LoopFormat, string][] = [
    ['mp4', 'MP4'],
    ['webm', 'WebM'],
    ['gif', 'GIF'],
  ];

  const worker = modelWorker<DepthWorker>(() => new Worker(new URL('../lib/depth-map/depth.worker.ts', import.meta.url), { type: 'module' }));
  let loadOpts: Pick<GateLoadContext, 'variant' | 'device'> | null = null;
  let reload = false;
  /** one estimate at a time: a new photo waits for the one still running */
  let queue: Promise<unknown> = Promise.resolve();

  async function loadModel({ variant, device, onProgress, signal }: GateLoadContext) {
    const r = await worker.call((api) => api.load({ variant, device }, proxy(onProgress)), signal);
    // reloads after a failure go straight to where it really runs (after any CPU fallback)
    loadOpts = { variant: r.variant, device: r.device };
    return { device: r.device };
  }

  let file = $state<File | null>(null);
  let original = $state({ width: 0, height: 0 });
  let preview = $state.raw<ImageData | null>(null);
  let depth = $state.raw<DepthMap | null>(null);
  let photoUrl = $state('');
  let depthUrl = $state('');
  let busy = $state('');
  let error = $state('');
  let took = $state('');

  let view = $state<'depth' | '3d'>('depth');
  let colormap = $state<Colormap>('gray');
  let invert = $state(false);
  let savingPng = $state(false);

  let motion = $state<Motion>('orbit');
  let amount = $state(50);
  let focus = $state(50);
  let seconds = $state(4);
  let playing = $state(false);
  let glError = $state(false);
  let canTilt = $state(false);
  let tilting = $state(false);
  let tiltNote = $state('');

  let format = $state<LoopFormat>('mp4');
  let exporting = $state<number | null>(null);
  let exportCtl: AbortController | null = null;
  let saved = $state('');

  let canvas = $state<HTMLCanvasElement>();

  /** the 3D view's depth: near areas grown a little so object fringes move with the object */
  const soft = $derived(depth && { ...depth, data: dilate(depth.data, depth.width, depth.height, Math.round(Math.max(depth.width, depth.height) / 600)) });
  const aspect = $derived(preview ? preview.width / preview.height : 1);

  const toUrl = (img: ImageData, type: string) => {
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    c.getContext('2d')!.putImageData(img, 0, 0);
    return new Promise<string>((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ''), type, 0.9));
  };

  let opening = 0;

  async function open(files: File[]) {
    const f = files[0];
    const ticket = ++opening;
    busy = 'Opening photo…';
    error = saved = took = '';
    try {
      const data = await decodeImage(f);
      const s = Math.min(1, PREVIEW_MAX / Math.max(data.width, data.height));
      const small = s < 1 ? await resizeImage(data, { width: Math.max(1, Math.round(data.width * s)), height: Math.max(1, Math.round(data.height * s)) }) : data;
      if (ticket !== opening) return;
      reset(false);
      file = f;
      original = { width: data.width, height: data.height };
      preview = small;
      const url = await toUrl(small, 'image/jpeg');
      if (ticket !== opening) return URL.revokeObjectURL(url);
      photoUrl = url;
      await estimate(small, ticket);
    } catch {
      if (ticket === opening) error = "Couldn't read that image. Try a JPG, PNG, WebP, AVIF or HEIC file.";
    } finally {
      if (ticket === opening) busy = '';
    }
  }

  async function estimate(img: ImageData, ticket: number) {
    busy = 'Estimating depth…';
    const job = queue.catch(() => {}).then(async () => {
      if (reload && loadOpts) await worker.call((api) => api.load(loadOpts!, proxy(() => {})));
      reload = false;
      return worker.call((api) => api.run(img));
    });
    queue = job;
    try {
      const out = await job;
      if (ticket !== opening) return;
      depth = out;
      took = `depth estimated in ${(out.ms / 1000).toFixed(1)} s`;
    } catch (e) {
      // a fresh worker after a failure (it may have run out of memory); it reloads from the cache
      worker.terminate();
      reload = true;
      if (ticket === opening) error = toAiError(e).message;
    }
  }

  function reset(clearFile = true) {
    if (clearFile) {
      opening++;
      busy = '';
      file = null;
    }
    exportCtl?.abort();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = depthUrl = error = saved = took = '';
    preview = depth = null;
    glError = false;
  }

  // the colored depth map for the compare view
  $effect(() => {
    if (!depth) return;
    const d = depth;
    let url = '';
    let live = true;
    toUrl(new ImageData(colorize(d.data, colormap, invert), d.width, d.height), 'image/png').then((u) => {
      if (live) depthUrl = url = u;
      else URL.revokeObjectURL(u);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  });

  async function downloadDepth() {
    if (!depth || !file) return;
    savingPng = true;
    saved = '';
    try {
      const { depthPng } = await import('@/tools/lib/depth-map/export');
      const blob = await depthPng(depth, original.width, original.height, colormap, invert);
      const name = withSuffix(withExtension(file.name, 'png'), '-depth');
      downloadBlob(blob, name);
      saved = `${name} · ${original.width}×${original.height} · ${formatBytes(blob.size)}`;
    } catch {
      error = "Couldn't save the depth map at full size. Your device may be out of memory: try a smaller photo.";
    } finally {
      savingPng = false;
    }
  }

  // ── 3D view ──

  /** pointer or phone tilt, −1…1, and how much it is steering (eases in and out) */
  const steer = { x: 0, y: 0, tx: 0, ty: 0, on: false, w: 0 };
  let phase = 0;

  $effect(() => {
    if (view !== '3d' || !canvas || !preview || !soft) return;
    const c = canvas;
    let r: Parallax;
    try {
      r = new Parallax(c);
    } catch {
      glError = true;
      return;
    }
    r.setImage(preview);
    r.setDepth(soft);
    let frame = requestAnimationFrame(tick);
    let last = performance.now();
    let drawn = '';
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing) phase = (phase + dt / seconds) % 1;
      const ease = 1 - Math.exp(-dt * 8);
      steer.x += (steer.tx - steer.x) * ease;
      steer.y += (steer.ty - steer.y) * ease;
      steer.w += ((steer.on ? 1 : 0) - steer.w) * ease;
      const a = amount / 100;
      const auto = cameraAt(motion, phase, a);
      const hand = cameraFrom(steer.x, steer.y, a);
      const mix = (k: keyof Camera) => auto[k] + (hand[k] - auto[k]) * steer.w;
      const width = Math.max(1, Math.min(preview!.width, Math.round(c.clientWidth * devicePixelRatio)));
      const height = Math.round(width / aspect);
      if (c.width !== width || c.height !== height) Object.assign(c, { width, height });
      const cam = { x: mix('x'), y: mix('y'), zoom: mix('zoom') };
      const key = [cam.x, cam.y, cam.zoom, focus, a, motion, width].map((v) => (typeof v === 'number' ? v.toFixed(5) : v)).join();
      if (key === drawn) return;
      drawn = key;
      r.render(cam, focus / 100, overscan(motion, a, focus / 100));
    }
    return () => {
      cancelAnimationFrame(frame);
      r.dispose();
    };
  });

  function pointer(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    // the camera moves toward the pointer, so near things slide the other way
    steer.tx = -(((e.clientX - rect.left) / rect.width) * 2 - 1);
    steer.ty = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    steer.on = true;
  }
  const release = () => (steer.on = tilting);

  let onTilt: ((e: DeviceOrientationEvent) => void) | null = null;

  async function toggleTilt() {
    tiltNote = '';
    if (onTilt) {
      removeEventListener('deviceorientation', onTilt);
      onTilt = null;
      tilting = steer.on = false;
      return;
    }
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (DOE.requestPermission && (await DOE.requestPermission().catch(() => 'denied')) !== 'granted') {
      tiltNote = 'Motion access was declined. Drag on the photo instead.';
      return;
    }
    let base: number | null = null;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    onTilt = (e) => {
      if (e.gamma == null || e.beta == null) return;
      base ??= e.beta;
      steer.tx = -clamp(e.gamma / 20);
      steer.ty = -clamp((e.beta - base) / 20);
      steer.on = true;
    };
    addEventListener('deviceorientation', onTilt);
    tilting = true;
  }

  onMount(() => {
    playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    canTilt = 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
    return () => {
      if (onTilt) removeEventListener('deviceorientation', onTilt);
      exportCtl?.abort();
      worker.terminate();
    };
  });

  async function exportLoop() {
    if (!preview || !soft || !file) return;
    const ctl = (exportCtl = new AbortController());
    exporting = 0;
    saved = error = '';
    try {
      const { renderLoop } = await import('@/tools/lib/depth-map/export');
      const blob = await renderLoop({ image: preview, depth: soft, motion, amount: amount / 100, focus: focus / 100, seconds }, format, {
        onProgress: (p) => (exporting = p),
        signal: ctl.signal,
      });
      const name = withSuffix(withExtension(file.name, format), '-3d');
      downloadBlob(blob, name);
      saved = `${name} · ${formatBytes(blob.size)}`;
    } catch (e) {
      if (!ctl.signal.aborted) error = e instanceof Error && e.name === 'MediaError' ? e.message : "Couldn't export the 3D photo. Try a GIF, or a shorter loop.";
    } finally {
      if (exportCtl === ctl) exportCtl = null;
      exporting = null;
    }
  }
</script>

<ModelGate model="depth-anything-v2-small" light={null} load={loadModel}>
  {#snippet children()}
    {#if !file}
      <Dropzone accept="image/*,.heic,.heif,.avif" title={busy || 'Drop a photo here'} hint="or click to choose · JPG, PNG, WebP, HEIC" onfiles={open} />
      {#if error}<p class="mt-3 text-sm text-bad" role="alert">{error}</p>{/if}
    {:else}
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div class="grid content-start gap-3">
          <div class="seg w-fit" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'depth'} onclick={() => (view = 'depth')}>depth map</button>
            <button type="button" aria-pressed={view === '3d'} disabled={!depth} onclick={() => (view = '3d')}>3D photo</button>
          </div>

          <div class="stage" style={`max-width: min(100%, calc(${aspect.toFixed(4)} * min(72vh, 520px)))`}>
            {#if busy || !depth}
              {#if photoUrl}<img src={photoUrl} alt="" class="h-full w-full object-contain opacity-60" />{/if}
              <p class="working mono" role="status">
                {#if busy}<span class="pulse" aria-hidden="true"></span>{busy}{:else}no depth map yet{/if}
              </p>
            {:else if view === 'depth'}
              {#if depthUrl}<CompareSlider before={photoUrl} after={depthUrl} beforeLabel="photo" afterLabel="depth" />{/if}
            {:else if glError}
              <p class="working mono" role="alert">The 3D view needs WebGL 2, which this browser has turned off. The depth map still works.</p>
            {:else}
              <canvas
                bind:this={canvas}
                class="block h-auto w-full"
                aria-hidden="true"
                onpointermove={pointer}
                onpointerdown={pointer}
                onpointerleave={release}
                onpointerup={(e) => e.pointerType !== 'mouse' && release()}
                onpointercancel={release}
              ></canvas>
            {/if}
          </div>

          <p class="mono" aria-live="polite">
            {#if view === '3d' && depth}
              {canTilt ? 'drag on the photo or tilt your phone' : 'move the pointer over the photo or drag on it'} to look around
            {:else if took}
              {took} · brighter is closer · AI estimate, check edges and glass
            {:else}
              the AI is working out how far away each part of the photo is
            {/if}
          </p>
        </div>

        <div class="grid content-start gap-5">
          {#if view === 'depth'}
            <div>
              <span class="label">colors</span>
              <div class="seg" role="group" aria-label="Depth map colors">
                {#each COLORMAPS as [m, label]}
                  <button type="button" aria-pressed={colormap === m} onclick={() => (colormap = m)}>{label}</button>
                {/each}
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={invert} class="accent-(--color-sun)" /> invert (near = dark)</label>
            <div class="grid gap-3 border-t border-line pt-5">
              <button type="button" class="btn btn-primary" disabled={!depth || savingPng} onclick={downloadDepth}>
                {savingPng ? 'Saving…' : 'Download depth PNG'}
              </button>
              <p class="mono">{original.width}×{original.height} · the photo's full size</p>
              <button type="button" class="btn py-2! text-sm!" disabled={!depth} onclick={() => (view = '3d')}>Make a 3D photo →</button>
            </div>
          {:else}
            <div>
              <span class="label">motion</span>
              <div class="seg" role="group" aria-label="Camera motion">
                {#each MOTIONS as [m, label]}
                  <button type="button" aria-pressed={motion === m} onclick={() => (motion = m)}>{label}</button>
                {/each}
              </div>
            </div>
            <label>
              <span class="label">depth effect · {amount}</span>
              <input type="range" min="5" max="100" bind:value={amount} class="w-full accent-(--color-sun)" />
            </label>
            <label>
              <span class="label">still point · {focus < 35 ? 'background' : focus > 65 ? 'foreground' : 'middle'}</span>
              <input type="range" min="0" max="100" bind:value={focus} class="w-full accent-(--color-sun)" aria-describedby="depth-focus-hint" />
              <span id="depth-focus-hint" class="mono">the part of the scene that stays put</span>
            </label>
            <label>
              <span class="label">loop length · {seconds} s</span>
              <input type="range" min="2" max="8" step="1" bind:value={seconds} class="w-full accent-(--color-sun)" />
            </label>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn py-2! text-sm!" aria-pressed={playing} onclick={() => (playing = !playing)}>{playing ? '❚❚ pause' : '▶ play'}</button>
              {#if canTilt}
                <button type="button" class="btn py-2! text-sm!" aria-pressed={tilting} onclick={toggleTilt}>{tilting ? 'stop tilt' : 'tilt your phone'}</button>
              {/if}
            </div>
            {#if tiltNote}<p class="mono" role="status">{tiltNote}</p>{/if}

            <div class="grid gap-3 border-t border-line pt-5">
              <div>
                <span class="label">export loop as</span>
                <div class="seg" role="group" aria-label="Export format">
                  {#each FORMATS as [f, label]}
                    <button type="button" aria-pressed={format === f} disabled={exporting !== null} onclick={() => (format = f)}>{label}</button>
                  {/each}
                </div>
              </div>
              {#if exporting !== null}
                <div class="bar" role="progressbar" aria-label="Exporting" aria-valuenow={Math.round(exporting * 100)} aria-valuemin="0" aria-valuemax="100">
                  <span style={`width: ${(exporting * 100).toFixed(1)}%`}></span>
                </div>
                <button type="button" class="btn py-2! text-sm!" onclick={() => exportCtl?.abort()}>Cancel</button>
              {:else}
                <button type="button" class="btn btn-primary" disabled={glError} onclick={exportLoop}>Download {format.toUpperCase()} loop</button>
              {/if}
              <p class="mono">{seconds} s seamless loop · {format === 'gif' ? '480 px, 15 fps' : 'up to 1080 px, 30 fps'} · no watermark</p>
            </div>
          {/if}

          {#if saved}<p class="mono text-ok!" role="status">{saved}</p>{/if}
          {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
          <button type="button" class="btn py-2! text-sm!" onclick={() => reset()}>Use another photo</button>
        </div>
      </div>
    {/if}
  {/snippet}
</ModelGate>

<style>
  .stage {
    position: relative;
    width: 100%;
    margin-inline: auto;
    overflow: hidden;
    border-radius: 14px;
    min-height: 160px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    & canvas {
      touch-action: pan-y;
      cursor: grab;
    }
    & :global(.compare) {
      border: 0;
      border-radius: 0;
    }
  }
  .working {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px;
    background: linear-gradient(transparent, #131211e6);
    color: var(--color-chalk);
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 99px;
    background: var(--color-ai);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
  .bar {
    height: 8px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--color-line);
    & span {
      display: block;
      height: 100%;
      background: var(--color-ai);
      transition: width 0.2s;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
    .bar span {
      transition: none;
    }
  }
</style>
