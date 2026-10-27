import type { Pcm } from '@/engines/media/types';
import { RATE, STEM_IDS, type StemId } from './stems';

/*
 * Browser-only audio helpers for the vocal remover. Nothing here runs at import time, so islands
 * can import it during server rendering.
 */

/**
 * Any decoded audio → 44.1 kHz stereo for Demucs. The browser's own resampler (OfflineAudioContext)
 * is band-limited, unlike a linear one, and it also folds mono up and surround down to stereo.
 */
export async function toDemucsInput(pcm: Pcm): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  const frames = pcm.channels[0]?.length ?? 0;
  if (pcm.sampleRate === RATE && pcm.channels.length === 2) return [new Float32Array(pcm.channels[0]), new Float32Array(pcm.channels[1])];
  const src = new AudioBuffer({ numberOfChannels: pcm.channels.length, length: Math.max(1, frames), sampleRate: pcm.sampleRate });
  pcm.channels.forEach((ch, c) => src.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((frames * RATE) / pcm.sampleRate)), RATE);
  const node = new AudioBufferSourceNode(ctx, { buffer: src });
  node.connect(ctx.destination);
  node.start();
  const out = await ctx.startRendering();
  // copies: the worker takes these by transfer, and an AudioBuffer's own memory can't be detached
  return [new Float32Array(out.getChannelData(0)), new Float32Array(out.getChannelData(1))];
}

/** stereo stem → AudioBuffer, made without an AudioContext so it can exist before any click */
export function stemBuffer(channels: Float32Array<ArrayBuffer>[]): AudioBuffer {
  const buf = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, channels[0].length), sampleRate: RATE });
  channels.forEach((ch, c) => buf.copyToChannel(ch, c));
  return buf;
}

const RAMP = 0.012;

/**
 * Plays the four stems in lockstep, each through its own gain, so mute/solo/volume change
 * instantly and stay sample-aligned. The AudioContext opens on the first play (needs a gesture).
 */
export class StemPlayer {
  private ctx: AudioContext | null = null;
  private gains = {} as Record<StemId, GainNode>;
  private sources: AudioBufferSourceNode[] = [];
  private levels: Record<StemId, number>;
  /** ctx time that corresponds to position 0 */
  private origin = 0;
  private pausedAt = 0;
  playing = false;
  /** called when playback reaches the end on its own */
  onended = () => {};

  constructor(
    private readonly buffers: Record<StemId, AudioBuffer>,
    levels: Record<StemId, number>,
  ) {
    this.levels = { ...levels };
  }

  get duration() {
    return this.buffers.vocals.duration;
  }

  /** seconds into the song */
  position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt;
    return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.origin));
  }

  private context() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'playback' }));
      for (const id of STEM_IDS) {
        const g = (this.gains[id] = ctx.createGain());
        g.gain.value = this.levels[id];
        g.connect(ctx.destination);
      }
    }
    return this.ctx;
  }

  setLevels(levels: Record<StemId, number>) {
    this.levels = { ...levels };
    if (!this.ctx) return;
    for (const id of STEM_IDS) this.gains[id].gain.setTargetAtTime(levels[id], this.ctx.currentTime, RAMP);
  }

  play(from = this.pausedAt >= this.duration ? 0 : this.pausedAt) {
    const ctx = this.context();
    void ctx.resume();
    this.stopSources();
    // a short lead so every source starts on the same sample
    const at = ctx.currentTime + 0.03;
    this.origin = at - from;
    this.sources = STEM_IDS.map((id) => {
      const s = new AudioBufferSourceNode(ctx, { buffer: this.buffers[id] });
      s.connect(this.gains[id]);
      s.start(at, from);
      return s;
    });
    const first = this.sources[0];
    first.onended = () => {
      if (this.sources[0] !== first) return;
      this.stopSources();
      this.playing = false;
      this.pausedAt = 0;
      this.onended();
    };
    this.playing = true;
  }

  pause() {
    this.pausedAt = this.position();
    this.stopSources();
    this.playing = false;
  }

  seek(sec: number) {
    const t = Math.min(Math.max(0, sec), this.duration);
    if (this.playing) this.play(t);
    else this.pausedAt = t;
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // never started
      }
      s.disconnect();
    }
    this.sources = [];
  }

  destroy() {
    this.stopSources();
    this.playing = false;
    void this.ctx?.close();
    this.ctx = null;
  }
}
