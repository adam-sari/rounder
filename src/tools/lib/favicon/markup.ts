export type Shape = 'square' | 'rounded' | 'circle';

/** corner radius as a fraction of the icon size */
export const shapeRadius: Record<Shape, number> = { square: 0, rounded: 0.22, circle: 0.5 };

/** Keeps the first n user-perceived characters, so a flag or family emoji counts as one */
export function firstGraphemes(text: string, n: number) {
  // Firefox before 125 has no Segmenter; splitting by code point still keeps simple emoji whole
  const parts =
    typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment) : Array.from(text);
  return parts.slice(0, n).join('');
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Frame {
  shape: Shape;
  /** fill color, or undefined for transparent */
  background?: string;
}

/** Wraps svg content (drawn on a 100 × 100 viewBox) in the icon's shape and background */
function frame({ shape, background }: Frame, content: string) {
  const r = shapeRadius[shape] * 100;
  const clip = shape === 'square' ? '' : `<clipPath id="favicon-shape"><rect width="100" height="100" rx="${r}"/></clipPath>`;
  const bg = background ? `<rect width="100" height="100" fill="${background}"/>` : '';
  const body = `${bg}${content}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${clip}${clip ? `<g clip-path="url(#favicon-shape)">${body}</g>` : body}</svg>`;
}

export interface TextIcon extends Frame {
  text: string;
  fontFamily: string;
  fontWeight: number;
  color: string;
  /** font size and baseline origin in viewBox units, measured on a canvas */
  fontSize: number;
  x: number;
  y: number;
}

export function textSvg(t: TextIcon) {
  const round = (n: number) => Math.round(n * 100) / 100;
  return frame(
    t,
    `<text x="${round(t.x)}" y="${round(t.y)}" font-family="${escapeXml(t.fontFamily)}" font-weight="${t.fontWeight}" font-size="${round(t.fontSize)}" fill="${t.color}">${escapeXml(t.text)}</text>`,
  );
}

export interface NestedSvg extends Frame {
  /** padding on each side as a percentage of the icon */
  padding: number;
  fit: 'fit' | 'fill';
  /** used for the viewBox when the source has neither a viewBox nor a width and height */
  fallbackWidth: number;
  fallbackHeight: number;
}

/** Places an existing svg inside the icon frame, scaled to fit (or cover) the padded box */
export function nestSvg(source: string, o: NestedSvg) {
  // entities declared in a DOCTYPE (old Illustrator exports) would break once the DOCTYPE is dropped
  if (/<!ENTITY/i.test(source)) throw new Error('SVG entities are not supported');
  const body = source.replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>|<!--[\s\S]*?-->/gi, '').trim();
  const root = body.match(/<svg\b[^>]*>/i);
  if (!root) throw new Error('Not an SVG file');
  const attr = (name: string) => root[0].match(new RegExp(String.raw`\s${name}\s*=\s*["']([^"']*)["']`, 'i'))?.[1];
  const width = parseFloat(attr('width') ?? '') || o.fallbackWidth;
  const height = parseFloat(attr('height') ?? '') || o.fallbackHeight;
  const hasViewBox = attr('viewBox') !== undefined;
  const pad = o.padding;
  const size = 100 - 2 * pad;
  const placed = root[0].replace(/\s(width|height|x|y|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(
    /^<svg\b/i,
    `<svg x="${pad}" y="${pad}" width="${size}" height="${size}"${hasViewBox ? '' : ` viewBox="0 0 ${width} ${height}"`} preserveAspectRatio="xMidYMid ${o.fit === 'fill' ? 'slice' : 'meet'}"`,
  );
  return frame(o, body.replace(root[0], placed));
}

export function webManifest(name: string, color: string) {
  const icon = (size: number) => ({ src: `/android-chrome-${size}x${size}.png`, sizes: `${size}x${size}`, type: 'image/png' });
  return JSON.stringify(
    { name, short_name: name, icons: [icon(192), icon(512)], theme_color: color, background_color: color, display: 'standalone' },
    null,
    2,
  );
}

export function linkTags(hasSvg: boolean) {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    hasSvg && '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ]
    .filter(Boolean)
    .join('\n');
}
