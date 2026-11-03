// A small XML reader for Office files (word/document.xml, ppt/slides/slide1.xml, xl/worksheets/sheet1.xml). It is not a
// general parser: no DTDs, no external entities (so no XXE), namespaces kept as written ("w:p"). Enough to walk the
// element tree of files that Office and LibreOffice write, and it never throws on odd input: it reads what it can.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses a document into its root element (a synthetic "#document" wrapping everything at the top level) */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      pushText(stack[stack.length - 1], text.slice(i));
      break;
    }
    if (lt > i) pushText(stack[stack.length - 1], text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      const raw = text.slice(lt + 9, end < 0 ? n : end);
      stack[stack.length - 1].children.push(raw);
      i = end < 0 ? n : end + 3;
    } else if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      // declarations and doctypes: skipped, entities in them are never expanded
      const end = text.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      const name = text.slice(lt + 2, end < 0 ? n : end).trim();
      // close up to the matching element; a stray closing tag is ignored
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
    } else {
      const end = tagEnd(text, lt + 1);
      const body = text.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const sp = inner.search(/\s/);
      const name = sp < 0 ? inner : inner.slice(0, sp);
      const attrs: Record<string, string> = {};
      if (sp >= 0) {
        ATTR.lastIndex = 0;
        for (let m = ATTR.exec(inner); m; m = ATTR.exec(inner)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      const el: XmlElement = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
      i = end + 1;
    }
  }
  return root;
}

/** the closing ">" of a start tag, skipping any ">" inside quoted attribute values */
function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let k = from; k < text.length; k++) {
    const c = text[k];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return k;
  }
  return text.length;
}

function pushText(el: XmlElement, raw: string) {
  if (raw) el.children.push(decodeEntities(raw));
}

/** the local part of a name: "w:p" → "p" */
export const local = (name: string) => name.slice(name.indexOf(':') + 1);

export const isEl = (n: XmlNode | undefined): n is XmlElement => typeof n === 'object' && n !== null;

/** direct children with this local name */
export function kids(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => isEl(c) && local(c.name) === name);
}

export function kid(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => isEl(c) && local(c.name) === name);
}

/** every descendant with this local name, in document order */
export function all(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    if (local(c.name) === name) out.push(c);
    all(c, name, out);
  }
  return out;
}

/** an attribute by local name: attr(el, 'val') finds w:val */
export function attr(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  if (name in el.attrs) return el.attrs[name];
  for (const k in el.attrs) if (local(k) === name) return el.attrs[k];
  return undefined;
}

/** all text inside, concatenated */
export function textOf(el: XmlNode): string {
  if (!isEl(el)) return el;
  let s = '';
  for (const c of el.children) s += textOf(c);
  return s;
}

/** a relationship id (r:id, r:embed): namespaced, so `id="256" r:id="rId2"` gives rId2, not 256 */
export function relId(el: XmlElement | undefined, name = 'id'): string | undefined {
  if (!el) return undefined;
  for (const k in el.attrs) if (k.includes(':') && local(k) === name) return el.attrs[k];
  return undefined;
}
