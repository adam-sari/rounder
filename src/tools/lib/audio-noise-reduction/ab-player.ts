import type { Pcm } from '@/engines/media/types';

/*
 * Plays the original and the cleaned preview in lockstep, looping, and crossfades between
 * them, so switching is instant and lands on the same word. Created on first play (an
 * AudioContext needs a user gesture), never during server rendering.
 */

export type Side = 'original' | 'cleaned';

const FADE = 0.012;

export class ABPlayer {
  private ctx: AudioContext | null = null;
  private buffers: Record<Side, AudioBuffer | null> = { original: null, cleaned: null };
  private gains: Record<Side, GainNode> | null = null;
  private sources: AudioBufferSourceNode[] = [];
  /** ctx time that corresponds to position 0 of the loop */
  private origin = 0;
  private pausedAt = 0;
  side: Side = 'cleaned';
  playing = false;

  private context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const make = (on: boolean) => {
        const g = this.ctx!.createGain();
        g.gain.value = on ? 1 : 0;
        g.connect(this.ctx!.destination);
        return g;
      };
      this.gains = { original: make(this.side === 'original'), cleaned: make(this.side === 'cleaned') };
    }
    return this.ctx;
  }

  /** a context-free buffer, so loading a preview doesn't open the AudioContext before a click */
  private toBuffer(pcm: Pcm) {
    const n = pcm.channels[0]?.length ?? 0;
    const buf = new AudioBuffer({ numberOfChannels: Math.max(1, pcm.channels.length), length: Math.max(1, n), sampleRate: pcm.sampleRate });
    pcm.channels.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
    return buf;
  }

  get duration() {
    return this.buffers.original?.duration ?? 0;
  }

  /** seconds into the section */
  position(): number {
    const d = this.duration;
    if (!this.playing || !this.ctx || !d) return this.pausedAt;
    return Math.max(0, this.ctx.currentTime - this.origin) % d;
  }

  /** swaps in new audio; keeps playing from the same spot */
  set(side: Side, pcm: Pcm) {
    this.buffers[side] = this.toBuffer(pcm);
    if (this.playing) this.start(this.position());
  }

  clear() {
    this.stopSources();
    this.playing = false;
    this.pausedAt = 0;
    this.buffers = { original: null, cleaned: null };
  }

  play(from = this.pausedAt) {
    if (!this.buffers.original || !this.buffers.cleaned) return;
    void this.context().resume();
    this.start(from);
  }

  pause() {
    this.pausedAt = this.position();
    this.stopSources();
    this.playing = false;
  }

  seek(t: number) {
    if (this.playing) this.start(t);
    else this.pausedAt = t;
  }

  switchTo(side: Side) {
    this.side = side;
    if (!this.ctx || !this.gains) return;
    const t = this.ctx.currentTime;
    for (const s of ['original', 'cleaned'] as const) {
      const g = this.gains[s].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(s === side ? 1 : 0, t + FADE);
    }
  }

  private start(from: number) {
    this.stopSources();
    const ctx = this.context();
    const at = ctx.currentTime + 0.03;
    const offset = Math.max(0, Math.min(from, this.duration - 0.01));
    for (const side of ['original', 'cleaned'] as const) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers[side];
      src.loop = true;
      src.connect(this.gains![side]);
      src.start(at, offset);
      this.sources.push(src);
    }
    this.origin = at - offset;
    this.playing = true;
  }

  private stopSources() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // never started
      }
      s.disconnect();
    }
    this.sources = [];
  }

  dispose() {
    this.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
