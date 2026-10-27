<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes, formatTime } from '@/engines/media/math';
  import { titleKeeper } from '@/tools/lib/timers/ticker';
  import { mixAudio, type Mix } from '@/tools/lib/recorder/audio';
  import { holding, liveStream } from '@/tools/lib/recorder/attach';
  import {
    cameraConstraints,
    captureError,
    detectEnv,
    deviceChoices,
    displayMediaOptions,
    micConstraints,
    screenSupport,
    unsupportedCopy,
    type DeviceChoice,
    type Surface,
    type Unsupported,
  } from '@/tools/lib/recorder/capture';
  import { recordingName } from '@/tools/lib/recorder/clock';
  import { composite, type Compositor } from '@/tools/lib/recorder/compositor';
  import { bubbleRect, type BubbleSize, type Corner } from '@/tools/lib/recorder/layout';
  import { Recording, stopStreams } from '@/tools/lib/recorder/session';
  import RecorderMeter from './RecorderMeter.svelte';
  import RecorderResult from './RecorderResult.svelte';

  type Phase = 'setup' | 'asking' | 'countdown' | 'recording' | 'saving' | 'done';

  const SURFACES: [Surface, string][] = [['monitor', 'Screen'], ['window', 'Window'], ['browser', 'Tab']];
  const CORNERS: [Corner, string][] = [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];
  const SIZES: [BubbleSize, string][] = [['small', 'S'], ['medium', 'M'], ['large', 'L']];
  const BUBBLE_CAMERA = { width: 1280, height: 720 };

  /** undefined until checked in the browser */
  let support = $state<Unsupported | null | undefined>(undefined);
  let phase = $state<Phase>('setup');
  let surface = $state<Surface>('monitor');
  let fps = $state(30);
  let systemAudio = $state(true);
  let micOn = $state(false);
  let camOn = $state(false);
  let corner = $state<Corner>('bottom-right');
  let bubbleSize = $state<BubbleSize>('medium');
  let countdownOn = $state(true);
  let mics = $state.raw<DeviceChoice[]>([]);
  let cams = $state.raw<DeviceChoice[]>([]);
  let micId = $state('');
  let camId = $state('');
  let micStream = $state.raw<MediaStream | null>(null);
  let camStream = $state.raw<MediaStream | null>(null);
  let micMuted = $state(false);

  let display = $state.raw<MediaStream | null>(null);
  let compositor = $state.raw<Compositor | null>(null);
  let count = $state(0);
  let paused = $state(false);
  let elapsed = $state(0);
  let bytes = $state(0);
  let result = $state.raw<{ blob: Blob; durationSec: number; baseName: string } | null>(null);
  let saved = $state(false);
  let error = $state('');
  let notice = $state('');

  let recording: Recording | null = null;
  let mix: Mix | null = null;
  let audioCtx: AudioContext | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let title: ReturnType<typeof titleKeeper> | undefined;
  /** bumping these abandons whatever a start or a device request is still waiting for */
  let run = 0;
  let micReq = 0;
  let camReq = 0;

  const bubble = $derived({ corner, size: bubbleSize });
  /** the setup preview places the bubble exactly where it lands on a 16:9 recording */
  const bubbleStyle = $derived.by(() => {
    const r = bubbleRect(1600, 900, bubble);
    return `left:${r.x / 16}%;top:${r.y / 9}%;width:${r.size / 16}%`;
  });
  const busy = $derived(phase !== 'setup' && phase !== 'done');

  $effect(() => {
    compositor?.setBubble(bubble);
  });

  onMount(() => {
    support = screenSupport(detectEnv());
    title = titleKeeper();
    const guard = (e: BeforeUnloadEvent) => {
      if (busy || (result && !saved)) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => {
      window.removeEventListener('beforeunload', guard);
      navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
      // also abandon permission prompts still open, or their streams would keep the mic or camera on
      run++;
      micReq++;
      camReq++;
      void recording?.stop();
      cleanup();
      stopStreams(micStream, camStream);
    };
  });

  async function refreshDevices() {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    mics = deviceChoices(list, 'audioinput', 'Microphone');
    cams = deviceChoices(list, 'videoinput', 'Camera');
  }

  async function setMic(on: boolean) {
    const req = ++micReq;
    stopStreams(micStream);
    micStream = null;
    micOn = on;
    micMuted = false;
    if (!on) return;
    error = '';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(micId) });
      if (req !== micReq) return stopStreams(s);
      micStream = s;
      micId = s.getAudioTracks()[0]?.getSettings().deviceId ?? micId;
      void refreshDevices();
    } catch (e) {
      if (req !== micReq) return;
      micOn = false;
      error = captureError(e, 'microphone');
    }
  }

  async function setCam(on: boolean) {
    const req = ++camReq;
    stopStreams(camStream);
    camStream = null;
    camOn = on;
    if (!on) return;
    error = '';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(camId, BUBBLE_CAMERA) });
      if (req !== camReq) return stopStreams(s);
      camStream = s;
      camId = s.getVideoTracks()[0]?.getSettings().deviceId ?? camId;
      void refreshDevices();
    } catch (e) {
      if (req !== camReq) return;
      camOn = false;
      error = captureError(e, 'camera');
    }
  }

  function toggleMute() {
    micMuted = !micMuted;
    micStream?.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
  }

  async function start() {
    if (busy) return;
    error = notice = '';
    const gen = ++run;
    phase = 'asking';
    // two sound sources are mixed with Web Audio; a context made during this click is allowed to run
    audioCtx = systemAudio && micStream ? new AudioContext() : null;
    let stream: MediaStream;
    const ask = (audio: boolean) => navigator.mediaDevices.getDisplayMedia(displayMediaOptions({ surface, fps, systemAudio: audio }));
    try {
      // a browser that can't share sound may reject the request outright rather than ignore it
      stream = await ask(systemAudio).catch((e) => (systemAudio && e?.name === 'TypeError' ? ask(false) : Promise.reject(e)));
    } catch (e) {
      if (gen !== run) return;
      cleanup();
      phase = 'setup';
      error = captureError(e, 'screen');
      return;
    }
    if (gen !== run) return stopStreams(stream);
    display = stream;
    // the browser's own "Stop sharing" button
    stream.getVideoTracks()[0].addEventListener('ended', () => void stop());
    if (systemAudio && !stream.getAudioTracks().length) {
      notice = 'No sound came with what you shared, so only the picture (and your microphone, if on) is recorded. For sound, share a tab with "Share tab audio" ticked, or on Windows the entire screen with "Share system audio".';
    }
    if (countdownOn) {
      phase = 'countdown';
      for (count = 3; count > 0; count--) {
        await new Promise((r) => setTimeout(r, 1000));
        if (gen !== run) return;
      }
    }
    try {
      await begin(stream, gen);
    } catch {
      recording = null;
      if (gen !== run) return;
      cleanup();
      phase = 'setup';
      error = "Recording couldn't start in this browser. Try again, or try turning off the webcam bubble.";
    }
  }

  async function begin(stream: MediaStream, gen: number) {
    const screen = stream.getVideoTracks()[0];
    const cam = camStream?.getVideoTracks()[0];
    if (cam?.readyState === 'live') {
      const c = await composite(screen, cam, { fps, bubble });
      if (gen !== run) return c.stop();
      compositor = c;
    }
    mix = mixAudio([...stream.getAudioTracks(), ...(micStream?.getAudioTracks() ?? [])], audioCtx);
    audioCtx = null;
    const { width = 1920, height = 1080 } = compositor ? compositor.canvas : screen.getSettings();
    recording = new Recording(new MediaStream([compositor?.track ?? screen, ...(mix.track ? [mix.track] : [])]), {
      width,
      height,
      fps,
      ondata: (b) => (bytes = b),
      onfail: () => {
        error = 'The browser stopped the recording unexpectedly. Everything captured up to that moment is below.';
        void stop();
      },
    });
    recording.start();
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
    if (phase === 'asking' || phase === 'countdown') {
      run++;
      cleanup();
      phase = 'setup';
      return;
    }
    if (phase !== 'recording' || !recording) return;
    phase = 'saving';
    const out = await recording.stop();
    recording = null;
    cleanup();
    // turn the camera light and microphone off while reviewing
    stopStreams(micStream, camStream);
    micStream = camStream = null;
    if (!out.blob.size) {
      phase = 'setup';
      error = 'Nothing was recorded. Try again, and keep the shared screen open while recording.';
      return;
    }
    result = { ...out, baseName: recordingName('screen-recording') };
    phase = 'done';
  }

  function cleanup() {
    clearInterval(ticker);
    title?.restore();
    compositor?.stop();
    compositor = null;
    mix?.close();
    mix = null;
    void audioCtx?.close();
    audioCtx = null;
    stopStreams(display);
    display = null;
    count = 0;
  }

  function restart() {
    result = null;
    error = notice = '';
    phase = 'setup';
    if (micOn) void setMic(true);
    if (camOn) void setCam(true);
  }
</script>

{#if support}
  {@const copy = unsupportedCopy[support]}
  <div class="unsupported" role="status">
    <p class="font-serif text-[28px] leading-tight">{copy.title}</p>
    <p class="text-soft">{copy.text}</p>
    {#if support === 'mobile-screen'}
      <p class="text-soft">You can still record yourself with the <a href="/webcam-recorder">webcam recorder</a>, which works on phones.</p>
    {/if}
  </div>
{:else}
  {#if error}<p class="msg bad" role="alert">{error}</p>{/if}
  {#if notice && phase !== 'done'}<p class="msg" role="status">{notice}</p>{/if}

  {#if phase === 'done' && result}
    <RecorderResult blob={result.blob} durationSec={result.durationSec} baseName={result.baseName} onrestart={restart} ondownload={() => (saved = true)} />
  {:else}
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="grid min-w-0 content-start gap-4">
        <div class="stage" class:live={!!display}>
          {#if compositor}
            <div class="host" {@attach holding(compositor.canvas)}></div>
          {:else if display}
            <video muted autoplay playsinline {@attach liveStream(display)} aria-label="Preview of what is being recorded"></video>
          {:else}
            <div class="idle">
              <button type="button" class="start" disabled={phase === 'asking' || support === undefined} onclick={start}>
                <span class="knob" aria-hidden="true"><span></span></span>
                <span class="font-serif text-[26px] leading-none">Start recording</span>
              </button>
              <p class="mono" aria-live="polite">
                {phase === 'asking' ? 'Choose what to share in the browser window…' : 'Next, your browser asks what to share'}
              </p>
            </div>
            {#if camStream}
              <video class="bubble" style={bubbleStyle} muted autoplay playsinline {@attach liveStream(camStream)} aria-label="Webcam bubble preview"></video>
            {/if}
          {/if}
          {#if phase === 'countdown' && count > 0}
            <div class="countdown" aria-live="assertive">
              {#key count}<span>{count}</span>{/key}
            </div>
          {/if}
        </div>

        {#if phase === 'countdown' || phase === 'recording' || phase === 'saving'}
          <div class="bar">
            <span class="rec" class:paused class:waiting={phase === 'countdown'}>
              <span class="dot" aria-hidden="true"></span>
              {phase === 'countdown' ? 'Starting' : paused ? 'Paused' : 'Rec'}
            </span>
            <span class="time" role="timer" aria-label="Recording time">{formatTime(elapsed / 1000, 0)}</span>
            <span class="mono">{formatBytes(bytes)}</span>
            {#if micStream}
              <span class="mic">
                <button type="button" class="btn sm" aria-pressed={micMuted} onclick={toggleMute}>{micMuted ? 'Unmute mic' : 'Mute mic'}</button>
                <RecorderMeter stream={micStream} muted={micMuted} />
              </span>
            {/if}
            <span class="ml-auto flex gap-2">
              {#if phase === 'recording'}
                <button type="button" class="btn sm" onclick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
              {/if}
              <button type="button" class="btn sm stop" disabled={phase === 'saving'} onclick={stop}>
                {phase === 'countdown' ? 'Cancel' : phase === 'saving' ? 'Saving…' : 'Stop'}
              </button>
            </span>
          </div>
        {:else}
          <p class="mono">No time limit and no watermark. The recording stays on your device until you download it.</p>
        {/if}
      </div>

      <aside class="grid content-start gap-5">
        <fieldset class="grid gap-5" disabled={busy}>
          <div>
            <span class="label">what to share</span>
            <div class="seg" role="group" aria-label="What to share">
              {#each SURFACES as [value, label] (value)}
                <button type="button" aria-pressed={surface === value} onclick={() => (surface = value)}>{label}</button>
              {/each}
            </div>
            <p class="mono mt-1.5">Pre-selects the browser's picker. You can still choose anything there.</p>
          </div>

          <div class="grid gap-2.5">
            <span class="label mb-0!">sound</span>
            <label class="check">
              <input type="checkbox" bind:checked={systemAudio} />
              <span>Tab or system sound<span class="mono block">Chrome and Edge share a tab's sound, and the whole screen's on Windows and ChromeOS. Firefox and Safari share the picture only.</span></span>
            </label>
            <label class="check">
              <input type="checkbox" checked={micOn} onchange={(e) => setMic(e.currentTarget.checked)} />
              <span>Microphone<span class="mono block">your voice, mixed with the tab sound</span></span>
            </label>
            {#if micStream}
              {#if mics.length > 1}
                <select class="field" bind:value={micId} onchange={() => setMic(true)} aria-label="Microphone">
                  {#each mics as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
                </select>
              {/if}
              <RecorderMeter stream={micStream} />
            {/if}
          </div>

          <div>
            <span class="label">frame rate</span>
            <div class="seg" role="group" aria-label="Frame rate">
              {#each [30, 60] as value (value)}
                <button type="button" aria-pressed={fps === value} onclick={() => (fps = value)}>{value} fps</button>
              {/each}
            </div>
            <p class="mono mt-1.5">60 suits games and scrolling; 30 keeps files smaller.</p>
          </div>

          <label class="check">
            <input type="checkbox" bind:checked={countdownOn} />
            <span>3-2-1 countdown<span class="mono block">time to switch to the window you're recording</span></span>
          </label>
        </fieldset>

        <fieldset class="grid gap-3" disabled={busy && !compositor}>
          <span class="label mb-0!">webcam bubble</span>
          <label class="check">
            <input type="checkbox" checked={camOn} disabled={busy} onchange={(e) => setCam(e.currentTarget.checked)} />
            <span>Show my webcam in a circle<span class="mono block">drawn into the video, so it's in every player</span></span>
          </label>
          {#if camOn}
            {#if cams.length > 1 && !busy}
              <select class="field" bind:value={camId} onchange={() => setCam(true)} aria-label="Camera">
                {#each cams as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
              </select>
            {/if}
            <div class="flex flex-wrap gap-3">
              <div class="seg corners" role="group" aria-label="Bubble position">
                {#each CORNERS as [value, label] (value)}
                  <button type="button" aria-pressed={corner === value} aria-label={label} title={label} onclick={() => (corner = value)}>
                    <svg viewBox="0 0 16 12" width="18" height="14" aria-hidden="true">
                      <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" />
                      <circle cx={value.endsWith('left') ? 4.5 : 11.5} cy={value.startsWith('top') ? 4 : 8} r="2.2" fill="currentColor" />
                    </svg>
                  </button>
                {/each}
              </div>
              <div class="seg" role="group" aria-label="Bubble size">
                {#each SIZES as [value, label] (value)}
                  <button type="button" aria-pressed={bubbleSize === value} aria-label={`${value} bubble`} onclick={() => (bubbleSize = value)}>{label}</button>
                {/each}
              </div>
            </div>
            {#if compositor}<p class="mono">Move or resize it any time while recording.</p>{/if}
          {/if}
        </fieldset>
      </aside>
    </div>
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
    & a {
      color: var(--color-sun);
    }
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
      color: var(--color-chalk);
    }
  }

  .stage {
    position: relative;
    aspect-ratio: 16 / 9;
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
    & > video,
    & .host {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    & .host :global(canvas) {
      width: 100%;
      height: 100%;
      object-fit: contain;
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
  .start {
    display: grid;
    justify-items: center;
    gap: 14px;
    padding: 10px 16px;
    border: 0;
    border-radius: 18px;
    background: none;
    color: var(--color-chalk);
    cursor: pointer;
    &:disabled {
      opacity: 0.5;
      cursor: progress;
    }
    &:hover:not(:disabled) .knob span {
      transform: scale(1.12);
    }
  }
  .knob {
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    border: 3px solid var(--color-chalk);
    box-shadow: 0 0 0 8px #f2ede40f;
    & span {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--color-video);
      transition: transform 0.25s var(--ease-spring);
    }
  }
  .bubble {
    position: absolute;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #ffffffd9, 0 10px 30px #0008;
    transition: left 0.35s var(--ease-spring), top 0.35s var(--ease-spring), width 0.35s var(--ease-spring);
  }
  .countdown {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0009;
    & span {
      font: 400 clamp(90px, 22vw, 180px) / 1 var(--font-serif);
      color: var(--color-sun);
      animation: count 1s ease-out both;
      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }
  }
  @keyframes count {
    from {
      transform: scale(1.6);
      opacity: 0;
    }
    25% {
      transform: scale(1);
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    to {
      opacity: 0.2;
    }
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
  }
  .rec {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 500 12.5px var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-video);
    & .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: currentColor;
      animation: blink 1.2s ease-in-out infinite;
    }
    &.paused,
    &.waiting {
      color: var(--color-sun);
      & .dot {
        animation: none;
      }
    }
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .time {
    font: 400 30px / 1 var(--font-serif);
    font-variant-numeric: tabular-nums;
    min-width: 3.2em;
  }
  .mic {
    display: inline-grid;
    grid-template-columns: auto 70px;
    align-items: center;
    gap: 10px;
  }
  .btn.sm {
    padding: 8px 13px;
    font-size: 14px;
  }
  .btn.stop {
    background: var(--color-video);
    border-color: var(--color-video);
    color: var(--color-bg);
  }
  .btn[aria-pressed='true'] {
    border-color: var(--color-sun);
    color: var(--color-sun);
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
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    & input {
      margin-top: 4px;
      accent-color: var(--color-sun);
    }
  }
  .corners button {
    display: grid;
    place-items: center;
    padding: 7px 10px;
  }
</style>
