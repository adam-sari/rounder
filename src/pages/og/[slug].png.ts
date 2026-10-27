import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { tools, toolsIn, splitEmphasis } from '@/tools/registry';
import { categories, categoryById } from '@/tools/categories';

// 1200×630 share cards, rendered once at build time: one per tool, category and the home page

const SPOT: Record<string, string> = {
  video: '#ff6b4a', audio: '#ffd25e', image: '#7cc4ff', pdf: '#ff8fb8', ai: '#c8a6ff',
  text: '#9be58f', dev: '#5fe0d0', everyday: '#ffa552', files: '#8fa2ff', creator: '#f2e36b',
};
const BG = '#131211';
const CHALK = '#f2ede4';
const SOFT = '#c9c2b6';
const SUN = '#ffd25e';

interface Card {
  label: string;
  /** heading with one *emphasised* part */
  heading: string;
  tagline: string;
  path: string;
  spot: string;
}

export function getStaticPaths() {
  const cards: { slug: string; card: Card }[] = tools.map((t) => ({
    slug: t.slug,
    card: { label: `${categoryById[t.category].name} tools`, heading: t.h1, tagline: t.tagline, path: `/${t.slug}`, spot: SPOT[t.category] },
  }));
  for (const c of categories) {
    if (!toolsIn(c.id).length) continue;
    cards.push({ slug: `${c.id}-tools`, card: { label: 'Rounder', heading: `${c.name} *tools*`, tagline: c.intro, path: `/${c.id}-tools`, spot: SPOT[c.id] } });
  }
  cards.push({
    slug: 'home',
    card: { label: 'roundertools.com', heading: 'Free tools, *no junk*', tagline: 'Compress, convert, edit and create, right in your browser. No uploads, no sign-ups, no watermarks.', path: '', spot: SUN },
  });
  return cards.map(({ slug, card }) => ({ params: { slug }, props: { card } }));
}

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

const font = (pkg: string, file: string) => readFile(new URL(`../../../node_modules/${pkg}/files/${file}`, import.meta.url));
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 700; style: 'normal' | 'italic' }[]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all([
    font('@fontsource/instrument-serif', 'instrument-serif-latin-400-normal.woff').then((data) => ({ name: 'Serif', data, weight: 400 as const, style: 'normal' as const })),
    font('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff').then((data) => ({ name: 'Serif', data, weight: 400 as const, style: 'italic' as const })),
    font('@fontsource/geist', 'geist-latin-500-normal.woff').then((data) => ({ name: 'Geist', data, weight: 500 as const, style: 'normal' as const })),
    font('@fontsource/geist-mono', 'geist-mono-latin-500-normal.woff').then((data) => ({ name: 'Mono', data, weight: 500 as const, style: 'normal' as const })),
  ]));

/** Roundy peeking in from the right edge: an off-register color blob under an ink outline */
const roundy = (spot: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <circle cx="214" cy="212" r="168" fill="${spot}"/>
  <circle cx="200" cy="200" r="168" fill="none" stroke="${CHALK}" stroke-width="7"/>
  <circle cx="150" cy="180" r="13" fill="${BG}"/><circle cx="236" cy="180" r="13" fill="${BG}"/>
  <path d="M152 238 Q193 274 234 238" fill="none" stroke="${BG}" stroke-width="9" stroke-linecap="round"/>
  <circle cx="122" cy="226" r="17" fill="#f2654a" opacity=".55"/><circle cx="266" cy="226" r="17" fill="#f2654a" opacity=".55"/>
</svg>`)}`;

function card({ label, heading, tagline, path, spot }: Card): Node {
  const parts = splitEmphasis(heading);
  const size = heading.length > 30 ? 92 : heading.length > 20 ? 108 : 124;
  return h(
    'div',
    {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column', padding: '56px 64px',
      backgroundColor: BG, color: CHALK, fontFamily: 'Geist',
      backgroundImage: 'linear-gradient(rgba(242,237,228,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(242,237,228,.07) 1px, transparent 1px)',
      backgroundSize: '32px 32px',
    },
    h('div', { display: 'flex', alignItems: 'center', gap: 16 },
      h('div', { width: 22, height: 22, borderRadius: 11, backgroundColor: SUN }),
      h('div', { fontFamily: 'Serif', fontSize: 40 }, 'Rounder'),
      h('div', { marginLeft: 18, padding: '6px 16px', border: `2px solid ${spot}`, borderRadius: 99, color: spot, fontFamily: 'Mono', fontSize: 20, textTransform: 'uppercase', letterSpacing: 2 }, label),
    ),
    h('div', { display: 'flex', flexDirection: 'column', maxWidth: 840, marginTop: 'auto', marginBottom: 'auto' },
      h('div', { display: 'flex', flexWrap: 'wrap', fontFamily: 'Serif', fontSize: size, lineHeight: 0.95, letterSpacing: -1 },
        ...parts.map((p) => h('span', p.em ? { fontStyle: 'italic', color: SUN, whiteSpace: 'pre' } : { whiteSpace: 'pre' }, p.text)),
      ),
      h('div', { marginTop: 26, fontSize: 30, lineHeight: 1.35, color: SOFT, maxWidth: 760 }, tagline),
    ),
    h('div', { position: 'absolute', left: 64, bottom: 52, display: 'flex', fontFamily: 'Mono', fontSize: 21, color: SOFT, letterSpacing: 1 },
      h('span', {}, 'free · runs on your device · no sign-up'),
      h('span', { marginLeft: 36, color: CHALK }, `roundertools.com${path}`),
    ),
    { type: 'img', props: { src: roundy(spot), width: 400, height: 400, style: { position: 'absolute', right: -90, top: 150 } } },
  );
}

export const GET: APIRoute = async ({ props }) => {
  const svg = await satori(card(props.card as Card) as never, { width: 1200, height: 630, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
