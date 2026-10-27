import { syntax } from 'csso';
import type { MinifyResult, Note } from './options';

export interface CssOptions {
  restructure: boolean;
  keepLicense: boolean;
}

/**
 * Minifies with CSSO. CSSO quietly drops rules it can't parse (CSS nesting, media
 * range queries), so on any parse error we fall back to the safe minifier below
 * and say where the trouble started.
 */
export function minifyCss(src: string, opts: CssOptions, context: 'stylesheet' | 'declarationList' = 'stylesheet'): MinifyResult {
  let problem: Note | undefined;
  const ast = syntax.parse(src, {
    context,
    onParseError: (e) => {
      if (problem) return;
      const before = src.slice(0, e.offset).split('\n');
      problem = { message: e.message, line: before.length, column: before.at(-1)!.length + 1 };
    },
  });
  if (problem) {
    const reason = problem.message.replace(/\.?$/, '');
    return {
      code: safeMinifyCss(src, opts.keepLicense),
      notes: [{
        ...problem,
        message: `CSSO couldn't parse this (${reason}). It may be a typo, or newer syntax CSSO doesn't know yet, like CSS nesting. To be safe, only comments and whitespace were removed.`,
      }],
    };
  }
  const { ast: out } = syntax.compress(ast, { restructure: opts.restructure, comments: opts.keepLicense ? 'exclamation' : false });
  return { code: syntax.generate(out), notes: [] };
}

// whitespace right after / right before these characters never changes what CSS means
const SPACE_AFTER_OK = new Set(['{', '}', ';', ',', '>', ':', '(', '=']);
const SPACE_BEFORE_OK = new Set(['{', '}', ';', ',', '>', ')']);

/**
 * Removes comments and needless whitespace without parsing. Works on any CSS,
 * including syntax no minifier understands yet, at the cost of a bigger result.
 */
export function safeMinifyCss(src: string, keepLicense: boolean): string {
  let out = '';
  // last character written, or '' when it was escaped or part of a string (never "punctuation")
  let last = '';
  let space = false;
  let i = 0;

  const emit = (text: string, punct: string) => {
    if (space && out && !SPACE_AFTER_OK.has(last) && !SPACE_BEFORE_OK.has(punct)) out += ' ';
    space = false;
    out += text;
    last = punct;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      space = true;
      i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      if (keepLicense && src[i + 2] === '!') emit(src.slice(i, stop), '');
      else space = true; // a comment separates tokens, like whitespace
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, src.length);
      emit(src.slice(i, j), '');
      i = j;
    } else if (c === '\\') {
      emit(src.slice(i, i + 2), '');
      i += 2;
    } else if ((c === 'u' || c === 'U') && /^url\(\s*[^\s'")]/i.test(src.slice(i, i + 5 + 64)) && !/[\w-]/.test(src[i - 1] ?? '')) {
      // unquoted url(...) keeps its content as is
      const end = src.indexOf(')', i);
      const stop = end < 0 ? src.length : end + 1;
      emit(src.slice(i, stop), ')');
      i = stop;
    } else {
      if (c === '}' && last === ';' && out.at(-2) !== ':') out = out.slice(0, -1);
      emit(c, c);
      i++;
    }
  }
  return out;
}
