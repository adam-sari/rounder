import { favourites, memoryEnabled, opBySlug, readSettings, readUsage, resetSettings, settingsDir, writeSettings, type Settings } from '@roundertools/sdk';
import type { Io } from './main';

const line = (s: NodeJS.WritableStream, text = '') => s.write(`${text}\n`);

const USAGE = 'Usage: roundertools config [--json] | config set <tools|memory|experimental> <value> | config reset';
const PRESETS = ['lean', 'all', 'default', 'pdf', 'image', 'files', 'media'];
const ON = /^(on|true)$/i;
const OFF = /^(off|false)$/i;

/** "lean", "pdf,image" or "compress-pdf,merge-pdf": the values the MCP server's --tools takes */
function toolsValue(raw: string): string | null {
  const parts = raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length && parts.every((p) => PRESETS.includes(p) || opBySlug[p]) ? parts.join(',') : null;
}

/** settings for the MCP server, in the same files it reads (the SDK's settings module); the environment comes from process.env */
export function config(args: string[], io: Io): number {
  const [sub, key, value, ...extra] = args;
  if (!sub || sub === '--json') return show(sub === '--json', io);
  if (sub === 'reset' && !key) {
    if (!resetSettings()) return line(io.stderr, `roundertools config: couldn't remove the files in ${settingsDir()}`), 1;
    line(io.stdout, `Settings and usage memory removed from ${settingsDir()}`);
    return 0;
  }
  if (sub !== 'set' || !key || value === undefined || extra.length) return line(io.stderr, USAGE), 2;
  let change: Settings;
  if (key === 'tools') {
    const tools = toolsValue(value);
    if (!tools) return line(io.stderr, `roundertools config: tools takes lean, all, default, families (${PRESETS.slice(3).join(', ')}) or tool slugs, comma-separated. Got "${value}".`), 2;
    change = { tools };
  } else if (key === 'memory' || key === 'experimental') {
    if (!ON.test(value) && !OFF.test(value)) return line(io.stderr, `roundertools config: ${key} takes on or off. Got "${value}".`), 2;
    change = { [key]: ON.test(value) };
  } else return line(io.stderr, `roundertools config: unknown setting "${key}". ${USAGE}`), 2;
  if (!writeSettings(change)) return line(io.stderr, `roundertools config: couldn't write to ${settingsDir()}`), 1;
  const [k, v] = Object.entries(change)[0];
  line(io.stdout, `${k} = ${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`);
  return 0;
}

function show(json: boolean, io: Io): number {
  const settings = readSettings();
  const memory = memoryEnabled();
  const favs = favourites();
  const { tools } = readUsage();
  if (json) {
    line(io.stdout, JSON.stringify({ dir: settingsDir(), settings, memory, favourites: favs }));
    return 0;
  }
  const envOff = memory === false && settings.memory !== false;
  line(io.stdout, `Settings folder: ${settingsDir()}`);
  line(io.stdout, `  tools         ${settings.tools ?? 'lean (default)'}`);
  line(io.stdout, `  memory        ${memory ? 'on' : 'off'}${envOff ? ' (ROUNDERTOOLS_MEMORY)' : ''}`);
  line(io.stdout, `  experimental  ${settings.experimental ? 'on' : 'off'}`);
  line(io.stdout, `Favourites: ${favs.length ? favs.map((s) => `${s} (${tools[s].count})`).join(', ') : 'none yet (a tool used twice shows up here)'}`);
  line(io.stdout);
  line(io.stdout, 'Change with `roundertools config set <tools|memory|experimental> <value>`, or start over with `roundertools config reset`.');
  return 0;
}
