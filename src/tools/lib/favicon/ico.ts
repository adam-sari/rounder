export interface IcoEntry {
  /** 1–256 */
  size: number;
  /** a complete PNG file */
  png: Uint8Array;
}

/**
 * Packs PNG images into a .ico container. PNG-compressed entries are supported by
 * every browser and by Windows since Vista, and are far smaller than raw bitmaps.
 */
export function buildIco(entries: IcoEntry[]): Uint8Array {
  const HEADER = 6;
  const DIR = 16;
  let offset = HEADER + DIR * entries.length;
  const out = new Uint8Array(offset + entries.reduce((n, e) => n + e.png.length, 0));
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon
  view.setUint16(4, entries.length, true);

  entries.forEach((e, i) => {
    if (e.size < 1 || e.size > 256) throw new RangeError(`ICO sizes must be 1–256, got ${e.size}`);
    const at = HEADER + DIR * i;
    out[at] = e.size % 256; // 0 means 256
    out[at + 1] = e.size % 256;
    out[at + 2] = 0; // palette colors
    out[at + 3] = 0; // reserved
    view.setUint16(at + 4, 1, true); // color planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, e.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(e.png, offset);
    offset += e.png.length;
  });
  return out;
}

/** what goes in an .ico: browsers need 16–48; Windows shortcuts, the taskbar and Explorer's large views use up to 256 */
export const ICO_SIZES = { favicon: [16, 32, 48], windows: [16, 24, 32, 48, 64, 128, 256] } as const;
export type IcoSet = keyof typeof ICO_SIZES;
