import { describe, expect, it } from 'vitest';
import { crc32, orientationTiff, readOrientation, stripMetadata } from '../../src/tools/lib/exif/strip';
import { exposure, formatCoords, osmLink, summarize, text } from '../../src/tools/lib/exif/summary';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/* ---------------------------------- JPEG ---------------------------------- */

const seg = (marker: number, body: Uint8Array | number[]) => {
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  return cat([0xff, marker, (b.length + 2) >> 8, (b.length + 2) & 0xff], b);
};

/** little-endian TIFF with Orientation plus one other tag */
function leTiff(orientation: number) {
  const b = new Uint8Array(8 + 2 + 24 + 4);
  const v = new DataView(b.buffer);
  b.set(enc('II*\0'));
  v.setUint32(4, 8, true);
  v.setUint16(8, 2, true);
  v.setUint16(10, 0x010f, true); // Make
  v.setUint16(12, 2, true);
  v.setUint32(14, 4, true);
  b.set(enc('ACM\0'), 18);
  v.setUint16(22, 0x0112, true);
  v.setUint16(24, 3, true);
  v.setUint32(26, 1, true);
  v.setUint16(30, orientation, true);
  return b;
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const app0 = seg(0xe0, cat(enc('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const exifSeg = (o: number) => seg(0xe1, cat(enc('Exif\0\0'), leTiff(o)));
const xmpSeg = seg(0xe1, cat(enc('http://ns.adobe.com/xap/1.0/\0'), enc('<x:xmpmeta/>')));
const iccSeg = seg(0xe2, cat(enc('ICC_PROFILE\0'), [1, 1, 9, 9, 9, 9]));
const mpfSeg = seg(0xe2, cat(enc('MPF\0'), [0, 0, 0, 0]));
const iptcSeg = seg(0xed, cat(enc('Photoshop 3.0\0'), [1, 2, 3]));
const comSeg = seg(0xfe, enc('shot by alex'));
const app12 = seg(0xec, enc('Ducky'));
const adobe = seg(0xee, cat(enc('Adobe'), [0, 100, 0, 0, 0, 0, 1]));
const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
const sof = seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
const dht = seg(0xc4, [0, ...new Array(16).fill(0)]);
const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
// entropy data with a stuffed 0xFF and a restart marker, neither of which ends the scan
const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

describe('stripMetadata · JPEG', () => {
  const file = cat(SOI, app0, exifSeg(1), xmpSeg, iccSeg, mpfSeg, iptcSeg, comSeg, app12, adobe, dqt, sof, dht, sos, scan, EOI, enc('motion photo'));

  it('keeps image segments byte for byte and drops metadata', () => {
    const r = stripMetadata(file, 'jpeg');
    expect(r.bytes).toEqual(cat(SOI, app0, iccSeg, adobe, dqt, sof, dht, sos, scan, EOI));
    expect(r.wroteOrientation).toBe(false);
    expect(r.found.map((f) => [f.label, f.kept])).toEqual([
      ['EXIF', false],
      ['XMP', false],
      ['ICC profile', true],
      ['Extra images (MPF)', false],
      ['IPTC', false],
      ['Comment', false],
      ['APP12 data', false],
      ['Trailing data', false],
    ]);
    expect(r.found.find((f) => f.label === 'XMP')!.bytes).toBe(xmpSeg.length);
    expect(r.found.find((f) => f.label === 'Trailing data')!.bytes).toBe(12);
  });

  it('exposes the EXIF as a TIFF stream', () => {
    const r = stripMetadata(file, 'jpeg');
    expect(r.exif).toEqual(leTiff(1));
  });

  it('drops the ICC profile when asked', () => {
    const r = stripMetadata(file, 'jpeg', { keepIcc: false });
    expect(r.bytes).toEqual(cat(SOI, app0, adobe, dqt, sof, dht, sos, scan, EOI));
    expect(r.found.find((f) => f.label === 'ICC profile')!.kept).toBe(false);
  });

  it('writes back a 36-byte rotation-only EXIF after APP0', () => {
    const rotated = cat(SOI, app0, exifSeg(6), dqt, sof, sos, scan, EOI);
    const r = stripMetadata(rotated, 'jpeg');
    expect(r.orientation).toBe(6);
    expect(r.wroteOrientation).toBe(true);
    const app1 = cat([0xff, 0xe1, 0, 34], enc('Exif\0\0'), orientationTiff(6));
    expect(app1.length).toBe(36);
    expect(r.bytes).toEqual(cat(SOI, app0, app1, dqt, sof, sos, scan, EOI));
    expect(readOrientation(r.bytes.subarray(2 + app0.length + 4))).toBe(6);
  });

  it('puts the rotation EXIF straight after SOI when there is no APP0', () => {
    const r = stripMetadata(cat(SOI, exifSeg(8), dqt, sos, scan, EOI), 'jpeg');
    expect(Array.from(r.bytes.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect(readOrientation(r.bytes.subarray(6))).toBe(8);
  });

  it('can drop orientation too', () => {
    const r = stripMetadata(cat(SOI, exifSeg(6), dqt, sos, scan, EOI), 'jpeg', { keepOrientation: false });
    expect(r.bytes).toEqual(cat(SOI, dqt, sos, scan, EOI));
    expect(r.orientation).toBe(6);
    expect(r.wroteOrientation).toBe(false);
  });

  it('walks progressive files with tables and comments between scans', () => {
    const progressive = cat(SOI, dqt, sof, sos, scan, dht, comSeg, sos, scan, EOI);
    const r = stripMetadata(progressive, 'jpeg');
    expect(r.bytes).toEqual(cat(SOI, dqt, sof, sos, scan, dht, sos, scan, EOI));
  });

  it('skips fill bytes before markers', () => {
    const r = stripMetadata(cat(SOI, [0xff], comSeg, dqt, sos, scan, EOI), 'jpeg');
    expect(r.bytes).toEqual(cat(SOI, dqt, sos, scan, EOI));
  });

  it('drops JFIF and JFXX thumbnails but keeps the JFIF header', () => {
    // 2×1 RGB thumbnail inside the JFIF header, plus a JFXX extension thumbnail
    const jfifThumb = seg(0xe0, cat(enc('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 2, 1], [9, 9, 9, 8, 8, 8]));
    const jfxx = seg(0xe0, cat(enc('JFXX\0'), [0x10, 0xff, 0xd8, 0xff, 0xd9]));
    const r = stripMetadata(cat(SOI, jfifThumb, jfxx, exifSeg(6), dqt, sos, scan, EOI), 'jpeg');
    const header = cat(app0.subarray(0, 16), [0, 0]);
    expect(header.length).toBe(18);
    expect(r.bytes.subarray(0, 20)).toEqual(cat(SOI, header));
    expect(r.found.find((f) => f.label === 'Thumbnail')!.bytes).toBe(6 + jfxx.length);
    // the rotation tag still lands after the (trimmed) JFIF header
    expect(Array.from(r.bytes.subarray(20, 22))).toEqual([0xff, 0xe1]);
    expect(r.bytes.subarray(20 + 36)).toEqual(cat(dqt, sos, scan, EOI));
  });

  it('returns a clean file unchanged', () => {
    const clean = cat(SOI, app0, dqt, sof, sos, scan, EOI);
    const r = stripMetadata(clean, 'jpeg');
    expect(r.bytes).toEqual(clean);
    expect(r.found).toEqual([]);
  });

  it('rejects files that are not JPEG or are cut off', () => {
    expect(() => stripMetadata(enc('nope'), 'jpeg')).toThrow(/not a valid JPEG/);
    expect(() => stripMetadata(cat(SOI, [0xff, 0xe1, 0x10, 0x00, 1, 2]), 'jpeg')).toThrow(/cut off/);
    expect(() => stripMetadata(cat(SOI, [0x12, 0x34]), 'jpeg')).toThrow(/damaged/);
  });
});

/* ---------------------------------- TIFF ---------------------------------- */

describe('orientation', () => {
  it('reads little- and big-endian TIFF, with or without the Exif prefix', () => {
    expect(readOrientation(leTiff(6))).toBe(6);
    expect(readOrientation(orientationTiff(3))).toBe(3);
    expect(readOrientation(cat(enc('Exif\0\0'), leTiff(8)))).toBe(8);
  });

  it('treats missing, invalid and junk data as upright', () => {
    expect(readOrientation(leTiff(0))).toBe(1);
    expect(readOrientation(leTiff(42))).toBe(1);
    expect(readOrientation(enc('hello world'))).toBe(1);
    expect(readOrientation(new Uint8Array(0))).toBe(1);
    const noTag = leTiff(6);
    noTag[8] = 1; // only the Make entry
    expect(readOrientation(noTag)).toBe(1);
  });

  it('builds a 26-byte TIFF', () => {
    const t = orientationTiff(6);
    expect(t.length).toBe(26);
    expect(ascii(t, 0, 4)).toBe('MM\0*');
  });
});

/* ----------------------------------- PNG ---------------------------------- */

const chunk = (type: string, data: Uint8Array | number[]) => {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = new Uint8Array(12 + d.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, d.length);
  out.set(enc(type), 4);
  out.set(d, 8);
  v.setUint32(8 + d.length, crc32(out.subarray(4, 8 + d.length)));
  return out;
};

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const srgb = chunk('sRGB', [0]);
const gama = chunk('gAMA', [0, 0, 0xb1, 0x8f]);
const iccp = chunk('iCCP', cat(enc('icc\0'), [0, 1, 2, 3]));
const textC = chunk('tEXt', enc('Author\0Alex'));
const ztxt = chunk('zTXt', cat(enc('Comment\0'), [0, 1, 2]));
const xmpC = chunk('iTXt', cat(enc('XML:com.adobe.xmp\0'), [0, 0, 0, 0], enc('<x/>')));
const time = chunk('tIME', [7, 232, 6, 1, 12, 0, 0]);
const idat = chunk('IDAT', [1, 2, 3, 4]);
const iend = chunk('IEND', []);

describe('stripMetadata · PNG', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc('IEND'))).toBe(0xae426082);
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });

  it('drops text, time and EXIF chunks and keeps color chunks', () => {
    const file = cat(SIG, ihdr, iccp, srgb, gama, textC, ztxt, xmpC, chunk('eXIf', leTiff(1)), time, idat, iend, enc('junk'));
    const r = stripMetadata(file, 'png');
    expect(r.bytes).toEqual(cat(SIG, ihdr, iccp, srgb, gama, idat, iend));
    expect(r.found.map((f) => [f.label, f.kept])).toEqual([
      ['ICC profile', true],
      ['Text', false],
      ['XMP', false],
      ['EXIF', false],
      ['Timestamp', false],
      ['Trailing data', false],
    ]);
    expect(r.found.find((f) => f.label === 'Text')!.bytes).toBe(textC.length + ztxt.length);
    expect(r.exif).toEqual(leTiff(1));
  });

  it('can drop the ICC profile but keeps sRGB and gAMA', () => {
    const r = stripMetadata(cat(SIG, ihdr, iccp, srgb, gama, idat, iend), 'png', { keepIcc: false });
    expect(r.bytes).toEqual(cat(SIG, ihdr, srgb, gama, idat, iend));
  });

  it('writes a valid rotation-only eXIf chunk straight after IHDR', () => {
    const r = stripMetadata(cat(SIG, ihdr, textC, chunk('eXIf', leTiff(6)), idat, iend), 'png');
    expect(r.wroteOrientation).toBe(true);
    expect(r.bytes).toEqual(cat(SIG, ihdr, chunk('eXIf', orientationTiff(6)), idat, iend));
  });

  it('rejects non-PNG and truncated files', () => {
    expect(() => stripMetadata(enc('GIF89a'), 'png')).toThrow(/not a valid PNG/);
    const cut = cat(SIG, ihdr, idat).subarray(0, 8 + ihdr.length + 10);
    expect(() => stripMetadata(cut, 'png')).toThrow(/cut off/);
  });
});

/* ---------------------------------- WebP ---------------------------------- */

const riff = (type: string, data: Uint8Array | number[]) => {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = new Uint8Array(8 + d.length + (d.length & 1));
  out.set(enc(type));
  new DataView(out.buffer).setUint32(4, d.length, true);
  out.set(d, 8);
  return out;
};
const webp = (...chunks: Uint8Array[]) => {
  const body = cat(...chunks);
  const head = cat(enc('RIFF'), [0, 0, 0, 0], enc('WEBP'));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return cat(head, body);
};
const vp8x = (flags: number) => riff('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ALPHA = 0x10;
const ICC = 0x20;
const EXIF = 0x08;
const XMP = 0x04;
const iccWebp = riff('ICCP', [1, 2, 3, 4]);
const alph = riff('ALPH', [0, 9, 9]); // odd length, so it carries a pad byte
const vp8l = riff('VP8L', [0x2f, 1, 2, 3, 4]);
const exifWebp = (o: number) => riff('EXIF', leTiff(o));
const xmpWebp = riff('XMP ', enc('<x:xmpmeta/>'));

describe('stripMetadata · WebP', () => {
  it('drops EXIF and XMP, clears their flags and fixes the RIFF size', () => {
    const file = webp(vp8x(ICC | ALPHA | EXIF | XMP), iccWebp, alph, vp8l, exifWebp(1), xmpWebp);
    const r = stripMetadata(file, 'webp');
    expect(r.bytes).toEqual(webp(vp8x(ICC | ALPHA), iccWebp, alph, vp8l));
    expect(new DataView(r.bytes.buffer).getUint32(4, true)).toBe(r.bytes.length - 8);
    expect(r.found.map((f) => [f.label, f.kept])).toEqual([
      ['ICC profile', true],
      ['EXIF', false],
      ['XMP', false],
    ]);
    expect(r.exif).toEqual(leTiff(1));
  });

  it('can drop the ICC profile and its flag', () => {
    const r = stripMetadata(webp(vp8x(ICC | ALPHA), iccWebp, alph, vp8l), 'webp', { keepIcc: false });
    expect(r.bytes).toEqual(webp(vp8x(ALPHA), alph, vp8l));
  });

  it('keeps rotation as a minimal EXIF chunk and sets its flag', () => {
    const r = stripMetadata(webp(vp8x(EXIF | XMP), vp8l, exifWebp(6), xmpWebp), 'webp');
    expect(r.wroteOrientation).toBe(true);
    expect(r.bytes).toEqual(webp(vp8x(EXIF), vp8l, riff('EXIF', orientationTiff(6))));
  });

  it('understands EXIF chunks written with the JPEG "Exif" prefix', () => {
    const r = stripMetadata(webp(vp8x(EXIF), vp8l, riff('EXIF', cat(enc('Exif\0\0'), leTiff(3)))), 'webp');
    expect(r.orientation).toBe(3);
    expect(r.exif).toEqual(leTiff(3));
  });

  it('leaves simple WebP alone apart from trailing bytes', () => {
    const simple = webp(riff('VP8 ', [1, 2, 3, 4]));
    const r = stripMetadata(cat(simple, enc('xyz')), 'webp');
    expect(r.bytes).toEqual(simple);
    expect(r.found).toEqual([{ label: 'Trailing data', bytes: 3, kept: false }]);
  });

  it('rejects non-WebP files', () => {
    expect(() => stripMetadata(cat(enc('RIFF'), [0, 0, 0, 0], enc('WAVE')), 'webp')).toThrow(/not a valid WebP/);
  });
});

/* --------------------------------- summary -------------------------------- */

describe('summarize', () => {
  it('groups the tags people care about', () => {
    const s = summarize({
      Make: 'Apple',
      Model: 'iPhone 15 Pro',
      LensModel: 'iPhone 15 Pro back camera 6.86mm f/1.78',
      ExposureTime: 0.008,
      FNumber: 1.78,
      ISO: 80,
      FocalLength: 6.86,
      FocalLengthIn35mmFormat: 24,
      DateTimeOriginal: new Date(2024, 5, 1, 14, 32),
      OffsetTimeOriginal: '+02:00',
      latitude: 48.85837,
      longitude: 2.294481,
      GPSAltitude: 35.4,
      Software: '17.5',
      Artist: 'Alex',
      MakerNote: new Uint8Array(10),
    });
    const g = Object.fromEntries(s.groups.map((x) => [x.id, Object.fromEntries(x.rows)]));
    expect(g.camera.Camera).toBe('Apple iPhone 15 Pro');
    expect(g.settings).toEqual({ Exposure: '1/125 s', Aperture: 'ƒ/1.8', ISO: '80', 'Focal length': '6.9 mm (24 mm equiv.)' });
    expect(g.date.Taken).toBe('2024-06-01 14:32 (UTC+02:00)');
    expect(g.location.Coordinates).toBeUndefined(); // shown on its own, with the map link
    expect(g.location.Altitude).toBe('35 m');
    expect(g.author.Author).toBe('Alex');
    expect(s.gps).toEqual({ lat: 48.85837, lon: 2.294481 });
    expect(s.all).toContainEqual(['MakerNote', '10 bytes of data']);
  });

  it("doesn't repeat the brand when the model already names it", () => {
    const s = summarize({ Make: 'NIKON CORPORATION', Model: 'NIKON D850' });
    expect(s.groups[0].rows).toEqual([['Camera', 'NIKON D850']]);
  });

  it('ignores empty values and a 0,0 location', () => {
    const s = summarize({ Artist: '  ', latitude: 0, longitude: 0 });
    expect(s.groups).toEqual([]);
    expect(s.gps).toBeUndefined();
  });

  it('formats values', () => {
    expect(exposure(2)).toBe('2 s');
    expect(exposure(1 / 4000)).toBe('1/4000 s');
    expect(formatCoords(-33.8688, -151.2093)).toBe('33.86880° S, 151.20930° W');
    expect(text(['a', '', 'b'])).toBe('a, b');
    expect(text({ lang: 'x-default', value: '© Alex' })).toBe('© Alex');
    expect(text('abc\0\0')).toBe('abc');
    expect(osmLink(48.85837, 2.294481)).toBe('https://www.openstreetmap.org/?mlat=48.858370&mlon=2.294481#map=16/48.858370/2.294481');
  });
});
