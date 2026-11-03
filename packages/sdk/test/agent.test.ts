// The 0.3 agent tools: documents as Markdown, spreadsheet inspection, PDF forms, true redaction, image prep and diff,
// and video contact sheets.
import { join } from 'node:path';
import { zipSync, zlibSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { files, findFfmpeg, image, loadCanvas, media, pdf, RounderError } from '@roundertools/sdk';
import { FX } from './helpers';

const P = (f: string) => join(FX, 'pdf', f);
const O = (f: string) => join(FX, 'office', f);

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => (b.reduce((c, x) => CRC[(c ^ x) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** an RGBA PNG of one colour, w × h, with an optional rectangle of another, written by hand (tests use the built SDK) */
function png(w: number, h: number, base: [number, number, number], patch?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }) {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inPatch = patch && x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
      raw.set([...(inPatch ? patch.rgb : base), 255], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('document-to-markdown', () => {
  it('reads Word: headings, lists, emphasis and tables', async () => {
    const md = await files.toMarkdown(O('sample.docx'));
    expect(md).toMatch(/^# Background$/m);
    expect(md).toMatch(/^## Budget$/m);
    expect(md).toContain('a **faster** and *cheaper* way');
    expect(md).toMatch(/^- Lower fuel costs\n- Fewer handovers\n {4}- Tracked end to end$/m);
    expect(md).toMatch(/^1\. Pilot in two cities$/m);
    expect(md).toContain('| Vans | 12,000 | 8,000 | 20,000 |');
  });

  it('reads PowerPoint: a section per slide, bullets, tables and chart data', async () => {
    const md = await files.toMarkdown(O('sample.pptx'));
    expect(md).toMatch(/^## Slide 1: Quarterly Business Review$/m);
    expect(md).toMatch(/^## Slide 2: What went well\n\n- Record bookings in September$/m);
    expect(md).toContain('| Qualified | 42 | $1.2M |');
    expect(md).toMatch(/_Chart \(bar\)_\n\n\| Category \| Bookings \|[\s\S]*\| Sep \| 530 \|/);
  });

  it('reads Excel: the title above the table, real header, ISO dates and percentages', async () => {
    const md = await files.toMarkdown(O('sample.xlsx'), { maxRows: 3 });
    expect(md).toContain('Sales by order, 2026\n\n| Date | Customer | Amount | Units | Unit price | Margin |');
    expect(md).toContain('| 2026-01-01 | Acme Corp | 28.5 | 3 | 9.5 | 5% |');
    expect(md).toMatch(/more rows not shown/);
  });

  it('reads CSV and PDF', async () => {
    const csv = await files.toMarkdown({ name: 'people.csv', data: new TextEncoder().encode('name;age\nAda;36\nAlan;41\n') });
    expect(csv).toContain('| name | age |\n| --- | --- |\n| Ada | 36 |');
    const md = await files.toMarkdown(P('sample-3-pages.pdf'));
    expect(md).toContain('The quick brown fox jumps over the lazy dog. Line for page 2.');
  });

  it('says what an old binary Office file needs', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(64).fill(0)]);
    await expect(files.toMarkdown({ name: 'old.docx', data: ole })).rejects.toMatchObject({ code: 'unsupported-input', message: expect.stringMatching(/old-style binary/) });
    await expect(files.toMarkdown({ name: 'notes.txt.docx', data: new TextEncoder().encode('hello') })).rejects.toBeInstanceOf(RounderError);
  });
});

describe('spreadsheet-inspector', () => {
  it('finds the header under a title row and profiles each column', async () => {
    const r = (await files.inspectSpreadsheet(O('sample.xlsx'))) as { sheets: { name: string; headerRow: number; above: string[]; rows: number; columnsInfo: { name: string; type: string; min?: string; sum?: number }[]; sample: Record<string, string>[] }[] };
    const s = r.sheets[0];
    expect(s.name).toBe('Sales 2026');
    expect(s.headerRow).toBe(3);
    expect(s.above).toEqual(['Sales by order, 2026']);
    expect(s.columnsInfo.map((c) => c.name)).toEqual(['Date', 'Customer', 'Amount', 'Units', 'Unit price', 'Margin']);
    expect(s.columnsInfo.find((c) => c.name === 'Date')!.type).toBe('date');
    const amount = s.columnsInfo.find((c) => c.name === 'Amount')!;
    expect(amount.type).toBe('number');
    expect(amount.sum).toBeGreaterThan(0);
    expect(s.sample).toHaveLength(5);
    expect(s.sample[0].Customer).toBe('Acme Corp');
  });

  it('reads CSV and names the delimiter', async () => {
    const r = (await files.inspectSpreadsheet({ name: 't.tsv', data: new TextEncoder().encode('city\tpop\nOslo\t709000\nBergen\t291000\n') })) as { delimiter: string; sheets: { rows: number; columnsInfo: { type: string; max?: string }[] }[] };
    expect(r.delimiter).toBe('tab');
    expect(r.sheets[0].rows).toBe(2);
    expect(r.sheets[0].columnsInfo[1]).toMatchObject({ type: 'number', max: '709000' });
  });
});

describe('PDF forms', () => {
  it('lists the fields, then fills them by name, label or loose spelling', async () => {
    const info = (await pdf.formFields(P('sample-form.pdf'))) as { fields: { name: string; type: string; options?: string[] }[] };
    expect(info.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['name:text', 'email:text', 'notes:text', 'country:dropdown', 'size:radio', 'agree:checkbox']);
    const out = await pdf.fillForm(P('sample-form.pdf'), { values: { Name: 'Jane Doe', email: 'jane@example.com', country: 'germany', size: 'M', agree: 'yes' } });
    expect(out.name).toBe('sample-form-filled.pdf');
    const form = (await PDFDocument.load(out.data)).getForm();
    expect(form.getTextField('name').getText()).toBe('Jane Doe');
    expect(form.getDropdown('country').getSelected()).toEqual(['Germany']);
    expect(form.getRadioGroup('size').getSelected()).toBe('M');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
  });

  it('takes JSON on the command line, flattens, and names the fields when one is wrong', async () => {
    const flat = await pdf.fillForm(P('sample-form.pdf'), { values: '{"name":"Ada"}', flatten: true });
    expect((await PDFDocument.load(flat.data)).getForm().getFields()).toHaveLength(0);
    await expect(pdf.fillForm(P('sample-form.pdf'), { values: { nmae: 'x' } })).rejects.toMatchObject({ code: 'invalid-options', message: expect.stringMatching(/no field called "nmae".*name, email/) });
    await expect(pdf.fillForm(P('sample-form.pdf'), { values: { size: 'XL' } })).rejects.toMatchObject({ message: expect.stringMatching(/choices: S, M, L/) });
  });
});

describe.runIf(!!loadCanvas())('redact-pdf (needs @napi-rs/canvas)', () => {
  it('removes the text for real, leaves other pages alone, and checks the result', async () => {
    const out = await pdf.redact(P('sample-3-pages.pdf'), { terms: ['lazy dog'], pages: '2' });
    expect(out.name).toBe('sample-3-pages-redacted.pdf');
    expect(out.meta).toMatchObject({ redactions: 1, pages: [2], verified: false });
    // page 2's text is gone; pages 1 and 3 keep theirs, so the check reports them
    const text = await pdf.toText({ name: 'r.pdf', data: out.data }, { markers: true });
    expect(text).toContain('Line for page 1.');
    expect(text).not.toContain('Line for page 2.');
    expect(out.warnings.join(' ')).toMatch(/"lazy dog" can still be found on page 1, 3 \(outside the pages you chose\)/);
  });

  it('redacts every page when asked, verified, and never echoes matched patterns', async () => {
    const out = await pdf.redact(P('sample-3-pages.pdf'), { terms: ['brown fox'] });
    expect(out.meta).toMatchObject({ redactions: 3, pages: [1, 2, 3], verified: true, matches: { text: 3 } });
    expect(JSON.stringify(out.meta)).not.toContain('brown fox');
  });

  it('says so when nothing matches, and writes nothing', async () => {
    await expect(pdf.redact(P('sample-3-pages.pdf'), { terms: ['zebra'] })).rejects.toMatchObject({ code: 'target-not-met' });
    await expect(pdf.redact(P('sample-3-pages.pdf'), {})).rejects.toMatchObject({ code: 'invalid-options' });
  });
});

describe('image-prep and image-diff', () => {
  it('shrinks to the model limits and re-encodes', async () => {
    const big = png(3000, 2000, [200, 120, 40]);
    const out = await image.prepare({ name: 'board.png', data: big });
    expect(out.name).toBe('board-prepped.jpg');
    // 1.15 MP at 3:2 is about 1313 × 875; the long-side limit (1568) is looser here
    expect(out.meta.width as number).toBeLessThanOrEqual(1568);
    expect((out.meta.width as number) * (out.meta.height as number)).toBeLessThanOrEqual(1.15e6);
    expect(out.data[0]).toBe(0xff);
  });

  it('never enlarges, and meets a byte limit', async () => {
    const small = png(200, 100, [10, 20, 30]);
    const out = await image.prepare({ name: 's.png', data: small }, { format: 'keep', maxSize: '50kb' });
    expect(out.meta).toMatchObject({ width: 200, height: 100 });
    expect(out.size).toBeLessThanOrEqual(50_000);
  });

  it('measures what changed and where', async () => {
    const a = png(200, 100, [255, 255, 255]);
    const b = png(200, 100, [255, 255, 255], { x: 120, y: 20, w: 40, h: 30, rgb: [0, 0, 0] });
    const out = await image.diff([{ name: 'a.png', data: a }, { name: 'b.png', data: b }]);
    expect(out.name).toBe('a-diff.png');
    expect(out.meta.identical).toBe(false);
    expect(out.meta.changedPercent).toBe(6);
    const [region] = out.meta.regions as { x: number; y: number; width: number; height: number }[];
    expect(region.x).toBeLessThanOrEqual(120);
    expect(region.x + region.width).toBeGreaterThanOrEqual(160);
    const same = await image.diff([{ name: 'a.png', data: a }, { name: 'a2.png', data: a }]);
    expect(same.meta).toMatchObject({ identical: true, changedPercent: 0, regions: [] });
  });
});

describe.runIf(!!findFfmpeg())('video-contact-sheet (needs ffmpeg)', () => {
  it('lays out labelled frames in a grid', async () => {
    const out = await media.contactSheet(join(FX, 'media/sample.mp4'), { frames: 6, columns: 3, width: 900 });
    expect(out.name).toBe('sample-contact-sheet.jpg');
    expect(out.meta).toMatchObject({ frames: 6, columns: 3, width: 900 });
    const times = out.meta.times as number[];
    expect(times).toHaveLength(6);
    expect(times[0]).toBeGreaterThan(0);
    expect(out.data.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
  });

});

describe('the Office readers are safe with hostile files', () => {
  it('refuses a document that unpacks to too much XML', async () => {
    // 400 MB of zeros compresses to almost nothing: a zip bomb dressed as a .docx
    const bomb = zipSync({ 'word/document.xml': [new Uint8Array(1), { level: 9 }] });
    const view = new DataView(bomb.buffer, bomb.byteOffset);
    // claim a huge uncompressed size in the central directory entry
    const cd = bomb.length - 22 - 46 - 'word/document.xml'.length;
    view.setUint32(cd + 24, 400 * 1024 * 1024, true);
    await expect(files.toMarkdown({ name: 'bomb.docx', data: bomb })).rejects.toBeInstanceOf(RounderError);
  });
});
