// Documents → Markdown for AI assistants and people: Word, PowerPoint, Excel and CSV here; PDFs go through pdf-text.
import Papa from 'papaparse';
import { decodeText } from '../csv/text';
import { toNumber, toTime } from '../csv/profile';
import { escapeInline, joinBlocks, table } from './markdown';
import { DocError } from './package';
import { readXlsx, type Sheet } from './xlsx';

export { DocError } from './package';
export { docxToMarkdown } from './docx';
export { pptxToMarkdown } from './pptx';
export { readXlsx, columnName, type Sheet, type Workbook } from './xlsx';

export type DocKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv';

const BY_EXT: Record<string, DocKind> = { pdf: 'pdf', docx: 'docx', docm: 'docx', dotx: 'docx', pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', xlsx: 'xlsx', xlsm: 'xlsx', csv: 'csv', tsv: 'csv', txt: 'csv' };

/** what a file is, from its first bytes, then its name */
export function docKind(name: string, head: Uint8Array): DocKind | null {
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return BY_EXT[ext] ?? null;
}

/** a CSV or TSV file as a sheet; the delimiter is detected */
export function readCsv(bytes: Uint8Array, name: string, maxRows = 1_000_000): Sheet & { delimiter: string; truncated: boolean } {
  const text = decodeText(bytes);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', preview: maxRows + 1, delimitersToGuess: [',', '\t', ';', '|'] });
  const rows = parsed.data.slice(0, maxRows);
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push('');
  return { name: name.replace(/\.[^.]+$/, ''), hidden: false, rows, formulas: 0, formulaSamples: [], merged: 0, delimiter: parsed.meta.delimiter, truncated: parsed.data.length > maxRows };
}

export interface SheetMarkdownOptions {
  /** rows per sheet in the table, after the header (default 100) */
  maxRows?: number;
  /** include hidden sheets */
  hidden?: boolean;
}

/** each sheet as a heading and a table; the first row is the header. Long sheets are cut with a note. */
export function sheetsToMarkdown(sheets: Sheet[], { maxRows = 100, hidden = false }: SheetMarkdownOptions = {}): string {
  const blocks: string[] = [];
  const shown = sheets.filter((s) => hidden || !s.hidden);
  for (const s of shown) {
    const rows = trimEmpty(s.rows);
    const head = shown.length > 1 || sheets.length > 1 ? `## ${escapeInline(s.name)}${s.hidden ? ' (hidden)' : ''}` : '';
    if (!rows.length) {
      blocks.push(joinBlocks([head, '_Empty sheet._']));
      continue;
    }
    // a title or note above the real header row ("Sales by order, 2026") is shown as text, not as the table's header
    const h = findHeader(rows);
    const above = rows.slice(0, h).map((r) => r.filter((c) => c.trim()).map(escapeInline).join(' · ')).filter(Boolean);
    const data = rows.slice(h);
    const body = data.slice(0, maxRows + 1);
    const more = data.length - body.length;
    const note = more > 0 ? `_${more.toLocaleString('en')} more row${more === 1 ? '' : 's'} not shown (${(data.length - 1).toLocaleString('en')} data rows, ${data[0].length} columns)._` : '';
    blocks.push(joinBlocks([head, ...above, table(body), note]));
  }
  return joinBlocks(blocks) + '\n';
}

/**
 * The row that holds the column names: the first of the top 20 rows that fills at least half the columns (and two),
 * all with text rather than numbers or dates, and has rows after it. 0 when nothing qualifies.
 */
export function findHeader(rows: string[][]): number {
  const width = Math.max(0, ...rows.map((r) => r.filter((c) => c.trim()).length));
  for (let i = 0; i < Math.min(20, rows.length - 1); i++) {
    const filled = rows[i].filter((c) => c.trim());
    if (filled.length < Math.max(2, Math.ceil(width / 2))) continue;
    if (filled.every((c) => Number.isNaN(toNumber(c)) && Number.isNaN(toTime(c)) && !/%$/.test(c.trim()))) return i;
    return 0;
  }
  return 0;
}

/** drops trailing empty rows and columns, and fully empty leading rows */
export function trimEmpty(rows: string[][]): string[][] {
  let start = 0;
  while (start < rows.length && rows[start].every((c) => !c.trim())) start++;
  let end = rows.length;
  while (end > start && rows[end - 1].every((c) => !c.trim())) end--;
  const kept = rows.slice(start, end);
  let width = 0;
  for (const r of kept) for (let i = r.length - 1; i >= width; i--) if (r[i].trim()) width = i + 1;
  return kept.map((r) => r.slice(0, width));
}

export function workbookToMarkdown(bytes: Uint8Array, o: SheetMarkdownOptions & { sheets?: string[] } = {}) {
  // read whole, so the "more rows" note counts them all
  const book = readXlsx(bytes, { sheets: o.sheets });
  if (!book.sheets.length) throw new DocError('This workbook has no sheets with cells.', 'unsupported-input');
  return { markdown: sheetsToMarkdown(book.sheets, o), sheets: book.sheets };
}
