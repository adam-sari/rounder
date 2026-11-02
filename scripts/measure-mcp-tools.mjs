// Measures what the MCP server costs an assistant up front: the size of each tool it lists (as JSON, the way a client
// receives it in tools/list) and of its instructions. The installer on /developers adds these up to show "about N tokens
// per conversation" for the tools you pick. Writes src/developers/mcp-tool-sizes.json. Re-run after changing a tool's
// description, options or the server's instructions:
//   npm run sdk:build
//   node scripts/measure-mcp-tools.mjs
// It needs ffmpeg and @napi-rs/canvas installed, or the video, audio and PDF-to-JPG tools aren't listed to measure; it
// stops without writing anything when a tool is missing, or when the built server is older than its source.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'packages/mcp/dist/bin.mjs');
const out = join(root, 'src/developers/mcp-tool-sizes.json');
const { version } = JSON.parse(readFileSync(join(root, 'packages/mcp/package.json'), 'utf8'));
const HELPERS = ['find-tool', 'describe-tool', 'run-tool'];

/** the newest modification time under a folder */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

// measuring an old build would write old sizes
const built = Math.min(statSync(bin).mtimeMs, statSync(join(root, 'packages/sdk/dist/index.mjs')).mtimeMs);
const changed = Math.max(newest(join(root, 'packages/sdk/src')), newest(join(root, 'packages/mcp/src')));
if (changed > built) {
  console.error('The SDK or MCP source is newer than its build. Run `npm run sdk:build` first.');
  process.exit(1);
}
const { ops } = await import(pathToFileURL(join(root, 'packages/sdk/dist/index.mjs')).href);

/** starts the server with these flags, asks for its instructions and tool list over stdio, then stops it */
async function list(flags) {
  // its own empty settings folder and --no-memory, so no saved settings or favourites change what's listed
  const scratch = mkdtempSync(join(tmpdir(), 'rt-measure-'));
  const child = spawn(process.execPath, [bin, '--allow', scratch, '--no-memory', ...flags], {
    cwd: scratch,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ROUNDERTOOLS_CONFIG_DIR: scratch },
  });
  const waiting = new Map();
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id != null && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let next = 1;
  const send = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error(`${method} timed out. Server said:\n${stderr}`)), 60_000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rounder-measure', version: '1' } });
    send('notifications/initialized');
    const tools = [];
    let cursor;
    do {
      const page = await call('tools/list', cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return { instructions: init.instructions ?? '', tools };
  } finally {
    // Windows keeps the folder busy while the server still runs in it, so wait for it to exit before removing it
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');

const all = await list(['--tools', 'all']);
// the instructions change with how much is listed: only the helpers (lean), some tools (families), or everything
const lean = await list(['--tools', 'lean']);
const some = await list(['--tools', 'pdf']);

const helpers = Object.fromEntries(HELPERS.map((name) => {
  const tool = all.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`the server didn't list ${name}`);
  return [name, bytes(tool)];
}));
const tools = Object.fromEntries(all.tools.filter((t) => !HELPERS.includes(t.name)).map((t) => [t.name, bytes(t)]));
if (lean.tools.length !== HELPERS.length) throw new Error(`lean listed ${lean.tools.map((t) => t.name).join(', ')}: expected only the helpers`);
// a tool the server didn't list (no ffmpeg or canvas here) would silently drop out of the estimates
const missing = ops.map((o) => o.slug).filter((slug) => !(slug in tools));
if (missing.length) {
  console.error(`The server didn't list ${missing.join(', ')}, so nothing was written. Install ffmpeg and @napi-rs/canvas and run it again.`);
  process.exit(1);
}

const sizes = {
  $comment: 'Written by scripts/measure-mcp-tools.mjs: bytes of each tool as JSON in tools/list, and of the instructions. Do not edit by hand.',
  version,
  instructions: { lean: Buffer.byteLength(lean.instructions), some: Buffer.byteLength(some.instructions), all: Buffer.byteLength(all.instructions) },
  helpers,
  tools,
};
writeFileSync(out, `${JSON.stringify(sizes, null, 2)}\n`);

const total = (list) => list.tools.reduce((n, t) => n + bytes(t), 0);
console.log(`${Object.keys(tools).length} tools measured → ${out}`);
console.log(`lean: ${total(lean)} bytes of tools + ${sizes.instructions.lean} of instructions`);
console.log(`all:  ${total(all)} bytes of tools + ${sizes.instructions.all} of instructions`);
