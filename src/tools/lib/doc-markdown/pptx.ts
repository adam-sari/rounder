// PowerPoint (.pptx) → Markdown: one section per slide in presentation order, titled from the slide's title
// placeholder, with its text as bullets (indented by level), its tables, its pictures' alt text, and the speaker notes.
// Hidden slides are marked.
import { chartToMarkdown } from './chart';
import { escapeInline, escapeLineStart, joinBlocks, renderRuns, table, type Run } from './markdown';
import { DocError, openPackage, type OfficePackage } from './package';
import { all, attr, isEl, kid, kids, local, relId, textOf, type XmlElement } from './xml';

export interface PptxMarkdown {
  markdown: string;
  title?: string;
  stats: { slides: number; hidden: number; tables: number; charts: number; images: number; notes: number };
}

const on = (v: string | undefined) => v === '1' || v === 'true';

function runs(p: XmlElement, link?: (id: string) => string | undefined): Run[] {
  const out: Run[] = [];
  for (const c of p.children) {
    if (!isEl(c)) continue;
    const n = local(c.name);
    if (n === 'r' || n === 'fld') {
      const pr = kid(c, 'rPr');
      const click = pr && kid(pr, 'hlinkClick');
      const id = relId(click);
      out.push({ text: textOf(kid(c, 't') ?? ''), bold: on(attr(pr, 'b')), italic: on(attr(pr, 'i')), strike: (attr(pr, 'strike') ?? 'noStrike') !== 'noStrike', link: id ? link?.(id) : undefined });
    } else if (n === 'br') out.push({ text: '\n' });
  }
  return out;
}

interface Shape {
  kind: 'title' | 'text' | 'table' | 'picture';
  /** for ordering when a slide has no explicit order: top, then left */
  y: number;
  x: number;
  lines: string[];
}

function placeholder(sp: XmlElement): string | undefined {
  const nv = kid(sp, 'nvSpPr') ?? kid(sp, 'nvPicPr') ?? kid(sp, 'nvGraphicFramePr');
  const ph = nv && all(nv, 'ph')[0];
  return ph ? (attr(ph, 'type') ?? 'body') : undefined;
}

function position(sp: XmlElement): { x: number; y: number } {
  const off = all(sp, 'off')[0];
  return { x: Number(attr(off, 'x') ?? 0), y: Number(attr(off, 'y') ?? 0) };
}

function shapes(tree: XmlElement, rels: ReturnType<OfficePackage['rels']>, stats: PptxMarkdown['stats'], pkg: OfficePackage, out: Shape[] = []): Shape[] {
  const link = (id: string) => {
    const r = rels.get(id);
    return r?.external && /^(https?|mailto):/i.test(r.target) ? r.target : undefined;
  };
  for (const c of tree.children) {
    if (!isEl(c)) continue;
    const n = local(c.name);
    if (n === 'grpSp') shapes(c, rels, stats, pkg, out);
    else if (n === 'sp') {
      const body = kid(c, 'txBody');
      if (!body) continue;
      const ph = placeholder(c);
      const isTitle = ph === 'title' || ph === 'ctrTitle';
      // slide numbers, dates and footers repeat on every slide and say nothing
      if (ph === 'sldNum' || ph === 'dt' || ph === 'ftr') continue;
      const lines: string[] = [];
      for (const p of kids(body, 'p')) {
        const text = renderRuns(runs(p, link)).trim();
        if (!text) continue;
        if (isTitle) lines.push(text.replace(/\s*\n\s*/g, ' '));
        else {
          const lvl = Number(attr(kid(p, 'pPr'), 'lvl') ?? 0);
          lines.push(`${'    '.repeat(Math.min(lvl, 8))}- ${text.replace(/\n/g, '  \n' + '    '.repeat(lvl + 1))}`);
        }
      }
      if (lines.length) out.push({ kind: isTitle ? 'title' : 'text', ...position(c), lines });
    } else if (n === 'graphicFrame') {
      const chartRef = all(c, 'chart')[0];
      const chartRel = chartRef && rels.get(relId(chartRef) ?? '');
      const chartDoc = chartRel && !chartRel.external ? pkg.xml(chartRel.target) : undefined;
      if (chartDoc) {
        const md = chartToMarkdown(chartDoc);
        if (md) {
          stats.charts++;
          out.push({ kind: 'table', ...position(c), lines: [md] });
        }
        continue;
      }
      const tbl = all(c, 'tbl')[0];
      if (!tbl) continue;
      stats.tables++;
      const rows = kids(tbl, 'tr').map((tr) =>
        kids(tr, 'tc').flatMap((tc) => {
          const text = kids(kid(tc, 'txBody') ?? tc, 'p')
            .map((p) => renderRuns(runs(p, link)).trim())
            .filter(Boolean)
            .join('\n');
          // a cell merged into its neighbour (hMerge) shows nothing of its own
          return on(attr(tc, 'hMerge')) ? [''] : [text];
        }),
      );
      out.push({ kind: 'table', ...position(c), lines: [table(rows)] });
    } else if (n === 'pic') {
      stats.images++;
      const pr = all(c, 'cNvPr')[0];
      const alt = (attr(pr, 'descr') || '').replace(/\s+/g, ' ').trim();
      if (alt) out.push({ kind: 'picture', ...position(c), lines: [`![${alt.replace(/[[\]]/g, '')}]()`] });
    }
  }
  return out;
}

function notesOf(pkg: OfficePackage, slidePath: string): string {
  const rel = [...pkg.rels(slidePath).values()].find((r) => r.type.endsWith('/notesSlide'));
  const doc = rel && pkg.xml(rel.target);
  if (!doc) return '';
  const parts: string[] = [];
  for (const sp of all(doc, 'sp')) {
    if (placeholder(sp) !== 'body') continue;
    for (const p of all(sp, 'p')) {
      const t = renderRuns(runs(p)).trim();
      if (t) parts.push(t);
    }
  }
  return parts.join('\n');
}

export function pptxToMarkdown(bytes: Uint8Array, { notes = true }: { notes?: boolean } = {}): PptxMarkdown {
  const pkg = openPackage(bytes, 'PowerPoint');
  const pres = pkg.xml('ppt/presentation.xml');
  if (!pres) throw new DocError('This PowerPoint file has no presentation part. It may be damaged.');
  const presRels = pkg.rels('ppt/presentation.xml');
  const order = all(pres, 'sldId')
    .map((s) => presRels.get(relId(s) ?? ''))
    .filter((r): r is NonNullable<typeof r> => !!r && !r.external)
    .map((r) => r.target);
  const stats: PptxMarkdown['stats'] = { slides: 0, hidden: 0, tables: 0, charts: 0, images: 0, notes: 0 };
  const sections: string[] = [];
  for (const [i, path] of order.entries()) {
    const slide = pkg.xml(path);
    if (!slide) continue;
    stats.slides++;
    const root = all(slide, 'sld')[0];
    const hidden = attr(root, 'show') === '0' || attr(root, 'show') === 'false';
    if (hidden) stats.hidden++;
    const tree = all(slide, 'spTree')[0];
    // reading order: top to bottom, then left to right (the tree is in drawing order, which can be anything)
    const found = (tree ? shapes(tree, pkg.rels(path), stats, pkg) : []).sort((a, b) => (Math.abs(a.y - b.y) > 100_000 ? a.y - b.y : a.x - b.x));
    const placeholderTitle = found.find((s) => s.kind === 'title');
    // no title placeholder (slides made by code often have none): the topmost text, when it's one short line
    const first = found[0];
    const fallback = !placeholderTitle && first?.kind === 'text' && first.lines.length === 1 && /^- /.test(first.lines[0]) && first.lines[0].length <= 122 ? first : undefined;
    const title = placeholderTitle ?? fallback;
    const titleText = title?.lines.map((l) => l.replace(/^- /, '').replace(/^\*\*(.*)\*\*$/, '$1')).join(' ');
    const rest = found.filter((s) => s !== title);
    const heading = `## Slide ${i + 1}${titleText ? `: ${titleText}` : ''}${hidden ? ' (hidden)' : ''}`;
    const body = rest.map((s) => (s.kind === 'text' ? s.lines.map((l) => (l.startsWith(' ') || l.startsWith('-') ? l : escapeLineStart(l))).join('\n') : s.lines.join('\n')));
    const note = notes ? notesOf(pkg, path) : '';
    if (note) stats.notes++;
    sections.push(joinBlocks([heading, ...body, note ? note.split('\n').map((l) => `> ${l}`).join('\n').replace(/^> /, '> **Notes:** ') : '']));
  }
  const core = pkg.xml('docProps/core.xml');
  const docTitle = core ? textOf(all(core, 'title')[0] ?? '').trim() || undefined : undefined;
  const top = docTitle ? `# ${escapeInline(docTitle)}` : '';
  return { markdown: joinBlocks([top, ...sections]) + '\n', title: docTitle, stats };
}
