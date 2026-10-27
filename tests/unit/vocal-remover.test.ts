import { CONSTANTS } from 'demucs-web';
import { describe, expect, it } from 'vitest';
import def from '@/tools/defs/vocal-remover';
import { MODELS, totalDownloadSize } from '@/engines/ai/models';
import {
  effectiveGains,
  exportName,
  isSilent,
  matchPreset,
  mixStems,
  presetMix,
  RATE,
  SEGMENT_STRIDE,
  segmentCount,
  STEM_IDS,
  zipName,
} from '@/tools/lib/vocal-remover/stems';

describe('vocal remover mixer', () => {
  it('mute wins, and solo silences everything else', () => {
    const mix = presetMix('all');
    expect(effectiveGains(mix)).toEqual({ vocals: 1, drums: 1, bass: 1, other: 1 });
    mix.drums.solo = true;
    mix.bass.solo = true;
    mix.bass.muted = true;
    mix.drums.volume = 0.5;
    expect(effectiveGains(mix)).toEqual({ vocals: 0, drums: 0.5, bass: 0, other: 0 });
    mix.drums.muted = true;
    expect(isSilent(effectiveGains(mix))).toBe(true);
  });

  it('presets are karaoke (no vocals) and acapella (vocals only), and are recognized', () => {
    expect(effectiveGains(presetMix('instrumental'))).toEqual({ vocals: 0, drums: 1, bass: 1, other: 1 });
    expect(effectiveGains(presetMix('acapella'))).toEqual({ vocals: 1, drums: 0, bass: 0, other: 0 });
    for (const id of ['all', 'instrumental', 'acapella'] as const) expect(matchPreset(presetMix(id))).toBe(id);
    const custom = presetMix('all');
    custom.other.volume = 0.8;
    expect(matchPreset(custom)).toBeNull();
  });

  it('mixes stereo stems with gains and copes with a mono stem', () => {
    const stereo = (l: number, r: number) => [new Float32Array([l, l]), new Float32Array([r, r])];
    const out = mixStems({ vocals: stereo(1, 1), drums: stereo(0.25, 0.5), bass: [new Float32Array([0.1, 0.1])], other: stereo(9, 9) }, { vocals: 0, drums: 1, bass: 2, other: 0 });
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBeCloseTo(0.45);
    expect(out[1][1]).toBeCloseTo(0.7);
  });

  it('names exports after the song', () => {
    expect(exportName('My Song.flac', 'instrumental', 'mp3')).toBe('My Song (instrumental).mp3');
    expect(exportName('track', 'mix', 'wav')).toBe('track (custom mix).wav');
    expect(zipName('a.b.mp3')).toBe('a.b stems.zip');
  });
});

describe('demucs-web segments', () => {
  it('match the library constants and its loop', () => {
    expect(RATE).toBe(CONSTANTS.SAMPLE_RATE);
    expect(STEM_IDS.slice().sort()).toEqual([...CONSTANTS.TRACKS].sort());
    expect(SEGMENT_STRIDE).toBe(Math.floor(CONSTANTS.TRAINING_SAMPLES * (1 - CONSTANTS.SEGMENT_OVERLAP)));
    // demucs-web: for (start = 0; start < total; start += stride)
    for (const frames of [1, SEGMENT_STRIDE, SEGMENT_STRIDE + 1, 240 * RATE]) {
      let n = 0;
      for (let start = 0; start < frames; start += SEGMENT_STRIDE) n++;
      expect(segmentCount(frames)).toBe(n);
    }
  });
});

describe('vocal-remover page', () => {
  it('fits search limits and credits the model', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.related.length).toBeGreaterThanOrEqual(2);
    expect(def.faq.at(-1)?.q).toMatch(/uploaded/);
    expect(def.faq.some((f) => f.a.includes('Demucs') && f.a.includes(MODELS.demucs.license.name))).toBe(true);
    const mb = `${Math.round(totalDownloadSize('demucs', 'fp32') / 1e6)} MB`;
    expect(def.steps[0]).toContain(mb);
  });
});
