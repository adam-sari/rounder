// Everything the installer on /developers shows: the install command, config file or link for each app, built from the
// options a visitor picks. Pure functions over plain data, so the Svelte island, the static docs and the unit tests all
// build the exact same strings. The tool catalog is passed in (slug, family, title), never imported: the SDK's op specs
// carry zod schemas that don't belong in the browser bundle.
import sizes from './mcp-tool-sizes.json';

export type Family = 'pdf' | 'image' | 'files' | 'media';
export interface InstallerOp {
  slug: string;
  family: Family;
  title: string;
  /** what the tool needs on the computer besides Node; the installer says when a pick needs ffmpeg */
  requires?: string[];
}

export const SERVER_NAME = 'roundertools';
/** the npm packages; src/developers.ts and the docs pages read them from here */
export const PACKAGES = { sdk: '@roundertools/sdk', cli: 'roundertools', mcp: '@roundertools/mcp' } as const;
export const MCP_PACKAGE = PACKAGES.mcp;
export const FAMILIES: readonly Family[] = ['pdf', 'image', 'files', 'media'];
export const FAMILY_NAMES: Record<Family, string> = { pdf: 'PDF', image: 'Images', files: 'Files', media: 'Video and audio' };
/** the family inside a sentence: "the PDF tools", "the file tools" */
export const FAMILY_TOOLS: Record<Family, string> = { pdf: 'PDF tools', image: 'image tools', files: 'file tools', media: 'video and audio tools' };

/** where the assistant runs; `mcp` false means the customise panel doesn't apply */
export type EnvId = 'claude-code' | 'codex' | 'gemini' | 'claude-desktop' | 'cursor' | 'vscode' | 'windsurf' | 'other' | 'code';
export const ENVS: readonly { id: EnvId; label: string; mcp: boolean }[] = [
  { id: 'claude-code', label: 'Claude Code', mcp: true },
  { id: 'codex', label: 'Codex CLI', mcp: true },
  { id: 'gemini', label: 'Gemini CLI', mcp: true },
  { id: 'claude-desktop', label: 'Claude Desktop', mcp: true },
  { id: 'cursor', label: 'Cursor', mcp: true },
  { id: 'vscode', label: 'VS Code', mcp: true },
  { id: 'windsurf', label: 'Windsurf', mcp: true },
  { id: 'other', label: 'Other MCP app', mcp: true },
  { id: 'code', label: 'My own code', mcp: false },
];
const ENV_IDS = new Set<string>(ENVS.map((e) => e.id));

/** what's listed up front; `custom` lists the `picked` slugs */
export type Preset = 'lean' | Family | 'all' | 'custom';
export const PRESETS: readonly { id: Preset; label: string }[] = [
  { id: 'lean', label: 'Lean' },
  { id: 'pdf', label: 'PDF' },
  { id: 'image', label: 'Images' },
  { id: 'media', label: 'Video and audio' },
  { id: 'files', label: 'Files' },
  { id: 'all', label: 'Everything' },
  { id: 'custom', label: 'Choose tools' },
];

export interface InstallOptions {
  preset: Preset;
  /** slugs, used when preset is custom */
  picked: string[];
  /** folders it may read (--allow); none means the server's default: the home folder and the folder it starts in */
  allow: string[];
  /** false adds --no-memory */
  memory: boolean;
  /** true adds --experimental */
  experimental: boolean;
}

export const DEFAULT_OPTIONS: InstallOptions = { preset: 'lean', picked: [], allow: [], memory: true, experimental: false };

/** quick picks for --allow; the server expands ~ itself (on Windows too), so these work in JSON and TOML as well as in a shell */
export const FOLDER_PICKS: readonly { path: string; label: string }[] = [
  { path: '~/Documents', label: 'Documents' },
  { path: '~/Downloads', label: 'Downloads' },
  { path: '~/Desktop', label: 'Desktop' },
];

export type Os = 'mac' | 'windows' | 'linux';
export const OS_NAMES: Record<Os, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' };
export const DESKTOP_CONFIG: Record<Os, string> = {
  mac: '~/Library/Application Support/Claude/claude_desktop_config.json',
  windows: '%APPDATA%\\Claude\\claude_desktop_config.json',
  linux: '~/.config/Claude/claude_desktop_config.json',
};

/** the skill the Claude Code plugin installs, as a file other agents (Codex, Gemini CLI) can read from ~/.agents/skills */
export const SKILL_URL = 'https://raw.githubusercontent.com/adam-sari/rounder/main/plugins/roundertools/skills/roundertools/SKILL.md';
export const PLUGIN_COMMANDS = ['/plugin marketplace add adam-sari/rounder', '/plugin install roundertools@roundertools'] as const;

// ---- the server's flags

/** the slugs a selection lists up front, in catalog order (none for lean) */
export function selectedSlugs(o: InstallOptions, catalog: readonly InstallerOp[]): string[] {
  if (o.preset === 'lean') return [];
  if (o.preset === 'all') return catalog.map((t) => t.slug);
  if (o.preset === 'custom') {
    const picked = new Set(o.picked);
    return catalog.filter((t) => picked.has(t.slug)).map((t) => t.slug);
  }
  return catalog.filter((t) => t.family === o.preset).map((t) => t.slug);
}

/**
 * The --tools value, or undefined for lean (the server's default, so the flag is left out). A hand-picked list is
 * written as short as the server reads it: every tool is "all", a whole family is its name.
 */
export function toolsValue(o: InstallOptions, catalog: readonly InstallerOp[]): string | undefined {
  if (o.preset === 'lean') return undefined;
  if (o.preset !== 'custom') return o.preset;
  const picked = new Set(selectedSlugs(o, catalog));
  if (!picked.size) return undefined;
  if (picked.size === catalog.length) return 'all';
  const words: string[] = [];
  for (const family of FAMILIES) {
    const members = catalog.filter((t) => t.family === family);
    if (members.length && members.every((t) => picked.has(t.slug))) words.push(family);
    else words.push(...members.filter((t) => picked.has(t.slug)).map((t) => t.slug));
  }
  return words.join(',');
}

/**
 * Characters a folder can't contain here. The Claude Code and Codex commands get pasted into bash, zsh, PowerShell and
 * cmd, and a folder can come from a shared link, so it must not be able to leave its quotes or expand into anything:
 * `"` ends the quotes, `$` and the backtick expand in POSIX shells and PowerShell (`$(...)` runs a command in both),
 * `%` and `!` expand in cmd (and `!` in interactive bash), and the rest are shell and cmd operators.
 */
const UNSAFE = /[\u0000-\u001f\u007f"$`%!;&|<>^]/;

/** trimmed, without a trailing slash: it means nothing to the server, and a trailing \ would escape a POSIX shell's closing quote */
function tidyFolder(folder: string): string {
  let f = folder.trim();
  while (f.length > 1 && /[\\/]$/.test(f) && !/^[A-Za-z]:[\\/]$/.test(f)) f = f.slice(0, -1);
  // a drive root keeps a slash, the forward one, which Windows reads the same
  if (/^[A-Za-z]:\\$/.test(f)) f = `${f.slice(0, 2)}/`;
  return f;
}

/** why a folder can't be added, or null when it can (or is blank) */
export function folderProblem(folder: string): string | null {
  const f = tidyFolder(folder);
  if (UNSAFE.test(f)) return "A folder with \" $ ` % ! ; & | < > or ^ in its name can't be added here: a shell would read them.";
  // the server reads `--allow -x` as a flag without its value
  if (f.startsWith('-')) return `A folder can't start with a dash here. Write ./${f} instead.`;
  return null;
}

/** tidy folder list: trimmed, no blanks, no repeats, and nothing a shell would read (see folderProblem) */
export function cleanFolders(folders: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of folders) {
    const f = tidyFolder(raw);
    if (f && !seen.has(f) && !folderProblem(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

/**
 * The server's flags, always in this order: --allow (each folder), --tools, --no-memory, --experimental. Options at
 * their defaults are left out, so the server falls back to its settings file (`npx roundertools config`), then lean.
 */
export function serverFlags(o: InstallOptions, catalog: readonly InstallerOp[]): string[] {
  const flags: string[] = [];
  for (const f of cleanFolders(o.allow)) flags.push('--allow', f);
  const tools = toolsValue(o, catalog);
  if (tools) flags.push('--tools', tools);
  if (!o.memory) flags.push('--no-memory');
  if (o.experimental) flags.push('--experimental');
  return flags;
}

/** the arguments after `npx`: -y, the package, then the flags */
export function serverArgs(o: InstallOptions, catalog: readonly InstallerOp[]): string[] {
  return ['-y', MCP_PACKAGE, ...serverFlags(o, catalog)];
}

/**
 * Quotes a word only when it needs it: in double quotes, with nothing escaped inside. Without the UNSAFE characters a
 * word in double quotes reads the same in bash, zsh, PowerShell and cmd, which no escaping scheme manages (a backslash
 * is an ordinary character in PowerShell and cmd, and cmd has no single quotes). ~ stays bare when it can; quoted, the
 * server expands it instead of the shell. cleanFolders drops unsafe folders first, so the throw is a guard, never hit.
 */
export function shellWord(word: string): string {
  if (/^[\w@+=:,./~-]+$/.test(word)) return word;
  if (UNSAFE.test(word)) throw new Error(`${JSON.stringify(word)} can't be quoted safely for every shell`);
  return `"${word}"`;
}
const shellLine = (words: string[]) => words.map(shellWord).join(' ');

// ---- per app

/** Claude Code: user scope, so it's there in every project; options go before the name, the server after -- */
export function claudeCodeCommand(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return shellLine(['claude', 'mcp', 'add', '--scope', 'user', SERVER_NAME, '--', 'npx', ...serverArgs(o, catalog)]);
}

export function codexCommand(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return shellLine(['codex', 'mcp', 'add', SERVER_NAME, '--', 'npx', ...serverArgs(o, catalog)]);
}

/** ~/.codex/config.toml; TOML basic strings take JSON's escapes */
export function codexToml(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  const args = serverArgs(o, catalog).map((a) => JSON.stringify(a)).join(', ');
  return `[mcp_servers.${SERVER_NAME}]\ncommand = "npx"\nargs = [${args}]`;
}

/** the { command, args } entry most apps share */
export function serverEntry(o: InstallOptions, catalog: readonly InstallerOp[]) {
  return { command: 'npx', args: serverArgs(o, catalog) };
}

/** Claude Desktop, Gemini CLI, Windsurf and most other apps: { "mcpServers": { "roundertools": { command, args } } } */
export function mcpServersJson(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry(o, catalog) } }, null, 2);
}

/** Cursor's mcp.json: its docs mark "type" as required, so it's spelled out */
export function cursorJson(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'stdio', ...serverEntry(o, catalog) } } }, null, 2);
}

/** VS Code's .vscode/mcp.json: "servers", with a type */
export function vscodeJson(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return JSON.stringify({ servers: { [SERVER_NAME]: { type: 'stdio', ...serverEntry(o, catalog) } } }, null, 2);
}

/** base64 of the UTF-8 bytes, so a folder name with accents doesn't break btoa */
function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Cursor's one-click install: the server entry (without its name) as base64 JSON (cursor.com/docs/context/mcp/install-links) */
export function cursorLink(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(base64(JSON.stringify(serverEntry(o, catalog))))}`;
}

/** VS Code's one-click install: URL-encoded JSON with the name inside */
export function vscodeLink(o: InstallOptions, catalog: readonly InstallerOp[]): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: 'stdio', ...serverEntry(o, catalog) }))}`;
}

/** puts the skill where Codex and Gemini CLI both look for your own skills (macOS and Linux) */
export const SKILL_COMMAND = `mkdir -p ~/.agents/skills/${SERVER_NAME} && curl -fsSL ${SKILL_URL} -o ~/.agents/skills/${SERVER_NAME}/SKILL.md`;

export const SDK_INSTALL = `npm install ${PACKAGES.sdk}`;
export const SDK_EXAMPLE = `import { pdf } from '${PACKAGES.sdk}';

const small = await pdf.compress('report.pdf', { target: '1mb' });
await small.save();   // ./report-compressed.pdf`;
export const CLI_EXAMPLE = `npx -y ${PACKAGES.cli} compress-pdf report.pdf --target 1mb`;

/** shell and claude snippets are one-line commands, shown wrapped; the rest keep their lines and scroll */
export type SnippetKind = 'shell' | 'json' | 'toml' | 'ts' | 'claude';
export interface Snippet {
  /** the caption over the code */
  label: string;
  /** what its copy button copies, for screen readers: "Copy the MCP server command" */
  name: string;
  code: string;
  kind: SnippetKind;
}
export interface Install {
  snippets: Record<string, Snippet>;
  links: Record<string, string>;
}

/** every snippet and link for one app; the island lays them out, the tests check each one */
export function install(env: EnvId, o: InstallOptions, catalog: readonly InstallerOp[], os: Os = 'mac'): Install {
  const json = (label: string, code: string): Snippet => ({ label, name: 'the config', code, kind: 'json' });
  const skill: Snippet = { label: 'terminal (macOS and Linux)', name: 'the skill download command', code: SKILL_COMMAND, kind: 'shell' };
  switch (env) {
    case 'claude-code':
      return {
        snippets: {
          market: { label: 'claude code: step 1', name: 'step 1', code: PLUGIN_COMMANDS[0], kind: 'claude' },
          plugin: { label: 'claude code: step 2', name: 'step 2', code: PLUGIN_COMMANDS[1], kind: 'claude' },
          mcp: { label: 'terminal', name: 'the MCP server command', code: claudeCodeCommand(o, catalog), kind: 'shell' },
        },
        links: {},
      };
    case 'codex':
      return {
        snippets: {
          mcp: { label: 'terminal', name: 'the MCP server command', code: codexCommand(o, catalog), kind: 'shell' },
          toml: { label: '~/.codex/config.toml', name: 'the config.toml entry', code: codexToml(o, catalog), kind: 'toml' },
          skill,
        },
        links: {},
      };
    case 'gemini':
      return { snippets: { json: json('~/.gemini/settings.json', mcpServersJson(o, catalog)), skill }, links: {} };
    case 'claude-desktop':
      // the same config on every system: the server expands ~ itself, Windows included
      return { snippets: { json: json(`claude_desktop_config.json (${OS_NAMES[os]})`, mcpServersJson(o, catalog)) }, links: {} };
    case 'cursor':
      return { snippets: { json: json('mcp.json', cursorJson(o, catalog)) }, links: { cursor: cursorLink(o, catalog) } };
    case 'vscode':
      return { snippets: { json: json('.vscode/mcp.json', vscodeJson(o, catalog)) }, links: { vscode: vscodeLink(o, catalog) } };
    case 'windsurf':
      return { snippets: { json: json('mcp_config.json', mcpServersJson(o, catalog)) }, links: {} };
    case 'other':
      return { snippets: { json: json('mcp config (json)', mcpServersJson(o, catalog)) }, links: {} };
    case 'code':
      return {
        snippets: {
          install: { label: 'terminal', name: 'the install command', code: SDK_INSTALL, kind: 'shell' },
          example: { label: 'node.js', name: 'the example', code: SDK_EXAMPLE, kind: 'ts' },
          cli: { label: 'terminal', name: 'the command-line example', code: CLI_EXAMPLE, kind: 'shell' },
        },
        links: {},
      };
  }
}

/** the snippet the options change, which the customise panel repeats under them; null for the SDK */
export function mainSnippet(env: EnvId, out: Install): Snippet | null {
  if (env === 'code') return null;
  return out.snippets.mcp ?? out.snippets.json ?? null;
}

// ---- cost

/** bytes / 4 as a friendly number: to the nearest 50 under 1,000, else the nearest 100 */
export function friendlyTokens(bytes: number): number {
  const tokens = bytes / 4;
  return tokens < 1000 ? Math.max(50, Math.round(tokens / 50) * 50) : Math.round(tokens / 100) * 100;
}
export const formatNumber = (n: number) => n.toLocaleString('en-US');

const toolBytes = sizes.tools as Record<string, number>;
const helperBytes = Object.values(sizes.helpers as Record<string, number>).reduce((a, b) => a + b, 0);

/** the measured size of one tool's listing, or the average when a tool is newer than the measurement */
export function toolSize(slug: string): number {
  return toolBytes[slug] ?? averageToolBytes();
}
export function averageToolBytes(): number {
  const all = Object.values(toolBytes);
  return all.reduce((a, b) => a + b, 0) / all.length;
}

/**
 * The tools an install from this page can list: all but those that need @napi-rs/canvas (pdf-to-jpg). It's an
 * optional peer of the SDK that `npx -y @roundertools/mcp` never installs, so the server quietly leaves them out.
 */
export function installableOps<T extends { requires?: readonly string[] }>(ops: readonly T[]): T[] {
  return ops.filter((o) => !o.requires?.includes('canvas'));
}

/**
 * What the server's tool list and instructions take up at the start of every conversation, from sizes measured on the
 * published server (scripts/measure-mcp-tools.mjs). The catalog is what an npx install can list (installableOps);
 * video and audio tools are counted too, though they appear only when ffmpeg is installed, which the island says.
 */
export function upFrontBytes(o: InstallOptions, catalog: readonly InstallerOp[]): number {
  const slugs = selectedSlugs(o, catalog);
  // the server words its instructions by how much it lists: a few tools, some, or all of them
  const instructions = slugs.length >= catalog.length ? sizes.instructions.all : slugs.length <= 5 ? sizes.instructions.lean : sizes.instructions.some;
  return instructions + helperBytes + slugs.reduce((n, s) => n + toolSize(s), 0);
}

export function upFrontTokens(o: InstallOptions, catalog: readonly InstallerOp[]): number {
  return friendlyTokens(upFrontBytes(o, catalog));
}

/** whether any tool a selection lists needs ffmpeg, so the island can say those appear only when it's installed */
export function needsFfmpeg(o: InstallOptions, catalog: readonly InstallerOp[]): boolean {
  const slugs = new Set(selectedSlugs(o, catalog));
  return catalog.some((t) => slugs.has(t.slug) && !!t.requires?.includes('ffmpeg'));
}

/** about what each remembered favourite adds in lean mode */
export const FAVOURITE_TOKENS = friendlyTokens(averageToolBytes());

// ---- the URL hash, so a configured install can be shared

export interface InstallerState extends InstallOptions {
  env: EnvId;
}
export const DEFAULT_STATE: InstallerState = { env: 'claude-code', ...DEFAULT_OPTIONS };

/** #env=cursor&tools=pdf,image&allow=~/Documents&memory=off&experimental=on; the defaults are left out */
export function toHash(s: InstallerState, catalog: readonly InstallerOp[]): string {
  const p = new URLSearchParams();
  if (s.env !== DEFAULT_STATE.env) p.set('env', s.env);
  const tools = toolsValue(s, catalog);
  if (tools) p.set('tools', tools);
  for (const f of cleanFolders(s.allow)) p.append('allow', f);
  if (!s.memory) p.set('memory', 'off');
  if (s.experimental) p.set('experimental', 'on');
  // URLSearchParams escapes , / and ~, which are fine in a fragment and easier to read bare
  return p.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%7E/gi, '~');
}

/**
 * Reads a hash back; null when it isn't the installer's (a plain #section anchor). Anyone can write a link, so every
 * value is checked: unknown apps and tools fall back to the defaults, and folders a shell would read are dropped.
 */
export function fromHash(hash: string, catalog: readonly InstallerOp[]): InstallerState | null {
  const raw = hash.replace(/^#/, '');
  if (!raw.includes('=')) return null;
  const p = new URLSearchParams(raw);
  const known = ['env', 'tools', 'allow', 'memory', 'experimental'];
  if (![...p.keys()].some((k) => known.includes(k))) return null;
  const env = p.get('env');
  return {
    env: env && ENV_IDS.has(env) ? (env as EnvId) : DEFAULT_STATE.env,
    ...parseTools(p.get('tools') ?? '', catalog),
    allow: cleanFolders(p.getAll('allow')),
    memory: p.get('memory') !== 'off',
    experimental: p.get('experimental') === 'on',
  };
}

/** the tools the server's "default" leaves out: it lists what 0.1 did, everything but the checksum (packages/mcp server.ts) */
export const DEFAULT_SET_EXCLUDES: readonly string[] = ['checksum-calculator'];

/** a --tools value back into a preset, or a hand-picked list; words that name nothing are dropped */
export function parseTools(value: string, catalog: readonly InstallerOp[]): Pick<InstallOptions, 'preset' | 'picked'> {
  const words = value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (words.includes('all')) return { preset: 'all', picked: [] };
  const families = new Set<string>(FAMILIES);
  const picked = new Set<string>();
  for (const w of words) {
    if (families.has(w)) catalog.filter((t) => t.family === w).forEach((t) => picked.add(t.slug));
    else if (w === 'default') catalog.filter((t) => !DEFAULT_SET_EXCLUDES.includes(t.slug)).forEach((t) => picked.add(t.slug));
    else if (catalog.some((t) => t.slug === w)) picked.add(w);
  }
  if (!picked.size) return { preset: 'lean', picked: [] };
  if (words.length === 1 && families.has(words[0])) return { preset: words[0] as Family, picked: [] };
  return { preset: 'custom', picked: catalog.filter((t) => picked.has(t.slug)).map((t) => t.slug) };
}
