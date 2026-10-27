export interface MinifyOptions {
  /** MySQL-style strings where \' escapes a quote */
  backslashEscapes?: boolean;
  /** MySQL-style # line comments */
  hashComments?: boolean;
  /** BigQuery '''…''' and """…""" strings */
  tripleQuotes?: boolean;
  /** T-SQL GO lines, which must stay on a line of their own */
  batchSeparators?: boolean;
}

// a space next to these is never needed (one after ")" is kept so "f() AS x" stays readable)
const TIGHT = new Set(['(', ')', ',', ';']);
const TIGHT_AFTER = new Set(['(', ',', ';']);

/** Index just past the closing quote, honouring doubled quotes ('it''s') */
function skipQuoted(sql: string, start: number, close: string, backslash: boolean) {
  let i = start + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (backslash && c === '\\') i += 2;
    else if (c === close) {
      if (sql[i + 1] === close && close !== ']') i += 2;
      else return i + 1;
    } else i++;
  }
  return sql.length;
}

function aloneOnLine(sql: string, start: number, end: number) {
  const lineEnd = sql.indexOf('\n', end);
  return !sql.slice(sql.lastIndexOf('\n', start - 1) + 1, start).trim() && !sql.slice(end, lineEnd < 0 ? sql.length : lineEnd).trim();
}

/**
 * Removes comments and collapses whitespace outside strings and quoted names, one
 * statement per line. Optimizer hints and MySQL version comments are kept.
 */
export function minifySql(sql: string, { backslashEscapes = false, hashComments = false, tripleQuotes = false, batchSeparators = false }: MinifyOptions = {}): string {
  let out = '';
  let space = false;
  let i = 0;

  const emit = (text: string) => {
    if (space && out && !out.endsWith('\n') && !TIGHT_AFTER.has(out[out.length - 1]) && !TIGHT.has(text[0])) out += ' ';
    space = false;
    out += text;
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(c)) {
      space = true;
      i++;
    } else if ((c === '-' && next === '-') || (c === '#' && hashComments)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      space = true;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      if (sql[i + 2] === '!' || sql[i + 2] === '+') emit(sql.slice(i, stop));
      else space = true;
      i = stop;
    } else if (tripleQuotes && (c === "'" || c === '"') && sql.startsWith(c.repeat(3), i)) {
      const end = sql.indexOf(c.repeat(3), i + 3);
      const stop = end < 0 ? sql.length : end + 3;
      emit(sql.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const end = skipQuoted(sql, i, close, backslashEscapes && c !== '[');
      emit(sql.slice(i, end));
      i = end;
    } else if (c === '$' && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 64))) {
      // PostgreSQL dollar-quoted body, e.g. $$ ... $$ or $fn$ ... $fn$
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64))![0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end < 0 ? sql.length : end + tag.length;
      emit(sql.slice(i, stop));
      i = stop;
    } else if (c === ';') {
      space = false;
      out += ';';
      i++;
      // start the next statement on its own line
      if (sql.slice(i).trim()) out += '\n';
    } else {
      let j = i + 1;
      while (j < sql.length && !/[\s'"`[$;\-/#]/.test(sql[j]) && !TIGHT.has(sql[j])) j++;
      const word = sql.slice(i, j);
      if (batchSeparators && /^go$/i.test(word) && aloneOnLine(sql, i, j)) {
        out = `${out ? out.trimEnd() + '\n' : ''}${word}\n`;
        space = false;
      } else emit(word);
      i = j;
    }
  }
  return out.trim();
}

/** Turns sql-formatter's long parser dumps into one readable sentence */
export function cleanError(message: string, language: string): string {
  const first = message.split('\n')[0];
  const hint = language === 'sql' ? ' If your query uses database-specific syntax, pick its dialect above.' : ' Check the dialect matches your database.';
  let m = /^Parse error at token: «EOF» at line (\d+) column (\d+)/.exec(first);
  if (m) return `The query ends too early (line ${m[1]}, column ${m[2]}). Check for a missing closing bracket, quote or END.`;
  m = /^Parse error at token: (.*) at line (\d+) column (\d+)/.exec(first);
  if (m) return `Unexpected "${m[1]}" at line ${m[2]}, column ${m[3]}.${hint}`;
  m = /^Parse error: Unexpected "(.*)" at line (\d+) column (\d+)/.exec(first);
  if (m) return `Couldn't read "${m[1].trim()}" at line ${m[2]}, column ${m[3]}.${hint}`;
  return first.replace(/^Parse error:\s*/, '') || 'Could not format this SQL.';
}
