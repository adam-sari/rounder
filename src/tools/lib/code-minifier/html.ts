import { MinifyError, type MinifyResult, type Note } from './options';

export interface HtmlOptions {
  removeComments: boolean;
  collapseWhitespace: boolean;
  minifyCss: boolean;
  minifyJs: boolean;
}

/** The CSS and JS minifiers, passed in so this file stays free of heavy imports */
export interface InlineMinifiers {
  css?: (code: string, context: 'stylesheet' | 'declarationList') => MinifyResult;
  /** throws MinifyError on a syntax error */
  js?: (code: string, module: boolean) => Promise<MinifyResult>;
}

interface Attr {
  name: string;
  value?: string;
  quote: string;
}

type Token =
  | { type: 'text'; text: string }
  | { type: 'raw'; text: string; start: number }
  | { type: 'comment'; raw: string; body: string }
  | { type: 'other'; raw: string }
  | { type: 'open'; name: string; rawName: string; attrs: Attr[]; selfClose: boolean }
  | { type: 'close'; name: string; rawName: string };

// elements whose content is plain text up to the matching end tag
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);

// whitespace next to these never shows on the page
const BLOCK = new Set(
  ('html head body title address article aside blockquote br center details dialog dd div dl dt fieldset figcaption figure ' +
    'footer form frameset frame h1 h2 h3 h4 h5 h6 header hgroup hr li main nav noframes ol optgroup option p pre section ' +
    'summary table caption colgroup col thead tbody tfoot tr td th ul menu legend source track param').split(' '),
);

// never rendered, so whitespace is judged by what's on either side of them
const HIDDEN = new Set(['script', 'style', 'link', 'meta', 'base', 'template']);

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'module']);
const JSON_TYPES = new Set(['application/json', 'application/ld+json', 'importmap', 'speculationrules']);

const WS = /[ \t\n\r\f]/;

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  let i = 0;
  const flush = () => {
    if (text) tokens.push({ type: 'text', text });
    text = '';
  };
  const until = (needle: string, from: number) => {
    const end = src.indexOf(needle, from);
    return end < 0 ? src.length : end + needle.length;
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1] ?? '';
    if (c !== '<') {
      const end = src.indexOf('<', i);
      text += src.slice(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end;
    } else if (src.startsWith('<!--', i)) {
      flush();
      const end = until('-->', i + 4);
      const raw = src.slice(i, end);
      tokens.push({ type: 'comment', raw, body: raw.slice(4, raw.endsWith('-->') ? -3 : undefined) });
      i = end;
    } else if (src.startsWith('<![CDATA[', i)) {
      flush();
      const end = until(']]>', i);
      tokens.push({ type: 'other', raw: src.slice(i, end) });
      i = end;
    } else if (next === '!' || next === '?') {
      flush();
      // "<?php $a->b ?>" holds ">" of its own
      const end = until(next === '?' ? '?>' : '>', i);
      tokens.push({ type: 'other', raw: src.slice(i, end) });
      i = end;
    } else if (next === '/' && /[a-z]/i.test(src[i + 2] ?? '')) {
      flush();
      const m = /^<\/([^\s/>]+)/.exec(src.slice(i, i + 256))!;
      tokens.push({ type: 'close', name: m[1].toLowerCase(), rawName: m[1] });
      i = until('>', i);
    } else if (/[a-z]/i.test(next)) {
      flush();
      i = openTag(src, i, tokens);
    } else {
      text += c;
      i++;
    }
  }
  flush();
  return tokens;
}

/** Reads a start tag (and the raw text after it, for script, style etc.); returns where it ends */
function openTag(src: string, i: number, tokens: Token[]): number {
  let j = i + 1;
  while (j < src.length && !WS.test(src[j]) && src[j] !== '/' && src[j] !== '>') j++;
  const rawName = src.slice(i + 1, j);
  const attrs: Attr[] = [];
  let selfClose = false;
  while (j < src.length && src[j] !== '>') {
    const c = src[j];
    if (WS.test(c)) {
      j++;
      continue;
    }
    if (c === '/') {
      selfClose = src[j + 1] === '>';
      j++;
      continue;
    }
    let k = j + 1; // the first character may be "=" in broken markup
    while (k < src.length && !WS.test(src[k]) && src[k] !== '/' && src[k] !== '>' && src[k] !== '=') k++;
    const attr: Attr = { name: src.slice(j, k), quote: '' };
    j = k;
    while (WS.test(src[j] ?? '')) j++;
    if (src[j] === '=') {
      j++;
      while (WS.test(src[j] ?? '')) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, j + 1);
        const stop = end < 0 ? src.length : end;
        attr.quote = q;
        attr.value = src.slice(j + 1, stop);
        j = stop + 1;
      } else {
        k = j;
        while (k < src.length && !WS.test(src[k]) && src[k] !== '>') k++;
        attr.value = src.slice(j, k);
        j = k;
      }
    }
    attrs.push(attr);
  }
  j = Math.min(j + 1, src.length);
  const name = rawName.toLowerCase();
  tokens.push({ type: 'open', name, rawName, attrs, selfClose });

  if (RAW.has(name) && !selfClose) {
    const close = new RegExp(`</${name}[\\s/>]`, 'gi');
    close.lastIndex = j;
    const end = close.exec(src)?.index ?? src.length;
    tokens.push({ type: 'raw', text: src.slice(j, end), start: j });
    return end;
  }
  return j;
}

function attrValue(attrs: Attr[], name: string) {
  return attrs.find((a) => a.name.toLowerCase() === name)?.value;
}

function isConditional(body: string) {
  return /^\s*\[if\b|^\s*<!\[endif\]|^\s*\[endif\]/i.test(body);
}

/** Lines and columns of a position, for pointing at problems in inline code */
function position(src: string, offset: number) {
  const before = src.slice(0, offset).split('\n');
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

function shiftNote(src: string, start: number, note: Note, what: string): Note {
  const at = position(src, start);
  if (!note.line) return { message: `${what}: ${note.message}`, ...at };
  return {
    message: `${what}: ${note.message}`,
    line: at.line + note.line - 1,
    column: note.line === 1 && note.column ? at.column + note.column - 1 : note.column,
  };
}

export async function minifyHtml(src: string, opts: HtmlOptions, inline: InlineMinifiers = {}): Promise<MinifyResult> {
  const notes: Note[] = [];
  let tokens = tokenize(src);

  if (opts.removeComments) tokens = tokens.filter((t) => t.type !== 'comment' || isConditional(t.body));
  // dropping a comment can leave two text nodes side by side
  tokens = tokens.reduce<Token[]>((list, t) => {
    const prev = list.at(-1);
    if (t.type === 'text' && prev?.type === 'text') prev.text += t.text;
    else list.push(t);
    return list;
  }, []);

  const invisible = (t: Token) =>
    t.type === 'raw' ||
    t.type === 'comment' ||
    (t.type === 'text' && !/[^ \t\n\r\f]/.test(t.text)) ||
    ((t.type === 'open' || t.type === 'close') && HIDDEN.has(t.name));
  /** true when whitespace next to this neighbour can go */
  const boundary = (from: number, step: 1 | -1) => {
    let k = from + step;
    while (tokens[k] && invisible(tokens[k])) k += step;
    const t = tokens[k];
    if (!t) return true;
    // a doctype starts the page; "<?php echo $name ?>" can sit mid-sentence, so its spaces stay
    if (t.type === 'other') return /^<!doctype/i.test(t.raw);
    return (t.type === 'open' || t.type === 'close') && BLOCK.has(t.name);
  };

  let out = '';
  let pre = 0;
  // the element whose raw text comes next
  let rawOwner: Extract<Token, { type: 'open' }> | undefined;

  for (const [k, t] of tokens.entries()) {
    if (t.type === 'text') {
      if (!opts.collapseWhitespace || pre > 0) {
        out += t.text;
        continue;
      }
      let text = t.text.replace(/[ \t\n\r\f]+/g, ' ');
      if (boundary(k, -1)) text = text.trimStart();
      if (boundary(k, 1)) text = text.trimEnd();
      out += text;
    } else if (t.type === 'comment' || t.type === 'other') {
      out += t.raw;
    } else if (t.type === 'close') {
      if (t.name === 'pre' && pre > 0) pre--;
      out += `</${t.rawName}>`;
    } else if (t.type === 'open') {
      if (t.name === 'pre' && !t.selfClose) pre++;
      rawOwner = t;
      out += openTagHtml(t, opts, inline);
    } else {
      out += await rawText(t, rawOwner!, src, opts, inline, notes);
    }
  }
  return { code: out, notes };
}

function openTagHtml(t: Extract<Token, { type: 'open' }>, opts: HtmlOptions, inline: InlineMinifiers) {
  let html = `<${t.rawName}`;
  let lastUnquoted = false;
  for (const a of t.attrs) {
    let { value, quote } = a;
    const lower = a.name.toLowerCase();
    if (value !== undefined && lower === 'class' && opts.collapseWhitespace) {
      value = value.trim().replace(/[ \t\n\r\f]+/g, ' ');
    }
    // entities would need decoding first, so styles that use them are left alone
    if (value !== undefined && lower === 'style' && opts.minifyCss && inline.css && !value.includes('&')) {
      const css = inline.css(value, 'declarationList').code;
      if (!css) continue;
      let q = quote;
      if (!q && /[\s"'=<>`]/.test(css)) q = '"';
      if (q && css.includes(q)) q = q === '"' ? "'" : '"';
      // with both kinds of quote inside, the original value stays
      if (!q || !css.includes(q)) [value, quote] = [css, q];
    }
    html += value === undefined ? ` ${a.name}` : ` ${a.name}=${quote}${value}${quote}`;
    lastUnquoted = value !== undefined && !quote;
  }
  // "<a href=x/>" would read the slash as part of the value
  if (t.selfClose) html += lastUnquoted ? ' /' : '/';
  return `${html}>`;
}

async function rawText(
  t: Extract<Token, { type: 'raw' }>,
  owner: Extract<Token, { type: 'open' }>,
  src: string,
  opts: HtmlOptions,
  inline: InlineMinifiers,
  notes: Note[],
) {
  const { text } = t;
  if (!text.trim()) return opts.collapseWhitespace && owner.name !== 'textarea' ? '' : text;
  const type = (attrValue(owner.attrs, 'type') ?? '').trim().toLowerCase();

  if (owner.name === 'title' && opts.collapseWhitespace) return text.trim().replace(/[ \t\n\r\f]+/g, ' ');

  if (owner.name === 'style' && opts.minifyCss && inline.css && (type === '' || type === 'text/css')) {
    const result = inline.css(text, 'stylesheet');
    for (const n of result.notes) notes.push(shiftNote(src, t.start, n, 'In a <style> block'));
    return result.code;
  }

  if (owner.name === 'script' && opts.minifyJs) {
    if (JSON_TYPES.has(type)) {
      try {
        // keep "</script>" inside strings from closing the tag
        return JSON.stringify(JSON.parse(text)).replace(/<\//g, '<\\/');
      } catch {
        notes.push({ message: `A <script type="${type}"> block isn't valid JSON, so it was left as is.`, ...position(src, t.start) });
        return text;
      }
    }
    if (JS_TYPES.has(type) && inline.js) {
      try {
        return (await inline.js(text, type === 'module')).code;
      } catch (e) {
        if (!(e instanceof MinifyError)) throw e;
        const note = shiftNote(src, t.start, { message: e.message, line: e.line, column: e.column }, 'In a <script> block');
        notes.push({ ...note, message: `${note.message} That script was left as is.` });
        return text;
      }
    }
  }
  return text;
}
