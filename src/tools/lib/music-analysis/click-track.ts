/** Metronome clicks on the detected beats, kept in step with an <audio> element while it plays. */

const LOOKAHEAD = 0.12;

export class ClickTrack {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private next = 0;

  constructor(
    private readonly media: HTMLMediaElement,
    private readonly beats: Float64Array,
  ) {}

  /** call from a user gesture: browsers only allow audio to start from one */
  start() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.resync();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** after a seek, start scheduling from the new position */
  resync() {
    const t = this.media.currentTime;
    let i = 0;
    while (i < this.beats.length && this.beats[i] < t) i++;
    this.next = i;
  }

  destroy() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private tick() {
    const { media, beats, ctx } = this;
    if (!ctx || media.paused) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = media.currentTime;
    const rate = media.playbackRate || 1;
    // jumped back since the last tick
    if (this.next > 0 && beats[this.next - 1] > t + LOOKAHEAD + 0.05) this.resync();
    // skip beats that slipped by (a stall, a jump forward)
    while (this.next < beats.length && beats[this.next] < t - 0.02) this.next++;
    while (this.next < beats.length && beats[this.next] < t + LOOKAHEAD) {
      this.blip(ctx.currentTime + Math.max(0, (beats[this.next] - t) / rate));
      this.next++;
    }
  }

  private blip(when: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1760;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  }
}
