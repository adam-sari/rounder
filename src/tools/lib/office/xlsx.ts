/*
 * Tables and text from a PDF → an .xlsx workbook (exceljs, MIT). Numbers become real numbers, so
 * sums and sorting work: "1,234.50", "(80.00)", "$12", "-4.75" and "12%" are recognized, while
 * codes with leading zeros, long digit strings and dates stay text exactly as written.
 */
import type { Workbook } from 'exceljs';
import type { Cell } from './model';

export type Decimal = '.' | ',';

export interface SheetData {
  name: string;
  rows: (string | Cell)[][];
  /** the first row is a header: bold, and frozen while scrolling */
  header?: boolean;
}

export interface ParsedNumber {
  value: number;
  /** Excel number format that shows it the way the PDF did */
  format: string;
}

/** Which decimal mark the document uses: "1.234,56" style numbers outnumbering "1,234.56" ones means a comma */
export function guessDecimal(texts: string[]): Decimal {
  let comma = 0;
  let dot = 0;
  for (const t of texts) {
    if (/\d\.\d{3},\d{1,2}\b|\b\d+,\d{2}\b(?![.,]\d)/.test(t)) comma++;
    if (/\d,\d{3}\.\d{1,2}\b|\b\d+\.\d{2}\b(?![.,]\d)/.test(t)) dot++;
  }
  return comma > dot ? ',' : '.';
}

const CURRENCY = /^[$€£¥₹]/;

/** A cell's text as a number, or null when it should stay text */
export function parseNumber(raw: string, decimal: Decimal = '.'): ParsedNumber | null {
  let t = raw.trim().replace(/−/g, '-');
  if (!t || t.length > 24) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) [negative, t] = [true, t.slice(1, -1).trim()];
  if (/^[-+]/.test(t)) [negative, t] = [negative || t[0] === '-', t.slice(1).trim()];
  if (/-$/.test(t)) [negative, t] = [true, t.slice(0, -1).trim()];
  const currency = CURRENCY.exec(t)?.[0] ?? '';
  t = t.replace(CURRENCY, '').replace(/\s?(USD|EUR|GBP|INR)$/i, '').trim();
  if (/^[-+]/.test(t)) [negative, t] = [negative || t[0] === '-', t.slice(1).trim()];
  const percent = t.endsWith('%');
  if (percent) t = t.slice(0, -1).trim();
  const group = decimal === '.' ? ',' : '.';
  const pattern = decimal === '.' ? /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/ : /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
  if (!pattern.test(t)) return null;
  const [whole, frac = ''] = t.split(decimal);
  const digits = whole.replaceAll(group, '');
  // "007", account numbers and the like are identifiers, not amounts
  if ((digits.length > 1 && digits.startsWith('0') && !frac) || digits.length > 15) return null;
  let value = Number(`${digits}.${frac || '0'}`) * (negative ? -1 : 1);
  if (percent) value /= 100;
  const places = frac.length;
  const grouped = whole.includes(group) || (currency && digits.length > 3);
  const base = `${grouped ? '#,##0' : '0'}${places ? `.${'0'.repeat(places)}` : ''}`;
  const format = percent ? `${base}%` : currency ? `${currency === '$' ? '"$"' : currency}${base}` : grouped || places ? base : 'General';
  return { value, format: negative && !percent && /^\(/.test(raw.trim()) ? `${format};(${format})` : format };
}

/** Builds the workbook; each sheet's columns are sized to their longest value */
export async function buildXlsx(sheets: SheetData[], { decimal = '.' as Decimal, title }: { decimal?: Decimal; title?: string } = {}): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rounder Tools (roundertools.com)';
  if (title) wb.title = title;
  const used = new Set<string>();
  for (const sheet of sheets) {
    // sheet names: 31 characters, no []:*?/\ and unique
    const clean = sheet.name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet';
    let name = clean.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${clean.slice(0, 26)} (${n})`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, sheet.header ? { views: [{ state: 'frozen', ySplit: 1 }] } : undefined);
    const widths: number[] = [];
    sheet.rows.forEach((row, r) => {
      const xr = ws.getRow(r + 1);
      row.forEach((c, k) => {
        const { text, bold } = typeof c === 'string' ? { text: c, bold: false } : c;
        if (!text) return;
        const cell = xr.getCell(k + 1);
        const num = sheet.header && r === 0 ? null : parseNumber(text, decimal);
        if (num) {
          cell.value = num.value;
          if (num.format !== 'General') cell.numFmt = num.format;
        } else cell.value = text;
        if (bold || (sheet.header && r === 0)) cell.font = { bold: true };
        widths[k] = Math.max(widths[k] ?? 0, Math.min(60, text.length + 2));
      });
    });
    widths.forEach((w, k) => (ws.getColumn(k + 1).width = Math.max(8, w)));
  }
  if (!sheets.length) wb.addWorksheet('Sheet1');
  return wb;
}

export async function xlsxBlob(wb: Workbook): Promise<Blob> {
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
