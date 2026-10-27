// Office conversions, both ways, on the real pages: the files are checked, not just the buttons.
// Fixtures: tests/fixtures/office (node tests/fixtures/office/generate.mjs)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { openTool } from './helpers';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/office/${name}`, import.meta.url));
const fileInput = (page: Page) => page.locator('section[aria-label="Tool"] input[type=file]').first();
const press = (target: Locator, o?: { timeout?: number }) => (test.info().project.use.hasTouch ? target.tap(o) : target.click(o));

async function download(page: Page, name: string | RegExp, timeout = 120_000) {
  const btn = page.getByRole('button', { name });
  await expect(btn).toBeEnabled({ timeout });
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), press(btn)]);
  return { name: d.suggestedFilename(), buf: await readFile((await d.path())!) };
}

/** every page's text, read by pdf.js */
async function pdfText(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' '));
  await doc.loadingTask.destroy();
  return pages;
}

const zipText = (buf: Buffer, path: string) => strFromU8(unzipSync(new Uint8Array(buf))[path]);

test.describe('office to pdf', () => {
  test('word-to-pdf', async ({ page }) => {
    const errors = await openTool(page, 'word-to-pdf');
    await fileInput(page).setInputFiles(fixture('sample.docx'));
    const out = await download(page, 'Download PDF');
    expect(out.name).toBe('sample.pdf');
    const pages = await pdfText(out.buf);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages[0]).toContain('Project Falcon Proposal');
    // list markers, table cells, header and footer on every page, the last paragraph
    expect(pages[0]).toMatch(/•\s*Lower fuel costs/);
    expect(pages[0]).toMatch(/1\.\s*Pilot in two cities/);
    expect(pages[0]).toContain('61,500');
    for (const p of pages) expect(p).toContain('Project Falcon · Confidential');
    expect(pages.slice(-2).join(' ')).toContain('Week 30.');
    expect(pages.at(-1)).toContain('budget for next year.');
    expect(errors).toEqual([]);
  });

  test('excel-to-pdf', async ({ page }) => {
    const errors = await openTool(page, 'excel-to-pdf');
    await fileInput(page).setInputFiles(fixture('sample.xlsx'));
    const out = await download(page, 'Download PDF');
    const pages = await pdfText(out.buf);
    // 60 rows spill onto a second page; the Notes sheet starts a third
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('Sales by order, 2026');
    expect(pages[0]).toContain('$1,164.00');
    expect(pages[0]).toContain('14.0%');
    expect(pages[2]).toContain('Figures are unaudited.');
    const doc = await PDFDocument.load(out.buf);
    // the sheet asks for landscape
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
    expect(errors).toEqual([]);
  });

  test('powerpoint-to-pdf', async ({ page }) => {
    const errors = await openTool(page, 'powerpoint-to-pdf');
    await fileInput(page).setInputFiles(fixture('sample.pptx'));
    const out = await download(page, 'Download PDF');
    const pages = await pdfText(out.buf);
    expect(pages).toHaveLength(5);
    expect(pages[0]).toContain('Quarterly Business Review');
    expect(pages[1]).toContain('Churn down to 2.1%');
    expect(pages[2]).toContain('$860K');
    const doc = await PDFDocument.load(out.buf);
    expect(doc.getPage(0).getWidth() / doc.getPage(0).getHeight()).toBeCloseTo(16 / 9, 1);
    expect(errors).toEqual([]);
  });

  test('explains old .doc files', async ({ page }) => {
    const errors = await openTool(page, 'word-to-pdf');
    await fileInput(page).setInputFiles({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) });
    await expect(page.locator('section[aria-label="Tool"] [role=alert]')).toContainText('save it as .docx');
    expect(errors).toEqual([]);
  });

  test('turns away a workbook too big to lay out, with a reason', async ({ page }) => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Log');
    ws.getCell(1, 1).value = 'first';
    ws.getCell(80_000, 4).value = 'last';
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const errors = await openTool(page, 'excel-to-pdf');
    await fileInput(page).setInputFiles({ name: 'huge.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await expect(page.locator('section[aria-label="Tool"] [role=alert]')).toContainText('320,000 cells to print');
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(errors).toEqual([]);
  });
});

test.describe('pdf to office', () => {
  test('pdf-to-word', async ({ page }) => {
    const errors = await openTool(page, 'pdf-to-word');
    await fileInput(page).setInputFiles(fixture('report.pdf'));
    await expect(page.locator('section[aria-label="Tool"]')).toContainText('1 table', { timeout: 60_000 });
    const out = await download(page, 'Download .docx');
    expect(out.name).toBe('report.docx');
    const xml = zipText(out.buf, 'word/document.xml');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('Annual Report 2026');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('3,180,500');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:hyperlink');
    expect(errors).toEqual([]);
  });

  test('pdf-to-excel', async ({ page }) => {
    const errors = await openTool(page, 'pdf-to-excel');
    await fileInput(page).setInputFiles(fixture('statement.pdf'));
    await expect(page.locator('section[aria-label="Tool"]')).toContainText('first table found', { timeout: 60_000 });
    const out = await download(page, 'Download .xlsx');
    const sheet = zipText(out.buf, 'xl/worksheets/sheet1.xml');
    // amounts are numbers, not text
    expect(sheet).toContain('<v>-4.75</v>');
    expect(sheet).toContain('<v>3200</v>');
    expect(sheet).toContain('<v>4414.12</v>');
    expect(errors).toEqual([]);
  });

  test('pdf-to-powerpoint', async ({ page }) => {
    const errors = await openTool(page, 'pdf-to-powerpoint');
    await fileInput(page).setInputFiles(fixture('report.pdf'));
    const out = await download(page, 'Download .pptx');
    const files = Object.keys(unzipSync(new Uint8Array(out.buf)));
    expect(files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(2);
    expect(zipText(out.buf, 'ppt/notesSlides/notesSlide1.xml')).toContain('Annual Report 2026');
    expect(errors).toEqual([]);
  });

  test('jpg-to-word without OCR keeps the pictures', async ({ page }) => {
    const errors = await openTool(page, 'jpg-to-word');
    await fileInput(page).setInputFiles([fixture('scan.png'), fixture('scan.png')]);
    const out = await download(page, 'Download .docx');
    const xml = zipText(out.buf, 'word/document.xml');
    expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
    expect(errors).toEqual([]);
  });
});
