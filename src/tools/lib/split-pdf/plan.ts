import { formatPageRanges } from '@/engines/pdf/ranges';

/*
 * How a PDF is cut up. A plan is a list of groups, each a list of 0-based page
 * indexes that become one output file.
 */

/** pages 0..numPages-1 in chunks of n */
export function everyN(numPages: number, n: number): number[][] {
  const size = Math.max(1, Math.floor(n) || 1);
  const out: number[][] = [];
  for (let s = 0; s < numPages; s += size) out.push(Array.from({ length: Math.min(size, numPages - s) }, (_, k) => s + k));
  return out;
}

/** the starting text for the ranges box: the PDF cut in half */
export function halves(numPages: number) {
  if (numPages < 2) return '1';
  const h = Math.ceil(numPages / 2);
  return h === 1 ? '1, 2' : `1-${h}, ${h + 1}-${numPages}`;
}

/** [0,1,2] → "1-3", [9,8,7] → "10-8", [0,2,4] → "1, 3, 5" */
export function groupLabel(indices: number[]): string {
  if (!indices.length) return '';
  if (indices.length === 1) return `${indices[0] + 1}`;
  const step = indices[1] - indices[0];
  if ((step === 1 || step === -1) && indices.every((p, k) => p === indices[0] + k * step)) return `${indices[0] + 1}-${indices.at(-1)! + 1}`;
  return formatPageRanges(indices);
}

/** "report" + [0,1,2] → "report-pages-1-3.pdf"; long scattered picks fall back to "report-part-2.pdf" */
export function outputName(base: string, indices: number[], index: number): string {
  if (indices.length === 1) return `${base}-page-${indices[0] + 1}.pdf`;
  const label = groupLabel(indices).replace(/, /g, '_');
  return label.length <= 32 ? `${base}-pages-${label}.pdf` : `${base}-part-${index + 1}.pdf`;
}

/** pages that no group includes */
export function leftOut(groups: number[][], numPages: number): number[] {
  const used = new Set(groups.flat());
  return Array.from({ length: numPages }, (_, i) => i).filter((i) => !used.has(i));
}

export interface Chunk<T> {
  /** first page, 0-based */
  start: number;
  /** one past the last page */
  end: number;
  out: T;
  /** true when this is a single page that's bigger than the limit on its own */
  over: boolean;
}

/**
 * Cuts pages 0..numPages-1 into runs whose built size stays at or under
 * `limit`, as few files as possible. `build(start, end)` makes the file for a
 * run and reports its size; each run is found by growing and then
 * bisecting from a guess (the last run's length), so a 300-page PDF needs a
 * handful of builds per file rather than one per page. Assumes adding pages
 * never makes a file smaller.
 */
export async function fitChunks<T extends { size: number }>(
  numPages: number,
  limit: number,
  build: (start: number, end: number) => Promise<T>,
  { guess = 1, onChunk }: { guess?: number; onChunk?: (chunk: Chunk<T>) => void } = {},
): Promise<Chunk<T>[]> {
  const chunks: Chunk<T>[] = [];
  let start = 0;
  while (start < numPages) {
    const left = numPages - start;
    let best: { count: number; out: T } | undefined;
    let fail = Infinity; // smallest page count known to be too big
    let count = Math.max(1, Math.min(left, Math.floor(guess)));
    for (;;) {
      const out = await build(start, start + count);
      if (out.size <= limit) {
        best = { count, out };
        if (count === left) break;
      } else {
        fail = count;
        // a single page over the limit goes out on its own
        if (count === 1) {
          best = { count, out };
          break;
        }
      }
      const floor = best?.count ?? 0;
      if (fail - floor <= 1) break;
      count = fail === Infinity ? Math.min(left, count * 2) : Math.max(1, Math.floor((floor + fail) / 2));
    }
    const chunk = { start, end: start + best!.count, out: best!.out, over: best!.out.size > limit };
    chunks.push(chunk);
    onChunk?.(chunk);
    guess = best!.count;
    start = chunk.end;
  }
  return chunks;
}
