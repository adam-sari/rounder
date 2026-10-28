import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/*
 * Which files the MCP server may touch. Configuration decides (--allow flags or ROUNDERTOOLS_ALLOW); a client's roots
 * can only narrow that, never widen it. Without configuration it may read inside the home folder and the project
 * folder it was started in. Either way it never reads dot-folders, dot-files or known secret stores, and it writes
 * only next to an input or into the --out folder.
 */

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

/** folders that hold keys, tokens, passwords or browser data, wherever they sit (matched case-insensitively) */
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.gpg', '.azure', '.kube', '.docker', '.config', '.local', '.npmrc', '.git', 'appdata', 'application support', 'keychains', 'library/cookies', 'library/safari', '.password-store', '.mozilla', '.thunderbird', 'google/chrome', 'bravesoftware', 'microsoft/edge'];
const SECRET_FILES = [/^\.env/i, /\.kdbx?$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i, /\.(pem|key|p12|pfx|keychain|keychain-db)$/i, /^(credentials|known_hosts|authorized_keys)$/i, /^login data$/i, /^cookies(\.sqlite)?$/i, /^ntuser\.dat/i];

const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

export function inside(child: string, parent: string): boolean {
  const rel = relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** the folders that aren't a sensible project folder to open up: the file-system root, home itself, system folders */
function isSystemDir(dir: string): boolean {
  const { root } = parse(dir);
  if (norm(dir) === norm(root) || norm(dir) === norm(homedir())) return true;
  const system = process.platform === 'win32' ? [process.env.SystemRoot ?? 'C:\\Windows', process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', process.env.ProgramData ?? 'C:\\ProgramData'] : ['/usr', '/etc', '/bin', '/sbin', '/var', '/System', '/Library', '/opt', '/private', '/dev', '/proc'];
  return system.some((s) => inside(dir, s));
}

/** the real path, with symlinks resolved through the deepest folder that exists (the rest may not exist yet) */
const real = (p: string): string => {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    const up = dirname(abs);
    return up === abs ? abs : join(real(up), basename(abs));
  }
};

export interface AccessConfig {
  /** --allow folders, plus ROUNDERTOOLS_ALLOW */
  allow: string[];
  /** --out: a folder results may be written to, besides next to their inputs */
  out?: string;
  /** the folder the server started in (Claude Code starts it in the project) */
  cwd?: string;
}

export class Access {
  readonly roots: string[];
  readonly out?: string;
  readonly configured: boolean;
  #narrow: string[] | null = null;
  /** the roots as configured and as resolved, for the check that runs before the file system is touched */
  #lexical: string[];
  #lexicalOut: string[];

  constructor(c: AccessConfig) {
    this.configured = c.allow.length > 0;
    const dirs = this.configured ? c.allow : [homedir(), ...(c.cwd && !isSystemDir(resolve(c.cwd)) ? [c.cwd] : [])];
    const present = dirs.map((d) => resolve(d)).filter((d) => existsSync(d));
    this.roots = [...new Set(present.map(real))];
    this.out = c.out ? real(c.out) : undefined;
    this.#lexical = [...present, ...this.roots];
    this.#lexicalOut = c.out && this.out ? [resolve(c.out), this.out] : [];
  }

  /** the client's roots, as absolute paths; they only narrow what configuration allows */
  setClientRoots(paths: string[] | null) {
    // only roots inside what's allowed are looked up on disk: a file://server/share root would otherwise reach the network
    this.#narrow = paths && paths.length ? paths.map((p) => resolve(p)).map((p) => (this.#lexical.some((r) => inside(p, r)) ? real(p) : p)) : null;
  }

  describe(): string {
    const read = this.roots.join(', ') || '(nothing)';
    return `reads inside ${read}${this.configured ? '' : ' (no --allow given)'}${this.#narrow ? `, narrowed to the client's roots ${this.#narrow.join(', ')}` : ''}; never dot-folders or secret stores; writes next to inputs${this.out ? ` or into ${this.out}` : ''}`;
  }

  #allowedRoot(path: string): string | undefined {
    const root = this.roots.find((r) => inside(path, r));
    if (!root) return undefined;
    if (this.#narrow && !this.#narrow.some((n) => inside(path, n))) return undefined;
    return root;
  }

  /**
   * Runs before any file-system call: the path, as written, must sit inside an allowed folder. On Windows even an
   * existence check on \\server\share opens an SMB connection (sending the user's credentials), and it would also tell a
   * caller which files exist anywhere on disk.
   */
  #lexicalCheck(abs: string, write: boolean) {
    if ([...this.#lexical, ...(write ? this.#lexicalOut : [])].some((r) => inside(abs, r))) return;
    const where = [...this.roots, ...(write && this.out ? [this.out] : [])].join(', ') || 'none';
    throw new AccessError(`${abs} is outside the folders this server may ${write ? 'write to' : 'read'} (${where}). Start it with --allow <folder> to add one.`);
  }

  /** a path a tool call names as its output: absolute and inside the allowed folders, checked before anything looks at it on disk */
  checkTarget(target: string): string {
    if (!isAbsolute(target)) throw new AccessError(`"${target}" isn't an absolute path.`);
    const abs = resolve(target);
    this.#lexicalCheck(abs, true);
    return abs;
  }

  #secret(path: string, root: string) {
    const below = relative(root, path).split(sep).filter(Boolean);
    if (below.some((s) => s.startsWith('.'))) return true;
    // case-insensitive on every system: macOS volumes are too ("Library/Application Support")
    const lower = path.toLowerCase().replaceAll('\\', '/');
    for (const d of SECRET_DIRS) if (lower.includes(`/${d}/`) || lower.endsWith(`/${d}`)) return true;
    return SECRET_FILES.some((re) => re.test(basename(path)));
  }

  /** an input path: absolute, existing, a file, inside an allowed folder (after symlinks), not a secret */
  checkRead(input: string): string {
    if (!isAbsolute(input)) throw new AccessError(`"${input}" isn't an absolute path. Pass full paths; the server's working folder isn't yours.`);
    // the file system only ever sees the path that was checked
    const abs = resolve(input);
    this.#lexicalCheck(abs, false);
    if (!existsSync(abs)) throw new AccessError(`${input} doesn't exist.`);
    const path = real(abs);
    const root = this.#allowedRoot(path);
    if (!root) throw new AccessError(`${input} is outside the folders this server may read (${this.roots.join(', ')}). Start it with --allow <folder> to add one.`);
    if (this.#secret(path, root)) throw new AccessError(`${input} is in a hidden folder or looks like a secret (keys, passwords, browser data), which this server never reads.`);
    if (!statSync(path).isFile()) throw new AccessError(`${input} isn't a file.`);
    return path;
  }

  /**
   * Where a result may go: next to one of the inputs, or into --out; never an existing input. `under` is a folder made
   * next to an input (unzip's "archive/" folder), and the result may sit anywhere inside it.
   */
  checkWrite(target: string, inputs: string[], under?: string): string {
    const abs = this.checkTarget(target);
    const parent = real(dirname(abs));
    const path = join(parent, basename(abs));
    const near = under ? real(under) : parent;
    const nextToInput = inputs.some((i) => norm(dirname(i)) === norm(under ? dirname(near) : parent)) && (!under || inside(parent, near));
    const intoOut = this.out && inside(parent, this.out);
    if (!nextToInput && !intoOut) throw new AccessError(`Results go next to an input${this.out ? ` or into ${this.out}` : ''}; ${dirname(abs)} is neither. ${this.out ? '' : 'Start the server with --out <folder> to allow another folder.'}`.trim());
    const root = this.#allowedRoot(parent) ?? (intoOut ? this.out! : undefined);
    if (!root) throw new AccessError(`${dirname(abs)} is outside the folders this server may use.`);
    if (this.#secret(path, root)) throw new AccessError(`${abs} is in a hidden folder or looks like a secret file.`);
    if (inputs.some((i) => norm(i) === norm(path))) throw new AccessError("The output can't be one of the inputs: inputs are never overwritten.");
    return path;
  }
}

/** --allow values and ROUNDERTOOLS_ALLOW (a path list, like PATH) */
export function allowList(flags: string[], env = process.env.ROUNDERTOOLS_ALLOW): string[] {
  const home = homedir();
  const expand = (p: string) => (p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? join(home, p.slice(2)) : p);
  return [...flags, ...(env ? env.split(delimiter) : [])].map((p) => p.trim()).filter(Boolean).map(expand);
}
