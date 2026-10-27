export interface Hasher {
  update(data: Uint8Array): this;
  digest(): Uint8Array;
}

/**
 * Merkle–Damgård plumbing shared by MD5 and the SHA family: buffers partial blocks
 * so data can arrive in any chunk size, then pads with 0x80, zeros and the bit length.
 */
export abstract class BlockHasher implements Hasher {
  private buf: Uint8Array;
  private bufLen = 0;
  private total = 0;

  constructor(
    private readonly blockSize: 64 | 128,
    private readonly littleEndian = false,
  ) {
    this.buf = new Uint8Array(blockSize);
  }

  protected abstract block(data: Uint8Array, offset: number): void;
  protected abstract output(): Uint8Array;

  update(data: Uint8Array) {
    const bs = this.blockSize;
    let i = 0;
    this.total += data.length;
    if (this.bufLen) {
      i = Math.min(bs - this.bufLen, data.length);
      this.buf.set(data.subarray(0, i), this.bufLen);
      this.bufLen += i;
      if (this.bufLen < bs) return this;
      this.block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + bs <= data.length; i += bs) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i));
      this.bufLen = data.length - i;
    }
    return this;
  }

  digest() {
    const bs = this.blockSize;
    const lenBytes = bs === 128 ? 16 : 8;
    const lo = (this.total * 8) % 0x1_0000_0000;
    const hi = Math.floor(this.total / 0x2000_0000);
    const pad = new Uint8Array((this.bufLen + 1 + lenBytes <= bs ? bs : 2 * bs) - this.bufLen);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    if (this.littleEndian) {
      view.setUint32(pad.length - 8, lo, true);
      view.setUint32(pad.length - 4, hi, true);
    } else {
      view.setUint32(pad.length - 8, hi);
      view.setUint32(pad.length - 4, lo);
    }
    this.update(pad);
    return this.output();
  }
}

export const readBE = (d: Uint8Array, i: number) => (d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3];

export function wordsBE(words: Int32Array, count = words.length) {
  const out = new Uint8Array(count * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) view.setInt32(i * 4, words[i]);
  return out;
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
