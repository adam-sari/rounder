import type { FormatRequest, FormatSettings } from './worker';

export type { FormatSettings };

let worker: Worker | undefined;
let cancel: (() => void) | undefined;

/** Shuts the worker down, e.g. when the tool goes away */
export function closeFormatter() {
  cancel?.();
  cancel = undefined;
  worker?.terminate();
  worker = undefined;
}

/** Formats off the main thread. A new call replaces one still running. */
export function formatSql(sql: string, settings: FormatSettings): Promise<string> {
  // a huge query can't be interrupted from inside, so a busy worker is replaced
  if (cancel) closeFormatter();
  const w = (worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  return new Promise((resolve, reject) => {
    cancel = () => reject(new DOMException('Superseded', 'AbortError'));
    w.onmessage = (e: MessageEvent<{ out?: string; error?: string }>) => {
      cancel = undefined;
      if (e.data.error !== undefined) reject(new Error(e.data.error));
      else resolve(e.data.out ?? '');
    };
    w.onerror = (e) => {
      cancel = undefined;
      closeFormatter();
      reject(new Error(e.message || 'Formatting failed.'));
    };
    const request: FormatRequest = { sql, settings };
    w.postMessage(request);
  });
}
