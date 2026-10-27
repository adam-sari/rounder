// Copies the AI runtimes (onnxruntime-web builds, tesseract.js worker + core) into public/vendor,
// so no runtime code is ever fetched from a CDN. Every onnxruntime-web copy in node_modules gets
// its own versioned folder, because transformers.js and kokoro-js each pin their own build and
// the JS glue must match its .wasm exactly.
// Cloudflare Pages rejects files over 25 MB, so bigger .wasm files are split into parts that
// src/engines/ai/runtime.ts fetches, joins and checks against the SHA-256 again.
// Writes src/engines/ai/vendor.generated.ts (versions, file sizes, parts) for the client. Idempotent.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const LIMIT = 24 * 1024 * 1024;
const PART_BYTES = 18 * 1024 * 1024;

const ORT = 'ort-wasm-simd-threaded';
/**
 * ort          top-level onnxruntime-web, loaded at runtime from /vendor by createOrtSession() and
 *              handed to demucs-web: the WebGPU build (asyncify) and the smaller CPU-only build.
 * transformers the build @huggingface/transformers imports ('onnxruntime-web/webgpu' → asyncify), plus the
 *              plain build it switches to on Safari < 26 without WebGPU.
 * jsep         onnxruntime-web 1.22, the build inside kokoro-js's bundled transformers 3, with the older
 *              JSEP WebGPU backend. kokoro-js uses its wasm; models whose registry entry says
 *              gpu: 'jsep' run on all of it (the newer WebGPU EP gets them wrong or can't run them).
 */
const runtimes = [
  {
    name: 'ort',
    pkg: ['onnxruntime-web'],
    files: ['ort.webgpu.min.mjs', 'ort.wasm.min.mjs', `${ORT}.asyncify.mjs`, `${ORT}.asyncify.wasm`, `${ORT}.mjs`, `${ORT}.wasm`],
  },
  {
    name: 'transformers',
    pkg: ['@huggingface/transformers/node_modules/onnxruntime-web', 'onnxruntime-web'],
    files: [`${ORT}.asyncify.mjs`, `${ORT}.asyncify.wasm`, `${ORT}.mjs`, `${ORT}.wasm`],
  },
  { name: 'jsep', pkg: ['kokoro-js/node_modules/onnxruntime-web', 'onnxruntime-web'], files: ['ort.webgpu.min.mjs', `${ORT}.jsep.mjs`, `${ORT}.jsep.wasm`] },
];

const exists = (p) => stat(p).then(() => true, () => false);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let written = 0;

/** Writes only when the bytes differ, so dev servers don't see churn */
async function put(path, data) {
  const old = await readFile(path).catch(() => null);
  if (old && old.equals(Buffer.from(data))) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  written++;
}

/** Copies one file into dir, splitting it when it's over the Pages limit; returns its manifest entry */
async function vendorFile(src, dir, name) {
  const buf = await readFile(src);
  const entry = { bytes: buf.length, sha256: sha256(buf) };
  if (buf.length <= LIMIT) {
    await put(join(dir, name), buf);
    return entry;
  }
  entry.parts = [];
  for (let i = 0, at = 0; at < buf.length; i++, at += PART_BYTES) {
    const part = buf.subarray(at, at + PART_BYTES);
    await put(join(dir, `${name}.part${i}`), part);
    entry.parts.push({ name: `${name}.part${i}`, bytes: part.length });
  }
  return entry;
}

const manifest = {};
const keep = new Set();

for (const rt of runtimes) {
  let pkgDir;
  for (const p of rt.pkg) if (!pkgDir && (await exists(join(nm, p, 'package.json')))) pkgDir = join(nm, p);
  if (!pkgDir) throw new Error(`vendor-ai: ${rt.pkg[0]} is not installed`);
  const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
  const dir = join(root, 'public/vendor/ort', version);
  keep.add(version);
  const files = {};
  for (const f of rt.files) files[f] = await vendorFile(join(pkgDir, 'dist', f), dir, f);
  manifest[rt.name] = { version, base: `/vendor/ort/${version}/`, files };
}

// several runtimes can share a version folder; drop folders and parts nothing refers to any more
const ortRoot = join(root, 'public/vendor/ort');
for (const name of await readdir(ortRoot)) if (!keep.has(name)) await rm(join(ortRoot, name), { recursive: true, force: true });
for (const version of keep) {
  const wanted = new Set(
    Object.values(manifest)
      .filter((m) => m.version === version)
      .flatMap((m) => Object.entries(m.files).flatMap(([f, e]) => e.parts?.map((p) => p.name) ?? [f])),
  );
  for (const name of await readdir(join(ortRoot, version))) if (!wanted.has(name)) await rm(join(ortRoot, version, name));
}

// tesseract.js: the worker script plus every core build (it picks plain/SIMD/relaxed-SIMD, LSTM-only or not)
const tess = JSON.parse(await readFile(join(nm, 'tesseract.js/package.json'), 'utf8')).version;
const tessDir = join(root, 'public/vendor/tesseract', tess);
await put(join(tessDir, 'worker.min.js'), await readFile(join(nm, 'tesseract.js/dist/worker.min.js')));
for (const f of await readdir(join(nm, 'tesseract.js-core'))) {
  if (f.endsWith('.wasm.js')) await put(join(tessDir, 'core', f), await readFile(join(nm, 'tesseract.js-core', f)));
}
const tessRoot = join(root, 'public/vendor/tesseract');
for (const name of await readdir(tessRoot)) if (name !== tess) await rm(join(tessRoot, name), { recursive: true, force: true });
manifest.tesseract = { version: tess, base: `/vendor/tesseract/${tess}/` };

const ts = `// Generated by scripts/vendor-ai.mjs from node_modules. Do not edit.
export const VENDOR = ${JSON.stringify(manifest, null, 2)} as const;
`;
await put(join(root, 'src/engines/ai/vendor.generated.ts'), ts);

const summary = Object.entries(manifest).map(([k, m]) => `${k} ${m.version}`).join(', ');
console.log(written ? `vendor-ai: wrote ${written} file(s) (${summary})` : `vendor-ai: up to date (${summary})`);
