import type { Rounding, TaxMode } from './money';

export type Template = 'classic' | 'modern' | 'minimal';
export type Paper = 'a4' | 'letter';

export interface Party {
  name: string;
  address: string;
  email: string;
  phone: string;
  taxId: string;
}

export interface Business extends Party {
  /** PNG data URL, already downscaled */
  logo: string;
}

export interface LineItem {
  id: string;
  description: string;
  qty: string;
  price: string;
  /** percent, used when taxMode is 'line' */
  tax: string;
}

export interface Invoice {
  id: string;
  created: number;
  title: string;
  number: string;
  issued: string;
  due: string;
  po: string;
  currency: string;
  from: Business;
  to: Party;
  items: LineItem[];
  taxMode: TaxMode;
  taxLabel: string;
  taxRate: string;
  discountKind: 'percent' | 'amount';
  discount: string;
  paid: string;
  rounding: Rounding;
  notes: string;
  terms: string;
  payment: string;
  template: Template;
  accent: string;
  paper: Paper;
}

export interface Store {
  business: Business;
  invoices: Invoice[];
  current: string;
}

export const ACCENTS = ['#1f3a5f', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#1d1c1a'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const emptyParty = (): Party => ({ name: '', address: '', email: '', phone: '', taxId: '' });
export const emptyBusiness = (): Business => ({ ...emptyParty(), logo: '' });
export const newItem = (): LineItem => ({ id: uid(), description: '', qty: '1', price: '', tax: '' });

/** "yyyy-mm-dd" for a local date */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-01-30" + 30 → "2026-03-01"; '' when the date isn't valid */
export function addDays(iso: string, days: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/** whole days from one ISO date to another (negative when `to` is earlier); null if either is invalid */
export function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}

/** "INV-0041" → "INV-0042", "2026/09" → "2026/10", keeping zero padding; "draft" → "draft-2" */
export function nextNumber(prev: string) {
  const m = /(\d+)(?!.*\d)/.exec(prev);
  if (!m) return prev.trim() ? `${prev.trim()}-2` : 'INV-0001';
  const n = (BigInt(m[1]) + 1n).toString().padStart(m[1].length, '0');
  return prev.slice(0, m.index) + n + prev.slice(m.index + m[1].length);
}

export function newInvoice(business: Business, opts: { number: string; currency: string; paper: Paper; template?: Template; accent?: string }): Invoice {
  const today = isoDate();
  const now = Date.now();
  return {
    id: uid(),
    created: now,
    title: 'Invoice',
    number: opts.number,
    issued: today,
    due: addDays(today, 30),
    po: '',
    currency: opts.currency,
    from: { ...business },
    to: emptyParty(),
    items: [newItem()],
    taxMode: 'none',
    taxLabel: 'Tax',
    taxRate: '',
    discountKind: 'percent',
    discount: '',
    paid: '',
    rounding: 'total',
    notes: 'Thank you for your business.',
    terms: '',
    payment: '',
    template: opts.template ?? 'modern',
    accent: opts.accent ?? ACCENTS[0],
    paper: opts.paper,
  };
}

/** A copy with a fresh id, the next number and today's dates (keeping the same payment window) */
export function duplicateInvoice(inv: Invoice, number: string): Invoice {
  const today = isoDate();
  const window = daysBetween(inv.issued, inv.due) ?? 30;
  const now = Date.now();
  return {
    ...structuredClone(inv),
    id: uid(),
    created: now,
    number,
    issued: today,
    due: addDays(today, Math.max(0, window)),
    paid: '',
    items: inv.items.map((it) => ({ ...it, id: uid() })),
  };
}

/** The number to offer for a new invoice: one after the most recently created invoice */
export function suggestNumber(invoices: Invoice[]) {
  const last = invoices.reduce<Invoice | undefined>((a, b) => (!a || b.created > a.created ? b : a), undefined);
  return last ? nextNumber(last.number) : 'INV-0001';
}

/* ---------------- validation for storage and imported JSON ---------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = '', max = 5000) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const isoOr = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);

function party(v: unknown): Party {
  const o = isObj(v) ? v : {};
  return { name: str(o.name, '', 300), address: str(o.address, '', 1000), email: str(o.email, '', 300), phone: str(o.phone, '', 100), taxId: str(o.taxId, '', 100) };
}

export function parseBusiness(v: unknown): Business {
  const o = isObj(v) ? v : {};
  // only our own downscaled PNG data URLs, nothing that could load from elsewhere
  const logo = typeof o.logo === 'string' && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(o.logo) && o.logo.length < 2_000_000 ? o.logo : '';
  return { ...party(o), logo };
}

/** A well-formed Invoice from anything (saved data, an imported file), or null if it isn't one */
export function parseInvoice(v: unknown, defaults: { currency: string; paper: Paper }): Invoice | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const today = isoDate();
  const items = v.items.slice(0, 500).filter(isObj).map((it) => ({
    id: str(it.id, '', 40) || uid(),
    description: str(it.description, '', 2000),
    qty: str(it.qty, '1', 40),
    price: str(it.price, '', 40),
    tax: str(it.tax, '', 40),
  }));
  const currency = str(v.currency, '', 3).toUpperCase();
  return {
    id: str(v.id, '', 40) || uid(),
    created: num(v.created, Date.now()),
    title: str(v.title, 'Invoice', 60),
    number: str(v.number, '', 60),
    issued: isoOr(v.issued, today),
    due: isoOr(v.due, ''),
    po: str(v.po, '', 100),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : defaults.currency,
    from: parseBusiness(v.from),
    to: party(v.to),
    items: items.length ? items : [newItem()],
    taxMode: pick(v.taxMode, ['none', 'global', 'line'] as const, 'none'),
    taxLabel: str(v.taxLabel, 'Tax', 30) || 'Tax',
    taxRate: str(v.taxRate, '', 20),
    discountKind: pick(v.discountKind, ['percent', 'amount'] as const, 'percent'),
    discount: str(v.discount, '', 40),
    paid: str(v.paid, '', 40),
    rounding: pick(v.rounding, ['line', 'total'] as const, 'total'),
    notes: str(v.notes),
    terms: str(v.terms),
    payment: str(v.payment),
    template: pick(v.template, ['classic', 'modern', 'minimal'] as const, 'modern'),
    accent: typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : ACCENTS[0],
    paper: pick(v.paper, ['a4', 'letter'] as const, defaults.paper),
  };
}

/** stands in for an invoice logo that's the same as the business logo */
const SAME_LOGO = 'business';

/**
 * The store as JSON. Every invoice keeps its own copy of the business details, so
 * a logo matching the business one is written once, not per invoice; otherwise
 * a few dozen invoices with a logo would fill the browser's ~5 MB of storage.
 */
export function serializeStore(store: Store, space?: number) {
  const logo = store.business.logo;
  const invoices = store.invoices.map((i) => (logo && i.from.logo === logo ? { ...i, from: { ...i.from, logo: SAME_LOGO } } : i));
  return JSON.stringify({ v: 1, business: store.business, invoices, current: store.current }, null, space);
}

/** Reads the saved store, or an exported file: a single invoice or a whole backup */
export function parseStore(raw: string | null, defaults: { currency: string; paper: Paper }): Store | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;
  const shared = parseBusiness(data.business).logo;
  const list = (Array.isArray(data.invoices) ? data.invoices : data.items ? [data] : []).map((x: unknown) =>
    isObj(x) && isObj(x.from) && x.from.logo === SAME_LOGO ? { ...x, from: { ...x.from, logo: shared } } : x,
  );
  const invoices = list.map((x) => parseInvoice(x, defaults)).filter((x): x is Invoice => !!x);
  if (!invoices.length) return null;
  const current = typeof data.current === 'string' && invoices.some((i) => i.id === data.current) ? data.current : invoices[0].id;
  return { business: parseBusiness(data.business ?? invoices[0].from), invoices, current };
}

/** "Invoice" + "INV/0042" → "invoice-INV-0042.pdf" */
export function invoiceFileName(inv: Pick<Invoice, 'title' | 'number'>, ext = 'pdf') {
  const clean = (s: string) => s.trim().replace(/[\\/:*?"<>|#%\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const title = clean(inv.title).toLowerCase() || 'invoice';
  const number = clean(inv.number);
  return `${number ? `${title}-${number}` : title}.${ext}`;
}
