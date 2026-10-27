import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { blankPdf, blankSize } from '@/tools/lib/organize-pdf/blank';
import { createHistory, HISTORY_LIMIT, record, redo, undo } from '@/tools/lib/organize-pdf/history';
import {
  arrangeWithin,
  duplicatePages,
  insertAfter,
  insertionIndex,
  interleaveHalves,
  oddThenEven,
  removePages,
  reversePages,
  rotatePages,
  samePages,
  type PageItem,
} from '@/tools/lib/organize-pdf/ops';

const make = (n: number): PageItem[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, rotation: 0 }));
const ids = (pages: PageItem[]) => pages.map((p) => p.id).join(' ');
const set = (...xs: string[]) => new Set(xs);

describe('rotatePages', () => {
  it('turns every page when nothing is selected, wrapping past 360', () => {
    const once = rotatePages(make(3), 270, set());
    expect(once.map((p) => p.rotation)).toEqual([270, 270, 270]);
    expect(rotatePages(once, 180, set()).map((p) => p.rotation)).toEqual([90, 90, 90]);
    expect(rotatePages(make(1), -90, set())[0].rotation).toBe(270);
  });
  it('turns only the selected pages and leaves the input alone', () => {
    const pages = make(3);
    const out = rotatePages(pages, 90, set('p2'));
    expect(out.map((p) => p.rotation)).toEqual([0, 90, 0]);
    expect(pages[1].rotation).toBe(0);
    expect(out[0]).toBe(pages[0]);
  });
});

describe('removePages / duplicatePages / insertAfter', () => {
  it('removes the selected pages', () => {
    expect(ids(removePages(make(4), set('p2', 'p4')))).toBe('p1 p3');
  });
  it('puts each copy right after its page', () => {
    let n = 0;
    const out = duplicatePages(make(3), set('p1', 'p3'), (p) => ({ ...p, id: `${p.id}#${++n}` }));
    expect(ids(out)).toBe('p1 p1#1 p2 p3 p3#2');
  });
  it('inserts after a position, -1 meaning the start', () => {
    const blank = { id: 'b', rotation: 0 };
    expect(ids(insertAfter(make(2), 0, [blank]))).toBe('p1 b p2');
    expect(ids(insertAfter(make(2), -1, [blank]))).toBe('b p1 p2');
    expect(ids(insertAfter(make(2), 1, [blank]))).toBe('p1 p2 b');
    expect(ids(insertAfter([], -1, [blank]))).toBe('b');
  });
  it('inserts after the last selected page, else at the end', () => {
    expect(insertionIndex(make(5), set('p2', 'p4'))).toBe(3);
    expect(insertionIndex(make(5), set())).toBe(4);
    expect(insertionIndex([], set())).toBe(-1);
  });
});

describe('arranging', () => {
  it('reverses', () => {
    expect(ids(reversePages(make(4)))).toBe('p4 p3 p2 p1');
  });
  it('puts odd pages first, then even', () => {
    expect(ids(oddThenEven(make(5)))).toBe('p1 p3 p5 p2 p4');
  });
  it('fixes a duplex scan with the backs reversed', () => {
    // fronts 1,3,5 scanned first, then backs 6,4,2 from the flipped stack
    const scan = ['f1', 'f3', 'f5', 'b6', 'b4', 'b2'].map((id) => ({ id, rotation: 0 }));
    expect(ids(interleaveHalves(scan, true))).toBe('f1 b2 f3 b4 f5 b6');
  });
  it('interleaves halves in order, with an odd page count', () => {
    expect(ids(interleaveHalves(make(5), false))).toBe('p1 p4 p2 p5 p3');
    expect(ids(interleaveHalves(make(5), true))).toBe('p1 p5 p2 p4 p3');
    expect(interleaveHalves(make(0), true)).toEqual([]);
  });
  it('arranges only the selected pages, in the slots they held', () => {
    expect(ids(arrangeWithin(make(5), set('p2', 'p3', 'p5'), reversePages))).toBe('p1 p5 p3 p4 p2');
  });
  it('arranges everything when fewer than two pages are selected', () => {
    expect(ids(arrangeWithin(make(3), set('p2'), reversePages))).toBe('p3 p2 p1');
  });
});

describe('samePages', () => {
  it('compares ids, order and rotation', () => {
    const a = make(3);
    expect(samePages(a, a.map((p) => ({ ...p })))).toBe(true);
    expect(samePages(a, reversePages(a))).toBe(false);
    expect(samePages(a, rotatePages(a, 90, set('p1')))).toBe(false);
    expect(samePages(a, a.slice(0, 2))).toBe(false);
  });
});

describe('history', () => {
  const opts = { equal: samePages };

  it('undoes and redoes steps', () => {
    let h = createHistory(make(3));
    h = record(h, reversePages(h.present), opts);
    h = record(h, removePages(h.present, set('p1')), opts);
    expect(ids(h.present)).toBe('p3 p2');
    h = undo(h);
    expect(ids(h.present)).toBe('p3 p2 p1');
    h = undo(h);
    expect(ids(h.present)).toBe('p1 p2 p3');
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(ids(h.present)).toBe('p3 p2 p1');
  });
  it('ignores no-op changes and clears redo on a new step', () => {
    let h = createHistory(make(2));
    expect(record(h, make(2), opts)).toBe(h);
    h = undo(record(h, reversePages(h.present), opts));
    expect(h.future).toHaveLength(1);
    h = record(h, rotatePages(h.present, 90, set()), opts);
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });
  it('merges a drag into one step, and drops it when it ends where it began', () => {
    const start = make(3);
    let h = createHistory(start);
    h = record(h, [start[1], start[0], start[2]], opts);
    h = record(h, [start[1], start[2], start[0]], { ...opts, merge: true });
    expect(h.past).toHaveLength(1);
    expect(ids(undo(h).present)).toBe('p1 p2 p3');
    h = record(h, start, { ...opts, merge: true });
    expect(h.past).toHaveLength(0);
    expect(ids(h.present)).toBe('p1 p2 p3');
  });
  it('keeps at most HISTORY_LIMIT steps', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});

describe('blank pages', () => {
  it('match the neighbour as displayed, swapping sides for quarter turns', () => {
    expect(blankSize({ width: 612, height: 792 }, 0)).toEqual({ width: 612, height: 792 });
    expect(blankSize({ width: 612, height: 792 }, 270)).toEqual({ width: 792, height: 612 });
    expect(blankSize({ width: 595.2756, height: 841.8898 }, 180)).toEqual({ width: 595.28, height: 841.89 });
  });
  it('are a valid one-page PDF of that size', async () => {
    const doc = await PDFDocument.load(await blankPdf(792, 612));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  });
});
