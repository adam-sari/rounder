export type AiErrorCode = 'aborted' | 'network' | 'rate-limited' | 'storage-full' | 'out-of-memory' | 'no-webgpu' | 'failed';

/** An error with a stable `code` and a `message` written for end users */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiError';
  }
}

const MESSAGES: Record<AiErrorCode, string> = {
  aborted: 'Stopped.',
  network: "The model couldn't be downloaded. Check your connection and try again.",
  'rate-limited': 'The model host is busy right now. Wait a minute and try again.',
  'storage-full': "Your browser is out of space for the model. Free some space (or clear other sites' data) and try again.",
  'out-of-memory': 'Your device ran out of memory. Try a smaller file or the lighter model.',
  'no-webgpu': 'This model needs WebGPU, which this browser doesn\'t offer. Try the lighter model, or Chrome or Edge on a computer.',
  failed: 'The AI model hit a problem. Try again, or try the lighter model.',
};

export const aiError = (code: AiErrorCode, cause?: unknown) => new AiError(code, MESSAGES[code], { cause });

/**
 * Turns whatever a runtime threw into an AiError. Out-of-memory shows up in many shapes:
 * RangeError from ArrayBuffer allocation, wasm "Aborted()" / "OOM", or WebGPU buffer failures.
 */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const e = err as { name?: string; message?: string; code?: unknown } | undefined;
  // errors that crossed a worker boundary keep their code (see worker-utils)
  if (typeof e?.code === 'string' && e.code in MESSAGES) return aiError(e.code as AiErrorCode, err);
  const text = `${e?.name ?? ''} ${e?.message ?? String(err)}`;
  if (e?.name === 'AbortError' || /\babort(ed)? by user|signal is aborted/i.test(text)) return aiError('aborted', err);
  if (e?.name === 'QuotaExceededError' || /quota/i.test(text)) return aiError('storage-full', err);
  // status codes only in an HTTP context: runtime errors are full of tensor sizes like 512
  if (/HTTP 429|\(429\)|too many requests/i.test(text)) return aiError('rate-limited', err);
  if (/out of memory|\boom\b|allocation failed|array buffer allocation|memory access out of bounds|Aborted\(\)|failed to allocate|createBuffer/i.test(text) || e?.name === 'RangeError')
    return aiError('out-of-memory', err);
  if (/failed to fetch|networkerror|network error|load failed|while trying to load file|could not locate file|access to file|HTTP (40[34]|5\d\d)\b|\((40[34]|5\d\d)\)/i.test(text)) return aiError('network', err);
  return aiError('failed', err);
}
