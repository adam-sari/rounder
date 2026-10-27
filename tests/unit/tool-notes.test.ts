import { afterEach, describe, expect, it, vi } from 'vitest';
import { measuredOn, notesProblems, tools } from '@/tools/registry';
import { onToolSuccess, toolSucceeded, TOOL_SUCCESS } from '@/tools/lib/success';

const results = [{ input: '12-page scan, 8.4 MB', setting: 'Strong', output: '1.1 MB' }];

describe('tool notes', () => {
  it('passes every tool in the registry', () => {
    for (const t of tools) expect(notesProblems(t.notes), t.slug).toEqual([]);
  });

  it('accepts complete notes and no notes', () => {
    expect(notesProblems(undefined)).toEqual([]);
    expect(
      notesProblems(
        {
          settings: [{ name: 'Strength', effect: 'Higher strength lowers image quality to save space.' }],
          results,
          measured: { date: '2026-10-27', device: 'Chrome 141 on a 2021 MacBook Air' },
          formats: [{ name: 'PDF/A', about: 'An archival PDF.' }],
          limits: [{ where: 'Gmail', limit: '25 MB per email', source: 'https://support.google.com/mail/answer/6584' }],
        },
        '2026-10-27',
      ),
    ).toEqual([]);
  });

  it('requires measured results to say when and on what', () => {
    expect(notesProblems({ results })).toEqual(['results need measured: { date, device }']);
    expect(notesProblems({ results, measured: { date: '2026-10-27', device: ' ' } }, '2026-10-27')).toEqual(['measured.device is blank']);
    expect(notesProblems({ measured: { date: '2026-10-27', device: 'Chrome' } }, '2026-10-27')).toEqual(['measured without results']);
  });

  it('rejects bad and future dates', () => {
    const at = (date: string) => notesProblems({ results, measured: { date, device: 'Chrome' } }, '2026-10-27');
    expect(at('27/10/2026')[0]).toMatch(/isn't a YYYY-MM-DD date/);
    expect(at('2026-02-30')[0]).toMatch(/isn't a YYYY-MM-DD date/);
    expect(at('2026-10-28')).toEqual(['measured.date 2026-10-28 is in the future']);
  });

  it('rejects empty sections, blank fields and non-https sources', () => {
    expect(notesProblems({ formats: [] })).toEqual(['formats is empty']);
    expect(notesProblems({ settings: [{ name: 'Quality', effect: '' }] })).toEqual(['settings: blank effect']);
    expect(notesProblems({ limits: [{ where: 'Discord', limit: '10 MB', source: 'http://discord.com' }] })).toEqual([
      'limits: source "http://discord.com" isn\'t an https link',
    ]);
  });

  it('writes the measurement date in US English', () => {
    expect(measuredOn('2026-10-27')).toBe('October 27, 2026');
    expect(measuredOn('2026-01-01')).toBe('January 1, 2026');
  });
});

describe('tool success signal', () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (slug?: string) => {
    const win = new EventTarget();
    const host = Object.assign(new EventTarget(), { dataset: { toolSlug: slug } });
    // the host's events bubble to window in a browser; here the fake host forwards them
    host.addEventListener(TOOL_SUCCESS, (e) => win.dispatchEvent(new CustomEvent(TOOL_SUCCESS, { detail: (e as CustomEvent).detail })));
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { querySelector: () => (slug === undefined ? null : host) });
  };

  it("reports the page's slug from ToolHost, or the one given", () => {
    page('png-to-jpg');
    const seen: string[] = [];
    const off = onToolSuccess((d) => seen.push(d.slug));
    toolSucceeded();
    toolSucceeded('image-converter');
    off();
    toolSucceeded();
    expect(seen).toEqual(['png-to-jpg', 'image-converter']);
  });

  it('stays quiet without a slug, and on the server', () => {
    page();
    const seen: string[] = [];
    onToolSuccess((d) => seen.push(d.slug));
    toolSucceeded();
    toolSucceeded('word-counter');
    expect(seen).toEqual(['word-counter']);
    vi.unstubAllGlobals();
    expect(() => toolSucceeded('word-counter')).not.toThrow();
  });
});
