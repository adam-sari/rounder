import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * Settings and usage memory for the CLI and the MCP server: two small JSON files in the user's config folder.
 * settings.json holds what `roundertools config set` writes. usage.json counts which tools were used and when, so the
 * MCP server can list your usual tools up front. It stores tool slugs, counts and dates only: never paths, file names,
 * options or anything read from a file. Nothing here touches the network. Reads never throw (a missing or broken file
 * reads as empty) and writes are best-effort: a read-only home folder or a sandbox just means nothing is remembered.
 */

export interface Settings {
  /** the MCP server's --tools value when the flag isn't given: lean, all, default, families or slugs */
  tools?: string;
  /** false turns usage memory off */
  memory?: boolean;
  /** opt in to experimental features (there are none yet) */
  experimental?: boolean;
}

export interface Usage {
  version: 1;
  tools: Record<string, { count: number; last: string }>;
}

const SETTINGS = 'settings.json';
const USAGE = 'usage.json';
// a tool slug, nothing else: this is what keeps paths and file names out of usage.json
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// more than the tools there are; a cap so the file can't grow without end
const MAX_TOOLS = 200;

/** where settings.json and usage.json live: ROUNDERTOOLS_CONFIG_DIR, or the platform's config folder */
export function settingsDir(): string {
  const env = process.env.ROUNDERTOOLS_CONFIG_DIR;
  if (env) return env;
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'roundertools');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'roundertools');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'roundertools');
}

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(join(settingsDir(), name), 'utf8'));
  } catch {
    return undefined;
  }
}

/** writes through a temp file, so a crash or a second server never leaves half a file; false when it couldn't */
function writeJson(name: string, value: unknown): boolean {
  const dir = settingsDir();
  const tmp = join(dir, `${name}.${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
    renameSync(tmp, join(dir, name));
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // nothing to clean up, or not allowed to
    }
    return false;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** the saved settings; unknown keys and wrong types are dropped */
export function readSettings(): Settings {
  const raw = readJson(SETTINGS);
  if (!isObject(raw)) return {};
  const out: Settings = {};
  if (typeof raw.tools === 'string' && raw.tools.trim()) out.tools = raw.tools.trim();
  if (typeof raw.memory === 'boolean') out.memory = raw.memory;
  if (typeof raw.experimental === 'boolean') out.experimental = raw.experimental;
  return out;
}

/** merges into the saved settings (undefined removes a key); false when the file couldn't be written */
export function writeSettings(partial: Settings): boolean {
  const next: Record<string, unknown> = { ...readSettings() };
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return writeJson(SETTINGS, next);
}

const OFF = /^(off|0|false|no)$/i;

/** whether to remember tool use: off when ROUNDERTOOLS_MEMORY, the settings file or the flag (--no-memory) says so */
export function memoryEnabled(flagOverride?: boolean): boolean {
  if (flagOverride === false) return false;
  if (OFF.test((process.env.ROUNDERTOOLS_MEMORY ?? '').trim())) return false;
  return readSettings().memory !== false;
}

/** usage.json as saved; entries that aren't a slug with a count and a date are dropped */
export function readUsage(): Usage {
  const raw = readJson(USAGE);
  const usage: Usage = { version: 1, tools: {} };
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.tools)) return usage;
  for (const [slug, v] of Object.entries(raw.tools)) {
    if (!SLUG.test(slug) || !isObject(v)) continue;
    if (!Number.isSafeInteger(v.count) || (v.count as number) < 1 || typeof v.last !== 'string' || !DATE.test(v.last)) continue;
    usage.tools[slug] = { count: v.count as number, last: v.last };
  }
  return usage;
}

/** "2026-11-02", local time */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** counts one use of a tool; does nothing when memory is off or the slug isn't one. Never throws */
export function recordUse(slug: string, now: Date = new Date()): void {
  if (typeof slug !== 'string' || !SLUG.test(slug) || !memoryEnabled()) return;
  const usage = readUsage();
  const prev = usage.tools[slug];
  usage.tools[slug] = { count: (prev?.count ?? 0) + 1, last: day(now) };
  const slugs = Object.keys(usage.tools);
  if (slugs.length > MAX_TOOLS) {
    // drop the least recently used first
    const old = slugs.sort((a, b) => usage.tools[a].last.localeCompare(usage.tools[b].last) || usage.tools[a].count - usage.tools[b].count);
    for (const s of old.slice(0, slugs.length - MAX_TOOLS)) delete usage.tools[s];
  }
  writeJson(USAGE, usage);
}

/** the tools used at least minCount times in the last `days` days, most used first, then most recent */
export function favourites(n = 5, minCount = 2, days = 90, now: Date = new Date()): string[] {
  const since = new Date(now);
  since.setDate(since.getDate() - days);
  const from = day(since);
  const { tools } = readUsage();
  return Object.entries(tools)
    .filter(([, t]) => t.count >= minCount && t.last >= from)
    .sort(([a, x], [b, y]) => y.count - x.count || y.last.localeCompare(x.last) || a.localeCompare(b))
    .slice(0, Math.max(0, n))
    .map(([slug]) => slug);
}

/** deletes settings.json and usage.json; false when one of them couldn't be removed */
export function resetSettings(): boolean {
  let ok = true;
  for (const name of [SETTINGS, USAGE]) {
    try {
      rmSync(join(settingsDir(), name), { force: true });
    } catch {
      ok = false;
    }
  }
  return ok;
}
