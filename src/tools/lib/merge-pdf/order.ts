/* File order and naming for the merge tool (no pdf-lib, safe for the main thread) */

/** Regroups pages so each file's pages sit together in `order`, keeping their order within a file */
export function groupByFile<T extends { doc: { id: string } }>(pages: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return pages
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rank.get(a.p.doc.id) ?? Infinity) - (rank.get(b.p.doc.id) ?? Infinity) || a.i - b.i)
    .map(({ p }) => p);
}

/** What the user typed, made safe as a file name and ending in .pdf; `fallback` when empty */
export function outputFileName(input: string, fallback: string) {
  const stem = input
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\.pdf\s*$/i, '')
    .replace(/^[\s.]+|\s+$/g, '');
  return stem ? `${stem}.pdf` : fallback;
}

/** "Q3 report.pdf" → "Q3 report" */
export const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '') || name;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** natural order, so "page 2" comes before "page 10" */
export const compareNames = (a: string, b: string) => collator.compare(a, b);
