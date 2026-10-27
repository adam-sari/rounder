import { BlockHasher, readBE, wordsBE } from './block';

/** FIPS 180-4 SHA-1 */
export class Sha1 extends BlockHasher {
  private h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private w = new Int32Array(80);

  constructor() {
    super(64);
  }

  protected block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = readBE(d, o + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    const s = this.h;
    let a = s[0], b = s[1], c = s[2], dd = s[3], e = s[4];
    for (let i = 0; i < 80; i++) {
      const f =
        i < 20 ? ((b & c) | (~b & dd)) + 0x5a827999
        : i < 40 ? (b ^ c ^ dd) + 0x6ed9eba1
        : i < 60 ? ((b & c) | (b & dd) | (c & dd)) + 0x8f1bbcdc
        : (b ^ c ^ dd) + 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + w[i]) | 0;
      e = dd;
      dd = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    s[0] += a;
    s[1] += b;
    s[2] += c;
    s[3] += dd;
    s[4] += e;
  }

  protected output() {
    return wordsBE(this.h);
  }
}

const K256 = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** FIPS 180-4 SHA-256 */
export class Sha256 extends BlockHasher {
  private h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Int32Array(64);

  constructor() {
    super(64);
  }

  protected block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = readBE(d, o + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const s = this.h;
    let a = s[0], b = s[1], c = s[2], dd = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (dd + t1) | 0;
      dd = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    s[0] += a; s[1] += b; s[2] += c; s[3] += dd; s[4] += e; s[5] += f; s[6] += g; s[7] += h;
  }

  protected output() {
    return wordsBE(this.h);
  }
}

// SHA-512 works on 64-bit words; JS bitwise ops are 32-bit, so every word is a (hi, lo) pair
const K512 = new Int32Array(
  [
    '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019',
    '923f82a4af194f9b', 'ab1c5ed5da6d8118', 'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
    '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694', 'e49b69c19ef14ad2', 'efbe4786384f25e3',
    '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
    '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725',
    '06ca6351e003826f', '142929670a0e6e70', '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
    '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b', 'a2bfe8a14cf10364', 'a81a664bbc423001',
    'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
    '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb',
    '5b9cca4f7763e373', '682e6ff3d6b2b8a3', '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
    '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b', 'ca273eceea26619c', 'd186b8c721c0c207',
    'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
    '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a',
    '5fcb6fab3ad6faec', '6c44198c4a475817',
  ].flatMap((k) => [parseInt(k.slice(0, 8), 16), parseInt(k.slice(8), 16)]),
);

const IV512 = [
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
];
const IV384 = [
  0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
  0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
];

const CARRY = 0x1_0000_0000;

/** FIPS 180-4 SHA-512, and SHA-384 (same rounds, different start values, truncated output) */
export class Sha512 extends BlockHasher {
  private h: Int32Array;
  private w = new Int32Array(160);

  constructor(private readonly is384 = false) {
    super(128);
    this.h = new Int32Array(is384 ? IV384 : IV512);
  }

  protected block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let i = 0; i < 32; i++) w[i] = readBE(d, o + i * 4);
    for (let i = 32; i < 160; i += 2) {
      // σ0 = rotr1 ^ rotr8 ^ shr7 of w[t-15]
      let xh = w[i - 30], xl = w[i - 29];
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      // σ1 = rotr19 ^ rotr61 ^ shr6 of w[t-2]
      xh = w[i - 4]; xl = w[i - 3];
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      const lo = (s0l >>> 0) + (s1l >>> 0) + (w[i - 13] >>> 0) + (w[i - 31] >>> 0);
      w[i] = s0h + s1h + w[i - 14] + w[i - 32] + ((lo / CARRY) | 0);
      w[i + 1] = lo;
    }

    const s = this.h;
    let ah = s[0], al = s[1], bh = s[2], bl = s[3], ch = s[4], cl = s[5], dh = s[6], dl = s[7];
    let eh = s[8], el = s[9], fh = s[10], fl = s[11], gh = s[12], gl = s[13], hh = s[14], hl = s[15];
    for (let i = 0; i < 160; i += 2) {
      // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i + 1] >>> 0) + (w[i + 1] >>> 0);
      const t1h = hh + S1h + chh + K512[i] + w[i] + ((t1l / CARRY) | 0);
      // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = S0h + mjh + ((t2l / CARRY) | 0);

      hh = gh; hl = gl;
      gh = fh; gl = fl;
      fh = eh; fl = el;
      let lo = (dl >>> 0) + (t1l >>> 0);
      eh = (dh + t1h + ((lo / CARRY) | 0)) | 0;
      el = lo | 0;
      dh = ch; dl = cl;
      ch = bh; cl = bl;
      bh = ah; bl = al;
      lo = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + ((lo / CARRY) | 0)) | 0;
      al = lo | 0;
    }

    const add = (i: number, h: number, l: number) => {
      const lo = (s[i + 1] >>> 0) + (l >>> 0);
      s[i] = s[i] + h + ((lo / CARRY) | 0);
      s[i + 1] = lo;
    };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl);
    add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }

  protected output() {
    return wordsBE(this.h, this.is384 ? 12 : 16);
  }
}
