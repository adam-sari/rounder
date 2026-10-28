import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEARCH_MODEL } from '@/search/manifest.generated';
import { toolVectors, vendoredModel } from '@/search/build';
import { decodeVectors, encodeVectors } from '@/search/semantic/vectors';
import { tools } from '@/tools/registry';

const model = vendoredModel();
const parity: { rows: { s: string; toks: string[]; emb: number[] }[] } = JSON.parse(readFileSync('tests/fixtures/search/model2vec-parity.json', 'utf8'));

describe('vendored model', () => {
  it('matches its manifest (pinned potion-base-2M, MIT)', () => {
    expect(SEARCH_MODEL.repo).toBe('minishlab/potion-base-2M');
    expect(SEARCH_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const f of [SEARCH_MODEL.model, SEARCH_MODEL.vocab]) {
      const buf = readFileSync(`public/models/search/${f.file}`);
      expect(buf.length).toBe(f.bytes);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(f.sha256);
    }
  });

  it('stays within its download budget', () => {
    expect(SEARCH_MODEL.model.bytes + SEARCH_MODEL.vocab.bytes).toBeLessThan(2_300_000);
    expect(toolVectors(model).length).toBeLessThan(300_000);
  });
});

describe('WordPiece and embeddings', () => {
  it('tokenize exactly like model2vec (which also drops unknown words before pooling)', () => {
    const diff = parity.rows.filter((r) => JSON.stringify(model.tokens(r.s)) !== JSON.stringify(r.toks.filter((t) => t !== '[UNK]'))).map((r) => r.s);
    expect(diff).toEqual([]);
  });

  it('embed like the fp32 model after int8 quantisation', () => {
    let min = 1;
    for (const r of parity.rows) {
      const v = model.embed(r.s);
      const cos = r.emb.reduce((s, x, i) => s + x * v[i], 0) / Math.hypot(...r.emb);
      min = Math.min(min, cos);
    }
    expect(min).toBeGreaterThan(0.99);
  });

  it('give nothing for an empty or unknown string, and unit vectors otherwise', () => {
    expect([...model.embed('')].every((x) => x === 0)).toBe(true);
    const v = model.embed('compress pdf');
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
  });
});

describe('tool vectors', () => {
  it('round-trip through the binary format', () => {
    const toy = [{ doc: 'compress a pdf', passages: ['compress pdf', 'shrink pdf'] }, { doc: 'merge pdf files', passages: ['merge pdf'] }];
    const bytes = encodeVectors(model, toy);
    const v = decodeVectors(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(v.tools).toBe(2);
    const s = v.scores(model.embed('make my pdf smaller'));
    expect(s[0]).toBeGreaterThan(s[1]);
  });

  it('cover every tool in registry order', () => {
    const bytes = toolVectors(model);
    expect(decodeVectors(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tools).toBe(tools.length);
  });

  it('reject other files', () => {
    expect(() => decodeVectors(new ArrayBuffer(32))).toThrow();
  });
});
