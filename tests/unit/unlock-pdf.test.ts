import { describe, expect, it } from 'vitest';
import { describeRestrictions, FLAG, listPhrase } from '@/tools/lib/pdf-security/security';

// the allowed set pdf.js builds from an /Encrypt dictionary's P value
const allowedFrom = (p: number) => new Set<number>(Object.values(FLAG).filter((f) => (p + 2 ** 32) & f));

describe('describeRestrictions', () => {
  it('reports nothing for unencrypted files or full permissions', () => {
    expect(describeRestrictions(null)).toEqual([]);
    expect(describeRestrictions(allowedFrom(-4))).toEqual([]);
  });

  it('lists everything qpdf blocks with every permission off (P = -3392)', () => {
    expect(describeRestrictions(allowedFrom(-3392))).toEqual(['printing', 'copying', 'editing', 'commenting', 'form filling']);
  });

  it('names low-resolution-only printing', () => {
    expect(describeRestrictions(new Set([FLAG.PRINT, FLAG.COPY, FLAG.MODIFY, FLAG.ASSEMBLE, FLAG.ANNOTATE]))).toEqual(['high-quality printing']);
  });

  it('treats commenting as allowing form filling (P = -260: forms off, annotate on)', () => {
    expect(describeRestrictions(allowedFrom(-260))).toEqual([]);
  });
});

describe('listPhrase', () => {
  it('joins with commas and "and"', () => {
    expect(listPhrase([])).toBe('');
    expect(listPhrase(['printing'])).toBe('printing');
    expect(listPhrase(['printing', 'copying'])).toBe('printing and copying');
    expect(listPhrase(['printing', 'copying', 'editing'])).toBe('printing, copying and editing');
  });
});
