import type { RegexRequest, RegexResponse } from './worker';

export class RegexTimeoutError extends Error {}

let worker: Worker | undefined;
let pending: { reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> } | undefined;

function kill() {
  worker?.terminate();
  worker = undefined;
}

/** stops a run in progress and shuts the worker down */
export function closeRegexWorker() {
  if (pending) {
    clearTimeout(pending.timer);
    pending.reject(new DOMException('Superseded', 'AbortError'));
    pending = undefined;
  }
  kill();
}

/**
 * Matches off the main thread. A run can't be interrupted from inside (a backtracking regex never
 * yields), so a run that is superseded or overdue takes its worker with it and the next one starts fresh.
 */
export function runRegex(request: RegexRequest, timeoutMs = 2000): Promise<RegexResponse> {
  if (pending) closeRegexWorker();
  const w = (worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      kill();
      reject(new RegexTimeoutError(`Stopped after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);
    pending = { reject, timer };
    const done = () => {
      clearTimeout(timer);
      pending = undefined;
    };
    w.onmessage = (e: MessageEvent<{ result?: RegexResponse; error?: string }>) => {
      done();
      if (e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      done();
      kill();
      reject(new Error(e.message || 'The regex engine stopped unexpectedly.'));
    };
    w.postMessage(request);
  });
}
