/*
 * Email signatures as table-based HTML with every style inline, the only kind
 * Gmail, Outlook (including the Word-based desktop app) and Apple Mail all render
 * the same. No classes, no <style>, no external CSS, no web fonts.
 */

export type TemplateId = 'classic' | 'photo' | 'compact' | 'bold' | 'minimal';
export type Network = 'linkedin' | 'x' | 'instagram' | 'facebook' | 'github' | 'youtube' | 'tiktok';
export type FontId = keyof typeof FONTS;

export interface Signature {
  name: string;
  title: string;
  company: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  address: string;
  /** https URL, or a data: URI when embedding */
  image: string;
  imageShape: 'round' | 'square';
  imageSize: number;
  /** height ÷ width of the image, so it's never stretched */
  imageRatio: number;
  socials: Record<Network, string>;
  template: TemplateId;
  color: string;
  font: FontId;
}

export const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'photo', label: 'Photo' },
  { id: 'bold', label: 'Bold' },
  { id: 'compact', label: 'Compact' },
  { id: 'minimal', label: 'Minimal' },
];

/** fonts installed on practically every computer and phone, with fallbacks */
export const FONTS = {
  arial: { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  helvetica: { label: 'Helvetica', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  verdana: { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  tahoma: { label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  trebuchet: { label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  times: { label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
} as const;

export const NETWORKS: { id: Network; label: string; badge: string; base: string }[] = [
  { id: 'linkedin', label: 'LinkedIn', badge: 'in', base: 'https://www.linkedin.com/in/' },
  { id: 'x', label: 'X', badge: 'X', base: 'https://x.com/' },
  { id: 'instagram', label: 'Instagram', badge: 'IG', base: 'https://www.instagram.com/' },
  { id: 'facebook', label: 'Facebook', badge: 'f', base: 'https://www.facebook.com/' },
  { id: 'github', label: 'GitHub', badge: 'GH', base: 'https://github.com/' },
  { id: 'youtube', label: 'YouTube', badge: 'YT', base: 'https://www.youtube.com/@' },
  { id: 'tiktok', label: 'TikTok', badge: 'TT', base: 'https://www.tiktok.com/@' },
];

export const blankSignature = (): Signature => ({
  name: '', title: '', company: '', phone: '', mobile: '', email: '', website: '', address: '',
  image: '', imageShape: 'round', imageSize: 80, imageRatio: 1,
  socials: { linkedin: '', x: '', instagram: '', facebook: '', github: '', youtube: '', tiktok: '' },
  template: 'photo', color: '#1f6feb', font: 'arial',
});

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "example.com/about" → "https://example.com/about"; '' for anything that isn't a web address */
export function webUrl(input: string) {
  const s = input.trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : '';
  } catch {
    return '';
  }
}

/** "https://www.example.com/" → "example.com" for display */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

/** a profile URL from a full link, "example.com/me", or just a handle like "@jane" */
export function socialUrl(network: Network, input: string) {
  const s = input.trim();
  if (!s) return '';
  if (/^@?[\w.-]+$/.test(s) && !/\.(com|net|org|io|co|me|in)$/i.test(s)) {
    return NETWORKS.find((n) => n.id === network)!.base + encodeURIComponent(s.replace(/^@/, ''));
  }
  return webUrl(s);
}

export const telHref = (phone: string) => {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 3 ? `tel:${digits}` : '';
};

export const validEmail = (s: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s.trim());

/** the image source, if it's something an email client can load: https/http URL or an embedded PNG/JPEG/GIF */
export function imageSrc(src: string) {
  const s = src.trim();
  if (/^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
  return /^https?:\/\//i.test(s) ? webUrl(s) : '';
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
const lum = (hex: string) =>
  rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);

/** white or near-black text, whichever reads better on `hex` */
export const textOn = (hex: string) => (lum(hex) > 0.4 ? '#1a1a1a' : '#ffffff');

const INK = '#1f1f1f';
const SOFT = '#5f6368';
const FAINT = '#a0a4a8';

/** Builds the signature HTML; every value is escaped and every link checked */
export function signatureHtml(sig: Signature): string {
  const color = /^#[0-9a-f]{6}$/i.test(sig.color) ? sig.color : '#1f6feb';
  const font = (FONTS[sig.font] ?? FONTS.arial).stack;
  const base = `font-family:${font};font-size:13px;line-height:1.5;color:${SOFT};`;
  const table = (inner: string, style = '') => `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;${style}">${inner}</table>`;
  const td = (inner: string, style = '', attrs = '') => `<td${attrs} style="${base}${style}">${inner}</td>`;
  const row = (inner: string, style = '') => (inner ? `<tr>${td(inner, style)}</tr>` : '');
  const link = (href: string, text: string, col = color, extra = '') => (href ? `<a href="${esc(href)}" style="color:${col};text-decoration:none;${extra}">${esc(text)}</a>` : esc(text));
  const sep = `<span style="color:${FAINT};">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`;

  const name = esc(sig.name.trim());
  const title = esc(sig.title.trim());
  const company = esc(sig.company.trim());
  const web = webUrl(sig.website);
  const email = validEmail(sig.email) ? sig.email.trim() : '';
  // phone numbers stay in body color; links people click to visit get the accent
  const contacts = [
    sig.phone.trim() && { key: 'P', href: telHref(sig.phone), text: sig.phone.trim(), col: SOFT },
    sig.mobile.trim() && { key: 'M', href: telHref(sig.mobile), text: sig.mobile.trim(), col: SOFT },
    email && { key: 'E', href: `mailto:${email}`, text: email, col: color },
    web && { key: 'W', href: web, text: displayUrl(web), col: color },
  ].filter((c) => !!c);
  const contact = (c: (typeof contacts)[number], col = c.col) => link(c.href, c.text, col);
  const address = esc(sig.address.trim()).replace(/\r?\n/g, '<br>');
  const socials = NETWORKS.map((n) => ({ ...n, url: socialUrl(n.id, sig.socials[n.id] ?? '') })).filter((n) => n.url);

  const img = imageSrc(sig.image);
  const size = Math.round(Math.min(160, Math.max(40, sig.imageSize || 80)));
  const ratio = Math.min(4, Math.max(0.25, sig.imageRatio || 1));
  // width and height attributes are what Outlook goes by; a round frame only suits square images
  const image = (px: number) => {
    if (!img) return '';
    const h = Math.round(px * ratio);
    const radius = sig.imageShape === 'round' && Math.abs(ratio - 1) < 0.05 ? '50%' : '8px';
    return `<img src="${esc(img)}" width="${px}" height="${h}" alt="${name || 'Photo'}" style="display:block;width:${px}px;height:${h}px;border:0;border-radius:${radius};">`;
  };

  const role = [title, company && (title ? `<span style="color:${color};font-weight:bold;">${company}</span>` : `<span style="font-weight:bold;">${company}</span>`)].filter(Boolean).join(title && company ? ' &nbsp;·&nbsp; ' : '');
  const contactLines = contacts.map((c) => `<span style="color:${color};font-weight:bold;">${c.key}</span>&nbsp;&nbsp;${contact(c)}`).join('<br>');
  const contactInline = contacts.map((c) => contact(c)).join(sep);
  const socialText = socials.map((s) => link(s.url, s.label, color, 'font-weight:bold;')).join(sep);
  const badges = (bg: string) =>
    socials.length
      ? table(`<tr>${socials.map((s, i) => `${i ? '<td width="6" style="font-size:0;line-height:0;">&nbsp;</td>' : ''}<td width="24" height="24" align="center" valign="middle" bgcolor="${bg}" style="background:${bg};border-radius:5px;width:24px;height:24px;"><a href="${esc(s.url)}" title="${s.label}" style="display:block;font-family:Arial, Helvetica, sans-serif;font-size:10px;line-height:24px;font-weight:bold;color:${textOn(bg)};text-decoration:none;">${s.badge}</a></td>`).join('')}</tr>`)
      : '';

  let body: string;
  switch (sig.template) {
    case 'classic':
      body = table(
        (img ? `<tr><td style="padding-bottom:12px;">${image(size)}</td></tr>` : '') +
        row(name, `font-size:18px;font-weight:bold;color:${INK};line-height:1.3;`) +
        row(role, 'padding-bottom:2px;') +
        `<tr><td style="padding:10px 0;">${table(`<tr><td width="44" height="2" bgcolor="${color}" style="background:${color};width:44px;height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>`)}</td></tr>` +
        row(contactLines) +
        row(address, 'padding-top:4px;font-size:12px;') +
        row(socialText, 'padding-top:8px;font-size:12px;'),
      );
      break;
    case 'photo':
      body = table(
        `<tr>${img ? `<td valign="top" style="padding-right:16px;">${image(size)}</td>` : ''}${td(
          table(
            row(name, `font-size:18px;font-weight:bold;color:${INK};line-height:1.3;`) +
            row(role, 'padding-bottom:8px;') +
            row(contactLines) +
            row(address, 'padding-top:4px;font-size:12px;') +
            (socials.length ? `<tr><td style="padding-top:10px;">${badges(color)}</td></tr>` : ''),
          ),
          `border-left:2px solid ${color};padding-left:16px;`,
          ' valign="top"',
        )}</tr>`,
      );
      break;
    case 'bold': {
      const fg = textOn(color);
      body = table(
        `<tr>${img ? `<td valign="middle" style="padding-right:14px;">${image(size)}</td>` : ''}${td(
          table(
            row(name, `font-size:22px;font-weight:bold;color:${color};line-height:1.2;`) +
            row(esc(sig.title.trim().toUpperCase()), `font-size:11px;letter-spacing:1px;color:${SOFT};`) +
            row(company, `font-size:13px;font-weight:bold;color:${INK};`),
          ),
          '',
          ' valign="middle"',
        )}</tr>` +
        (contacts.length
          ? `<tr><td colspan="${img ? 2 : 1}" style="padding-top:10px;">${table(
            `<tr><td bgcolor="${color}" style="${base}background:${color};color:${fg};border-radius:6px;padding:7px 12px;font-size:12px;">${contacts
              .map((c) => contact(c, fg))
              .join(`<span style="color:${fg};opacity:0.6;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)}</td></tr>`,
          )}</td></tr>`
          : '') +
        (address ? `<tr>${td(address, 'padding-top:6px;font-size:12px;', ` colspan="${img ? 2 : 1}"`)}</tr>` : '') +
        (socials.length ? `<tr><td colspan="${img ? 2 : 1}" style="padding-top:8px;">${badges(INK)}</td></tr>` : ''),
      );
      break;
    }
    case 'compact':
      body = table(
        `<tr>${img ? `<td valign="middle" style="padding-right:12px;">${image(Math.min(size, 56))}</td>` : ''}${td(
          [
            [name && `<span style="font-size:15px;font-weight:bold;color:${INK};">${name}</span>`, [title, company].filter(Boolean).join(', ')].filter(Boolean).join(sep),
            contactInline,
            [address.replace(/<br>/g, ', '), socialText].filter(Boolean).join(sep),
          ].filter(Boolean).join('<br>'),
          '',
          ' valign="middle"',
        )}</tr>`,
      );
      break;
    default:
      body = table(
        row(
          [
            name && `<span style="font-weight:bold;color:${INK};">${name}</span>`,
            [title, company].filter(Boolean).join(', '),
            contacts.map((c) => contact(c)).join(' &nbsp;·&nbsp; '),
            address,
            socialText,
          ].filter(Boolean).join('<br>'),
          'font-size:12px;',
        ),
      );
  }
  return body;
}

/** the plain-text version for clients (and replies) that don't show HTML */
export function signaturePlain(sig: Signature): string {
  const web = webUrl(sig.website);
  return [
    sig.name.trim(),
    [sig.title.trim(), sig.company.trim()].filter(Boolean).join(', '),
    [sig.phone.trim() && `P ${sig.phone.trim()}`, sig.mobile.trim() && `M ${sig.mobile.trim()}`].filter(Boolean).join('  '),
    validEmail(sig.email) ? sig.email.trim() : '',
    web && displayUrl(web),
    sig.address.trim(),
    NETWORKS.map((n) => socialUrl(n.id, sig.socials[n.id] ?? '')).filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
}

/** saved fields, checked and filled in */
export function parseSignature(raw: string | null): Signature | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Signature>;
    const b = blankSignature();
    const s = (v: unknown, d: string) => (typeof v === 'string' ? v.slice(0, 200_000) : d);
    return {
      name: s(o.name, ''), title: s(o.title, ''), company: s(o.company, ''), phone: s(o.phone, ''), mobile: s(o.mobile, ''),
      email: s(o.email, ''), website: s(o.website, ''), address: s(o.address, ''), image: s(o.image, ''),
      imageShape: o.imageShape === 'square' ? 'square' : 'round',
      imageSize: typeof o.imageSize === 'number' ? o.imageSize : b.imageSize,
      imageRatio: typeof o.imageRatio === 'number' && o.imageRatio > 0 ? o.imageRatio : 1,
      socials: Object.fromEntries(NETWORKS.map((n) => [n.id, s(o.socials?.[n.id], '')])) as Signature['socials'],
      template: TEMPLATES.some((t) => t.id === o.template) ? o.template! : b.template,
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : b.color,
      font: typeof o.font === 'string' && Object.hasOwn(FONTS, o.font) ? o.font : b.font,
    };
  } catch {
    return null;
  }
}
