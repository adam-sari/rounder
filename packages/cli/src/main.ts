import { existsSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { glob } from 'tinyglobby';
import {
  FileOutput as Output,
  isRounderError,
  resolveTool,
  RounderError,
  unknownTool,
  run,
  version,
  webLink,
  type FileInput,
  type FileOutput,
  type OpResult,
  type OpSpec,
} from '@roundertools/sdk';
import { coerce, COMMON, fieldsOf } from './args';
import { doctor, help, list, mainHelp } from './help';

export const EXIT = { ok: 0, failed: 1, usage: 2, partial: 3, dependency: 4, target: 5, password: 6, interrupted: 130 } as const;

/** error code → exit code, as documented in the README */
export function exitFor(code: string): number {
  if (code === 'invalid-options') return EXIT.usage;
  if (code === 'missing-dependency') return EXIT.dependency;
  if (code === 'needs-password' || code === 'wrong-password') return EXIT.password;
  if (code === 'target-not-met') return EXIT.target;
  if (code === 'aborted') return EXIT.interrupted;
  return EXIT.failed;
}

export interface Io {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream & { isTTY?: boolean };
  stdin: NodeJS.ReadableStream;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

const line = (s: NodeJS.WritableStream, text = '') => s.write(`${text}\n`);

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') return line(io.stdout, mainHelp()), EXIT.ok;
  if (command === '--version' || command === '-v') return line(io.stdout, version), EXIT.ok;
  if (command === 'list') return list(rest, io);
  if (command === 'help') return rest[0] ? help(rest[0], io) : (line(io.stdout, mainHelp()), EXIT.ok);
  if (command === 'doctor') return doctor(rest, io);
  if (command === 'mcp') return mcp(rest, io);
  if (command === 'suggest') {
    line(io.stdout, `Search all tools: https://roundertools.com/?q=${encodeURIComponent(rest.join(' '))}`);
    line(io.stdout, 'Or run `roundertools list` to see what the CLI can do.');
    return EXIT.ok;
  }
  return tool(command, rest, io);
}

async function mcp(args: string[], io: Io): Promise<number> {
  try {
    const mod = (await import('@roundertools/mcp' as string)) as { main(argv: string[]): Promise<void> };
    await mod.main(args);
    return EXIT.ok;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw e;
    line(io.stderr, 'The MCP server is a separate package. Run it with:');
    line(io.stderr, `  npx -y @roundertools/mcp ${args.join(' ')}`.trimEnd());
    return EXIT.dependency;
  }
}

interface Job {
  input: string;
  inputs: FileInput[];
}

interface Written {
  path: string;
  bytes: number;
  mime: string;
  meta: Record<string, unknown>;
}

interface ResultLine {
  input: string;
  output?: string;
  outputs: Written[];
  bytesIn: number;
  bytesOut: number;
  ratio?: number;
  meta: Record<string, unknown>;
  warnings: string[];
  text?: string;
  data?: Record<string, unknown>;
}

const GLOB = /[*?[\]{}]/;

/** expands globs (the same on Windows and POSIX), and folders when --recursive; "-" is stdin */
async function expandInputs(patterns: string[], spec: OpSpec, recursive: boolean, cwd: string): Promise<string[]> {
  const out: string[] = [];
  for (const p of patterns) {
    if (p === '-') {
      out.push('-');
      continue;
    }
    const abs = resolve(cwd, p);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      if (!recursive) throw new RounderError('invalid-options', `${p} is a folder. Pass --recursive to process the files in it.`);
      const exts = spec.inputs.accept.includes('*') ? '*' : `{${spec.inputs.accept.join(',')}}`;
      const found = await glob(`**/*.${exts}`, { cwd: abs, absolute: true, caseSensitiveMatch: false, dot: false });
      out.push(...found.sort());
    } else if (GLOB.test(p) && !existsSync(abs)) {
      // the folders before the first wildcard are literal: "My Files (2024)/*.pdf" mustn't read "(2024)" as glob syntax
      const parts = p.replaceAll('\\', '/').split('/');
      const at = parts.findIndex((s) => GLOB.test(s));
      const base = resolve(cwd, parts.slice(0, at).join('/') || '.');
      const pattern = parts.slice(at).join('/').replace(/[()!+@]/g, '\\$&');
      const found = await glob(pattern, { cwd: base, absolute: true, dot: false, expandDirectories: false });
      if (!found.length) throw new RounderError('invalid-options', `Nothing matches ${p}.`);
      out.push(...found.sort());
    } else out.push(abs);
  }
  return out.map((p) => (p === '-' ? p : resolve(p)));
}

async function readStdin(stdin: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  return new Uint8Array(Buffer.concat(chunks));
}

/** "report.pdf" taken → "report (2).pdf" */
function freeName(path: string, taken: Set<string>): string {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  let out = path;
  for (let n = 2; taken.has(out.toLowerCase()) || existsSync(out); n++) out = `${stem} (${n})${ext}`;
  return out;
}

async function tool(slug: string, args: string[], io: Io): Promise<number> {
  const resolved = resolveTool(slug);
  if (!resolved) {
    line(io.stderr, `roundertools: ${unknownTool(slug).message}`);
    return EXIT.usage;
  }
  const { spec } = resolved;
  const fields = fieldsOf(spec);
  const options: ParseArgsConfig['options'] = { ...COMMON };
  for (const f of fields) {
    options[f.flag] = { type: f.kind === 'boolean' ? 'boolean' : 'string', multiple: f.kind === 'list' };
    const short = spec.short?.[f.key as keyof typeof spec.short];
    if (short) options[f.flag].short = short;
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    line(io.stderr, `roundertools ${spec.slug}: ${(e as Error).message.replace(/^.*?: /, '')}`);
    line(io.stderr, `Run \`roundertools help ${slug}\` for its options.`);
    return EXIT.usage;
  }
  const v = parsed.values as Record<string, string | boolean | string[] | undefined>;
  if (v.help) return help(slug, io);
  const machine = v.json ? 'json' : v.ndjson ? 'ndjson' : null;
  const opts: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = v[f.flag];
    if (raw !== undefined) opts[f.key] = coerce(f, raw);
  }
  // passwords from the environment, so they stay out of shell history
  if ('password' in spec.options.shape && opts.password === undefined && io.env.ROUNDERTOOLS_PASSWORD) opts.password = io.env.ROUNDERTOOLS_PASSWORD;

  const started = Date.now();
  const results: ResultLine[] = [];
  const errors: { input: string; code: string; message: string; hint?: string }[] = [];
  const emit = (o: object) => machine === 'ndjson' && line(io.stdout, JSON.stringify(o));
  const tty = !!io.stderr.isTTY && !machine && !v.quiet;
  const say = (text: string) => !machine && !v.quiet && line(io.stderr, text);

  let inputs: string[];
  try {
    inputs = await expandInputs(parsed.positionals, spec, !!v.recursive, io.cwd);
    if (inputs.length < spec.inputs.min) throw new RounderError('invalid-options', `${spec.slug} needs ${spec.inputs.min === 1 ? 'an input file' : `at least ${spec.inputs.min} input files`}.`);
    if (inputs.filter((i) => i === '-').length > 1) throw new RounderError('invalid-options', 'Only one input can be "-" (stdin).');
  } catch (e) {
    return finishError(e, slug, io, machine);
  }

  const stdinBytes = inputs.includes('-') ? await readStdin(io.stdin) : undefined;
  const toInput = (p: string): FileInput => (p === '-' ? { name: `stdin${spec.inputs.accept[0] && spec.inputs.accept[0] !== '*' ? `.${spec.inputs.accept[0]}` : ''}`, data: stdinBytes! } : p);
  const jobs: Job[] = spec.inputs.mode === 'all' ? [{ input: inputs.join(', '), inputs: inputs.map(toInput) }] : inputs.map((p) => ({ input: p, inputs: [toInput(p)] }));

  const out = typeof v.output === 'string' ? v.output : undefined;
  const toStdout = out === '-';
  const outIsDir = !!out && !toStdout && (/[\\/]$/.test(out) || (existsSync(resolve(io.cwd, out)) && statSync(resolve(io.cwd, out)).isDirectory()));
  if (out && !toStdout && !outIsDir && jobs.length > 1) return finishError(new RounderError('invalid-options', '-o names one file, but there are several inputs. End it with a slash to write into a folder.'), slug, io, machine);
  const taken = new Set<string>();
  const inputPaths = new Set(inputs.filter((i) => i !== '-').map((i) => i.toLowerCase()));

  /** where one result file goes; never over an input, never over an existing file without --overwrite */
  const destination = (job: Job, file: FileOutput, count: number): string => {
    const base = job.inputs.length === 1 && typeof job.inputs[0] === 'string' ? dirname(job.inputs[0]) : io.cwd;
    let path: string;
    if (out && !outIsDir) {
      if (count > 1) throw new RounderError('invalid-options', `${spec.slug} makes several files; give -o a folder (ending in a slash).`);
      path = resolve(io.cwd, out);
      if (inputPaths.has(path.toLowerCase())) throw new RounderError('invalid-options', "The output can't be one of the inputs: Rounder never overwrites an input.");
      if (existsSync(path) && !v.overwrite) throw new RounderError('exists', `${path} already exists.`, { hint: 'Pick another name, or pass --overwrite.' });
      return path;
    }
    const dir = out ? resolve(io.cwd, out) : spec.slug === 'unzip-files' && typeof job.inputs[0] === 'string' ? join(base, basename(job.inputs[0], extname(job.inputs[0]))) : base;
    path = resolve(dir, file.name);
    if (relative(dir, path).startsWith('..') || isAbsolute(relative(dir, path))) throw new RounderError('failed', `Refused to write outside ${dir}: ${file.name}`);
    if (inputPaths.has(path.toLowerCase()) || (!v.overwrite && existsSync(path)) || taken.has(path.toLowerCase())) path = freeName(path, taken);
    return path;
  };

  const concurrency = Math.max(1, Number(v.concurrency) || (spec.family === 'media' ? 1 : Math.min(4, Math.max(1, cpus().length - 1))));
  const controller = new AbortController();
  io.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let progressShown = false;

  const runJob = async (job: Job) => {
    const label = job.inputs.length === 1 && typeof job.inputs[0] === 'string' ? basename(job.inputs[0]) : job.input === '-' ? 'stdin' : `${job.inputs.length} files`;
    try {
      const r: OpResult = await run(slug, job.inputs, opts, {
        signal: controller.signal,
        onProgress: (p) => {
          emit({ type: 'progress', input: job.input, ...p });
          if ((tty || v.progress) && concurrency === 1) {
            const pct = p.ratio !== undefined ? ` ${Math.round(p.ratio * 100)}%` : p.total ? ` ${p.done ?? 0}/${p.total}` : '';
            io.stderr.write(`\r\x1b[2K${label}: ${p.stage}${pct}`);
            progressShown = true;
          }
        },
      });
      if (progressShown) io.stderr.write('\r\x1b[2K');
      // text with -o goes to a file named after the input
      if (r.text !== undefined && out) {
        const name = `${basename(job.input, extname(job.input))}.${opts.format === 'markdown' ? 'md' : 'txt'}`;
        r.files.push(new Output({ name, mime: 'text/plain', data: new TextEncoder().encode(r.text) }));
      }
      const written: Written[] = [];
      if (toStdout) {
        if (r.files.length !== 1) throw new RounderError('invalid-options', `-o - needs exactly one result, and ${spec.slug} made ${r.files.length}.`);
        io.stdout.write(r.files[0].data);
        written.push({ path: '-', bytes: r.files[0].size, mime: r.files[0].mime, meta: r.files[0].meta });
      } else {
        for (const f of r.files) {
          const path = destination(job, f, r.files.length);
          taken.add(path.toLowerCase());
          await f.save(path, { overwrite: !!v.overwrite });
          await f.dispose();
          written.push({ path, bytes: f.size, mime: f.mime, meta: f.meta });
        }
      }
      const bytesIn = await sizeOf(job.inputs, stdinBytes);
      const bytesOut = written.reduce((n, w) => n + w.bytes, 0);
      const meta = r.files.length === 1 ? r.files[0].meta : {};
      const res: ResultLine = { input: job.input, output: written[0]?.path, outputs: written, bytesIn, bytesOut, ratio: written.length ? Math.round((bytesOut / Math.max(1, bytesIn)) * 1000) / 1000 : undefined, meta, warnings: r.warnings };
      if (r.text !== undefined) res.text = r.text;
      if (r.data) res.data = r.data;
      results.push(res);
      emit({ type: 'result', ...res });
      if (!machine) {
        if (r.text !== undefined && !out) {
          io.stdout.write(r.text);
        } else if (r.data && !written.length) {
          line(io.stdout, jobs.length > 1 ? `${label}: ${JSON.stringify(r.data)}` : JSON.stringify(r.data, null, 2));
        } else if (!v.quiet) {
          for (const w of written) say(`${label} → ${w.path === '-' ? 'stdout' : relative(io.cwd, w.path) || w.path} (${human(w.bytes)}${written.length === 1 && bytesIn ? `, ${change(bytesIn, w.bytes)}` : ''})`);
        }
        for (const w of r.warnings) say(`  note: ${w}`);
      }
      if (v.strict && meta.fits === false) throw new RounderError('target-not-met', `${label}: the result is over the target.`);
    } catch (e) {
      if (progressShown) io.stderr.write('\r\x1b[2K');
      const err = isRounderError(e) ? e : new RounderError('failed', (e as Error)?.message ?? String(e));
      errors.push({ input: job.input, code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) });
      emit({ type: 'error', input: job.input, code: err.code, message: err.message, hint: err.hint });
      if (!machine) {
        line(io.stderr, `${label}: ${err.message}`);
        if (err.hint) line(io.stderr, `  ${err.hint}`);
        if (v.verbose && e instanceof Error && e.stack) line(io.stderr, e.stack);
      }
    }
  };

  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    for (let job = queue.shift(); job && !controller.signal.aborted; job = queue.shift()) await runJob(job);
  }));

  const interrupted = controller.signal.aborted;
  // a missed target under --strict still wrote its (smallest) result; only real failures make a batch partial
  const failed = errors.filter((e) => e.code !== 'target-not-met');
  const missed = errors.length - failed.length;
  const code = interrupted ? EXIT.interrupted : !errors.length ? EXIT.ok : !failed.length ? EXIT.target : results.length > missed ? EXIT.partial : exitFor(failed[0].code);
  if (machine === 'json') {
    line(io.stdout, JSON.stringify({ schema: 1, ok: code === EXIT.ok, tool: spec.slug, version, results, errors, durationMs: Date.now() - started, web: webLink(spec, safeParse(spec, { ...resolved.preset, ...opts })) }));
  } else if (machine === 'ndjson') {
    emit({ type: 'summary', ok: code === EXIT.ok, tool: spec.slug, results: results.length, errors: errors.length, durationMs: Date.now() - started });
  } else if (jobs.length > 1) {
    say(`${results.length} done${errors.length ? `, ${errors.length} failed` : ''}.`);
  }
  return code;
}

const safeParse = (spec: OpSpec, o: Record<string, unknown>) => {
  const r = spec.options.safeParse(o);
  return r.success ? (r.data as Record<string, unknown>) : {};
};

async function sizeOf(inputs: FileInput[], stdin?: Uint8Array) {
  let n = 0;
  for (const i of inputs) n += typeof i === 'string' ? statSync(i).size : (stdin?.length ?? 0);
  return n;
}

function finishError(e: unknown, slug: string, io: Io, machine: string | null): number {
  const err = isRounderError(e) ? e : new RounderError('failed', (e as Error)?.message ?? String(e));
  if (machine === 'json') line(io.stdout, JSON.stringify({ schema: 1, ok: false, tool: slug, version, results: [], errors: [{ input: null, code: err.code, message: err.message, hint: err.hint }] }));
  else if (machine === 'ndjson') line(io.stdout, JSON.stringify({ type: 'error', code: err.code, message: err.message, hint: err.hint }));
  else {
    line(io.stderr, `roundertools ${slug}: ${err.message}`);
    if (err.hint) line(io.stderr, `  ${err.hint}`);
  }
  return exitFor(err.code);
}

function human(bytes: number) {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

function change(before: number, after: number) {
  const pct = Math.round((after / before - 1) * 100);
  return pct === 0 ? 'same size' : pct < 0 ? `${-pct}% smaller` : `${pct}% bigger`;
}

