/// <reference lib="webworker" />
import { computeDiff, unifiedPatch, type DiffOptions } from './diff';

export type DiffRequest =
  | { kind: 'diff'; a: string; b: string; options: DiffOptions }
  | { kind: 'patch'; a: string; b: string; nameA: string; nameB: string };

self.onmessage = (e: MessageEvent<DiffRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'diff') {
      self.postMessage({ result: computeDiff(req.a, req.b, req.options) });
    } else {
      const patch = unifiedPatch(req.a, req.b, req.nameA, req.nameB);
      if (patch === undefined) throw new Error('These texts are too different to build a patch quickly.');
      self.postMessage({ result: patch });
    }
  } catch (err) {
    self.postMessage({ error: (err as Error)?.message || 'Comparing failed.' });
  }
};
