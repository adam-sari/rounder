import { embedFontWithFallback, loadEditablePdf, pdfName } from '@/engines/pdf';
import { fillForm as fill, readForm, type FieldValue, type FormField } from '@/tools/lib/fill-pdf-form/form';
import { fontTexts, isFilled } from '@/tools/lib/fill-pdf-form/values';
import { RounderError } from '../core/errors';
import type { Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type OpResult } from '../core/run';
import type * as ops from '../ops/pdf';

const fieldOut = (f: FormField) => ({
  name: f.name,
  ...(f.label && f.label !== f.name ? { label: f.label } : {}),
  type: f.kind,
  value: f.value,
  ...(f.options.length ? { options: f.options } : {}),
  ...(f.required ? { required: true } : {}),
  ...(f.readOnly ? { readOnly: true } : {}),
  ...(f.maxLength ? { maxLength: f.maxLength } : {}),
  ...(f.multiline ? { multiline: true } : {}),
  ...(f.multiSelect ? { multiSelect: true } : {}),
  pages: [...new Set(f.widgets.filter((w) => w.page >= 0).map((w) => w.page + 1))],
});

export async function formFields(inputs: Source[], o: OptionsOut<typeof ops.pdfFormFields>): Promise<OpResult> {
  const { doc } = await loadEditablePdf(await inputs[0].bytes(), { password: o.password });
  const form = readForm(doc);
  const warnings: string[] = [];
  if (form.xfa) warnings.push('This PDF also carries an XFA (Adobe LiveCycle) form. Only its regular fields are listed, and some viewers show the XFA version instead.');
  if (!form.fields.length) warnings.push(form.signatures ? 'The only fields are signature fields. Sign it on roundertools.com/sign-pdf.' : 'This PDF has no fillable fields. To write on it anyway, use roundertools.com/edit-pdf.');
  return result({ data: { fields: form.fields.map(fieldOut), ...(form.signatures ? { signatureFields: form.signatures } : {}) }, warnings });
}

/** the value as the field takes it: true/"yes"/"on" tick a checkbox, a multi-select list takes an array */
function coerceValue(f: FormField, v: unknown): FieldValue {
  if (f.kind === 'checkbox') return typeof v === 'boolean' ? v : /^(true|yes|on|1|x)$/i.test(String(v).trim());
  if (f.kind === 'list' && f.multiSelect) return Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim());
  return Array.isArray(v) ? v.map(String).join(', ') : String(v);
}

function parseValues(raw: OptionsOut<typeof ops.fillPdfForm>['values']): Record<string, unknown> {
  if (typeof raw !== 'string') return raw;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new RounderError('invalid-options', 'values must be a JSON object of field name → value, like {"Full name":"Jane Doe","Agree":true}.');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RounderError('invalid-options', 'values must be a JSON object of field name → value.');
  return v as Record<string, unknown>;
}

export async function fillForm(inputs: Source[], o: OptionsOut<typeof ops.fillPdfForm>): Promise<OpResult> {
  const [src] = inputs;
  const values = parseValues(o.values);
  const { doc } = await loadEditablePdf(await src.bytes(), { password: o.password });
  const form = readForm(doc);
  if (!form.fields.length) throw new RounderError('unsupported-input', 'This PDF has no fillable fields.', { hint: 'roundertools.com/edit-pdf can add text anywhere on a page.' });
  // the field's name as written first, then ignoring case and spacing, then its label (what people see)
  const norm = (s: string) => s.toLowerCase().replace(/[\s_.\-:]+/g, '');
  const find = (key: string) => form.fields.find((f) => f.name === key) ?? form.fields.find((f) => norm(f.name) === norm(key)) ?? form.fields.find((f) => f.label && norm(f.label) === norm(key));
  const changes: { index: number; name: string; value: FieldValue }[] = [];
  const unknown: string[] = [];
  const warnings: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const f = find(key);
    if (!f) {
      unknown.push(key);
      continue;
    }
    if (f.readOnly) {
      warnings.push(`"${f.name}" is read-only, so it was left as it was.`);
      continue;
    }
    let value = coerceValue(f, raw);
    if ((f.kind === 'radio' || f.kind === 'dropdown') && typeof value === 'string' && value && f.options.length && !f.editable && !f.options.includes(value)) {
      const match = f.options.find((x) => x.toLowerCase() === (value as string).toLowerCase());
      if (!match) throw new RounderError('invalid-options', `"${value}" isn't a choice for "${f.name}". Its choices: ${f.options.join(', ')}.`);
      value = match;
    }
    if (typeof value === 'string' && f.maxLength && value.length > f.maxLength) {
      warnings.push(`"${f.name}" takes at most ${f.maxLength} characters, so the rest was cut.`);
      value = value.slice(0, f.maxLength);
    }
    changes.push({ index: f.index, name: f.name, value });
  }
  if (unknown.length) {
    const names = form.fields.map((f) => f.name);
    throw new RounderError('invalid-options', `This form has no field called ${unknown.map((u) => `"${u}"`).join(', ')}. Its fields: ${names.slice(0, 40).join(', ')}${names.length > 40 ? '…' : ''}.`, { hint: 'List them with pdf-form-fields.' });
  }
  if (!changes.length) throw new RounderError('invalid-options', 'Nothing to fill: give at least one field and its value.');
  const filled = form.fields.map((f) => changes.find((c) => c.index === f.index)?.value ?? f.value);
  const font = await embedFontWithFallback(doc, fontTexts(form.fields, filled));
  const failed = fill(doc, changes, { font, flatten: o.flatten });
  if (failed.length) warnings.push(`These fields couldn't be filled: ${failed.join(', ')}.`);
  const missing = form.fields.filter((f, i) => f.required && !f.readOnly && !isFilled(filled[i])).map((f) => f.name);
  if (missing.length) warnings.push(`Required fields still empty: ${missing.join(', ')}.`);
  const data = await doc.save({ updateFieldAppearances: false });
  return result({ files: [new FileOutput({ name: pdfName(src.name, '-filled'), mime: 'application/pdf', data, meta: { filled: changes.length - failed.length, flattened: o.flatten }, warnings })] });
}
