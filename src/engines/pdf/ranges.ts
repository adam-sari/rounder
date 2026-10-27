/*
 * Page-range text as people type it: "1-3, 5, 8-", "last", "10-1" (reversed),
 * "odd", "even", "all". Page numbers are 1-based in text, 0-based in results.
 */

export class PageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageRangeError';
  }
}

const plural = (n: number) => `${n} page${n === 1 ? '' : 's'}`;

function pageNumber(s: string, token: string, numPages: number): number {
  const n = s === 'last' || s === 'end' ? numPages : /^\d+$/.test(s) ? Number(s) : NaN;
  if (Number.isNaN(n)) throw new PageRangeError(`"${token}" isn't a page number or range. Try something like 1-3, 5.`);
  if (n < 1) throw new PageRangeError('Page numbers start at 1.');
  if (n > numPages) throw new PageRangeError(`Page ${n} doesn't exist. This PDF has ${plural(numPages)}.`);
  return n;
}

function span(from: number, to: number) {
  const step = from <= to ? 1 : -1;
  const out: number[] = [];
  for (let n = from; n !== to + step; n += step) out.push(n - 1);
  return out;
}

/** Each part (split on commas or spaces) becomes its own group, e.g. for "split into these ranges" */
export function parsePageRangeGroups(input: string, numPages: number): number[][] {
  const tokens = input
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (!tokens.length) throw new PageRangeError('Enter the pages you want, like 1-3, 5.');
  if (numPages < 1) throw new PageRangeError('This PDF has no pages.');

  return tokens.map((t) => {
    if (t === 'all') return span(1, numPages);
    if (t === 'odd' || t === 'even') {
      const out = span(1, numPages).filter((i) => i % 2 === (t === 'odd' ? 0 : 1));
      if (!out.length) throw new PageRangeError(`This PDF has no ${t} pages.`);
      return out;
    }
    const dash = t.indexOf('-');
    if (dash === -1) return [pageNumber(t, t, numPages) - 1];
    if (t.indexOf('-', dash + 1) !== -1) throw new PageRangeError(`"${t}" has more than one dash. Use ranges like 2-6.`);
    const [a, b] = [t.slice(0, dash), t.slice(dash + 1)];
    if (!a && !b) throw new PageRangeError(`"${t}" needs a page number on at least one side.`);
    return span(a ? pageNumber(a, t, numPages) : 1, b ? pageNumber(b, t, numPages) : numPages);
  });
}

/** "1-3, 5, 8-" → [0, 1, 2, 4, 7, 8, …]; keeps the typed order, and repeats unless `unique` */
export function parsePageRanges(input: string, numPages: number, { unique = false } = {}): number[] {
  const flat = parsePageRangeGroups(input, numPages).flat();
  return unique ? [...new Set(flat)] : flat;
}

/** [0, 1, 2, 4, 7, 8] → "1-3, 5, 8-9": the inverse, for showing a selection as text */
export function formatPageRanges(indices: Iterable<number>): string {
  const parts: string[] = [];
  let start = -1;
  let prev = -1;
  const flush = () => {
    if (start !== -1) parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
  };
  for (const i of indices) {
    if (start !== -1 && i === prev + 1) prev = i;
    else {
      flush();
      start = prev = i;
    }
  }
  flush();
  return parts.join(', ');
}
