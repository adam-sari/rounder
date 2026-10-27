/// <reference lib="webworker" />
import { traceImage, type Pixels } from './trace';
import type { TraceSettings } from './settings';

export interface TraceRequest {
  image: Pixels;
  settings: TraceSettings;
  out: { width: number; height: number };
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { image, settings, out } = e.data;
  try {
    self.postMessage({ result: traceImage(image, settings, out) });
  } catch (err) {
    self.postMessage({ error: (err as Error)?.message || 'Tracing failed.' });
  }
};
