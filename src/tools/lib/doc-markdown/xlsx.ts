// Excel (.xlsx) → plain tables of strings: the values a person sees, read from the file's cached results (formulas are
// not recalculated). Dates come out as ISO dates, booleans as TRUE/FALSE, errors as their code ("#DIV/0!").
import { DocError, openPackage, type OfficePackage } from './package';
import { all, attr, isEl, kid, kids, local, relId, textOf, type XmlElement } from './xml';

export interface Sheet {
  name: string;
  hidden: boolean;
  /** dense rows, from A1 to the last used cell; empty cells are "" */
  rows: string[][];
  formulas: number;
  /** up to 10 example formulas, as "B7: =SUM(B2:B6)" */
  formulaSamples: string[];
  merged: number;
  /** the used range as Excel writes it ("A1:F120"), when present */
  dimension?: string;
}

export interface Workbook {
  sheets: Sheet[];
}

/** "AB12" → [11, 27] (row index, column index), zero-based */
export function cellIndex(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1];
}

/** 0 → "A", 27 → "AB" */
export function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** whether a number format shows a date or time: d, m, y, h or s outside quotes, brackets and escapes */
export function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '')
    .split(';')[0];
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

type CellFormat = 'date' | 'percent' | '';

/** what each cell style shows numbers as: a date or time, a percentage, or plain */
function cellFormats(pkg: OfficePackage): CellFormat[] {
  const doc = pkg.xml('xl/styles.xml');
  if (!doc) return [];
  const custom = new Map<number, string>();
  for (const f of all(doc, 'numFmt')) custom.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') ?? '');
  const xfs = all(doc, 'cellXfs')[0];
  return xfs
    ? kids(xfs, 'xf').map((xf) => {
        const id = Number(attr(xf, 'numFmtId') ?? 0);
        const code = custom.get(id);
        if (BUILTIN_DATES.has(id) || (code !== undefined && isDateFormat(code))) return 'date';
        if (id === 9 || id === 10 || (code !== undefined && /%/.test(code.replace(/"[^"]*"/g, '')))) return 'percent';
        return '';
      })
    : [];
}

function sharedStrings(pkg: OfficePackage): string[] {
  const doc = pkg.xml('xl/sharedStrings.xml');
  if (!doc) return [];
  // rich text: the runs' text, but not the phonetic guides (rPh) some East Asian files carry
  const text = (si: XmlElement): string => si.children.map((c) => (!isEl(c) ? '' : local(c.name) === 't' ? textOf(c) : local(c.name) === 'r' ? textOf(kid(c, 't') ?? '') : '')).join('');
  return all(doc, 'si').map(text);
}

/** an Excel serial date (days since 1899-12-30, or 1904-01-01) → "2024-03-01" or "2024-03-01 09:30" */
export function serialToIso(serial: number, date1904 = false): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0)) * 86400000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:00$/, '');
  if (Math.abs(serial) < 1 && serial !== 0) return time; // a time on its own
  return time === '00:00' ? day : `${day} ${time}`;
}

/** Excel stores 17 significant digits ("0.30000000000000004"); show 15, like Excel does */
const number = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
};

function readSheet(doc: XmlElement, strings: string[], formats: CellFormat[], date1904: boolean, maxRows: number): Omit<Sheet, 'name' | 'hidden'> {
  const rows: string[][] = [];
  let formulas = 0;
  const formulaSamples: string[] = [];
  const data = all(doc, 'sheetData')[0];
  let nextRow = 0;
  let truncated = false;
  for (const row of data ? kids(data, 'row') : []) {
    const r = attr(row, 'r') ? Number(attr(row, 'r')) - 1 : nextRow;
    nextRow = r + 1;
    if (r >= maxRows) {
      truncated = true;
      break;
    }
    let nextCol = 0;
    for (const c of kids(row, 'c')) {
      const at = attr(c, 'r') ? cellIndex(attr(c, 'r')!) : [r, nextCol];
      if (!at) continue;
      const col = at[1];
      nextCol = col + 1;
      if (col > 16383) continue;
      const t = attr(c, 't') ?? 'n';
      const v = kid(c, 'v');
      const f = kid(c, 'f');
      if (f) {
        formulas++;
        const ft = textOf(f);
        if (ft && formulaSamples.length < 10) formulaSamples.push(`${columnName(col)}${r + 1}: =${ft}`);
      }
      let value = '';
      if (t === 's') value = strings[Number(v ? textOf(v) : -1)] ?? '';
      else if (t === 'inlineStr') value = textOf(kid(c, 'is') ?? '');
      else if (t === 'b') value = v && textOf(v) === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'str' || t === 'e') value = v ? textOf(v) : '';
      else if (t === 'd') value = v ? textOf(v) : '';
      else if (v) {
        const raw = textOf(v);
        const style = Number(attr(c, 's') ?? 0);
        const fmt = Number.isFinite(Number(raw)) ? formats[style] : '';
        value = fmt === 'date' ? serialToIso(Number(raw), date1904) : fmt === 'percent' ? `${number(String(Number(raw) * 100))}%` : number(raw);
      }
      if (value === '') continue;
      while (rows.length <= r) rows.push([]);
      const target = rows[r];
      while (target.length < col) target.push('');
      target[col] = value;
    }
  }
  const width = Math.max(0, ...rows.map((x) => x.length));
  for (const x of rows) while (x.length < width) x.push('');
  const merged = all(doc, 'mergeCell').length;
  const dimension = attr(all(doc, 'dimension')[0], 'ref');
  return { rows, formulas, formulaSamples, merged, dimension, ...(truncated ? { truncated } : {}) };
}

export interface ReadOptions {
  /** only these sheets (by name, case-insensitive) */
  sheets?: string[];
  /** stop reading a sheet after this many rows */
  maxRows?: number;
}

export function readXlsx(bytes: Uint8Array, { sheets: only, maxRows = 1_000_000 }: ReadOptions = {}): Workbook & { truncated: string[] } {
  const pkg = openPackage(bytes, 'Excel');
  const book = pkg.xml('xl/workbook.xml');
  if (!book) throw new DocError('This Excel file has no workbook part. It may be damaged.');
  const rels = pkg.rels('xl/workbook.xml');
  const date1904 = ['1', 'true'].includes(attr(all(book, 'workbookPr')[0], 'date1904') ?? '');
  const strings = sharedStrings(pkg);
  const formats = cellFormats(pkg);
  const want = only?.map((s) => s.toLowerCase());
  const sheets: Sheet[] = [];
  const truncated: string[] = [];
  for (const s of all(book, 'sheet')) {
    const name = attr(s, 'name') ?? `Sheet${sheets.length + 1}`;
    if (want && !want.includes(name.toLowerCase())) continue;
    const rel = rels.get(relId(s) ?? '');
    // chart sheets and dialog sheets have no cells
    if (!rel || rel.external || !rel.type.endsWith('/worksheet')) continue;
    const doc = pkg.xml(rel.target);
    if (!doc) continue;
    const read = readSheet(doc, strings, formats, date1904, maxRows) as Omit<Sheet, 'name' | 'hidden'> & { truncated?: boolean };
    if (read.truncated) truncated.push(name);
    delete read.truncated;
    sheets.push({ name, hidden: (attr(s, 'state') ?? 'visible') !== 'visible', ...read });
  }
  if (want && !sheets.length) throw new DocError(`This workbook has no sheet called ${only!.join(' or ')}. Its sheets: ${all(book, 'sheet').map((s) => attr(s, 'name')).join(', ')}.`, 'unsupported-input');
  return { sheets, truncated };
}
