export type Level = 'store' | 'normal' | 'max';

// photos, video, audio and other archives are compressed already; deflating them again wastes time
const PACKED = new Set(
  ('jpg jpeg png gif webp avif heic heif jxl mp4 m4v mov mkv webm avi wmv mp3 m4a aac ogg oga opus flac wma ' +
    'zip rar 7z gz tgz bz2 tbz2 xz txz zst lz4 cab jar apk ipa docx xlsx pptx odt ods odp epub woff woff2').split(' '),
);

export function isPrecompressed(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && PACKED.has(name.slice(dot + 1).toLowerCase());
}

/** deflate level for one file: "normal" stores files that won't shrink, "max" tries everything */
export function deflateLevel(level: Level, name: string): 0 | 6 | 9 {
  if (level === 'store') return 0;
  if (level === 'max') return 9;
  return isPrecompressed(name) ? 0 : 6;
}

const MIN_TIME = new Date(1980, 0, 1, 0, 0, 2).getTime();
const MAX_TIME = new Date(2099, 11, 31, 23, 59, 58).getTime();

/** ZIP timestamps only cover 1980–2099; files outside that (or with no date) get the nearest valid one */
export function zipTime(ms: number) {
  return Number.isFinite(ms) && ms > 0 ? Math.min(MAX_TIME, Math.max(MIN_TIME, ms)) : MIN_TIME;
}

/** the archive's file name: no characters file systems refuse, always ending in .zip */
export function zipName(name: string) {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').trim().replace(/\.zip$/i, '').replace(/[. ]+$/, '');
  return `${clean || 'archive'}.zip`;
}

/** "a.b/c.txt" taken → "a.b/c (2).txt"; the folder part is left alone */
export function freePath(path: string, taken: { has(path: string): boolean }) {
  const slash = path.lastIndexOf('/') + 1;
  const dir = path.slice(0, slash);
  const name = path.slice(slash);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let out = path;
  for (let n = 2; taken.has(out); n++) out = `${dir}${stem} (${n})${ext}`;
  return out;
}

/** clutter operating systems leave in folders: Finder's .DS_Store, Windows' Thumbs.db, and friends */
export function isJunk(path: string) {
  return /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]+)$|(^|\/)__MACOSX\//i.test(path);
}

/** ZIP without the ZIP64 extension tops out at 4 GiB and 65,535 entries */
export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_MAX_ENTRIES = 0xffff;

/** "−38%" when the archive is smaller, "+2%" when it grew */
export function ratioLabel(before: number, after: number) {
  if (!before) return '';
  const pct = Math.round((1 - after / before) * 100);
  return pct > 0 ? `−${pct}%` : `+${-pct}%`;
}
