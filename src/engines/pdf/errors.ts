/** An error whose message is written for people, safe to show as-is */
export class PdfError extends Error {
  constructor(
    message: string,
    readonly kind: 'damaged' | 'password' | 'unsupported' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'PdfError';
  }
}

/**
 * The PDF is encrypted. "needsPassword" means none was given, "wrongPassword"
 * means the one given didn't open it. Catch it, ask (PdfPasswordPrompt), retry.
 */
export class PdfPasswordError extends PdfError {
  constructor(readonly reason: 'needsPassword' | 'wrongPassword') {
    super(reason === 'needsPassword' ? 'This PDF is password-protected. Enter its password to open it.' : "That password didn't work. Check it and try again.", 'password');
    this.name = 'PdfPasswordError';
  }
}

export const DAMAGED = "This file couldn't be read as a PDF. It may be damaged or not really a PDF.";

export function isAbort(e: unknown) {
  return (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'RenderingCancelledException';
}

export function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Turns qpdf's stderr into a PdfError. qpdf prefixes lines with "program: file: " */
export function qpdfError(stderr: string, hadPassword: boolean): PdfError {
  if (/invalid password/i.test(stderr)) return new PdfPasswordError(hadPassword ? 'wrongPassword' : 'needsPassword');
  if (/\bOOM\b|out of memory|enlarge memory/.test(stderr)) return new PdfError("This file is too big to process in your browser's memory. Try closing other tabs, or a smaller file.");
  if (/startxref|not a PDF|unable to find trailer|file is damaged|xref|EOF|header/i.test(stderr)) return new PdfError(DAMAGED, 'damaged');
  const lines = stderr.split('\n').map((l) => l.replace(/^[^:]*: (?:[^:]*\.pdf(?: \([^)]*\))?: )?/, '').trim()).filter(Boolean);
  const detail = lines.find((l) => !/^(qpdf: )?operation succeeded/i.test(l)) ?? 'unknown error';
  return new PdfError(`The PDF couldn't be processed (${detail}).`);
}
