import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { loadPdfjs, openPdf } from '@/engines/pdf';
import {
  anchorCenter,
  applyMatrix,
  formatPageLabel,
  hexToRgb,
  labelOrigin,
  markMatrix,
  markPlacements,
  numberingPlan,
  pageFrame,
  resolveAngle,
  rotatedSize,
  tileCenters,
  visibleBox,
} from '@/tools/lib/pdf-stamp/geometry';
import { addPageNumbers, frameOf, stampFont, textBox } from '@/tools/lib/pdf-stamp/stamp';

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  // the Unicode font is fetched from /fonts/pdf/ in the browser; serve it from public/ here
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public${new URL(url, 'http://x').pathname}`)));
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs').href;
});

describe('page frame', () => {
  it('clips the CropBox to the MediaBox', () => {
    expect(visibleBox([0, 0, 612, 792])).toEqual([0, 0, 612, 792]);
    expect(visibleBox([0, 0, 612, 792], [50, 60, 400, 900])).toEqual([50, 60, 400, 792]);
    // an empty intersection falls back to the MediaBox
    expect(visibleBox([0, 0, 100, 100], [200, 200, 300, 300])).toEqual([0, 0, 100, 100]);
  });

  it('maps the visual corners onto the right user-space corners for every /Rotate', () => {
    const box = [10, 20, 110, 220] as [number, number, number, number]; // 100 × 200
    const corners = (rot: number) => {
      const f = pageFrame(box, rot);
      // visual bottom-left and top-right
      return [f.width, f.height, applyMatrix(f.matrix, { x: 0, y: 0 }), applyMatrix(f.matrix, { x: f.width, y: f.height })];
    };
    expect(corners(0)).toEqual([100, 200, { x: 10, y: 20 }, { x: 110, y: 220 }]);
    // 90° clockwise: the user-space bottom-right corner is shown at the bottom-left
    expect(corners(90)).toEqual([200, 100, { x: 110, y: 20 }, { x: 10, y: 220 }]);
    expect(corners(180)).toEqual([100, 200, { x: 110, y: 220 }, { x: 10, y: 20 }]);
    expect(corners(270)).toEqual([200, 100, { x: 10, y: 220 }, { x: 110, y: 20 }]);
    expect(corners(-90)).toEqual(corners(270));
  });
});

describe('placement', () => {
  it('pins boxes to anchors with a margin', () => {
    expect(anchorCenter(600, 800, 100, 20, 'br', 30)).toEqual({ x: 520, y: 40 });
    expect(anchorCenter(600, 800, 100, 20, 'tl', 30)).toEqual({ x: 80, y: 760 });
    expect(anchorCenter(600, 800, 100, 20, 'mc', 30)).toEqual({ x: 300, y: 400 });
  });

  it('puts the label baseline above the margin by its descent', () => {
    expect(labelOrigin(600, 800, { width: 40, height: 10, descent: 2 }, 'bc', 36)).toEqual({ x: 280, y: 38 });
  });

  it('sizes rotated boxes', () => {
    const r = rotatedSize(100, 20, 90);
    expect(r.width).toBeCloseTo(20);
    expect(r.height).toBeCloseTo(100);
  });

  it('centres a rotated mark on its point', () => {
    const m = markMatrix({ x: 300, y: 400 }, 100, 20, 45);
    const mid = applyMatrix(m, { x: 50, y: 10 });
    expect(mid.x).toBeCloseTo(300);
    expect(mid.y).toBeCloseTo(400);
    // the unit (image) version scales a 1×1 box to the same place
    const u = applyMatrix(markMatrix({ x: 300, y: 400 }, 100, 20, 45, true), { x: 0.5, y: 0.5 });
    expect(u.x).toBeCloseTo(300);
    expect(u.y).toBeCloseTo(400);
  });

  it('tiles the whole page and stays bounded', () => {
    const c = tileCenters(600, 800, 100, 50, 20);
    expect(c.length).toBeGreaterThan(30);
    expect(c.every((p) => p.x + 50 > 0 && p.x - 50 < 600 && p.y + 25 > 0 && p.y - 25 < 800)).toBe(true);
    expect(tileCenters(600, 800, 1, 1, 0, 100)).toHaveLength(100);
    expect(markPlacements(600, 800, 100, 50, { angle: 0, placement: 'mc', margin: 0 })).toHaveLength(1);
  });

  it('runs diagonals corner to corner', () => {
    expect(resolveAngle('diagonal', 0, 100, 100)).toBeCloseTo(45);
    expect(resolveAngle('diagonal', 0, 842, 595)).toBeLessThan(45);
    expect(resolveAngle('level', 30, 1, 1)).toBe(0);
    expect(resolveAngle('custom', -30, 1, 1)).toBe(-30);
  });

  it('parses colors', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#0f0')).toEqual([0, 1, 0]);
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
  });
});

describe('numbering', () => {
  it('fills templates', () => {
    expect(formatPageLabel('Page {n} of {total}', 3, 12)).toBe('Page 3 of 12');
    expect(formatPageLabel('{n}/{total}', 1, 9)).toBe('1/9');
    expect(formatPageLabel('– { N } –', 7, 9)).toBe('– 7 –');
    expect(formatPageLabel('Plain', 1, 2)).toBe('Plain');
  });

  it('counts numbered pages in document order from the start number', () => {
    expect(numberingPlan([0, 1, 2, 3])).toEqual({ pages: [0, 1, 2, 3].map((i) => ({ pageIndex: i, n: i + 1 })), total: 4 });
    const skip = numberingPlan([3, 2, 1, 0, 2], { skipFirst: true, start: 5 });
    expect(skip.pages).toEqual([
      { pageIndex: 1, n: 5 },
      { pageIndex: 2, n: 6 },
      { pageIndex: 3, n: 7 },
    ]);
    expect(skip.total).toBe(7);
  });
});

/* ---------------- end to end: stamp with pdf-lib, read back with pdf.js ---------------- */

/** Letter; A4 /Rotate 90; cropped; cropped + /Rotate 270; /Rotate 180 */
async function awkwardPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const add = (size: [number, number], rotate = 0, crop?: [number, number, number, number]) => {
    const page = doc.addPage(size);
    page.drawText('body', { x: 100, y: 100, size: 12, font });
    if (rotate) page.setRotation(degrees(rotate));
    if (crop) page.setCropBox(...crop);
  };
  add([612, 792]);
  add([595, 842], 90);
  add([612, 792], 0, [50, 60, 350, 440]);
  add([612, 792], 270, [40, 30, 500, 600]);
  add([612, 792], 180);
  return PDFDocument.load(await doc.save());
}

/** Reads every text item back as (string, top-left viewport point of its origin, run direction) */
async function readBack(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const out = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const texts = items.flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return [];
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const [x2, y2] = viewport.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
      return [{ str: it.str, x, y, dx: x2 - x, dy: y2 - y }];
    });
    out.push({ width: viewport.width, height: viewport.height, texts });
  }
  await doc.destroy();
  return out;
}

describe('addPageNumbers', () => {
  it('lands bottom-right on every page as seen, whatever the rotation or crop', async () => {
    const doc = await awkwardPdf();
    const opts = { pages: [0, 1, 2, 3, 4], skipFirst: false, start: 1, template: 'Page {n} of {total}', anchor: 'br' as const, margin: 24, family: 'sans' as const, bold: false, size: 10, color: '#333333' };
    await addPageNumbers(doc, opts);
    const font = await stampFont(doc, 'sans', false, 'x');
    const frames = doc.getPages().map(frameOf);
    const pages = await readBack(await doc.save());

    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of 5`;
      const item = p.texts.find((t) => t.str === label)!;
      expect(item, label).toBeTruthy();
      expect(p.width).toBeCloseTo(frames[i].width, 3);
      const box = textBox(font, label, 10);
      const o = labelOrigin(frames[i].width, frames[i].height, box, 'br', 24);
      // pdf.js's own rotation math puts the baseline where our visual layout says
      expect(item.x).toBeCloseTo(o.x, 3);
      expect(item.y).toBeCloseTo(p.height - o.y, 3);
      // and the text reads left to right, upright
      expect(item.dx).toBeGreaterThan(0);
      expect(Math.abs(item.dy)).toBeLessThan(1e-6);
      // right edge sits at the margin
      expect(item.x + box.width).toBeCloseTo(p.width - 24, 3);
    });
  });

  it('skips the cover, starts where asked, and draws Unicode templates with Noto Sans', async () => {
    const doc = await awkwardPdf();
    await addPageNumbers(doc, { pages: [0, 1, 2], skipFirst: true, start: 10, template: 'Σελίδα {n}', anchor: 'tc', margin: 20, family: 'serif', bold: true, size: 12, color: '#000' });
    const pages = await readBack(await doc.save());
    const labels = pages.map((p) => p.texts.filter((t) => t.str.includes('Σελίδα')).map((t) => t.str));
    expect(labels).toEqual([[], ['Σελίδα 10'], ['Σελίδα 11'], [], []]);
  });
});
