import { BlockHasher } from './block';

// RFC 1321: K[i] = floor(abs(sin(i + 1)) * 2^32), written out so no engine's sin() can drift
const K = new Int32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export class Md5 extends BlockHasher {
  private h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private w = new Int32Array(16);

  constructor() {
    super(64, true);
  }

  protected block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++, o += 4) w[i] = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
    const s = this.h;
    let a = s[0], b = s[1], c = s[2], dd = s[3];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & dd)), (g = i);
      else if (i < 32) (f = (dd & b) | (~dd & c)), (g = (5 * i + 1) & 15);
      else if (i < 48) (f = b ^ c ^ dd), (g = (3 * i + 5) & 15);
      else (f = c ^ (b | ~dd)), (g = (7 * i) & 15);
      const x = (a + f + K[i] + w[g]) | 0;
      const r = R[((i >> 4) << 2) | (i & 3)];
      a = dd;
      dd = c;
      c = b;
      b = (b + ((x << r) | (x >>> (32 - r)))) | 0;
    }
    s[0] += a;
    s[1] += b;
    s[2] += c;
    s[3] += dd;
  }

  protected output() {
    const out = new Uint8Array(16);
    const view = new DataView(out.buffer);
    this.h.forEach((v, i) => view.setInt32(i * 4, v, true));
    return out;
  }
}
