// A spreadsheet's shape at a glance, for an assistant deciding what to do with it: sheets, the header row, each
// column's type and stats, and a few sample rows. Cheaper than reading the whole sheet into the conversation.
import { columnStats, detectType, type ColumnType } from '../csv/profile';
import { findHeader, trimEmpty } from './index';
import { columnName, type Sheet } from './xlsx';

export interface ColumnReport {
  column: string;
  name: string;
  type: ColumnType;
  filled: number;
  empty: number;
  unique: number;
  min?: string;
  max?: string;
  sum?: number;
  mean?: number;
  /** the most common values that appear more than once, with counts */
  top?: [string, number][];
}

export interface SheetReport {
  name: string;
  hidden: boolean;
  /** data rows under the header */
  rows: number;
  columns: number;
  /** 1-based row of the column names, or null when there's no header row */
  headerRow: number | null;
  /** summary rows under the data ("Total", "Average"), left out of the column stats */
  totals?: string[];
  /** text above the header (a title, a note) */
  above?: string[];
  columnsInfo: ColumnReport[];
  sample: Record<string, string>[];
  formulas?: number;
  formulaSamples?: string[];
  mergedCells?: number;
}

const round = (n: number) => Number(n.toPrecision(10));

export function inspectSheet(sheet: Sheet, { sampleRows = 5, maxColumns = 100 }: { sampleRows?: number; maxColumns?: number } = {}): SheetReport {
  const rows = trimEmpty(sheet.rows);
  const h = rows.length > 1 ? findHeader(rows) : 0;
  const headerish = rows.length > 1 && (h > 0 || looksLikeHeader(rows[0], rows.slice(1, 50)));
  const head = headerish ? rows[h] : [];
  const body = rows.slice(headerish ? h + 1 : 0);
  const { data, footer } = splitTotals(body);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const names = Array.from({ length: width }, (_, i) => head[i]?.trim() || columnName(i));
  const columnsInfo: ColumnReport[] = [];
  for (let i = 0; i < Math.min(width, maxColumns); i++) {
    const values = data.map((r) => r[i] ?? '');
    const type = detectType(values);
    const s = columnStats(values, type);
    columnsInfo.push({
      column: columnName(i),
      name: names[i],
      type,
      filled: s.count,
      empty: s.empty,
      unique: s.unique,
      ...(s.min !== undefined ? { min: s.min, max: s.max } : {}),
      ...(s.sum !== undefined ? { sum: round(s.sum), mean: round(s.mean!) } : {}),
      ...(s.top.length ? { top: s.top } : {}),
    });
  }
  const sample = data.slice(0, sampleRows).map((r) => Object.fromEntries(names.slice(0, maxColumns).map((n, i) => [n, r[i] ?? ''])));
  const above = rows
    .slice(0, headerish ? h : 0)
    .map((r) => r.filter((c) => c.trim()).join(' · '))
    .filter(Boolean);
  return {
    name: sheet.name,
    hidden: sheet.hidden,
    rows: data.length,
    columns: width,
    headerRow: headerish ? h + 1 : null,
    ...(above.length ? { above } : {}),
    ...(footer.length ? { totals: footer } : {}),
    columnsInfo,
    sample,
    ...(sheet.formulas ? { formulas: sheet.formulas, formulaSamples: sheet.formulaSamples } : {}),
    ...(sheet.merged ? { mergedCells: sheet.merged } : {}),
  };
}

/** a first row of text over columns that hold numbers or dates below it is a header */
function looksLikeHeader(first: string[], below: string[][]): boolean {
  const filled = first.filter((c) => c.trim());
  if (filled.length < Math.max(1, Math.ceil(first.length / 2))) return false;
  if (filled.some((c) => detectType([c]) !== 'text')) return false;
  // all-text tables: a header when its values don't repeat further down
  return first.some((c, i) => c.trim() && detectType(below.map((r) => r[i] ?? '')) !== 'text') || first.every((c, i) => !below.some((r) => r[i] === c));
}

const TOTAL = /^\s*(grand\s+)?(total|totals|sum|subtotal|sub-total|average|avg|mean|count)\b/i;

/** rows at the bottom that summarise the rest (Total, Average), and blank rows before them */
export function splitTotals(rows: string[][]): { data: string[][]; footer: string[] } {
  let end = rows.length;
  const footer: string[] = [];
  while (end > 0) {
    const r = rows[end - 1];
    const first = r.find((c) => c.trim()) ?? '';
    if (!first) end--;
    else if (TOTAL.test(first) && footer.length < 5) {
      footer.unshift(r.filter((c) => c.trim()).join(' · '));
      end--;
    } else break;
  }
  return footer.length ? { data: rows.slice(0, end), footer } : { data: rows, footer };
}
