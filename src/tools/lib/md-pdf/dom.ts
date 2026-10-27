/**
 * Sanitized HTML (a DOMParser body) → the document model. Markdown goes
 * through marked first, so both modes share this, raw HTML in Markdown included.
 * Follows browser rules where it matters: whitespace collapses, bare text
 * between blocks forms margin-less paragraphs, block content inside a table
 * cell or heading starts a new line.
 */
import type { Align, Block, InlineImage, ListItem, Run } from './model';

const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]);
// things with no printable text, or that this layout can't draw
const SKIP = new Set([
  'audio', 'button', 'canvas', 'embed', 'head', 'iframe', 'input', 'link', 'map', 'math', 'meta', 'noscript', 'object', 'option', 'script',
  'select', 'style', 'svg', 'template', 'textarea', 'title', 'video',
]);

type Style = Omit<Run, 'text' | 'br' | 'img'>;

// control and zero-width characters have no glyph and would print as boxes
const INVISIBLE = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F­​-‍⁠﻿]/g;
const collapse = (s: string) => s.replace(INVISIBLE, '').replace(/[ \t\n\r\f]+/g, ' ');

export function htmlToBlocks(root: Node): Block[] {
  const out: Block[] = [];
  let inline: Run[] = [];
  const flush = () => {
    out.push(...paragraph(inline, true));
    inline = [];
  };
  for (const node of root.childNodes) {
    const tag = node.nodeType === 1 ? (node as Element).localName : '';
    if (BLOCKS.has(tag)) {
      flush();
      out.push(...block(node as Element));
    } else inlineRuns(node, {}, inline);
  }
  flush();
  return out;
}

function block(el: Element): Block[] {
  const tag = el.localName;
  switch (tag) {
    case 'p':
      return paragraph(inlineOf(el), false);
    case 'dt':
      return paragraph(inlineOf(el, { b: true }), true);
    case 'figcaption':
    case 'summary':
      return paragraph(inlineOf(el, { i: tag === 'figcaption' }), true);
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const runs = tidy(inlineOf(el));
      return runs.length ? [{ t: 'h', level: Number(tag[1]), runs }] : [];
    }
    case 'pre':
      return [{ t: 'code', text: (el.textContent ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '').replace(INVISIBLE, '') }];
    case 'ul':
    case 'ol':
      return [list(el)];
    case 'blockquote':
      return [{ t: 'quote', blocks: htmlToBlocks(el) }];
    case 'hr':
      return [{ t: 'hr' }];
    case 'table':
      return table(el as HTMLTableElement);
    default:
      return htmlToBlocks(el);
  }
}

/** A paragraph, or image blocks when it holds nothing but images */
function paragraph(raw: Run[], tight: boolean): Block[] {
  const runs = tidy(raw);
  if (!runs.length) return [];
  if (runs.every((r) => r.img || r.br)) return runs.flatMap((r) => (r.img ? [{ t: 'img' as const, ...r.img, href: r.href }] : []));
  return [tight ? { t: 'p', runs, tight } : { t: 'p', runs }];
}

function inlineOf(el: Element, style: Style = {}): Run[] {
  const out: Run[] = [];
  for (const child of el.childNodes) inlineRuns(child, style, out);
  return out;
}

function inlineRuns(node: Node, style: Style, out: Run[]) {
  if (node.nodeType === 3) {
    const text = collapse((node as Text).data);
    if (text) out.push({ ...style, text });
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.localName;
  if (SKIP.has(tag)) return;
  if (tag === 'br') {
    out.push({ text: '', br: true });
    return;
  }
  if (tag === 'img') {
    const img = imageOf(el);
    if (img) out.push({ text: '', img, ...(style.href ? { href: style.href } : {}) });
    return;
  }
  const s = { ...style };
  switch (tag) {
    case 'strong':
    case 'b':
    case 'th':
      s.b = true;
      break;
    case 'em':
    case 'i':
    case 'cite':
    case 'var':
    case 'dfn':
      s.i = true;
      break;
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      s.code = true;
      break;
    case 'del':
    case 's':
    case 'strike':
      s.s = true;
      break;
    case 'u':
    case 'ins':
      s.u = true;
      break;
    case 'a': {
      const href = safeHref(el.getAttribute('href'));
      if (href) s.href = href;
      break;
    }
  }
  // a block inside inline content (a list in a table cell, say) gets its own line
  const isBlock = BLOCKS.has(tag);
  const lineBreak = () => out.length && !out.at(-1)!.br && out.push({ text: '', br: true });
  if (isBlock) lineBreak();
  for (const child of el.childNodes) inlineRuns(child, s, out);
  if (isBlock) lineBreak();
}

const sameStyle = (a: Run, b: Run) => a.b === b.b && a.i === b.i && a.code === b.code && a.s === b.s && a.u === b.u && a.href === b.href;

/** Collapses spaces across runs, trims each line's ends and merges runs that look the same */
export function tidy(runs: Run[]): Run[] {
  const out: Run[] = [];
  const trimEnd = () => {
    for (let last = out.at(-1); last && !last.br && !last.img; last = out.at(-1)) {
      last.text = last.text.replace(/ +$/, '');
      if (last.text) return;
      out.pop();
    }
  };
  let afterSpace = true;
  for (const r of runs) {
    if (r.br || r.img) {
      if (r.br) trimEnd();
      out.push(r);
      afterSpace = !!r.br;
      continue;
    }
    const text = afterSpace ? r.text.replace(/^ +/, '') : r.text;
    if (!text) continue;
    afterSpace = text.endsWith(' ');
    const prev = out.at(-1);
    if (prev && !prev.br && !prev.img && sameStyle(prev, r)) prev.text += text;
    else out.push({ ...r, text });
  }
  trimEnd();
  // a trailing break adds no line, as in a browser
  while (out.at(-1)?.br) out.pop();
  return out;
}

function list(el: Element): Block {
  const ordered = el.localName === 'ol';
  const items: ListItem[] = [];
  for (const child of el.children) {
    if (child.localName === 'li') {
      const box = child.querySelector(':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]');
      const blocks = htmlToBlocks(child);
      items.push(box ? { task: box.hasAttribute('checked') ? 'done' : 'todo', blocks } : { blocks });
    } else if (child.localName === 'ul' || child.localName === 'ol') {
      // a list nested straight inside a list (invalid, but common) belongs to the item before it
      const nested = list(child);
      if (items.length) items.at(-1)!.blocks.push(nested);
      else items.push({ blocks: [nested] });
    }
  }
  const start = ordered ? parseInt(el.getAttribute('start') ?? '', 10) : NaN;
  return { t: 'list', ordered, start: Number.isFinite(start) ? start : 1, items };
}

function table(el: HTMLTableElement): Block[] {
  const rows = Array.from(el.rows);
  if (!rows.length) return [];
  const cellsOf = (tr: HTMLTableRowElement) => Array.from(tr.cells).map((cell) => tidy(inlineOf(cell)));
  const first = rows[0];
  const firstCells = Array.from(first.cells);
  const head = first.parentElement?.localName === 'thead' || (firstCells.length > 0 && firstCells.every((c) => c.localName === 'th'));
  const align = firstCells.map((c): Align => {
    const a = (c.getAttribute('align') || c.style.textAlign || '').toLowerCase();
    return a === 'center' || a === 'right' ? a : 'left';
  });
  return [{ t: 'table', align, head: head ? cellsOf(first) : null, rows: (head ? rows.slice(1) : rows).map(cellsOf) }];
}

function imageOf(el: Element): InlineImage | null {
  const src = el.getAttribute('src')?.trim();
  if (!src) return null;
  const img: InlineImage = { src, alt: collapse(el.getAttribute('alt') ?? '').trim() };
  const px = (name: string) => {
    const m = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(el.getAttribute(name) ?? '');
    return m && Number(m[1]) > 0 ? Number(m[1]) : undefined;
  };
  const width = px('width');
  const height = px('height');
  if (width) img.width = width;
  if (height) img.height = height;
  return img;
}

/** Only links that make sense in a PDF; page anchors and script URLs are dropped */
export function safeHref(href: string | null): string | undefined {
  const h = href?.trim();
  return h && /^(https?:|mailto:|tel:)/i.test(h) ? h : undefined;
}
