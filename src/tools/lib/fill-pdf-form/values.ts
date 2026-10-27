// Kept apart from form.ts so the page can use these without loading pdf-lib
import type { FieldValue, FormField } from './form';

export function sameValue(a: FieldValue, b: FieldValue) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

export function isFilled(v: FieldValue) {
  return Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v;
}

/** Every string the saved appearances may draw, to pick a font that can draw them all */
export function fontTexts(fields: FormField[], values: FieldValue[]): string[] {
  return fields.flatMap((f, i) => {
    if (f.kind === 'checkbox' || f.kind === 'radio') return [];
    const v = values[i];
    return [...(Array.isArray(v) ? v : [String(v)]), ...f.options];
  });
}

/** Type size in points for the on-page input: the field's own, else roughly what viewers auto-fit to */
export function overlayFontPt(field: Pick<FormField, 'fontSize' | 'multiline' | 'comb'>, heightPt: number) {
  if (field.fontSize) return field.fontSize;
  if (field.multiline) return Math.min(10, heightPt * 0.7);
  return Math.max(6, Math.min(field.comb ? 14 : 12, heightPt * 0.62));
}
