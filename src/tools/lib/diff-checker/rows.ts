import type { Block } from './diff';

export type View = 'split' | 'unified';

/** One rendered line pair. a / b are line indices, or -1 when that side has no line here. */
export interface LineRow {
  a: number;
  b: number;
  equal: boolean;
  /** index of the change this row starts, or -1 */
  change: number;
}

/** A collapsed run of unchanged lines inside block `block` */
export interface FoldRow {
  block: number;
  count: number;
}

export type Row = LineRow | FoldRow;

export const isFold = (row: Row): row is FoldRow => 'block' in row;

/** Unchanged lines kept around each change when folding */
export const CONTEXT = 3;

export function buildRows(blocks: Block[], view: View, collapse: boolean, expanded: ReadonlySet<number>): Row[] {
  const rows: Row[] = [];
  const equalRows = (block: Block, from: number, to: number) => {
    for (let k = from; k < to; k++) rows.push({ a: block.a + k, b: block.b + k, equal: true, change: -1 });
  };
  let change = 0;
  blocks.forEach((block, i) => {
    if (block.equal) {
      const head = i > 0 ? CONTEXT : 0;
      const tail = i < blocks.length - 1 ? CONTEXT : 0;
      const hidden = block.na - head - tail;
      // folding away just a few lines saves nothing and costs a click
      if (collapse && !expanded.has(i) && hidden >= 4) {
        equalRows(block, 0, head);
        rows.push({ block: i, count: hidden });
        equalRows(block, block.na - tail, block.na);
      } else {
        equalRows(block, 0, block.na);
      }
      return;
    }
    const first = rows.length;
    if (view === 'split') {
      for (let k = 0; k < Math.max(block.na, block.nb); k++) {
        rows.push({ a: k < block.na ? block.a + k : -1, b: k < block.nb ? block.b + k : -1, equal: false, change: -1 });
      }
    } else {
      for (let k = 0; k < block.na; k++) rows.push({ a: block.a + k, b: -1, equal: false, change: -1 });
      for (let k = 0; k < block.nb; k++) rows.push({ a: -1, b: block.b + k, equal: false, change: -1 });
    }
    (rows[first] as LineRow).change = change++;
  });
  return rows;
}

/** Splits a line into plain and highlighted pieces from [start, end) pairs */
export function pieces(text: string, marks: number[] | undefined): { text: string; mark: boolean }[] {
  if (!marks?.length) return [{ text, mark: false }];
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (let i = 0; i < marks.length; i += 2) {
    if (marks[i] > at) out.push({ text: text.slice(at, marks[i]), mark: false });
    out.push({ text: text.slice(marks[i], marks[i + 1]), mark: true });
    at = marks[i + 1];
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}
