<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes, formatTime } from '@/engines/media/math';
  import { downloadBlob, zipFiles } from '@/tools/lib/files';
  import { titleKeeper } from '@/tools/lib/timers/ticker';
  import { liveStream } from '@/tools/lib/recorder/attach';
  import {
    RESOLUTIONS,
    cameraConstraints,
    cameraSupport,
    captureError,
    detectEnv,
    deviceChoices,
    micConstraints,
    unsupportedCopy,
    type DeviceChoice,
    type Unsupported,
  } from '@/tools/lib/recorder/capture';
  import { recordingName } from '@/tools/lib/recorder/clock';
  import { Recording, stopStreams } from '@/tools/lib/recorder/session';
  import RecorderMeter from './RecorderMeter.svelte';
  import RecorderResult from './RecorderResult.svelte';

  type Phase = 'off' | 'starting' | 'live' | 'recording' | 'saving' | 'done';

  interface Photo {
    id: number;
    blob: Blob;
    url: string;
    name: string;
  }

  /** the microphone picker's "record without sound" choice */
  const NO_MIC = 'none';

  let support = $state<Unsupported | null | undefined>(undefined);
  let phase = $state<Phase>('off');
  let cams = $state.raw<DeviceChoice[]>([]);
  let mics = $state.raw<DeviceChoice[]>([]);
  let camId = $state('');
  let micId = $state('');
  let resId = $state('720p');
  let mirror = $state(true);
  let stream = $state.raw<MediaStream | null>(null);
  let actual = $state<{ width: number; height: number; fps: number } | null>(null);
  let video = $state<HTMLVideoElement>();

  let paused = $state(false);
  let elapsed = $state(0);
  let bytes = $state(0);
  let result = $state.raw<{ blob: Blob; durationSec: number; baseName: string } | null>(null);
  let saved = $state(false);
  let photos = $state.raw<Photo[]>([]);
  let flash = $state(0);
  let zipping = $state(false);
  let error = $state('');
  let notice = $state('');

  let recording: Recording | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let title: ReturnType<typeof titleKeeper> | undefined;
  let run = 0;
  let photoId = 0;

  const busy = $derived(phase === 'recording' || phase === 'saving');
  const hasMic = $derived(!!stream?.getAudioTracks().length);

  onMount(() => {
    support = cameraSupport(detectEnv());
    title = titleKeeper();
    const guard = (e: BeforeUnloadEvent) => {
      if (busy || (result && !saved)) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => {
      window.removeEventListener('beforeunload', guard);
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
      run++;
      void recording?.stop();
      clearInterval(ticker);
      title?.restore();
      stopStreams(stream);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
    };
  });

  async function refreshDevices() {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    cams = deviceChoices(list, 'videoinput', 'Camera');
    mics = deviceChoices(list, 'audioinput', 'Microphone');
  }

  async function startCamera() {
    const req = ++run;
    stopStreams(stream);
    stream = null;
    actual = null;
    phase = 'starting';
    error = notice = '';
    const res = RESOLUTIONS.find((r) => r.id === resId) ?? RESOLUTIONS[1];
    const videoC = cameraConstraints(camId, res);
    const audioC = micId === NO_MIC ? false : micConstraints(micId);
    const gum = (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c);
    let s: MediaStream;
    try {
      s = await gum({ video: videoC, audio: audioC });
    } catch (e) {
      if (req !== run) return;
      const name = (e as { name?: string })?.name;
      // a missing or busy microphone shouldn't stop the camera; a refusal covers both, so stop there
      if (!audioC || name === 'NotAllowedError' || name === 'SecurityError') return fail(e, audioC ? 'camera and microphone' : 'camera');
      try {
        s = await gum({ video: videoC });
        notice = "Your microphone couldn't be opened, so recordings will have no sound. Pick another microphone to try again.";
      } catch (e2) {
        if (req === run) fail(e2, 'camera');
        return;
      }
    }
    if (req !== run) return stopStreams(s);
    stream = s;
    s.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (stream !== s) return;
      if (phase === 'recording') void stop();
      else stopCamera();
      error = 'The camera was disconnected. Plug it back in, or pick another camera, and turn it on again.';
    });
    const v = s.getVideoTracks()[0]?.getSettings() ?? {};
    camId = v.deviceId ?? camId;
    if (micId !== NO_MIC) micId = s.getAudioTracks()[0]?.getSettings().deviceId ?? micId;
    actual = { width: v.width ?? res.width, height: v.height ?? res.height, fps: Math.round(v.frameRate ?? 30) };
    phase = 'live';
    void refreshDevices();
  }

  function fail(e: unknown, what: 'camera' | 'camera and microphone') {
    phase = 'off';
    error = captureError(e, what);
  }

  function stopCamera() {
    run++;
    stopStreams(stream);
    stream = null;
    phase = 'off';
  }

  function record() {
    if (!stream || phase !== 'live') return;
    error = '';
    try {
      recording = new Recording(stream, {
        width: actual?.width ?? 1280,
        height: actual?.height ?? 720,
        fps: actual?.fps ?? 30,
        ondata: (b) => (bytes = b),
        onfail: () => {
          error = 'The browser stopped the recording unexpectedly. Everything captured up to that moment is below.';
          void stop();
        },
      });
      recording.start();
    } catch {
      recording = null;
      error = "Recording couldn't start in this browser. Try a lower resolution, or another browser.";
      return;
    }
    bytes = elapsed = 0;
    paused = saved = false;
    phase = 'recording';
    ticker = setInterval(tick, 250);
    tick();
  }

  function tick() {
    if (!recording) return;
    elapsed = recording.clock.elapsedMs;
    title?.set(`${paused ? 'Paused' : '● Recording'} ${formatTime(elapsed / 1000, 0)}`);
  }

  function togglePause() {
    if (!recording) return;
    if (recording.paused) recording.resume();
    else recording.pause();
    paused = recording.paused;
    tick();
  }

  async function stop() {
    if (phase !== 'recording' || !recording) return;
    phase = 'saving';
    const out = await recording.stop();
    recording = null;
    clearInterval(ticker);
    title?.restore();
    // the camera light goes off while you review
    stopCamera();
    if (!out.blob.size) {
      error = 'Nothing was recorded. Turn the camera on and try again.';
      return;
    }
    result = { ...out, baseName: recordingName('webcam-recording') };
    phase = 'done';
  }

  async function snap() {
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return;
    flash++;
    photos = [{ id: ++photoId, blob, url: URL.createObjectURL(blob), name: `${recordingName('photo')}.jpg` }, ...photos];
  }

  function removePhoto(p: Photo) {
    URL.revokeObjectURL(p.url);
    photos = photos.filter((x) => x !== p);
  }

  async function downloadPhotos() {
    zipping = true;
    try {
      downloadBlob(await zipFiles(photos.map((p) => ({ name: p.name, blob: p.blob }))), 'webcam-photos.zip');
    } finally {
      zipping = false;
    }
  }

  function restart() {
    result = null;
    void startCamera();
  }
</script>

{#if support}
  {@const copy = unsupportedCopy[support]}
  <div class="unsupported" role="status">
    <p class="font-serif text-[28px] leading-tight">{copy.title}</p>
    <p class="text-soft">{copy.text}</p>
  </div>
{:else}
  {#if error}<p class="msg bad" role="alert">{error}</p>{/if}
  {#if notice && phase !== 'done'}<p class="msg" role="status">{notice}</p>{/if}

  {#if phase === 'done' && result}
    <RecorderResult blob={result.blob} durationSec={result.durationSec} baseName={result.baseName} onrestart={restart} ondownload={() => (saved = true)} />
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="grid min-w-0 content-start gap-4">
        <div class="stage" class:live={!!stream} style:aspect-ratio={actual ? `${actual.width} / ${actual.height}` : '16 / 9'}>
          {#if stream}
            <video bind:this={video} class:mirror muted autoplay playsinline {@attach liveStream(stream)} aria-label="Camera preview"></video>
            {#key flash}{#if flash}<span class="flash" aria-hidden="true"></span>{/if}{/key}

            {#if phase === 'recording' || phase === 'saving'}
              <span class="chip" class:paused>
                <span class="dot" aria-hidden="true"></span>
                <span role="timer" aria-label="Recording time">{formatTime(elapsed / 1000, 0)}</span>
                <span class="opacity-70">· {formatBytes(bytes)}</span>
              </span>
            {/if}

            <div class="controls">
              <button type="button" class="round" onclick={snap} aria-label="Take a photo" title="Take a photo">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><circle cx="12" cy="12.5" r="3.3" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
              </button>
              {#if phase === 'recording' || phase === 'saving'}
                <button type="button" class="shutter on" disabled={phase === 'saving'} onclick={stop} aria-label="Stop recording"><span></span></button>
                <button type="button" class="round" onclick={togglePause} disabled={phase === 'saving'} aria-label={paused ? 'Resume recording' : 'Pause recording'} title={paused ? 'Resume' : 'Pause'}>
                  {#if paused}
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13M16 5.5v13" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
                  {/if}
                </button>
              {:else}
                <button type="button" class="shutter" disabled={phase !== 'live'} onclick={record} aria-label="Start recording"><span></span></button>
                <button type="button" class="round" onclick={stopCamera} aria-label="Turn camera off" title="Turn camera off">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
                </button>
              {/if}
            </div>
          {:else}
            <div class="idle">
              <button type="button" class="btn btn-primary" disabled={phase === 'starting' || support === undefined} onclick={startCamera}>
                {phase === 'starting' ? 'Starting camera…' : 'Turn on camera'}
              </button>
              <p class="mono">Your browser will ask to use the camera and microphone.</p>
            </div>
          {/if}
        </div>
        <p class="mono">
          {#if actual}{actual.width}×{actual.height} · {actual.fps} fps{hasMic ? ' · with sound' : ' · no sound'} · {/if}No time limit, no watermark. Nothing leaves your device.
        </p>
      </div>

      <aside class="grid content-start gap-5">
        <fieldset class="grid gap-5" disabled={busy || phase === 'starting'}>
          <label>
            <span class="label">camera</span>
            <select class="field" bind:value={camId} onchange={() => stream && startCamera()}>
              {#if !cams.length}<option value="">Default camera</option>{/if}
              {#each cams as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
            </select>
          </label>
          <div class="grid gap-2">
            <label>
              <span class="label">microphone</span>
              <select class="field" bind:value={micId} onchange={() => stream && startCamera()}>
                {#if !mics.length}<option value="">Default microphone</option>{/if}
                {#each mics as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
                <option value={NO_MIC}>No microphone</option>
              </select>
            </label>
            {#if stream && hasMic}<RecorderMeter {stream} />{/if}
          </div>
          <div>
            <span class="label">resolution</span>
            <div class="seg" role="group" aria-label="Resolution">
              {#each RESOLUTIONS as r (r.id)}
                <button type="button" aria-pressed={resId === r.id} onclick={() => ((resId = r.id), stream && startCamera())}>{r.label}</button>
              {/each}
            </div>
            <p class="mono mt-1.5">Your camera may top out lower; the size it gives is shown under the preview.</p>
          </div>
        </fieldset>
        <div>
          <button type="button" class="btn toggle" aria-pressed={mirror} onclick={() => (mirror = !mirror)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v18M9 7L4 17h5zM15 7l5 10h-5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            Mirror preview
          </button>
          <p class="mono mt-1.5">Only flips what you see here. Videos and photos are saved the right way round, so text reads correctly.</p>
        </div>
      </aside>
    </div>
  {/if}

  {#if photos.length}
    <section class="photos" aria-label="Photos">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="font-serif text-[22px] leading-none">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
        {#if photos.length > 1}
          <button type="button" class="btn sm" disabled={zipping} onclick={downloadPhotos}>{zipping ? 'Zipping…' : 'Download all (zip)'}</button>
        {/if}
      </div>
      <ul>
        {#each photos as p (p.id)}
          <li>
            <img src={p.url} alt="Snapshot from your camera" />
            <span class="acts">
              <button type="button" class="btn sm" onclick={() => downloadBlob(p.blob, p.name)} aria-label={`Download ${p.name}`}>↓</button>
              <button type="button" class="btn sm" onclick={() => removePhoto(p)} aria-label={`Remove ${p.name}`}>✕</button>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .unsupported {
    display: grid;
    gap: 10px;
    padding: 28px;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background: radial-gradient(circle at 15% 0%, #ff6b4a14, transparent 55%), var(--color-panel-2);
  }
  .msg {
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ffd25e55;
    background: #ffd25e0d;
    font-size: 14px;
    &.bad {
      border-color: #ff7a6b66;
      background: #ff7a6b12;
    }
  }

  .stage {
    position: relative;
    width: 100%;
    max-height: 72vh;
    overflow: hidden;
    border-radius: 18px;
    border: 1px solid var(--color-line-2);
    background:
      radial-gradient(circle at 50% 42%, #ffd25e12, transparent 60%),
      linear-gradient(#f2ede40d 1px, transparent 1px) 0 0 / 24px 24px,
      linear-gradient(90deg, #f2ede40d 1px, transparent 1px) 0 0 / 24px 24px,
      #0e0d0c;
    &.live {
      background: #000;
    }
    & video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: transform 0.35s var(--ease-spring);
      &.mirror {
        transform: scaleX(-1);
      }
    }
  }
  .idle {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    padding: 16px;
    text-align: center;
  }
  .flash {
    position: absolute;
    inset: 0;
    background: #fff;
    pointer-events: none;
    animation: flash 0.45s ease-out forwards;
  }
  @keyframes flash {
    from {
      opacity: 0.75;
    }
    to {
      opacity: 0;
    }
  }
  .chip {
    position: absolute;
    top: 12px;
    left: 12px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 99px;
    background: #000000a6;
    font: 500 13px var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--color-chalk);
    & .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--color-video);
      animation: blink 1.2s ease-in-out infinite;
    }
    &.paused .dot {
      background: var(--color-sun);
      animation: none;
    }
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .controls {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 28px 12px 14px;
    background: linear-gradient(transparent, #000000a0);
  }
  .round {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    border: 1px solid #ffffff40;
    background: #00000066;
    color: #fff;
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), background 0.2s;
    &:hover:not(:disabled) {
      background: #000000a0;
    }
    &:active {
      transform: scale(0.92);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .shutter {
    display: grid;
    place-items: center;
    width: 66px;
    height: 66px;
    border-radius: 50%;
    border: 3px solid #fff;
    background: transparent;
    cursor: pointer;
    & span {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: var(--color-video);
      transition: width 0.25s var(--ease-spring), height 0.25s var(--ease-spring), border-radius 0.25s var(--ease-spring);
    }
    &.on span {
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
  .toggle[aria-pressed='true'] {
    border-color: var(--color-sun);
    color: var(--color-sun);
  }
  .btn.sm {
    padding: 7px 12px;
    font-size: 13px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  fieldset:disabled {
    opacity: 0.55;
  }

  .photos {
    display: grid;
    gap: 12px;
    margin-top: 20px;
    & ul {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
    }
    & li {
      position: relative;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--color-line-2);
      background: #000;
      animation: arrive 0.35s var(--ease-spring);
    }
    & img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
    }
    & .acts {
      position: absolute;
      right: 6px;
      bottom: 6px;
      display: flex;
      gap: 6px;
    }
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
  }
</style>
