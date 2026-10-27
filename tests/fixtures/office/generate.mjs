/*
 * Real-world-like documents for the Office conversions. Run from the project root:
 *   node tests/fixtures/office/generate.mjs
 *
 * report.pdf      2 pages: title, subtitle, headings, justified body, bullet + nested + numbered
 *                 lists, a ruled table with a bold header, a picture with a caption, a colored
 *                 heading, a link, then a two-column page
 * statement.pdf   a bank statement: header block, a 14-row transaction table with dates,
 *                 thousands separators and negative amounts, totals
 * scanned.pdf     one page that is only a picture of text (needs OCR); scan.png is the same picture
 * sample.docx     headings, styled runs, lists, a shaded table, a picture, page break, header/footer
 * sample.xlsx     two sheets: styled header, currency/percent/date formats, a merged title,
 *                 column widths, 60 rows (spans pages), formulas with cached results
 * sample.pptx     5 slides: title, bullets, table, chart, picture with shapes
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfLib from 'pdf-lib';
import { Resvg } from '@resvg/resvg-js';
import * as docx from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';

const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = pdfLib;
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
const save = (name, bytes) => {
  writeFileSync(join(here, name), bytes);
  console.log(`${name.padEnd(16)} ${bytes.length} bytes`);
};

/** a PNG chart-like picture, drawn from SVG */
const chartPng = (w = 480, h = 260) =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8def"/><stop offset="1" stop-color="#1d3f8f"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="#f4f6fb"/>
      ${[0.35, 0.6, 0.45, 0.8, 0.7, 0.92].map((v, i) => `<rect x="${40 + i * 70}" y="${h - 30 - v * (h - 60)}" width="44" height="${v * (h - 60)}" fill="url(#g)" rx="4"/>`).join('')}
      <line x1="30" y1="${h - 30}" x2="${w - 20}" y2="${h - 30}" stroke="#333" stroke-width="2"/>
    </svg>`,
  )
    .render()
    .asPng();

/** Wraps text to a width with a font, returning lines */
function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws justified text (word spacing stretched) and returns the y below it */
function justified(page, text, { x, y, width, font, size, leading = size * 1.35 }) {
  const lines = wrap(text, font, size, width);
  lines.forEach((l, i) => {
    const words = l.split(' ');
    const last = i === lines.length - 1;
    const extra = last || words.length < 2 ? 0 : (width - font.widthOfTextAtSize(l, size)) / (words.length - 1);
    let cx = x;
    for (const w of words) {
      page.drawText(w, { x: cx, y, size, font });
      cx += font.widthOfTextAtSize(w + ' ', size) + extra;
    }
    y -= leading;
  });
  return y;
}

const LOREM =
  'Quarterly revenue grew across every region, led by strong demand for the new subscription plans. Operating costs stayed flat while headcount rose slightly, so margins improved for the third quarter in a row. The board approved the expansion budget for next year.';

async function report() {
  const doc = await PDFDocument.create();
  doc.setTitle('Annual Report 2026');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const W = 612;
  const M = 72;
  const TW = W - 2 * M;
  let page = doc.addPage([W, 792]);
  let y = 720;
  const center = (t, font, size, color) => page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  center('Annual Report 2026', bold, 24);
  y -= 26;
  center('Prepared for the board of directors', italic, 12, rgb(0.35, 0.35, 0.35));
  y -= 40;
  page.drawText('1. Summary', { x: M, y, size: 16, font: bold });
  y -= 24;
  y = justified(page, LOREM, { x: M, y, width: TW, font: regular, size: 11 });
  y -= 10;
  y = justified(page, 'Customer satisfaction reached a record high. Support response times halved after the new help center launched in the spring.', { x: M, y, width: TW, font: regular, size: 11 });
  y -= 14;
  page.drawText('Highlights', { x: M, y, size: 11, font: bold });
  y -= 18;
  for (const [level, t] of [[0, 'Revenue up 18% year over year'], [0, 'Three new regional offices'], [1, 'Lisbon and Warsaw opened in June'], [0, 'Net promoter score of 61']]) {
    page.drawText('•', { x: M + 12 + level * 18, y, size: 11, font: regular });
    page.drawText(t, { x: M + 26 + level * 18, y, size: 11, font: regular });
    y -= 15;
  }
  y -= 8;
  for (const [n, t] of [[1, 'Approve the 2027 budget'], [2, 'Elect the audit committee'], [3, 'Review the hiring plan']]) {
    page.drawText(`${n}.`, { x: M + 12, y, size: 11, font: regular });
    page.drawText(t, { x: M + 26, y, size: 11, font: regular });
    y -= 15;
  }
  y -= 16;
  page.drawText('2. Results by region', { x: M, y, size: 16, font: bold, color: rgb(0.12, 0.31, 0.47) });
  y -= 26;
  const cols = [M, M + 150, M + 250, M + 350];
  const rows = [['Region', 'Revenue', 'Growth', 'Staff'], ['North America', '4,210,000', '+12%', '310'], ['Europe', '3,180,500', '+21%', '244'], ['Asia Pacific', '2,045,750', '+27%', '198'], ['Latin America', '640,200', '+9%', '61']];
  const top = y + 14;
  rows.forEach((r, i) => {
    r.forEach((c, j) => page.drawText(c, { x: cols[j] + 4, y, size: 10, font: i === 0 ? bold : regular }));
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: M + 440, y: y - 5 }, thickness: 0.5 });
    y -= 19;
  });
  for (const x of [...cols, M + 440]) page.drawLine({ start: { x, y: top }, end: { x, y: y + 14 }, thickness: 0.5 });
  page.drawLine({ start: { x: M, y: top }, end: { x: M + 440, y: top }, thickness: 0.5 });
  y -= 16;
  const png = await doc.embedPng(chartPng());
  page.drawImage(png, { x: M + 60, y: y - 170, width: 312, height: 169 });
  y -= 186;
  center('Figure 1: Revenue by quarter', italic, 9);
  y -= 22;
  page.drawText('Full figures are online at ', { x: M, y, size: 11, font: regular });
  const lx = M + regular.widthOfTextAtSize('Full figures are online at ', 11);
  const label = 'example.com/report';
  page.drawText(label, { x: lx, y, size: 11, font: regular, color: rgb(0.02, 0.27, 0.75) });
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [lx, y - 2, lx + regular.widthOfTextAtSize(label, 11), y + 10], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/report') } });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));

  // page 2: a heading across two columns of text
  page = doc.addPage([W, 792]);
  y = 720;
  page.drawText('3. Outlook', { x: M, y, size: 16, font: bold });
  const colW = (TW - 24) / 2;
  for (const [k, x] of [[0, M], [1, M + colW + 24]]) {
    let cy = y - 30;
    for (let p = 0; p < 3; p++) {
      cy = justified(page, `${k ? 'Right' : 'Left'} column paragraph ${p + 1}. ${LOREM}`, { x, y: cy, width: colW, font: regular, size: 10 });
      cy -= 8;
    }
  }
  save('report.pdf', await doc.save());
}

async function statement() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  let y = 730;
  page.drawText('Northwind Bank', { x: 50, y, size: 18, font: bold });
  page.drawText('Statement period: Sep 1 - Sep 30, 2026', { x: 340, y, size: 9, font: regular });
  y -= 18;
  page.drawText('Account 0042-118-55  ·  Checking', { x: 50, y, size: 10, font: regular });
  y -= 36;
  const x = [50, 120, 380, 470];
  const right = (t, colRight, f = regular) => page.drawText(t, { x: colRight - f.widthOfTextAtSize(t, 9), y, size: 9, font: f });
  ['Date', 'Description'].forEach((t, i) => page.drawText(t, { x: x[i], y, size: 9, font: bold }));
  right('Amount', 450, bold);
  right('Balance', 540, bold);
  y -= 16;
  let balance = 2450.1;
  const tx = [
    ['09/01', 'Opening balance', 0], ['09/02', 'Coffee Corner', -4.75], ['09/03', 'Salary ACME Corp', 3200], ['09/05', 'Rent September', -1450],
    ['09/08', 'Grocery Mart', -86.32], ['09/09', 'Electric utility', -71.08], ['09/12', 'Transfer from savings', 500], ['09/15', 'Gym membership', -39.99],
    ['09/18', 'Bookshop', -23.5], ['09/21', 'Pharmacy', -12.4], ['09/24', 'Refund Online Store', 59.99], ['09/26', 'Restaurant Da Mario', -64.2],
    ['09/28', 'Phone bill', -45], ['09/30', 'Interest', 1.27],
  ];
  const fmt = (n) => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const [d, desc, amt] of tx) {
    balance += amt;
    page.drawText(d, { x: x[0], y, size: 9, font: regular });
    page.drawText(desc, { x: x[1], y, size: 9, font: regular });
    if (amt) right(fmt(amt), 450);
    right(fmt(balance), 540);
    y -= 15;
  }
  y -= 10;
  page.drawLine({ start: { x: 50, y: y + 10 }, end: { x: 540, y: y + 10 }, thickness: 0.5 });
  page.drawText('Closing balance', { x: x[1], y, size: 9, font: bold });
  right(fmt(balance), 540, bold);
  y -= 40;
  page.drawText('Questions? Call 1-800-555-0100 or visit your branch.', { x: 50, y, size: 9, font: regular });
  save('statement.pdf', await doc.save());
}

async function scanned() {
  const lines = ['Meeting notes', '', 'The team agreed to move the launch to', 'the first week of November. Marketing', 'will prepare the announcement and the', 'support team will update the help pages.'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1275" height="1650"><rect width="100%" height="100%" fill="#fbfaf7"/>
    ${lines.map((l, i) => `<text x="150" y="${220 + i * 70}" font-family="Arial" font-size="${i ? 40 : 64}" font-weight="${i ? 400 : 700}" fill="#1a1a1a">${l}</text>`).join('')}</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  save('scan.png', png);
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 612, height: 792 });
  save('scanned.pdf', await doc.save());
}

async function word() {
  const { AlignmentType, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = docx;
  const cell = (text, opts = {}) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, color: opts.color })] })], shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined, width: { size: 2400, type: WidthType.DXA } });
  const d = new Document({
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Project Falcon · Confidential', color: '888888', size: 18 })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page footer', size: 18 })] })] }) },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('Project Falcon Proposal')] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Background')] }),
          new Paragraph({ children: [new TextRun('This proposal describes a '), new TextRun({ text: 'faster', bold: true }), new TextRun(' and '), new TextRun({ text: 'cheaper', italics: true }), new TextRun(' way to ship parcels. '), new TextRun({ text: 'Red text marks open questions.', color: 'C00000' })] }),
          new Paragraph({ text: 'Lower fuel costs', bullet: { level: 0 } }),
          new Paragraph({ text: 'Fewer handovers', bullet: { level: 0 } }),
          new Paragraph({ text: 'Tracked end to end', bullet: { level: 1 } }),
          new Paragraph({ text: 'Pilot in two cities', numbering: { reference: 'num', level: 0 } }),
          new Paragraph({ text: 'Measure delivery times', numbering: { reference: 'num', level: 0 } }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Budget')] }),
          new Table({
            width: { size: 9600, type: WidthType.DXA },
            rows: [
              new TableRow({ tableHeader: true, children: ['Item', 'Q1', 'Q2', 'Total'].map((t) => cell(t, { bold: true, fill: '1F4E79', color: 'FFFFFF' })) }),
              ...[['Vans', '12,000', '8,000', '20,000'], ['Staff', '30,500', '31,000', '61,500'], ['Software', '4,200', '1,100', '5,300']].map((r) => new TableRow({ children: r.map((t) => cell(t)) })),
            ],
          }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [new ImageRun({ type: 'png', data: chartPng(), transformation: { width: 420, height: 228 } })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Figure 1: Parcels per day', italics: true, size: 18 })] }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Timeline')] }),
          ...Array.from({ length: 30 }, (_, i) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(`Week ${i + 1}. ${LOREM}`)] })),
        ],
      },
    ],
  });
  save('sample.docx', await Packer.toBuffer(d));
}

async function excel() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rounder test fixtures';
  const ws = wb.addWorksheet('Sales 2026', { pageSetup: { orientation: 'landscape', paperSize: 1 } });
  ws.columns = [{ width: 12 }, { width: 26 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 12 }];
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'Sales by order, 2026';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  const head = ws.getRow(3);
  head.values = ['Date', 'Customer', 'Amount', 'Units', 'Unit price', 'Margin'];
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.border = { bottom: { style: 'thin' } };
  });
  const names = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Ltd', 'Hooli', 'Vandelay Industries', 'Stark Retail', 'Wayne Foods'];
  for (let i = 0; i < 60; i++) {
    const r = ws.getRow(4 + i);
    const units = 3 + ((i * 7) % 40);
    const price = 9.5 + ((i * 13) % 50);
    r.values = [new Date(Date.UTC(2026, i % 12, 1 + (i % 27))), names[i % names.length], { formula: `D${4 + i}*E${4 + i}`, result: units * price }, units, price, 0.05 + ((i * 3) % 30) / 100];
    r.getCell(1).numFmt = 'mm/dd/yyyy';
    r.getCell(3).numFmt = '$#,##0.00';
    r.getCell(5).numFmt = '$#,##0.00';
    r.getCell(6).numFmt = '0.0%';
    if (i % 2) r.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }));
  }
  const total = ws.getRow(65);
  total.values = ['Total', '', { formula: 'SUM(C4:C63)', result: 0 }];
  total.font = { bold: true };
  total.getCell(3).numFmt = '$#,##0.00';
  const ws2 = wb.addWorksheet('Notes');
  ws2.getCell('A1').value = 'Figures are unaudited.';
  ws2.getCell('A2').value = 'Prepared by the finance team.';
  save('sample.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
}

async function powerpoint() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  let s = pres.addSlide();
  s.background = { color: '1F2A44' };
  s.addText('Quarterly Business Review', { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
  s.addText('Q3 2026 · Sales team', { x: 0.5, y: 2.9, w: 9, h: 0.6, fontSize: 20, color: 'C9D3EA', align: 'center' });
  s = pres.addSlide();
  s.addText('What went well', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 30, bold: true, color: '1F2A44' });
  s.addText([{ text: 'Record bookings in September', options: { bullet: true } }, { text: 'Churn down to 2.1%', options: { bullet: true } }, { text: 'Two enterprise logos signed', options: { bullet: true, indentLevel: 1 } }], { x: 0.7, y: 1.3, w: 8.5, h: 3, fontSize: 22 });
  s = pres.addSlide();
  s.addText('Pipeline', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 30, bold: true });
  s.addTable([[{ text: 'Stage', options: { bold: true, fill: { color: 'DDE5F5' } } }, { text: 'Deals', options: { bold: true, fill: { color: 'DDE5F5' } } }, { text: 'Value', options: { bold: true, fill: { color: 'DDE5F5' } } }], ['Qualified', '42', '$1.2M'], ['Proposal', '17', '$860K'], ['Closing', '6', '$410K']], { x: 0.7, y: 1.4, w: 8.6, fontSize: 18, border: { type: 'solid', pt: 1, color: '999999' } });
  s = pres.addSlide();
  s.addText('Bookings by month', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 30, bold: true });
  s.addChart(pres.ChartType.bar, [{ name: 'Bookings', labels: ['Jul', 'Aug', 'Sep'], values: [320, 410, 530] }], { x: 1, y: 1.2, w: 8, h: 4, showValue: true });
  s = pres.addSlide();
  s.addText('Next steps', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 30, bold: true });
  s.addShape(pres.ShapeType.roundRect, { x: 0.7, y: 1.4, w: 3.6, h: 1.4, fill: { color: 'F4B183' }, rectRadius: 0.2 });
  s.addText('Hire two AEs', { x: 0.7, y: 1.4, w: 3.6, h: 1.4, fontSize: 20, align: 'center' });
  s.addShape(pres.ShapeType.ellipse, { x: 5, y: 1.4, w: 1.4, h: 1.4, fill: { color: '9DC3E6' } });
  s.addImage({ data: `data:image/png;base64,${chartPng(480, 260).toString('base64')}`, x: 5, y: 3, w: 4, h: 2.17 });
  save('sample.pptx', Buffer.from(await pres.write({ outputType: 'nodebuffer' })));
}

await report();
await statement();
await scanned();
await word();
await excel();
await powerpoint();
