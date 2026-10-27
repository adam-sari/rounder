/*
 * Small ONNX graph fixes, applied to the model bytes before a session opens (see ModelSpec.patch).
 * Reads and writes just enough protobuf to swap nodes; everything else is copied byte for byte.
 */

/** one protobuf field: all of it is [from, end); a length-delimited payload is [start, end) */
interface Field {
  no: number;
  wire: number;
  from: number;
  start: number;
  end: number;
}

function* fields(b: Uint8Array, start: number, end: number): Generator<Field> {
  let p = start;
  const varint = () => {
    let v = 0;
    for (let shift = 1; ; shift *= 128) {
      const x = b[p++];
      v += (x & 127) * shift;
      if (x < 128) return v;
    }
  };
  while (p < end) {
    const from = p;
    const key = varint();
    const wire = key & 7;
    const len = wire === 2 ? varint() : 0;
    const start = p;
    if (wire === 0) varint();
    else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else if (wire === 2) p += len;
    else throw new Error(`unsupported protobuf wire type ${wire}`);
    yield { no: Math.floor(key / 8), wire, from, start, end: p };
  }
}

const utf8 = new TextDecoder();
const text = (b: Uint8Array, f: Field) => utf8.decode(b.subarray(f.start, f.end));
const encoder = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const concat = (parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const bytesField = (no: number, data: Uint8Array) => concat([varint(no * 8 + 2), varint(data.length), data]);
const stringField = (no: number, s: string) => bytesField(no, encoder.encode(s));

interface Node {
  field: Field;
  op: string;
  name: string;
  inputs: string[];
  outputs: string[];
  /** attribute fields, verbatim */
  attrs: Uint8Array[];
}

function readNode(b: Uint8Array, f: Field): Node {
  const node: Node = { field: f, op: '', name: '', inputs: [], outputs: [], attrs: [] };
  for (const x of fields(b, f.start, f.end)) {
    if (x.no === 1) node.inputs.push(text(b, x));
    else if (x.no === 2) node.outputs.push(text(b, x));
    else if (x.no === 3) node.name = text(b, x);
    else if (x.no === 4) node.op = text(b, x);
    else if (x.no === 5) node.attrs.push(b.subarray(x.from, x.end));
  }
  return node;
}

/** int64 values of a TensorProto (raw_data or int64_data); null for other types */
function int64s(b: Uint8Array, f: Field): number[] | null {
  for (const x of fields(b, f.start, f.end)) {
    if (x.no === 2 && x.wire === 0 && b[x.start] !== 7) return null;
    if (x.no === 9) {
      const raw = b.slice(x.start, x.end);
      return [...new BigInt64Array(raw.buffer, 0, raw.length / 8)].map(Number);
    }
    if (x.no === 7) {
      if (x.wire !== 2) return null;
      const out: number[] = [];
      let p = x.start;
      while (p < x.end) {
        let v = 0;
        for (let shift = 1; ; shift *= 128) {
          const c = b[p++];
          v += (c & 127) * shift;
          if (c < 128) break;
        }
        out.push(v);
      }
      return out;
    }
  }
  return null;
}

/** a 1-D int64 TensorProto, values packed in int64_data (so no raw bytes to align) */
const int64Tensor = (name: string, values: number[]) =>
  concat([varint(1 * 8), varint(values.length), varint(2 * 8), varint(7), stringField(8, name), bytesField(7, new Uint8Array(values.flatMap(varint)))]);

const nodeField = (op: string, name: string, inputs: string[], outputs: string[], attrs: Uint8Array[] = []) =>
  bytesField(1, concat([...inputs.map((i) => stringField(1, i)), ...outputs.map((o) => stringField(2, o)), stringField(3, name), stringField(4, op), ...attrs]));

/**
 * Rewrites what onnxruntime's WebGPU EP can't run, or runs badly, into equivalent ops:
 * - Split binds every output to its own storage buffer and, unlike Concat, doesn't chunk them, so
 *   a Split with more outputs than the GPU allows per shader stage (16 on many Windows GPUs, 8
 *   guaranteed) fails at run time. Each one with constant sizes becomes a tree of Splits with at
 *   most `maxOutputs` outputs.
 * - Sum has no WebGPU kernel, so its (often large) inputs go to the CPU and back; in the browser that
 *   can exhaust the 4 GB WebAssembly heap. It becomes a tree of Adds.
 * BiRefNet needs both (patch shuffling with 16- and 32-way Splits; a Sum in every deformable conv).
 * The result is the same on every backend.
 */
export function patchForWebGpu(model: Uint8Array<ArrayBuffer>, maxOutputs = 7): Uint8Array<ArrayBuffer> {
  const top = [...fields(model, 0, model.length)];
  const graph = top.find((f) => f.no === 7);
  if (!graph) return model;
  const items = [...fields(model, graph.start, graph.end)];

  // split sizes come from Constant nodes or initializers
  const sizes = new Map<string, () => number[] | null>();
  const nodes = new Map<Field, Node>();
  for (const f of items) {
    if (f.no === 5) {
      const name = [...fields(model, f.start, f.end)].find((x) => x.no === 8);
      if (name) sizes.set(text(model, name), () => int64s(model, f));
    } else if (f.no === 1) {
      const node = readNode(model, f);
      nodes.set(f, node);
      if (node.op === 'Constant' && node.attrs.length === 1) {
        const attr = node.attrs[0];
        const inner = [...fields(attr, 0, attr.length)][0];
        const tensor = [...fields(attr, inner.start, inner.end)].find((x) => x.no === 5);
        if (tensor) sizes.set(node.outputs[0], () => int64s(attr, tensor));
      }
    }
  }

  /** the replacement nodes (and new initializers) for one node, or null to keep it */
  function rewrite(node: Node, extra: Uint8Array[]): Uint8Array[] | null {
    const base = `${node.name || node.outputs[0]}/webgpu`;
    const out: Uint8Array[] = [];
    if (node.op === 'Sum' && node.inputs.length > 2) {
      const add = (terms: string[], name: string, result: string): void => {
        if (terms.length === 1) return void out.push(nodeField('Identity', name, terms, [result]));
        const half = Math.ceil(terms.length / 2);
        const sides = [terms.slice(0, half), terms.slice(half)].map((t, i) => (t.length === 1 ? t[0] : `${name}/${i}`));
        if (half > 1) add(terms.slice(0, half), sides[0], sides[0]);
        if (terms.length - half > 1) add(terms.slice(half), sides[1], sides[1]);
        out.push(nodeField('Add', `${name}/add`, sides, [result]));
      };
      add(node.inputs, base, node.outputs[0]);
      return out;
    }
    const split = node.op === 'Split' && node.outputs.length > maxOutputs && node.inputs.length === 2 ? sizes.get(node.inputs[1])?.() : null;
    if (!split || split.length !== node.outputs.length) return null;
    const emit = (input: string, outs: string[], sz: number[], name: string) => {
      if (outs.length > maxOutputs) {
        const per = Math.ceil(outs.length / maxOutputs);
        const groups = Array.from({ length: Math.ceil(outs.length / per) }, (_, i) => i * per);
        const mids = groups.map((_, i) => `${name}/${i}`);
        emit(input, mids, groups.map((g) => sz.slice(g, g + per).reduce((a, c) => a + c, 0)), name);
        groups.forEach((g, i) => emit(mids[i], outs.slice(g, g + per), sz.slice(g, g + per), mids[i]));
        return;
      }
      extra.push(bytesField(5, int64Tensor(`${name}/sizes`, sz)));
      out.push(nodeField('Split', `${name}/split`, [input, `${name}/sizes`], outs, node.attrs));
    };
    emit(node.inputs[0], node.outputs, split, base);
    return out;
  }

  // ORT reads weights in place, so every original byte keeps its offset modulo 64: each replacement
  // is followed by a GraphProto doc_string (field 10) just long enough to restore the alignment
  const build = (headerDelta: number) => {
    const extra: Uint8Array[] = [];
    let delta = headerDelta;
    let changed = 0;
    const parts = items.map((f) => {
      const node = nodes.get(f);
      const out = node && rewrite(node, extra);
      if (!out) return model.subarray(f.from, f.end);
      changed++;
      delta += out.reduce((n, b) => n + b.length, 0) - (f.end - f.from);
      const need = (64 - (delta % 64)) % 64;
      // a doc_string field costs 2 bytes plus its text (under 128 bytes)
      if (need) out.push(bytesField(10, new Uint8Array(need < 2 ? need + 62 : need - 2).fill(32)));
      delta += need === 1 ? 65 : need;
      return concat(out);
    });
    return changed ? concat([...parts, ...extra]) : null;
  };
  const header = (len: number) => 1 + varint(len).length;
  let graphBytes = build(0);
  if (!graphBytes) return model;
  const headerDelta = header(graphBytes.length) - (graph.start - graph.from);
  if (headerDelta) graphBytes = build(headerDelta)!;
  return concat(top.map((f) => (f === graph ? bytesField(7, graphBytes) : model.subarray(f.from, f.end)))) as Uint8Array<ArrayBuffer>;
}

// ── float16 → float32 ───────────────────────────────────────────────────────────────────────

const FLOAT = 1;
const FLOAT16 = 10;

/** output bytes: verbatim, or float16 values (2 bytes each) to write out as float32 (4 bytes each) */
type Piece = Uint8Array | { half: Uint8Array };
const size = (p: Piece) => ('half' in p ? p.half.length * 2 : p.length);
const total = (ps: Piece[]) => ps.reduce((n, p) => n + size(p), 0);
const tag = (no: number, wire: number) => varint(no * 8 + wire);
const message = (no: number, body: Piece[]): Piece[] => [new Uint8Array([...tag(no, 2), ...varint(total(body))]), ...body];
/** bytes of a field's tag + length prefix for a body of `n` bytes (field numbers under 16) */
const prefix = (n: number) => 1 + varint(n).length;

function readVarint(b: Uint8Array, p: number): number {
  let v = 0;
  for (let shift = 1; ; shift *= 128) {
    const x = b[p++];
    v += (x & 127) * shift;
    if (x < 128) return v;
  }
}

let halves: Float32Array | undefined;
/** every float16 bit pattern as a float32 */
function halfTable(): Float32Array {
  if (halves) return halves;
  halves = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const e = (h >> 10) & 31;
    const m = h & 1023;
    const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
    halves[h] = h & 0x8000 ? -v : v;
  }
  return halves;
}

class Widen {
  /** whether anything float16 was found */
  changed = false;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }

  /** a varint type field: float16 becomes float32, anything else stays verbatim */
  type(f: Field): Piece {
    if (f.wire !== 0 || readVarint(this.b, f.start) !== FLOAT16) return this.b.subarray(f.from, f.end);
    this.changed = true;
    return new Uint8Array([...tag(f.no, 0), FLOAT]);
  }

  /** TensorProto body; float16 data becomes float32 raw_data, written last and 64-byte aligned when `at` (where the body starts in the output) is known */
  tensor(start: number, end: number, at: number | null): Piece[] {
    const b = this.b;
    const fs = [...fields(b, start, end)];
    const type = fs.find((x) => x.no === 2);
    if (!type || readVarint(b, type.start) !== FLOAT16) return [b.subarray(start, end)];
    if (fs.some((x) => x.no === 14 && readVarint(b, x.start) === 1)) throw new Error('float16 tensors in external data are not supported');
    this.changed = true;
    const head: Piece[] = [];
    let bits: number[] = [];
    let raw: Uint8Array | undefined;
    for (const x of fs) {
      if (x.no === 9) raw = b.subarray(x.start, x.end);
      else if (x.no === 5) {
        // int32_data: one float16 bit pattern per value, packed varints (or one per field)
        if (x.wire === 2) for (let p = x.start; p < x.end; p++) for (bits.push(readVarint(b, p)); b[p] >= 128; p++);
        else bits.push(readVarint(b, x.start));
      } else head.push(x.no === 2 ? this.type(x) : b.subarray(x.from, x.end));
    }
    const half = raw ?? new Uint8Array(Uint16Array.from(bits).buffer);
    bits = [];
    const rawHeader = (pad: number) => new Uint8Array([...(pad ? [...tag(12, 2), ...varint(pad - 2), ...new Array<number>(pad - 2).fill(32)] : []), ...tag(9, 2), ...varint(half.length * 2)]);
    let pad = 0;
    // a doc_string (2 bytes + text) in front of raw_data aligns it
    if (at !== null) for (const before = at + total(head); (before + rawHeader(pad).length) % 64; pad = pad ? pad + 1 : 2);
    return [...head, rawHeader(pad), { half }];
  }

  typeProto(start: number, end: number): Piece[] {
    return [...fields(this.b, start, end)].flatMap((x): Piece[] => {
      // tensor_type / sparse_tensor_type: elem_type is field 1; sequence_type and optional_type wrap another TypeProto
      if ((x.no === 1 || x.no === 8) && x.wire === 2) return message(x.no, [...fields(this.b, x.start, x.end)].map((y) => (y.no === 1 ? this.type(y) : this.b.subarray(y.from, y.end))));
      if ((x.no === 4 || x.no === 9) && x.wire === 2) return message(x.no, [...fields(this.b, x.start, x.end)].flatMap((y) => (y.no === 1 ? message(1, this.typeProto(y.start, y.end)) : [this.b.subarray(y.from, y.end)])));
      return [this.b.subarray(x.from, x.end)];
    });
  }

  valueInfo(f: Field): Piece[] {
    return message(f.no, [...fields(this.b, f.start, f.end)].flatMap((x) => (x.no === 2 ? message(2, this.typeProto(x.start, x.end)) : [this.b.subarray(x.from, x.end)])));
  }

  node(f: Field): Piece[] {
    const b = this.b;
    const fs = [...fields(b, f.start, f.end)];
    const op = fs.find((x) => x.no === 4);
    const cast = !!op && text(b, op) === 'Cast';
    return message(
      1,
      fs.flatMap((x): Piece[] => {
        if (x.no !== 5) return [b.subarray(x.from, x.end)];
        // AttributeProto: Cast's `to` and any `dtype` (RandomNormal, EyeLike…), tensors, subgraphs
        const as = [...fields(b, x.start, x.end)];
        const name = as.find((y) => y.no === 1);
        const typed = !!name && (text(b, name) === 'dtype' || (cast && text(b, name) === 'to'));
        return message(
          5,
          as.flatMap((y): Piece[] => {
            if (y.no === 3 && typed) return [this.type(y)];
            if ((y.no === 5 || y.no === 10) && y.wire === 2) return message(y.no, this.tensor(y.start, y.end, null));
            if ((y.no === 6 || y.no === 11) && y.wire === 2) return message(y.no, this.graph(y.start, y.end, null));
            return [b.subarray(y.from, y.end)];
          }),
        );
      }),
    );
  }

  /** GraphProto body; `at` is where it starts in the output, for aligning initializers */
  graph(start: number, end: number, at: number | null): Piece[] {
    const out: Piece[] = [];
    let n = 0;
    for (const f of fields(this.b, start, end)) {
      let ps: Piece[];
      if (f.no === 1) ps = this.node(f);
      else if (f.no === 5) {
        // where the tensor's body starts depends on its length prefix, which depends on the padding
        let head = prefix(f.end - f.start);
        let body = this.tensor(f.start, f.end, at === null ? null : at + n + head);
        for (let h = prefix(total(body)); h !== head; h = prefix(total(body))) body = this.tensor(f.start, f.end, at === null ? null : at + n + (head = h));
        ps = message(5, body);
      } else if (f.no === 11 || f.no === 12 || f.no === 13) ps = this.valueInfo(f);
      else ps = [this.b.subarray(f.from, f.end)];
      out.push(...ps);
      n += total(ps);
    }
    return out;
  }
}

/**
 * Widens a float16 model to float32: initializers and Constant tensors, Casts to float16, and every
 * declared tensor type, so all of its math runs in float32. onnxruntime's WebGPU backends do a
 * float16 model's math in float16, which some models can't take (DDColor's LayerNorms), and only
 * float16 weights are published for some. Weights take twice the memory; raw data is 64-byte aligned.
 * Returns the model itself when there is no float16 in it.
 */
export function toFloat32(model: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const top = [...fields(model, 0, model.length)];
  const g = top.find((f) => f.no === 7);
  if (!g) return model;
  const w = new Widen(model);
  const before = top.slice(0, top.indexOf(g)).reduce((n, f) => n + f.end - f.from, 0);
  // the graph's length prefix decides where its body starts
  let head = prefix(g.end - g.start);
  let body = w.graph(g.start, g.end, before + head);
  for (let h = prefix(total(body)); h !== head; h = prefix(total(body))) body = w.graph(g.start, g.end, before + (head = h));
  if (!w.changed) return model;

  const pieces = top.flatMap((f) => (f === g ? message(7, body) : [model.subarray(f.from, f.end)]));
  const out = new Uint8Array(total(pieces));
  const table = halfTable();
  let at = 0;
  for (const p of pieces) {
    if (!('half' in p)) {
      out.set(p, at);
      at += p.length;
      continue;
    }
    // the float16 source can sit at an odd offset; Constant tensors (not aligned) can land anywhere
    const src = p.half.byteOffset % 2 ? new Uint16Array(p.half.slice().buffer) : new Uint16Array(p.half.buffer, p.half.byteOffset, p.half.length / 2);
    const dst = at % 4 ? new Float32Array(src.length) : new Float32Array(out.buffer, at, src.length);
    for (let i = 0; i < src.length; i++) dst[i] = table[src[i]];
    if (at % 4) out.set(new Uint8Array(dst.buffer), at);
    at += src.length * 4;
  }
  return out;
}
