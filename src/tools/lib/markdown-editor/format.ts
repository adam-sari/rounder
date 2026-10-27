/**
 * Toolbar actions as pure text edits: replace [from, to) with insert, then
 * select [selStart, selEnd) in the new text. The page applies them with
 * execCommand so the browser's own undo keeps working.
 */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

export function applyEdit(text: string, e: Edit) {
  return text.slice(0, e.from) + e.insert + text.slice(e.to);
}

function runBefore(text: string, pos: number, ch: string) {
  let n = 0;
  while (pos - n > 0 && text[pos - n - 1] === ch) n++;
  return n;
}

function runAfter(text: string, pos: number, ch: string) {
  let n = 0;
  while (pos + n < text.length && text[pos + n] === ch) n++;
  return n;
}

// "*" is italic only in a run of 1 or 3 (bold italic); "**" is bold in a run of 2 or more
function isWrapped(marker: string, left: number, right: number) {
  const n = Math.min(left, right);
  return marker === '*' ? n % 2 === 1 : n >= marker.length;
}

/** Bold, italic, inline code: wraps the selection, or unwraps it if it's already wrapped */
export function toggleInline(text: string, start: number, end: number, marker: string, placeholder: string): Edit {
  const m = marker.length;
  const ch = marker[0];
  if (isWrapped(marker, runBefore(text, start, ch), runAfter(text, end, ch))) {
    return { from: start - m, to: end + m, insert: text.slice(start, end), selStart: start - m, selEnd: end - m };
  }
  let sel = text.slice(start, end);
  if (sel.length > 2 * m && isWrapped(marker, runAfter(sel, 0, ch), runBefore(sel, sel.length, ch))) {
    const inner = sel.slice(m, -m);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  if (start === end) {
    return { from: start, to: end, insert: marker + placeholder + marker, selStart: start + m, selEnd: start + m + placeholder.length };
  }
  // double-click selects a trailing space on some systems; "**word **" wouldn't render as bold
  const lead = sel.length - sel.trimStart().length;
  sel = sel.trim();
  if (!sel) return { from: start, to: end, insert: text.slice(start, end), selStart: start, selEnd: end };
  const from = start + lead;
  return { from, to: from + sel.length, insert: marker + sel + marker, selStart: from + m, selEnd: from + m + sel.length };
}

// lastIndexOf clamps a negative fromIndex to 0, so position 0 needs its own case
function lineStart(text: string, pos: number) {
  return pos > 0 ? text.lastIndexOf('\n', pos - 1) + 1 : 0;
}

/** Expands a selection to whole lines; a selection ending just after a newline doesn't take the next line */
export function lineRange(text: string, start: number, end: number): [number, number] {
  const a = lineStart(text, start);
  const e = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const b = text.indexOf('\n', e);
  return [a, b === -1 ? text.length : b];
}

export type LineKind = 'ul' | 'ol' | 'quote';

const LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const PATTERNS: Record<LineKind, RegExp> = {
  ul: /^(\s*)[-*+]\s+/,
  ol: /^(\s*)\d+[.)]\s+/,
  quote: /^>\s?/,
};

function lineEdit(text: string, start: number, end: number, a: number, b: number, block: string): Edit {
  // a bare cursor ends up at the end of its line, ready to type
  if (start === end && !block.includes('\n')) return { from: a, to: b, insert: block, selStart: a + block.length, selEnd: a + block.length };
  return { from: a, to: b, insert: block, selStart: a, selEnd: a + block.length };
}

/** Bulleted list, numbered list, quote: adds the prefix to every line, or removes it if all lines have it */
export function toggleLines(text: string, start: number, end: number, kind: LineKind): Edit {
  const [a, b] = lineRange(text, start, end);
  const lines = text.slice(a, b).split('\n');
  const re = PATTERNS[kind];
  const filled = lines.filter((l) => l.trim());
  const remove = filled.length > 0 && filled.every((l) => re.test(l));
  let n = 0;
  const out = lines.map((line) => {
    if (remove) return line.replace(re, kind === 'quote' ? '' : '$1');
    if (kind === 'quote') return line.trim() ? `> ${line}` : '>';
    if (!line.trim() && lines.length > 1) return line;
    const [, indent = ''] = /^(\s*)/.exec(line) ?? [];
    const body = line.replace(LIST_MARK, '').trimStart();
    return `${indent}${kind === 'ul' ? '-' : `${++n}.`} ${body}`;
  });
  return lineEdit(text, start, end, a, b, out.join('\n'));
}

/** Heading: no heading → H1 → H2 → H3 → no heading, based on the first line */
export function cycleHeading(text: string, start: number, end: number): Edit {
  const [a, b] = lineRange(text, start, end);
  const lines = text.slice(a, b).split('\n');
  const level = /^(#{1,6})\s/.exec(lines[0])?.[1].length ?? 0;
  const next = level >= 3 ? 0 : level + 1;
  const out = lines.map((line) => {
    // an empty line on its own still gets a marker, ready to type the heading
    if (!line.trim() && lines.length > 1) return line;
    const body = line.replace(/^#{1,6}\s+/, '');
    return next ? `${'#'.repeat(next)} ${body}` : body;
  });
  return lineEdit(text, start, end, a, b, out.join('\n'));
}

export function insertLink(text: string, start: number, end: number): Edit {
  const raw = text.slice(start, end);
  const sel = raw.trim();
  // keep the spaces around the selection (Windows double-click takes the trailing one)
  start += raw.length - raw.trimStart().length;
  end = start + sel.length;
  if (/^(https?:\/\/|www\.)\S+$/i.test(sel)) {
    const label = 'link text';
    // a bare "www." url would be a relative link
    const url = /^www\./i.test(sel) ? `https://${sel}` : sel;
    return { from: start, to: end, insert: `[${label}](${url})`, selStart: start + 1, selEnd: start + 1 + label.length };
  }
  const label = sel || 'link text';
  const url = 'https://';
  const insert = `[${label}](${url})`;
  // with text selected, jump to the url; otherwise select the placeholder label
  return sel
    ? { from: start, to: end, insert, selStart: start + label.length + 3, selEnd: start + label.length + 3 + url.length }
    : { from: start, to: end, insert, selStart: start + 1, selEnd: start + 1 + label.length };
}

/** Inline code for a word, a fenced block for several lines or an empty line */
export function toggleCode(text: string, start: number, end: number): Edit {
  const [a, b] = lineRange(text, start, end);
  const multiline = text.slice(start, end).includes('\n');
  const emptyLine = start === end && !text.slice(a, b).trim();
  if (!multiline && !emptyLine) return toggleInline(text, start, end, '`', 'code');
  const inner = emptyLine ? '' : text.slice(a, b);
  const insert = '```\n' + inner + '\n```';
  return { from: a, to: b, insert, selStart: a + 4, selEnd: a + 4 + inner.length };
}

/** Puts a block on its own lines with a blank line on either side */
export function insertBlock(text: string, pos: number, block: string, select: [number, number]): Edit {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : after ? '\n\n' : '\n';
  const at = pos + pre.length;
  return { from: pos, to: pos, insert: pre + block + post, selStart: at + select[0], selEnd: at + select[1] };
}

export const TABLE = '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |';

export function insertTable(text: string, end: number): Edit {
  // after the current line, so a table never splits a sentence in half
  const lineEnd = text.indexOf('\n', end);
  return insertBlock(text, lineEnd === -1 ? text.length : lineEnd, TABLE, [2, 10]);
}

/**
 * Enter inside a list or quote starts the next item ("- [ ] " → "- [ ] ",
 * "3. " → "4. "). Enter on an empty item ends the list instead.
 */
export function continueList(text: string, pos: number): Edit | null {
  const a = lineStart(text, pos);
  const nl = text.indexOf('\n', pos);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = text.slice(a, lineEnd);
  const m = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/.exec(line) ?? /^(\s*)>\s?/.exec(line);
  if (!m || pos < a + m[0].length) return null;
  if (!line.slice(m[0].length).trim()) {
    return { from: a, to: lineEnd, insert: '', selStart: a, selEnd: a };
  }
  const [, indent, bullet, num, delim, task] = m;
  const mark = bullet ?? (num ? `${Number(num) + 1}${delim}` : '>');
  const insert = `\n${indent}${mark} ${task ? '[ ] ' : ''}`;
  return { from: pos, to: pos, insert, selStart: pos + insert.length, selEnd: pos + insert.length };
}
