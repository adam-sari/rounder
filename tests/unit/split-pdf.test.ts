import { readFileSync } from 'node:fs';
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPages } from '@/tools/lib/split-pdf/extract';
import { everyN, fitChunks, groupLabel, halves, leftOut, outputName } from '@/tools/lib/split-pdf/plan';

describe('everyN', () => {
  it('chunks pages with a shorter last chunk', () => {
    expect(everyN(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(everyN(3, 1)).toEqual([[0], [1], [2]]);
    expect(everyN(3, 10)).toEqual([[0, 1, 2]]);
  });
  it('treats bad sizes as 1', () => {
    expect(everyN(2, 0)).toEqual([[0], [1]]);
    expect(everyN(2, NaN)).toEqual([[0], [1]]);
    expect(everyN(4, 2.7)).toEqual([[0, 1], [2, 3]]);
  });
});

describe('halves', () => {
  it('suggests two even ranges', () => {
    expect(halves(1)).toBe('1');
    expect(halves(2)).toBe('1, 2');
    expect(halves(10)).toBe('1-5, 6-10');
    expect(halves(7)).toBe('1-4, 5-7');
  });
});

describe('groupLabel and outputName', () => {
  it('labels runs, reversed runs and scattered pages', () => {
    expect(groupLabel([0, 1, 2])).toBe('1-3');
    expect(groupLabel([9, 8, 7])).toBe('10-8');
    expect(groupLabel([4])).toBe('5');
    expect(groupLabel([0, 2, 4])).toBe('1, 3, 5');
    expect(groupLabel([0, 1, 2, 5])).toBe('1-3, 6');
  });
  it('names files after their pages', () => {
    expect(outputName('report', [0, 1, 2], 0)).toBe('report-pages-1-3.pdf');
    expect(outputName('report', [4], 1)).toBe('report-page-5.pdf');
    expect(outputName('report', [0, 1, 2, 5], 0)).toBe('report-pages-1-3_6.pdf');
  });
  it('falls back to part numbers for long scattered picks', () => {
    const odd = Array.from({ length: 40 }, (_, i) => i * 2);
    expect(outputName('report', odd, 2)).toBe('report-part-3.pdf');
  });
});

describe('leftOut', () => {
  it('lists pages no group includes', () => {
    expect(leftOut([[0, 1], [4]], 6)).toEqual([2, 3, 5]);
    expect(leftOut([[0, 1, 2]], 3)).toEqual([]);
  });
});

describe('fitChunks', () => {
  // a fake PDF: 1000 bytes of overhead plus each page's size
  const fake = (sizes: number[]) => {
    let builds = 0;
    const build = async (start: number, end: number) => {
      builds++;
      return { size: 1000 + sizes.slice(start, end).reduce((a, b) => a + b, 0), start, end };
    };
    return { build, builds: () => builds };
  };

  it('packs as many pages as fit, in order', async () => {
    const { build } = fake(Array(10).fill(1000));
    const chunks = await fitChunks(10, 4500, build);
    expect(chunks.map((c) => [c.start, c.end])).toEqual([[0, 3], [3, 6], [6, 9], [9, 10]]);
    expect(chunks.every((c) => c.out.size <= 4500 && !c.over)).toBe(true);
  });

  it('gives an oversized page a file of its own and flags it', async () => {
    const { build } = fake([500, 500, 9000, 500]);
    const chunks = await fitChunks(4, 3000, build);
    expect(chunks.map((c) => [c.start, c.end, c.over])).toEqual([[0, 2, false], [2, 3, true], [3, 4, false]]);
  });

  it('returns one chunk when everything fits', async () => {
    const { build } = fake(Array(5).fill(100));
    const chunks = await fitChunks(5, 1e6, build, { guess: 2 });
    expect(chunks.map((c) => [c.start, c.end])).toEqual([[0, 5]]);
  });

  it('needs only a few builds per chunk on long documents', async () => {
    const sizes = Array.from({ length: 300 }, (_, i) => 800 + ((i * 37) % 400));
    const { build, builds } = fake(sizes);
    const chunks = await fitChunks(300, 30_000, build, { guess: 30 });
    // every chunk fits, and adding the next page would not have
    for (const c of chunks) {
      expect(c.out.size).toBeLessThanOrEqual(30_000);
      if (c.end < 300) expect(c.out.size + sizes[c.end]).toBeGreaterThan(30_000);
    }
    expect(chunks.at(-1)!.end).toBe(300);
    expect(builds()).toBeLessThan(chunks.length * 8);
  });

  it('reports each chunk as it is found', async () => {
    const { build } = fake(Array(6).fill(1000));
    const ends: number[] = [];
    await fitChunks(6, 3000, build, { onChunk: (c) => ends.push(c.end) });
    expect(ends).toEqual([2, 4, 6]);
  });

  it('keeps real PDFs under the limit', async () => {
    const src = await PDFDocument.load(readFileSync('tests/fixtures/pdf/sample-50-pages.pdf'));
    const build = async (start: number, end: number) => {
      const bytes = await (await extractPages(src, Array.from({ length: end - start }, (_, k) => start + k))).save();
      return { size: bytes.length, bytes };
    };
    const whole = (await build(0, 50)).size;
    const limit = Math.ceil(whole / 3);
    const chunks = await fitChunks(50, limit, build, { guess: 10 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.at(-1)!.end).toBe(50);
    for (const c of chunks) {
      expect(c.out.size).toBeLessThanOrEqual(limit);
      expect((await PDFDocument.load(c.out.bytes)).getPageCount()).toBe(c.end - c.start);
    }
  });
});

describe('extractPages', () => {
  // page 1 is a contents page linking to pages 2-5, which carry lots of text
  async function linked() {
    const doc = await PDFDocument.create();
    const pages = Array.from({ length: 5 }, () => doc.addPage([300, 300]));
    for (const p of pages.slice(1)) p.drawText(Array.from({ length: 4000 }, (_, k) => ((k * 7919) % 9973).toString(36)).join(' '), { size: 4, maxWidth: 290, lineHeight: 4, x: 5, y: 290 });
    const links = pages.slice(1).map((p, i) =>
      doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10 + i * 20, 100, 25 + i * 20], Dest: [p.ref, 'Fit'] })),
    );
    pages[0].node.set(PDFName.of('Annots'), doc.context.obj(links));
    pages[0].setRotation(degrees(90));
    pages[0].setCropBox(20, 30, 200, 200);
    return PDFDocument.load(await doc.save());
  }
  const destOf = (doc: PDFDocument, page: number, link: number) => {
    const annots = doc.getPage(page).node.lookup(PDFName.of('Annots'), PDFArray);
    return doc.context.lookup(annots.get(link), PDFDict).lookup(PDFName.of('Dest'), PDFArray).get(0);
  };

  it("doesn't carry linked pages along as hidden objects", async () => {
    const src = await linked();
    const naive = await PDFDocument.create();
    naive.addPage((await naive.copyPages(src, [0]))[0]);
    const one = await (await extractPages(src, [0])).save();
    expect(one.length).toBeLessThan((await naive.save()).length / 2);
    const out = await PDFDocument.load(one);
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getRotation().angle).toBe(90);
    expect(out.getPage(0).getCropBox()).toEqual({ x: 20, y: 30, width: 200, height: 200 });
  });

  it('keeps links between pages of the same file pointing at those pages', async () => {
    const out = await PDFDocument.load(await (await extractPages(await linked(), [0, 2])).save());
    expect(out.getPageCount()).toBe(2);
    expect(destOf(out, 0, 1)).toBe(out.getPage(1).ref); // link to source page 3
    expect(destOf(out, 0, 0)).not.toBeInstanceOf(PDFRef); // page 2 isn't in this file
  });

  it('copies a repeated page twice', async () => {
    const out = await PDFDocument.load(await (await extractPages(await linked(), [1, 1])).save());
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).ref).not.toBe(out.getPage(1).ref);
  });
});
