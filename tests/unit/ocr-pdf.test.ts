import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, concatTransformationMatrix, decodePDFRawStream, degrees, type PDFPage } from 'pdf-lib';
import tool from '../../src/tools/defs/ocr-pdf';
import { addTextLayers, documentText, hasRealText, overlayPlacement, visibleBox } from '../../src/tools/lib/ocr/pdf';

describe('text layer placement', () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };

  it('maps the displayed page back onto unrotated content', () => {
    expect(overlayPlacement(0, box)).toEqual({ x: 10, y: 20, width: 600, height: 800, rotate: 0 });
    expect(overlayPlacement(90, box)).toEqual({ x: 610, y: 20, width: 800, height: 600, rotate: 90 });
    expect(overlayPlacement(180, box)).toEqual({ x: 610, y: 820, width: 600, height: 800, rotate: 180 });
    expect(overlayPlacement(270, box)).toEqual({ x: 10, y: 820, width: 800, height: 600, rotate: 270 });
    expect(overlayPlacement(-90, box)).toEqual(overlayPlacement(270, box));
  });

  it('uses the crop box clipped to the media box', () => {
    expect(visibleBox({ x: 0, y: 0, width: 700, height: 900 }, { x: 50, y: 60, width: 612, height: 792 })).toEqual({ x: 50, y: 60, width: 612, height: 792 });
    expect(visibleBox({ x: 0, y: 0, width: 500, height: 500 }, { x: 400, y: -10, width: 300, height: 300 })).toEqual({ x: 400, y: 0, width: 100, height: 290 });
    expect(visibleBox({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 10, height: 10 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('addTextLayers', () => {
  it('wraps the original content and stamps the layer page on top', async () => {
    const layerDoc = await PDFDocument.create();
    layerDoc.addPage([150, 200]).drawRectangle({ x: 0, y: 0, width: 1, height: 1 });
    const layer = await layerDoc.save();

    const src = await PDFDocument.create();
    const page = src.addPage([400, 300]);
    page.setRotation(degrees(90));
    // an unbalanced transform in the original content must not reach our layer
    page.pushOperators(concatTransformationMatrix(0.5, 0, 0, 0.5, 0, 0));
    src.addPage([100, 100]);
    const doc = await PDFDocument.load(await src.save());
    await addTextLayers(doc, new Map([[0, layer]]));
    const out = await PDFDocument.load(await doc.save());

    const [first, second] = out.getPages();
    const streams = (p: PDFPage) => {
      const contents = p.node.Contents();
      const refs = !contents ? [] : 'asArray' in contents ? contents.asArray() : [contents];
      return refs.map((r) => new TextDecoder().decode(decodePDFRawStream(out.context.lookup(r) as PDFRawStream).decode()));
    };
    const parts = streams(first);
    expect(parts[0].trim()).toBe('q');
    expect(parts.at(-2)!.trim()).toBe('Q');
    // the page shows as 300 × 400: translate to (x + width, y), turn 90°, scale the 150 × 200 layer up 2×
    expect(parts.at(-1)).toMatch(/^q\n1 0 0 1 400 0 cm\n[\d.e-]+ 1 -1 [\d.e-]+ 0 0 cm\n2 0 0 2 0 0 cm\n1 0 0 1 0 0 cm\n\/EmbeddedPdfPage-\d+ Do\nQ/);
    expect(first.node.Resources()!.lookup(PDFName.of('XObject'))).toBeTruthy();
    expect(streams(second).join('')).not.toContain('Do');
  });
});

describe('text output', () => {
  it('counts a page as searchable only with real text', () => {
    expect(hasRealText('  12 \n')).toBe(false);
    expect(hasRealText('This page has a real sentence on it.')).toBe(true);
  });

  it('labels each page', () => {
    expect(documentText(['One', null, ' Three\n'])).toBe('── Page 1 ──\n\nOne\n\n\n── Page 2 ──\n\n(no text found)\n\n\n── Page 3 ──\n\nThree');
  });

  it('fits search limits and credits the model', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.faq.some((f) => /Apache-2\.0/.test(f.a))).toBe(true);
    expect(tool.category).toBe('pdf');
  });
});
