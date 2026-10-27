import { decodePDFRawStream, PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFContext, type PDFDocument, type PDFObject } from 'pdf-lib';
import { encodePng, PNG_GRAY, PNG_GRAY_ALPHA, PNG_INDEXED, PNG_RGB, PNG_RGBA } from './png';
import { ensureLength, inflate, resizePlane, unpack, unpredict } from './pixels';

/** One distinct image in the PDF */
export interface FoundImage {
  id: string;
  /** 0-based pages it appears on, ascending */
  pages: number[];
  width: number;
  height: number;
  /** the file to save: the original JPEG bytes, or a PNG rebuilt from the pixels. null = not decodable here */
  file: { bytes: Uint8Array; ext: 'jpg' | 'png' } | null;
  /** "RGB", "Gray", "CMYK", "Indexed"… */
  color: string;
  /** how the PDF stores it: "JPEG", "Flate", "JPEG 2000", "JBIG2"… */
  encoding: string;
  /** a caveat worth showing */
  note?: string;
}

export interface ImageRef {
  id: string;
  stream: PDFRawStream;
  pages: number[];
}

const name = (s: string) => PDFName.of(s);
const at = (dict: PDFDict, key: string) => dict.lookup(name(key));
const num = (dict: PDFDict, key: string, fallback = 0) => {
  const v = at(dict, key);
  return v instanceof PDFNumber ? v.asNumber() : fallback;
};

/**
 * Every image XObject drawn from each page: page resources, form XObjects
 * nested inside them, and annotation appearances (stamps, signatures).
 * Stencil masks (ImageMask) are shapes, not pictures, so they're left out.
 */
export function findImages(doc: PDFDocument): ImageRef[] {
  const found = new Map<string, ImageRef>();
  doc.getPages().forEach((page, index) => {
    const visited = new Set<string>();
    const walk = (resources: PDFObject | undefined) => {
      const xobjects = resources instanceof PDFDict ? at(resources, 'XObject') : undefined;
      if (!(xobjects instanceof PDFDict)) return;
      for (const [, value] of xobjects.entries()) {
        if (!(value instanceof PDFRef) || visited.has(value.toString())) continue;
        visited.add(value.toString());
        const stream = doc.context.lookup(value);
        if (!(stream instanceof PDFRawStream)) continue;
        const subtype = at(stream.dict, 'Subtype');
        if (subtype === name('Image') && at(stream.dict, 'ImageMask') !== PDFBool.True) {
          const ref = found.get(value.toString()) ?? { id: value.toString(), stream, pages: [] };
          if (ref.pages.at(-1) !== index) ref.pages.push(index);
          found.set(ref.id, ref);
        } else if (subtype === name('Form')) walk(at(stream.dict, 'Resources'));
      }
    };
    // read leniently: one malformed page shouldn't hide the images on the others
    try {
      walk(page.node.Resources());
      const annots = at(page.node, 'Annots');
      for (const a of annots instanceof PDFArray ? annots.asArray() : []) {
        const annot = doc.context.lookup(a);
        const ap = annot instanceof PDFDict ? at(annot, 'AP') : undefined;
        const normal = ap instanceof PDFDict ? at(ap, 'N') : undefined;
        // N is one appearance stream, or a dict of them by state (e.g. checked/unchecked)
        const streams = normal instanceof PDFRawStream ? [normal] : normal instanceof PDFDict ? normal.entries().map(([k]) => normal.lookup(k)) : [];
        for (const s of streams) if (s instanceof PDFRawStream) walk(at(s.dict, 'Resources'));
      }
    } catch (e) {
      console.warn(`Page ${index + 1}:`, e);
    }
  });
  return [...found.values()];
}

async function sha1(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Merges images stored more than once with identical data (common in merged PDFs) */
export async function dedupe(refs: ImageRef[]): Promise<ImageRef[]> {
  const byContent = new Map<string, ImageRef>();
  for (const ref of refs) {
    const { dict, contents } = ref.stream;
    let key: string;
    try {
      const mask = at(dict, 'SMask') ?? at(dict, 'Mask');
      const space = colorSpace(at(dict, 'ColorSpace'), dict.context);
      const parts = [
        num(dict, 'Width'),
        num(dict, 'Height'),
        num(dict, 'BitsPerComponent'),
        String(at(dict, 'Filter') ?? ''),
        String(at(dict, 'Decode') ?? ''),
        // the palette too: same indices with different colors are different pictures
        space.label + (space.lookup ? await sha1(space.lookup) : ''),
        await sha1(contents),
        mask instanceof PDFRawStream ? await sha1(mask.contents) : String(mask ?? ''),
      ];
      key = parts.join('|');
    } catch {
      // a malformed image is kept as its own entry rather than failing the whole scan
      key = ref.id;
    }
    const first = byContent.get(key);
    if (first) first.pages = [...new Set([...first.pages, ...ref.pages])].sort((a, b) => a - b);
    else byContent.set(key, ref);
  }
  return [...byContent.values()];
}

/* ---------------- decoding ---------------- */

const FILTER_NAMES: Record<string, string> = { AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', Fl: 'FlateDecode', RL: 'RunLengthDecode', DCT: 'DCTDecode', CCF: 'CCITTFaxDecode' };
/** image codecs: always the last filter, and their data is the image file itself */
const CODECS: Record<string, string> = { DCTDecode: 'JPEG', JPXDecode: 'JPEG 2000', JBIG2Decode: 'JBIG2', CCITTFaxDecode: 'CCITT fax' };

function filtersOf(dict: PDFDict): { filter: string; parms?: PDFDict }[] {
  const f = at(dict, 'Filter');
  const p = at(dict, 'DecodeParms') ?? at(dict, 'DP');
  const names = f instanceof PDFName ? [f] : f instanceof PDFArray ? f.asArray().map((x) => dict.context.lookup(x)) : [];
  return names.map((n, i) => {
    const raw = n instanceof PDFName ? n.decodeText() : '';
    const parms = p instanceof PDFArray ? p.lookup(i) : p;
    return { filter: FILTER_NAMES[raw] ?? raw, parms: parms instanceof PDFDict ? parms : undefined };
  });
}

/** Undoes the stream's general-purpose filters; stops before an image codec and names it */
function decodeStream(stream: PDFRawStream): { data: Uint8Array; codec?: string } {
  const filters = filtersOf(stream.dict);
  let data = stream.contents;
  for (const [i, { filter, parms }] of filters.entries()) {
    if (filter in CODECS) {
      if (i !== filters.length - 1) throw new Error(`${filter} isn't the last filter`);
      return { data, codec: filter };
    }
    if (filter === 'FlateDecode') data = inflate(data);
    else if (['LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode'].includes(filter)) {
      const dict = stream.dict.context.obj({ Filter: filter });
      if (parms) dict.set(name('DecodeParms'), parms);
      data = decodePDFRawStream(PDFRawStream.of(dict, data)).decode();
    } else throw new Error(`Unknown filter ${filter}`);
    if (parms && (filter === 'FlateDecode' || filter === 'LZWDecode')) {
      data = unpredict(data, { predictor: num(parms, 'Predictor', 1), colors: num(parms, 'Colors', 1), bpc: num(parms, 'BitsPerComponent', 8), columns: num(parms, 'Columns', 1) });
    }
  }
  return { data };
}

interface Space {
  kind: 'gray' | 'rgb' | 'cmyk' | 'indexed' | 'other';
  label: string;
  base?: Space;
  hival?: number;
  lookup?: Uint8Array;
}

function colorSpace(obj: PDFObject | undefined, context: PDFContext, depth = 0): Space {
  const cs = obj instanceof PDFRef ? context.lookup(obj) : obj;
  const head = cs instanceof PDFArray ? context.lookup(cs.get(0)) : cs;
  const id = head instanceof PDFName ? head.decodeText() : '';
  if (['DeviceGray', 'G', 'CalGray'].includes(id)) return { kind: 'gray', label: 'Gray' };
  if (['DeviceRGB', 'RGB', 'CalRGB'].includes(id)) return { kind: 'rgb', label: 'RGB' };
  if (['DeviceCMYK', 'CMYK'].includes(id)) return { kind: 'cmyk', label: 'CMYK' };
  if (!(cs instanceof PDFArray)) return { kind: 'other', label: id || 'Unknown' };
  if (id === 'ICCBased') {
    const profile = cs.lookup(1);
    const n = profile instanceof PDFRawStream ? num(profile.dict, 'N') : 0;
    return n === 1 ? { kind: 'gray', label: 'Gray' } : n === 3 ? { kind: 'rgb', label: 'RGB' } : n === 4 ? { kind: 'cmyk', label: 'CMYK' } : { kind: 'other', label: 'ICC' };
  }
  if ((id === 'Indexed' || id === 'I') && depth === 0) {
    const base = colorSpace(cs.get(1), context, 1);
    const hival = cs.lookup(2);
    const table = cs.lookup(3);
    let lookup: Uint8Array | undefined;
    try {
      lookup = table instanceof PDFString || table instanceof PDFHexString ? table.asBytes() : table instanceof PDFRawStream ? decodeStream(table).data : undefined;
    } catch {
      // unreadable palette: palette() then throws and pdf.js gets to try
    }
    return { kind: 'indexed', label: 'Indexed', base, hival: hival instanceof PDFNumber ? hival.asNumber() : 255, lookup };
  }
  return { kind: 'other', label: { Separation: 'Spot color', DeviceN: 'DeviceN', Lab: 'Lab' }[id] ?? (id || 'Unknown') };
}

/** RGB palette for PNG, padded to every index the bit depth can hold */
function palette(space: Space, bpc: number): Uint8Array {
  const { base, lookup } = space;
  if (!lookup || (base?.kind !== 'rgb' && base?.kind !== 'gray')) throw new Error(`Indexed ${base?.label} palette`);
  const entries = 1 << bpc;
  const out = new Uint8Array(entries * 3);
  const count = Math.min(entries, (space.hival ?? 255) + 1);
  for (let i = 0; i < count; i++) {
    if (base.kind === 'rgb') out.set(lookup.subarray(i * 3, i * 3 + 3), i * 3);
    else out.fill(lookup[i] ?? 0, i * 3, i * 3 + 3);
  }
  return out;
}

/** 0 = transparent … 255 = opaque, one byte per pixel at the image's size */
function alphaPlane(dict: PDFDict, width: number, height: number): Uint8Array | undefined {
  const smask = at(dict, 'SMask');
  const mask = at(dict, 'Mask');
  const stream = smask instanceof PDFRawStream ? smask : mask instanceof PDFRawStream ? mask : undefined;
  if (!stream) {
    if (mask instanceof PDFArray) throw new Error('Color-key mask');
    return undefined;
  }
  const { data, codec } = decodeStream(stream);
  if (codec) throw new Error(`${codec} mask`);
  const sw = num(stream.dict, 'Width');
  const sh = num(stream.dict, 'Height');
  const bpc = stream === mask ? 1 : num(stream.dict, 'BitsPerComponent', 8);
  const plane = unpack(ensureLength(data, Math.ceil((sw * bpc) / 8) * sh), sw, sh, 1, bpc);
  const decode = at(stream.dict, 'Decode');
  const flipped = decode instanceof PDFArray && decode.lookup(0) instanceof PDFNumber && (decode.lookup(0) as PDFNumber).asNumber() === 1;
  // a soft mask is alpha as-is; a stencil Mask paints where its bit is 0
  if (flipped === (stream === smask)) for (let i = 0; i < plane.length; i++) plane[i] = 255 - plane[i];
  return resizePlane(plane, sw, sh, width, height);
}

/** Decode arrays: the default maps samples as-is, the reversed one inverts them; anything else needs pdf.js */
function decodeMode(dict: PDFDict, comps: number): 'none' | 'invert' {
  const d = at(dict, 'Decode');
  if (!(d instanceof PDFArray)) return 'none';
  const v = d.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN));
  if (v.length === comps * 2 && v.every((x, i) => x === (i % 2 ? 1 : 0))) return 'none';
  if (v.length === comps * 2 && v.every((x, i) => x === (i % 2 ? 0 : 1))) return 'invert';
  throw new Error('Custom Decode array');
}

function toPng(stream: PDFRawStream, raw: Uint8Array, space: Space): Uint8Array {
  const { dict } = stream;
  const width = num(dict, 'Width');
  const height = num(dict, 'Height');
  const bpc = num(dict, 'BitsPerComponent', 8);
  if (width < 1 || height < 1) throw new Error('No image size');
  if (space.kind !== 'gray' && space.kind !== 'rgb' && space.kind !== 'indexed') throw new Error(`${space.label} color`);
  if (![1, 2, 4, 8, 16].includes(bpc) || (space.kind === 'indexed' && bpc > 8)) throw new Error(`${bpc}-bit samples`);
  const comps = space.kind === 'rgb' ? 3 : 1;
  const size = Math.ceil((width * comps * bpc) / 8) * height;
  let data = ensureLength(raw, size).subarray(0, size);
  if (space.kind !== 'indexed' && decodeMode(dict, comps) === 'invert') data = data.map((b) => b ^ 0xff);
  else if (space.kind === 'indexed' && at(dict, 'Decode')) throw new Error('Indexed Decode array');
  const alpha = alphaPlane(dict, width, height);

  if (!alpha) {
    if (space.kind === 'gray') return encodePng({ width, height, colorType: PNG_GRAY, depth: bpc, data });
    if (space.kind === 'indexed') return encodePng({ width, height, colorType: PNG_INDEXED, depth: bpc, data, palette: palette(space, bpc) });
    if (bpc >= 8) return encodePng({ width, height, colorType: PNG_RGB, depth: bpc, data });
    return encodePng({ width, height, colorType: PNG_RGB, depth: 8, data: unpack(data, width, height, 3, bpc) });
  }
  const samples = unpack(data, width, height, comps, bpc, space.kind !== 'indexed');
  const pixels = width * height;
  if (space.kind === 'gray') {
    const out = new Uint8Array(pixels * 2);
    for (let i = 0; i < pixels; i++) {
      out[i * 2] = samples[i];
      out[i * 2 + 1] = alpha[i];
    }
    return encodePng({ width, height, colorType: PNG_GRAY_ALPHA, depth: 8, data: out });
  }
  const pal = space.kind === 'indexed' ? palette(space, bpc) : undefined;
  const out = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    if (pal) out.set(pal.subarray(samples[i] * 3, samples[i] * 3 + 3), i * 4);
    else out.set(samples.subarray(i * 3, i * 3 + 3), i * 4);
    out[i * 4 + 3] = alpha[i];
  }
  return encodePng({ width, height, colorType: PNG_RGBA, depth: 8, data: out });
}

/**
 * Turns an image into a file: JPEGs come out byte for byte as stored, Flate/LZW
 * images in gray, RGB or a palette are rebuilt as PNG (with their soft mask as
 * alpha). Everything else (JPEG 2000, JBIG2, CMYK…) gets file: null, for pdf.js to draw.
 */
export function convert(ref: ImageRef): FoundImage {
  const { dict } = ref.stream;
  let space: Space;
  try {
    space = colorSpace(at(dict, 'ColorSpace'), dict.context);
  } catch {
    space = { kind: 'other', label: 'Unknown' };
  }
  const filters = filtersOf(dict);
  const last = filters.at(-1)?.filter ?? '';
  const image: FoundImage = {
    id: ref.id,
    pages: ref.pages,
    width: num(dict, 'Width'),
    height: num(dict, 'Height'),
    file: null,
    color: space.kind === 'other' && last === 'JPXDecode' ? 'Color' : space.label,
    encoding: CODECS[last] ?? (last === 'FlateDecode' ? 'Flate' : last ? last.replace(/Decode$/, '') : 'Uncompressed'),
  };
  try {
    const { data, codec } = decodeStream(ref.stream);
    if (codec === 'DCTDecode') {
      // copied so the bytes can be handed to another thread without detaching the whole PDF
      image.file = { bytes: data.slice(), ext: 'jpg' };
      if (at(dict, 'SMask') instanceof PDFRawStream || at(dict, 'Mask')) image.note = "transparency isn't part of the JPEG";
    } else if (!codec) {
      image.file = { bytes: toPng(ref.stream, data, space), ext: 'png' };
    }
  } catch (e) {
    console.warn(`Image ${ref.id}:`, (e as Error).message);
  }
  return image;
}
