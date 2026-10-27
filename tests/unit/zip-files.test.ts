import { describe, expect, it } from 'vitest';
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, unzipSync } from 'fflate';
import unzipDef from '@/tools/defs/unzip-files';
import zipDef from '@/tools/defs/zip-files';
import { deflateLevel, freePath, isJunk, isPrecompressed, ratioLabel, zipName, zipTime } from '@/tools/lib/zip-files/zip';

describe('zip settings', () => {
  it('skips deflate for already-compressed files on normal only', () => {
    expect(isPrecompressed('a/photo.JPG')).toBe(true);
    expect(isPrecompressed('notes.txt')).toBe(false);
    expect(isPrecompressed('.jpg')).toBe(false);
    expect(deflateLevel('normal', 'clip.mp4')).toBe(0);
    expect(deflateLevel('normal', 'report.csv')).toBe(6);
    expect(deflateLevel('max', 'clip.mp4')).toBe(9);
    expect(deflateLevel('store', 'report.csv')).toBe(0);
  });
  it('keeps timestamps inside the ZIP date range', () => {
    expect(new Date(zipTime(0)).getFullYear()).toBe(1980);
    expect(new Date(zipTime(Date.UTC(1975, 0, 1))).getFullYear()).toBe(1980);
    expect(new Date(zipTime(Date.UTC(2150, 0, 1))).getFullYear()).toBe(2099);
    const now = Date.now();
    expect(zipTime(now)).toBe(now);
  });
  it('makes a safe archive name', () => {
    expect(zipName('Holiday photos')).toBe('Holiday photos.zip');
    expect(zipName('report.ZIP')).toBe('report.zip');
    expect(zipName('a/b:c')).toBe('a-b-c.zip');
    expect(zipName('  ')).toBe('archive.zip');
  });
  it('finds a free path without touching folder names', () => {
    const taken = new Set(['a.b/c.txt', 'a.b/c (2).txt', 'README']);
    expect(freePath('a.b/c.txt', taken)).toBe('a.b/c (3).txt');
    expect(freePath('README', taken)).toBe('README (2)');
    expect(freePath('new.txt', taken)).toBe('new.txt');
  });
  it('spots system clutter', () => {
    expect(isJunk('photos/.DS_Store')).toBe(true);
    expect(isJunk('Thumbs.db')).toBe(true);
    expect(isJunk('__MACOSX/photos/._a.jpg')).toBe(true);
    expect(isJunk('photos/._a.jpg')).toBe(true);
    expect(isJunk('photos/a.jpg')).toBe(false);
  });
  it('labels the size change', () => {
    expect(ratioLabel(1000, 620)).toBe('−38%');
    expect(ratioLabel(1000, 1020)).toBe('+2%');
    expect(ratioLabel(0, 10)).toBe('');
  });
});

describe('streaming zip, as the worker builds it', () => {
  it('round-trips stored and deflated entries with UTF-8 names', () => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      parts.push(chunk);
    });
    const text = new TextEncoder().encode('hello '.repeat(1000));
    const deflated = new ZipDeflate('docs/notes.txt', { level: 6 });
    deflated.mtime = zipTime(Date.now());
    zip.add(deflated);
    deflated.push(text.subarray(0, 3000));
    deflated.push(text.subarray(3000), true);
    const stored = new ZipPassThrough('fotos/café.jpg');
    stored.mtime = zipTime(0);
    zip.add(stored);
    stored.push(Uint8Array.of(1, 2, 3), true);
    zip.end();

    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
    const out = unzipSync(all);
    expect(strFromU8(out['docs/notes.txt'])).toBe('hello '.repeat(1000));
    expect([...out['fotos/café.jpg']]).toEqual([1, 2, 3]);
    expect(all.length).toBeLessThan(text.length);
  });
});

describe('page copy', () => {
  it('fits search snippet limits', () => {
    for (const def of [unzipDef, zipDef]) {
      expect(def.title.length).toBeLessThanOrEqual(65);
      expect(def.description.length).toBeLessThanOrEqual(160);
      expect(def.steps).toHaveLength(3);
      expect(def.keywords.length).toBeGreaterThanOrEqual(6);
      expect(def.keywords.length).toBeLessThanOrEqual(10);
    }
  });
});
