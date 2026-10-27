export type ArchiveFormat = 'zip' | 'rar' | '7z' | 'tar' | 'gz' | 'bz2' | 'xz' | 'cab' | 'iso';
/** compressors that hold a single file, often a tar */
export type StreamFormat = 'gz' | 'bz2' | 'xz';

export const FORMAT_LABEL: Record<ArchiveFormat, string> = {
  zip: 'ZIP', rar: 'RAR', '7z': '7z', tar: 'TAR', gz: 'GZ', bz2: 'BZ2', xz: 'XZ', cab: 'CAB', iso: 'ISO',
};

/** how many leading bytes `sniff` needs (ISO marks itself 32 KB in) */
export const SNIFF_BYTES = 0x8006;

const at = (head: Uint8Array, offset: number, sig: number[] | string) =>
  (typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig).every((b, i) => head[offset + i] === b);

/** recognises an archive by its first bytes, whatever the file is called */
export function sniff(head: Uint8Array): ArchiveFormat | null {
  if (at(head, 0, [0x50, 0x4b]) && [0x0304, 0x0506, 0x0708].includes((head[2] << 8) | head[3])) return 'zip';
  if (at(head, 0, 'Rar!\x1a\x07')) return 'rar';
  if (at(head, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (at(head, 0, [0x1f, 0x8b])) return 'gz';
  if (at(head, 0, 'BZh') && head[3] >= 0x31 && head[3] <= 0x39) return 'bz2';
  if (at(head, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (at(head, 257, 'ustar')) return 'tar';
  if (at(head, 0, 'MSCF')) return 'cab';
  if (at(head, 0x8001, 'CD001')) return 'iso';
  return null;
}

export const isStreamFormat = (f: ArchiveFormat | null): f is StreamFormat => f === 'gz' || f === 'bz2' || f === 'xz';

/** the file name stored in a gzip header (gzip keeps the original name unless told not to) */
export function gzipStoredName(head: Uint8Array): string | undefined {
  const flags = head[3];
  if (!(flags & 8)) return undefined;
  let p = 10;
  if (flags & 4) p += 2 + (head[10] | (head[11] << 8));
  const end = head.indexOf(0, p);
  if (end <= p) return undefined;
  // the header name is Latin-1; keep only the last path part
  const name = String.fromCharCode(...head.subarray(p, Math.min(end, p + 255)));
  return name.split(/[\\/]/).pop() || undefined;
}

/** "notes.txt.gz" → "notes.txt", "site.tgz" → "site.tar" */
export function unwrappedName(name: string, format: StreamFormat, stored?: string) {
  if (stored) return stored;
  const short = name.replace(/\.t(gz|bz2?|xz)$/i, '.tar');
  if (short !== name) return short;
  const ext = { gz: /\.gz$/i, bz2: /\.bz2?$/i, xz: /\.xz$/i }[format];
  const out = name.replace(ext, '');
  return out && out !== name ? out : `${name}.out`;
}

/** one piece of an archive split into parts: "photos.part2.rar", "backup.7z.001", "data.z01" */
export const isSplitPart = (name: string) => /\.(part\d+\.rar|\d{3}|z\d{2}|r\d{2})$/i.test(name);

/** "Holiday Photos.zip" → "Holiday Photos", "site.tar.gz" → "site" */
export function baseName(name: string) {
  return name.replace(/(\.tar)?\.[a-z0-9]{1,4}$/i, '') || name;
}

export type PreviewKind = 'image' | 'text' | 'audio' | 'video';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
};
const TEXT_EXT = new Set(
  ('txt md markdown csv tsv json jsonl xml html htm css scss less js mjs cjs ts tsx jsx svelte vue astro py rb go rs java kt swift ' +
    'c h cc cpp hpp cs php pl lua r sh bash zsh bat cmd ps1 yml yaml toml ini cfg conf properties env log sql srt vtt ' +
    'gitignore gitattributes editorconfig npmrc lock tex rst adoc diff patch').split(' '),
);
const TEXT_NAMES = /^(readme|license|licence|changelog|authors|contributing|notice|makefile|dockerfile|procfile|gemfile|rakefile)$/i;

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** what kind of inline preview a file can have, judged by its name */
export function previewKind(name: string): PreviewKind | null {
  const ext = extOf(name);
  const mime = MIME[ext];
  if (mime) return mime.split('/')[0] as PreviewKind;
  if (TEXT_EXT.has(ext) || (!ext && TEXT_NAMES.test(name))) return 'text';
  return null;
}

export const mimeOf = (name: string) => MIME[extOf(name)] ?? '';

/** tidies an archive path for display: forward slashes, no "./", "..", or empty parts */
export function normalizePath(path: string) {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Splits an archive path into names that are safe to create on disk: no climbing out of the
 * chosen folder, no characters Windows refuses. Null when nothing usable is left.
 */
export function safeSegments(path: string): string[] | null {
  const parts = normalizePath(path)
    .split('/')
    .map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/[. ]+$/, ''))
    .map((p) => (RESERVED.test(p) ? `_${p}` : p))
    .filter(Boolean);
  return parts.length ? parts : null;
}
