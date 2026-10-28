import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { files } from '@roundertools/sdk';
import { FX } from './helpers';

const zip = (entries: Parameters<typeof zipSync>[0]) => ({ name: 'test.zip', data: zipSync(entries) });

describe('zip-files', () => {
  it('packs files, storing ones that are compressed already', async () => {
    const out = await files.zip([join(FX, 'pdf/sample-3-pages.pdf'), join(FX, 'media/sample.wav'), { name: 'notes.txt', data: strToU8('hello '.repeat(1000)) }]);
    expect(out.name).toBe('archive.zip');
    const back = unzipSync(out.data);
    expect(Object.keys(back).sort()).toEqual(['notes.txt', 'sample-3-pages.pdf', 'sample.wav']);
    expect(new TextDecoder().decode(back['notes.txt'])).toBe('hello '.repeat(1000));
  });

  it('gives clashing names their own copy', async () => {
    const a = { name: 'same.txt', data: strToU8('a') };
    const b = { name: 'same.txt', data: strToU8('b') };
    const out = await files.zip([a, b], { name: 'pair' });
    expect(out.name).toBe('pair.zip');
    expect(Object.keys(unzipSync(out.data)).sort()).toEqual(['same (2).txt', 'same.txt']);
  });
});

describe('unzip-files', () => {
  it('extracts files and folders', async () => {
    const outs = await files.unzip(zip({ 'a.txt': strToU8('A'), 'dir/b.txt': strToU8('B') }));
    expect(outs.map((o) => o.name).sort()).toEqual(['a.txt', 'dir/b.txt']);
  });

  it('keeps zip-slip names inside the folder', async () => {
    const outs = await files.unzip(zip({ '../../evil.txt': strToU8('x'), '/etc/passwd': strToU8('y'), 'C:\\Windows\\win.ini': strToU8('z') }));
    for (const o of outs) {
      expect(o.name).not.toMatch(/\.\.|^[\\/]|^[a-z]:/i);
    }
    expect(outs.map((o) => o.name).sort()).toEqual(['C_/Windows/win.ini', 'etc/passwd', 'evil.txt']);
  });

  it('never creates symlinks', async () => {
    const data = zipSync({ link: [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }], 'ok.txt': strToU8('ok') });
    const outs = await files.unzip({ name: 'links.zip', data });
    expect(outs.map((o) => o.name)).toEqual(['ok.txt']);
  });

  it('refuses zip bombs and archives with too many entries', async () => {
    const bomb = zip({ 'zeros.bin': [new Uint8Array(30_000_000), { level: 9 }] });
    expect(bomb.data.length).toBeLessThan(100_000);
    await expect(files.unzip(bomb, { maxTotal: '1mb' })).rejects.toMatchObject({ code: 'unsupported-input', message: expect.stringMatching(/limit/) });
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, strToU8('x')]));
    await expect(files.unzip(zip(many), { maxEntries: 10 })).rejects.toMatchObject({ code: 'unsupported-input' });
  });

  it('trusts neither header: a central directory that claims more than the local headers is capped before inflating', async () => {
    const data = zipSync({ 'zeros.bin': [new Uint8Array(1000), { level: 9 }] });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint32(22, 10, true); // the local header says 10 bytes
    const cd = data.findIndex((_, i) => i + 4 <= data.length && view.getUint32(i, true) === 0x02014b50);
    view.setUint32(cd + 24, 0xfffffff0, true); // the central directory says almost 4 GB
    await expect(files.unzip({ name: 'liar.zip', data }, { maxTotal: '1mb' })).rejects.toMatchObject({ code: 'unsupported-input', message: expect.stringMatching(/limit/) });
  });

  it('calls a non-zip damaged', async () => {
    await expect(files.unzip({ name: 'x.zip', data: strToU8('not a zip at all') })).rejects.toMatchObject({ code: 'damaged' });
  });
});

describe('checksum-calculator', () => {
  it('hashes with the site\'s own implementations', async () => {
    const r = await files.checksum({ name: 'abc', data: strToU8('abc') }, { algorithms: ['MD5', 'SHA-1', 'SHA-256', 'CRC32'] });
    expect(r.hashes).toEqual({
      MD5: '900150983cd24fb0d6963f7d28e17f72',
      'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
      'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      CRC32: '352441c2',
    });
  });

  it('checks a pasted checksum', async () => {
    const ok = await files.checksum({ name: 'abc', data: strToU8('abc') }, { expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  abc' });
    expect(ok.match).toBe(true);
    const bad = await files.checksum({ name: 'abc', data: strToU8('abd') }, { expected: '900150983cd24fb0d6963f7d28e17f72' });
    expect(bad.match).toBe(false);
  });
});
