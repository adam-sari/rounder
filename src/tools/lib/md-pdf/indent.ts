/**
 * Tab and Shift+Tab in the editor as a text edit: replace [from, to) with
 * insert, then select [selStart, selEnd). The page applies it with
 * execCommand so the browser's undo keeps working.
 */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

const UNIT = '  ';

export function indentEdit(text: string, start: number, end: number, outdent: boolean): Edit {
  const multi = text.slice(start, end).includes('\n');
  if (!multi && !outdent) return { from: start, to: end, insert: UNIT, selStart: start + UNIT.length, selEnd: start + UNIT.length };

  const a = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  // a selection ending just after a newline doesn't take in the next line
  const e = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nl = text.indexOf('\n', e);
  const b = nl === -1 ? text.length : nl;
  const lines = text.slice(a, b).split('\n');
  // blank lines stay blank when indenting
  const out = lines.map((l) => (outdent ? l.replace(/^(?: {1,2}|\t)/, '') : l.trim() ? UNIT + l : l));
  const insert = out.join('\n');
  if (multi) return { from: a, to: b, insert, selStart: a, selEnd: a + insert.length };
  // one line outdented: the caret moves back with its text
  const removed = lines[0].length - out[0].length;
  return { from: a, to: b, insert, selStart: Math.max(a, start - removed), selEnd: Math.max(a, end - removed) };
}
