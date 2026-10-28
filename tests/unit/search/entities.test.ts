import { describe, expect, it } from 'vitest';
import { parse } from '@/search/core/entities';
import { LIMITS } from '@/tools/lib/notes';
import { PLATFORMS, UNIT_DIM, UNITS } from '@/search/core/lexicon';
import { categories } from '@/tools/lib/units/units';
import { lexTokens, normalize, osa } from '@/search/core/text';

describe('normalize and tokens', () => {
  it('glues numbers to units and strips accents', () => {
    expect(normalize('Résumé  under 20 KB!')).toBe('resume under 20kb');
    expect(normalize('3.5 x 4.5 cm')).toBe('3.5 x 4.5 cm');
  });

  it('maps romanised Hindi and drops filler words', () => {
    expect(lexTokens('photo ka size kam kaise kare')).toEqual(['photo', 'size', 'reduce']);
  });

  it('measures typo distance with transpositions', () => {
    expect(osa('pfd', 'pdf')).toBe(1);
    expect(osa('comprss', 'compress')).toBe(1);
    expect(osa('abc', 'xyz', 1)).toBe(2);
  });
});

describe('sizes', () => {
  it.each([
    ['resize image to 20kb to 50kb', { rangeKb: [20, 50] }],
    ['signature 10 to 20 kb', { rangeKb: [10, 20] }],
    ['image between 30 and 60 kb', { rangeKb: [30, 60] }],
    ['20-50kb photo', { rangeKb: [20, 50] }],
    ['compress pdf to 2mb', { maxKb: 2000 }],
    ['pdf below 500 kb', { maxKb: 500 }],
    ['increase image size to 50kb', { minKb: 50 }],
  ])('%s', (q, size) => expect(parse(q).size).toEqual(size));

  it('reads 4k as a resolution, not a size', () => {
    expect(parse('make image 4k').size).toBeUndefined();
    expect(parse('make image 4k').actions).toContain('upscale');
  });
});

describe('dimensions, durations, percents, units', () => {
  it('reads dimensions with units', () => {
    expect(parse('resize image to 1080x1080').dims).toEqual({ w: 1080, h: 1080, unit: 'px' });
    expect(parse('photo 3.5 x 4.5 cm').dims).toEqual({ w: 3.5, h: 4.5, unit: 'cm' });
    expect(parse('2x2 inch photo').dims).toEqual({ w: 2, h: 2, unit: 'in' });
  });

  it('reads durations and percents', () => {
    expect(parse('cut off the first 10 seconds').durationS).toBe(10);
    expect(parse('5 minute timer').durationS).toBe(300);
    expect(parse('what is 15% of 80').percent).toBe(15);
  });

  it('reads unit conversions, with or without a value', () => {
    expect(parse('70 kg in lbs').unitConv).toMatchObject({ value: 70, from: 'kg', to: 'lb' });
    expect(parse('how to convert ml to l').unitConv).toMatchObject({ from: 'ml', to: 'l' });
    expect(parse('37 c to f').unitConv).toMatchObject({ value: 37, from: 'c', to: 'f' });
    expect(parse('photo in pdf').unitConv).toBeUndefined();
    // ounces are weight next to pounds and fluid next to milliliters; units that measure different things never pair
    expect(parse('16 oz to lbs').unitConv).toMatchObject({ from: 'oz', to: 'lb' });
    expect(parse('oz to ml').unitConv).toMatchObject({ from: 'floz-us', to: 'ml' });
    expect(parse('500 g to oz').unitConv).toMatchObject({ from: 'g', to: 'oz' });
    expect(parse('5 kg to cm').unitConv).toBeUndefined();
  });
});

describe('formats and roles', () => {
  it('assigns source and target around "to"', () => {
    expect(parse('heic to jpg')).toMatchObject({ from: 'heic', to: 'jpg' });
    expect(parse('pdf to word')).toMatchObject({ from: 'pdf', to: 'docx' });
    expect(parse('save pdf as word document')).toMatchObject({ from: 'pdf', to: 'docx' });
  });

  it('knows multi-word aliases', () => {
    expect(parse('iphone photo to jpg')).toMatchObject({ from: 'heic', to: 'jpg' });
    expect(parse('iphone video to mp4')).toMatchObject({ from: 'mov', to: 'mp4' });
  });

  it('reads "X from Y" and "into <kind>"', () => {
    expect(parse('make a gif from a video')).toMatchObject({ to: 'gif' });
    expect([...parse('make a gif from a video').nounKinds]).toEqual(['video']);
    expect(parse('turn a pdf into images')).toMatchObject({ from: 'pdf', toKind: 'image' });
  });

  it('reads Hinglish "X ko Y me" as a conversion', () => {
    expect(parse('pdf ko word me convert')).toMatchObject({ from: 'pdf', to: 'docx', hinglish: true });
    expect(parse('image ko pdf me convert')).toMatchObject({ to: 'pdf' });
  });

  it("doesn't read 'how to' as a conversion or 'word counter' as Word", () => {
    expect(parse('how to add page numbers in word').to).toBeUndefined();
    expect(parse('word counter').formats).toEqual([]);
    expect(parse('text to speech').from).toBe('txt');
  });

  it('fixes typos in formats and verbs, but never swaps mp3 and mp4', () => {
    expect(parse('hiec to jpg')).toMatchObject({ from: 'heic', to: 'jpg' });
    expect(parse('jpg to pfd').to).toBe('pdf');
    expect(parse('mp4 to mp34').to).toBe('mp3');
    expect(parse('mp3 to mp4')).toMatchObject({ from: 'mp3', to: 'mp4' });
    expect(parse('comprss pdf').actions).toContain('compress');
  });

  it('leaves real words alone when told they exist', () => {
    expect(parse('resize photo to passport size', (w) => w === 'passport').platforms).toContain('passport');
  });
});

describe('actions, objects, negation, platforms', () => {
  it('rules out a negated action', () => {
    const e = parse('enlarge a small photo without blur');
    expect(e.negated.has('blur')).toBe(true);
    expect(e.actions).not.toContain('blur');
  });

  it('reads "without <object>" as removing it', () => {
    const e = parse('photo without background');
    expect(e.actions).toContain('remove');
    expect(e.objects.has('background')).toBe(true);
  });

  it('finds platforms and devices', () => {
    expect(parse('make video smaller for discord').platforms).toEqual(['discord']);
    expect(parse('signature resize for ssc').platforms).toEqual(['exam']);
    expect(parse('iphone ringtone from mp3').devices).toEqual(['iphone']);
  });
});

describe('platform caps', () => {
  it('match the sourced LIMITS the tool pages quote', () => {
    for (const p of Object.values(PLATFORMS)) {
      if (!p.fileMB) continue;
      const lim = LIMITS[p.limit as keyof typeof LIMITS];
      expect(lim, p.label).toBeDefined();
      expect(lim.limit, p.label).toContain(`${p.fileMB} MB`);
      expect(lim.source).toMatch(/^https:\/\//);
    }
  });

  it('give WhatsApp no number until there is an official source', () => {
    expect(PLATFORMS.whatsapp.fileMB).toBeUndefined();
  });
});

describe('unit words', () => {
  it('name real unit ids, and units that measure the same thing share a category', () => {
    const catOf = new Map(categories.flatMap((c) => c.units.map((u) => [u.id, c.id] as const)));
    for (const id of new Set([...Object.values(UNITS), 'floz-us'])) {
      expect(catOf.has(id), id).toBe(true);
      expect(UNIT_DIM[id], id).toBeDefined();
    }
    const byDim = new Map<string, Set<string>>();
    for (const [id, dim] of Object.entries(UNIT_DIM)) byDim.set(dim, (byDim.get(dim) ?? new Set()).add(catOf.get(id)!));
    for (const [dim, cats] of byDim) expect(cats.size, dim).toBe(1);
  });
});
