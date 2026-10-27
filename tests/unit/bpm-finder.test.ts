import { describe, expect, it } from 'vitest';
import { SongAnalyzer, type Analysis } from '@/tools/lib/music-analysis/analyzer';
import { Decimator, Fft, hann } from '@/tools/lib/music-analysis/fft';
import { formatBpm, needsDecoder, toCsv } from '@/tools/lib/music-analysis/format';
import type { MediaInfo } from '@/engines/media/types';
import { camelot, detectKey, keyName, keyShort, relativeKey, type KeyId } from '@/tools/lib/music-analysis/key';
import { addTap, tapRelation, tapTempo } from '@/tools/lib/music-analysis/tap';

const RATE = 44100;

/** feeds `x` through a fresh analyzer in uneven chunks, like the decoder does */
function analyze(x: Float32Array, rate = RATE): Analysis {
  const a = new SongAnalyzer(rate, x.length / rate);
  for (let i = 0, step = 37_111; i < x.length; i += step) a.push(x.subarray(i, i + step));
  return a.finish();
}

/** deterministic noise so tests never flake */
function noise(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** short decaying noise bursts ("clicks") at the given times */
function clicks(times: number[], seconds: number, rate = RATE, { amp = 0.8, ms = 15 } = {}) {
  const x = new Float32Array(Math.round(seconds * rate));
  const rnd = noise(7);
  const len = Math.round((ms / 1000) * rate);
  for (const t of times) {
    const at = Math.round(t * rate);
    for (let i = 0; i < len && at + i < x.length; i++) x[at + i] += amp * rnd() * Math.exp(-i / (len / 4));
  }
  return x;
}

const grid = (bpm: number, seconds: number, offset = 0) => Array.from({ length: Math.floor(((seconds - offset) * bpm) / 60) }, (_, i) => offset + (i * 60) / bpm);

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** chords as MIDI note lists, each `sec` long, notes with a few decaying harmonics */
function chords(seq: number[][], sec: number, rate = RATE, detuneCents = 0) {
  const per = Math.round(sec * rate);
  const x = new Float32Array(per * seq.length);
  seq.forEach((notes, c) => {
    for (const m of notes) {
      const f = midiHz(m) * 2 ** (detuneCents / 1200);
      for (let h = 1; h <= 4; h++) {
        const w = (2 * Math.PI * f * h) / rate;
        for (let i = 0; i < per; i++) x[c * per + i] += (0.08 / h) * Math.sin(w * i) * Math.min(1, i / 400);
      }
    }
  });
  return x;
}

const C = (k: KeyId) => keyName(k);

describe('fft', () => {
  it('puts a bin-centred sine in its bin', () => {
    const fft = new Fft(256);
    const frame = Float32Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * 16 * i) / 256));
    const out = new Float32Array(129);
    fft.magnitudes(frame, hann(256), out);
    const peak = out.indexOf(Math.max(...out));
    expect(peak).toBe(16);
    expect(out[16]).toBeCloseTo(64, 0); // amplitude × N/4 for a Hann window
  });
});

describe('decimator', () => {
  const tone = (hz: number) => Float32Array.from({ length: RATE }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE));
  const rms = (x: Float32Array) => Math.sqrt(x.slice(200, -200).reduce((s, v) => s + v * v, 0) / (x.length - 400));

  it('downsamples 44.1 kHz by 4 and keeps low tones', () => {
    const d = new Decimator(RATE);
    expect(d.factor).toBe(4);
    expect(d.rate).toBe(11025);
    const out = d.push(tone(440));
    expect(out.length).toBeGreaterThan(11000);
    expect(rms(out)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('removes what would alias', () => {
    expect(rms(new Decimator(RATE).push(tone(9000)))).toBeLessThan(0.02);
  });

  it('streams without a seam', () => {
    const x = tone(300);
    const whole = new Decimator(RATE).push(x);
    const d = new Decimator(RATE);
    const parts = [d.push(x.subarray(0, 10_001)), d.push(x.subarray(10_001))];
    const joined = Float32Array.from([...parts[0], ...parts[1]]);
    expect(joined.length).toBe(whole.length);
    expect(Math.max(...joined.map((v, i) => Math.abs(v - whole[i])))).toBeLessThan(1e-6);
  });

  it('passes low rates straight through', () => {
    expect(new Decimator(16000).factor).toBe(1);
    expect(new Decimator(48000).rate).toBe(12000);
  });
});

describe('tempo', () => {
  it('finds 120 BPM in a click track, with beats on the clicks', () => {
    const times = grid(120, 30, 0.25);
    const { tempo } = analyze(clicks(times, 30));
    expect(tempo).not.toBeNull();
    expect(Math.abs(tempo!.bpm - 120)).toBeLessThanOrEqual(1);
    expect(tempo!.confidence).toBeGreaterThan(0.6);
    expect(tempo!.beats.length).toBeGreaterThan(50);
    // every tracked beat sits within 20 ms of a click
    for (const b of tempo!.beats) expect(Math.min(...times.map((t) => Math.abs(t - b)))).toBeLessThan(0.02);
  });

  it.each([90, 128, 140, 174])('finds %i BPM in a kick/snare/hi-hat groove', (bpm) => {
    const beat = 60 / bpm;
    const kicks = grid(bpm / 2, 40);
    const snares = kicks.map((t) => t + beat);
    const hats = grid(bpm * 2, 40);
    const x = clicks(kicks, 40, RATE, { amp: 0.9, ms: 40 });
    const s = clicks(snares, 40, RATE, { amp: 0.6, ms: 25 });
    const h = clicks(hats, 40, RATE, { amp: 0.15, ms: 6 });
    for (let i = 0; i < x.length; i++) x[i] += s[i] + h[i];
    const { tempo } = analyze(x);
    expect(Math.abs(tempo!.bpm - bpm)).toBeLessThanOrEqual(1);
  });

  it.each([60, 75, 160, 180])('finds a bare %i BPM metronome', (bpm) => {
    const { tempo } = analyze(clicks(grid(bpm, 30), 30));
    expect(Math.abs(tempo!.bpm - bpm)).toBeLessThanOrEqual(1);
  });

  it('works at 48 kHz too', () => {
    const { tempo } = analyze(clicks(grid(100, 30), 30, 48000), 48000);
    expect(Math.abs(tempo!.bpm - 100)).toBeLessThanOrEqual(1);
  });

  it('has low confidence (or no answer) for noise and none for silence', () => {
    const rnd = noise(3);
    const x = Float32Array.from({ length: RATE * 20 }, () => 0.3 * rnd());
    const { tempo } = analyze(x);
    expect(tempo === null || tempo.confidence < 0.3).toBe(true);
    expect(analyze(new Float32Array(RATE * 10)).tempo).toBeNull();
  });
});

describe('key', () => {
  // C4 = 60
  const I = [48, 60, 64, 67];
  const IV = [53, 60, 65, 69];
  const V = [43, 59, 62, 67];
  const vi = [45, 60, 64, 69];
  const ii = [50, 62, 65, 69];

  it('hears C major in I–IV–V–I', () => {
    const { key } = analyze(chords([I, IV, V, I, vi, ii, V, I], 1.5));
    expect(C(key!)).toBe('C major');
    expect(camelot(key!)).toBe('8B');
  });

  it('hears A minor in i–iv–V–i', () => {
    const i = [45, 57, 60, 64];
    const iv = [50, 57, 62, 65];
    const v = [40, 56, 59, 64]; // E major, with the raised G♯
    const { key } = analyze(chords([i, iv, v, i, iv, i, v, i], 1.5));
    expect(C(key!)).toBe('A minor');
    expect(camelot(key!)).toBe('8A');
  });

  it('copes with a recording tuned 30 cents sharp', () => {
    const { key } = analyze(chords([I, IV, V, I, ii, V, I], 1.5, RATE, 30));
    expect(C(key!)).toBe('C major');
    expect(key!.tuningCents).toBeGreaterThan(20);
    expect(key!.tuningCents).toBeLessThan(40);
  });

  it('transposes: the same progression in E♭ major', () => {
    const up = (c: number[]) => c.map((m) => m + 3);
    const { key } = analyze(chords([I, IV, V, I, vi, ii, V, I].map(up), 1.5));
    expect(C(key!)).toBe('E♭ major');
    expect(camelot(key!)).toBe('5B');
  });

  it('returns null for silence', () => {
    expect(detectKey(new Float64Array(12))).toBeNull();
  });
});

describe('key names', () => {
  it('maps the Camelot wheel', () => {
    expect(camelot({ tonic: 7, mode: 'major' })).toBe('9B');
    expect(camelot({ tonic: 11, mode: 'major' })).toBe('1B');
    expect(camelot({ tonic: 5, mode: 'major' })).toBe('7B');
    expect(camelot({ tonic: 4, mode: 'minor' })).toBe('9A');
    expect(camelot({ tonic: 0, mode: 'minor' })).toBe('5A');
    expect(camelot({ tonic: 8, mode: 'minor' })).toBe('1A');
  });

  it('names relatives and short forms', () => {
    expect(keyName(relativeKey({ tonic: 0, mode: 'major' }))).toBe('A minor');
    expect(keyName(relativeKey({ tonic: 6, mode: 'minor' }))).toBe('A major');
    expect(keyShort({ tonic: 1, mode: 'minor' })).toBe('C♯m');
    expect(keyName({ tonic: 10, mode: 'major' }, true)).toBe('Bb major');
  });
});

describe('tap tempo', () => {
  const taps = (gaps: number[], start = 1000) => gaps.reduce<number[]>((list, g) => addTap(list, list[list.length - 1] + g), [start]);

  it('averages steady taps', () => {
    const t = tapTempo(taps([500, 498, 503, 501, 499]));
    expect(t!.bpm).toBeCloseTo(120, 0);
  });

  it('ignores a stray double tap', () => {
    const t = tapTempo(taps([500, 500, 120, 380, 500, 500, 500]));
    expect(t!.bpm).toBeCloseTo(120, 0);
    expect(t!.used).toBe(6);
  });

  it('needs three taps and restarts after a pause', () => {
    expect(tapTempo(taps([500]))).toBeNull();
    const list = addTap(taps([500, 500, 500]), 1000 + 1500 + 2500);
    expect(list.length).toBe(1);
  });

  it('relates taps to the detected tempo', () => {
    expect(tapRelation(121, 120)).toBe('same');
    expect(tapRelation(64, 128)).toBe('half');
    expect(tapRelation(170, 85)).toBe('double');
    expect(tapRelation(100, 128)).toBeNull();
  });
});

describe('csv', () => {
  it('quotes names and writes ASCII keys', () => {
    const analysis: Analysis = {
      durationSec: 61.25,
      tempo: { bpm: 128.04, confidence: 0.9, beats: new Float64Array() },
      key: { tonic: 6, mode: 'minor', score: 0.8, confidence: 0.7, runnersUp: [], tuningCents: 0 },
      peaks: { min: new Float32Array(), max: new Float32Array(), rms: new Float32Array() },
    };
    const csv = toCsv([{ name: 'Song, "live".mp3', analysis }]);
    expect(csv.split('\r\n')[1]).toBe('"Song, ""live"".mp3",61.3,128,high,64,256,F# minor,11A,high');
  });

  it('formats BPM', () => {
    expect(formatBpm(120.02)).toBe('120');
    expect(formatBpm(128.46)).toBe('128.5');
  });
});

describe('needsDecoder', () => {
  const base: MediaInfo = { container: 'mp4', durationSec: 10, sizeBytes: 1, readable: true, needsFallback: false, via: 'mediabunny' };
  const audio = (canDecode: boolean) => ({ codec: 'aac' as const, sampleRate: 44100, channels: 2, bitrate: null, canDecode });

  it('asks for the extra decoder only when the audio needs it', () => {
    expect(needsDecoder({ ...base, audio: audio(true) })).toBe(false);
    expect(needsDecoder({ ...base, readable: false, needsFallback: true })).toBe(true);
    expect(needsDecoder({ ...base, needsFallback: true, audio: audio(false) })).toBe(true);
    // a video codec the browser can't play doesn't matter: only the sound is analyzed
    const video = { codec: 'hevc' as const, width: 1, height: 1, displayWidth: 1, displayHeight: 1, rotation: 0 as const, fps: null, bitrate: null, canDecode: false };
    expect(needsDecoder({ ...base, needsFallback: true, video, audio: audio(true) })).toBe(false);
  });
});
