/*
 * Barcode formats offered by the generator, with validation that mirrors what
 * JsBarcode accepts, plus friendly check-digit help (add it, or point out a wrong one).
 */

export type FormatId = 'CODE128' | 'EAN13' | 'EAN8' | 'UPC' | 'UPCE' | 'CODE39' | 'ITF14' | 'MSI' | 'codabar' | 'pharmacode';
export type MsiCheck = 'MSI' | 'MSI10' | 'MSI11' | 'MSI1010' | 'MSI1110';

export interface FormatInfo {
  id: FormatId;
  label: string;
  /** what it's typically used for */
  use: string;
  placeholder: string;
}

export const formats: FormatInfo[] = [
  { id: 'CODE128', label: 'Code 128', use: 'Shipping labels, inventory and anything with letters', placeholder: 'SKU-10442' },
  { id: 'EAN13', label: 'EAN-13', use: 'Retail products worldwide', placeholder: '590123412345' },
  { id: 'EAN8', label: 'EAN-8', use: 'Small retail packages', placeholder: '9638507' },
  { id: 'UPC', label: 'UPC-A', use: 'Retail products in the US and Canada', placeholder: '03600029145' },
  { id: 'UPCE', label: 'UPC-E', use: 'Small US retail packages', placeholder: '654321' },
  { id: 'CODE39', label: 'Code 39', use: 'ID badges, industry and government labels', placeholder: 'CODE-39' },
  { id: 'ITF14', label: 'ITF-14', use: 'Outer cartons and cases of products', placeholder: '1540014128876' },
  { id: 'MSI', label: 'MSI', use: 'Warehouse shelves and retail inventory', placeholder: '1234567' },
  { id: 'codabar', label: 'Codabar', use: 'Libraries, blood banks and parcel services', placeholder: 'A40156B' },
  { id: 'pharmacode', label: 'Pharmacode', use: 'Pharmaceutical packaging control', placeholder: '1234' },
];

export const formatById = Object.fromEntries(formats.map((f) => [f.id, f])) as Record<FormatId, FormatInfo>;

export interface Options {
  /** which MSI check digit scheme to use */
  msi?: MsiCheck;
  /** add Code 39's optional mod 43 check character */
  mod43?: boolean;
}

export interface Check {
  ok: boolean;
  /** the value to hand to JsBarcode */
  value: string;
  /** explanation: an error when !ok, otherwise an optional note */
  message: string;
  /** a corrected value the user can switch to in one click */
  fix?: string;
}

const ok = (value: string, message = ''): Check => ({ ok: true, value, message });
const bad = (value: string, message: string, fix?: string): Check => ({ ok: false, value, message, fix });

/** GS1 check digit (EAN, UPC, ITF-14): weights 3,1,3… from the right */
export function gs1CheckDigit(body: string) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = +body[body.length - 1 - i];
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

const UPCE_EXPANSIONS = ['XX00000XXX', 'XX10000XXX', 'XX20000XXX', 'XXX00000XX', 'XXXX00000X', 'XXXXX00005', 'XXXXX00006', 'XXXXX00007', 'XXXXX00008', 'XXXXX00009'];

/** expands the 6 middle digits of a UPC-E code to the full 12-digit UPC-A */
export function upcEToA(middle: string, numberSystem = '0') {
  const pattern = UPCE_EXPANSIONS[+middle[5]];
  let i = 0;
  const body = numberSystem + pattern.replace(/X/g, () => middle[i++]);
  return body + gs1CheckDigit(body);
}

/** MSI mod 10 (Luhn-style), as JsBarcode computes it */
export function msiMod10(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = +digits[i];
    if ((i + digits.length) % 2 === 0) sum += n;
    else sum += ((n * 2) % 10) + Math.floor((n * 2) / 10);
  }
  return (10 - (sum % 10)) % 10;
}

/** MSI mod 11 with IBM weights 2–7; can be 10, which prints as two digits */
export function msiMod11(digits: string) {
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += weights[i % weights.length] * +digits[digits.length - 1 - i];
  return (11 - (sum % 11)) % 11;
}

/** the digits JsBarcode appends for each MSI scheme */
export function msiSuffix(digits: string, scheme: MsiCheck) {
  switch (scheme) {
    case 'MSI': return '';
    case 'MSI10': return `${msiMod10(digits)}`;
    case 'MSI11': return `${msiMod11(digits)}`;
    case 'MSI1010': {
      const a = `${msiMod10(digits)}`;
      return a + msiMod10(digits + a);
    }
    case 'MSI1110': {
      const a = `${msiMod11(digits)}`;
      return a + msiMod10(digits + a);
    }
  }
}

const CODE39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

export function code39Mod43(value: string) {
  let sum = 0;
  for (const c of value) sum += CODE39_CHARS.indexOf(c);
  return CODE39_CHARS[sum % 43];
}

/** characters in `value` that aren't allowed, each listed once */
function stray(value: string, allowed: RegExp) {
  return [...new Set([...value].filter((c) => !allowed.test(c)))];
}

function listChars(chars: string[]) {
  return chars.map((c) => (c === ' ' ? 'space' : `"${c}"`)).join(', ');
}

/** fixed-length GS1 codes: accept the body (we add the check digit) or the full code (we verify it) */
function gs1(digits: string, name: string, length: number): Check {
  if (!digits) return bad('', `Enter ${length - 1} digits.`);
  const extra = stray(digits, /\d/);
  if (extra.length) return bad(digits, `${name} can only contain digits, not ${listChars(extra)}.`);
  if (digits.length === length - 1) {
    const d = gs1CheckDigit(digits);
    return ok(digits + d, `Check digit ${d} added: ${digits + d}`);
  }
  if (digits.length === length) {
    const d = gs1CheckDigit(digits.slice(0, -1));
    const last = +digits[length - 1];
    if (d === last) return ok(digits, 'Check digit is correct.');
    return bad(digits, `The last digit is the check digit and should be ${d}, not ${last}.`, digits.slice(0, -1) + d);
  }
  return bad(digits, `${name} needs ${length - 1} digits (the check digit is added for you), or all ${length} with the check digit. You entered ${digits.length}.`);
}

export function check(format: FormatId, raw: string, opts: Options = {}): Check {
  const value = raw.trim();
  // spaces and dashes are common in printed numbers but aren't part of numeric codes
  const digits = value.replace(/[\s-]/g, '');

  switch (format) {
    case 'CODE128': {
      if (!value) return bad('', 'Enter some text or numbers.');
      const extra = stray(value, /[\x00-\x7F]/);
      if (extra.length) return bad(value, `Code 128 only holds basic ASCII characters: letters A–Z, digits and common symbols. Remove ${listChars(extra)}.`);
      return ok(value);
    }
    case 'EAN13': return gs1(digits, 'EAN-13', 13);
    case 'EAN8': return gs1(digits, 'EAN-8', 8);
    case 'UPC': return gs1(digits, 'UPC-A', 12);
    case 'ITF14': return gs1(digits, 'ITF-14', 14);
    case 'UPCE': {
      if (!digits) return bad('', 'Enter 6 digits.');
      const extra = stray(digits, /\d/);
      if (extra.length) return bad(digits, `UPC-E can only contain digits, not ${listChars(extra)}.`);
      if (digits.length === 6) return ok(digits, `Reads as UPC-A ${upcEToA(digits)}.`);
      if ((digits.length === 7 || digits.length === 8) && /^[01]/.test(digits)) {
        const full = upcEToA(digits.slice(1, 7), digits[0]);
        const d = full[11];
        if (digits.length === 7) return ok(digits + d, `Check digit ${d} added: ${digits + d}`);
        if (digits[7] === d) return ok(digits, `Check digit is correct. Reads as UPC-A ${full}.`);
        return bad(digits, `The last digit is the check digit and should be ${d}, not ${digits[7]}.`, digits.slice(0, 7) + d);
      }
      if (digits.length === 7 || digits.length === 8) return bad(digits, 'An 8-digit UPC-E code starts with number system 0 or 1.');
      return bad(digits, `UPC-E needs 6 digits, or 8 with the number system and check digit. You entered ${digits.length}.`);
    }
    case 'CODE39': {
      if (!value) return bad('', 'Enter some text or numbers.');
      const upper = value.toUpperCase();
      const extra = stray(upper, /[0-9A-Z\-. $/+%]/);
      if (extra.length) return bad(upper, `Code 39 only holds A–Z, 0–9, space and - . $ / + %. Remove ${listChars(extra)}.`);
      const notes = [];
      if (upper !== value) notes.push('Code 39 has no lowercase, so letters print as capitals.');
      if (opts.mod43) notes.push(`Check character "${code39Mod43(upper)}" added.`);
      return ok(upper, notes.join(' '));
    }
    case 'MSI': {
      if (!digits) return bad('', 'Enter some digits.');
      const extra = stray(digits, /\d/);
      if (extra.length) return bad(digits, `MSI can only contain digits, not ${listChars(extra)}.`);
      const suffix = msiSuffix(digits, opts.msi ?? 'MSI10');
      return ok(digits, suffix ? `Check digits added: ${digits}${suffix}` : '');
    }
    case 'codabar': {
      if (!value) return bad('', 'Enter some digits.');
      const upper = value.toUpperCase();
      if (/^[0-9\-$:.+/]+$/.test(upper)) return ok(upper, `Start and stop characters added: A${upper}A`);
      if (/^[A-D][0-9\-$:.+/]+[A-D]$/.test(upper)) return ok(upper);
      const body = upper.replace(/^[A-D]|[A-D]$/g, '');
      const extra = stray(body, /[0-9\-$:.+/]/);
      if (extra.length) return bad(upper, `Codabar only holds 0–9 and - $ : . + /, with optional A–D at the start and end. Remove ${listChars(extra)}.`);
      return bad(upper, 'Use a start and a stop letter (A–D) together, or neither.');
    }
    case 'pharmacode': {
      if (!/^\d+$/.test(digits)) return bad(digits, 'Pharmacode is a whole number from 3 to 131070.');
      const n = +digits;
      if (n < 3 || n > 131070) return bad(digits, `Pharmacode is a whole number from 3 to 131070. ${n} is out of range.`);
      return ok(String(n));
    }
  }
}

/** the JsBarcode format name, since MSI has one per check digit scheme */
export function jsFormat(format: FormatId, opts: Options = {}) {
  return format === 'MSI' ? (opts.msi ?? 'MSI10') : format;
}

export interface BatchLine extends Check {
  /** 1-based line number in the input */
  line: number;
}

/** checks one value per line, skipping blank lines */
export function checkBatch(text: string, format: FormatId, opts: Options = {}): BatchLine[] {
  const out: BatchLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim()) out.push({ ...check(format, raw, opts), line: i + 1 });
  });
  return out;
}

/** a safe file name for a barcode: "SKU 10/44" → "SKU-10-44.png" */
export function fileNameFor(value: string, ext: string) {
  const base = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60);
  return `${base || 'barcode'}.${ext}`;
}
