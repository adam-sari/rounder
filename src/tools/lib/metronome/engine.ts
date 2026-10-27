/**
 * The metronome's audio side, using the "lookahead scheduler" pattern: a timer wakes up every
 * 25 ms and books every click due in the next 120 ms on the AudioContext clock, so each click is
 * sample-accurate however busy the page is. Browser-only: create it from a click handler.
 */
import { TickPlanner, type Pattern, type Pos, type Sound, type Tick } from './rhythm';

export type Voice = 'click' | 'wood' | 'beep';

const LOOKAHEAD = 0.12;
const WAKE_MS = 25;

const LOUD: Record<Sound, number> = { accent: 1, medium: 0.78, beat: 0.62, sub: 0.36 };
const PITCH: Record<Voice, Record<Sound, number>> = {
  click: { accent: 5200, medium: 4300, beat: 3500, sub: 2700 },
  wood: { accent: 1250, medium: 1060, beat: 900, sub: 760 },
  beep: { accent: 1760, medium: 1320, beat: 880, sub: 660 },
};

export interface MetronomeOptions {
  pattern: (pos: Pos) => Pattern;
  voice: () => Voice;
  /** 0–1 */
  volume: () => number;
}

export function createMetronome(opts: MetronomeOptions) {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let bus: GainNode | null = null;
  let planner: TickPlanner | null = null;
  let worker: Worker | null = null;
  let noWorker = false;
  let fallback = 0;
  const queue: Tick[] = [];

  function audio() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  /** an enveloped sine: quick attack, exponential decay */
  function ping(ac: AudioContext, dest: AudioNode, freq: number, level: number, at: number, decay: number) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(at + decay + 0.01);
  }

  function burst(ac: AudioContext, dest: AudioNode, freq: number, q: number, level: number, at: number, decay: number) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ac.createGain();
    env.gain.setValueAtTime(level, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(band).connect(env).connect(dest);
    src.start(at);
    src.stop(at + decay + 0.01);
  }

  function play(dest: AudioNode, voice: Voice, sound: Sound, at: number) {
    const ac = ctx!;
    const v = opts.volume();
    // squared so the slider feels even to the ear
    const level = LOUD[sound] * v * v;
    const f = PITCH[voice][sound];
    if (level <= 0) return;
    if (voice === 'beep') ping(ac, dest, f, level * 0.45, at, 0.07);
    else if (voice === 'wood') {
      // a wood block rings at a couple of inharmonic modes, with a dry knock on top
      ping(ac, dest, f, level * 0.7, at, 0.06);
      ping(ac, dest, f * 2.74, level * 0.18, at, 0.025);
      burst(ac, dest, f * 2, 2, level * 0.5, at, 0.012);
    } else burst(ac, dest, f, 1.1, level * 1.6, at, 0.022);
  }

  function pump() {
    if (!ctx || !planner || !bus) return;
    const voice = opts.voice();
    for (const t of planner.plan(ctx.currentTime + LOOKAHEAD, opts.pattern)) {
      if (t.sound) play(bus, voice, t.sound, t.time);
      queue.push(t);
    }
    // nothing drains the queue while the tab is hidden (no animation frames), so keep it short
    if (queue.length > 256) queue.splice(0, queue.length - 256);
  }

  /** starts or stops the wake-ups; falls back to a page timer (fine while the tab is visible) without workers */
  function wake(on: boolean) {
    worker?.postMessage(0);
    clearInterval(fallback);
    if (!on) return;
    const usePage = () => (fallback = window.setInterval(pump, WAKE_MS));
    if (noWorker) return usePage();
    try {
      worker ??= new Worker(new URL('./tick-worker.ts', import.meta.url), { type: 'module', name: 'metronome-clock' });
      worker.onmessage = pump;
      worker.onerror = () => {
        noWorker = true;
        worker?.terminate();
        worker = null;
        if (planner) usePage();
      };
      worker.postMessage(WAKE_MS);
    } catch {
      noWorker = true;
      usePage();
    }
  }

  function stop() {
    if (!planner || !ctx || !bus) return;
    planner = null;
    wake(false);
    queue.length = 0;
    // clicks already booked would still sound, so fade their bus out
    const old = bus;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.004);
    setTimeout(() => old.disconnect(), 200);
    bus = null;
  }

  return {
    get running() {
      return planner !== null;
    },
    start() {
      stop();
      const ac = audio();
      bus = ac.createGain();
      bus.connect(ac.destination);
      planner = new TickPlanner(ac.currentTime + 0.06);
      pump();
      wake(true);
    },
    stop,
    /** the newest tick that has reached the speakers since the last call; poll on animation frames */
    heard(): Tick | null {
      if (!ctx) return null;
      // outputLatency matters with Bluetooth headphones, where sound arrives a good 100–200 ms late
      const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      let i = 0;
      while (i < queue.length && queue[i].time <= now) i++;
      return i ? queue.splice(0, i)[i - 1] : null;
    },
    /** one accented click, for trying out a sound */
    preview(voice: Voice) {
      const ac = audio();
      play(ac.destination, voice, 'accent', ac.currentTime + 0.02);
    },
    close() {
      stop();
      worker?.terminate();
      worker = null;
      void ctx?.close();
      ctx = null;
    },
  };
}

export type Metronome = ReturnType<typeof createMetronome>;
