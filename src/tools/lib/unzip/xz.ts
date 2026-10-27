// A small .xz (LZMA2) decoder for single .xz files (libarchive.js only reads .xz when there is a tar inside).
// Structure follows the xz file format spec and the LZMA reference decoder (LzmaSpec).

const corrupt = (why: string) => new Error(`This .xz file is damaged (${why}).`);
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
/** biggest window we're willing to allocate; xz -9 uses 64 MiB */
const MAX_DICT = 1 << 30;

class Input {
  constructor(
    readonly buf: Uint8Array,
    public i = 0,
  ) {}
  byte() {
    if (this.i >= this.buf.length) throw new Error('The .xz file ends too early. It may be incomplete.');
    return this.buf[this.i++];
  }
  u16be() {
    return (this.byte() << 8) | this.byte();
  }
  vli() {
    let v = 0;
    for (let k = 0; k < 9; k++) {
      const b = this.byte();
      v += (b & 0x7f) * 2 ** (7 * k);
      if (!(b & 0x80)) return v;
    }
    throw corrupt('bad number');
  }
}

/** sliding window that doubles as the output buffer, flushed in pieces */
class Window {
  buf: Uint8Array;
  pos = 0;
  /** bytes available for back-references since the last dictionary reset */
  full = 0;
  private flushed = 0;
  constructor(
    size: number,
    private emit: (chunk: Uint8Array) => void,
  ) {
    this.buf = new Uint8Array(size);
  }
  put(b: number) {
    this.buf[this.pos++] = b;
    if (this.full < this.buf.length) this.full++;
    if (this.pos === this.buf.length) this.flush();
  }
  get(dist: number) {
    let i = this.pos - dist - 1;
    if (i < 0) i += this.buf.length;
    return this.buf[i];
  }
  copy(dist: number, len: number) {
    if (dist >= this.full) throw corrupt('reference before the start of data');
    while (len--) this.put(this.get(dist));
  }
  flush() {
    if (this.pos > this.flushed) this.emit(this.buf.slice(this.flushed, this.pos));
    if (this.pos === this.buf.length) this.pos = 0;
    this.flushed = this.pos;
  }
}

class RangeDecoder {
  range = 0xffffffff;
  code = 0;
  constructor(private inp: Input) {
    if (inp.byte() !== 0) throw corrupt('bad range coder start');
    for (let k = 0; k < 4; k++) this.code = ((this.code << 8) | inp.byte()) >>> 0;
  }
  bit(p: Uint16Array, i: number) {
    const bound = (this.range >>> 11) * p[i];
    let b: number;
    if (this.code < bound) {
      this.range = bound;
      p[i] += (2048 - p[i]) >>> 5;
      b = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      p[i] -= p[i] >>> 5;
      b = 1;
    }
    if (this.range < 0x1000000) {
      this.range = (this.range * 256) >>> 0;
      this.code = ((this.code << 8) | this.inp.byte()) >>> 0;
    }
    return b;
  }
  direct(count: number) {
    let v = 0;
    while (count--) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        b = 1;
      }
      v = v * 2 + b;
      if (this.range < 0x1000000) {
        this.range = (this.range * 256) >>> 0;
        this.code = ((this.code << 8) | this.inp.byte()) >>> 0;
      }
    }
    return v;
  }
  tree(p: Uint16Array, off: number, bits: number) {
    let m = 1;
    for (let k = 0; k < bits; k++) m = (m << 1) | this.bit(p, off + m);
    return m - (1 << bits);
  }
  reverseTree(p: Uint16Array, off: number, bits: number) {
    let m = 1;
    let v = 0;
    for (let k = 0; k < bits; k++) {
      const b = this.bit(p, off + m);
      m = (m << 1) | b;
      v |= b << k;
    }
    return v;
  }
}

const probs = (n: number) => new Uint16Array(n).fill(1024);

class LenDecoder {
  choice = probs(2);
  low = probs(16 << 3);
  mid = probs(16 << 3);
  high = probs(256);
  decode(rc: RangeDecoder, posState: number) {
    if (!rc.bit(this.choice, 0)) return rc.tree(this.low, posState << 3, 3);
    if (!rc.bit(this.choice, 1)) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

class Lzma {
  lc = 0;
  lp = 0;
  pb = 0;
  state = 0;
  reps = [0, 0, 0, 0];
  literal = probs(0x300);
  isMatch = probs(12 << 4);
  isRep = probs(12);
  isRepG0 = probs(12);
  isRepG1 = probs(12);
  isRepG2 = probs(12);
  isRep0Long = probs(12 << 4);
  posSlot = probs(4 << 6);
  posSpecial = probs(1 + 114);
  align = probs(16);
  len = new LenDecoder();
  repLen = new LenDecoder();

  setProps(p: number) {
    if (p >= 225) throw corrupt('bad LZMA properties');
    this.lc = p % 9;
    this.lp = Math.floor(p / 9) % 5;
    this.pb = Math.floor(p / 45);
    if (this.lc + this.lp > 4) throw corrupt('bad LZMA properties');
  }

  reset() {
    const { lc, lp, pb } = this;
    Object.assign(this, new Lzma());
    Object.assign(this, { lc, lp, pb, literal: probs(0x300 << (lc + lp)) });
  }

  /** decodes exactly `size` bytes of one LZMA2 chunk */
  decode(rc: RangeDecoder, w: Window, size: number, total: number) {
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    const end = total + size;
    const reps = this.reps;
    while (total < end) {
      const posState = total & pbMask;
      const s = this.state;
      if (!rc.bit(this.isMatch, (s << 4) + posState)) {
        const prev = w.full ? w.get(0) : 0;
        const base = 0x300 * (((total & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
        let sym = 1;
        if (s >= 7) {
          let match = w.get(reps[0]);
          do {
            const mb = (match >>> 7) & 1;
            match <<= 1;
            const b = rc.bit(this.literal, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(this.literal, base + sym);
        w.put(sym & 0xff);
        total++;
        this.state = s < 4 ? 0 : s < 10 ? s - 3 : s - 6;
        continue;
      }

      let len: number;
      if (rc.bit(this.isRep, s)) {
        if (!rc.bit(this.isRepG0, s)) {
          if (!rc.bit(this.isRep0Long, (s << 4) + posState)) {
            // a single byte from the last distance
            this.state = s < 7 ? 9 : 11;
            if (!w.full) throw corrupt('reference before the start of data');
            w.put(w.get(reps[0]));
            total++;
            continue;
          }
        } else {
          let dist: number;
          if (!rc.bit(this.isRepG1, s)) dist = reps[1];
          else {
            if (!rc.bit(this.isRepG2, s)) dist = reps[2];
            else {
              dist = reps[3];
              reps[3] = reps[2];
            }
            reps[2] = reps[1];
          }
          reps[1] = reps[0];
          reps[0] = dist;
        }
        len = this.repLen.decode(rc, posState);
        this.state = s < 7 ? 8 : 11;
      } else {
        reps[3] = reps[2];
        reps[2] = reps[1];
        reps[1] = reps[0];
        len = this.len.decode(rc, posState);
        this.state = s < 7 ? 7 : 10;
        reps[0] = this.distance(rc, len);
        if (reps[0] === 0xffffffff) throw corrupt('unexpected end marker');
      }
      len += 2;
      if (total + len > end) throw corrupt('match runs past the chunk');
      w.copy(reps[0], len);
      total += len;
    }
    return total;
  }

  private distance(rc: RangeDecoder, len: number) {
    const slot = rc.tree(this.posSlot, Math.min(len, 3) << 6, 6);
    if (slot < 4) return slot;
    const direct = (slot >>> 1) - 1;
    let dist = (2 | (slot & 1)) * 2 ** direct;
    if (slot < 14) return dist + rc.reverseTree(this.posSpecial, dist - slot, direct);
    dist += rc.direct(direct - 4) * 16;
    return dist + rc.reverseTree(this.align, 0, 4);
  }
}

/**
 * Decompresses a whole .xz file (concatenated streams too), handing output to `emit` in pieces.
 * `progress` gets the number of input bytes consumed so far.
 */
export function unxz(input: Uint8Array, emit: (chunk: Uint8Array) => void, progress?: (read: number) => void) {
  const inp = new Input(input);
  const magic = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
  let streams = 0;
  while (inp.i < input.length) {
    // stream padding between and after streams is zero bytes
    if (streams && input[inp.i] === 0) {
      inp.i++;
      continue;
    }
    if (!magic.every((m) => inp.byte() === m)) throw new Error('This is not an .xz file.');
    inp.byte();
    const check = inp.byte() & 0x0f;
    inp.i += 4; // header CRC32

    while (input[inp.i] !== 0) readBlock(inp, CHECK_SIZES[check], emit, progress);

    // index: skip the records, then the footer
    inp.byte();
    const records = inp.vli();
    for (let r = 0; r < records; r++) inp.vli(), inp.vli();
    while (inp.i & 3) inp.byte();
    inp.i += 4 + 12;
    if (inp.i > input.length) throw new Error('The .xz file ends too early. It may be incomplete.');
    streams++;
  }
}

function readBlock(inp: Input, checkSize: number, emit: (chunk: Uint8Array) => void, progress?: (read: number) => void) {
  const start = inp.i;
  const headerSize = (inp.byte() + 1) * 4;
  const flags = inp.byte();
  if (flags & 0x40) inp.vli();
  if (flags & 0x80) inp.vli();
  const filters = (flags & 3) + 1;
  let dictSize = 0;
  for (let f = 0; f < filters; f++) {
    const id = inp.vli();
    const propsSize = inp.vli();
    if (id !== 0x21 || f !== filters - 1) {
      throw new Error('This .xz file uses an extra filter (such as BCJ for programs) that isn\'t supported. Only plain LZMA2 is.');
    }
    if (propsSize !== 1) throw corrupt('bad filter properties');
    const p = inp.byte();
    if (p > 40) throw corrupt('bad dictionary size');
    dictSize = p === 40 ? 0xffffffff : (2 | (p & 1)) * 2 ** ((p >>> 1) + 11);
  }
  inp.i = start + headerSize;

  const w = new Window(Math.max(4096, Math.min(dictSize, MAX_DICT)), emit);
  const lzma = new Lzma();
  let total = 0;
  for (;;) {
    const control = inp.byte();
    if (control === 0) break;
    if (control === 1 || control === 2) {
      // stored chunk; 1 also resets the dictionary
      if (control === 1) w.full = total = 0;
      const size = inp.u16be() + 1;
      if (inp.i + size > inp.buf.length) throw new Error('The .xz file ends too early. It may be incomplete.');
      for (let k = 0; k < size; k++) w.put(inp.buf[inp.i++]);
      total += size;
    } else if (control >= 0x80) {
      const size = (control & 0x1f) * 65536 + inp.u16be() + 1;
      const packed = inp.u16be() + 1;
      const reset = (control >>> 5) & 3;
      if (reset === 3) w.full = total = 0;
      if (reset >= 2) lzma.setProps(inp.byte());
      if (reset >= 1) lzma.reset();
      const chunkStart = inp.i;
      total = lzma.decode(new RangeDecoder(inp), w, size, total);
      if (inp.i - chunkStart > packed) throw corrupt('chunk overruns its size');
      inp.i = chunkStart + packed;
    } else {
      throw corrupt('bad chunk header');
    }
    w.flush();
    progress?.(inp.i);
  }
  while ((inp.i - start) & 3) inp.byte();
  inp.i += checkSize;
}
