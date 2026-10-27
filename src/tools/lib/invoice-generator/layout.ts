/*
 * Lays an invoice out once as positioned draw ops (points, origin top-left).
 * The same ops are drawn as SVG for the live preview and with pdf-lib for the
 * download, so the preview is the PDF. Text widths come from `measure`, which
 * each side backs with its own font metrics.
 */
import type { Invoice } from './invoice';
import { SCALE, currencyDigits, formatRate, parseScaled, type Totals } from './money';

export type FontKey = 'regular' | 'bold' | 'serif';
export type Measure = (text: string, size: number, font: FontKey) => number;
export type Op =
  | { t: 'text'; x: number; y: number; text: string; size: number; font: FontKey; color: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { t: 'image'; x: number; y: number; w: number; h: number };

export interface Layout {
  width: number;
  height: number;
  pages: Op[][];
}

export interface Formatters {
  money: (minor: number) => string;
  date: (iso: string) => string;
  /** a plain number such as a quantity */
  number: (n: number) => string;
}

/** width × height in points */
export const PAPER = { a4: [595.28, 841.89], letter: [612, 792] } as const;

const INK = '#1d1c1a';
const SOFT = '#55514a';
const FAINT = '#8d877d';
const HAIR = '#e2ddd4';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

/** blends hex color a toward b by t (0–1) */
export function mix(a: string, b: string, t: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** white or ink, whichever reads better on `hex` */
export const readableOn = (hex: string) => (1.05 / (luminance(hex) + 0.05) >= (luminance(hex) + 0.05) / (luminance(INK) + 0.05) ? '#ffffff' : INK);

/** tabs and other control characters (pasted from spreadsheets) become spaces: PDF fonts can't measure or draw them */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ');

/** Breaks text into lines no wider than `width`, keeping blank lines and splitting words that can't fit */
export function wrap(text: string, width: number, size: number, font: FontKey, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n').map(clean)) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size, font) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let chars = Array.from(word);
      while (chars.length > 1 && measure(chars.join(''), size, font) > width) {
        let cut = chars.length - 1;
        while (cut > 1 && measure(chars.slice(0, cut).join(''), size, font) > width) cut--;
        out.push(chars.slice(0, cut).join(''));
        chars = chars.slice(cut);
      }
      line = chars.join('');
    }
    out.push(line);
  }
  return out;
}

/** true for rows people haven't filled in yet; they're left off the invoice */
export const isBlankItem = (it: { description: string; price: string }) => !it.description.trim() && !it.price.trim();

export function layoutInvoice(
  inv: Invoice,
  totals: Totals,
  f: Formatters,
  measure: Measure,
  logo: { width: number; height: number } | null,
  /** draw grey placeholders for empty fields (preview only) */
  ghost = false,
): Layout {
  const [W, H] = PAPER[inv.paper];
  const M = 48;
  const BOTTOM = H - 56;
  const CW = W - 2 * M;
  const tpl = inv.template;
  const accent = inv.accent;
  const onAccent = readableOn(accent);
  const pages: Op[][] = [];
  let ops: Op[] = [];
  let y = M;
  let onBreak: (() => void) | null = null;

  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = M;
    onBreak?.();
  };
  /** starts a new page unless `h` more points fit on this one */
  const ensure = (h: number) => {
    if (y + h > BOTTOM && y > M) newPage();
  };
  const text = (raw: string, x: number, base: number, size: number, font: FontKey = 'regular', color = INK, align: 'left' | 'right' | 'center' = 'left') => {
    const s = clean(raw);
    if (!s) return;
    const w = measure(s, size, font);
    ops.push({ t: 'text', x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: base, text: s, size, font, color });
  };
  const line = (x1: number, y1: number, x2: number, color = HAIR, width = 0.6) => ops.push({ t: 'line', x1, y1, x2, y2: y1, color, width });
  const lines = (s: string, width: number, size: number, max = 8) => (s.trim() ? wrap(s.trim(), width, size, 'regular', measure).slice(0, max) : []);
  const label = (s: string) => (tpl === 'minimal' ? s : s.toUpperCase());
  const labelColor = tpl === 'minimal' ? FAINT : accent;

  newPage();

  /* ---------- header: business on the left, title on the right ---------- */
  const band = tpl === 'modern';
  const top = band ? 40 : M;
  const c1 = band ? onAccent : INK;
  const c2 = band ? mix(onAccent, accent, 0.28) : SOFT;
  let ly = top;
  if (logo) {
    const s = Math.min(170 / logo.width, 52 / logo.height);
    ops.push({ t: 'image', x: M, y: ly, w: logo.width * s, h: logo.height * s });
    ly += logo.height * s + 4;
  }
  const from = inv.from;
  if (from.name.trim() || ghost) {
    ly += 18;
    text(from.name.trim() || 'Your business', M, ly, 13, 'bold', from.name.trim() ? c1 : mix(c2, band ? accent : '#ffffff', 0.35));
    ly += 2;
  }
  for (const s of [...lines(from.address, CW * 0.5, 9), from.email.trim(), from.phone.trim(), from.taxId.trim()].filter(Boolean)) {
    ly += 13;
    text(s, M, ly, 9, 'regular', c2);
  }

  const title = (inv.title.trim() || 'Invoice').slice(0, 40);
  const titleSize = tpl === 'classic' ? 34 : tpl === 'modern' ? 26 : 22;
  let ry = top + titleSize * 0.78;
  text(tpl === 'modern' ? title.toUpperCase() : title, W - M, ry, titleSize, tpl === 'classic' ? 'serif' : tpl === 'modern' ? 'bold' : 'regular', tpl === 'classic' ? accent : c1, 'right');
  if (inv.number.trim()) {
    ry += 18;
    text(inv.number.trim(), W - M, ry, 10, 'regular', c2, 'right');
  }

  const headEnd = Math.max(ly, ry);
  if (band) {
    ops.unshift({ t: 'rect', x: 0, y: 0, w: W, h: headEnd + 30, color: accent });
    y = headEnd + 30 + 34;
  } else if (tpl === 'classic') {
    line(M, headEnd + 18, W - M, accent, 1.4);
    y = headEnd + 18 + 30;
  } else {
    y = headEnd + 44;
  }

  /* ---------- bill to + dates ---------- */
  const to = inv.to;
  let by = y;
  text(label('Bill to'), M, by + 7, 7.5, 'bold', labelColor);
  by += 9;
  if (to.name.trim() || ghost) {
    by += 15;
    text(to.name.trim() || 'Client name', M, by, 10.5, 'bold', to.name.trim() ? INK : '#bdb7ad');
  }
  for (const s of [...lines(to.address, CW * 0.48, 9), to.email.trim(), to.phone.trim(), to.taxId.trim()].filter(Boolean)) {
    by += 13;
    text(s, M, by, 9, 'regular', SOFT);
  }

  const dx = W - M - 210;
  let dy = y;
  const detail = (k: string, v: string) => {
    dy += 15;
    text(k, dx, dy, 8.5, 'regular', FAINT);
    text(v, W - M, dy, 9, 'regular', INK, 'right');
  };
  dy -= 8;
  if (inv.issued) detail('Issue date', f.date(inv.issued));
  if (inv.due) detail('Due date', f.date(inv.due));
  if (inv.po.trim()) detail('PO number', inv.po.trim());
  dy += 10;
  line(dx, dy, W - M, tpl === 'minimal' ? HAIR : mix(accent, '#ffffff', 0.6));
  dy += 18;
  text(totals.paid ? 'Balance due' : 'Amount due', dx, dy, 9, 'bold', INK);
  text(f.money(totals.due), W - M, dy, 12, 'bold', tpl === 'minimal' ? INK : accent, 'right');

  y = Math.max(by, dy) + 34;

  /* ---------- line items ---------- */
  const pad = tpl === 'modern' ? 10 : 0;
  const withTax = inv.taxMode === 'line';
  const digits = currencyDigits(inv.currency);
  const amountR = W - M - pad;
  const priceR = amountR - 92;
  const taxR = priceR - 84;
  const qtyR = withTax ? taxR - 44 : priceR - 84;
  const descX = M + pad;
  const descW = qtyR - 52 - descX;
  const headH = 24;

  const drawHead = () => {
    if (tpl === 'modern') ops.push({ t: 'rect', x: M, y, w: CW, h: headH, color: accent });
    const c = tpl === 'modern' ? onAccent : labelColor;
    const b = y + 15;
    text(label('Description'), descX, b, 7.5, 'bold', c);
    text(label('Qty'), qtyR, b, 7.5, 'bold', c, 'right');
    if (withTax) text(label(inv.taxLabel.trim() || 'Tax'), taxR, b, 7.5, 'bold', c, 'right');
    text(label('Price'), priceR, b, 7.5, 'bold', c, 'right');
    text(label('Amount'), amountR, b, 7.5, 'bold', c, 'right');
    if (tpl !== 'modern') line(M, y + headH, W - M, tpl === 'classic' ? accent : INK, tpl === 'classic' ? 1.1 : 0.7);
    y += headH;
  };

  drawHead();
  onBreak = drawHead;
  const tint = mix(accent, '#ffffff', 0.93);
  let row = 0;
  inv.items.forEach((it, i) => {
    if (isBlankItem(it) && !(ghost && inv.items.length === 1)) return;
    const desc = lines(it.description, descW, 9.5, 40);
    const shown = desc.length ? desc : [ghost ? 'Item description' : ''];
    const h = 25 + (shown.length - 1) * 13;
    ensure(h);
    if (tpl === 'modern' && row % 2) ops.push({ t: 'rect', x: M, y, w: CW, h, color: tint });
    const b = y + 16;
    shown.forEach((s, k) => text(s, descX, b + k * 13, 9.5, 'regular', desc.length ? INK : '#bdb7ad'));
    const qty = parseScaled(it.qty, 4);
    if (qty !== null) text(f.number(qty / SCALE), qtyR, b, 9.5, 'regular', SOFT, 'right');
    if (withTax) text(formatRate(Math.max(0, parseScaled(it.tax, 4) ?? 0)), taxR, b, 9.5, 'regular', SOFT, 'right');
    const price = parseScaled(it.price, digits);
    if (price !== null) text(f.money(price), priceR, b, 9.5, 'regular', SOFT, 'right');
    text(f.money(totals.lines[i] ?? 0), amountR, b, 9.5, 'regular', INK, 'right');
    y += h;
    if (tpl !== 'modern') line(M, y, W - M);
    row++;
  });
  onBreak = null;

  /* ---------- totals ---------- */
  const rows: [string, string][] = [['Subtotal', f.money(totals.subtotal)]];
  if (totals.discount) {
    const pct = parseScaled(inv.discount, 4);
    rows.push([inv.discountKind === 'percent' && pct ? `Discount (${formatRate(pct)})` : 'Discount', f.money(-totals.discount)]);
  }
  for (const t of totals.taxes) rows.push([`${inv.taxLabel.trim() || 'Tax'} ${formatRate(t.rate)}`, f.money(t.amount)]);
  const final: [string, string] = totals.paid ? ['Balance due', f.money(totals.due)] : ['Total', f.money(totals.total)];
  if (totals.paid) rows.push(['Total', f.money(totals.total)], ['Paid', f.money(-totals.paid)]);

  const tx = W - M - 230;
  y += 14;
  ensure(rows.length * 19 + 52);
  for (const [k, v] of rows) {
    y += 19;
    text(k, tx + pad, y, 9, 'regular', SOFT);
    text(v, amountR, y, 9.5, 'regular', INK, 'right');
  }
  y += 12;
  if (tpl === 'modern') {
    ops.push({ t: 'rect', x: tx, y, w: W - M - tx, h: 32, color: accent });
    text(final[0], tx + pad, y + 20, 10, 'bold', onAccent);
    text(final[1], amountR, y + 21, 13, 'bold', onAccent, 'right');
    y += 32;
  } else {
    line(tx, y, W - M, tpl === 'classic' ? accent : INK, tpl === 'classic' ? 1.1 : 0.7);
    if (tpl === 'classic') line(tx, y + 2.5, W - M, accent, 0.5);
    text(final[0], tx, y + 22, 10, 'bold', INK);
    text(final[1], W - M, y + 23, 13, 'bold', tpl === 'classic' ? accent : INK, 'right');
    y += 32;
  }

  /* ---------- notes, payment details, terms ---------- */
  y += 18;
  for (const [k, v] of [['Payment details', inv.payment], ['Notes', inv.notes], ['Terms', inv.terms]] as const) {
    const body = lines(v, CW, 9, 200);
    if (!body.length) continue;
    ensure(9 + 2 * 13 + 10);
    y += 12;
    text(label(k), M, y, 7.5, 'bold', labelColor);
    y += 4;
    for (const s of body) {
      ensure(13);
      y += 13;
      text(s, M, y, 9, 'regular', SOFT);
    }
    y += 12;
  }

  if (pages.length > 1) {
    const ref = inv.number.trim() ? `${inv.number.trim()} · ` : '';
    pages.forEach((p, i) => {
      ops = p;
      text(`${ref}Page ${i + 1} of ${pages.length}`, W / 2, H - 28, 7.5, 'regular', FAINT, 'center');
    });
  }

  return { width: W, height: H, pages };
}
