import { describe, expect, it } from 'vitest';
import { convert, formatNumber, formula, isRounded, parseNumber, prettyNumber, searchUnits } from '@/tools/lib/units/convert';
import { categories, categoryById, findUnit } from '@/tools/lib/units/units';

const u = (cat: string, id: string) => findUnit(categoryById[cat], id);
const conv = (cat: string, v: number, from: string, to: string) => convert(v, u(cat, from), u(cat, to));
const close = (cat: string, v: number, from: string, to: string, expected: number) =>
  expect(Math.abs(conv(cat, v, from, to) / expected - 1)).toBeLessThan(1e-8);

describe('catalog', () => {
  it('has unique unit ids and valid defaults in every category', () => {
    for (const c of categories) {
      const ids = c.units.map((x) => x.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
      for (const d of c.defaults) expect(ids, c.id).toContain(d);
      for (const x of c.units) expect(x.factor, `${c.id}/${x.id}`).toBeGreaterThan(0);
    }
  });

  it('round-trips every unit through the base unit', () => {
    for (const c of categories) {
      for (const a of c.units) {
        for (const b of c.units) {
          const there = convert(12.5, a, b);
          expect(convert(there, b, a) / 12.5, `${a.id}→${b.id}`).toBeCloseTo(1, 12);
        }
      }
    }
  });
});

describe('exact definitions', () => {
  it('length', () => {
    expect(formatNumber(conv('length', 1, 'in', 'cm'), 15)).toBe('2.54');
    expect(formatNumber(conv('length', 1, 'ft', 'm'), 15)).toBe('0.3048');
    expect(formatNumber(conv('length', 1, 'mi', 'km'), 15)).toBe('1.609344');
    expect(formatNumber(conv('length', 1, 'mi', 'ft'), 15)).toBe('5280');
    expect(formatNumber(conv('length', 1, 'yd', 'in'), 15)).toBe('36');
  });

  it('weight', () => {
    expect(formatNumber(conv('weight', 1, 'lb', 'kg'), 15)).toBe('0.45359237');
    expect(formatNumber(conv('weight', 1, 'lb', 'oz'), 15)).toBe('16');
    expect(formatNumber(conv('weight', 1, 'st', 'lb'), 15)).toBe('14');
    expect(formatNumber(conv('weight', 1, 'ton-us', 'lb'), 15)).toBe('2000');
    expect(formatNumber(conv('weight', 1, 'ton-uk', 'lb'), 15)).toBe('2240');
    expect(formatNumber(conv('weight', 1, 'lb', 'gr'), 15)).toBe('7000');
    close('weight', 1, 'kg', 'lb', 2.20462262185);
  });

  it('volume: US gallon is 231 cubic inches and the kitchen measures nest', () => {
    expect(formatNumber(conv('volume', 1, 'gal-us', 'in3'), 15)).toBe('231');
    expect(formatNumber(conv('volume', 1, 'gal-us', 'floz-us'), 15)).toBe('128');
    expect(formatNumber(conv('volume', 1, 'cup-us', 'tbsp-us'), 15)).toBe('16');
    expect(formatNumber(conv('volume', 1, 'tbsp-us', 'tsp-us'), 15)).toBe('3');
    expect(formatNumber(conv('volume', 1, 'gal-uk', 'floz-uk'), 15)).toBe('160');
    expect(formatNumber(conv('volume', 1, 'pt-uk', 'floz-uk'), 15)).toBe('20');
    expect(formatNumber(conv('volume', 1, 'floz-us', 'ml'), 15)).toBe('29.5735295625');
    expect(formatNumber(conv('volume', 1, 'ft3', 'in3'), 15)).toBe('1728');
  });

  it('area, speed, time', () => {
    expect(formatNumber(conv('area', 1, 'ac', 'ft2'), 15)).toBe('43560');
    expect(formatNumber(conv('area', 1, 'mi2', 'ac'), 15)).toBe('640');
    expect(formatNumber(conv('speed', 100, 'kmh', 'mps'), 15)).toBe('27.7777777777778');
    expect(formatNumber(conv('speed', 60, 'mph', 'kmh'), 15)).toBe('96.56064');
    expect(formatNumber(conv('speed', 1, 'kn', 'kmh'), 15)).toBe('1.852');
    expect(formatNumber(conv('time', 1, 'yr', 'd'), 15)).toBe('365.2425');
    expect(formatNumber(conv('time', 1, 'wk', 'h'), 15)).toBe('168');
  });

  it('data size keeps decimal and binary prefixes apart', () => {
    expect(formatNumber(conv('data', 1, 'gb', 'mb'), 15)).toBe('1000');
    expect(formatNumber(conv('data', 1, 'gib', 'mib'), 15)).toBe('1024');
    expect(formatNumber(conv('data', 1, 'kib', 'byte'), 15)).toBe('1024');
    expect(formatNumber(conv('data', 1, 'byte', 'bit'), 15)).toBe('8');
    expect(formatNumber(conv('data', 100, 'mbit', 'mb'), 15)).toBe('12.5');
    close('data', 1, 'tb', 'gib', 931.322574615);
  });

  it('pressure, energy, power', () => {
    close('pressure', 1, 'psi', 'pa', 6894.75729317);
    close('pressure', 1, 'atm', 'psi', 14.6959487755);
    expect(formatNumber(conv('pressure', 760, 'torr', 'atm'), 15)).toBe('1');
    close('pressure', 1, 'inhg', 'hpa', 33.86388640341);
    expect(formatNumber(conv('energy', 1, 'kcal', 'kj'), 15)).toBe('4.184');
    expect(formatNumber(conv('energy', 1, 'kwh', 'mj'), 15)).toBe('3.6');
    close('power', 1, 'hp', 'w', 745.69987158227);
    expect(formatNumber(conv('power', 1, 'ps', 'w'), 15)).toBe('735.49875');
  });

  it('angle and frequency', () => {
    expect(formatNumber(conv('angle', 180, 'deg', 'rad'), 15)).toBe(formatNumber(Math.PI, 15));
    expect(formatNumber(conv('angle', 1, 'turn', 'grad'), 15)).toBe('400');
    expect(formatNumber(conv('frequency', 60, 'rpm', 'hz'), 15)).toBe('1');
  });
});

describe('temperature (offset units)', () => {
  it('converts the anchor points', () => {
    expect(formatNumber(conv('temperature', 100, 'c', 'f'))).toBe('212');
    expect(formatNumber(conv('temperature', 0, 'c', 'f'))).toBe('32');
    expect(formatNumber(conv('temperature', -40, 'f', 'c'))).toBe('-40');
    expect(formatNumber(conv('temperature', 0, 'k', 'c'))).toBe('-273.15');
    expect(formatNumber(conv('temperature', 0, 'k', 'f'))).toBe('-459.67');
    expect(formatNumber(conv('temperature', 0, 'c', 'r'))).toBe('491.67');
    expect(formatNumber(conv('temperature', 98.6, 'f', 'c'))).toBe('37');
  });
});

describe('fuel economy (inverse unit)', () => {
  it('turns mpg into L/100 km and back', () => {
    close('fuel', 1, 'mpg-us', 'l100km', 235.214583);
    close('fuel', 1, 'mpg-uk', 'l100km', 282.480936);
    expect(formatNumber(conv('fuel', 5, 'l100km', 'kml'))).toBe('20');
    expect(formatNumber(conv('fuel', 10, 'l100km', 'mpg-us'))).toBe('23.5215');
    close('fuel', 1, 'mpg-uk', 'mpg-us', 0.832674185);
  });

  it('has no finite answer for zero consumption', () => {
    expect(Number.isFinite(conv('fuel', 0, 'l100km', 'mpg-us'))).toBe(false);
    expect(formatNumber(conv('fuel', 0, 'l100km', 'mpg-us'))).toBe('');
  });
});

describe('formatNumber', () => {
  it('removes float noise', () => {
    expect(formatNumber(0.1 + 0.2, 15)).toBe('0.3');
    expect(formatNumber(2.5399999999999996, 15)).toBe('2.54');
  });

  it('rounds to significant digits without eating whole digits', () => {
    expect(formatNumber(2.20462262185, 6)).toBe('2.20462');
    expect(formatNumber(123456789, 6)).toBe('123456789');
    expect(formatNumber(0.000123456789, 4)).toBe('0.0001235');
    expect(formatNumber(-0.00000001, 6)).toBe('-1e-8');
    expect(formatNumber(9460730472580800, 6)).toBe('9.46073e15');
    expect(formatNumber(0)).toBe('0');
  });

  it('pretty prints with separators and powers of ten', () => {
    expect(prettyNumber(1234567.891, 10)).toBe('1,234,567.891');
    expect(prettyNumber(1.602176634e-19, 4)).toBe('1.602 × 10⁻¹⁹');
    expect(prettyNumber(Infinity)).toBe('—');
  });

  it('knows when a value was rounded', () => {
    expect(isRounded(2.54, 6)).toBe(false);
    expect(isRounded(1.609344, 6)).toBe(true);
  });
});

describe('parseNumber', () => {
  it('reads plain, grouped and scientific numbers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber(' -3.5 ')).toBe(-3.5);
    expect(parseNumber('1,250.5')).toBe(1250.5);
    expect(parseNumber('2e6')).toBe(2e6);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('−40')).toBe(-40);
  });

  it('reads kitchen fractions', () => {
    expect(parseNumber('3/4')).toBe(0.75);
    expect(parseNumber('1 1/2')).toBe(1.5);
    expect(parseNumber('1½')).toBe(1.5);
    expect(parseNumber('¾')).toBe(0.75);
    expect(parseNumber('-2 1/4')).toBe(-2.25);
  });

  it('reads a decimal comma without breaking thousands separators', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('0,125')).toBe(0.125);
    expect(parseNumber('-2,25')).toBe(-2.25);
    expect(parseNumber('1.250,5')).toBe(1250.5);
    expect(parseNumber('1,250')).toBe(1250);
    expect(parseNumber('12,345,678.9')).toBe(12345678.9);
  });

  it('tells empty apart from invalid', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    // a sign or point on its own is still being typed, not an error
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('.')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('1/0')).toBeNaN();
    expect(parseNumber('1.2.3')).toBeNaN();
  });
});

describe('formula', () => {
  const f = (cat: string, from: string, to: string) => formula(u(cat, from), u(cat, to));
  it('writes the friendliest form', () => {
    expect(f('length', 'in', 'cm')).toBe('cm = in × 2.54');
    expect(f('length', 'cm', 'in')).toBe('in = cm ÷ 2.54');
    expect(f('length', 'cm', 'm')).toBe('m = cm ÷ 100');
    expect(f('length', 'm', 'cm')).toBe('cm = m × 100');
    expect(f('temperature', 'c', 'f')).toBe('°F = °C × 1.8 + 32');
    expect(f('temperature', 'f', 'c')).toBe('°C = (°F − 32) ÷ 1.8');
    expect(f('temperature', 'k', 'c')).toBe('°C = K − 273.15');
    expect(f('temperature', 'f', 'k')).toBe('K = (°F + 459.67) ÷ 1.8');
    expect(f('fuel', 'mpg-us', 'l100km')).toBe('L/100 km = 235.214583 ÷ mpg');
  });
});

describe('searchUnits', () => {
  it('finds units by symbol, name, plural and alias', () => {
    const length = [categoryById.length];
    expect(searchUnits('ft', length)[0].unit.id).toBe('ft');
    expect(searchUnits('feet', length)[0].unit.id).toBe('ft');
    expect(searchUnits('metre', length).map((m) => m.unit.id)).toContain('m');
    expect(searchUnits('', length)).toHaveLength(categoryById.length.units.length);
  });

  it('ranks the plain unit above its micro- prefix and bytes above bits', () => {
    expect(searchUnits('m', [categoryById.length])[0].unit.id).toBe('m');
    expect(searchUnits('g', [categoryById.weight])[0].unit.id).toBe('g');
    expect(searchUnits('s', [categoryById.time])[0].unit.id).toBe('s');
    expect(searchUnits('um', [categoryById.length])[0].unit.id).toBe('um');
    expect(searchUnits('µg', [categoryById.weight])[0].unit.id).toBe('ug');
    for (const id of ['kb', 'mb', 'gb']) expect(searchUnits(id, [categoryById.data])[0].unit.id).toBe(id);
    expect(searchUnits('b', [categoryById.data])[0].unit.id).toBe('byte');
  });

  it('searches across categories', () => {
    const hits = searchUnits('psi', categories);
    expect(hits[0].category.id).toBe('pressure');
    expect(searchUnits('kib', categories)[0].unit.id).toBe('kib');
    expect(searchUnits('zzz', categories)).toHaveLength(0);
  });
});
