/** used when an svg has neither a size nor a viewBox */
export const FALLBACK_SIZE = 512;
/** browsers refuse canvases much past these */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 40_000_000;

const UNITS: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, ex: 8, rem: 16 };

/** "2in" → 192; percentages and junk → undefined */
export function parseLength(value: string | undefined): number | undefined {
  const m = value?.trim().match(/^([\d.]+(?:e[+-]?\d+)?)\s*([a-z]*)$/i);
  if (!m) return undefined;
  const unit = UNITS[m[2].toLowerCase()];
  const n = parseFloat(m[1]) * (unit ?? NaN);
  return n > 0 && Number.isFinite(n) ? n : undefined;
}

// the root tag, allowing ">" inside quoted attribute values
const ROOT = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function rootAttrs(tag: string) {
  const attrs = new Map<string, string>();
  for (const m of tag.slice(4).matchAll(ATTR)) attrs.set(m[1], m[2] ?? m[3]);
  return attrs;
}

export interface SvgSize {
  width: number;
  height: number;
  /** neither a size nor a viewBox: FALLBACK_SIZE was used */
  guessed: boolean;
}

/** The size an svg draws at by default, in px */
export function readSvgSize(text: string): SvgSize {
  const tag = text.match(ROOT)?.[0];
  if (!tag) throw new Error('No <svg> tag found in this file.');
  const attrs = rootAttrs(tag);
  const w = parseLength(attrs.get('width'));
  const h = parseLength(attrs.get('height'));
  const vb = attrs.get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const [vw, vh] = vb?.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : [];
  if (w && h) return { width: w, height: h, guessed: false };
  if (vw && vh) {
    if (w) return { width: w, height: (w * vh) / vw, guessed: false };
    if (h) return { width: (h * vw) / vh, height: h, guessed: false };
    return { width: vw, height: vh, guessed: false };
  }
  const side = w ?? h;
  return side ? { width: side, height: side, guessed: false } : { width: FALLBACK_SIZE, height: FALLBACK_SIZE, guessed: true };
}

export type Sizing = { mode: 'scale'; factor: number } | { mode: 'width' | 'height'; px: number };

/** Output pixel size for an svg, keeping its aspect ratio and staying inside canvas limits */
export function targetSize(size: { width: number; height: number }, sizing: Sizing) {
  const s = sizing.mode === 'scale' ? sizing.factor : sizing.px / (sizing.mode === 'width' ? size.width : size.height);
  let width = size.width * s;
  let height = size.height * s;
  const fit = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  // round down when capping so rounding can't push past the limit
  const round = fit < 1 ? Math.floor : Math.round;
  width = Math.max(1, round(width * fit));
  height = Math.max(1, round(height * fit));
  return { width, height, capped: fit < 1 };
}

/**
 * Rewrites the root tag so the svg draws at exactly width × height: an explicit size,
 * a viewBox so the content scales with it, and the namespace an <img> insists on
 * (svg code copied out of an html page usually lacks it).
 */
export function prepareSvg(text: string, width: number, height: number): string {
  const tag = text.match(ROOT)?.[0];
  if (!tag) throw new Error('No <svg> tag found in this file.');
  const attrs = rootAttrs(tag);
  if (!attrs.has('viewBox')) {
    const own = readSvgSize(text);
    attrs.set('viewBox', `0 0 ${own.width} ${own.height}`);
  }
  attrs.delete('width');
  attrs.delete('height');
  if (!attrs.has('xmlns')) attrs.set('xmlns', 'http://www.w3.org/2000/svg');
  if (!attrs.has('xmlns:xlink') && text.includes('xlink:')) attrs.set('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  const esc = (v: string) => v.replace(/&(?![\w#]+;)/g, '&amp;').replace(/"/g, '&quot;');
  const list = [...attrs].map(([k, v]) => `${k}="${esc(v)}"`);
  const rebuilt = `<svg ${list.join(' ')} width="${width}" height="${height}"${/\/\s*>$/.test(tag) ? '/>' : '>'}`;
  return text.replace(tag, () => rebuilt);
}

/** Linked images, stylesheets or fonts, which browsers block when an svg is drawn as an image */
export function hasExternalRefs(text: string): boolean {
  // plain <a> links don't count: they don't change how the svg looks
  const linked = /<(?:image|use|feImage)\b[^>]*\bhref\s*=\s*["'](?!\s*(?:data:|#))/i;
  return linked.test(text) || /url\(\s*["']?(?!\s*(?:data:|#))/i.test(text) || /@import\b/i.test(text);
}
