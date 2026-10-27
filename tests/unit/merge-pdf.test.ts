import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib';
import { hasAlpha, jpegOrientation, ORIENTATION_ROTATION } from '@/tools/lib/merge-pdf/image';
import { imagePageSize, imageToPdf, mergeDocs } from '@/tools/lib/merge-pdf/merge';
import { baseName, compareNames, groupByFile, outputFileName } from '@/tools/lib/merge-pdf/order';

const fixture = (name: string) => PDFDocument.load(readFileSync(`tests/fixtures/pdf/${name}`), { updateMetadata: false });

/** a header-only JPEG: SOI, optional EXIF orientation, SOF0 (w × h, 3 channels), EOI */
function jpeg(w: number, h: number, orientation?: number, littleEndian = false) {
  const parts: number[] = [0xff, 0xd8];
  if (orientation) {
    const u16 = (v: number) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255]);
    const u32 = (v: number) => (littleEndian ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
    const tiff = [...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  parts.push(0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9);
  return new Uint8Array(parts);
}

/** a w × h RGBA PNG, all pixels the same */
function png(w: number, h: number, rgba = [255, 0, 0, 255]) {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    out.set(data, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (1 + w * 4) + 1 + x * 4);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]));
}

describe('jpegOrientation', () => {
  it('reads the EXIF orientation in either byte order', () => {
    for (const o of [1, 3, 6, 8, 2, 5]) {
      expect(jpegOrientation(jpeg(40, 30, o))).toBe(o);
      expect(jpegOrientation(jpeg(40, 30, o, true))).toBe(o);
    }
  });
  it('defaults to 1', () => {
    expect(jpegOrientation(jpeg(40, 30))).toBe(1);
    expect(jpegOrientation(png(2, 2))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(1);
    expect(jpegOrientation(jpeg(40, 30, 9))).toBe(1);
  });
  it('maps only the unmirrored orientations to page rotations', () => {
    expect([1, 3, 6, 8].map((o) => ORIENTATION_ROTATION[o])).toEqual([0, 180, 90, 270]);
    expect(ORIENTATION_ROTATION[2]).toBeUndefined();
  });
});

describe('hasAlpha', () => {
  it('spots any transparent pixel', () => {
    expect(hasAlpha(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
    expect(hasAlpha(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
  });
});

describe('imagePageSize', () => {
  it('uses 96 dpi for small images', () => {
    expect(imagePageSize(400, 300)).toEqual([300, 225]);
  });
  it('caps the width at A4, portrait or landscape', () => {
    const [w, h] = imagePageSize(3000, 4000);
    expect(w).toBeCloseTo(595.28, 1);
    expect(h).toBeCloseTo(793.71, 1);
    expect(imagePageSize(4000, 3000)[0]).toBeCloseTo(841.89, 1);
  });
  it('keeps very tall images within the PDF page limit', () => {
    const [w, h] = imagePageSize(1000, 100_000);
    expect(h).toBeLessThanOrEqual(14_400);
    expect(w / h).toBeCloseTo(0.01, 4);
  });
});

describe('imageToPdf', () => {
  it('makes one edge-to-edge page from a JPEG, rotated for its orientation', async () => {
    const doc = await PDFDocument.load(await imageToPdf(jpeg(400, 300), 'jpeg'));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 225 });
    expect(doc.getPage(0).getRotation().angle).toBe(0);

    // a portrait phone photo stored landscape: sized for how it's seen
    const turned = await PDFDocument.load(await imageToPdf(jpeg(4000, 3000), 'jpeg', 90));
    const page = turned.getPage(0);
    expect(page.getRotation().angle).toBe(90);
    expect(page.getHeight()).toBeCloseTo(595.28, 1); // shown width
  });
  it('embeds PNGs with transparency', async () => {
    const doc = await PDFDocument.load(await imageToPdf(png(8, 4, [0, 0, 255, 128]), 'png'));
    expect(doc.getPage(0).getSize()).toEqual({ width: 6, height: 3 });
  });
});

describe('mergeDocs', () => {
  it('copies pages in plan order with extra rotation', async () => {
    const [a, b] = await Promise.all([fixture('sample-3-pages.pdf'), fixture('sample-mixed-sizes.pdf')]);
    const sources = new Map([
      ['a', a],
      ['b', b],
    ]);
    const plan = [
      { source: 'b', pageIndex: 1, rotation: 0 },
      { source: 'a', pageIndex: 2, rotation: 90 },
      { source: 'a', pageIndex: 0, rotation: 270 },
      { source: 'b', pageIndex: 0, rotation: 0 },
    ];
    const progress: number[] = [];
    const out = await mergeDocs(plan, sources, { title: 'combined' }, (done) => progress.push(done));
    expect(out.getPageCount()).toBe(4);
    expect(out.getPage(0).getSize()).toEqual(b.getPage(1).getSize());
    expect(out.getPage(1).getRotation().angle).toBe((a.getPage(2).getRotation().angle + 90) % 360);
    expect(out.getPage(2).getRotation().angle).toBe((a.getPage(0).getRotation().angle + 270) % 360);
    expect(progress.at(-1)).toBe(4);
    expect(out.getTitle()).toBe('combined');

    const reloaded = await PDFDocument.load(await out.save());
    expect(reloaded.getPageCount()).toBe(4);
  });

  it('keeps links between pages pointing at the merged pages, without orphan copies', async () => {
    const src = await PDFDocument.create();
    const [p0, , p2] = [src.addPage(), src.addPage(), src.addPage()];
    const link = src.context.register(src.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], P: p0.ref, Dest: [p2.ref, 'Fit'] }));
    p0.node.set(PDFName.of('Annots'), src.context.obj([link]));
    const loaded = await PDFDocument.load(await src.save());
    const plan = [0, 1, 2, 0].map((pageIndex) => ({ source: 's', pageIndex, rotation: 0 }));
    const out = await PDFDocument.load(await (await mergeDocs(plan, new Map([['s', loaded]]), { title: 'x' })).save());
    expect(out.getPageCount()).toBe(4);
    expect(new Set(out.getPages().map((p) => p.ref)).size).toBe(4); // the repeated page is a node of its own
    const annot = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    expect(annot.lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(out.getPage(2).ref);
    expect(annot.get(PDFName.of('P'))).toBe(out.getPage(0).ref);
    const pageObjects = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Page');
    expect(pageObjects.length).toBe(4);
  });

  it('adds one bookmark per file at its first page', async () => {
    const [a, b] = await Promise.all([fixture('sample-3-pages.pdf'), fixture('sample-mixed-sizes.pdf')]);
    const plan = [
      { source: 'a', pageIndex: 0, rotation: 0 },
      { source: 'a', pageIndex: 1, rotation: 0 },
      { source: 'b', pageIndex: 0, rotation: 0 },
    ];
    const out = await PDFDocument.load(
      await (await mergeDocs(plan, new Map([['a', a], ['b', b]]), { title: 'x', bookmarks: { a: 'Report', b: 'Résumé' } })).save(),
    );
    const outlines = out.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const first = outlines.lookup(PDFName.of('First'), PDFDict);
    const second = first.lookup(PDFName.of('Next'), PDFDict);
    expect(first.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Report');
    expect(second.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Résumé');
    const dest = second.lookup(PDFName.of('Dest'), PDFArray).get(0) as PDFRef;
    expect(dest).toBe(out.getPage(2).ref);
    expect(outlines.get(PDFName.of('Count'))?.toString()).toBe('2');
  });

  it("keeps the chosen file's document info", async () => {
    const src = await PDFDocument.create();
    src.addPage();
    src.setTitle('Annual report');
    src.setAuthor('Ada');
    src.setKeywords(['finance', 'q3']);
    src.setCreationDate(new Date('2020-05-01T00:00:00Z'));
    const loaded = await PDFDocument.load(await src.save(), { updateMetadata: false });
    const out = await mergeDocs([{ source: 's', pageIndex: 0, rotation: 0 }], new Map([['s', loaded]]), { title: 'fallback', metadataFrom: 's' });
    expect(out.getTitle()).toBe('Annual report');
    expect(out.getAuthor()).toBe('Ada');
    expect(out.getKeywords()).toBe('finance q3');
    expect(out.getCreationDate()?.toISOString()).toBe('2020-05-01T00:00:00.000Z');
  });
});

describe('ordering and naming', () => {
  it('groups pages by file order, keeping order within a file', () => {
    const p = (doc: string, n: number) => ({ doc: { id: doc }, n });
    const pages = [p('a', 2), p('b', 1), p('a', 1), p('c', 1), p('b', 0)];
    expect(groupByFile(pages, ['b', 'c', 'a']).map((x) => `${x.doc.id}${x.n}`)).toEqual(['b1', 'b0', 'c1', 'a2', 'a1']);
  });
  it('makes a safe .pdf file name', () => {
    expect(outputFileName('', 'report-merged.pdf')).toBe('report-merged.pdf');
    expect(outputFileName('  Q3 report v1.2 ', 'x.pdf')).toBe('Q3 report v1.2.pdf');
    expect(outputFileName('a/b:c', 'x.pdf')).toBe('a-b-c.pdf');
    expect(outputFileName('Final.PDF', 'x.pdf')).toBe('Final.pdf');
    expect(outputFileName(' .hidden ', 'x.pdf')).toBe('hidden.pdf');
    expect(outputFileName('.pdf', 'x.pdf')).toBe('x.pdf');
  });
  it('strips extensions and sorts naturally', () => {
    expect(baseName('scan 2.jpeg')).toBe('scan 2');
    expect(['page 10.pdf', 'page 2.pdf', 'Page 1.pdf'].sort(compareNames)).toEqual(['Page 1.pdf', 'page 2.pdf', 'page 10.pdf']);
  });
});
