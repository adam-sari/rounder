<script lang="ts">
  import { onMount } from 'svelte';
  import { load, save } from '@/tools/lib/timers/store';
  import { detectPitch, rms } from '@/tools/lib/pitch/mpm';
  import { A4_MAX, A4_MIN, cents, clampA4, midiToFreq, nearestNote, noteName } from '@/tools/lib/pitch/notes';
  import { INSTRUMENTS, closestString, instrumentById, stringTargets, type Target } from '@/tools/lib/pitch/instruments';
  import { PitchSmoother } from '@/tools/lib/pitch/smoother';

  const KEY = 'rounder:tuner';
  /** within this many cents counts as in tune */
  const IN_TUNE = 3;
  /** analyses in a row inside the window before a string is ticked off (~0.6 s) */
  const HOLD = 15;
  const ANALYSE_MS = 40;
  const HISTORY = 90;

  let instId = $state('guitar');
  let a4 = $state(440);
  /** a string the user picked; null follows whichever string is closest */
  let locked = $state<number | null>(null);
  let mic = $state<'off' | 'starting' | 'on'>('off');
  let error = $state('');
  let freq = $state<number | null>(null);
  let level = $state(0);
  let needle = $state(0);
  let history = $state<(number | null)[]>([]);
  let tuned = $state<number[]>([]);
  /** the reference tone that is sounding, if any */
  let playing = $state<Target | null>(null);
  let ready = $state(false);

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let tone: { osc: OscillatorNode; out: GainNode; timer: number } | null = null;
  let wave: PeriodicWave | null = null;
  let frame = 0;
  let reduced = false;
  let streak = 0;
  const smoother = new PitchSmoother();

  const inst = $derived(instrumentById(instId));
  const targets = $derived(stringTargets(inst, a4));
  const note = $derived(freq ? nearestNote(freq, a4) : null);
  const target = $derived.by((): Target | null => {
    if (!freq) return null;
    if (!targets.length) return { index: -1, midi: note!.midi, freq: midiToFreq(note!.midi, a4) };
    return locked !== null ? targets[locked] : closestString(freq, targets);
  });
  const off = $derived(freq && target ? cents(freq, target.freq) : null);
  const inTune = $derived(off !== null && Math.abs(off) <= IN_TUNE);
  const verdict = $derived(
    off === null ? '' : inTune ? 'In tune' : `${Math.abs(off) > 50 ? 'Way ' : ''}${off < 0 ? 'flat · tune up' : 'sharp · tune down'}`,
  );
  const allTuned = $derived(targets.length > 0 && tuned.length === targets.length);
  const label = (t: Target) => {
    const n = noteName(t.midi);
    return `${n.name}${n.octave}`;
  };

  onMount(() => {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = load(KEY, { instId, a4 });
    instId = instrumentById(s.instId).id;
    a4 = clampA4(s.a4);
    ready = true;
    return () => {
      stopMic();
      stopTone();
      void ctx?.close();
    };
  });

  $effect(() => {
    if (ready) save(KEY, { instId, a4 });
  });

  /** created inside a click so the browser lets it make sound */
  function audio() {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function micError(e: unknown): string {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return 'Microphone access was blocked. Click the icon next to the address bar (a lock or a slider), allow the microphone for this site, then press Start again. If this page is embedded in another site, open it directly.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in or check that your input device is switched on, then try again.';
    if (name === 'NotReadableError' || name === 'AbortError')
      return 'The microphone is busy or unavailable. Close other apps or tabs that might be using it, such as a video call, and try again.';
    return `The microphone couldn't be started${e instanceof Error && e.message ? ` (${e.message})` : ''}.`;
  }

  async function startMic() {
    error = '';
    if (!window.isSecureContext) {
      error = "Browsers only offer the microphone on secure (https://) pages, and this one isn't. Open the page with https:// in the address and try again.";
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      error = "This browser can't use a microphone on web pages. Try a current version of Chrome, Edge, Firefox or Safari.";
      return;
    }
    const ac = audio();
    mic = 'starting';
    try {
      // raw input: echo cancellation and noise suppression smear the pitch of a held note
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      mic = 'off';
      error = micError(e);
      return;
    }
    if (mic !== 'starting') return stream.getTracks().forEach((t) => t.stop());
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      stopMic();
      error = 'The microphone was disconnected. Press Start to pick it up again.';
    });
    try {
      source = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      // about 85 ms of sound: two full cycles of a bass's low E
      analyser.fftSize = ac.sampleRate > 50_000 ? 8192 : 4096;
      source.connect(analyser);
    } catch (e) {
      // e.g. Firefox refuses a mic whose sample rate differs from the audio output's; don't leave the mic on
      stopMic();
      error = micError(e);
      return;
    }
    mic = 'on';
    loop();
  }

  function stopMic() {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    stream = source = analyser = null;
    mic = 'off';
    freq = null;
    level = 0;
    history = [];
    smoother.reset();
  }

  function loop() {
    const buf = new Float32Array(analyser!.fftSize);
    let last = 0;
    const tick = (now: number) => {
      if (!analyser || !ctx) return;
      if (now - last >= ANALYSE_MS) {
        last = now;
        analyser.getFloatTimeDomainData(buf);
        const r = rms(buf);
        level = r > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(r) + 60) / 60)) : 0;
        // while a reference tone plays the mic hears it, which would make every string look tuned
        const p = playing ? null : detectPitch(buf, { sampleRate: ctx.sampleRate, minFreq: inst.minFreq, maxFreq: inst.maxFreq });
        freq = smoother.push(p?.freq ?? null);
        record(p !== null);
      }
      if (off !== null) {
        const aim = Math.max(-50, Math.min(50, off));
        needle = reduced ? aim : needle + (aim - needle) * 0.3;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  /** `heard` is false when the display is only holding the last reading through a gap */
  function record(heard: boolean) {
    history = [...history.slice(1 - HISTORY), off === null ? null : Math.max(-50, Math.min(50, off))];
    streak = inTune && target ? streak + (heard ? 1 : 0) : 0;
    if (streak >= HOLD && target && target.index >= 0 && !tuned.includes(target.index)) tuned = [...tuned, target.index];
  }

  function stopTone() {
    if (!tone) return;
    clearTimeout(tone.timer);
    const { osc, out } = tone;
    osc.onended = () => out.disconnect();
    if (ctx) {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      osc.stop(ctx.currentTime + 0.15);
    }
    tone = null;
    playing = null;
  }

  /** a plucked-string-like tone; its overtones carry the pitch even on small speakers that can't play a low E */
  function playTone(t: Target) {
    stopTone();
    const ac = audio();
    wave ??= ac.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.55, 0.32, 0.2, 0.12, 0.07, 0.04]));
    const osc = ac.createOscillator();
    const out = ac.createGain();
    const at = ac.currentTime + 0.01;
    osc.setPeriodicWave(wave);
    osc.frequency.value = t.freq;
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.22, at + 0.015);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
    osc.connect(out).connect(ac.destination);
    osc.start(at);
    tone = { osc, out, timer: window.setTimeout(stopTone, 2500) };
    playing = t;
    smoother.reset();
  }

  function pickString(t: Target) {
    locked = t.index;
    playTone(t);
  }

  function setInstrument(id: string) {
    instId = id;
    locked = null;
    tuned = [];
    stopTone();
    smoother.reset();
  }

  function setA4(v: number) {
    a4 = clampA4(v);
    tuned = [];
  }

  // the gauge: ±50 cents spread over ±60°
  const CX = 120;
  const CY = 128;
  const R = 104;
  const polar = (c: number, r: number) => {
    const a = ((c * 1.2 - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const ticks = Array.from({ length: 21 }, (_, i) => i * 5 - 50);
  const band = (() => {
    const a = polar(-IN_TUNE, R + 6);
    const b = polar(IN_TUNE, R + 6);
    const c = polar(IN_TUNE, R - 14);
    const d = polar(-IN_TUNE, R - 14);
    return `M${a.x} ${a.y}A${R + 6} ${R + 6} 0 0 1 ${b.x} ${b.y}L${c.x} ${c.y}A${R - 14} ${R - 14} 0 0 0 ${d.x} ${d.y}Z`;
  })();
  const tip = $derived(polar(needle, R - 4));

  const trace = $derived.by(() => {
    let d = '';
    let pen = false;
    history.forEach((c, i) => {
      if (c === null) return (pen = false);
      d += `${pen ? 'L' : 'M'}${((i + HISTORY - history.length) / (HISTORY - 1)) * 300} ${20 - c * 0.36}`;
      pen = true;
    });
    return d;
  });
</script>

<div class="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
  <section class="stage grid content-center justify-items-center gap-4 rounded-2xl border border-line-2 px-4 py-7 sm:px-8" aria-label="Tuner">
    <div class="gauge" class:live={off !== null} class:good={inTune}>
      <svg viewBox="0 0 240 140" aria-hidden="true">
        <path class="band" d={band} />
        {#each ticks as c}
          {@const a = polar(c, R)}
          {@const b = polar(c, R - (c % 25 === 0 ? 12 : c % 10 === 0 ? 8 : 5))}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class:major={c % 25 === 0} />
        {/each}
        {#each [-50, -25, 0, 25, 50] as c}
          {@const p = polar(c, R + 14)}
          <text x={p.x} y={p.y + 3}>{c > 0 ? `+${c}` : c}</text>
        {/each}
        <line class="needle" x1={CX} y1={CY} x2={tip.x} y2={tip.y} />
        <circle class="hub" cx={CX} cy={CY} r="5" />
      </svg>
    </div>

    <div class="readout grid justify-items-center">
      {#if playing}
        <span class="note font-serif">{noteName(playing.midi).name}<sub>{noteName(playing.midi).octave}</sub></span>
        <span class="mono">playing reference · {playing.freq.toFixed(1)} Hz</span>
      {:else if note && freq && off !== null}
        <span class="note font-serif" class:good={inTune}>{note.name}<sub>{note.octave}</sub></span>
        <span class="mono">
          {freq.toFixed(1)} Hz · {off >= 0 ? '+' : '−'}{Math.abs(off).toFixed(off > -10 && off < 10 ? 1 : 0)}¢{#if target && target.index >= 0} from {label(target)}{/if}
        </span>
        <span class="verdict" class:good={inTune}>{verdict}</span>
      {:else}
        <span class="note font-serif dim">–</span>
        <span class="mono">{mic === 'on' ? (allTuned ? 'All strings tuned. Nice.' : 'Play a single string and let it ring') : 'Start the tuner to listen'}</span>
        <span class="verdict">&nbsp;</span>
      {/if}
    </div>

    <p class="sr-only" aria-live="polite">{note && verdict ? `${note.name}${note.octave}, ${verdict}` : ''}</p>

    <svg class="trace" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="300" y1="20" y2="20" />
      <path d={trace} />
    </svg>

    {#if mic === 'on'}
      <div class="flex w-full max-w-xs items-center gap-3">
        <span class="mono shrink-0">mic</span>
        <span class="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <span style:width="{level * 100}%"></span>
        </span>
        <button type="button" class="btn shrink-0 px-3! py-2!" onclick={stopMic}>Stop</button>
      </div>
    {:else}
      <button type="button" class="btn btn-primary" onclick={startMic} disabled={mic === 'starting'}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="9" rx="2.5" /><path d="M3 8a5 5 0 0 0 10 0M8 13v2" /></svg>
        {mic === 'starting' ? 'Waiting for permission…' : 'Start tuner'}
      </button>
      <p class="mono max-w-sm text-center">Your browser will ask to use the microphone. Sound is analyzed on your device and never recorded or sent anywhere.</p>
    {/if}
    {#if error}<p class="max-w-md text-center text-sm text-bad" role="alert">{error}</p>{/if}
  </section>

  <div class="grid content-start gap-5">
    <label>
      <span class="label">instrument</span>
      <select class="field" value={instId} onchange={(e) => setInstrument(e.currentTarget.value)}>
        {#each INSTRUMENTS as i}<option value={i.id}>{i.name}</option>{/each}
      </select>
    </label>

    {#if targets.length}
      <div>
        <span class="label">strings · click one to hear it</span>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="str" aria-pressed={locked === null} onclick={() => (locked = null)}>
            <span class="font-sans text-sm">Auto</span>
          </button>
          {#each targets as t}
            {@const n = noteName(t.midi)}
            {@const active = target?.index === t.index && !playing}
            <button
              type="button"
              class="str"
              class:active
              class:sounding={playing?.index === t.index}
              aria-pressed={locked === t.index}
              onclick={() => pickString(t)}
              aria-label={`String ${targets.length - t.index}, ${n.name}${n.octave}${tuned.includes(t.index) ? ', tuned' : ''}. Play reference tone`}
            >
              <span class="font-serif text-2xl leading-none">{n.name}<sub>{n.octave}</sub></span>
              <span class="tick" class:on={tuned.includes(t.index)} aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
              </span>
            </button>
          {/each}
        </div>
        <p class="mono mt-2">
          {locked === null ? 'Auto picks the string closest to what it hears.' : `Locked to ${label(targets[locked])}. Choose Auto to follow any string.`}
        </p>
      </div>
    {:else}
      <p class="text-sm text-soft">Chromatic mode shows the nearest note for any pitch, for any instrument or your voice.</p>
    {/if}

    <div>
      <span class="label">reference pitch · A4</span>
      <div class="flex items-center gap-2">
        <button type="button" class="btn px-3! py-2!" onclick={() => setA4(a4 - 1)} disabled={a4 <= A4_MIN} aria-label="Lower A4 by 1 Hz">−</button>
        <label class="flex items-center gap-1.5">
          <span class="sr-only">A4 frequency in hertz</span>
          <input
            class="field w-20 text-center"
            type="number"
            min={A4_MIN}
            max={A4_MAX}
            value={a4}
            onchange={(e) => {
              setA4(e.currentTarget.valueAsNumber);
              e.currentTarget.value = String(a4);
            }}
          />
          <span class="mono">Hz</span>
        </label>
        <button type="button" class="btn px-3! py-2!" onclick={() => setA4(a4 + 1)} disabled={a4 >= A4_MAX} aria-label="Raise A4 by 1 Hz">+</button>
        {#if a4 !== 440}<button type="button" class="mono ml-1 hover:text-chalk" onclick={() => setA4(440)}>reset to 440</button>{/if}
      </div>
    </div>

    <div class="mono grid gap-1.5 border-t border-line pt-5">
      <p>Tips: tune in a quiet room, pluck one string at a time and let it ring. If it reads an octave off, pluck a little softer or nearer the neck.</p>
      <p>If you overshoot, drop below the note and tune up to it again; strings hold their pitch better that way.</p>
    </div>
  </div>
</div>

<style>
  .stage {
    background: radial-gradient(circle at 50% 30%, var(--color-panel-2), transparent 70%);
  }
  .gauge {
    width: min(100%, 420px);
    & svg {
      display: block;
      width: 100%;
      overflow: visible;
    }
    & line {
      stroke: var(--color-line-2);
      stroke-width: 1.2;
      stroke-linecap: round;
    }
    & line.major {
      stroke: var(--color-muted);
      stroke-width: 1.6;
    }
    & text {
      font: 9px var(--font-mono);
      fill: var(--color-muted);
      text-anchor: middle;
    }
    & .band {
      fill: color-mix(in srgb, var(--color-ok) 18%, transparent);
      transition: fill 0.25s;
    }
    & .needle {
      stroke: var(--color-muted);
      stroke-width: 2.5;
      transition: stroke 0.2s;
    }
    & .hub {
      fill: var(--color-panel-2);
      stroke: var(--color-line-2);
    }
    &.live .needle {
      stroke: var(--color-sun);
    }
    &.good .needle {
      stroke: var(--color-ok);
    }
    &.good .band {
      fill: color-mix(in srgb, var(--color-ok) 45%, transparent);
    }
  }
  .readout {
    min-height: 150px;
  }
  .note {
    font-size: clamp(72px, 20vw, 104px);
    line-height: 1;
    transition: color 0.2s;
    & sub {
      font-size: 0.36em;
      color: var(--color-muted);
      vertical-align: baseline;
      margin-left: 2px;
    }
    &.good {
      color: var(--color-ok);
    }
    &.dim {
      color: var(--color-line-2);
    }
  }
  .verdict {
    margin-top: 6px;
    font-size: 15px;
    color: var(--color-soft);
    &.good {
      color: var(--color-ok);
    }
  }
  .trace {
    width: min(100%, 360px);
    height: 40px;
    & line {
      stroke: var(--color-line);
    }
    & path {
      fill: none;
      stroke: var(--color-sun);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
    }
  }
  .meter {
    flex: 1;
    height: 6px;
    border-radius: 99px;
    overflow: hidden;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    & span {
      display: block;
      height: 100%;
      background: var(--color-ok);
    }
  }
  .str {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 56px;
    height: 56px;
    padding: 0 10px;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    transition: border-color 0.2s, background 0.2s, transform 0.2s var(--ease-spring);
    & sub {
      font-size: 0.5em;
      color: var(--color-muted);
      vertical-align: baseline;
    }
    &:hover {
      border-color: var(--color-muted);
    }
    &:active {
      transform: scale(0.95);
    }
    &[aria-pressed='true'] {
      border-color: var(--color-chalk);
    }
    &.active {
      border-color: var(--color-sun);
      background: color-mix(in srgb, var(--color-sun) 10%, var(--color-panel-2));
    }
    &.sounding {
      border-color: var(--color-sun);
    }
  }
  .tick {
    position: absolute;
    top: -6px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-ok);
    color: var(--color-bg);
    opacity: 0;
    transform: scale(0.4);
    transition: opacity 0.2s, transform 0.35s var(--ease-spring);
    &.on {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
