import { getText, loadEditablePdf, openPdf, pdfName, renderPage } from '@/engines/pdf';
import { parsePageRanges } from '@/engines/pdf/ranges';
import { detachPages, dropUnreachable, replacePageWithImage, stripHidden } from '@/tools/lib/redact-pdf/clean';
import type { Box } from '@/tools/lib/redact-pdf/geometry';
import { readBack } from '@/tools/lib/redact-pdf/redact';
import { buildIndex, compileQuery, findRanges, rangeBoxes, type Matcher } from '@/tools/lib/redact-pdf/search';
import { verifyRedaction } from '@/tools/lib/redact-pdf/verify';
import { RounderError, throwIfAborted } from '../core/errors';
import type { Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type Ctx, type OpResult } from '../core/run';
import type * as ops from '../ops/pdf';

/** the parts of an @napi-rs/canvas canvas that pdf.js hands back here */
interface NodeCanvas {
  width: number;
  height: number;
  getContext(t: '2d'): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
  encode(f: 'jpeg', q: number): Promise<Uint8Array>;
}

/** "jane@example.com" → "j…m" */
const mask = (t: string) => (t.length <= 2 ? '…' : `${t[0]}…${t[t.length - 1]}`);

function matchersFor(o: OptionsOut<typeof ops.redactPdf>): Matcher[] {
  const base = { regex: false, matchCase: o.matchCase, wholeWord: o.wholeWords };
  const out = [...compileQuery({ ...base, text: '', presets: o.patterns ?? [] }).matchers];
  for (const t of o.terms ?? []) out.push(...compileQuery({ ...base, text: t, presets: [] }).matchers);
  if (o.regex) {
    const r = compileQuery({ ...base, text: o.regex, regex: true, presets: [] });
    if (r.error) throw new RounderError('invalid-options', r.error);
    out.push(...r.matchers);
  }
  return out;
}

/**
 * True redaction, as on roundertools.com/redact-pdf: every page with a match is rendered to pixels, the matches are
 * painted over, and the page is replaced by that image, so the text under the boxes is gone rather than covered.
 * Pages without a match keep their text. Then the saved file is read back and searched for every redacted string,
 * on its page and in the metadata, bookmarks and comments.
 */
export async function redact(inputs: Source[], o: OptionsOut<typeof ops.redactPdf>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  if (!o.terms?.length && !o.patterns?.length && !o.regex) throw new RounderError('invalid-options', 'Say what to redact: terms, patterns (email, phone, card, ssn) or a regex.');
  const matchers = matchersFor(o);
  const bytes = await src.bytes();
  const view = await openPdf(bytes, { password: o.password });
  try {
    const wanted = o.pages ? parsePageRanges(o.pages, view.numPages, { unique: true }) : Array.from({ length: view.numPages }, (_, i) => i);
    const marks: { page: number; text: string; kind: string }[] = [];
    const boxes = new Map<number, Box[]>();
    let textless = 0;
    for (const [k, i] of wanted.entries()) {
      throwIfAborted(ctx.signal);
      ctx.progress({ stage: 'searching', done: k, total: wanted.length });
      const text = await getText(view, i);
      if (!text.items.some((t) => t.str.trim())) textless++;
      const index = buildIndex(text.items);
      for (const r of findRanges(index.text, matchers)) {
        const found = rangeBoxes(text, index, r.start, r.end);
        if (!found.length) continue;
        marks.push({ page: i, text: index.text.slice(r.start, r.end), kind: r.preset ?? 'text' });
        boxes.set(i, [...(boxes.get(i) ?? []), ...found]);
      }
    }
    const scanned = textless ? `${textless} page${textless === 1 ? ' has' : 's have'} no text layer (scanned), so ${textless === 1 ? 'it was' : 'they were'} not searched.` : '';
    if (!marks.length) {
      throw new RounderError('target-not-met', `Nothing in this PDF matches what you asked to redact.${scanned ? ` ${scanned}` : ''} No file was written.`, {
        hint: textless ? 'OCR scanned pages first (roundertools.com/ocr-pdf), or redact them by hand on roundertools.com/redact-pdf.' : undefined,
      });
    }

    const { doc } = await loadEditablePdf(bytes, { password: o.password });
    const pages = [...boxes.keys()].sort((a, b) => a - b);
    await detachPages(doc, pages);
    for (const [k, i] of pages.entries()) {
      throwIfAborted(ctx.signal);
      ctx.progress({ stage: 'redacting', done: k, total: pages.length });
      const page = await view.getPage(i);
      const [x1, y1, x2, y2] = page.view;
      // drawn unrotated so the image and the boxes share the text's coordinates
      const canvas = (await renderPage(view, i, { dpi: o.dpi, rotation: -page.rotate, signal: ctx.signal })) as unknown as NodeCanvas;
      const c2d = canvas.getContext('2d');
      const sx = canvas.width / (x2 - x1);
      const sy = canvas.height / (y2 - y1);
      c2d.fillStyle = '#000000';
      for (const b of boxes.get(i)!) {
        // whole pixels, rounded outwards, so no half-covered edge is left
        const left = Math.floor(b.x * sx);
        const top = Math.floor(b.y * sy);
        c2d.fillRect(left, top, Math.ceil((b.x + b.width) * sx) - left, Math.ceil((b.y + b.height) * sy) - top);
      }
      const image = await doc.embedJpg(new Uint8Array(await canvas.encode('jpeg', 92)));
      await replacePageWithImage(doc, i, image.ref, [x1, y1, x2, y2]);
    }
    ctx.progress({ stage: 'saving' });
    await stripHidden(doc, { metadata: !o.keepMetadata, extras: false });
    await dropUnreachable(doc);
    const out = await doc.save();

    ctx.progress({ stage: 'checking' });
    const back = await readBack(new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
    const check = verifyRedaction(marks, back.pages, pages, back.extras);
    if (check.textOnRedacted.length) throw new RounderError('failed', `Redacted page ${check.textOnRedacted.map((p) => p + 1).join(', ')} still has text. No file was written.`);
    // matched emails, numbers and SSNs never go back to the caller in full: often the point is keeping them from it
    const kindOf = new Map(marks.map((m) => [m.text.trim(), m.kind]));
    const shown = (t: string) => (kindOf.get(t) && kindOf.get(t) !== 'text' ? `a matched ${kindOf.get(t)} (${mask(t)})` : `"${t}"`);
    const warnings = check.leftovers.map((l) => {
      const where = [l.pages.length ? `on page ${l.pages.map((p) => p + 1).join(', ')}` : '', l.places.length ? `in ${l.places.join(', ')}` : ''].filter(Boolean).join(' and ');
      return `${shown(l.text)} can still be found ${where}${l.pages.length && o.pages ? ' (outside the pages you chose)' : ''}.`;
    });
    if (scanned) warnings.push(scanned);
    const meta = { redactions: marks.length, pages: pages.map((p) => p + 1), verified: !check.leftovers.length, matches: Object.fromEntries([...new Set(marks.map((m) => m.kind))].map((k) => [k, marks.filter((m) => m.kind === k).length])) };
    return result({ files: [new FileOutput({ name: pdfName(src.name, '-redacted'), mime: 'application/pdf', data: out, meta, warnings })] });
  } finally {
    await view.destroy();
  }
}
