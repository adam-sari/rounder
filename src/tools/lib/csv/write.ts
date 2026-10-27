import Papa from 'papaparse';
import type { Table } from './convert';

// kept apart from convert.ts so the islands, which import that, don't load papaparse up front
export function toCsv(table: Pick<Table, 'fields' | 'rows'>, o: { delimiter: string; quoteAll: boolean }) {
  const data = table.fields.length ? { fields: table.fields, data: table.rows } : table.rows;
  return Papa.unparse(data, { delimiter: o.delimiter, quotes: o.quoteAll, newline: '\r\n' });
}
