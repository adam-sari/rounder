import { unzlibSync, inflateSync, zlibSync } from 'fflate';
import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';
import { grayPlane, grayscale, isFlatGraphic, jpegInfo, targetSize, toRgba, unpredictPng, type Pixels } from './pixels';
import type { ImageOptions } from './settings';
import type { ImageSample } from './target';

/** the pixel work, which needs a browser (or a fake in tests) */
export interface Codec {
  /** decodes a JPEG straight to width × height RGBA */
  jpeg(bytes: Uint8Array, width: number, height: number): Promise<Pixels>;
  resize(px: Pixels, width: number, height: number): Promise<Pixels>;
  /** RGB JPEG at this quality */
  encode(px: Pixels, quality: number): Promise<Uint8Array>;
}

export interface ImageStats {
  /** image XObjects in the file */
  found: number;
  replaced: number;
  /** image stream bytes before and after, for the replaced ones */
  before: number;
  after: number;
}

const N = (s: string) => PDFName.of(s);
// smaller streams aren't worth a decode/encode round trip
const MIN_BYTES = 10_000;

const asDict = (o: PDFObject | undefined) => (o instanceof PDFDict ? o : o instanceof PDFStream ? o.dict : undefined);
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined);

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  kind: 'jpeg' | 'flate';
  width: number;
  height: number;
  components: 1 | 3;
  /** PNG predictor in use (flate only) */
  png: boolean;
}

/** gray or RGB only: CMYK, Lab, indexed, separations and the rest are left alone */
function components(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const o = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (o === N('DeviceRGB')) return 3;
  if (o === N('DeviceGray')) return 1;
  if (o instanceof PDFArray && o.size() >= 2) {
    const family = o.lookup(0);
    if (family === N('CalRGB')) return 3;
    if (family === N('CalGray')) return 1;
    if (family === N('ICCBased')) {
      const n = num(asDict(o.lookup(1))?.lookup(N('N')));
      return n === 3 ? 3 : n === 1 ? 1 : null;
    }
  }
  return null;
}

function single(o: PDFObject | undefined): PDFObject | undefined {
  return o instanceof PDFArray ? (o.size() === 1 ? o.lookup(0) : undefined) : o;
}

function candidate(doc: PDFDocument, ref: PDFRef, stream: PDFRawStream, masks: Set<PDFRef>, grayscale: boolean): Candidate | null {
  const d = stream.dict;
  if (masks.has(ref)) return null;
  // masks, decode arrays and alternates change how samples are read: not worth the risk
  if (d.lookup(N('ImageMask')) instanceof PDFBool && (d.lookup(N('ImageMask')) as PDFBool).asBoolean()) return null;
  if (d.has(N('Mask')) || d.has(N('Decode')) || d.has(N('Alternates'))) return null;
  // a soft mask with /Matte must stay exactly the image's size
  if (asDict(d.lookup(N('SMask')))?.has(N('Matte'))) return null;
  if (num(d.lookup(N('BitsPerComponent'))) !== 8) return null;
  const width = num(d.lookup(N('Width')));
  const height = num(d.lookup(N('Height')));
  const comps = components(doc, d.get(N('ColorSpace')));
  if (!width || !height || !comps) return null;
  // grayscale has to reach small color images too
  if (stream.contents.length < (grayscale && comps === 3 ? 0 : MIN_BYTES)) return null;

  const filter = single(d.lookup(N('Filter')));
  const parms = asDict(single(d.lookup(N('DecodeParms'))));
  if (filter === N('DCTDecode')) {
    if (parms) return null; // e.g. /ColorTransform overrides
    const info = jpegInfo(stream.contents);
    if (!info || info.frame > 2 || info.precision !== 8 || info.components !== comps || info.width !== width || info.height !== height) return null;
    return { ref, stream, kind: 'jpeg', width, height, components: comps, png: false };
  }
  if (filter === N('FlateDecode')) {
    const predictor = num(parms?.lookup(N('Predictor'))) ?? 1;
    const png = predictor >= 10;
    if (predictor !== 1 && !png) return null; // TIFF predictor
    if (png && ((num(parms?.lookup(N('Colors'))) ?? 1) !== comps || (num(parms?.lookup(N('BitsPerComponent'))) ?? 8) !== 8 || (num(parms?.lookup(N('Columns'))) ?? 1) !== width)) return null;
    return { ref, stream, kind: 'flate', width, height, components: comps, png };
  }
  return null;
}

/**
 * How large (in points, longest side) each image could be drawn: the largest
 * page whose resources reach it, directly or through form XObjects.
 */
function drawnSizes(doc: PDFDocument) {
  const images = new Map<PDFRef, number>();
  const forms = new Map<PDFRef, number>();
  const walk = (res: PDFDict | undefined, side: number) => {
    const xobjects = asDict(res?.lookup(N('XObject')));
    if (!xobjects) return;
    for (const [, v] of xobjects.entries()) {
      if (!(v instanceof PDFRef)) continue;
      const x = doc.context.lookup(v);
      if (!(x instanceof PDFStream)) continue;
      const sub = x.dict.lookup(N('Subtype'));
      if (sub === N('Image')) images.set(v, Math.max(images.get(v) ?? 0, side));
      else if (sub === N('Form') && (forms.get(v) ?? 0) < side) {
        forms.set(v, side);
        walk(asDict(x.dict.lookup(N('Resources'))), side);
      }
    }
  };
  let largest = 0;
  for (const page of doc.getPages()) {
    // a page that can't be measured (no MediaBox) keeps its images at full size
    let side = Infinity;
    try {
      const { width, height } = page.getSize();
      side = Math.max(Math.abs(width), Math.abs(height)) * (num(page.node.lookup(N('UserUnit'))) ?? 1);
    } catch {}
    largest = Math.max(largest, side);
    try {
      walk(asDict(page.node.Resources()), side);
    } catch {}
  }
  // images only reachable some other way (patterns, annotations) get the largest page
  return { images, fallback: largest || 842 };
}

function inflate(data: Uint8Array) {
  try {
    return unzlibSync(data);
  } catch {
    return inflateSync(data); // some writers leave out the zlib header
  }
}

async function shrink(c: Candidate, o: ImageOptions, maxSidePt: number, codec: Codec): Promise<{ bytes: Uint8Array; width: number; height: number; gray?: true } | null> {
  const size = targetSize(c.width, c.height, maxSidePt, o.dpi);
  const recolor = o.grayscale && c.components === 3;
  // a same-size JPEG re-encode has to earn its generation loss
  if (c.kind === 'jpeg' && !size && !recolor && o.quality >= 90) return null;
  const { width, height } = size ?? c;
  let px: Pixels;
  if (c.kind === 'jpeg') {
    px = await codec.jpeg(c.stream.contents, width, height);
  } else {
    let samples: Uint8Array | null = inflate(c.stream.contents);
    const rowBytes = c.width * c.components;
    if (c.png) samples = unpredictPng(samples, rowBytes, c.components);
    if (!samples || samples.length < rowBytes * c.height) return null;
    px = toRgba(samples, c.width, c.height, c.components);
    if (isFlatGraphic(px, c.components)) {
      // stays lossless: grayscale only drops the color
      if (!recolor) return null;
      return { bytes: zlibSync(grayPlane(px), { level: 9 }), width: c.width, height: c.height, gray: true };
    }
    if (size) px = await codec.resize(px, width, height);
  }
  if (recolor) grayscale(px);
  const bytes = await codec.encode(px, o.quality);
  const old = c.stream.contents.length;
  if (!recolor && bytes.length >= old * (size ? 1 : 0.9)) return null;
  return { bytes, width, height };
}

/** the file's images, the ones worth recompressing, and how large each can be drawn */
function collect(doc: PDFDocument, grayscale: boolean) {
  const images: [PDFRef, PDFRawStream][] = [];
  const masks = new Set<PDFRef>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.lookup(N('Subtype')) !== N('Image')) continue;
    images.push([ref, obj]);
    for (const key of ['SMask', 'Mask']) {
      const m = obj.dict.get(N(key));
      if (m instanceof PDFRef) masks.add(m);
    }
  }
  const work = images.map(([ref, s]) => candidate(doc, ref, s, masks, grayscale)).filter((c) => c !== null);
  const { images: sizes, fallback } = drawnSizes(doc);
  return { found: images.length, work, side: (c: Candidate) => sizes.get(c.ref) ?? fallback };
}

/**
 * Tries each setting on a few of the file's images (the biggest plus an even spread of the rest) without changing
 * the document, so a target-size search can estimate before it commits to a full pass.
 */
export async function sampleImages(doc: PDFDocument, settings: ImageOptions[], codec: Codec, max = 3, onprogress?: (done: number, total: number) => void): Promise<ImageSample> {
  const { found, work, side } = collect(doc, settings[0]?.grayscale ?? false);
  const bySize = [...work].sort((a, b) => b.stream.contents.length - a.stream.contents.length);
  const picks = bySize.length <= max ? bySize : [...new Set(Array.from({ length: max }, (_, k) => bySize[Math.round((k * (bySize.length - 1)) / (max - 1))]))];
  const total = picks.length * settings.length;
  let done = 0;
  onprogress?.(0, total);
  const samples: ImageSample['samples'] = [];
  let unreadable = 0;
  for (const c of picks) {
    const before = c.stream.contents.length;
    const after: number[] = [];
    let failed = 0;
    for (const o of settings) {
      const out = await shrink(c, o, side(c), codec).catch(() => (failed++, null));
      after.push(out ? out.bytes.length : before);
      onprogress?.(++done, total);
    }
    if (failed) unreadable++;
    samples.push({ before, after });
  }
  return { found, candidates: work.length, candidateBytes: work.reduce((s, c) => s + c.stream.contents.length, 0), samples, unreadable };
}

/**
 * Downscales and re-encodes the photos in a PDF as JPEG, in place. Only replaces
 * an image when the new one is smaller (or when converting to grayscale);
 * anything unusual is left exactly as it was.
 */
export async function optimizeImages(doc: PDFDocument, o: ImageOptions, codec: Codec, onprogress?: (done: number, total: number) => void): Promise<ImageStats> {
  const { found, work, side } = collect(doc, o.grayscale);
  const stats: ImageStats = { found, replaced: 0, before: 0, after: 0 };

  let next = 0;
  let done = 0;
  onprogress?.(0, work.length);
  // two at a time: decoded photos are big, and the encoder pool does the heavy part
  const lane = async () => {
    for (let c = work[next++]; c; c = work[next++]) {
      try {
        const out = await shrink(c, o, side(c), codec);
        if (out) {
          const dict = c.stream.dict.clone(doc.context);
          dict.set(N('Width'), PDFNumber.of(out.width));
          dict.set(N('Height'), PDFNumber.of(out.height));
          dict.set(N('Filter'), N(out.gray ? 'FlateDecode' : 'DCTDecode'));
          dict.delete(N('DecodeParms'));
          dict.delete(N('Length'));
          // the JPEG encoder writes RGB, so gray sources become RGB (gray chroma costs next to nothing)
          if (out.gray) dict.set(N('ColorSpace'), N('DeviceGray'));
          else if (c.components === 1) dict.set(N('ColorSpace'), N('DeviceRGB'));
          doc.context.assign(c.ref, PDFRawStream.of(dict, out.bytes));
          stats.replaced++;
          stats.before += c.stream.contents.length;
          stats.after += out.bytes.length;
        }
      } catch (e) {
        // one image the browser can't decode shouldn't sink the file
        console.warn('compress-pdf: skipped an image', e);
      }
      onprogress?.(++done, work.length);
    }
  };
  await Promise.all([lane(), lane()]);
  return stats;
}
