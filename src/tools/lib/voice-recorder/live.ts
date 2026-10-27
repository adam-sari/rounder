/*
 * Live recording maths: a pause-aware clock, meter levels and the scrolling waveform's history.
 */

/** Recording time that leaves out paused stretches. `now` is injectable for tests. */
export class RecordingClock {
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private stoppedAt: number | null = null;

  constructor(private now: () => number = () => performance.now()) {}

  start() {
    this.startedAt = this.now();
    this.pausedAt = this.stoppedAt = null;
    this.pausedTotal = 0;
  }

  pause() {
    if (this.pausedAt === null && this.stoppedAt === null) this.pausedAt = this.now();
  }

  resume() {
    if (this.pausedAt === null || this.stoppedAt !== null) return;
    this.pausedTotal += this.now() - this.pausedAt;
    this.pausedAt = null;
  }

  stop() {
    this.stoppedAt ??= this.pausedAt ?? this.now();
  }

  get elapsedMs() {
    const end = this.stoppedAt ?? this.pausedAt ?? this.now();
    return Math.max(0, end - this.startedAt - this.pausedTotal);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 7300 → "0:07.3", 3723400 → "1:02:03.4" */
export function formatTimer(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = `${pad(s % 60)}.${tenths % 10}`;
  return h ? `${h}:${pad(m)}:${rest}` : `${m}:${rest}`;
}

/** RMS and peak (both 0–1) of a block of samples */
export function signalLevel(samples: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const s of samples) {
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return { rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak };
}

export const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));

/** a dB value as a 0–1 position on a meter that starts at `floor` dB */
export const meterPosition = (db: number, floor = -60) => Math.min(1, Math.max(0, (db - floor) / -floor));

/** fast attack, slow release, so the meter jumps up with speech and settles gently */
export function smoothLevel(prev: number, next: number, dtMs: number, releaseMs = 300): number {
  if (next >= prev) return next;
  return next + (prev - next) * Math.exp(-dtMs / releaseMs);
}

/** fixed-size history of waveform columns; the newest value is last */
export class Trail {
  private buf: Float32Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  get length() {
    return this.count;
  }

  push(v: number) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** the last `n` values (fewer if the trail is shorter), oldest first */
  last(n: number): Float32Array {
    const k = Math.min(n, this.count);
    const out = new Float32Array(k);
    for (let i = 0; i < k; i++) out[i] = this.buf[(this.head - k + i + this.capacity) % this.capacity];
    return out;
  }

  clear() {
    this.head = this.count = 0;
  }
}
