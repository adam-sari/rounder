import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { favourites, memoryEnabled, readSettings, readUsage, recordUse, resetSettings, settingsDir, writeSettings } from '@roundertools/sdk';
import { workDir } from './helpers';

const work = workDir();
const saved = { dir: process.env.ROUNDERTOOLS_CONFIG_DIR, memory: process.env.ROUNDERTOOLS_MEMORY };
let n = 0;
let dir = '';

// every test gets its own empty config folder (one that doesn't exist yet)
beforeEach(() => {
  dir = join(work, `config ${++n}`);
  process.env.ROUNDERTOOLS_CONFIG_DIR = dir;
  delete process.env.ROUNDERTOOLS_MEMORY;
});
afterEach(() => {
  for (const [k, v] of [['ROUNDERTOOLS_CONFIG_DIR', saved.dir], ['ROUNDERTOOLS_MEMORY', saved.memory]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const file = (name: string) => join(dir, name);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe('settingsDir', () => {
  it('takes ROUNDERTOOLS_CONFIG_DIR, or the platform config folder', () => {
    expect(settingsDir()).toBe(dir);
    delete process.env.ROUNDERTOOLS_CONFIG_DIR;
    const expected =
      process.platform === 'win32'
        ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'roundertools')
        : process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support', 'roundertools')
          : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'roundertools');
    expect(settingsDir()).toBe(expected);
  });
});

describe('settings', () => {
  it('reads as empty when nothing is saved, and creates the folder on write', () => {
    expect(readSettings()).toEqual({});
    expect(existsSync(dir)).toBe(false);
    expect(writeSettings({ tools: 'pdf,image' })).toBe(true);
    expect(readSettings()).toEqual({ tools: 'pdf,image' });
  });

  it('merges, and undefined removes a key', () => {
    writeSettings({ tools: 'all', memory: false });
    writeSettings({ experimental: true });
    expect(readSettings()).toEqual({ tools: 'all', memory: false, experimental: true });
    writeSettings({ tools: undefined });
    expect(readSettings()).toEqual({ memory: false, experimental: true });
  });

  it('shrugs off a broken or odd file', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file('settings.json'), '{ "tools": "all", oops');
    expect(readSettings()).toEqual({});
    writeFileSync(file('settings.json'), JSON.stringify({ tools: 3, memory: 'no', experimental: true, other: 'x' }));
    expect(readSettings()).toEqual({ experimental: true });
    writeFileSync(file('settings.json'), '[]');
    expect(readSettings()).toEqual({});
  });

  it("doesn't throw when the folder can't be written", () => {
    // a file where the folder should be
    mkdirSync(join(dir, '..'), { recursive: true });
    writeFileSync(dir, 'not a folder');
    expect(writeSettings({ tools: 'all' })).toBe(false);
    expect(readSettings()).toEqual({});
    expect(() => recordUse('compress-pdf')).not.toThrow();
    expect(readUsage()).toEqual({ version: 1, tools: {} });
  });
});

describe('memoryEnabled', () => {
  it('is on unless the flag, ROUNDERTOOLS_MEMORY or the settings say off', () => {
    expect(memoryEnabled()).toBe(true);
    expect(memoryEnabled(true)).toBe(true);
    expect(memoryEnabled(false)).toBe(false);
    for (const v of ['off', '0', 'false', 'no', 'OFF']) {
      process.env.ROUNDERTOOLS_MEMORY = v;
      expect(memoryEnabled()).toBe(false);
    }
    process.env.ROUNDERTOOLS_MEMORY = 'on';
    expect(memoryEnabled()).toBe(true);
    writeSettings({ memory: false });
    expect(memoryEnabled()).toBe(false);
  });
});

describe('usage memory', () => {
  it('counts uses per tool with the date', () => {
    recordUse('compress-pdf');
    recordUse('compress-pdf');
    recordUse('merge-pdf', daysAgo(3));
    const { tools } = readUsage();
    expect(tools['compress-pdf'].count).toBe(2);
    expect(tools['compress-pdf'].last).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tools['merge-pdf'].count).toBe(1);
    expect(JSON.parse(readFileSync(file('usage.json'), 'utf8'))).toMatchObject({ version: 1, tools: { 'compress-pdf': { count: 2 } } });
  });

  it('stores tool slugs only: never paths, names or anything else', () => {
    for (const bad of ['C:\\Users\\me\\report.pdf', '/home/me/report.pdf', 'report.pdf', '../x', 'Compress-PDF', '', 'a'.repeat(80)]) recordUse(bad);
    recordUse(42 as unknown as string);
    expect(existsSync(file('usage.json'))).toBe(false);
    recordUse('image-converter');
    const text = readFileSync(file('usage.json'), 'utf8');
    expect(Object.keys(JSON.parse(text).tools)).toEqual(['image-converter']);
    expect(text).not.toMatch(/[\\/.]|report|Users|home/);
  });

  it('remembers nothing when memory is off', () => {
    process.env.ROUNDERTOOLS_MEMORY = 'off';
    recordUse('compress-pdf');
    delete process.env.ROUNDERTOOLS_MEMORY;
    writeSettings({ memory: false });
    recordUse('compress-pdf');
    expect(readUsage().tools).toEqual({});
  });

  it('drops broken entries and reads a broken file as empty', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file('usage.json'), 'garbage');
    expect(readUsage()).toEqual({ version: 1, tools: {} });
    recordUse('merge-pdf');
    expect(readUsage().tools['merge-pdf'].count).toBe(1);
    writeFileSync(file('usage.json'), JSON.stringify({ version: 1, tools: { 'split-pdf': { count: 2, last: '2026-01-01' }, '/etc/passwd': { count: 9, last: '2026-01-01' }, 'zip-files': { count: -1, last: '2026-01-01' }, 'crop-image': { count: 3, last: 'yesterday' }, 'trim-video': 'x' } }));
    expect(readUsage().tools).toEqual({ 'split-pdf': { count: 2, last: '2026-01-01' } });
    writeFileSync(file('usage.json'), JSON.stringify({ version: 2, tools: { 'split-pdf': { count: 2, last: '2026-01-01' } } }));
    expect(readUsage().tools).toEqual({});
  });
});

describe('favourites', () => {
  it('lists tools used at least twice in the last 90 days, most used first, then most recent', () => {
    recordUse('pdf-to-text', daysAgo(1));
    expect(favourites()).toEqual([]);
    recordUse('pdf-to-text', daysAgo(1));
    expect(favourites()).toEqual(['pdf-to-text']);
    for (let i = 0; i < 3; i++) recordUse('compress-pdf', daysAgo(10));
    recordUse('merge-pdf', daysAgo(5));
    recordUse('merge-pdf', daysAgo(2));
    recordUse('image-converter', daysAgo(200));
    recordUse('image-converter', daysAgo(120));
    expect(favourites()).toEqual(['compress-pdf', 'pdf-to-text', 'merge-pdf']);
    expect(favourites(1)).toEqual(['compress-pdf']);
    expect(favourites(5, 3)).toEqual(['compress-pdf']);
    expect(favourites(5, 2, 365)).toEqual(['compress-pdf', 'pdf-to-text', 'merge-pdf', 'image-converter']);
  });
});

describe('resetSettings', () => {
  it('removes both files, and is fine when they are gone already', () => {
    writeSettings({ tools: 'all' });
    recordUse('compress-pdf');
    expect(resetSettings()).toBe(true);
    expect(existsSync(file('settings.json'))).toBe(false);
    expect(existsSync(file('usage.json'))).toBe(false);
    expect(readSettings()).toEqual({});
    expect(resetSettings()).toBe(true);
  });
});
