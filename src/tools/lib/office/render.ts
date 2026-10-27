/*
 * Office files → pages laid out in the browser, for dom-pdf.ts to paint:
 *   Word (.docx)        docx-preview (Apache-2.0): Word's page size, margins, styles, tables, pictures,
 *                       headers and footers; pages follow Word's own page breaks where it saved them
 *   Excel (.xlsx)       exceljs (MIT) reads cells, styles, merges and column widths; SSF (Apache-2.0)
 *                       formats numbers and dates the way Excel shows them
 *   PowerPoint (.pptx)  @aiden0z/pptx-renderer (Apache-2.0): shapes, text, pictures, tables, charts
 */
import type { Cell, Workbook, Worksheet } from 'exceljs';
import { useStandInFonts, type PageSource } from './dom-pdf';
import { registerFonts } from './fonts';

const px = (pt: number) => (pt * 96) / 72;

async function imagesReady(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : img.decode().catch(() => {}))));
}

/* ---------------- Word ---------------- */

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** A CSS counter value in a list-style-type, as browsers write it */
export function counterText(n: number, style = 'decimal'): string {
  const alpha = (v: number) => {
    let s = '';
    for (let x = v; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
    return s;
  };
  const roman = (v: number) => ROMAN.reduce((s, [k, r]) => {
    while (v >= k) [s, v] = [s + r, v - k];
    return s;
  }, '');
  switch (style) {
    case 'lower-alpha':
    case 'lower-latin':
      return alpha(n);
    case 'upper-alpha':
    case 'upper-latin':
      return alpha(n).toUpperCase();
    case 'lower-roman':
      return roman(n);
    case 'upper-roman':
      return roman(n).toUpperCase();
    case 'decimal-leading-zero':
      return String(n).padStart(2, '0');
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** "a 1 b 0" → [['a', 1], ['b', 0]]; `fallback` is the value a bare name gets */
export function counterPairs(css: string, fallback: number): [string, number][] {
  if (!css || css === 'none') return [];
  const out: [string, number][] = [];
  const parts = css.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i + 1]);
    if (parts[i + 1] !== undefined && Number.isFinite(n)) out.push([parts[i], n]), i++;
    else out.push([parts[i], fallback]);
  }
  return out;
}

/** Evaluates a computed `content` value: strings and counter(name, style) */
export function evalContent(content: string, counters: Map<string, number>): string {
  if (!content || content === 'none' || content === 'normal') return '';
  let out = '';
  for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/g)) {
    if (m[1] !== undefined) out += m[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, '$1');
    else out += counterText(counters.get(m[2]) ?? 0, m[3]);
  }
  return out;
}

const MARKER_STYLE = ['display', 'font-size', 'font-weight', 'font-style', 'font-family', 'color', 'width', 'min-width', 'padding-left', 'padding-right', 'margin-left', 'margin-right', 'vertical-align', 'letter-spacing', 'white-space', 'text-decoration-line'];

/**
 * docx-preview draws list bullets and numbers with ::before and CSS counters, which the PDF
 * painter can't see. This writes them into the page as real spans, styled like the pseudo-element.
 */
export function materializeMarkers(root: HTMLElement): void {
  const counters = new Map<string, number>();
  const sheet = document.createElement('style');
  sheet.textContent = '.rounder-marker::before{content:none!important}';
  root.prepend(sheet);
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const cs = getComputedStyle(el);
    for (const [name, v] of counterPairs(cs.counterReset, 0)) counters.set(name, v);
    for (const [name, v] of counterPairs(cs.counterSet, 0)) counters.set(name, v);
    for (const [name, v] of counterPairs(cs.counterIncrement, 1)) counters.set(name, (counters.get(name) ?? 0) + v);
    const before = getComputedStyle(el, '::before');
    if (!before.content || before.content === 'none' || before.content === 'normal') continue;
    for (const [name, v] of counterPairs(before.counterReset, 0)) counters.set(name, v);
    for (const [name, v] of counterPairs(before.counterSet, 0)) counters.set(name, v);
    for (const [name, v] of counterPairs(before.counterIncrement, 1)) counters.set(name, (counters.get(name) ?? 0) + v);
    const text = evalContent(before.content, counters);
    if (!text.trim()) continue;
    const span = document.createElement('span');
    span.textContent = text;
    for (const p of MARKER_STYLE) span.style.setProperty(p, before.getPropertyValue(p));
    el.prepend(span);
    el.classList.add('rounder-marker');
  }
}

export async function renderDocx(data: ArrayBuffer, host: HTMLElement): Promise<PageSource[]> {
  const { renderAsync } = await import('docx-preview');
  const style = document.createElement('div');
  const body = document.createElement('div');
  host.append(style, body);
  await renderAsync(data, body, style, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    // Word saves where its pages broke; following that keeps the page count Word showed
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    useBase64URL: true,
    ignoreFonts: true,
    experimental: true,
  });
  // Word doesn't hyphenate unless asked to, and the browser's hyphens aren't in the text the PDF is made from
  const plain = document.createElement('style');
  // and a document that sets no defaults is 10 pt Times New Roman in Word, not the browser's 12 pt
  plain.textContent = ".docx, .docx * { hyphens: manual !important; -webkit-hyphens: manual !important } :where(.docx) { font-size: 10pt; font-family: 'Times New Roman' }";
  body.prepend(plain);
  materializeMarkers(body);
  await registerFonts();
  await useStandInFonts(body);
  await imagesReady(body);
  return [...body.querySelectorAll<HTMLElement>('section.docx')].map((el) => {
    const cs = getComputedStyle(el);
    return {
      el,
      pageHeight: parseFloat(cs.minHeight) || undefined,
      margins: { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 },
      header: el.querySelector<HTMLElement>(':scope > header'),
      footer: el.querySelector<HTMLElement>(':scope > footer'),
    };
  });
}

/* ---------------- Excel ---------------- */

export interface SheetOptions {
  paper: 'letter' | 'a4';
  /** auto = the sheet's own setting, else landscape when it's wider than tall */
  orientation: 'auto' | 'portrait' | 'landscape';
  /** shrink wide sheets so every column fits across the page */
  fitWidth: boolean;
  gridlines: boolean;
  /** sheet names to include; all when empty */
  sheets?: string[];
}

const PAPER = { letter: [612, 792], a4: [595.28, 841.89] } as const;
const MARGIN = 36; // points, Excel's "narrow" margins

/** Excel's default Office theme colors, for cells colored by theme */
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

/** an exceljs color as CSS, applying a theme tint */
export function cssColor(c: { argb?: string; theme?: number; tint?: number } | undefined): string | undefined {
  if (!c) return undefined;
  let hex = c.argb ? c.argb.slice(-6) : c.theme !== undefined ? THEME[c.theme] : undefined;
  if (!hex) return undefined;
  if (c.tint) {
    const t = c.tint;
    hex = [0, 2, 4]
      .map((i) => {
        const v = parseInt(hex!.slice(i, i + 2), 16);
        return Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t)
          .toString(16)
          .padStart(2, '0');
      })
      .join('');
  }
  return `#${hex}`;
}

type Ssf = typeof import('ssf');

/** What Excel shows in a cell: numbers and dates through their number format */
export function cellText(cell: Pick<Cell, 'value' | 'numFmt'>, ssf: Ssf): { text: string; number: boolean } {
  let v = cell.value as unknown;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string; formula?: string };
    if ('richText' in o && o.richText) return { text: o.richText.map((r) => r.text).join(''), number: false };
    if ('error' in o && o.error) return { text: o.error, number: false };
    if ('text' in o && o.text !== undefined) return { text: String(o.text), number: false };
    v = 'result' in o ? o.result : '';
    if (v && typeof v === 'object' && 'error' in (v as object)) return { text: (v as { error: string }).error, number: false };
  }
  if (v === null || v === undefined) return { text: '', number: false };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', number: false };
  if (v instanceof Date) {
    const serial = (v.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;
    const fmt = cell.numFmt && ssf.is_date(cell.numFmt) ? cell.numFmt : 'm/d/yyyy';
    return { text: ssf.format(fmt, serial), number: true };
  }
  if (typeof v === 'number') {
    try {
      return { text: ssf.format(cell.numFmt || 'General', v), number: true };
    } catch {
      return { text: String(v), number: true };
    }
  }
  return { text: String(v), number: false };
}

const BORDER: Record<string, string> = { thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid', thick: '3px solid', double: '3px double', mediumDashed: '2px dashed' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One sheet as an HTML table at scale `k`, with its used range, merges and styles */
function sheetTable(ws: Worksheet, ssf: Ssf, k: number, gridlines: boolean): { html: string; width: number } {
  const rows = ws.actualRowCount ? ws.rowCount : 0;
  const cols = ws.columnCount;
  const colWidth = (c: number) => {
    const col = ws.getColumn(c);
    return col.hidden ? 0 : Math.round(((col.width ?? ws.properties.defaultColWidth ?? 8.43) * 7 + 5) * k);
  };
  const widths = Array.from({ length: cols }, (_, i) => colWidth(i + 1));
  const covered = new Set<string>();
  const spans = new Map<string, { rows: number; cols: number }>();
  for (const range of (ws.model as { merges?: string[] }).merges ?? []) {
    const [a, b] = range.split(':').map((ref) => ws.getCell(ref));
    spans.set(`${a.row}:${a.col}`, { rows: Number(b.row) - Number(a.row) + 1, cols: Number(b.col) - Number(a.col) + 1 });
    for (let r = Number(a.row); r <= Number(b.row); r++) for (let c = Number(a.col); c <= Number(b.col); c++) if (r !== Number(a.row) || c !== Number(a.col)) covered.add(`${r}:${c}`);
  }
  const grid = gridlines ? `${Math.max(1, k)}px solid #d4d4d4` : '';
  let html = `<table style="border-collapse:collapse;table-layout:fixed;width:${widths.reduce((a, b) => a + b, 0)}px"><colgroup>${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>`;
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    if (row.hidden) continue;
    const h = Math.round(px(row.height ?? ws.properties.defaultRowHeight ?? 15) * k);
    html += `<tr style="height:${h}px">`;
    for (let c = 1; c <= cols; c++) {
      if (covered.has(`${r}:${c}`) || !widths[c - 1]) continue;
      const cell = ws.getCell(r, c);
      const span = spans.get(`${r}:${c}`);
      const { text, number } = cellText(cell, ssf);
      const f = cell.font ?? {};
      // files can say "general" (the default) even though exceljs's types leave it out
      const h = cell.alignment?.horizontal as string | undefined;
      const css = [
        `font-size:${((f.size ?? 11) * 4 * k) / 3}px`,
        `font-family:'${(f.name ?? 'Calibri').replace(/'/g, '')}'`,
        f.bold ? 'font-weight:700' : '',
        f.italic ? 'font-style:italic' : '',
        f.underline ? 'text-decoration:underline' : '',
        f.strike ? 'text-decoration:line-through' : '',
        cssColor(f.color) ? `color:${cssColor(f.color)}` : '',
        `padding:0 ${Math.round(3 * k)}px`,
        `text-align:${h && h !== 'general' ? (h === 'centerContinuous' ? 'center' : h === 'fill' || h === 'distributed' ? 'justify' : h) : number ? 'right' : 'left'}`,
        `vertical-align:${cell.alignment?.vertical === 'top' ? 'top' : cell.alignment?.vertical === 'middle' ? 'middle' : 'bottom'}`,
        cell.alignment?.wrapText ? 'white-space:pre-wrap;overflow-wrap:anywhere' : 'white-space:pre;overflow:hidden',
      ];
      const fill = cell.fill?.type === 'pattern' && cell.fill.pattern !== 'none' ? cssColor(cell.fill.fgColor) : undefined;
      if (fill) css.push(`background:${fill}`);
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const b = cell.border?.[side];
        if (b?.style) css.push(`border-${side}:${BORDER[b.style] ?? '1px solid'} ${cssColor(b.color) ?? '#000'}`);
        else if (grid) css.push(`border-${side}:${grid}`);
      }
      const attrs = span ? ` rowspan="${span.rows}" colspan="${span.cols}"` : '';
      html += `<td${attrs} style="${css.filter(Boolean).join(';')}">${esc(text)}</td>`;
    }
    html += '</tr>';
  }
  return { html: html + '</table>', width: widths.reduce((a, b) => a + b, 0) };
}

export async function readWorkbook(data: ArrayBuffer): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb;
}

/** sheets worth printing: visible, with something in them */
export const printableSheets = (wb: Workbook) => wb.worksheets.filter((ws) => ws.state === 'visible' && ws.actualRowCount > 0);

/** cells laid out in one go: 20,000 rows × 8 columns took 30 s on a desktop, and every cell lives in the page meanwhile */
export const MAX_CELLS = 300_000;

export async function renderXlsx(wb: Workbook, host: HTMLElement, o: SheetOptions): Promise<PageSource[]> {
  const ssf = await import('ssf');
  const chosen = printableSheets(wb).filter((ws) => !o.sheets?.length || o.sheets.includes(ws.name));
  const cells = chosen.reduce((n, ws) => n + ws.rowCount * ws.columnCount, 0);
  if (cells > MAX_CELLS)
    throw new Error(`This workbook has about ${cells.toLocaleString('en-US')} cells to print, more than can be laid out in a browser tab at once (${MAX_CELLS.toLocaleString('en-US')}). Pick fewer sheets, or delete unused rows and columns, and try again.`);
  await registerFonts();
  const out: PageSource[] = [];
  for (const ws of chosen) {
    const natural = sheetTable(ws, ssf, 1, o.gridlines).width;
    const own = ws.pageSetup?.orientation;
    const [pw, ph] = PAPER[o.paper];
    const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && (own ? own === 'landscape' : px(ph - 2 * MARGIN) < natural));
    const [W, H] = landscape ? [px(ph), px(pw)] : [px(pw), px(ph)];
    const room = W - 2 * px(MARGIN);
    const k = o.fitWidth && natural > room ? room / natural : 1;
    const page = document.createElement('div');
    page.style.cssText = `width:${W}px;min-height:${H}px;padding:${px(MARGIN)}px;box-sizing:border-box;background:#fff;color:#000;line-height:1.15`;
    page.innerHTML = sheetTable(ws, ssf, k, o.gridlines).html;
    host.append(page);
    out.push({ el: page, pageHeight: H, margins: { top: px(MARGIN), bottom: px(MARGIN) } });
  }
  for (const s of out) await useStandInFonts(s.el);
  return out;
}

/* ---------------- PowerPoint ---------------- */

export async function renderPptx(data: ArrayBuffer, host: HTMLElement): Promise<{ pages: PageSource[]; dispose: () => void }> {
  const { parseZip, buildPresentation, renderSlide, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
  const files = await parseZip(data, RECOMMENDED_ZIP_LIMITS);
  const pres = buildPresentation(files);
  await registerFonts();
  const handles: { dispose: () => void }[] = [];
  const pages: PageSource[] = [];
  for (const slide of pres.slides) {
    if ((slide as { hidden?: boolean }).hidden) continue;
    const handle = renderSlide(pres, slide, { externalMedia: 'block' });
    const frame = document.createElement('div');
    frame.style.cssText = `position:relative;width:${pres.width}px;height:${pres.height}px;overflow:hidden;background:#fff`;
    frame.append(handle.element);
    host.append(frame);
    await handle.ready;
    handles.push(handle);
    pages.push({ el: frame });
  }
  for (const p of pages) await useStandInFonts(p.el);
  for (const p of pages) await imagesReady(p.el);
  return { pages, dispose: () => handles.forEach((h) => h.dispose()) };
}
