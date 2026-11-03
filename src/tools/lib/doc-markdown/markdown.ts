// Markdown building blocks shared by the Word, PowerPoint and spreadsheet readers.

/** escapes the characters that would turn plain text into Markdown formatting */
export function escapeInline(s: string): string {
  return s.replace(/([\\`*_[\]])/g, '\\$1');
}

/** a line that would start a heading, quote or list is escaped at its start */
export function escapeLineStart(s: string): string {
  return s.replace(/^(\s*)(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, (_, sp: string, mark: string) => `${sp}\\${mark}`);
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

/** runs → inline Markdown; neighbouring runs with the same formatting are joined first, so "**He****llo**" can't happen */
export function renderRuns(runs: Run[]): string {
  const merged: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.strike === !!r.strike && !!last.code === !!r.code && last.link === r.link) last.text += r.text;
    else merged.push({ ...r });
  }
  let out = '';
  for (const r of merged) {
    // whitespace stays outside the markers: "** bold **" isn't bold in Markdown
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
    const [, lead, core, trail] = m;
    if (!core) {
      out += r.text;
      continue;
    }
    let s = r.code ? '`' + core.replace(/`/g, "'") + '`' : escapeInline(core);
    if (!r.code) {
      if (r.strike) s = `~~${s}~~`;
      if (r.italic) s = `*${s}*`;
      if (r.bold) s = `**${s}**`;
    }
    if (r.link) s = `[${s}](${r.link.replace(/[()\s]/g, encodeURIComponent)})`;
    out += lead + s + trail;
  }
  return out;
}

/** one table cell: pipes escaped, line breaks as <br> so the row stays on one line */
export const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();

/** rows → a Markdown table, the first row as the header; ragged rows are padded */
export function table(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ''));
  const [head, ...body] = rows.map(pad);
  const line = (r: string[]) => `| ${r.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
}

/** blocks joined by blank lines, with runs of 3+ newlines squeezed */
export function joinBlocks(blocks: string[]): string {
  return blocks
    .map((b) => b.replace(/\s+$/, ''))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}
