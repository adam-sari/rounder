/// <reference lib="webworker" />
import { countChanged, highlightDiff, type Raster } from './pixels';
import { compareTexts, type TextOptions } from './text';

export type CompareRequest =
  | { kind: 'text'; a: string[]; b: string[]; options: TextOptions }
  | { kind: 'count'; a: Raster; b: Raster }
  | { kind: 'highlight'; a: Raster; b: Raster };

self.onmessage = (e: MessageEvent<{ id: number; req: CompareRequest }>) => {
  const { id, req } = e.data;
  try {
    if (req.kind === 'text') self.postMessage({ id, result: compareTexts(req.a, req.b, req.options) });
    else if (req.kind === 'count') self.postMessage({ id, result: countChanged(req.a, req.b) });
    else {
      const result = highlightDiff(req.a, req.b);
      self.postMessage({ id, result }, [result.data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: (err as Error)?.message || 'Comparing failed.' });
  }
};
