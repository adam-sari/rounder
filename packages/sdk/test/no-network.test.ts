import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const guard = join(import.meta.dirname, '../dist/no-network.mjs');
let hits = 0;
const server = createServer((_, res) => {
  hits++;
  res.end('reached');
});
let url = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => server.close());

/** runs a snippet in a fresh Node with the guard preloaded, and returns what it printed */
async function guarded(code: string) {
  const { stdout } = await run(process.execPath, ['--import', `file:///${guard.replaceAll('\\', '/').replace(/^\//, '')}`, '--input-type=module', '-e', code], { env: { ...process.env, URL_UNDER_TEST: url } });
  return stdout.trim();
}

const attempt = (expr: string) => `const url = process.env.URL_UNDER_TEST; try { await (${expr}); console.log('REACHED'); } catch (e) { console.log(e.code ?? e.name); }`;

describe('the no-network guard', () => {
  it.each([
    ['fetch', 'fetch(url)'],
    ['http.get', "import('node:http').then((h) => new Promise((res, rej) => { const q = h.get(url, res); q.on('error', rej); }))"],
    ['named http.request', "import('node:http').then(({ request }) => new Promise((res, rej) => { const q = request(url, res); q.on('error', rej); q.end(); }))"],
    ['https.get', "import('node:https').then((h) => h.get('https://example.com'))"],
    ['net.connect', "import('node:net').then((n) => n.connect(Number(new URL(url).port), '127.0.0.1'))"],
    ['tls.connect', "import('node:tls').then((t) => t.connect(443, 'example.com'))"],
    ['dgram', "import('node:dgram').then((d) => d.createSocket('udp4'))"],
    ['dns.lookup', "import('node:dns').then((d) => new Promise((res, rej) => d.lookup('example.com', (e) => (e ? rej(e) : res()))))"],
    ['dns.promises.resolve', "import('node:dns/promises').then((d) => d.resolve('example.com'))"],
    ['a worker thread', "import('node:worker_threads').then(({ Worker }) => new Promise((res, rej) => { const w = new Worker(\"fetch(process.env.URL_UNDER_TEST).then(() => process.getBuiltinModule('node:worker_threads').parentPort.postMessage('ok'), (e) => process.getBuiltinModule('node:worker_threads').parentPort.postMessage(e.code))\", { eval: true }); w.once('message', (m) => { w.terminate(); m === 'ok' ? res() : rej(Object.assign(new Error(m), { code: m })); }); }))"],
  ])('blocks %s', async (_, expr) => {
    const before = hits;
    expect(await guarded(attempt(expr))).toBe('ERR_ROUNDERTOOLS_NO_NETWORK');
    expect(hits).toBe(before);
  });

  it('leaves local work alone: files, child processes, the SDK itself', async () => {
    const out = await guarded("const { files } = await import('@roundertools/sdk'); const r = await files.checksum({ name: 'a', data: new TextEncoder().encode('abc') }); console.log(r.hashes['SHA-256'].slice(0, 8));");
    expect(out).toBe('ba7816bf');
  });
});
