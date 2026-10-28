import { unzipSync, Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate';
import { createHasher, parseExpected, type Algo } from '@/tools/lib/checksum-calculator/algorithms';
import { toHex } from '@/tools/lib/checksum-calculator/block';
import { safeSegments } from '@/tools/lib/unzip/formats';
import { deflateLevel, freePath, isJunk, zipName, zipTime } from '@/tools/lib/zip-files/zip';
import { RounderError, throwIfAborted } from '../core/errors';
import type { Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type Ctx, type OpResult } from '../core/run';
import { formatSize, parseSize } from '../core/size';
import type * as ops from '../ops/files';

export async function zip(inputs: Source[], o: OptionsOut<typeof ops.zipFiles>, ctx: Ctx): Promise<OpResult> {
  const files: Zippable = {};
  const taken = new Set<string>();
  let bytesIn = 0;
  for (const [i, src] of inputs.entries()) {
    throwIfAborted(ctx.signal);
    ctx.progress({ stage: 'reading', done: i, total: inputs.length, note: src.name });
    if (isJunk(src.name)) continue;
    const path = freePath(src.name, taken);
    taken.add(path);
    const data = await src.bytes();
    bytesIn += data.length;
    files[path] = [data, { level: deflateLevel(o.level, src.name), mtime: zipTime(Date.now()) }];
  }
  if (!taken.size) throw new RounderError('invalid-options', 'Nothing to zip: every input was a system file (.DS_Store, Thumbs.db…).');
  ctx.progress({ stage: 'zipping' });
  const data = zipSync(files);
  const name = zipName(o.name ?? (inputs.length === 1 ? inputs[0].name.replace(/\.[^.]+$/, '') : 'archive'));
  return result({ files: [new FileOutput({ name, mime: 'application/zip', data, meta: { entries: taken.size, bytesIn } })] });
}

/**
 * Hostile archives are the norm, not the exception: entry names that climb out of the folder ("../", "C:\", "/etc"),
 * symlinks, and zip bombs. Names go through the site's safeSegments, symlink entries are skipped, and the total
 * unpacked size and entry count are capped before anything is written.
 */
export async function unzip(inputs: Source[], o: OptionsOut<typeof ops.unzipFiles>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const cap = o.maxTotal !== undefined ? parseSize(o.maxTotal) : Math.min(2e9, Math.max(bytes.length * 4, 50e6));
  const warnings: string[] = [];
  // first pass: names, attributes and declared sizes only, nothing inflated
  const entries: { name: string; size: number; symlink: boolean; dir: boolean }[] = [];
  const reader = new Unzip();
  reader.register(UnzipInflate);
  reader.onfile = (f) => {
    entries.push({ name: f.name, size: f.originalSize ?? 0, symlink: false, dir: f.name.endsWith('/') });
  };
  try {
    reader.push(bytes, true);
  } catch (e) {
    throw new RounderError('damaged', "This file couldn't be read as a ZIP archive. It may be damaged.", { cause: e });
  }
  if (!entries.length) throw new RounderError('damaged', "This file couldn't be read as a ZIP archive, or it's empty.");
  if (entries.length > o.maxEntries) throw new RounderError('unsupported-input', `This archive has ${entries.length} entries, more than the ${o.maxEntries} allowed.`, { hint: 'Raise maxEntries if you trust it.' });
  const declared = entries.reduce((n, e) => n + e.size, 0);
  if (declared > cap) throw new RounderError('unsupported-input', `This archive unpacks to ${formatSize(declared)}, over the ${formatSize(cap)} limit.`, { hint: 'Raise maxTotal if you trust it.' });
  for (const e of symlinks(bytes)) {
    const hit = entries.find((x) => x.name === e);
    if (hit) hit.symlink = true;
  }

  let total = 0;
  let central = 0;
  const files: FileOutput[] = [];
  const taken = new Set<string>();
  const out = unzipSync(bytes, {
    filter: (f) => {
      const e = entries.find((x) => x.name === f.name);
      if (!e || e.dir) return false;
      if (e.symlink) {
        warnings.push(`Skipped the link ${f.name}: archives can't create links here.`);
        return false;
      }
      // unzipSync sizes its buffers from the central directory, which can disagree with the local headers counted above
      central += f.originalSize;
      if (central > cap) throw new RounderError('unsupported-input', `This archive unpacks to more than the ${formatSize(cap)} limit.`, { hint: 'Raise maxTotal if you trust it.' });
      return true;
    },
  });
  for (const [name, data] of Object.entries(out)) {
    throwIfAborted(ctx.signal);
    // declared sizes can lie: count what actually came out
    total += data.length;
    if (total > cap) throw new RounderError('unsupported-input', `This archive unpacks to more than the ${formatSize(cap)} limit.`, { hint: 'Raise maxTotal if you trust it.' });
    const parts = safeSegments(name);
    if (!parts) {
      warnings.push(`Skipped an entry with an unusable name: ${JSON.stringify(name)}.`);
      continue;
    }
    if (parts.join('/') !== name.replace(/\\/g, '/').replace(/^\.\//, '')) warnings.push(`Renamed ${JSON.stringify(name)} to ${parts.join('/')} so it stays inside the folder.`);
    const path = freePath(parts.join('/'), taken);
    taken.add(path);
    files.push(new FileOutput({ name: path, mime: 'application/octet-stream', data, meta: { entry: name } }));
  }
  return result({ files, warnings, data: { entries: files.length } });
}

/** names of entries whose Unix mode in the central directory says "symbolic link" */
function symlinks(b: Uint8Array): string[] {
  const out: string[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i + 46 <= b.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const madeBy = view.getUint16(i + 4, true) >> 8;
    const nameLen = view.getUint16(i + 28, true);
    const extraLen = view.getUint16(i + 30, true);
    const commentLen = view.getUint16(i + 32, true);
    const attrs = view.getUint32(i + 38, true);
    const name = new TextDecoder().decode(b.subarray(i + 46, i + 46 + nameLen));
    if (madeBy === 3 && ((attrs >>> 16) & 0o170000) === 0o120000) out.push(name);
    i += 45 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function checksum(inputs: Source[], o: OptionsOut<typeof ops.checksum>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const expected = o.expected ? parseExpected(o.expected) : null;
  if (o.expected && !expected) throw new RounderError('invalid-options', `"${o.expected}" doesn't look like a checksum.`);
  const algos = new Set<Algo>(o.algorithms);
  if (expected) algos.add(expected.algo);
  const hashes: Record<string, string> = {};
  const CHUNK = 4 * 1024 * 1024;
  for (const algo of algos) {
    const h = createHasher(algo);
    for (let at = 0; at < bytes.length; at += CHUNK) {
      throwIfAborted(ctx.signal);
      h.update(bytes.subarray(at, at + CHUNK));
    }
    hashes[algo] = toHex(h.digest());
  }
  const data: Record<string, unknown> = { file: src.name, size: bytes.length, hashes };
  const warnings: string[] = [];
  if (expected) {
    data.match = hashes[expected.algo] === expected.hex;
    data.expected = expected;
    if (!data.match) warnings.push(`The ${expected.algo} doesn't match: the file isn't the one the checksum belongs to, or it's damaged.`);
  }
  return result({ data, warnings });
}
