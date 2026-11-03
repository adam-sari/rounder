import { delimiterName } from '@/tools/lib/csv/text';
import { docKind, docxToMarkdown, DocError, pptxToMarkdown, readCsv, readXlsx, sheetsToMarkdown, workbookToMarkdown } from '@/tools/lib/doc-markdown';
import { inspectSheet } from '@/tools/lib/doc-markdown/inspect';
import { RounderError } from '../core/errors';
import type { Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { result, type Ctx, type OpResult } from '../core/run';
import type * as ops from '../ops/files';
import { toTextOp } from './pdf';

/** the readers' own errors as RounderErrors, so the CLI and MCP server report them the same way as the rest */
function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DocError) throw new RounderError(e.code, e.message, { cause: e });
    throw e;
  }
}

async function kindOf(src: Source, bytes: Uint8Array, allowed: string[]) {
  const kind = docKind(src.name, bytes.subarray(0, 8));
  if (!kind || !allowed.includes(kind)) throw new RounderError('unsupported-input', `${src.name} isn't a file this tool reads (${allowed.join(', ')}).`);
  return kind;
}

export async function toMarkdown(inputs: Source[], o: OptionsOut<typeof ops.documentToMarkdown>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const kind = await kindOf(src, bytes, ['pdf', 'docx', 'pptx', 'xlsx', 'csv']);
  if (kind === 'pdf') return toTextOp(inputs, { format: 'markdown', markers: true, join: true, pages: o.pages, password: o.password }, ctx);
  ctx.progress({ stage: 'reading' });
  return wrap(() => {
    if (kind === 'docx') {
      const r = docxToMarkdown(bytes);
      return result({ text: r.markdown, data: { kind, ...(r.title ? { title: r.title } : {}), ...r.stats } });
    }
    if (kind === 'pptx') {
      const r = pptxToMarkdown(bytes, { notes: o.notes });
      return result({ text: r.markdown, data: { kind, ...(r.title ? { title: r.title } : {}), ...r.stats } });
    }
    if (kind === 'xlsx') {
      const r = workbookToMarkdown(bytes, { sheets: o.sheets, maxRows: o.maxRows, hidden: o.hidden });
      const hidden = r.sheets.filter((s) => s.hidden).length;
      const warnings = hidden && !o.hidden ? [`${hidden} hidden sheet${hidden === 1 ? ' was' : 's were'} left out (hidden: true includes them).`] : [];
      return result({ text: r.markdown, warnings, data: { kind, sheets: r.sheets.map((s) => ({ name: s.name, rows: s.rows.length, hidden: s.hidden })) } });
    }
    const sheet = readCsv(bytes, src.name);
    return result({ text: sheetsToMarkdown([sheet], { maxRows: o.maxRows }), data: { kind, rows: sheet.rows.length, delimiter: delimiterName(sheet.delimiter) } });
  });
}

export async function inspectSpreadsheet(inputs: Source[], o: OptionsOut<typeof ops.spreadsheetInspector>): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const kind = await kindOf(src, bytes, ['xlsx', 'csv']);
  return wrap(() => {
    const opts = { sampleRows: o.sampleRows, maxColumns: o.maxColumns };
    if (kind === 'csv') {
      const sheet = readCsv(bytes, src.name);
      const warnings = sheet.truncated ? ['Only the first million rows were read.'] : [];
      return result({ data: { file: src.name, delimiter: delimiterName(sheet.delimiter), sheets: [inspectSheet(sheet, opts)] }, warnings });
    }
    const book = readXlsx(bytes, { sheets: o.sheets });
    const warnings = book.truncated.length ? [`Only the first million rows of ${book.truncated.join(', ')} were read.`] : [];
    const wide = book.sheets.filter((s) => (s.rows[0]?.length ?? 0) > o.maxColumns).map((s) => s.name);
    if (wide.length) warnings.push(`${wide.join(', ')} ha${wide.length === 1 ? 's' : 've'} more than ${o.maxColumns} columns; only the first ${o.maxColumns} are described.`);
    return result({ data: { file: src.name, sheets: book.sheets.map((s) => inspectSheet(s, opts)) }, warnings });
  });
}
