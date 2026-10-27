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

  get paused() {
    return this.pausedAt !== null && this.stoppedAt === null;
  }

  get elapsedMs() {
    const end = this.stoppedAt ?? this.pausedAt ?? this.now();
    return Math.max(0, end - this.startedAt - this.pausedTotal);
  }
}

/** seconds left for a job, once enough of it has run to guess (null before that) */
export function etaSeconds(elapsedMs: number, progress: number): number | null {
  if (progress < 0.03 || elapsedMs < 1500 || progress >= 1) return null;
  return (elapsedMs * (1 - progress)) / progress / 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "screen-recording" + date → "screen-recording-2026-10-26-153005" */
export function recordingName(prefix: string, d = new Date()) {
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
