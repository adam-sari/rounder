import { Marked } from 'marked';

const md = new Marked({ gfm: true });

export interface Rendered {
  html: string;
  /** source offset of each tagged block; block k carries data-b="k" in the html */
  offsets: number[];
}

/**
 * Renders GitHub-flavored Markdown one top-level block at a time, tagging each
 * block's first element so the editor and preview can scroll in step.
 * The html is not sanitized here: that needs a DOM, so the page does it.
 */
export function renderBlocks(src: string): Rendered {
  const out: string[] = [];
  const offsets: number[] = [];
  let pos = 0;
  for (const token of md.lexer(src)) {
    const html = md.parser([token]).replace(/^<([a-z][a-z0-9]*)/i, (_, tag: string) => {
      offsets.push(pos);
      return `<${tag} data-b="${offsets.length - 1}"`;
    });
    out.push(html);
    pos += token.raw.length;
  }
  return { html: out.join(''), offsets };
}
