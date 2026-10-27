<script lang="ts">
  import { decodeAudio, downloadName, formatBytes, MediaError, throwIfAborted, transcode, type AudioOptions } from '@/engines/media';
  import { clock } from '@/tools/lib/video-retouch/job';
  import { CHOPPY_FPS, clampSpeed, FAST_FPS_CAP, formatFps, MAX_SPEED, MIN_SPEED, outputFps, PRESETS, sliderToSpeed, speedLabel, speedSuffix, speedToSlider, type AudioMode } from '@/tools/lib/video-speed/speed';
  import { stretchedBytes, TimeStretcher } from '@/tools/lib/video-speed/stretch';
  import VideoRetouchShell, { type RetouchJob, type RetouchSource } from './VideoRetouchShell.svelte';
  import VideoRetouchTransport from './VideoRetouchTransport.svelte';

  /** the stretched soundtrack is held in memory as 16-bit WAV until the video is written */
  const PITCH_MEMORY_LIMIT = 1_200_000_000;
  /** audio is decoded in windows so a long film never sits in memory as raw samples */
  const WINDOW_SEC = 30;
  /** decoded and thrown away before each window, so codec warm-up never lands in the output */
  const PREROLL_SEC = 0.5;
  /** share of the progress bar for stretching the audio */
  const AUDIO_SHARE = 0.25;

  let speed = $state(2);
  let mode = $state<AudioMode>('pitch');
  let info = $state.raw<RetouchSource['info'] | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let previewBroken = $state(false);

  function onsource(src: RetouchSource) {
    info = src.info;
    previewBroken = false;
  }

  const audio = $derived(info?.audio);
  const pitchBlock = $derived.by(() => {
    if (!audio || !info) return null;
    // without WebCodecs every 30 s window would decode the whole file again through Web Audio
    if (!audio.canDecode || typeof AudioDecoder === 'undefined') return "This browser can't decode the soundtrack, so it can only follow the speed or be muted.";
    const bytes = stretchedBytes(info.durationSec, speed, audio.sampleRate, Math.min(2, audio.channels));
    return bytes > PITCH_MEMORY_LIMIT ? `Too long to stretch in browser memory at ${speedLabel(speed)} (about ${formatBytes(bytes)} of audio). Try a faster speed, or let the pitch follow.` : null;
  });
  const audioMode = $derived<AudioMode>(mode === 'pitch' && pitchBlock ? 'tape' : mode);

  // the preview plays at the chosen speed; browsers keep pitch by default, which is what "keep pitch" sounds like
  $effect(() => {
    const v = videoEl;
    if (!v) return;
    v.defaultPlaybackRate = speed;
    v.playbackRate = speed;
    v.preservesPitch = audioMode === 'pitch';
    v.muted = audioMode === 'mute';
  });

  const fps = $derived(outputFps(info?.video?.fps, speed));
  const sourceFps = $derived(info?.video?.fps ?? null);
  const blocked = $derived(speed === 1 ? 'Pick a speed other than 1×' : null);

  const modes: { id: AudioMode; label: string; hint: string }[] = [
    { id: 'pitch', label: 'keep pitch', hint: 'Voices and music keep their normal pitch. The sound is time-stretched, which can add a slight warble at extreme speeds.' },
    { id: 'tape', label: 'pitch follows', hint: 'Like a tape played fast or slow: faster sounds higher, slower sounds deeper.' },
    { id: 'mute', label: 'mute', hint: 'The saved video has no sound at all.' },
  ];

  async function stretchSoundtrack(src: RetouchSource, s: number, signal: AbortSignal, onProgress: (p: number) => void): Promise<Blob> {
    const duration = src.info.durationSec;
    // more than two channels (5.1 and up) are mixed to mono so dialogue in the centre channel isn't lost
    const mono = (src.info.audio?.channels ?? 2) > 2;
    let st: TimeStretcher | null = null;
    for (let at = 0; at < duration; at += WINDOW_SEC) {
      const from = Math.max(0, at - PREROLL_SEC);
      const pcm = await decodeAudio(src.file, { start: from, end: Math.min(duration, at + WINDOW_SEC), mono }, { signal });
      if (!pcm.channels.length) continue;
      st ??= new TimeStretcher(s, pcm.sampleRate, pcm.channels.length);
      const skip = Math.round((at - from) * pcm.sampleRate);
      const planes = pcm.channels.map((c) => c.subarray(skip));
      // two seconds at a time, yielding in between so the page stays responsive
      const slice = pcm.sampleRate * 2;
      for (let i = 0; i < planes[0].length; i += slice) {
        throwIfAborted(signal);
        st.push(planes.map((p) => p.subarray(i, i + slice)));
        await new Promise((r) => setTimeout(r));
      }
      onProgress(Math.min(1, (at + WINDOW_SEC) / duration));
    }
    if (!st) throw new MediaError('no-tracks', "Couldn't read any sound from this video. Try muting it or letting the pitch follow.");
    st.finish();
    return st.toWav();
  }

  async function run({ source, container, signal, onProgress, onStatus }: RetouchJob) {
    const s = speed;
    const m = audioMode;
    let audioOpts: AudioOptions | false | undefined;
    let from = 0;
    if (source.info.audio && m === 'mute') audioOpts = false;
    if (source.info.audio && m === 'pitch') {
      onStatus('Stretching the sound…');
      const wav = await stretchSoundtrack(source, s, signal, (p) => onProgress(p * AUDIO_SHARE));
      // a bitrate makes the engine re-encode the WAV rather than copy raw PCM into MOV/MKV
      audioOpts = { replace: wav, bitrate: 192_000 };
      from = AUDIO_SHARE;
    }
    return transcode(source.file, { container, video: { speed: s }, audio: audioOpts }, { signal, onStatus, onProgress: (p) => onProgress(from + (1 - from) * p) });
  }
</script>

<VideoRetouchShell action="Save at {speedLabel(speed)}" {blocked} {run} {onsource} outputName={(name, c) => downloadName(name, c, speedSuffix(speed))}>
  {#snippet editor(src)}
    <div class="layout">
      <div class="grid content-start gap-3">
        <div class="stage">
          {#if previewBroken}
            <p class="mono p-6 text-center">This browser can't play this file as a preview. Saving still works.</p>
          {:else}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={videoEl} src={src.url} playsinline loop preload="metadata" aria-label="Preview at {speedLabel(speed)}" onerror={() => (previewBroken = true)}></video>
            <span class="badge mono" aria-hidden="true">{speedLabel(speed)}</span>
          {/if}
        </div>
        {#if !previewBroken}<VideoRetouchTransport video={videoEl} rate={speed} />{/if}
      </div>

      <div class="grid content-start gap-5">
        <div>
          <div class="flex items-baseline justify-between gap-2">
            <label class="label" for="speed-slider">speed</label>
            <span class="mono flex items-center gap-1">
              <input class="field num" type="number" min={MIN_SPEED} max={MAX_SPEED} step="0.05" value={speed} onchange={(e) => {
                  speed = clampSpeed(Number(e.currentTarget.value));
                  // the field keeps what was typed when clamping lands on the current speed
                  e.currentTarget.value = String(speed);
                }} aria-label="Speed multiplier" />×
            </span>
          </div>
          <input
            id="speed-slider"
            type="range"
            min={speedToSlider(MIN_SPEED)}
            max={speedToSlider(MAX_SPEED)}
            step="0.01"
            value={speedToSlider(speed)}
            oninput={(e) => (speed = sliderToSpeed(Number(e.currentTarget.value)))}
            aria-valuetext={speedLabel(speed)}
            class="w-full accent-(--color-sun)"
          />
          <span class="mono flex justify-between" aria-hidden="true"><span>0.25×</span><span>1×</span><span>4×</span></span>
          <div class="seg mt-3" role="group" aria-label="Speed presets">
            {#each PRESETS as p}
              <button type="button" aria-pressed={speed === p} onclick={() => (speed = p)}>{p}×</button>
            {/each}
          </div>
        </div>

        <div class="summary grid gap-1">
          <p>
            <span class="text-soft">{clock(src.info.durationSec)}</span>
            <span class="text-muted">→</span>
            <span class="font-serif text-2xl">{clock(src.info.durationSec / speed)}</span>
          </p>
          {#if fps && sourceFps}
            <p class="mono">
              plays at {formatFps(fps)}{speed < 1 ? ` (from ${formatFps(sourceFps)})` : ''}{speed > 1 && sourceFps * speed > FAST_FPS_CAP ? `, extra frames dropped` : ''}
            </p>
          {/if}
        </div>

        {#if speed < 1}
          <p class="note" class:warn={!!fps && fps < CHOPPY_FPS}>
            Slow motion stretches the frames the video already has. It doesn't invent new in-between frames, so
            {#if fps && sourceFps}{formatFps(sourceFps)} footage at {speedLabel(speed)} plays at {formatFps(fps)}{fps < CHOPPY_FPS ? ' and will look choppy' : ''}.{:else}very slow speeds can look choppy.{/if}
            Footage shot at 60 fps or more slows down most smoothly.
          </p>
        {/if}

        {#if src.info.audio}
          <div>
            <span class="label" id="audio-mode">sound</span>
            <div class="seg" role="group" aria-labelledby="audio-mode">
              {#each modes as m}
                {@const why = m.id === 'pitch' ? pitchBlock : null}
                <button type="button" aria-pressed={audioMode === m.id} disabled={!!why} title={why ?? undefined} onclick={() => (mode = m.id)}>{m.label}</button>
              {/each}
            </div>
            <p class="mono mt-2">{pitchBlock && mode === 'pitch' ? pitchBlock : modes.find((m) => m.id === audioMode)?.hint}</p>
          </div>
        {:else}
          <p class="mono">This video has no sound track.</p>
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
      grid-template-columns: minmax(0, 1fr) 320px;
    }
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 200px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: #0d0c0b;
    overflow: hidden;
    & video {
      width: 100%;
      max-height: 440px;
      background: #000;
    }
  }
  .badge {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 3px 9px;
    border-radius: 99px;
    background: var(--color-sun);
    color: var(--color-bg);
    font-weight: 600;
    pointer-events: none;
  }
  .num {
    width: 72px;
    padding: 4px 8px;
    font: 400 13px var(--font-mono);
    text-align: right;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
    border-left: 2px solid var(--color-line-2);
    &.warn {
      border-left-color: var(--color-sun);
    }
  }
</style>
