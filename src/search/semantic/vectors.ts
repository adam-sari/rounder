// Tool vectors, precomputed at build time: one vector for each tool's whole text and one for each short passage
// (name, slug, tagline, each keyword). A query scores 0.35 · doc + 0.65 · best passage, because short queries match
// short keywords. Stored as int8 with a scale per vector:
//   "TV01", tools, dim, passages (uint32 LE), uint16 owner[passages] (padded to 4), float32 scale[tools + passages],
//   int8 data[(tools + passages) × dim]
import type { StaticModel } from './model2vec';

export interface ToolText {
  doc: string;
  passages: string[];
}

export function encodeVectors(model: StaticModel, tools: ToolText[]): Uint8Array {
  const vecs = [...tools.map((t) => model.embed(t.doc)), ...tools.flatMap((t) => t.passages.map((p) => model.embed(p)))];
  const owners = tools.flatMap((t, i) => t.passages.map(() => i));
  const dim = model.dim;
  const ownerBytes = Math.ceil((owners.length * 2) / 4) * 4;
  const buf = new ArrayBuffer(16 + ownerBytes + vecs.length * 4 + vecs.length * dim);
  const view = new DataView(buf);
  [84, 86, 48, 49].forEach((c, i) => view.setUint8(i, c));
  view.setUint32(4, tools.length, true);
  view.setUint32(8, dim, true);
  view.setUint32(12, owners.length, true);
  new Uint16Array(buf, 16, owners.length).set(owners);
  const scales = new Float32Array(buf, 16 + ownerBytes, vecs.length);
  const data = new Int8Array(buf, 16 + ownerBytes + vecs.length * 4);
  vecs.forEach((v, r) => {
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const s = max / 127 || 1;
    scales[r] = s;
    for (let c = 0; c < dim; c++) data[r * dim + c] = Math.round(v[c] / s);
  });
  return new Uint8Array(buf);
}

export interface ToolVectors {
  tools: number;
  /** cosine of the query vector to every tool, multi-passage blend */
  scores(q: Float32Array): Float32Array;
}

export function decodeVectors(input: ArrayBuffer): ToolVectors {
  const view = new DataView(input);
  if (view.getUint32(0, true) !== 0x31305654) throw new Error('not a tool vectors file');
  const tools = view.getUint32(4, true);
  const dim = view.getUint32(8, true);
  const passages = view.getUint32(12, true);
  const ownerBytes = Math.ceil((passages * 2) / 4) * 4;
  const owners = new Uint16Array(input, 16, passages);
  const n = tools + passages;
  const scales = new Float32Array(input, 16 + ownerBytes, n);
  const data = new Int8Array(input, 16 + ownerBytes + n * 4, n * dim);
  const dot = (q: Float32Array, r: number) => {
    let s = 0;
    const o = r * dim;
    for (let c = 0; c < dim; c++) s += q[c] * data[o + c];
    return s * scales[r];
  };
  return {
    tools,
    scores(q) {
      const best = new Float32Array(tools).fill(-1);
      for (let p = 0; p < passages; p++) {
        const s = dot(q, tools + p);
        if (s > best[owners[p]]) best[owners[p]] = s;
      }
      const out = new Float32Array(tools);
      for (let t = 0; t < tools; t++) out[t] = 0.35 * dot(q, t) + 0.65 * best[t];
      return out;
    },
  };
}
