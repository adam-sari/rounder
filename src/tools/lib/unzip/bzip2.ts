// A small bzip2 decoder for single .bz2 files (libarchive.js only reads .bz2 when there is a tar inside).
// Follows the reference bzip2 decompressor: Huffman + MTF/RLE2 → inverse BWT → RLE1.

class BitReader {
  i = 0;
  private acc = 0;
  private n = 0;
  constructor(private buf: Uint8Array) {}

  /** reads k bits, MSB first (k ≤ 24) */
  bits(k: number) {
    while (this.n < k) {
      if (this.i >= this.buf.length) throw new Error('The .bz2 file ends too early. It may be incomplete.');
      this.acc = ((this.acc << 8) | this.buf[this.i++]) >>> 0;
      this.n += 8;
    }
    this.n -= k;
    return (this.acc >>> this.n) & ((1 << k) - 1);
  }

  alignToByte() {
    this.n -= this.n & 7;
  }

  get done() {
    return this.n < 8 && this.i >= this.buf.length;
  }
}

const CRC_TABLE = new Uint32Array(256).map((_, i) => {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  return c >>> 0;
});

const corrupt = (why: string) => new Error(`This .bz2 file is damaged (${why}).`);

/**
 * Decompresses a whole .bz2 file (multi-stream files too), handing each decoded block to `emit`.
 * `progress` gets the number of input bytes consumed so far.
 */
export function bunzip2(input: Uint8Array, emit: (chunk: Uint8Array) => void, progress?: (read: number) => void) {
  const br = new BitReader(input);
  let streams = 0;
  while (!br.done) {
    if (br.bits(8) !== 0x42 || br.bits(8) !== 0x5a || br.bits(8) !== 0x68) {
      // trailing zero padding after the last stream is allowed
      if (streams) break;
      throw new Error('This is not a .bz2 file.');
    }
    const level = br.bits(8) - 0x30;
    if (level < 1 || level > 9) throw corrupt('bad block size');
    const tt = new Uint32Array(level * 100_000);
    for (;;) {
      const hi = br.bits(24);
      const lo = br.bits(24);
      if (hi === 0x177245 && lo === 0x385090) {
        br.bits(16), br.bits(16); // combined CRC; every block was already checked
        br.alignToByte();
        break;
      }
      if (hi !== 0x314159 || lo !== 0x265359) throw corrupt('bad block header');
      emit(readBlock(br, tt));
      progress?.(br.i);
    }
    streams++;
  }
}

function readBlock(br: BitReader, tt: Uint32Array) {
  const expectedCrc = ((br.bits(16) << 16) | br.bits(16)) >>> 0;
  if (br.bits(1)) throw new Error('This .bz2 file uses the old "randomised" mode, which isn\'t supported.');
  const origPtr = br.bits(24);

  // which byte values appear in the block
  const seqToUnseq: number[] = [];
  const used16 = br.bits(16);
  for (let i = 0; i < 16; i++) {
    if (!(used16 & (0x8000 >> i))) continue;
    const used = br.bits(16);
    for (let j = 0; j < 16; j++) if (used & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
  }
  if (!seqToUnseq.length) throw corrupt('empty symbol map');
  const alphaSize = seqToUnseq.length + 2;

  const nGroups = br.bits(3);
  const nSelectors = br.bits(15);
  if (nGroups < 2 || nGroups > 6 || nSelectors < 1) throw corrupt('bad Huffman tables');

  const groupMtf = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
  const selectors = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0;
    while (br.bits(1)) if (++j >= nGroups) throw corrupt('bad selector');
    const v = groupMtf[j];
    groupMtf.splice(j, 1);
    groupMtf.unshift(v);
    selectors[i] = v;
  }

  const tables = [];
  for (let t = 0; t < nGroups; t++) {
    const lens = new Uint8Array(alphaSize);
    let cur = br.bits(5);
    for (let i = 0; i < alphaSize; i++) {
      for (;;) {
        if (cur < 1 || cur > 20) throw corrupt('bad code length');
        if (!br.bits(1)) break;
        cur += br.bits(1) ? -1 : 1;
      }
      lens[i] = cur;
    }
    tables.push(huffman(lens));
  }

  // Huffman → MTF / run-length symbols → byte values in tt
  const counts = new Int32Array(256);
  const mtf = new Uint8Array(256).map((_, i) => i);
  const eob = alphaSize - 1;
  const max = tt.length;
  let nblock = 0;
  let group = -1;
  let left = 0;
  let run = 0;
  let runWeight = 1;
  for (;;) {
    if (!left) {
      if (++group >= nSelectors) throw corrupt('ran out of selectors');
      left = 50;
    }
    left--;
    const { minLen, limit, base, perm } = tables[selectors[group]];
    let len = minLen;
    let code = br.bits(len);
    while (code > limit[len]) {
      if (++len > 20) throw corrupt('bad Huffman code');
      code = (code << 1) | br.bits(1);
    }
    const at = code - base[len];
    if (at < 0 || at >= alphaSize) throw corrupt('bad Huffman code');
    const sym = perm[at];

    if (sym <= 1) {
      // RUNA / RUNB spell out a repeat count in bijective base 2
      run += (sym + 1) * runWeight;
      runWeight *= 2;
      if (run > max) throw corrupt('run too long');
      continue;
    }
    if (run) {
      const b = seqToUnseq[mtf[0]];
      if (nblock + run > max) throw corrupt('block too long');
      tt.fill(b, nblock, nblock + run);
      counts[b] += run;
      nblock += run;
      run = 0;
      runWeight = 1;
    }
    if (sym === eob) break;
    const idx = sym - 1;
    const v = mtf[idx];
    mtf.copyWithin(1, 0, idx);
    mtf[0] = v;
    const b = seqToUnseq[v];
    if (nblock >= max) throw corrupt('block too long');
    counts[b]++;
    tt[nblock++] = b;
  }
  if (origPtr >= nblock) throw corrupt('bad origin pointer');

  // inverse BWT: thread each position to the next one in the upper 24 bits
  const start = new Int32Array(256);
  for (let i = 1; i < 256; i++) start[i] = start[i - 1] + counts[i - 1];
  for (let i = 0; i < nblock; i++) {
    const b = tt[i] & 0xff;
    tt[start[b]++] |= i << 8;
  }

  // undo the initial run-length step (4 equal bytes are followed by a repeat count)
  let out = new Uint8Array(nblock + (nblock >> 2) + 64);
  let o = 0;
  let crc = 0xffffffff;
  let pos = tt[origPtr] >>> 8;
  let last = -1;
  let same = 0;
  const put = (b: number) => {
    if (o === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[o++] = b;
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  };
  for (let k = 0; k < nblock; k++) {
    pos = tt[pos];
    const b = pos & 0xff;
    pos >>>= 8;
    if (same === 4) {
      for (let r = 0; r < b; r++) put(last);
      same = 0;
      last = -1;
      continue;
    }
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
    put(b);
  }
  if ((crc ^ 0xffffffff) >>> 0 !== expectedCrc) throw corrupt('checksum mismatch');
  return out.subarray(0, o);
}

/** canonical Huffman decode tables, as in bzip2's hbCreateDecodeTables */
function huffman(lens: Uint8Array) {
  let minLen = 32;
  let maxLen = 0;
  for (const l of lens) {
    if (l < minLen) minLen = l;
    if (l > maxLen) maxLen = l;
  }
  const perm = new Int32Array(lens.length);
  let p = 0;
  for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < lens.length; s++) if (lens[s] === l) perm[p++] = s;
  const base = new Int32Array(23);
  const limit = new Int32Array(23);
  for (const l of lens) base[l + 1]++;
  for (let i = 1; i < 23; i++) base[i] += base[i - 1];
  let vec = 0;
  for (let l = minLen; l <= maxLen; l++) {
    vec += base[l + 1] - base[l];
    limit[l] = vec - 1;
    vec <<= 1;
  }
  for (let l = minLen + 1; l <= maxLen; l++) base[l] = ((limit[l - 1] + 1) << 1) - base[l];
  return { minLen, limit, base, perm };
}
