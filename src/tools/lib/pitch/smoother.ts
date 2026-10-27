/**
 * Steadies a stream of raw pitch readings for display. Works in semitones, so a jump means the
 * same at every pitch: a median of the last few readings throws out one-off octave slips, then a
 * light exponential average calms the needle. A new note snaps straight in instead of gliding.
 */
export class PitchSmoother {
  private recent: number[] = [];
  private value: number | null = null;
  private misses = 0;

  constructor(
    private size = 5,
    /** share of the gap closed per reading */
    private alpha = 0.35,
    /** readings with no pitch before the display clears */
    private hold = 12,
  ) {}

  /** feed one reading (a frequency, or null when nothing was heard); returns the frequency to show */
  push(freq: number | null): number | null {
    if (freq === null || !(freq > 0)) {
      if (++this.misses > this.hold) this.reset();
      return this.out();
    }
    this.misses = 0;
    this.recent.push(12 * Math.log2(freq / 440));
    if (this.recent.length > this.size) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const v = this.value;
    this.value = v === null || Math.abs(median - v) > 0.5 ? median : v + (median - v) * this.alpha;
    return this.out();
  }

  reset() {
    this.recent = [];
    this.value = null;
    this.misses = 0;
  }

  private out() {
    return this.value === null ? null : 440 * 2 ** (this.value / 12);
  }
}
