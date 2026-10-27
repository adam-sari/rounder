import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import { loadPdfjs } from '@/engines/pdf/pdfjs';
import { drawOverlays, isBlank } from '@/tools/lib/pdf-overlay/draw';
import {
  baseline,
  clampBox,
  displayMatrix,
  displaySize,
  fitInside,
  inkPath,
  linePaths,
  markPath,
  normalizeInk,
  resizeBox,
  simplify,
  smoothPath,
  snapAngle,
  snapBox,
  snapTargets,
  textLines,
  toUserSpace,
} from '@/tools/lib/pdf-overlay/geometry';
import { boundsOf, formatDate, type OverlayObject, type PageInfo } from '@/tools/lib/pdf-overlay/model';
import { MAX_SAVED, parseSaved, withSaved, type SavedSig } from '@/tools/lib/pdf-overlay/saved';
import { alphaBounds, initialsOf, removeLight, strokeWidths } from '@/tools/lib/pdf-overlay/signature';

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
});

describe('page space → user space', () => {
  const view = [20, 30, 620, 830]; // 600 × 800, offset like a shifted crop box

  it('maps the displayed top-left corner for every rotation', () => {
    expect(toUserSpace(view, 0, 0, 0)).toEqual([20, 830]);
    expect(toUserSpace(view, 90, 0, 0)).toEqual([20, 30]);
    expect(toUserSpace(view, 180, 0, 0)).toEqual([620, 30]);
    expect(toUserSpace(view, 270, 0, 0)).toEqual([620, 830]);
  });

  it('maps the displayed bottom-right corner for every rotation', () => {
    expect(toUserSpace(view, 0, 600, 800)).toEqual([620, 30]);
    expect(toUserSpace(view, 90, 800, 600)).toEqual([620, 830]);
    expect(toUserSpace(view, 180, 600, 800)).toEqual([20, 830]);
    expect(toUserSpace(view, 270, 800, 600)).toEqual([20, 30]);
  });

  it('swaps width and height for quarter turns', () => {
    expect(displaySize(view, 0)).toEqual({ w: 600, h: 800 });
    expect(displaySize(view, 90)).toEqual({ w: 800, h: 600 });
    expect(displaySize(view, -90)).toEqual({ w: 800, h: 600 });
    expect(displayMatrix(view, 450)).toEqual(displayMatrix(view, 90));
  });
});

describe('boxes', () => {
  const box = { x: 10, y: 10, w: 100, h: 50 };

  it('resizes from any handle, anchored on the opposite side', () => {
    expect(resizeBox(box, 'se', 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 60 });
    expect(resizeBox(box, 'nw', 20, 10)).toEqual({ x: 30, y: 20, w: 80, h: 40 });
    expect(resizeBox(box, 'e', 20, 99)).toEqual({ x: 10, y: 10, w: 120, h: 50 });
    expect(resizeBox(box, 'n', 99, -10)).toEqual({ x: 10, y: 0, w: 100, h: 60 });
  });

  it('keeps the aspect ratio from corners and never goes below the minimum', () => {
    const r = resizeBox(box, 'se', 100, 0, { keepAspect: true });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBe(200);
    const tiny = resizeBox(box, 'se', -500, -500, { keepAspect: true, min: 10 });
    expect(tiny.h).toBeCloseTo(10);
    expect(tiny.w).toBeCloseTo(20);
    expect(resizeBox(box, 'w', 500, 0, { min: 4 })).toMatchObject({ w: 4, x: 106 });
  });

  it('keeps boxes on the page', () => {
    expect(clampBox({ x: -5, y: 790, w: 20, h: 20 }, 600, 800)).toMatchObject({ x: 0, y: 780 });
    expect(clampBox({ x: 10, y: 0, w: 700, h: 20 }, 600, 800)).toMatchObject({ x: 0 });
    expect(fitInside(400, 100, 200, 200)).toEqual({ w: 200, h: 50 });
    expect(fitInside(10, 10, 200, 200)).toEqual({ w: 10, h: 10 });
  });

  it('snaps edges and centres to the closest guide', () => {
    const { xs, ys } = snapTargets(600, 800, [{ x: 100, y: 100, w: 50, h: 50 }]);
    const s = snapBox({ x: 248, y: 152, w: 100, h: 20 }, xs, ys, 4);
    expect(s).toMatchObject({ x: 250, gx: 300 }); // centre 298 → page centre 300
    expect(s).toMatchObject({ y: 150, gy: 150 }); // top 152 → other box's bottom
    expect(snapBox({ x: 40, y: 40, w: 10, h: 10 }, xs, ys, 4)).toMatchObject({ x: 40, y: 40, gx: null, gy: null });
  });

  it('snaps line angles to 45°', () => {
    const [x, y] = snapAngle(0, 0, 100, 8);
    expect(x).toBeCloseTo(Math.hypot(100, 8));
    expect(y).toBeCloseTo(0);
    const [dx, dy] = snapAngle(0, 0, 50, 45);
    expect(dx).toBeCloseTo(dy);
  });

  it('gives lines a box', () => {
    expect(boundsOf({ kind: 'line', id: 'a', page: 0, x1: 50, y1: 10, x2: 20, y2: 40, color: '#000000', width: 2, arrow: false })).toEqual({ x: 20, y: 10, w: 30, h: 30 });
  });
});

describe('paths', () => {
  it('simplifies and smooths strokes', () => {
    expect(simplify([0, 0, 0.1, 0, 5, 0, 5.1, 0, 10, 0], 1)).toEqual([0, 0, 5, 0, 10, 0]);
    expect(smoothPath([1, 1])).toBe('M1 1L1.01 1');
    expect(smoothPath([0, 0, 10, 0, 20, 10])).toBe('M0 0Q10 0 15 5L20 10');
  });

  it('normalizes ink into a padded box and back', () => {
    const { box, points } = normalizeInk([10, 10, 30, 10], 4);
    expect(box).toEqual({ x: 8, y: 8, w: 24, h: 4 });
    expect(points).toEqual([2 / 24, 0.5, 22 / 24, 0.5]);
    expect(inkPath({ ...box, points })).toBe('M10 10L30 10');
  });

  it('draws arrowheads only on arrows long enough to carry one', () => {
    expect(linePaths({ x1: 0, y1: 0, x2: 100, y2: 0, width: 2, arrow: false }).head).toBeNull();
    const a = linePaths({ x1: 0, y1: 0, x2: 100, y2: 0, width: 2, arrow: true });
    expect(a.head).toBe('M100 0L93 3.15L93 -3.15Z');
    expect(a.line).toBe('M0 0L95.8 0');
    expect(linePaths({ x1: 0, y1: 0, x2: 3, y2: 0, width: 2, arrow: true }).head).toBeNull();
    expect(markPath({ x: 0, y: 0, w: 100, h: 100, mark: 'cross' }).d).toBe('M20 20L80 80M80 20L20 80');
  });
});

describe('text', () => {
  it('splits lines and replaces tabs', () => {
    expect(textLines('a\tb\r\nc\rd')).toEqual(['a    b', 'c', 'd']);
  });
  it('places baselines one line height apart', () => {
    expect(baseline(1, 10, 'sans') - baseline(0, 10, 'sans')).toBeCloseTo(12);
    expect(baseline(0, 10, 'sans')).toBeGreaterThan(7);
    expect(baseline(0, 10, 'sans')).toBeLessThan(10);
  });
  it('formats dates', () => {
    const d = new Date(2026, 0, 5);
    expect(formatDate(d, 'mdy')).toBe('01/05/2026');
    expect(formatDate(d, 'dmy')).toBe('05/01/2026');
    expect(formatDate(d, 'dot')).toBe('05.01.2026');
    expect(formatDate(d, 'iso')).toBe('2026-01-05');
    expect(formatDate(d, 'long')).toBe('January 5, 2026');
  });
});

describe('signature helpers', () => {
  it('thins fast strokes and follows stylus pressure', () => {
    const slow = strokeWidths([{ x: 0, y: 0, t: 0, p: -1 }, { x: 1, y: 0, t: 16, p: -1 }, { x: 2, y: 0, t: 32, p: -1 }], 3);
    const fast = strokeWidths([{ x: 0, y: 0, t: 0, p: -1 }, { x: 40, y: 0, t: 16, p: -1 }, { x: 80, y: 0, t: 32, p: -1 }], 3);
    expect(fast[2]).toBeLessThan(slow[2]);
    const hard = strokeWidths([{ x: 0, y: 0, t: 0, p: 1 }], 3)[0];
    const soft = strokeWidths([{ x: 0, y: 0, t: 0, p: 0.1 }], 3)[0];
    expect(hard).toBeGreaterThan(soft);
  });

  it('removes white paper and keeps dark ink', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 40, 255, 200, 200, 200, 255]);
    removeLight(px, 230);
    expect(px[3]).toBe(0);
    expect([...px.slice(4, 8)]).toEqual([20, 20, 40, 255]);
    expect(px[11]).toBeGreaterThan(0);
    expect(px[11]).toBeLessThan(255);
    expect(px[8]).toBeLessThan(200); // white taken out of the edge colour
  });

  it('finds the opaque bounds', () => {
    const w = 4;
    const h = 3;
    const px = new Uint8ClampedArray(w * h * 4);
    expect(alphaBounds(px, w, h)).toBeNull();
    px[(1 * w + 1) * 4 + 3] = 255;
    px[(2 * w + 2) * 4 + 3] = 255;
    expect(alphaBounds(px, w, h)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });

  it('makes initials', () => {
    expect(initialsOf('Jane Q. Doe')).toBe('JD');
    expect(initialsOf('  élodie ')).toBe('É');
    expect(initialsOf('')).toBe('');
  });

  it('remembers a few signatures per role and ignores junk', () => {
    const sig = (id: string, role: SavedSig['role'] = 'signature'): SavedSig => ({ id, role, data: 'data:image/png;base64,AAAA' });
    let list: SavedSig[] = [sig('i1', 'initials')];
    for (let i = 0; i < 6; i++) list = withSaved(list, sig(`s${i}`));
    expect(list.filter((s) => s.role === 'signature').map((s) => s.id)).toEqual(['s5', 's4', 's3', 's2'].slice(0, MAX_SAVED));
    expect(list.some((s) => s.id === 'i1')).toBe(true);
    expect(parseSaved(JSON.stringify([...list, { id: 1 }, { id: 'x', role: 'signature', data: 'javascript:1' }]))).toHaveLength(list.length);
    expect(parseSaved('{oops')).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
  });
});

/* ---------------- drawing into a real PDF ---------------- */

async function makePdf() {
  const doc = await PDFDocument.create();
  const a = doc.addPage([600, 800]);
  a.setCropBox(50, 100, 450, 500); // x, y, width, height: the visible box is offset from the media box
  doc.addPage([595, 842]).setRotation(degrees(90));
  const c = doc.addPage([600, 800]);
  c.setMediaBox(20, 30, 600, 800);
  c.setRotation(degrees(270));
  doc.addPage([400, 300]).setRotation(degrees(180));
  return new Uint8Array(await doc.save());
}

/** where pdf.js finds each text run's baseline origin, in displayed page space */
async function textOrigins(bytes: Uint8Array) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
  const out: { str: string; x: number; y: number; w: number; h: number }[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    out.push(
      items.flatMap((it) => {
        if (!('str' in it)) return [];
        const m = lib.Util.transform(vp.transform, it.transform);
        return [{ str: it.str, x: m[4], y: m[5], w: vp.width, h: vp.height }];
      }),
    );
  }
  await pdf.loadingTask.destroy();
  return out;
}

async function pageInfos(bytes: Uint8Array): Promise<PageInfo[]> {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
  const infos: PageInfo[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    infos.push({ w: vp.width, h: vp.height, view: [...page.view], rotate: page.rotate });
  }
  await pdf.loadingTask.destroy();
  return infos;
}

// 1×1 red PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('drawOverlays', () => {
  it('puts text exactly where it was placed on every rotation and crop box', async () => {
    const bytes = await makePdf();
    const pages = await pageInfos(bytes);
    expect(pages.map((p) => [p.w, p.h, p.rotate])).toEqual([[450, 500, 0], [842, 595, 90], [800, 600, 270], [400, 300, 180]]);

    const objects: OverlayObject[] = pages.map((_, page) => ({ kind: 'text', id: `t${page}`, page, x: 40, y: 60, w: 0, h: 0, text: `Hello ${page}`, size: 20, font: 'sans', bold: false, color: '#112233' }));
    const doc = await PDFDocument.load(bytes);
    await drawOverlays(doc, pages, objects, new Map());
    const found = await textOrigins(new Uint8Array(await doc.save()));

    for (const [page, items] of found.entries()) {
      const item = items.find((t) => t.str === `Hello ${page}`)!;
      expect(item, `page ${page + 1}`).toBeTruthy();
      expect(item.x, `page ${page + 1} x`).toBeCloseTo(40, 3);
      expect(item.y, `page ${page + 1} y`).toBeCloseTo(60 + baseline(0, 20, 'sans'), 3);
    }
  });

  it('draws every kind of object and the result still opens', async () => {
    const bytes = await makePdf();
    const pages = await pageInfos(bytes);
    const base = { page: 1 };
    const objects: OverlayObject[] = [
      { ...base, id: '1', kind: 'text', x: 10, y: 10, w: 0, h: 0, text: 'Two\nlines', size: 12, font: 'serif', bold: true, color: '#000000' },
      { ...base, id: '2', kind: 'text', x: 10, y: 10, w: 0, h: 0, text: '   ', size: 12, font: 'mono', bold: false, color: '#000000' },
      { ...base, id: '3', kind: 'image', x: 50, y: 50, w: 40, h: 20, asset: 'png', opacity: 0.5 },
      { ...base, id: '4', kind: 'rect', x: 100, y: 100, w: 50, h: 20, fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1 },
      { ...base, id: '5', kind: 'ellipse', x: 100, y: 200, w: 50, h: 20, fill: null, stroke: '#d62828', strokeWidth: 2, opacity: 0.8 },
      { ...base, id: '6', kind: 'highlight', x: 100, y: 300, w: 80, h: 14, color: '#ffe066' },
      { ...base, id: '7', kind: 'mark', x: 10, y: 300, w: 16, h: 16, mark: 'check', color: '#1f8a3b' },
      { ...base, id: '8', kind: 'line', x1: 10, y1: 400, x2: 200, y2: 420, color: '#d62828', width: 2, arrow: true },
      { ...base, id: '9', kind: 'ink', x: 300, y: 300, w: 50, h: 50, points: [0, 0, 0.5, 1, 1, 0], color: '#1d3f9e', width: 2 },
    ];
    expect(isBlank(objects[1])).toBe(true);
    const doc = await PDFDocument.load(bytes);
    await drawOverlays(doc, pages, objects, new Map([['png', { bytes: PNG, type: 'png' as const }]]));
    const out = await PDFDocument.load(await doc.save());
    expect(out.getPageCount()).toBe(4);
    const found = await textOrigins(await out.save());
    expect(found[1].map((t) => t.str)).toEqual(expect.arrayContaining(['Two', 'lines']));
  });

  it('reports a missing image clearly', async () => {
    const bytes = await makePdf();
    const doc = await PDFDocument.load(bytes);
    await expect(drawOverlays(doc, await pageInfos(bytes), [{ id: 'x', page: 0, kind: 'image', x: 0, y: 0, w: 1, h: 1, asset: 'gone', opacity: 1 }], new Map())).rejects.toThrow(/missing/);
  });
});
