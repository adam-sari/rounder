// Model2Vec static embeddings with no runtime: BERT uncased WordPiece over the vocabulary, a lookup in the int8
// table, a sum and a normalise. The same code runs in the browser and in the build that precomputes tool vectors.

export interface StaticModel {
  dim: number;
  embed(text: string): Float32Array;
  /** the WordPiece tokens a text becomes (for parity tests) */
  tokens(text: string): string[];
}

/** BERT's basic tokenizer: lowercase, strip accents, split on whitespace and punctuation (Unicode P* and ASCII symbols) */
const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .flatMap((w) => w.split(/([\p{P}!-/:-@[-`{-~])/u))
    .filter(Boolean);

export function loadModel(bin: ArrayBuffer, vocabText: string): StaticModel {
  const head = new DataView(bin, 0, 12);
  if (String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3)) !== 'M2V1') throw new Error('not a search model');
  const rows = head.getUint32(4, true);
  const dim = head.getUint32(8, true);
  const scales = new Float32Array(bin, 12, rows);
  const data = new Int8Array(bin, 12 + rows * 4, rows * dim);
  const list = vocabText.split('\n');
  const vocab = new Map(list.map((t, i) => [t, i]));
  if (vocab.size !== rows) throw new Error('search model and vocabulary disagree');

  /** greedy longest-match WordPiece; a word with no full cover is unknown and skipped */
  function ids(text: string): number[] {
    const out: number[] = [];
    for (const w of words(text)) {
      if (w.length > 100) continue;
      const sub: number[] = [];
      let start = 0;
      while (start < w.length) {
        let end = w.length;
        let cur = -1;
        while (start < end) {
          const id = vocab.get((start > 0 ? '##' : '') + w.slice(start, end));
          if (id !== undefined) {
            cur = id;
            break;
          }
          end--;
        }
        if (cur < 0) {
          sub.length = 0;
          break;
        }
        sub.push(cur);
        start = end;
      }
      out.push(...sub);
    }
    return out;
  }

  return {
    dim,
    tokens: (text) => ids(text).map((i) => list[i]),
    embed(text) {
      const v = new Float32Array(dim);
      for (const id of ids(text)) {
        const s = scales[id];
        const o = id * dim;
        for (let c = 0; c < dim; c++) v[c] += data[o + c] * s;
      }
      let n = 0;
      for (let c = 0; c < dim; c++) n += v[c] * v[c];
      n = Math.sqrt(n) || 1;
      for (let c = 0; c < dim; c++) v[c] /= n;
      return v;
    },
  };
}
