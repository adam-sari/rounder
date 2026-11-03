// Word (.docx) → Markdown: headings from paragraph styles, bullet and numbered lists from numbering.xml, bold, italic
// and strikethrough, links, tables, images (as their alt text) and footnotes. Deleted tracked changes are left out and
// insertions kept, so the text is the document as it currently reads.
import { escapeLineStart, joinBlocks, renderRuns, table, type Run } from './markdown';
import { DocError, openPackage, type OfficePackage } from './package';
import { all, attr, isEl, kid, kids, local, relId, textOf, type XmlElement } from './xml';

export interface DocxMarkdown {
  markdown: string;
  title?: string;
  stats: { paragraphs: number; headings: number; tables: number; images: number; footnotes: number };
}

interface Styles {
  /** styleId → heading level (1–6), from the style's name ("heading 2", "Title") or outline level */
  heading: Map<string, number>;
  /** styleIds that are code-like (a monospace "Code"/"HTML Preformatted" style) */
  code: Set<string>;
}

function readStyles(pkg: OfficePackage): Styles {
  const heading = new Map<string, number>();
  const code = new Set<string>();
  const doc = pkg.xml('word/styles.xml');
  for (const s of doc ? all(doc, 'style') : []) {
    const id = attr(s, 'styleId');
    if (!id) continue;
    const name = (attr(kid(s, 'name'), 'val') ?? id).toLowerCase();
    const h = /^heading\s*(\d)$/.exec(name);
    const outline = attr(kid(kid(s, 'pPr') ?? s, 'outlineLvl'), 'val');
    if (name === 'title') heading.set(id, 1);
    else if (h) heading.set(id, Math.min(6, Number(h[1])));
    else if (outline !== undefined && Number(outline) < 9) heading.set(id, Math.min(6, Number(outline) + 1));
    if (/code|preformatted|source/.test(name)) code.add(id);
  }
  return { heading, code };
}

/** numId → level → ordered? */
function readNumbering(pkg: OfficePackage): Map<string, Map<number, boolean>> {
  const doc = pkg.xml('word/numbering.xml');
  const abstract = new Map<string, Map<number, boolean>>();
  const out = new Map<string, Map<number, boolean>>();
  if (!doc) return out;
  for (const a of all(doc, 'abstractNum')) {
    const levels = new Map<number, boolean>();
    for (const l of kids(a, 'lvl')) {
      const fmt = attr(kid(l, 'numFmt'), 'val') ?? 'bullet';
      levels.set(Number(attr(l, 'ilvl') ?? 0), fmt !== 'bullet' && fmt !== 'none');
    }
    const id = attr(a, 'abstractNumId');
    if (id) abstract.set(id, levels);
  }
  for (const n of all(doc, 'num')) {
    const id = attr(n, 'numId');
    const abs = attr(kid(n, 'abstractNumId'), 'val');
    if (id && abs && abstract.has(abs)) out.set(id, abstract.get(abs)!);
  }
  return out;
}

const on = (el: XmlElement | undefined) => {
  if (!el) return false;
  const v = attr(el, 'val');
  return v === undefined || !/^(0|false|off|none)$/i.test(v);
};

interface Ctx {
  pkg: OfficePackage;
  styles: Styles;
  numbering: Map<string, Map<number, boolean>>;
  rels: ReturnType<OfficePackage['rels']>;
  stats: DocxMarkdown['stats'];
  /** footnote ids in the order they're first referenced */
  noteOrder: string[];
}

/** the runs of a paragraph (or of a hyperlink, insertion, field or content control inside one) */
function runsOf(el: XmlElement, ctx: Ctx, link?: string, out: Run[] = [], code = false): Run[] {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    const n = local(c.name);
    if (n === 'r') {
      const pr = kid(c, 'rPr');
      const font = attr(kid(pr ?? c, 'rFonts'), 'ascii') ?? '';
      const fmt = {
        bold: on(kid(pr ?? c, 'b')),
        italic: on(kid(pr ?? c, 'i')),
        strike: on(kid(pr ?? c, 'strike')) || on(kid(pr ?? c, 'dstrike')),
        code: code || /courier|consolas|mono|menlo/i.test(font),
        link,
      };
      for (const t of c.children) {
        if (!isEl(t)) continue;
        const tn = local(t.name);
        if (tn === 't') out.push({ ...fmt, text: textOf(t) });
        else if (tn === 'tab') out.push({ ...fmt, text: ' ' });
        else if (tn === 'br' || tn === 'cr') out.push({ text: attr(t, 'type') === 'page' ? '' : '\n' });
        else if (tn === 'noBreakHyphen') out.push({ ...fmt, text: '-' });
        else if (tn === 'sym') out.push({ ...fmt, text: symbol(attr(t, 'char')) });
        else if (tn === 'footnoteReference' || tn === 'endnoteReference') {
          const id = `${tn === 'endnoteReference' ? 'e' : ''}${attr(t, 'id')}`;
          if (!ctx.noteOrder.includes(id)) ctx.noteOrder.push(id);
          out.push({ text: `[^${ctx.noteOrder.indexOf(id) + 1}]` });
        } else if (tn === 'drawing' || tn === 'pict') out.push({ text: image(t, ctx) });
        // instrText (field codes) and delText (deleted tracked changes) are not the visible text
      }
    } else if (n === 'hyperlink') {
      const id = relId(c);
      const rel = id ? ctx.rels.get(id) : undefined;
      const anchor = attr(c, 'anchor');
      const url = rel?.external && /^(https?|mailto):/i.test(rel.target) ? rel.target : anchor ? `#${anchor}` : link;
      runsOf(c, ctx, url, out, code);
    } else if (n === 'ins' || n === 'smartTag' || n === 'fldSimple' || n === 'customXml' || n === 'bdo' || n === 'dir') runsOf(c, ctx, link, out, code);
    else if (n === 'sdt') {
      const content = kid(c, 'sdtContent');
      if (content) runsOf(content, ctx, link, out, code);
    }
    // del, moveFrom, proofErr, bookmarks, comments: nothing visible
  }
  return out;
}

const SYMBOLS: Record<string, string> = { F0B7: '•', F0A7: '▪', F0FC: '✓', F0E0: '→' };
const symbol = (code?: string) => (code ? (SYMBOLS[code.toUpperCase()] ?? '') : '');

function image(el: XmlElement, ctx: Ctx): string {
  ctx.stats.images++;
  const doc = all(el, 'docPr')[0];
  const alt = (attr(doc, 'descr') || attr(doc, 'title') || '').replace(/\s+/g, ' ').trim();
  return alt ? `![${alt.replace(/[[\]]/g, '')}]()` : '';
}

function paragraph(p: XmlElement, ctx: Ctx): string {
  const pr = kid(p, 'pPr');
  const styleId = attr(kid(pr ?? p, 'pStyle'), 'val') ?? '';
  const outline = attr(kid(pr ?? p, 'outlineLvl'), 'val');
  const level = ctx.styles.heading.get(styleId) ?? (outline !== undefined && Number(outline) < 9 ? Math.min(6, Number(outline) + 1) : 0);
  const code = ctx.styles.code.has(styleId);
  const runs = runsOf(p, ctx, undefined, [], code);
  if (code) return '```\n' + runs.map((r) => r.text).join('') + '\n```';
  let text = renderRuns(runs).replace(/[ \t]+\n/g, '\n').trim();
  if (!text) return '';
  ctx.stats.paragraphs++;
  if (level) {
    ctx.stats.headings++;
    return `${'#'.repeat(level)} ${text.replace(/\n+/g, ' ')}`;
  }
  const num = kid(pr ?? p, 'numPr');
  const numId = attr(kid(num ?? p, 'numId'), 'val');
  if (num && numId && numId !== '0') {
    const ilvl = Number(attr(kid(num, 'ilvl'), 'val') ?? 0);
    const ordered = ctx.numbering.get(numId)?.get(ilvl) ?? false;
    return `${'    '.repeat(Math.min(ilvl, 8))}${ordered ? '1.' : '-'} ${text.replace(/\n/g, '  \n' + '    '.repeat(ilvl + 1))}`;
  }
  text = escapeLineStart(text);
  // a soft line break inside a paragraph is a Markdown hard break
  return text.replace(/\n/g, '  \n');
}

function tableOf(tbl: XmlElement, ctx: Ctx): string {
  ctx.stats.tables++;
  const rows: string[][] = [];
  for (const tr of kids(tbl, 'tr')) {
    const row: string[] = [];
    for (const tc of kids(tr, 'tc')) {
      const span = Number(attr(kid(kid(tc, 'tcPr') ?? tc, 'gridSpan'), 'val') ?? 1);
      const text = blocks(tc, ctx).join('\n').replace(/\n{2,}/g, '\n');
      row.push(text);
      for (let k = 1; k < span; k++) row.push('');
    }
    rows.push(row);
  }
  return table(rows);
}

/** the blocks of a body, table cell, or content control, in order; list items stay together */
function blocks(el: XmlElement, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const c of el.children) {
    if (!isEl(c)) continue;
    const n = local(c.name);
    if (n === 'p') out.push(paragraph(c, ctx));
    else if (n === 'tbl') out.push(tableOf(c, ctx));
    else if (n === 'sdt') {
      const content = kid(c, 'sdtContent');
      if (content) out.push(...blocks(content, ctx));
    } else if (n === 'ins' || n === 'customXml') out.push(...blocks(c, ctx));
  }
  return out;
}

/** list items are separated by single newlines, everything else by a blank line */
function joinWithLists(items: string[]): string {
  const isItem = (s: string) => /^\s*(-|1\.) /.test(s);
  let out = '';
  let prev = '';
  for (const b of items) {
    if (!b) continue;
    out += out ? (isItem(b) && isItem(prev) ? '\n' : '\n\n') : '';
    out += b;
    prev = b;
  }
  return out;
}

function notes(pkg: OfficePackage, ctx: Ctx): string {
  const lines: string[] = [];
  const parts = { '': pkg.xml('word/footnotes.xml'), e: pkg.xml('word/endnotes.xml') };
  for (const [k, id] of ctx.noteOrder.entries()) {
    const endnote = id.startsWith('e');
    const doc = parts[endnote ? 'e' : ''];
    const raw = endnote ? id.slice(1) : id;
    const note = doc && all(doc, endnote ? 'endnote' : 'footnote').find((f) => attr(f, 'id') === raw);
    if (!note) continue;
    const text = blocks(note, ctx).join(' ').replace(/\s+/g, ' ').trim();
    if (text) lines.push(`[^${k + 1}]: ${text}`);
  }
  ctx.stats.footnotes = lines.length;
  return lines.join('\n');
}

export function docxToMarkdown(bytes: Uint8Array): DocxMarkdown {
  const pkg = openPackage(bytes, 'Word');
  const doc = pkg.xml('word/document.xml');
  const body = doc && all(doc, 'body')[0];
  if (!body) throw new DocError("This Word file has no document body. It may be damaged.");
  const ctx: Ctx = { pkg, styles: readStyles(pkg), numbering: readNumbering(pkg), rels: pkg.rels('word/document.xml'), stats: { paragraphs: 0, headings: 0, tables: 0, images: 0, footnotes: 0 }, noteOrder: [] };
  const main = joinWithLists(blocks(body, ctx));
  const tail = notes(pkg, ctx);
  const core = pkg.xml('docProps/core.xml');
  const title = core ? textOf(all(core, 'title')[0] ?? '').trim() || undefined : undefined;
  return { markdown: joinBlocks([main, tail]) + '\n', title, stats: ctx.stats };
}
