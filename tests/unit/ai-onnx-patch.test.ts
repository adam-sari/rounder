import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { patchForWebGpu, toFloat32 } from '@/engines/ai/onnx-patch';

// onnxruntime-node comes with @huggingface/transformers; it checks that the rewrite changes nothing
const ort = createRequire(import.meta.url)('onnxruntime-node') as typeof import('onnxruntime-web');

// just enough protobuf to write a small ONNX model
const varint = (n: number): number[] => (n < 128 ? [n] : [(n % 128) | 128, ...varint(Math.floor(n / 128))]);
const bytes = (no: number, data: ArrayLike<number>) => [...varint(no * 8 + 2), ...varint(data.length), ...Array.from(data)];
const str = (no: number, s: string) => bytes(no, new TextEncoder().encode(s));
const int = (no: number, v: number) => [...varint(no * 8), ...varint(v)];
const valueInfo = (name: string, dims: number[], type = 1) => [...str(1, name), ...bytes(2, bytes(1, [...int(1, type), ...bytes(2, dims.flatMap((d) => bytes(1, int(1, d))))]))];
const node = (op: string, inputs: string[], outputs: string[], attrs: number[][] = []) =>
  bytes(1, [...inputs.flatMap((i) => str(1, i)), ...outputs.flatMap((o) => str(2, o)), ...str(3, `${op}_${outputs[0]}`), ...str(4, op), ...attrs.flatMap((a) => bytes(5, a))]);
const tensor = (name: string, dims: number[], type: number, raw: ArrayBufferView) => [...dims.flatMap((d) => int(1, d)), ...int(2, type), ...str(8, name), ...bytes(9, new Uint8Array(raw.buffer))];

/** x [1, 20] → Split into ten [1, 2] (axis 1) → y3..y9 out, plus Sum(y0, y1, y2) · w */
function model() {
  const ys = Array.from({ length: 10 }, (_, i) => `y${i}`);
  const graph = [
    ...node('Split', ['x', 'sizes'], ys, [[...str(1, 'axis'), ...int(3, 1), ...int(20, 2)]]),
    ...node('Sum', ['y0', 'y1', 'y2'], ['s']),
    ...node('Mul', ['s', 'w'], ['out']),
    ...str(2, 'g'),
    ...bytes(5, tensor('sizes', [10], 7, new BigInt64Array(10).fill(2n))),
    ...bytes(5, tensor('w', [2], 1, new Float32Array([3, -1]))),
    ...bytes(11, valueInfo('x', [1, 20])),
    ...['out', ...ys.slice(3)].flatMap((o) => bytes(12, valueInfo(o, [1, 2]))),
  ];
  return new Uint8Array([...int(1, 8), ...bytes(8, int(2, 17)), ...bytes(7, graph)]);
}

/** offset of a float initializer's raw bytes */
const rawOffset = (m: Uint8Array) => Buffer.from(m).indexOf(Buffer.from(new Float32Array([3, -1]).buffer));

describe('patchForWebGpu', () => {
  it('narrows wide Splits, turns Sum into Adds, keeps weights aligned and results identical', async () => {
    const before = model();
    const after = patchForWebGpu(before);
    const text = Buffer.from(after).toString('latin1');
    // op_type fields: tag 0x22, length, name (node names keep the old op in them)
    expect(text).not.toContain('\x22\x03Sum');
    expect(text).toContain('\x22\x03Add');
    expect(text.split('\x22\x05Split').length - 1).toBeGreaterThan(1);
    expect((rawOffset(after) - rawOffset(before)) % 64).toBe(0);

    const x = new ort.Tensor('float32', Float32Array.from({ length: 20 }, (_, i) => i * 1.5 - 7), [1, 20]);
    const run = async (m: Uint8Array) => ort.InferenceSession.create(m).then((s) => s.run({ x }));
    const [a, b] = await Promise.all([run(before), run(after)]);
    for (const k of Object.keys(a)) expect([...b[k].data]).toEqual([...a[k].data]);
  });

  it('leaves models without anything to fix untouched', () => {
    const m = new Uint8Array([...int(1, 8), ...bytes(7, [...node('Relu', ['x'], ['y']), ...bytes(11, valueInfo('x', [1])), ...bytes(12, valueInfo('y', [1]))])]);
    expect(patchForWebGpu(m)).toBe(m);
  });
});

// float16 bit patterns of a few exact values
const H = { '-1': 0xbc00, '0': 0, '0.25': 0x3400, '0.5': 0x3800, '1': 0x3c00, '1.5': 0x3e00, '2': 0x4000 } as const;
const half = (...v: (keyof typeof H)[]) => new Uint16Array(v.map((k) => H[k]));

/**
 * The way fp16 exports look (DDColor): float32 in → Cast to float16 → LayerNorm(scale, bias) · a Constant
 * (stored as int32_data) + a 1-D initializer → Cast to float32 out, with float16 value_info
 */
function halfModel() {
  const cast = (to: number) => [[...str(1, 'to'), ...int(3, to), ...int(20, 2)]];
  const constant = [...int(1, 4), ...int(2, 10), ...str(8, 'k'), ...bytes(5, [...half('2', '-1', '0.5', '1.5')].flatMap(varint))];
  const graph = [
    ...node('Cast', ['x'], ['x16'], cast(10)),
    ...node('LayerNormalization', ['x16', 'scale', 'bias'], ['ln']),
    ...node('Constant', [], ['k'], [[...str(1, 'value'), ...bytes(5, constant), ...int(20, 4)]]),
    ...node('Mul', ['ln', 'k'], ['m']),
    ...node('Add', ['m', 'b2'], ['y16']),
    ...node('Cast', ['y16'], ['y'], cast(1)),
    ...str(2, 'g'),
    ...bytes(5, tensor('scale', [4], 10, half('1', '0.5', '2', '1'))),
    ...bytes(5, tensor('bias', [4], 10, half('0', '0.25', '-1', '0'))),
    ...bytes(5, tensor('b2', [4], 10, half('0.5', '0', '0', '1'))),
    ...bytes(11, valueInfo('x', [2, 4])),
    ...bytes(12, valueInfo('y', [2, 4])),
    ...['x16', 'ln', 'm', 'y16'].flatMap((n) => bytes(13, valueInfo(n, [2, 4], 10))),
  ];
  return new Uint8Array([...int(1, 8), ...bytes(8, int(2, 17)), ...bytes(7, graph)]);
}

describe('toFloat32', () => {
  it('widens float16 weights, constants, casts and types; results match, now in float32 math', async () => {
    const before = halfModel();
    const after = toFloat32(before);
    expect(after.length).toBeGreaterThan(before.length);
    // initializers are float32 raw data now, 64-byte aligned
    for (const scale of [[1, 0.5, 2, 1], [0, 0.25, -1, 0], [0.5, 0, 0, 1]]) {
      const at = Buffer.from(after).indexOf(Buffer.from(new Float32Array(scale).buffer));
      expect(at).toBeGreaterThan(0);
      expect(at % 64).toBe(0);
    }

    const x = new ort.Tensor('float32', Float32Array.from([1, 2, 3, 4, -3, 0.5, 7, 100]), [2, 4]);
    const run = async (m: Uint8Array) => (await (await ort.InferenceSession.create(m)).run({ x })).y.data as Float32Array;
    const [a, b] = await Promise.all([run(before), run(after)]);
    expect(b.length).toBe(8);
    for (let i = 0; i < 8; i++) expect(b[i]).toBeCloseTo(a[i], 2);
    // the widened model's math is float32: its LayerNorm keeps digits float16 rounds away
    const ln = (v: number[]) => {
      const mean = v.reduce((s, c) => s + c, 0) / v.length;
      const sd = Math.sqrt(v.reduce((s, c) => s + (c - mean) ** 2, 0) / v.length + 1e-5);
      return v.map((c) => (c - mean) / sd);
    };
    const want = [...ln([1, 2, 3, 4]), ...ln([-3, 0.5, 7, 100])].map((v, i) => (v * [1, 0.5, 2, 1][i % 4] + [0, 0.25, -1, 0][i % 4]) * [2, -1, 0.5, 1.5][i % 4] + [0.5, 0, 0, 1][i % 4]);
    for (let i = 0; i < 8; i++) expect(b[i]).toBeCloseTo(want[i], 5);
    expect(a.some((v, i) => Math.abs(v - want[i]) > 1e-4)).toBe(true);
  });

  it('leaves float32 models untouched', () => {
    const m = model();
    expect(toFloat32(m)).toBe(m);
  });
});
