// Build-time search assets: the lean index and the tool vectors, both content-hashed so they cache forever.
// Server only (reads the vendored model from public/ with fs); src/pages/search/[file].ts serves them and Base.astro
// hands their URLs to the palette.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tools } from '@/tools/registry';
import { categoryById } from '@/tools/categories';
import { docTextOf, passagesOf, toSearchDoc } from './docs';
import { SEARCH_MODEL } from './manifest.generated';
import { loadModel, type StaticModel } from './semantic/model2vec';
import { encodeVectors } from './semantic/vectors';

export interface SearchManifest {
  index: string;
  vectors: string;
  model: string;
  vocab: string;
}

const hash8 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex').slice(0, 8);

/** the vendored model, read from public/models/search (written by scripts/vendor-search.mjs) */
export function vendoredModel(dir = join(process.cwd(), 'public/models/search')): StaticModel {
  const bin = readFileSync(join(dir, SEARCH_MODEL.model.file));
  const vocab = readFileSync(join(dir, SEARCH_MODEL.vocab.file), 'utf8');
  return loadModel(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, vocab);
}

export function toolVectors(model: StaticModel): Uint8Array {
  return encodeVectors(model, tools.map((t) => ({ doc: docTextOf(t), passages: passagesOf(t) })));
}

let built: { files: Map<string, { body: string | Uint8Array; type: string }>; manifest: SearchManifest } | undefined;

export function searchAssets() {
  if (built) return built;
  const index = JSON.stringify({
    docs: tools.map(toSearchDoc),
    categories: Object.fromEntries(Object.values(categoryById).map((c) => [c.id, c.name])),
  });
  const vectors = toolVectors(vendoredModel());
  const files = new Map<string, { body: string | Uint8Array; type: string }>([
    [`index-${hash8(index)}.json`, { body: index, type: 'application/json' }],
    [`vectors-${hash8(vectors)}.bin`, { body: vectors, type: 'application/octet-stream' }],
  ]);
  const [indexFile, vectorsFile] = [...files.keys()];
  built = {
    files,
    manifest: {
      index: `/search/${indexFile}`,
      vectors: `/search/${vectorsFile}`,
      model: `/models/search/${SEARCH_MODEL.model.file}`,
      vocab: `/models/search/${SEARCH_MODEL.vocab.file}`,
    },
  };
  return built;
}
