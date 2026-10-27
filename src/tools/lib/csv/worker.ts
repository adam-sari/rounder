/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import Papa from 'papaparse';
import { columnCount, csvToJson, jsonToTable, parseJsonInput, type CsvToJsonOptions, type JsonToCsvOptions } from './convert';
import { sortOrder, type ColumnType } from './profile';
import { decodeText, fileProblem } from './text';
import { toCsv } from './write';

/** rows shown in preview tables */
const PREVIEW_ROWS = 100;
/** characters of output shown on screen; copy and download always get everything */
const PREVIEW_CHARS = 100_000;

export interface ParseInfo {
  rowCount: number;
  columnCount: number;
  /** the delimiter used, detected or chosen */
  delimiter: string;
  preview: string[][];
  /** the first parsing problem worth mentioning, or '' */
  warning: string;
}

export interface Output {
  /** the start of the result, for display */
  text: string;
  truncated: boolean;
  blob: Blob;
  /** objects, rows or keys produced */
  count: number;
  note: string;
  /** JSON → CSV only: the table that was written */
  fields?: string[];
  preview?: string[][];
}

// the last thing loaded stays here, so changing an option doesn't re-read the file
let table: string[][] = [];
let json: { value: unknown; note: string } | null = null;

async function readText(source: File | string) {
  if (typeof source === 'string') return source;
  const text = decodeText(new Uint8Array(await source.arrayBuffer()));
  const problem = fileProblem(source.name, text);
  if (problem) throw new Error(problem);
  return text;
}

function output(text: string, type: string, count: number, note: string, prefix = ''): Output {
  return {
    text: text.slice(0, PREVIEW_CHARS),
    truncated: text.length > PREVIEW_CHARS,
    blob: new Blob([prefix, text], { type }),
    count,
    note,
  };
}

const api = {
  /**
   * Parses CSV and keeps it for csvToJson. With onRows the rows are streamed back in
   * batches instead (and not kept), so a 100k-row file never arrives in one long,
   * blocking message.
   */
  async loadCsv(
    source: File | string,
    delimiter: string,
    onRows?: (rows: string[][]) => unknown,
    onProgress?: (done: number) => unknown,
  ): Promise<ParseInfo> {
    table = [];
    const text = await readText(source);
    let used = delimiter || ',';
    let warning = '';
    let rowCount = 0;
    let width = 0;
    const preview: string[][] = [];
    // callbacks travel on their own channel, so wait for them before answering
    const sent: unknown[] = [];
    await new Promise<void>((resolve) => Papa.parse<string[]>(text, {
      delimiter,
      skipEmptyLines: true,
      chunkSize: 1 << 20,
      chunk: (res: Papa.ParseResult<string[]>) => {
        used = res.meta.delimiter;
        const err = res.errors.find((e) => e.code !== 'UndetectableDelimiter');
        if (err && !warning) warning = `${err.message}${err.row !== undefined ? ` near row ${rowCount + err.row + 1}` : ''}. The rest of the file was still read.`;
        for (const row of res.data) {
          if (preview.length <= PREVIEW_ROWS) preview.push(row);
          if (!onRows) table.push(row);
        }
        rowCount += res.data.length;
        width = Math.max(width, columnCount(res.data));
        if (onRows) sent.push(onRows(res.data));
        onProgress?.(res.meta.cursor / text.length);
      },
      complete: () => resolve(),
    }));
    await Promise.all(sent);
    return { rowCount, columnCount: width, delimiter: used, preview, warning };
  },

  csvToJson(o: CsvToJsonOptions & { pretty: boolean }): Output {
    const { value, duplicates } = csvToJson(table, o);
    const text = JSON.stringify(value, null, o.pretty ? 2 : undefined);
    const count = Array.isArray(value) ? value.length : Object.keys(value as object).length;
    const note = duplicates ? `${duplicates.toLocaleString()} repeated key${duplicates === 1 ? '' : 's'}: later rows replaced earlier ones.` : '';
    return output(text, 'application/json', count, note);
  },

  async loadJson(source: File | string): Promise<void> {
    json = null;
    json = parseJsonInput(await readText(source));
  },

  jsonToCsv(o: JsonToCsvOptions & { delimiter: string; quoteAll: boolean; bom: boolean }): Output {
    if (!json) throw new Error('Nothing loaded yet.');
    const t = jsonToTable(json.value, o);
    const text = toCsv(t, o);
    const note = [json.note, t.note].filter(Boolean).join(' ');
    return { ...output(text, 'text/csv', t.rows.length, note, o.bom ? '﻿' : ''), fields: t.fields, preview: t.rows.slice(0, PREVIEW_ROWS) };
  },

  sortOrder(values: string[], type: ColumnType, desc: boolean) {
    const order = sortOrder(values, type, desc);
    return Comlink.transfer(order, [order.buffer]);
  },
};

export type CsvWorker = typeof api;

Comlink.expose(api);
