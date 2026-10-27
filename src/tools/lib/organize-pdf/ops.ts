/*
 * Page-list edits for the PDF organizer. Every function returns a new array and
 * leaves the input alone, so each result can go straight onto the undo stack.
 */

export interface PageItem {
  id: string;
  /** extra clockwise rotation: 0 | 90 | 180 | 270 */
  rotation: number;
}

const turn = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/** rotates the pages in `ids`, or every page when `ids` is empty */
export function rotatePages<T extends PageItem>(pages: T[], by: number, ids: ReadonlySet<string>): T[] {
  return pages.map((p) => (!ids.size || ids.has(p.id) ? { ...p, rotation: turn(p.rotation + by) } : p));
}

export function removePages<T extends PageItem>(pages: T[], ids: ReadonlySet<string>): T[] {
  return pages.filter((p) => !ids.has(p.id));
}

/** puts a copy right after each page in `ids`; `copy` gives it a fresh id */
export function duplicatePages<T extends PageItem>(pages: T[], ids: ReadonlySet<string>, copy: (p: T) => T): T[] {
  return pages.flatMap((p) => (ids.has(p.id) ? [p, copy(p)] : [p]));
}

/** inserts `items` after position `index` (-1 = at the start) */
export function insertAfter<T>(pages: T[], index: number, items: T[]): T[] {
  const at = Math.max(0, Math.min(pages.length, index + 1));
  return [...pages.slice(0, at), ...items, ...pages.slice(at)];
}

/** the position new pages go after: the last selected page, or the end */
export function insertionIndex(pages: PageItem[], ids: ReadonlySet<string>): number {
  for (let i = pages.length - 1; i >= 0; i--) if (ids.has(pages[i].id)) return i;
  return pages.length - 1;
}

export function reversePages<T>(pages: T[]): T[] {
  return [...pages].reverse();
}

/** 1, 3, 5, … then 2, 4, 6, … */
export function oddThenEven<T>(pages: T[]): T[] {
  return [...pages.filter((_, i) => i % 2 === 0), ...pages.filter((_, i) => i % 2 === 1)];
}

/**
 * Fixes a duplex scan made in two passes: the first half holds the fronts and
 * the second half the backs. Feeding the flipped stack back through a scanner
 * usually gives the backs in reverse order, hence `backsReversed`.
 */
export function interleaveHalves<T>(pages: T[], backsReversed: boolean): T[] {
  const half = Math.ceil(pages.length / 2);
  const fronts = pages.slice(0, half);
  const backs = pages.slice(half);
  if (backsReversed) backs.reverse();
  const out: T[] = [];
  for (let i = 0; i < half; i++) {
    out.push(fronts[i]);
    if (i < backs.length) out.push(backs[i]);
  }
  return out;
}

/**
 * Applies a reordering to just the pages in `ids` (when there are two or more),
 * putting them back into the positions they held; otherwise to every page.
 */
export function arrangeWithin<T extends PageItem>(pages: T[], ids: ReadonlySet<string>, arrange: (items: T[]) => T[]): T[] {
  const slots = pages.flatMap((p, i) => (ids.has(p.id) ? [i] : []));
  if (slots.length < 2) return arrange(pages);
  const arranged = arrange(slots.map((i) => pages[i]));
  const out = [...pages];
  slots.forEach((slot, k) => (out[slot] = arranged[k]));
  return out;
}

/** same pages, same order, same rotation */
export function samePages(a: readonly PageItem[], b: readonly PageItem[]) {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.rotation === b[i].rotation);
}
