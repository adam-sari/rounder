/* Turns exifr's merged output into the grouped rows the viewer shows. */

export type Tags = Record<string, unknown>;

export interface Group {
  id: 'camera' | 'settings' | 'date' | 'location' | 'software' | 'author';
  title: string;
  rows: [string, string][];
}

export interface Summary {
  groups: Group[];
  gps?: { lat: number; lon: number };
  /** every readable tag, for the "all tags" table */
  all: [string, string][];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** EXIF dates have no time zone, so show the wall-clock time as recorded */
function formatDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Any tag value as display text, or undefined when there's nothing worth showing */
export function text(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return Number.isNaN(+v) ? undefined : formatDate(v);
  if (typeof v === 'string') return v.replace(/\0+$/, '').trim() || undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number.isInteger(v) ? v : +v.toFixed(4)) : undefined;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (ArrayBuffer.isView(v)) return `${v.byteLength} bytes of data`;
  if (Array.isArray(v)) {
    const parts = v.map(text).filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof v === 'object') {
    // XMP language alternatives arrive as { lang, value }
    if ('value' in v) return text(v.value);
    const parts = Object.entries(v).flatMap(([k, x]) => {
      const t = text(x);
      return t ? [`${k}: ${t}`] : [];
    });
    return parts.length ? parts.join(' · ') : undefined;
  }
  return String(v);
}

export function exposure(seconds: number) {
  return seconds >= 1 ? `${+seconds.toFixed(1)} s` : `1/${Math.round(1 / seconds)} s`;
}

export function formatCoords(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? 'W' : 'E'}`;
}

export function osmLink(lat: number, lon: number) {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Array.isArray(v) && typeof v[0] === 'number' ? v[0] : undefined);

export function summarize(tags: Tags): Summary {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const t = text(tags[k]);
      if (t) return t;
    }
  };

  const make = get('Make');
  const model = get('Model');
  const camera = model && make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model ?? make;

  const f = num(tags.FNumber);
  const t = num(tags.ExposureTime);
  const iso = num(tags.ISO) ?? num(tags.ISOSpeedRatings);
  const focal = num(tags.FocalLength);
  const focal35 = num(tags.FocalLengthIn35mmFormat);

  const lat = num(tags.latitude);
  const lon = num(tags.longitude);
  const gps = lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0) ? { lat, lon } : undefined;
  const alt = num(tags.GPSAltitude);
  const place = [...new Set(['Location', 'Sublocation', 'City', 'State', 'ProvinceState', 'Country', 'CountryName'].map((k) => text(tags[k])).filter(Boolean))].join(', ');

  const taken = get('DateTimeOriginal', 'CreateDate', 'DateCreated');
  const offset = get('OffsetTimeOriginal');

  const raw: (Omit<Group, 'rows'> & { rows: [string, string | undefined][] })[] = [
    {
      id: 'camera',
      title: 'Camera',
      rows: [
        ['Camera', camera],
        ['Lens', get('LensModel', 'Lens')],
        ['Camera serial', get('BodySerialNumber', 'SerialNumber')],
        ['Lens serial', get('LensSerialNumber')],
        ['Owner', get('CameraOwnerName', 'OwnerName')],
      ],
    },
    {
      id: 'settings',
      title: 'Settings',
      rows: [
        ['Exposure', t ? exposure(t) : undefined],
        ['Aperture', f ? `ƒ/${+f.toFixed(1)}` : undefined],
        ['ISO', iso ? String(iso) : undefined],
        ['Focal length', focal ? `${+focal.toFixed(1)} mm${focal35 ? ` (${focal35} mm equiv.)` : ''}` : undefined],
        ['Flash', get('Flash')],
      ],
    },
    {
      id: 'date',
      title: 'Date',
      rows: [
        ['Taken', taken && offset ? `${taken} (UTC${offset})` : taken],
        ['Modified', get('ModifyDate', 'DateTime')],
      ],
    },
    {
      id: 'location',
      title: 'Location',
      rows: [
        ['Altitude', alt !== undefined ? `${Math.round(alt)} m` : undefined],
        ['Place', place || undefined],
      ],
    },
    {
      id: 'software',
      title: 'Software',
      rows: [
        ['Software', get('Software')],
        ['Made with', get('CreatorTool')],
        ['Computer', get('HostComputer')],
      ],
    },
    {
      id: 'author',
      title: 'Author & copyright',
      rows: [
        ['Author', get('Artist', 'creator', 'Byline', 'By-line')],
        ['Copyright', get('Copyright', 'rights', 'CopyrightNotice')],
        ['Description', get('ImageDescription', 'description', 'Caption', 'Caption-Abstract')],
      ],
    },
  ];
  const groups: Group[] = raw
    .map((g) => ({ ...g, rows: g.rows.filter((r): r is [string, string] => !!r[1]) }))
    .filter((g) => g.rows.length);

  const all = Object.entries(tags).flatMap(([k, v]): [string, string][] => {
    const t = text(v);
    return t ? [[k, t.length > 300 ? `${t.slice(0, 300)}…` : t]] : [];
  });

  return { groups, gps, all };
}
