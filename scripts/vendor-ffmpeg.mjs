// Copies the ffmpeg.wasm fallback into public/vendor/ffmpeg.
// Cloudflare Pages rejects files over 25 MB and ffmpeg-core.wasm is ~32 MB, so the wasm
// is split into parts; the browser fetches them, checks the SHA-256 and joins them again.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/vendor/ffmpeg');
const core = join(root, 'node_modules/@ffmpeg/core/dist/esm');
const ffmpegWorker = join(root, 'node_modules/@ffmpeg/ffmpeg/dist/esm');
const PART_BYTES = 18 * 1024 * 1024;

const corePkg = JSON.parse(await readFile(join(root, 'node_modules/@ffmpeg/core/package.json'), 'utf8'));
const wasm = await readFile(join(core, 'ffmpeg-core.wasm'));
const sha256 = createHash('sha256').update(wasm).digest('hex');

const manifestPath = join(out, 'manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse, () => null);
if (previous?.sha256 === sha256 && previous?.version === corePkg.version) {
  console.log(`vendor-ffmpeg: up to date (core ${corePkg.version})`);
  process.exit(0);
}

await mkdir(out, { recursive: true });
for (const name of await readdir(out)) if (name.startsWith('ffmpeg-core.wasm.part')) await rm(join(out, name));

const parts = [];
for (let i = 0, offset = 0; offset < wasm.length; i++, offset += PART_BYTES) {
  const chunk = wasm.subarray(offset, offset + PART_BYTES);
  const name = `ffmpeg-core.wasm.part${i}`;
  await writeFile(join(out, name), chunk);
  parts.push({ name, bytes: chunk.length });
}

await copyFile(join(core, 'ffmpeg-core.js'), join(out, 'ffmpeg-core.js'));
// the @ffmpeg/ffmpeg class worker, served as-is so bundlers never have to resolve it
for (const f of ['worker.js', 'const.js', 'errors.js']) await copyFile(join(ffmpegWorker, f), join(out, f));

const manifest = { version: corePkg.version, bytes: wasm.length, sha256, parts };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`vendor-ffmpeg: wrote core ${corePkg.version} as ${parts.length} parts (${(wasm.length / 1048576).toFixed(1)} MB)`);
