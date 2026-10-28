export type ErrorCode =
  | 'needs-password'
  | 'wrong-password'
  | 'damaged'
  | 'unsupported-input'
  | 'unsupported-codec'
  | 'target-not-met'
  | 'missing-dependency'
  | 'aborted'
  | 'out-of-memory'
  | 'invalid-options'
  | 'exists'
  | 'failed';

/** Every error the SDK throws. `message` is written for people (the site's own copy); `hint` says what to try. */
export class RounderError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, o: { hint?: string; cause?: unknown } = {}) {
    super(message, { cause: o.cause });
    this.name = 'RounderError';
    this.code = code;
    this.hint = o.hint;
  }
}

export const isRounderError = (e: unknown): e is RounderError => e instanceof Error && e.name === 'RounderError' && 'code' in e;

const MEDIA: Record<string, ErrorCode> = {
  aborted: 'aborted',
  'unsupported-input': 'unsupported-input',
  'unsupported-codec': 'unsupported-codec',
  'no-tracks': 'unsupported-input',
  'invalid-options': 'invalid-options',
  'out-of-memory': 'out-of-memory',
};

/** Maps the site's own errors (PdfError, PdfPasswordError, MediaError, StampError, PageRangeError…) to RounderError */
export function toRounderError(e: unknown): RounderError {
  if (isRounderError(e)) return e;
  const err = e as Error & { kind?: string; reason?: string; code?: string };
  const message = err?.message || String(e);
  const cause = { cause: e };
  switch (err?.name) {
    case 'AbortError':
    case 'RenderingCancelledException':
      return new RounderError('aborted', 'The operation was aborted.', cause);
    case 'PdfPasswordError':
      return err.reason === 'wrongPassword'
        ? new RounderError('wrong-password', message, { ...cause, hint: 'Check the password and try again.' })
        : new RounderError('needs-password', message, { ...cause, hint: 'Pass the password with --password (or the password option).' });
    case 'PdfError':
      if (/memory/i.test(message)) return new RounderError('out-of-memory', message, cause);
      return new RounderError(err.kind === 'damaged' ? 'damaged' : err.kind === 'unsupported' ? 'unsupported-input' : 'failed', message, cause);
    case 'PageRangeError':
    case 'StampError':
      return new RounderError('invalid-options', message, cause);
    case 'MediaError':
      return new RounderError(MEDIA[err.code ?? ''] ?? 'failed', message, cause);
    case 'ZodError':
      return new RounderError('invalid-options', message, cause);
  }
  if (e instanceof RangeError && /memory|allocation/i.test(message)) return new RounderError('out-of-memory', message, cause);
  if (/Aborted\(OOM\)|out of memory/i.test(message)) return new RounderError('out-of-memory', message, cause);
  return new RounderError('failed', message, cause);
}

export const abortError = () => new RounderError('aborted', 'The operation was aborted.');

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}
