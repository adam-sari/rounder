import { describe, expect, it } from 'vitest';
import { kbOf, parseHash, presetFromHash, PRESET_KEYS } from '@/tools/presets';
import { targetFromHash } from '@/tools/lib/exact-size/target';

describe('parseHash', () => {
  it('reads key=value pairs and the older bare size', () => {
    expect(parseHash('#target=150kb&from=heic')).toEqual({ target: '150kb', from: 'heic' });
    expect(parseHash('#150kb')).toEqual({ target: '150kb' });
    expect(parseHash('#%zz')).toEqual({});
    expect(parseHash('')).toEqual({});
  });

  it('agrees with the exact-size pages on a lone target', () => {
    expect(targetFromHash('#target=150kb')).toBe(150);
    expect(kbOf(parseHash('#target=150kb').target)).toBe(150);
    expect(kbOf('2mb')).toBe(2000);
  });
});

describe('presetFromHash', () => {
  it('maps the public vocabulary to each island\'s props', () => {
    expect(presetFromHash('CompressPdf', '#target=150kb')).toEqual({ targetKb: 150 });
    expect(presetFromHash('VideoCompressor', '#target=25mb')).toEqual({ targetMB: 25 });
    expect(presetFromHash('ImageResizer', '#range=20-50kb')).toEqual({ mode: 'target', rangeKb: [20, 50] });
    expect(presetFromHash('ImageResizer', '#min=50kb')).toEqual({ mode: 'increase', targetKb: 50 });
    expect(presetFromHash('ImageResizer', '#size=3.5x4.5cm')).toEqual({ mode: 'exact', w: 3.5, h: 4.5, unit: 'cm' });
    expect(presetFromHash('ImageConverter', '#from=png&to=jpg')).toEqual({ from: 'png', to: 'jpeg' });
    expect(presetFromHash('VideoToMp3', '#from=mov')).toEqual({ from: 'MOV' });
    expect(presetFromHash('UnitConverter', '#from=ml&to=l&value=500')).toEqual({ from: 'ml', to: 'l', value: 500 });
    expect(presetFromHash('TrimVideo', '#start=10')).toEqual({ start: 10 });
    expect(presetFromHash('SocialResizer', '#platform=instagram')).toEqual({ platform: 'instagram' });
    expect(presetFromHash('PercentageCalculator', '#p=15&of=80')).toEqual({ p: 15, of: 80 });
  });

  it('drops what an island does not take, and bad values', () => {
    expect(presetFromHash('CompressPdf', '#from=heic')).toEqual({});
    expect(presetFromHash('WordCounter', '#target=10kb')).toEqual({});
    expect(presetFromHash('ImageConverter', '#to=exe')).toEqual({});
    expect(presetFromHash('ImageResizer', '#range=50-20kb')).toEqual({});
    expect(presetFromHash('ImageResizer', '#size=99999x1')).toEqual({});
    expect(presetFromHash('CompressPdf', '#target=0kb')).toEqual({});
    expect(presetFromHash('CompressPdf', '#target=9999999mb')).toEqual({});
  });

  it('never throws on garbage, and only ever returns allowlisted props', () => {
    const allowed: Record<string, string[]> = {
      CompressPdf: ['targetKb'], ImagesToPdf: ['targetKb'], VideoCompressor: ['targetMB'], ImageResizer: ['mode', 'targetKb', 'rangeKb', 'w', 'h', 'unit'],
      ImageConverter: ['from', 'to'], AudioConverter: ['from', 'to'], VideoConverter: ['from', 'to'], VideoToMp3: ['from'], VideoToGif: ['from'],
      UnitConverter: ['from', 'to', 'value'], TrimVideo: ['start', 'end'], AudioCutter: ['start', 'end'], SocialResizer: ['platform'], PercentageCalculator: ['p', 'of'],
    };
    expect(Object.keys(allowed).sort()).toEqual(Object.keys(PRESET_KEYS).sort());
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789=&#%-.x<>"\'/:;{} kbmb';
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 3000; i++) {
      const hash = '#' + Array.from({ length: Math.floor(rand() * 40) }, () => chars[Math.floor(rand() * chars.length)]).join('');
      for (const [island, keys] of Object.entries(allowed)) {
        const props = presetFromHash(island, hash);
        expect(Object.keys(props).every((k) => keys.includes(k)), `${island} ${hash}`).toBe(true);
        for (const v of Object.values(props)) expect(typeof v === 'string' ? v.length <= 24 : true).toBe(true);
      }
    }
  });
});
