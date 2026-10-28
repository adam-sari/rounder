// From entities to tools: the conversion graph (mostly read off the registry's slugs and variant props), size and
// platform presets, verb + object rules, and multi-step chains. Table-driven, so a new tool is data, not code.
import { parse, has, type Entities } from './entities';
import { FORMATS, KINDS, PLATFORMS, type Kind } from './lexicon';
import { lexTokens, stem } from './text';
import type { Preset, Route, SearchDoc } from './types';

/** a format or kind word in a slug or prop value → our format id, or a kind */
const ALIAS: Record<string, string> = {
  jpeg: 'jpg', word: 'docx', excel: 'xlsx', powerpoint: 'pptx', markdown: 'md', text: 'txt', image: 'image', images: 'image',
  video: 'video', audio: 'audio', photo: 'image',
};
export const formatOf = (w: string | undefined): string | undefined => {
  if (!w) return;
  const x = w.toLowerCase();
  if (FORMATS[x]) return x;
  if (ALIAS[x]) return ALIAS[x];
  return Object.entries(FORMATS).find(([, f]) => f.aliases.includes(x))?.[0];
};
const kindOf = (id: string): Kind | undefined => (FORMATS[id]?.kind ?? (id in KINDS ? (id as Kind) : undefined));
const isKind = (id: string) => !FORMATS[id];

const IMAGE_IN = ['image', 'jpg', 'png', 'webp', 'avif', 'heic', 'gif', 'bmp'];
const VIDEO_IN = ['video', 'mp4', 'mov', 'webm', 'mkv', 'avi'];
const AUDIO_IN = ['audio', 'mp3', 'wav', 'm4a', 'flac', 'ogg'];

/** one way to turn a source into a target; `pass` copies from/to into the preset (converter pages) */
interface Edge {
  from: string[];
  to: string[];
  slug: string;
  pass?: 'from' | 'fromTo';
}

/** conversions the slugs don't spell out: main converters, and tools whose input and output aren't in their name */
const MANUAL: Edge[] = [
  { from: IMAGE_IN, to: ['pdf'], slug: 'jpg-to-pdf' },
  { from: IMAGE_IN, to: ['svg'], slug: 'png-to-svg' },
  { from: [...IMAGE_IN, 'svg'], to: ['ico'], slug: 'png-to-ico' },
  { from: IMAGE_IN, to: ['docx'], slug: 'jpg-to-word' },
  { from: IMAGE_IN, to: ['txt'], slug: 'image-to-text' },
  { from: IMAGE_IN, to: ['jpg', 'png', 'webp', 'avif', 'image'], slug: 'image-converter', pass: 'fromTo' },
  { from: ['pdf'], to: ['image'], slug: 'pdf-to-jpg' },
  { from: VIDEO_IN, to: ['mp3', 'wav', 'm4a', 'audio'], slug: 'video-to-mp3', pass: 'from' },
  { from: VIDEO_IN, to: ['gif'], slug: 'video-to-gif', pass: 'from' },
  { from: [...VIDEO_IN, ...AUDIO_IN], to: ['txt'], slug: 'audio-to-text' },
  { from: VIDEO_IN, to: ['mp4', 'webm', 'mov', 'mkv', 'video'], slug: 'video-converter', pass: 'fromTo' },
  { from: AUDIO_IN, to: ['mp4', 'video'], slug: 'audiogram-maker' },
  { from: AUDIO_IN, to: ['m4r'], slug: 'ringtone-maker' },
  { from: AUDIO_IN, to: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'audio'], slug: 'audio-converter', pass: 'fromTo' },
  { from: IMAGE_IN, to: ['video', 'mp4'], slug: 'slideshow-maker' },
  { from: ['txt'], to: ['mp3', 'audio'], slug: 'text-to-speech' },
];

/** the lean index plus what routing derives from it once */
export interface Catalog {
  docs: SearchDoc[];
  bySlug: Map<string, SearchDoc>;
  edges: Edge[];
  /** input kinds each tool accepts, when they're known (an image tool can't be the answer for a video) */
  inputs: Map<string, Set<string>>;
  /** a word some tool's text uses, so the parser's typo fixer leaves it alone */
  known: (w: string) => boolean;
}

export function makeCatalog(docs: SearchDoc[]): Catalog {
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  const edges: Edge[] = [];
  for (const d of docs) {
    // "heic-to-jpg", "pdf-to-word", "image-to-text": the slug names the pair
    const m = /^([a-z0-9]+)-to-([a-z0-9]+)$/.exec(d.slug);
    const from = formatOf(m?.[1] ?? (d.props?.from as string));
    const to = formatOf(m?.[2] ?? (d.props?.to as string));
    if (from && to) edges.push({ from: [from], to: [to], slug: d.slug });
  }
  for (const e of MANUAL) if (bySlug.has(e.slug)) edges.push(e);

  const inputs = new Map<string, Set<string>>();
  const CAT_INPUT: Record<string, string> = { image: 'image', pdf: 'pdf', video: 'video', audio: 'audio' };
  for (const d of docs) {
    const set = new Set<string>();
    for (const e of edges) if (e.slug === d.slug) for (const f of e.from) set.add(kindOf(f) ?? f);
    if (!set.size && CAT_INPUT[d.kind]) set.add(CAT_INPUT[d.kind]);
    if (set.size) inputs.set(d.slug, set);
  }
  // tools that take other files than their category's
  const extra: Record<string, string[]> = {
    'add-audio-to-video': ['video', 'audio'], 'subtitle-generator': ['video', 'audio'], 'add-subtitles-to-video': ['video'],
    'background-remover': ['image'], 'image-upscaler': ['image'], 'object-remover': ['image'], 'photo-colorizer': ['image'],
    'depth-map-generator': ['image'], 'alt-text-generator': ['image'], 'video-background-remover': ['video'],
    'vocal-remover': ['audio', 'video'], 'auto-reframe-video': ['video'], 'audiogram-maker': ['audio'], 'bpm-finder': ['audio'],
    'social-media-image-resizer': ['image'], 'youtube-thumbnail-maker': ['image'], 'screenshot-beautifier': ['image'],
    'qr-code-scanner': ['image'], 'exif-remover': ['image'], 'audio-to-text': ['audio', 'video'],
  };
  for (const [slug, ks] of Object.entries(extra)) if (bySlug.has(slug)) inputs.set(slug, new Set(ks));
  // tools that start from nothing (recorders, metronomes) take any query
  for (const slug of ['screen-recorder', 'webcam-recorder', 'voice-recorder', 'metronome', 'online-tuner', 'invoice-generator', 'collage-maker', 'slideshow-maker']) inputs.delete(slug);
  inputs.set('slideshow-maker', new Set(['image']));
  inputs.set('collage-maker', new Set(['image']));
  const vocab = new Set(docs.flatMap((d) => lexTokens([d.name, d.tagline, d.keywords.join(' '), d.description ?? ''].join(' '), false)));
  return { docs, bySlug, edges, inputs, known: (w) => vocab.has(stem(w)) };
}

/** the kind of file the query is about, when it names exactly one source */
export function sourceKind(e: Entities): Kind | undefined {
  if (e.from) return FORMATS[e.from].kind;
  const target = e.to ? FORMATS[e.to].kind : e.toKind;
  const ks = [...e.nounKinds].filter((k) => k !== target);
  return ks.length === 1 ? ks[0] : undefined;
}

/** false when a tool can't take what the query is about ("crop pdf" → crop-image) */
export function compatible(cat: Catalog, slug: string, e: Entities): boolean {
  const k = sourceKind(e);
  const ins = cat.inputs.get(slug);
  if (!k || !ins) return true;
  // office files and text reach the PDF tools through their converters, not directly
  return ins.has(k);
}

/* ---------- presets ---------- */

const fmtSize = (kb: number) => (kb >= 1000 ? `${Math.round(kb / 100) / 10} MB` : `${kb} KB`);

/** the preset page whose props match exactly, if one exists: compress-pdf + {targetKb: 2000} → compress-pdf-to-2mb */
export function variantFor(cat: Catalog, main: string, props: Record<string, unknown>): string {
  const keys = Object.keys(props);
  if (!keys.length) return main;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const v = cat.docs.find(
    (d) =>
      d.variantOf === main && d.props && keys.every((k) => same(d.props![k], props[k])) &&
      Object.keys(d.props).every((k) => k in props || ['dpi', 'forms', 'unit', 'w', 'h'].includes(k)),
  );
  return v?.slug ?? main;
}

/* ---------- conversions ---------- */

function bestEdge(cat: Catalog, srcs: string[], to: string): { edge: Edge; src: string } | undefined {
  let best: { edge: Edge; src: string; score: number } | undefined;
  for (const edge of cat.edges) {
    if (!edge.to.includes(to)) continue;
    for (const src of srcs) {
      if (src === to || !edge.from.includes(src)) continue;
      // exact formats on both ends beat a kind, and a pair page beats a generic converter
      const score = (isKind(edge.from[0]) || edge.from.length > 1 ? 0 : 2) + (edge.to.length > 1 ? 0 : 1) + (edge.pass ? 0 : 0.5);
      if (!best || score > best.score) best = { edge, src, score };
    }
  }
  return best;
}

function convertStep(cat: Catalog, edge: Edge, src: string, to: string): { slug: string; preset: Preset } {
  let slug = edge.slug;
  const preset: Preset = {};
  if (edge.pass && FORMATS[src]) preset.from = src;
  if (edge.pass === 'fromTo' && FORMATS[to]) preset.to = to;
  if (edge.pass) {
    // a concrete pair page: mov-to-mp4, heic-to-jpg, mp4-to-mp3
    const pair = cat.docs.find(
      (d) => d.variantOf === edge.slug && formatOf(d.props?.from as string) === src && (edge.pass === 'from' || formatOf(d.props?.to as string) === to),
    );
    if (pair) return { slug: pair.slug, preset: {} };
  }
  return { slug, preset };
}

const label = (id: string) => FORMATS[id]?.label ?? id;

/** a direct conversion, a two-step one through a middle format, or an honest "no such conversion" */
function convert(cat: Catalog, e: Entities): { routes: Route[]; chain?: Route[]; note?: string } {
  const to = e.to ?? e.toKind;
  if (!to) return { routes: [] };
  const srcs = e.from ? [e.from] : [...e.nounKinds].filter((k) => k !== to);
  if (!srcs.length) return { routes: [] };
  const name = (slug: string) => cat.bySlug.get(slug)?.name ?? slug;
  const hit = bestEdge(cat, srcs, to);
  if (hit) {
    const { slug, preset } = convertStep(cat, hit.edge, hit.src, to);
    let page = slug;
    // images to PDF take a size limit themselves (and some limits have their own page)
    const sized = !!e.size?.maxKb && to === 'pdf' && kindOf(hit.src) === 'image';
    if (sized) {
      page = variantFor(cat, slug, { targetKb: e.size!.maxKb });
      if (page === slug) preset.target = `${e.size!.maxKb}kb`;
    }
    const why = `${name(slug)}${sized ? ` · under ${fmtSize(e.size!.maxKb!)}` : ''}`;
    if (page !== slug) return { routes: [{ slug: page, preset: {}, why, conf: 0.95, tier: 'exact' }] };
    const exact = !!FORMATS[hit.src] || !!e.to;
    return { routes: [{ slug, preset, why, conf: exact ? 0.95 : 0.85, tier: exact ? 'exact' : 'rule' }] };
  }
  // two hops through any middle format: word → pdf → jpg
  if (e.from && FORMATS[to]) {
    // through a PDF, or a format of the same kind as one end: never png → video → gif
    const mids = ['pdf', 'jpg', 'png', 'mp4', 'mp3'].filter((m) => m === 'pdf' || FORMATS[m].kind === FORMATS[e.from!].kind || FORMATS[m].kind === FORMATS[to].kind);
    for (const mid of mids) {
      if (mid === e.from || mid === to) continue;
      const a = bestEdge(cat, [e.from], mid);
      const b = a && bestEdge(cat, [mid], to);
      if (a && b) {
        const s1 = convertStep(cat, a.edge, e.from, mid);
        const s2 = convertStep(cat, b.edge, mid, to);
        const why = `${label(e.from)} to ${label(to)} in two steps, through ${label(mid)}`;
        const chain: Route[] = [
          { ...s1, why, conf: 0.9, tier: 'exact' },
          { ...s2, why: `then ${name(s2.slug)}`, conf: 0.9, tier: 'exact' },
        ];
        return { routes: chain, chain };
      }
    }
  }
  if (e.from) {
    const note = `No ${label(e.from)} to ${label(to)} converter yet.`;
    // the source kind's own converter is the closest thing, never a confident answer
    const main = { image: 'image-converter', video: 'video-converter', audio: 'audio-converter' }[FORMATS[e.from].kind as string];
    const routes: Route[] = main && kindOf(to) === FORMATS[e.from].kind ? [{ slug: main, preset: { from: e.from }, why: `${name(main)} · other formats`, conf: 0.8, tier: 'rule' }] : [];
    return { routes, note };
  }
  return { routes: [] };
}

/* ---------- the rules ---------- */

function sizeLimit(e: Entities): { kb: number; why: string } | undefined {
  if (e.size?.maxKb) return { kb: e.size.maxKb, why: `under ${fmtSize(e.size.maxKb)}` };
  for (const p of e.platforms) {
    const def = PLATFORMS[p];
    if (def.fileMB) return { kb: def.fileMB * 1000, why: `${def.fileMB} MB for ${def.label}` };
  }
}

export interface Plan {
  entities: Entities;
  routes: Route[];
  chain: Route[];
  note?: string;
}

export function route(cat: Catalog, e: Entities): { routes: Route[]; chain?: Route[]; note?: string } {
  const routes: Route[] = [];
  const name = (slug: string) => cat.bySlug.get(slug)?.name ?? slug;
  const add = (slug: string, preset: Preset = {}, why = '', conf = 0.85, tier: Route['tier'] = conf >= 0.8 ? 'rule' : 'weak') => {
    if (cat.bySlug.has(slug)) routes.push({ slug, preset, why: why || name(slug), conf, tier });
  };
  const A = new Set(e.actions);
  const K = e.kinds;
  const O = e.objects;
  const F = new Set(e.formats.map((f) => f.id));
  const t = e.text;
  const isVideo = K.has('video');
  const isAudio = K.has('audio');
  const isPdf = F.has('pdf') || K.has('pdf');
  const isImage = K.has('image') && !isPdf && !isVideo;
  const P = new Set(e.platforms);

  // exam and passport forms
  const signature = /signature/.test(t);
  if (P.has('exam') || (signature && (e.size?.rangeKb || A.has('resize')))) {
    if (signature) add('signature-resizer', e.size?.rangeKb ? { range: `${e.size.rangeKb[0]}-${e.size.rangeKb[1]}kb` } : {}, 'Signature resizer · form sizes, 10–20 KB', 0.92, 'exact');
    else if (isPdf) add('compress-pdf-for-online-application', {}, '', 0.92, 'exact');
    else add('exam-photo-signature-resizer', {}, 'Exam photo & signature resizer · 20–50 KB', 0.92, 'exact');
  }
  const passport = P.has('passport') && !isPdf;
  if (passport) add('passport-photo-maker', {}, 'Passport photo maker', 0.93, 'exact');

  // platform shapes outrank the generic resizer
  const social = (P.has('instagram') || P.has('facebook') || P.has('linkedin') || P.has('twitter')) && !isVideo && !isPdf && (isImage || /story|post|profile|cover|size|dp|banner/.test(t));
  if (social && !(A.has('split') || /grid/.test(t))) {
    const p = e.platforms.find((x) => ['instagram', 'facebook', 'linkedin', 'twitter'].includes(x))!;
    add('social-media-image-resizer', { platform: p === 'twitter' ? 'x' : p }, `Social media image resizer · ${PLATFORMS[p].label} sizes`, 0.93, 'exact');
  }
  // 9:16 is the reframer's default
  if (P.has('tiktok') && isVideo) add('auto-reframe-video', {}, 'Auto reframe · 9:16 for TikTok', 0.88, 'exact');
  if (P.has('youtube') && /thumbnail/.test(t)) add('youtube-thumbnail-maker', {}, '', 0.93, 'exact');

  // conversions
  let conv: ReturnType<typeof convert> = { routes: [] };
  const adding = /(^| )add( |$)/.test(t);
  if (!adding && (A.has('convert') || e.to || e.toKind || /(^| )(to|into)( |$)/.test(t))) {
    conv = convert(cat, e);
    routes.push(...conv.routes);
  }
  // "video converter", "mp3 converter": a kind's own converter when no target is named
  if (/\bconvert(er)?\b/.test(t) && e.actions.length === 1 && !e.objects.size && !e.to && !e.toKind && !conv.routes.length) {
    const k = sourceKind(e);
    const main = k && ({ image: 'image-converter', video: 'video-converter', audio: 'audio-converter' } as Record<string, string>)[k];
    // no preset: "mp3 converter" may mean from MP3 or to it
    if (main) add(main, {}, '', 0.85);
  }

  // size targets: a number, or a platform's cap
  const lim = sizeLimit(e);
  const wantsSmaller = A.has('compress') || (!!lim && !A.has('increase')) || (isPdf && /(^| )(kb|mb)( |$)/.test(t));
  // "video for whatsapp": its size cap is the usual reason to ask
  const forWhatsapp = P.has('whatsapp') && isVideo && !e.actions.length;
  // "pdf to 2mb" still compresses: the target is the same kind it shrinks
  const sameKindTarget = !e.to || e.to === 'pdf';
  const imagesToPdf = !!e.to && e.to === 'pdf' && ((e.from && FORMATS[e.from].kind === 'image') || (!e.from && e.nounKinds.has('image')));
  if (isPdf && wantsSmaller && sameKindTarget && !imagesToPdf && !(e.from && e.from !== 'pdf' && e.to === 'pdf' && !lim)) {
    const preset: Preset = lim ? { target: `${lim.kb}kb` } : {};
    const slug = variantFor(cat, 'compress-pdf', lim ? { targetKb: lim.kb } : {});
    add(slug, slug === 'compress-pdf' ? preset : {}, `Compress PDF${lim ? ` · ${lim.why}` : ''}`, 0.95, 'exact');
  }
  if (isVideo && (wantsSmaller || forWhatsapp) && !e.to) {
    const mb = lim ? Math.round(lim.kb / 1000) : 0;
    const slug = variantFor(cat, 'video-compressor', mb ? { targetMB: mb } : {});
    const why = lim ? lim.why : P.has('whatsapp') ? 'for WhatsApp: pick a size' : '';
    add(slug, slug === 'video-compressor' && mb ? { target: `${mb}mb` } : {}, `Video compressor${why ? ` · ${why}` : ''}`, 0.95, lim ? 'exact' : 'rule');
  }
  const imageSize = isImage && !e.to && (e.size || A.has('compress') || (A.has('increase') && /kb|size/.test(t)) || e.dims || A.has('resize') || /\bkb\b/.test(t));
  if (imageSize && !passport && !social && !P.has('exam')) {
    let props: Record<string, unknown> = {};
    let preset: Preset = {};
    let why = '';
    if (e.size?.rangeKb) {
      [props, preset, why] = [{ mode: 'target', rangeKb: e.size.rangeKb }, { range: `${e.size.rangeKb[0]}-${e.size.rangeKb[1]}kb` }, `between ${e.size.rangeKb[0]} and ${e.size.rangeKb[1]} KB`];
    } else if (e.size?.minKb) {
      [props, preset, why] = [{ mode: 'increase', targetKb: e.size.minKb }, { min: `${e.size.minKb}kb` }, `at least ${fmtSize(e.size.minKb)}`];
    } else if (lim) {
      [props, preset, why] = [{ mode: 'target', targetKb: lim.kb }, { target: `${lim.kb}kb` }, lim.why];
    } else if (A.has('increase') && /kb|size/.test(t)) {
      [props, why] = [{ mode: 'increase' }, 'make the file bigger in KB'];
    }
    if (e.dims) {
      preset.size = `${e.dims.w}x${e.dims.h}${e.dims.unit === 'px' ? '' : e.dims.unit}`;
      why = `${e.dims.w} × ${e.dims.h} ${e.dims.unit}`;
    }
    if (Object.keys(props).length || e.dims || A.has('resize') || /\bkb\b/.test(t)) {
      const slug = e.dims?.unit === 'cm' ? 'resize-image-in-cm' : variantFor(cat, 'image-resizer', props);
      if (!why && /\bkb\b/.test(t)) why = 'pick a size in KB';
      add(slug, slug === 'image-resizer' ? preset : e.dims && slug === 'resize-image-in-cm' ? preset : {}, `Image resizer${why ? ` · ${why}` : ''}`, e.size || e.dims ? 0.92 : 0.85, e.size || e.dims ? 'exact' : 'rule');
    } else if (A.has('compress')) add('image-compressor', {}, '', 0.85);
  }

  if (lim && !e.size && !isPdf && !isVideo && !isImage && !isAudio && (A.has('compress') || /big|large|heavy/.test(t))) {
    const mail = ['gmail', 'outlook', 'yahoo', 'email', 'exchange'].some((x) => P.has(x));
    const order = mail ? ['compress-pdf', 'video-compressor', 'image-compressor'] : ['video-compressor', 'image-compressor', 'compress-pdf'];
    order.forEach((slug, i) => add(slug, slug === 'image-compressor' ? {} : { target: slug === 'video-compressor' ? `${lim.kb / 1000}mb` : `${lim.kb}kb` }, `${name(slug)} · ${lim.why}`, 0.7 - i * 0.1));
  }
  if (/password/.test(t) && !isPdf) {
    if (/(generat|create|make|new|random)/.test(t)) add('password-generator', {}, '', 0.88);
    else if (/(strong|secure|weak|safe|check|strength|crack)/.test(t)) add('password-strength-checker', {}, '', 0.88);
  }
  if (adding && /(music|audio|sound|song)/.test(t) && isVideo) add('add-audio-to-video', {}, '', 0.88);

  // removals: the more specific object wins
  if (A.has('remove')) {
    if (O.has('password') && isPdf) add('unlock-pdf', {}, '', 0.95);
    else if (O.has('vocals') || ((O.has('sound') || has(t, 'voice')) && /song|music/.test(t))) add('vocal-remover', {}, '', 0.9);
    else if (O.has('noise')) add('audio-noise-reduction', {}, '', 0.9);
    else if (O.has('background') && isVideo) add('video-background-remover', {}, '', 0.9);
    else if ((O.has('people') || O.has('watermark')) && !isVideo && !isPdf) add('object-remover', {}, '', 0.88);
    else if (O.has('background')) add('background-remover', {}, '', 0.9);
    else if (O.has('location')) add('exif-remover', {}, '', 0.9);
    else if (O.has('sound') && isVideo) add('mute-video', {}, '', 0.9);
    else if (O.has('pages') && isPdf) add('delete-pdf-pages', {}, '', 0.85);
  }
  // known gaps get an honest line instead of a near miss
  const gap = A.has('remove') && isVideo && (O.has('watermark') || O.has('people')) ? 'No tool removes watermarks or objects from video yet.' : undefined;
  if (O.has('vocals') && !A.has('remove')) add('vocal-remover', {}, '', 0.85);
  if (O.has('noise') && (isAudio || isVideo) && !A.has('remove')) add('audio-noise-reduction', {}, '', 0.8);
  if (O.has('background') && /transparent/.test(t)) add('background-remover', {}, '', 0.88);
  if ((A.has('extract') || /audio from|audio out/.test(t)) && isVideo && (O.has('sound') || isAudio)) add('video-to-mp3', {}, 'Extract audio from video', 0.9);
  if (A.has('upscale') && (isImage || (!isVideo && !isPdf && !isAudio)) && !A.has('remove')) add('image-upscaler', {}, '', isImage ? 0.85 : 0.6);
  if (A.has('increase') && isImage && !e.size && !A.has('upscale') && !/kb|size/.test(t)) add('image-upscaler', {}, '', 0.6);
  if (A.has('merge')) add(isPdf ? 'merge-pdf' : isVideo ? 'merge-videos' : isAudio ? 'audio-joiner' : isImage ? 'collage-maker' : 'merge-pdf', {}, '', isPdf || isVideo || isAudio ? 0.9 : isImage ? 0.8 : 0.5);
  if (A.has('split') && isPdf) add('split-pdf', {}, '', 0.9);
  if (A.has('split') && isImage && P.has('instagram')) add('instagram-grid-maker', {}, '', 0.92, 'exact');
  if (A.has('trim')) {
    // "cut the first 10 seconds" drops the start, "trim to 30 seconds" keeps the first 30; anything else gets no preset
    const d = e.durationS;
    const unit = '(s|secs?|seconds?|mins?|minutes?)';
    const preset: Preset = !d
      ? {}
      : /\bfirst \d/.test(t)
        ? { start: d }
        : new RegExp(`\\b(to|into|under|down to) \\d+ ?${unit}\\b|\\d+ ?${unit} (clip|long)\\b`).test(t)
          ? { end: d }
          : {};
    const why = preset.start ? ` · cut the first ${d} s` : preset.end ? ` · keep the first ${d} s` : '';
    if (isVideo) add('trim-video', preset, `Trim video${why}`, 0.9);
    else if (isAudio) add('audio-cutter', preset, `Audio cutter${why}`, 0.9);
  }
  if (A.has('rotate')) add(isVideo ? 'rotate-video' : isPdf ? 'rotate-pdf' : 'rotate-image', {}, '', isVideo || isPdf || isImage ? 0.85 : 0.6);
  if (A.has('crop') && (isVideo || isImage)) add(isVideo ? 'crop-video' : 'crop-image', {}, '', 0.85);
  if (A.has('protect') && isPdf) add('protect-pdf', {}, '', 0.9);
  if (A.has('unlock') && isPdf) add('unlock-pdf', {}, '', 0.9);
  if (A.has('sign') && (isPdf || /contract|document/.test(t)) && !/resize|kb/.test(t)) add('sign-pdf', {}, '', 0.85);
  if (A.has('number') && isPdf) add('add-page-numbers-to-pdf', {}, '', 0.85);
  if (A.has('searchable') && isPdf) add('ocr-pdf', {}, '', 0.9);
  if (A.has('watermark') && !A.has('remove')) add(isPdf ? 'watermark-pdf' : isImage ? 'watermark-image' : 'watermark-pdf', {}, '', isPdf || isImage ? 0.85 : 0.5);
  if (A.has('edit') && isPdf && !A.has('watermark')) add(/(^| )form( |$)/.test(t) ? 'fill-pdf-form' : 'edit-pdf', {}, '', 0.8);
  if (A.has('transcribe') && (isVideo || isAudio || /lecture|meeting/.test(t))) add('audio-to-text', {}, '', 0.85);
  if (A.has('louder') && (isAudio || isVideo)) add('volume-booster', {}, '', 0.85);
  if (A.has('slower') || A.has('faster')) add(isVideo ? 'video-speed-changer' : 'audio-speed-changer', {}, '', isVideo || isAudio ? 0.85 : 0.5);
  if (A.has('colorize') && isImage && /black and white|old|colou?ri[sz]e|b w/.test(t)) add('photo-colorizer', {}, '', 0.85);
  if (A.has('blur') || ((A.has('remove') || /hide/.test(t)) && O.has('faces'))) add(isVideo ? 'blur-image' : 'blur-image', {}, '', isVideo ? 0.5 : 0.85);
  if (A.has('record') && /screen/.test(t)) add('screen-recorder', {}, '', 0.88);
  if (/ringtone/.test(t)) add('ringtone-maker', {}, '', 0.92, 'exact');
  if (/(read|say|speak)\b.*\b(aloud|out loud)|text to (speech|voice|audio|mp3)|\btts\b/.test(t)) add('text-to-speech', {}, '', 0.9);
  const pctOf = /%\s*of\s*(\d+(?:\.\d+)?)/.exec(t);
  if (e.percent != null && /\bof\b/.test(t)) add('percentage-calculator', pctOf ? { p: e.percent, of: +pctOf[1] } : {}, pctOf ? `${e.percent}% of ${pctOf[1]}` : '', 0.9, 'exact');
  if (e.unitConv) {
    const { value, from, to, fromWord, toWord } = e.unitConv;
    const v = cat.docs.find((d) => d.variantOf === 'unit-converter' && d.props?.from === from && d.props?.to === to);
    const preset: Preset = value != null ? { value } : {};
    if (!v) Object.assign(preset, { from, to });
    add(v?.slug ?? 'unit-converter', preset, value != null ? `${value} ${fromWord} → ${toWord}` : `${fromWord} → ${toWord}`, 0.95, 'exact');
  }

  // dedupe: best confidence, then the richer preset
  const seen = new Map<string, Route>();
  for (const r of routes) {
    const prev = seen.get(r.slug);
    if (!prev || r.conf > prev.conf || (r.conf === prev.conf && Object.keys(r.preset).length > Object.keys(prev.preset).length)) seen.set(r.slug, r);
  }
  return { routes: [...seen.values()].sort((a, b) => b.conf - a.conf), chain: conv.chain, note: conv.note ?? gap };
}

/* ---------- chains ---------- */

// where a tool sits in a sensible pipeline: gather → cut → convert → edit → shrink → lock
const STAGE: [RegExp, number][] = [
  [/^(screen-recorder|webcam-recorder|voice-recorder)/, 0],
  [/^(merge-|audio-joiner|jpg-to-pdf|heic-to-pdf|png-to-pdf)/, 1],
  [/^(trim-video|audio-cutter|crop-|rotate-|organize-pdf|delete-pdf-pages|split-pdf)/, 2],
  [/(-to-|converter|ocr-pdf|video-to-mp3)/, 3],
  [/^(add-page-numbers|sign-pdf|watermark-|edit-pdf|redact-pdf|text-summarizer|translator)/, 4],
  [/(compress|image-resizer)/, 5],
  [/^(protect-pdf|file-encryptor|zip-files)/, 6],
];
const stageOf = (slug: string) => STAGE.find(([re]) => re.test(slug))?.[1] ?? 3;

/** routes, plus an ordered chain when the request names several confident steps */
export function plan(cat: Catalog, q: string): Plan {
  const entities = parse(q, cat.known);
  const r = route(cat, entities);
  let chain = r.chain ?? [];
  if (!chain.length) {
    const strong = r.routes.filter((x) => x.conf >= 0.8);
    // two routes for the same job (a preset page and its main tool) aren't two steps
    const distinct = strong.filter((x, i) => !strong.slice(0, i).some((y) => sameJob(cat, x.slug, y.slug)));
    if (distinct.length >= 2 && entities.actions.length >= 2) chain = [...distinct].sort((a, b) => stageOf(a.slug) - stageOf(b.slug));
  }
  return { entities, routes: r.routes, chain, note: r.note };
}

const mainOf = (cat: Catalog, slug: string) => cat.bySlug.get(slug)?.variantOf ?? slug;
const sameJob = (cat: Catalog, a: string, b: string) => mainOf(cat, a) === mainOf(cat, b);
