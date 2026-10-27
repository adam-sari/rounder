/// <reference lib="webworker" />
import { compile, findMatches, type MatchResult } from './regex';

export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
  /** null outside replace mode */
  replacement: string | null;
}

export interface RegexResponse extends MatchResult {
  replaced: string | null;
  ms: number;
}

self.onmessage = (e: MessageEvent<RegexRequest>) => {
  const { pattern, flags, text, replacement } = e.data;
  const compiled = compile(pattern, flags);
  if (!compiled.ok) {
    self.postMessage({ error: compiled.error });
    return;
  }
  const t0 = performance.now();
  const result = findMatches(compiled.regex, text);
  const replaced = replacement === null ? null : text.replace(new RegExp(pattern, flags), replacement);
  self.postMessage({ result: { ...result, replaced, ms: performance.now() - t0 } satisfies RegexResponse });
};
