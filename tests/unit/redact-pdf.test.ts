import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getText, loadPdfjs, openPdf, textToString } from '@/engines/pdf';
import { boxFrom, mergeBoxes, toDisplayed, toUnrotated, type Box } from '@/tools/lib/redact-pdf/geometry';
import { buildIndex, compileQuery, findRanges, itemSpanBox, luhn, rangeBoxes, type Query, type TextItemLike } from '@/tools/lib/redact-pdf/search';
import { verifyRedaction } from '@/tools/lib/redact-pdf/verify';
import { detachPages, dropUnreachable, replacePageWithImage, stripHidden } from '@/tools/lib/redact-pdf/clean';

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
});

const round = (b: Box) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });

/** a horizontal item of `size` pt text with its baseline `base` pt from the top of an 800 pt page */
function item(str: string, x: number, base: number, width: number, extra: Partial<TextItemLike> = {}): TextItemLike {
  const size = 10;
  return { str, transform: [size, 0, 0, size, x, 800 - base], x, y: base - 8, width, height: 10, hasEOL: false, ...extra };
}
const VIEW = [0, 0, 600, 800];
const page = (items: TextItemLike[]) => ({ items, width: 600, height: 800, viewBox: VIEW });

describe('rotation', () => {
  const b = { x: 10, y: 20, width: 30, height: 40 };
  it('maps a box onto a page turned 90° clockwise', () => {
    // a 100 × 200 page shows as 200 × 100; its top-left corner moves to the top-right
    expect(toDisplayed(b, 90, 100, 200)).toEqual({ x: 140, y: 10, width: 40, height: 30 });
    expect(toDisplayed(b, 180, 100, 200)).toEqual({ x: 60, y: 140, width: 30, height: 40 });
    expect(toDisplayed(b, 270, 100, 200)).toEqual({ x: 20, y: 60, width: 40, height: 30 });
  });
  it('round-trips at every rotation', () => {
    for (const r of [0, 90, 180, 270, -90, 450]) expect(toUnrotated(toDisplayed(b, r, 100, 200), r, 100, 200)).toEqual(b);
  });
});

describe('mergeBoxes', () => {
  it('joins pieces on one line but not lines apart', () => {
    const merged = mergeBoxes([boxFrom(0, 0, 50, 10), boxFrom(52, 0, 90, 10), boxFrom(0, 30, 20, 40)]);
    expect(merged).toEqual([boxFrom(0, 0, 90, 10), boxFrom(0, 30, 20, 40)]);
  });
});

describe('buildIndex', () => {
  it('adds spaces at gaps and line breaks where lines change', () => {
    const items = [item('Jane', 10, 100, 20), item('Doe', 33, 100, 15), item('Line', 10, 120, 20), item('two', 30, 120, 15, { hasEOL: true }), item('end', 10, 140, 15)];
    const idx = buildIndex(items);
    expect(idx.text).toBe('Jane Doe\nLinetwo\nend');
    expect(idx.owner[4]).toBe(-1);
    expect([idx.owner[5], idx.offset[5]]).toEqual([1, 0]);
  });
  it('skips empty pieces and keeps existing spaces', () => {
    expect(buildIndex([item('a ', 0, 10, 10), item('', 20, 10, 0), item('b', 40, 10, 5)]).text).toBe('a b');
  });
});

const q = (over: Partial<Query>): Query => ({ text: '', regex: false, matchCase: false, wholeWord: false, presets: [], ...over });
const texts = (text: string, query: Partial<Query>) => findRanges(text, compileQuery(q(query)).matchers).map((r) => text.slice(r.start, r.end));

describe('search', () => {
  it('finds plain text across spacing and case', () => {
    expect(texts('Hi JANE\nDOE and jane doe.', { text: ' Jane  Doe ' })).toEqual(['JANE\nDOE', 'jane doe']);
    expect(texts('Jane jane', { text: 'Jane', matchCase: true })).toEqual(['Jane']);
  });
  it('escapes plain text and supports whole words', () => {
    expect(texts('cost $5.00 or 5x00', { text: '$5.00' })).toEqual(['$5.00']);
    expect(texts('ann anna Ann-Marie', { text: 'ann', wholeWord: true })).toEqual(['ann', 'Ann']);
  });
  it('runs regexes and reports bad ones', () => {
    expect(texts('ID-1234 ID-99', { text: String.raw`ID-\d{4}`, regex: true })).toEqual(['ID-1234']);
    expect(compileQuery(q({ text: '(unclosed', regex: true })).error).toMatch(/isn't valid/);
    // classic syntax still works where Unicode mode is stricter
    expect(texts('a-b', { text: String.raw`a\-b`, regex: true })).toEqual(['a-b']);
  });
  it('trims whitespace and never loops on empty matches', () => {
    expect(texts(' x ', { text: String.raw`\s*x\s*`, regex: true })).toEqual(['x']);
    expect(texts('abc', { text: 'z*', regex: true })).toEqual([]);
  });
  it('finds emails', () => {
    expect(texts('Mail jane.doe+tax@mail.example.co.uk, or bob@x.io. Not @handle or a@b.', { presets: ['email'] })).toEqual(['jane.doe+tax@mail.example.co.uk', 'bob@x.io']);
  });
  it('finds phone numbers but not dates or short numbers', () => {
    const text = 'Call (555) 123-4567, +44 20 7946 0958 or 555.123.4567. Born 12/05/1990, 2024-01-15, room 1234, ref 123-45-6789.';
    expect(texts(text, { presets: ['phone'] })).toEqual(['(555) 123-4567', '+44 20 7946 0958', '555.123.4567']);
  });
  it('finds card numbers that pass the Luhn check', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(texts('Card 4111 1111 1111 1111, 5500-0000-0000-0004, bad 4111 1111 1111 1112', { presets: ['card'] })).toEqual(['4111 1111 1111 1111', '5500-0000-0000-0004']);
  });
  it('finds SSNs with consistent separators only', () => {
    expect(texts('SSN 123-45-6789, 123 45 6789, not 123-45 6789, 000-12-3456 or 123456789', { presets: ['ssn'] })).toEqual(['123-45-6789', '123 45 6789']);
  });
  it('merges overlapping matches from several patterns', () => {
    const text = 'reach jane@x.io';
    const { matchers } = compileQuery(q({ text: 'jane', presets: ['email'] }));
    expect(findRanges(text, matchers)).toEqual([{ start: 6, end: 15, preset: 'email' }]);
  });
});

describe('boxes for matches', () => {
  it('covers part of an item, padded at the cut', () => {
    const it0 = item('Name: Jane', 100, 200, 100);
    const box = itemSpanBox(it0, 6, 10, VIEW);
    // "Jane" is the last 4 of 10 characters: x 160–200, minus 0.3 em of padding on the left
    expect(box.x).toBeCloseTo(157);
    expect(box.x + box.width).toBeCloseTo(200.8);
    expect(box.y).toBeLessThan(192);
    expect(box.y + box.height).toBeGreaterThan(202);
  });
  it('bounds text turned 90°', () => {
    // reading upwards from (100, 500) in PDF space, i.e. 300 pt from the top
    const t: TextItemLike = { str: 'ABCD', transform: [0, 10, -10, 0, 100, 500], x: 92, y: 292, width: 40, height: 10, hasEOL: false };
    const box = round(itemSpanBox(t, 0, 4, VIEW));
    expect(box.x).toBe(91);
    expect(box.width).toBe(12);
    expect(box.y).toBe(259);
    expect(box.height).toBe(42);
  });
  it('mirrors the split for right-to-left text', () => {
    const ltr = itemSpanBox(item('abcd', 0, 100, 40), 0, 2, VIEW);
    const rtl = itemSpanBox(item('abcd', 0, 100, 40, { dir: 'rtl' }), 0, 2, VIEW);
    expect(ltr.x).toBeLessThan(5);
    expect(rtl.x).toBeGreaterThan(15);
  });
  it('turns a match across two items into one bar', () => {
    const p = page([item('Jane', 10, 100, 20), item('Doe', 33, 100, 15)]);
    const idx = buildIndex(p.items);
    const [r] = findRanges(idx.text, compileQuery(q({ text: 'jane doe' })).matchers);
    const boxes = rangeBoxes(p, idx, r.start, r.end);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBeLessThan(10);
    expect(boxes[0].x + boxes[0].width).toBeGreaterThan(48);
  });
  it('lands on real text from pdf.js', async () => {
    const doc = await openPdf(new Uint8Array(readFileSync('tests/fixtures/pdf/sample-3-pages.pdf')));
    const text = await getText(doc, 0);
    const idx = buildIndex(text.items);
    const [r] = findRanges(idx.text, compileQuery(q({ text: 'brown fox' })).matchers);
    const [box] = rangeBoxes(text, idx, r.start, r.end);
    // 12 pt Helvetica, baseline 72 pt above the bottom of a 792 pt page, starting at x 48
    expect(box.y).toBeLessThan(720);
    expect(box.y + box.height).toBeGreaterThan(720);
    expect(box.x).toBeGreaterThan(48 + 40);
    expect(box.width).toBeGreaterThan(40);
    expect(box.width).toBeLessThan(90);
    await doc.destroy();
  });
});

describe('verifyRedaction', () => {
  it('confirms what is gone and reports what is left', () => {
    const result = verifyRedaction(
      [
        { page: 0, text: 'jane@x.io' },
        { page: 0, text: 'Jane  Doe' },
        { page: 1, text: '555 1234' },
      ],
      ['', 'see JANE DOE again', ''],
      [0, 2],
      [{ where: 'bookmarks', text: 'Call 555 1234' }],
    );
    // Jane Doe is gone from page 1 (index 0) even though another copy is left on page 2
    expect(result.confirmed).toBe(2);
    expect(result.total).toBe(3);
    expect(result.leftovers).toEqual([
      { text: 'Jane  Doe', pages: [1], places: [] },
      { text: '555 1234', pages: [], places: ['bookmarks'] },
    ]);
    expect(result.textOnRedacted).toEqual([]);
  });
  it('flags text left in extra places and on redacted pages', () => {
    const result = verifyRedaction([{ page: 0, text: 'Secret' }], ['still secret'], [0], [{ where: 'the document properties', text: 'Secret plan' }]);
    expect(result.confirmed).toBe(0);
    expect(result.leftovers[0]).toMatchObject({ pages: [0], places: ['the document properties'] });
    expect(result.textOnRedacted).toEqual([0]);
  });
});

/** a 1 × 1 grey PNG, standing in for the rasterized page */
function pixel() {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 128]))), chunk('IEND', Buffer.alloc(0))]);
}

async function sample() {
  const doc = await PDFDocument.create();
  doc.setTitle('Case file for Jane Doe');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const p1 = doc.addPage([600, 800]);
  p1.drawText('Public introduction', { x: 50, y: 700, size: 14, font });
  form.createTextField('city').addToPage(p1, { x: 50, y: 600, width: 200, height: 20 });
  form.getTextField('city').setText('Springfield');
  const p2 = doc.addPage([600, 800]);
  p2.drawText('Secret: jane@example.com', { x: 50, y: 700, size: 14, font });
  form.createTextField('ssn').addToPage(p2, { x: 50, y: 600, width: 200, height: 20 });
  form.getTextField('ssn').setText('123-45-6789');
  const note = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: 'jane@example.com' });
  p2.node.addAnnot(doc.context.register(note));
  return PDFDocument.load(await doc.save(), { updateMetadata: false });
}

async function allText(bytes: Uint8Array) {
  const view = await openPdf(bytes);
  const pages = [];
  for (let i = 0; i < view.numPages; i++) pages.push(textToString((await getText(view, i)).items));
  await view.destroy();
  return pages;
}

describe('true redaction (pdf-lib)', () => {
  it('leaves no trace of a replaced page, its comments or its form fields', async () => {
    const doc = await sample();
    const page2 = doc.getPage(1).node;
    const contents = page2.get(PDFName.of('Contents'))!;
    const oldRefs = [...(contents instanceof PDFArray ? contents.asArray() : [contents]), ...page2.Annots()!.asArray()];

    await detachPages(doc, [1]);
    const image = await doc.embedPng(pixel());
    await replacePageWithImage(doc, 1, image.ref, [0, 0, 600, 800]);
    expect(await dropUnreachable(doc)).toBeGreaterThan(0);
    const bytes = await doc.save();

    const pages = await allText(bytes);
    expect(pages[0]).toContain('Public introduction');
    expect(pages[1].trim()).toBe('');

    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(1).getSize()).toEqual({ width: 600, height: 800 });
    for (const ref of oldRefs) expect(out.context.lookup(ref as never)).toBeUndefined();
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['city']);
    // every object left in the file is one the document still uses
    expect(await dropUnreachable(out)).toBe(0);
  });

  it('keeps the page rotation and size of the visible box', async () => {
    const doc = await PDFDocument.load(readFileSync('tests/fixtures/pdf/sample-mixed-sizes.pdf'), { updateMetadata: false });
    const image = await doc.embedPng(pixel());
    await replacePageWithImage(doc, 3, image.ref, [0, 0, 595.28, 841.89]);
    const out = await PDFDocument.load(await doc.save());
    expect(out.getPage(3).getRotation().angle).toBe(90);
    expect(out.getPage(3).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  it("drops a redacted page's images from resources shared with other pages", async () => {
    for (const where of ['shared', 'inherited'] as const) {
      const made = await PDFDocument.create();
      const [a, b, c] = [await made.embedPng(pixel()), await made.embedPng(pixel()), await made.embedPng(pixel())];
      const res = made.context.register(made.context.obj({ XObject: { A: a.ref, B: b.ref, C: c.ref } }));
      for (const draw of ['/A Do', '/B Do /C Do']) {
        const p = made.addPage([600, 800]);
        p.node.set(PDFName.of('Contents'), made.context.register(made.context.flateStream(`q 10 0 0 10 0 0 cm ${draw} Q`)));
        if (where === 'shared') p.node.set(PDFName.of('Resources'), res);
        else p.node.delete(PDFName.of('Resources'));
      }
      if (where === 'inherited') made.catalog.Pages().set(PDFName.of('Resources'), res);
      const doc = await PDFDocument.load(await made.save({ useObjectStreams: false }), { updateMetadata: false });

      await detachPages(doc, [1]);
      await replacePageWithImage(doc, 1, (await doc.embedPng(pixel())).ref, [0, 0, 600, 800]);
      await dropUnreachable(doc);
      const out = await PDFDocument.load(await doc.save(), { updateMetadata: false });
      expect(out.context.lookup(a.ref), where).toBeDefined();
      expect(out.context.lookup(b.ref), where).toBeUndefined();
      expect(out.context.lookup(c.ref), where).toBeUndefined();
      expect(out.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'))).toBeDefined();
    }
  });

  it('drops removed fields from the calculation order and the XFA copy', async () => {
    const doc = await sample();
    const form = doc.catalog.lookup(PDFName.of('AcroForm')) as import('pdf-lib').PDFDict;
    // the same fields, listed again as the calculation order
    form.set(PDFName.of('CO'), form.lookup(PDFName.of('Fields'), PDFArray).clone());
    form.set(PDFName.of('XFA'), doc.context.register(doc.context.stream('<xdp>123-45-6789</xdp>')));
    await detachPages(doc, [1]);
    await replacePageWithImage(doc, 1, (await doc.embedPng(pixel())).ref, [0, 0, 600, 800]);
    await dropUnreachable(doc);
    const bytes = await doc.save({ useObjectStreams: false });
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect((out.catalog.lookup(PDFName.of('AcroForm')) as import('pdf-lib').PDFDict).lookup(PDFName.of('CO'), PDFArray).size()).toBe(1);
    expect(await dropUnreachable(out)).toBe(0);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['city']);
    expect(Buffer.from(bytes).includes('123-45-6789')).toBe(false);
  });

  it('strips metadata and extras on request', async () => {
    const doc = await sample();
    await stripHidden(doc, { metadata: true, extras: true });
    await dropUnreachable(doc);
    const out = await PDFDocument.load(await doc.save(), { updateMetadata: false });
    expect(out.getTitle()).toBeUndefined();
    expect(out.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
    expect(out.getPages().every((p) => !p.node.Annots())).toBe(true);
    expect((await allText(await out.save()))[0]).toContain('Public introduction');
  });
});
