import type { Hasher } from './block';

const TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** CRC-32 as used by zip, gzip and PNG (IEEE 802.3, reflected) */
export class Crc32 implements Hasher {
  private crc = -1;

  update(data: Uint8Array) {
    let c = this.crc;
    for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    this.crc = c;
    return this;
  }

  digest() {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, ~this.crc);
    return out;
  }
}
