import { RecordingClock } from './clock';
import { pickMimeType, videoBitrate } from './format';

export interface Recorded {
  blob: Blob;
  durationSec: number;
}

/**
 * A MediaRecorder run with pause-aware timing. Data is pulled every second, so a long
 * recording grows as a list of Blobs the browser can keep on disk rather than one buffer.
 */
export class Recording {
  readonly clock = new RecordingClock();
  readonly mimeType: string;
  bytes = 0;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private done: Promise<Recorded>;

  constructor(stream: MediaStream, o: { width: number; height: number; fps: number; onfail?: () => void; ondata?: (bytes: number) => void }) {
    const hasAudio = stream.getAudioTracks().length > 0;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t), hasAudio);
    this.recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: videoBitrate(o.width, o.height, o.fps),
      ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
    });
    this.mimeType = mimeType;
    this.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.chunks.push(e.data);
      this.bytes += e.data.size;
      o.ondata?.(this.bytes);
    };
    // the recorder stops itself on errors (e.g. a track it can't encode); keep what was captured
    this.recorder.onerror = () => o.onfail?.();
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.clock.stop();
        const type = this.recorder.mimeType || this.mimeType || this.chunks[0]?.type || 'video/webm';
        resolve({ blob: new Blob(this.chunks, { type }), durationSec: this.clock.elapsedMs / 1000 });
      };
    });
  }

  start() {
    this.recorder.start(1000);
    this.clock.start();
  }

  get paused() {
    return this.recorder.state === 'paused';
  }

  pause() {
    if (this.recorder.state !== 'recording') return;
    this.recorder.pause();
    this.clock.pause();
  }

  resume() {
    if (this.recorder.state !== 'paused') return;
    this.recorder.resume();
    this.clock.resume();
  }

  /** resolves with the finished file; safe to call more than once */
  stop(): Promise<Recorded> {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    return this.done;
  }
}

/** stops every track of the given streams (turns camera lights off) */
export function stopStreams(...streams: (MediaStream | null | undefined)[]) {
  for (const s of streams) s?.getTracks().forEach((t) => t.stop());
}
