import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { embedFontWithFallback, isWinAnsi, loadPdfLibModule } from '@/engines/pdf/lib';
import { baseline, displayMatrix, displaySize, inkPath, linePaths, markPath, textLines } from './geometry';
import { HIGHLIGHT_OPACITY, type Asset, type OverlayObject, type PageInfo, type TextObj } from './model';

/** true when a text object would draw nothing */
export const isBlank = (o: OverlayObject) => o.kind === 'text' && !o.text.trim();

/**
 * Draws the objects onto their pages as real PDF content: vector shapes and
 * text, embedded images. The original page content is untouched (pdf-lib wraps
 * it in q/Q first), so nothing is rasterised. Highlights go first, under the rest,
 * exactly as on screen.
 */
export async function drawOverlays(doc: PDFDocument, pages: PageInfo[], objects: OverlayObject[], assets: Map<string, Pick<Asset, 'bytes' | 'type'>>) {
  const { rgb, StandardFonts, BlendMode, LineCapStyle, LineJoinStyle, pushGraphicsState, popGraphicsState, concatTransformationMatrix, setLineJoin } = await loadPdfLibModule();

  const color = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  const standard = new Map<string, Promise<PDFFont>>();
  const fontFor = (o: TextObj, text: string): Promise<PDFFont> => {
    // anything Helvetica & co. can't encode goes to the bundled Unicode font
    if (!isWinAnsi(text)) return embedFontWithFallback(doc, text, { bold: o.bold });
    const name = {
      sans: o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
      serif: o.bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman,
      mono: o.bold ? StandardFonts.CourierBold : StandardFonts.Courier,
    }[o.font];
    let font = standard.get(name);
    if (!font) standard.set(name, (font = doc.embedFont(name)));
    return font;
  };

  const images = new Map<string, Promise<PDFImage>>();
  const imageFor = (id: string) => {
    let img = images.get(id);
    if (!img) {
      const a = assets.get(id);
      if (!a) throw new Error('An image on the page is missing. Remove it and add it again.');
      images.set(id, (img = a.type === 'png' ? doc.embedPng(a.bytes) : doc.embedJpg(a.bytes)));
    }
    return img;
  };

  const round = { borderLineCap: LineCapStyle.Round };

  async function draw(page: PDFPage, o: OverlayObject, H: number) {
    switch (o.kind) {
      case 'text': {
        const lines = textLines(o.text);
        const font = await fontFor(o, lines.join('\n'));
        lines.forEach((line, i) => {
          if (line) page.drawText(line, { x: o.x, y: H - o.y - baseline(i, o.size, o.font), size: o.size, font, color: color(o.color) });
        });
        return;
      }
      case 'image':
        page.drawImage(await imageFor(o.asset), { x: o.x, y: H - o.y - o.h, width: o.w, height: o.h, opacity: o.opacity < 1 ? o.opacity : undefined });
        return;
      case 'rect':
      case 'ellipse': {
        if (!o.fill && !o.stroke) return;
        const paint = {
          color: o.fill ? color(o.fill) : undefined,
          borderColor: o.stroke ? color(o.stroke) : undefined,
          borderWidth: o.stroke ? o.strokeWidth : 0,
          opacity: o.opacity,
          borderOpacity: o.opacity,
        };
        if (o.kind === 'rect') page.drawRectangle({ x: o.x, y: H - o.y - o.h, width: o.w, height: o.h, ...paint });
        else page.drawEllipse({ x: o.x + o.w / 2, y: H - o.y - o.h / 2, xScale: o.w / 2, yScale: o.h / 2, ...paint });
        return;
      }
      case 'highlight':
        page.drawRectangle({ x: o.x, y: H - o.y - o.h, width: o.w, height: o.h, color: color(o.color), opacity: HIGHLIGHT_OPACITY, blendMode: BlendMode.Multiply });
        return;
      // paths are built in top-left page space; drawSvgPath flips y around (0, H)
      case 'mark': {
        const { d, width } = markPath(o);
        page.drawSvgPath(d, { x: 0, y: H, borderColor: color(o.color), borderWidth: width, ...round });
        return;
      }
      case 'line': {
        const { line, head } = linePaths(o);
        page.drawSvgPath(line, { x: 0, y: H, borderColor: color(o.color), borderWidth: o.width, ...round });
        if (head) page.drawSvgPath(head, { x: 0, y: H, color: color(o.color) });
        return;
      }
      case 'ink':
        page.drawSvgPath(inkPath(o), { x: 0, y: H, borderColor: color(o.color), borderWidth: o.width, ...round });
        return;
    }
  }

  const byPage = new Map<number, OverlayObject[]>();
  for (const o of objects) {
    if (isBlank(o)) continue;
    byPage.set(o.page, [...(byPage.get(o.page) ?? []), o]);
  }
  for (const [index, list] of byPage) {
    const info = pages[index];
    const page = doc.getPage(index);
    const H = displaySize(info.view, info.rotate).h;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...displayMatrix(info.view, info.rotate)), setLineJoin(LineJoinStyle.Round));
    for (const o of [...list.filter((o) => o.kind === 'highlight'), ...list.filter((o) => o.kind !== 'highlight')]) await draw(page, o, H);
    page.pushOperators(popGraphicsState());
  }
}
