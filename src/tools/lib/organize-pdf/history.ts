/** A plain undo/redo stack of immutable snapshots */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/**
 * Adds `next` as a new step. With `merge`, it replaces the current step instead,
 * so a drag that moves a page through many spots undoes in one go; a merge that
 * lands back on the step before drops that step, leaving nothing to undo.
 */
export function record<T>(h: History<T>, next: T, { merge = false, equal = Object.is as (a: T, b: T) => boolean } = {}): History<T> {
  if (equal(next, h.present)) return h;
  if (merge && h.past.length) {
    const before = h.past[h.past.length - 1];
    if (equal(next, before)) return { past: h.past.slice(0, -1), present: before, future: [] };
    return { past: h.past, present: next, future: [] };
  }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
