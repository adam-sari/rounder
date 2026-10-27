import type { Paragraph } from './layout';

/** null = the page has no text layer */
export type PageText = Paragraph[] | null;

/**
 * Joins a paragraph's wrapped lines into one, mending words hyphenated at a
 * line break ("exam-" + "ple" → "example") but keeping real hyphens ("well-" + "Known").
 */
export function unwrap(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (/\p{Ll}-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
    else out += (/[\s­]$/.test(out) ? '' : ' ') + line;
  }
  return out.replace(/­/g, '');
}

export interface TextOptions {
  /** a "Page N" marker before each page */
  markers: boolean;
  /** one line per paragraph instead of the PDF's line breaks */
  join: boolean;
  /** 0-based index of the first page, for marker numbers */
  firstPage?: number;
}

/** rows of tab-separated cells: their line breaks are rows, not wrapping */
const isTable = (lines: string[]) => lines.length > 1 && lines.every((l) => l.includes('\t'));

export function pageToText(page: PageText, join: boolean): string {
  if (!page) return '';
  return page.map((p) => (join && !isTable(p) ? unwrap(p) : p.join('\n'))).join('\n\n');
}

export function toText(pages: PageText[], { markers, join, firstPage = 0 }: TextOptions): string {
  const parts: string[] = [];
  pages.forEach((page, i) => {
    const text = pageToText(page, join);
    if (markers) parts.push(`----- Page ${firstPage + i + 1} -----\n\n${text || '[no text on this page]'}`);
    else if (text) parts.push(text);
  });
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

/** stops a paragraph that happens to start like Markdown syntax from turning into a heading or list */
function escapeMarkdown(text: string) {
  return text.replace(/^(\s*)([#>+*-]|\d+[.)])(?=\s|$)/, '$1\\$2').replace(/^(\s*)(`{3,}|~{3,}|[-*_]{3,}\s*$|=+\s*$)/, '$1\\$2');
}

function markdownTable(lines: string[]) {
  const rows = lines.map((l) => l.split('\t').map((c) => c.trim().replace(/\|/g, '\\|')));
  const cols = Math.max(...rows.map((r) => r.length));
  const row = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [row(rows[0]), row(Array(cols).fill('---')), ...rows.slice(1).map(row)].join('\n');
}

/** Markdown: one paragraph per block, tab-separated rows as tables, "## Page N" headings when markers are on */
export function toMarkdown(pages: PageText[], { markers, title, firstPage = 0 }: { markers: boolean; title?: string; firstPage?: number }): string {
  const parts: string[] = title ? [`# ${title}`] : [];
  pages.forEach((page, i) => {
    const paras = (page ?? []).map((p) => (isTable(p) ? markdownTable(p) : escapeMarkdown(unwrap(p)).replace(/\t/g, ' ')));
    if (markers) parts.push(`## Page ${firstPage + i + 1}`, ...(paras.length ? paras : ['*No text on this page.*']));
    else parts.push(...paras);
  });
  return parts.join('\n\n') + '\n';
}

export interface TextStats {
  words: number;
  chars: number;
}

export function stats(text: string): TextStats {
  return { words: text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0, chars: text.length };
}

