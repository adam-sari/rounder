// Office files (docx, pptx, xlsx) are ZIP archives of XML parts. This opens one with limits, so a crafted file can't
// blow up memory: only the XML parts are inflated, and their declared sizes are capped first.
import { unzipSync, Unzip, UnzipInflate } from 'fflate';
import { attr, kids, parseXml, type XmlElement } from './xml';

export class DocError extends Error {
  constructor(
    message: string,
    readonly code: 'damaged' | 'unsupported-input' = 'damaged',
  ) {
    super(message);
  }
}

/** the most XML a document may unpack to */
export const MAX_XML = 300 * 1024 * 1024;

export interface OfficePackage {
  names: string[];
  /** a part's text, or undefined when it's missing */
  text(path: string): string | undefined;
  xml(path: string): XmlElement | undefined;
  /** a part's relationships, id → absolute part path (or the external URL) */
  rels(path: string): Map<string, { target: string; type: string; external: boolean }>;
}

const isXml = (name: string) => /\.(xml|rels)$/i.test(name);

export function openPackage(bytes: Uint8Array, kind: string): OfficePackage {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // an old binary .doc/.xls/.ppt starts with the OLE signature D0 CF 11 E0
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new DocError(`This is an old-style binary ${kind} file (.doc, .xls or .ppt). Save it as the newer format (.docx, .xlsx, .pptx) first.`, 'unsupported-input');
    throw new DocError(`This file isn't a ${kind} document, or it's damaged.`);
  }
  let declared = 0;
  const sizes = new Map<string, number>();
  const reader = new Unzip();
  reader.register(UnzipInflate);
  reader.onfile = (f) => sizes.set(f.name, f.originalSize ?? 0);
  try {
    reader.push(bytes, true);
  } catch {
    throw new DocError(`This ${kind} file couldn't be opened. It may be damaged.`);
  }
  for (const [name, size] of sizes) if (isXml(name)) declared += size;
  if (declared > MAX_XML) throw new DocError(`This ${kind} file unpacks to more XML than can be read safely (over ${MAX_XML / 1024 / 1024} MB).`, 'unsupported-input');

  let parts: Record<string, Uint8Array>;
  let total = 0;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        if (!isXml(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_XML) throw new DocError(`This ${kind} file unpacks to more XML than can be read safely.`, 'unsupported-input');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof DocError) throw e;
    throw new DocError(`This ${kind} file couldn't be opened. It may be damaged.`);
  }
  const decoder = new TextDecoder('utf-8');
  const cache = new Map<string, XmlElement | undefined>();
  const text = (path: string) => {
    const p = parts[path.replace(/^\//, '')];
    return p ? decoder.decode(p) : undefined;
  };
  const xml = (path: string) => {
    if (!cache.has(path)) {
      const t = text(path);
      cache.set(path, t === undefined ? undefined : parseXml(t));
    }
    return cache.get(path);
  };
  return {
    names: [...sizes.keys()],
    text,
    xml,
    rels(path) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      const file = path.slice(dir.length);
      const doc = xml(`${dir}_rels/${file}.rels`);
      const map = new Map<string, { target: string; type: string; external: boolean }>();
      const root = doc && kids(doc, 'Relationships')[0];
      if (!root) return map;
      for (const r of kids(root, 'Relationship')) {
        const id = attr(r, 'Id');
        const target = attr(r, 'Target') ?? '';
        const external = attr(r, 'TargetMode') === 'External';
        if (id) map.set(id, { target: external ? target : resolvePart(dir, target), type: attr(r, 'Type') ?? '', external });
      }
      return map;
    },
  };
}

/** "word/" + "../media/a.png" → "media/a.png"; "/xl/sheet1.xml" stays absolute */
export function resolvePart(dir: string, target: string): string {
  const segs = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
  const out: string[] = [];
  for (const s of segs) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
}
