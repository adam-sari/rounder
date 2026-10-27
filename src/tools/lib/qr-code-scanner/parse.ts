/*
 * Works out what a scanned code holds (link, Wi-Fi login, contact…) from its text,
 * following the de-facto formats phone camera apps understand.
 */

export interface Contact {
  name: string;
  org: string;
  title: string;
  phones: string[];
  emails: string[];
  urls: string[];
  address: string;
  note: string;
}

export type Content =
  | { kind: 'url'; url: string; host: string; warnings: string[] }
  | { kind: 'wifi'; ssid: string; password: string; security: string; hidden: boolean }
  | { kind: 'contact'; contact: Contact; vcard: string }
  | { kind: 'email'; to: string; subject: string; body: string }
  | { kind: 'phone'; number: string }
  | { kind: 'sms'; number: string; body: string }
  | { kind: 'geo'; lat: number; lon: number; query: string }
  | { kind: 'event'; summary: string; start: string; end: string; location: string; description: string; ics: string }
  | { kind: 'product'; code: string; scheme: string }
  | { kind: 'text'; text: string };

export type Kind = Content['kind'];

export const kindLabels: Record<Kind, string> = {
  url: 'link',
  wifi: 'wi-fi network',
  contact: 'contact',
  email: 'email',
  phone: 'phone number',
  sms: 'text message',
  geo: 'location',
  event: 'calendar event',
  product: 'product code',
  text: 'text',
};

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 't.ly', 's.id']);

/** things worth pointing out before someone opens a link from a code they found */
export function urlWarnings(u: URL): string[] {
  const out: string[] = [];
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:') out.push('Not encrypted: it uses http, not https.');
  if (u.username || u.password) out.push('It has text and an @ before the site name, a trick used to disguise where a link really goes.');
  if (host.split('.').some((label) => label.startsWith('xn--'))) out.push('The site name uses international characters, which can imitate a familiar address.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) out.push('It points to a bare IP address rather than a site name.');
  if (SHORTENERS.has(host.replace(/^www\./, ''))) out.push('It\'s a short link, so the final destination is hidden until you open it.');
  return out;
}

function asUrl(text: string): Content | null {
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    const u = new URL(text);
    return { kind: 'url', url: u.href, host: u.hostname, warnings: urlWarnings(u) };
  } catch {
    return null;
  }
}

/** splits "A:1;B:2;;" style payloads on unescaped separators */
function splitEscaped(s: string, sep: string) {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      cur += c + s[++i];
    } else if (c === sep) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** MECARD / WIFI / MATMSG style "KEY:value;KEY:value;;" → map (first value per key, all in `all`) */
function fields(body: string) {
  const all = new Map<string, string[]>();
  for (const part of splitEscaped(body, ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const key = part.slice(0, colon).toUpperCase();
    const list = all.get(key) ?? [];
    list.push(unescape(part.slice(colon + 1)));
    all.set(key, list);
  }
  return { get: (k: string) => all.get(k)?.[0] ?? '', all: (k: string) => all.get(k) ?? [] };
}

function wifi(text: string): Content | null {
  if (!/^WIFI:/i.test(text)) return null;
  const f = fields(text.slice(5));
  const t = f.get('T').toUpperCase();
  return {
    kind: 'wifi',
    ssid: f.get('S'),
    password: f.get('P'),
    security: !t || t === 'NOPASS' ? 'none' : t,
    hidden: /^true$/i.test(f.get('H')),
  };
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function email(text: string): Content | null {
  if (/^mailto:/i.test(text)) {
    const [addr, query = ''] = text.slice(7).split('?');
    const q = new URLSearchParams(query);
    return { kind: 'email', to: decode(addr), subject: q.get('subject') ?? '', body: q.get('body') ?? '' };
  }
  if (/^MATMSG:/i.test(text)) {
    const f = fields(text.slice(7));
    return { kind: 'email', to: f.get('TO'), subject: f.get('SUB'), body: f.get('BODY') };
  }
  if (/^[^\s@:;]+@[^\s@:;]+\.[^\s@:;]+$/.test(text)) return { kind: 'email', to: text, subject: '', body: '' };
  return null;
}

function phoneOrSms(text: string): Content | null {
  const tel = text.match(/^tel:(.+)$/i);
  if (tel) return { kind: 'phone', number: decode(tel[1]).trim() };
  const smsto = text.match(/^smsto:([^:]*):?([\s\S]*)$/i);
  if (smsto) return { kind: 'sms', number: smsto[1].trim(), body: smsto[2] };
  const sms = text.match(/^sms:([^?]*)\??(.*)$/i);
  if (sms) return { kind: 'sms', number: decode(sms[1]).trim(), body: new URLSearchParams(sms[2]).get('body') ?? '' };
  return null;
}

function geo(text: string): Content | null {
  const m = text.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,[^?]*)?(?:\?(.*))?$/i);
  if (!m) return null;
  const lat = +m[1];
  const lon = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { kind: 'geo', lat, lon, query: new URLSearchParams(m[3] ?? '').get('q') ?? '' };
}

/** vCard / iCalendar content lines, with folded lines joined and the property name upper-cased */
function contentLines(text: string) {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon < 0) return null;
      // "item1.TEL;TYPE=cell" → "TEL"
      const name = line.slice(0, colon).split(';')[0].split('.').pop()!.toUpperCase();
      return { name, value: line.slice(colon + 1) };
    })
    .filter((l) => l !== null);
}

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function vcard(text: string): Content | null {
  if (!/^BEGIN:VCARD/i.test(text)) return null;
  const c: Contact = { name: '', org: '', title: '', phones: [], emails: [], urls: [], address: '', note: '' };
  let structured = '';
  for (const { name, value } of contentLines(text)) {
    const v = unescapeText(value).trim();
    if (!v) continue;
    if (name === 'FN') c.name = v;
    else if (name === 'N') {
      const [family = '', given = '', middle = '', prefix = '', suffix = ''] = splitEscaped(value, ';').map(unescapeText);
      structured = [prefix, given, middle, family, suffix].map((s) => s.trim()).filter(Boolean).join(' ');
    } else if (name === 'ORG') c.org = splitEscaped(value, ';').map(unescapeText).filter(Boolean).join(', ');
    else if (name === 'TITLE') c.title = v;
    else if (name === 'TEL') c.phones.push(v.replace(/^tel:/i, ''));
    else if (name === 'EMAIL') c.emails.push(v);
    else if (name === 'URL') c.urls.push(v);
    else if (name === 'ADR') c.address = splitEscaped(value, ';').map((s) => unescapeText(s).trim()).filter(Boolean).join(', ');
    else if (name === 'NOTE') c.note = v;
  }
  c.name ||= structured;
  return { kind: 'contact', contact: c, vcard: text };
}

/** builds a vCard 3.0 file for contacts that arrived in another format */
export function toVcard(c: Contact) {
  const esc = (s: string) => s.replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(c.name)}`,
    c.org && `ORG:${esc(c.org)}`,
    c.title && `TITLE:${esc(c.title)}`,
    ...c.phones.map((p) => `TEL:${esc(p)}`),
    ...c.emails.map((e) => `EMAIL:${esc(e)}`),
    ...c.urls.map((u) => `URL:${esc(u)}`),
    c.address && `ADR:;;${esc(c.address)};;;;`,
    c.note && `NOTE:${esc(c.note)}`,
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
}

function mecard(text: string): Content | null {
  if (!/^MECARD:/i.test(text)) return null;
  const f = fields(text.slice(7));
  // MECARD names are "Last,First"
  const [last = '', first = ''] = f.get('N').split(',');
  const c: Contact = {
    name: [first, last].map((s) => s.trim()).filter(Boolean).join(' '),
    org: f.get('ORG'),
    title: f.get('TITLE'),
    phones: f.all('TEL'),
    emails: f.all('EMAIL'),
    urls: f.all('URL'),
    address: f.get('ADR'),
    note: f.get('NOTE'),
  };
  return { kind: 'contact', contact: c, vcard: toVcard(c) };
}

/** "20261026T150000Z" → "2026-10-26 15:00 UTC"; "20261026" → "2026-10-26" */
export function icsDate(value: string) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?/);
  if (!m) return value;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${date} ${m[4]}:${m[5]}${m[6] ? ' UTC' : ''}` : date;
}

function event(text: string): Content | null {
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  const e = { summary: '', start: '', end: '', location: '', description: '' };
  for (const { name, value } of contentLines(text)) {
    const v = unescapeText(value).trim();
    if (name === 'SUMMARY') e.summary = v;
    else if (name === 'DTSTART') e.start = icsDate(v);
    else if (name === 'DTEND') e.end = icsDate(v);
    else if (name === 'LOCATION') e.location = v;
    else if (name === 'DESCRIPTION') e.description = v;
  }
  const body = text.trim().replace(/\r?\n/g, '\r\n');
  const ics = /^BEGIN:VCALENDAR/i.test(body) ? body : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Rounder//QR scanner//EN\r\n${body}\r\nEND:VCALENDAR`;
  return { kind: 'event', ...e, ics };
}

function bookmark(text: string): Content | null {
  if (!/^MEBKM:/i.test(text)) return null;
  return asUrl(fields(text.slice(6)).get('URL').trim());
}

const PRODUCT_SCHEMES: Record<string, string> = { EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E', ISBN: 'ISBN' };

/** what a scanned code holds; `format` is the zxing format name, e.g. "QRCode" or "EAN13" */
export function parseContent(raw: string, format = ''): Content {
  const scheme = PRODUCT_SCHEMES[format];
  if (scheme) return { kind: 'product', code: raw.trim(), scheme };
  const text = raw.trim();
  // structured payloads first: a MECARD or vCard can contain things that look like an email address
  return asUrl(text) ?? bookmark(text) ?? wifi(text) ?? vcard(text) ?? mecard(text) ?? event(text) ?? email(text) ?? phoneOrSms(text) ?? geo(text) ?? { kind: 'text', text: raw };
}
