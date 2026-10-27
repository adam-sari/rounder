import { locateJsonError } from '../json-locate';

// ---------- CSV → JSON ----------

export type Shape = 'objects' | 'arrays' | 'keyed';

export interface CsvToJsonOptions {
  header: boolean;
  /** numbers, true/false and null instead of strings */
  typed: boolean;
  /** "address.city" → { address: { city } } */
  nested: boolean;
  shape: Shape;
  /** column whose values become the keys when shape is 'keyed' */
  keyColumn: number;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/**
 * "42" → 42, "TRUE" → true, "null" or "" → null. Leading zeros and numbers with more
 * digits than a double can hold stay text, so zip codes and long IDs survive intact.
 */
export function typeValue(s: string): unknown {
  if (s === '' || /^null$/i.test(s)) return null;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (NUMBER.test(s)) {
    const digits = s.replace(/^-|[eE].*$|\./g, '').replace(/^0+/, '');
    const n = Number(s);
    if (digits.length <= 15 && Number.isFinite(n)) return n;
  }
  return s;
}

/** Header names that are never blank and never repeat: "name", "name_2", "column3" */
export function uniqueHeaders(row: string[], width: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const base = (row[i] ?? '').trim() || `column${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function columnCount(rows: string[][]) {
  let width = 0;
  for (const r of rows) if (r.length > width) width = r.length;
  return width;
}

/**
 * The path each header is written to. A header stays flat when nesting it would clash
 * with another header ("a" and "a.b" can't both exist) or it has empty parts ("a..b").
 */
function headerPaths(headers: string[], nested: boolean) {
  const names = new Set(headers);
  return headers.map((h) => {
    const parts = h.split('.');
    if (!nested || parts.length < 2 || parts.some((p) => !p)) return [h];
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('.'))) return [h];
    return parts;
  });
}

// null-prototype objects, so a column called "__proto__" is just a key
const record = () => Object.create(null) as Record<string, unknown>;

function put(target: Record<string, unknown>, path: string[], value: unknown) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) node = (node[path[i]] ??= record()) as Record<string, unknown>;
  node[path[path.length - 1]] = value;
}

export function csvToJson(rows: string[][], o: CsvToJsonOptions): { value: unknown; duplicates: number } {
  const cell = (s: string | undefined) => (o.typed ? typeValue(s ?? '') : (s ?? ''));
  const body = o.header ? rows.slice(1) : rows;

  if (o.shape === 'arrays') {
    const value = body.map((r) => r.map(cell));
    if (o.header && rows.length) value.unshift(rows[0]);
    return { value, duplicates: 0 };
  }

  const width = columnCount(rows);
  const headers = uniqueHeaders(o.header ? (rows[0] ?? []) : [], width);
  const paths = headerPaths(headers, o.nested);

  if (o.shape === 'objects') {
    const value = body.map((r) => {
      const obj = record();
      for (let i = 0; i < width; i++) put(obj, paths[i], cell(r[i]));
      return obj;
    });
    return { value, duplicates: 0 };
  }

  const key = Math.min(Math.max(0, o.keyColumn), Math.max(0, width - 1));
  const value = record();
  let duplicates = 0;
  for (const r of body) {
    const obj = record();
    for (let i = 0; i < width; i++) if (i !== key) put(obj, paths[i], cell(r[i]));
    const k = r[key] ?? '';
    if (k in value) duplicates++;
    value[k] = obj;
  }
  return { value, duplicates };
}

// ---------- JSON → CSV ----------

export interface JsonToCsvOptions {
  /** nested objects become "parent.child" columns; off keeps them as JSON text */
  flatten: boolean;
  /** arrays as "a, b, c" or as JSON text */
  arrays: 'join' | 'json';
}

export interface Table {
  /** empty when the JSON was already rows of arrays */
  fields: string[];
  rows: string[][];
  /** something worth telling the user about how the JSON was read */
  note: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function cellText(v: unknown, o: JsonToCsvOptions): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v) && o.arrays === 'join') {
    return v.map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : cellText(x, o))).join(', ');
  }
  return JSON.stringify(v);
}

function flattenInto(obj: Record<string, unknown>, o: JsonToCsvOptions, prefix: string, out: Map<string, string>) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (o.flatten && isObject(v) && Object.keys(v).length) flattenInto(v, o, key, out);
    else out.set(key, cellText(v, o));
  }
}

/** Finds the rows in parsed JSON: an array, a map of records, or an array inside a wrapper like { "data": [...] } */
function findRows(value: unknown): { items: unknown[]; keys?: string[]; note: string } {
  if (Array.isArray(value)) return { items: value, note: '' };
  if (!isObject(value)) return { items: [value], note: '' };
  const entries = Object.entries(value);
  if (entries.length && entries.every(([, v]) => isObject(v))) {
    return { items: entries.map(([, v]) => v), keys: entries.map(([k]) => k), note: 'Each top-level key became a row, with the key in its own column.' };
  }
  let best = '';
  for (const [k, v] of entries) {
    if (Array.isArray(v) && v.some(isObject) && (!best || v.length > (value[best] as unknown[]).length)) best = k;
  }
  if (best) return { items: value[best] as unknown[], note: `Converted the "${best}" array.` };
  return { items: [value], note: '' };
}

export function jsonToTable(value: unknown, o: JsonToCsvOptions): Table {
  const { items, keys, note } = findRows(value);

  if (items.length && items.every(Array.isArray)) {
    return { fields: [], rows: items.map((r) => (r as unknown[]).map((x) => cellText(x, o))), note };
  }

  const keyField = keys && items.some((it) => isObject(it) && 'key' in it) ? '_key' : 'key';
  const columns = new Set<string>();
  const records = items.map((item, i) => {
    const rec = new Map<string, string>();
    if (keys) rec.set(keyField, keys[i]);
    if (isObject(item)) flattenInto(item, o, '', rec);
    else rec.set('value', cellText(item, o));
    for (const k of rec.keys()) columns.add(k);
    return rec;
  });
  const fields = [...columns];
  return { fields, rows: records.map((rec) => fields.map((f) => rec.get(f) ?? '')), note };
}

/** Parses JSON, or JSON Lines (one value per line) when the text isn't a single JSON value */
export function parseJsonInput(text: string): { value: unknown; note: string } {
  try {
    return { value: JSON.parse(text), note: '' };
  } catch (err) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1) {
      try {
        return { value: lines.map((l) => JSON.parse(l)), note: 'Read as JSON Lines, one record per line.' };
      } catch {
        // not JSON Lines either; report the error for the whole text
      }
    }
    const problem = locateJsonError(text);
    throw new Error(problem ? `Invalid JSON at line ${problem.line}, column ${problem.column}: ${problem.reason}.` : (err as Error).message);
  }
}
