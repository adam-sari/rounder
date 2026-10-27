/*
 * Page models → a .docx (the MIT-licensed `docx` package). Text stays editable: real paragraphs
 * with their fonts, sizes, bold/italic and colors, Word headings (so the navigation pane works),
 * Word bullet and numbered lists, tables and pictures. Each PDF page starts a new page.
 */
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import { bodySize, type Block, type PageModel, type ParagraphBlock, type Run, type TableBlock } from './model';

export interface DocxPicture {
  data: Uint8Array;
  type: 'png' | 'jpg';
}

export interface DocxOptions {
  /** pictures per page, by index into the page's pictures (missing = left out) */
  pictures?: (DocxPicture | null | undefined)[][];
  title?: string;
  /** start each PDF page on a new Word page (default true) */
  pageBreaks?: boolean;
}

const twips = (pt: number) => Math.round(pt * 20);
const halfPoints = (pt: number) => Math.max(2, Math.round(pt * 2));
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;
const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
const BULLETS = ['•', '◦', '▪'];

/** the font most of the document is set in */
function mainFont(pages: PageModel[]) {
  const chars = new Map<string, number>();
  for (const p of pages) for (const b of p.blocks) if (b.kind === 'paragraph') for (const r of b.runs) chars.set(r.font, (chars.get(r.font) ?? 0) + r.text.length);
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Calibri';
}

function textRun(r: Run, extra: { style?: string } = {}) {
  return new TextRun({
    ...(r.tab ? { children: [new Tab(), r.text] } : { text: r.text }),
    bold: r.bold,
    italics: r.italic,
    size: halfPoints(r.size),
    font: r.font,
    color: r.color?.slice(1),
    superScript: r.sup,
    ...extra,
  });
}

function runsOf(runs: Run[]): ParagraphChild[] {
  return runs.map((r) => (r.link ? new ExternalHyperlink({ link: r.link, children: [textRun(r, { style: 'Hyperlink' })] }) : textRun(r)));
}

/** Word's own line spacing (240 = single) for the PDF's line pitch */
function lineSpacing(ratio: number) {
  // Word's single spacing is about 1.2 em for the usual fonts (Calibri 1.22, Arial and Times 1.15)
  const line = Math.round((240 * ratio) / 1.2);
  return Math.abs(line - 240) < 30 || !Number.isFinite(line) ? undefined : Math.min(720, Math.max(240, line));
}

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** margins from where the text sits, kept within sensible bounds */
function marginsOf(page: PageModel): Margins {
  const { area, width, height } = page;
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(108, Math.max(18, v)) : 72);
  if (!page.blocks.length) return { top: 72, right: 72, bottom: 72, left: 72 };
  return { top: clamp(height + area.top - 4), bottom: clamp(-area.bottom - 4), left: clamp(area.x0 - 2), right: clamp(width - area.x1 - 2) };
}

/** Numbered lists keep their numbers: "1." starts a list, the next number continues it, anything else stays typed text */
class Lists {
  private instance = 0;
  private numbers: number[] = [];
  numbering(p: ParagraphBlock): { reference: string; level: number; instance: number } | null {
    const { type, level, start = 1 } = p.list!;
    if (type === 'bullet') return { reference: 'bullets', level, instance: 0 };
    if (level === 0 && start === 1) {
      this.instance++;
      this.numbers = [1];
    } else if (start === (this.numbers[level] ?? 0) + 1) {
      this.numbers[level] = start;
      // a deeper list starts over under the next item
      this.numbers.length = level + 1;
    } else return null;
    return { reference: 'numbers', level, instance: this.instance };
  }
}

function paragraph(p: ParagraphBlock, lists: Lists, first: boolean): Paragraph {
  const numbering = p.list ? lists.numbering(p) : null;
  const runs = p.list && !numbering && p.list.type === 'number' ? [{ ...p.runs[0], text: `${p.list.start}. ${p.runs[0].text}` }, ...p.runs.slice(1)] : p.runs;
  return new Paragraph({
    children: runsOf(runs),
    heading: p.heading ? HEADING[p.heading - 1] : undefined,
    alignment: ALIGN[p.align],
    numbering: numbering ?? undefined,
    indent: !numbering && p.indent ? { left: twips(p.indent) } : undefined,
    spacing: { before: first ? 0 : twips(p.before), after: 0, line: lineSpacing(p.spacing) },
    keepNext: p.heading ? true : undefined,
  });
}

function table(t: TableBlock, size: number, font: string): Table {
  const widths = t.widths.map(twips);
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: t.rows.map(
      (row, r) =>
        new TableRow({
          tableHeader: t.header && r === 0,
          children: row.map(
            (cell, c) =>
              new TableCell({
                width: { size: widths[c], type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: cell.text, bold: cell.bold, size: halfPoints(size), font })] })],
              }),
          ),
        }),
    ),
  });
}

function picture(block: Extract<Block, { kind: 'picture' }>, pic: DocxPicture, page: PageModel, maxWidth: number): Paragraph {
  const { rect } = block;
  let w = rect.x1 - rect.x0;
  let h = rect.bottom - rect.top;
  if (w > maxWidth) [w, h] = [maxWidth, (h * maxWidth) / w];
  // ImageRun sizes are in pixels at 96 dpi
  const px = (pt: number) => Math.max(1, Math.round((pt * 96) / 72));
  const mid = (rect.x0 + rect.x1) / 2 - (page.area.x0 + page.area.x1) / 2;
  return new Paragraph({
    alignment: Math.abs(mid) < (page.area.x1 - page.area.x0) * 0.05 ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new ImageRun({ type: pic.type, data: pic.data, transformation: { width: px(w), height: px(h) } })],
  });
}

/** The .docx document for the pages; pack it with Packer (toBlob in browsers) */
export function buildDocx(pages: PageModel[], { pictures = [], title, pageBreaks = true }: DocxOptions = {}): Document {
  const font = mainFont(pages);
  const body = bodySize(pages);
  const lists = new Lists();
  const sections: ISectionOptions[] = [];
  let children: (Paragraph | Table)[] = [];
  let current: { width: number; height: number; margins: Margins } | null = null;

  const flush = () => {
    if (current) {
      const { width, height, margins } = current;
      sections.push({
        properties: { page: { size: { width: twips(width), height: twips(height) }, margin: { top: twips(margins.top), right: twips(margins.right), bottom: twips(margins.bottom), left: twips(margins.left) } } },
        children: children.length ? children : [new Paragraph({})],
      });
    }
    children = [];
  };

  pages.forEach((page, n) => {
    const sameSize = current && Math.abs(current.width - page.width) < 2 && Math.abs(current.height - page.height) < 2;
    // a new page size needs a new section, which starts a new page by itself
    if (!sameSize) {
      flush();
      current = { width: page.width, height: page.height, margins: marginsOf(page) };
    } else if (pageBreaks && n > 0) children.push(new Paragraph({ children: [new PageBreak()], spacing: { before: 0, after: 0 } }));
    const maxWidth = page.width - current!.margins.left - current!.margins.right;
    page.blocks.forEach((b, k) => {
      if (b.kind === 'paragraph') children.push(paragraph(b, lists, k === 0));
      else if (b.kind === 'table') {
        children.push(table(b, b.size || Math.min(body, 11), font));
        // Word glues two tables together without a paragraph between them
        children.push(new Paragraph({ spacing: { before: 0, after: 0 } }));
      } else {
        const pic = pictures[n]?.[b.index];
        if (pic) children.push(picture(b, pic, page, maxWidth));
      }
    });
  });
  flush();

  const level = (i: number, text: string, format: (typeof LevelFormat)[keyof typeof LevelFormat]) => ({
    level: i,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 * (i + 1) + 360, hanging: 360 } } },
  });
  return new Document({
    title,
    creator: 'Rounder Tools (roundertools.com)',
    styles: {
      default: {
        document: { run: { font, size: halfPoints(body) } },
        heading1: { run: { color: '000000' } },
        heading2: { run: { color: '000000' } },
        heading3: { run: { color: '000000' } },
      },
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: BULLETS.map((b, i) => level(i, b, LevelFormat.BULLET)) },
        { reference: 'numbers', levels: ['%1.', '%2.', '%3.'].map((t, i) => level(i, t, i === 1 ? LevelFormat.LOWER_LETTER : i === 2 ? LevelFormat.LOWER_ROMAN : LevelFormat.DECIMAL)) },
      ],
    },
    sections,
  });
}

export const docxBlob = (doc: Document) => Packer.toBlob(doc);
export const docxBytes = async (doc: Document) => new Uint8Array(await Packer.toArrayBuffer(doc));
