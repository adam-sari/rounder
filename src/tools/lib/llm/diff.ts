import { diffWordsWithSpace } from 'diff';
import type { Span } from './text';

/** A text split into unchanged runs and edits (from → to) that can be accepted or rejected one by one */
export type Edit = { kind: 'edit'; id: number; from: string; to: string };
export type Segment = { kind: 'same'; text: string } | Edit;

/**
 * Word-level edits from `before` to `after`. Edits separated only by spaces on one line are merged
 * ("could of went" → "could have gone" is one edit, not two), so each reads as one suggestion.
 */
export function editSegments(before: string, after: string): Segment[] {
  const out: Segment[] = [];
  const last = () => out.at(-1);
  for (const c of diffWordsWithSpace(before, after)) {
    const prev = last();
    if (!c.added && !c.removed) {
      out.push({ kind: 'same', text: c.value });
      continue;
    }
    // edit · single-line spaces · edit → one edit
    const gap = out.at(-2);
    if (prev?.kind === 'same' && gap?.kind === 'edit' && /^[^\S\n]+$/.test(prev.text)) {
      out.pop();
      gap.from += prev.text;
      gap.to += prev.text;
    }
    const tail = last();
    const edit = tail?.kind === 'edit' ? tail : null;
    const target: Edit = edit ?? { kind: 'edit', id: 0, from: '', to: '' };
    if (c.removed) target.from += c.value;
    else target.to += c.value;
    if (!edit) out.push(target);
  }
  let id = 0;
  for (const s of out) if (s.kind === 'edit') s.id = id++;
  return out;
}

/** The text with every edit applied except the rejected ones */
export function applyEdits(segments: Segment[], rejected: ReadonlySet<number> = new Set()): string {
  return segments.map((s) => (s.kind === 'same' ? s.text : rejected.has(s.id) ? s.from : s.to)).join('');
}

/** Where the edits' new text sits in the edited text, for highlighting */
export function changedSpans(segments: Segment[]): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  for (const s of segments) {
    const text = s.kind === 'same' ? s.text : s.to;
    if (s.kind === 'edit' && text.trim()) spans.push({ start: pos, end: pos + text.length });
    pos += text.length;
  }
  return spans;
}

/** Cuts text[start, end) into runs marked changed or not, by the highlight spans */
export function highlightRuns(text: string, spans: Span[], start = 0, end = text.length): { text: string; changed: boolean }[] {
  const runs: { text: string; changed: boolean }[] = [];
  let pos = start;
  for (const s of spans) {
    if (s.end <= pos || s.start >= end) continue;
    const a = Math.max(s.start, pos);
    if (a > pos) runs.push({ text: text.slice(pos, a), changed: false });
    pos = Math.min(s.end, end);
    runs.push({ text: text.slice(a, pos), changed: true });
  }
  if (pos < end) runs.push({ text: text.slice(pos, end), changed: false });
  return runs;
}

/** Share of the original's words that the edits touched, 0–1 */
export function changedShare(segments: Segment[]): number {
  let total = 0;
  let changed = 0;
  for (const s of segments) {
    const n = (s.kind === 'same' ? s.text : s.from).match(/\S+/g)?.length ?? 0;
    total += n;
    if (s.kind === 'edit') changed += n;
  }
  return total ? Math.min(1, changed / total) : 0;
}
