// Deep-link presets: a tool page opens ready to go from its address hash, e.g. /compress-pdf#target=150kb,
// /image-resizer#range=20-50kb, /trim-video#start=10. Only the hash, so no new URLs get crawled, and never the search
// text itself. Each island allowlists the keys it understands; values are parsed, clamped and checked against enums,
// and anything else is dropped. The search box writes these links; ToolHost reads them.

type Props = Record<string, unknown>;

/** "#target=150kb&from=heic" (or the older bare "#150kb") → { target: '150kb', from: 'heic' } */
export function parseHash(hash: string): Record<string, string> {
  let text: string;
  try {
    text = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return {};
  }
  if (/^\d+(\.\d+)?\s*(kb|mb)$/i.test(text.trim())) return { target: text.trim() };
  const out: Record<string, string> = {};
  for (const part of text.split('&').slice(0, 8)) {
    const m = /^([a-z]{1,8})=([\w.:-]{1,24})$/i.exec(part.trim());
    if (m) out[m[1].toLowerCase()] = m[2].toLowerCase();
  }
  return out;
}

/** "150kb" / "2mb" → KB (1 MB = 1000 KB, as the exact-size tools count), within 1 KB … 2 GB */
export function kbOf(v: string | undefined): number | undefined {
  const m = v && /^(\d+(?:\.\d+)?)(kb|mb)$/.exec(v);
  if (!m) return;
  const kb = +m[1] * (m[2] === 'mb' ? 1000 : 1);
  return kb >= 1 && kb <= 2_000_000 ? kb : undefined;
}

const num = (v: string | undefined, min: number, max: number) => {
  if (v == null || !/^\d+(\.\d+)?$/.test(v)) return;
  const n = +v;
  return n >= min && n <= max ? n : undefined;
};
const oneOf = <T extends string>(v: string | undefined, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);
const jpeg = (v: string | undefined) => (v === 'jpg' ? 'jpeg' : v);

/** "20-50kb" → [20, 50] */
function rangeOf(v: string | undefined): [number, number] | undefined {
  const m = v && /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(kb|mb)$/.exec(v);
  if (!m) return;
  const [a, b] = [kbOf(`${m[1]}${m[3]}`), kbOf(`${m[2]}${m[3]}`)];
  return a && b && a < b ? [a, b] : undefined;
}

/** "1080x1080" / "3.5x4.5cm" → w, h, unit */
function sizeOf(v: string | undefined) {
  const m = v && /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(px|cm|mm|in)?$/.exec(v);
  if (!m) return;
  const [w, h] = [+m[1], +m[2]];
  return w > 0 && h > 0 && w <= 20000 && h <= 20000 ? { w, h, unit: m[3] ?? 'px' } : undefined;
}

const IMAGE_IN = ['heic', 'jpg', 'png', 'webp', 'avif', 'gif', 'bmp'] as const;
const AUDIO = ['mp3', 'wav', 'm4a', 'flac', 'ogg'] as const;
const VIDEO_IN = ['mp4', 'mov', 'webm', 'mkv', 'avi'] as const;
const strip = (p: Props) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));

/** island → (hash keys → props it already accepts) */
const READERS: Record<string, (h: Record<string, string>) => Props> = {
  CompressPdf: (h) => ({ targetKb: kbOf(h.target) }),
  ImagesToPdf: (h) => ({ targetKb: kbOf(h.target) }),
  VideoCompressor: (h) => ({ targetMB: kbOf(h.target) && kbOf(h.target)! / 1000 }),
  ImageResizer: (h) => {
    const range = rangeOf(h.range);
    if (range) return { mode: 'target', rangeKb: range };
    if (kbOf(h.min)) return { mode: 'increase', targetKb: kbOf(h.min) };
    const size = sizeOf(h.size);
    const target = kbOf(h.target);
    if (size) return { mode: target ? 'target' : 'exact', targetKb: target, ...size };
    return target ? { mode: 'target', targetKb: target } : {};
  },
  ImageConverter: (h) => ({ from: oneOf(h.from, IMAGE_IN), to: oneOf(jpeg(h.to), ['jpeg', 'png', 'webp', 'avif'] as const) }),
  AudioConverter: (h) => ({ from: oneOf(h.from, AUDIO), to: oneOf(h.to, AUDIO) }),
  VideoConverter: (h) => ({ from: oneOf(h.from, VIDEO_IN), to: oneOf(h.to, ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'm4a', 'wav'] as const) }),
  VideoToMp3: (h) => ({ from: oneOf(h.from, VIDEO_IN)?.toUpperCase() }),
  VideoToGif: (h) => ({ from: oneOf(h.from, VIDEO_IN)?.toUpperCase() }),
  UnitConverter: (h) => ({ from: h.from && /^[a-z0-9-]{1,10}$/.test(h.from) ? h.from : undefined, to: h.to && /^[a-z0-9-]{1,10}$/.test(h.to) ? h.to : undefined, value: num(h.value, 0, 1e12) }),
  TrimVideo: (h) => ({ start: num(h.start, 0, 86400), end: num(h.end, 0, 86400) }),
  AudioCutter: (h) => ({ start: num(h.start, 0, 86400), end: num(h.end, 0, 86400) }),
  SocialResizer: (h) => ({ platform: oneOf(h.platform, ['instagram', 'facebook', 'x', 'linkedin', 'youtube', 'pinterest', 'tiktok', 'threads'] as const) }),
  PercentageCalculator: (h) => ({ p: num(h.p, 0, 1e9), of: num(h.of, 0, 1e12) }),
};

/** the hash keys each island reads; the search index carries them so it only links presets a page will use */
export const PRESET_KEYS: Record<string, string[]> = {
  CompressPdf: ['target'],
  ImagesToPdf: ['target'],
  VideoCompressor: ['target'],
  ImageResizer: ['target', 'range', 'min', 'size'],
  ImageConverter: ['from', 'to'],
  AudioConverter: ['from', 'to'],
  VideoConverter: ['from', 'to'],
  VideoToMp3: ['from'],
  VideoToGif: ['from'],
  UnitConverter: ['from', 'to', 'value'],
  TrimVideo: ['start', 'end'],
  AudioCutter: ['start', 'end'],
  SocialResizer: ['platform'],
  PercentageCalculator: ['p', 'of'],
};

/** props from the address hash for this island, already validated; {} when there's nothing usable */
export function presetFromHash(island: string, hash: string): Props {
  const read = READERS[island];
  if (!read || !hash || hash === '#') return {};
  return strip(read(parseHash(hash)));
}
