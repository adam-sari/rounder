import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { getText, loadPdfjs, openPdf, textToString } from '@/engines/pdf';
import { appearanceTransform, fillForm, fontSizeFromDA, prettyName, readForm, type Change, type FormField } from '@/tools/lib/fill-pdf-form/form';
import { fontTexts, isFilled, sameValue } from '@/tools/lib/fill-pdf-form/values';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`));

beforeAll(async () => {
  // as in pdf-pdfjs.test.ts: pdf.js runs its worker in-process in node
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
});

/** A form with one of everything, including a field shown on two pages */
async function richForm() {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const form = doc.getForm();

  const name = form.createTextField('applicant.full_name');
  name.addToPage(p1, { x: 100, y: 700, width: 300, height: 24 });
  name.addToPage(p2, { x: 100, y: 740, width: 300, height: 24 });

  const zip = form.createTextField('zip');
  zip.setMaxLength(5);
  zip.enableCombing();
  zip.addToPage(p1, { x: 100, y: 650, width: 100, height: 24 });

  const notes = form.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(p1, { x: 100, y: 520, width: 300, height: 100 });
  notes.setFontSize(10);

  const fixed = form.createTextField('reference');
  fixed.setText('REF-42');
  fixed.enableReadOnly();
  fixed.addToPage(p1, { x: 420, y: 700, width: 120, height: 24 });

  const country = form.createDropdown('country');
  country.addOptions(['Canada', 'Greece', 'Poland']);
  country.enableEditing();
  country.addToPage(p1, { x: 100, y: 470, width: 200, height: 24 });

  const langs = form.createOptionList('languages');
  langs.addOptions(['English', 'French', 'German']);
  langs.enableMultiselect();
  langs.addToPage(p1, { x: 100, y: 380, width: 200, height: 70 });

  const size = form.createRadioGroup('size');
  size.addOptionToPage('S', p1, { x: 100, y: 340, width: 16, height: 16 });
  size.addOptionToPage('M', p1, { x: 140, y: 340, width: 16, height: 16 });

  const agree = form.createCheckBox('agree');
  agree.addToPage(p1, { x: 100, y: 300, width: 16, height: 16 });
  agree.enableRequired();

  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  return doc.save();
}

const byName = (fields: FormField[], name: string) => fields.find((f) => f.name === name)!;

async function notoFont(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  return doc.embedFont(readFileSync('public/fonts/pdf/NotoSans-Regular.ttf'), { subset: true });
}

describe('readForm', () => {
  it('reads the foundation sample form', async () => {
    const { fields, xfa } = readForm(await PDFDocument.load(fixture('sample-form.pdf')));
    expect(xfa).toBe(false);
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ['name', 'text'],
      ['email', 'text'],
      ['notes', 'text'],
      ['country', 'dropdown'],
      ['size', 'radio'],
      ['agree', 'checkbox'],
    ]);
    expect(byName(fields, 'notes').multiline).toBe(true);
    expect(byName(fields, 'country').options).toContain('Germany');
    const size = byName(fields, 'size');
    expect(size.options).toEqual(['S', 'M', 'L']);
    expect(size.widgets.map((w) => w.option)).toEqual(['S', 'M', 'L']);
    expect(byName(fields, 'name').widgets[0]).toEqual({ page: 0, rect: [179.5, 671.5, 480.5, 698.5] }); // pdf-lib grows the rect by half the border
  });

  it('reads every field type, flags and multi-page widgets', async () => {
    const { fields } = readForm(await PDFDocument.load(await richForm()));
    const name = byName(fields, 'applicant.full_name');
    expect(name.label).toBe('Full name');
    expect(name.widgets.map((w) => w.page)).toEqual([0, 1]);
    expect(byName(fields, 'zip')).toMatchObject({ comb: true, maxLength: 5 });
    expect(byName(fields, 'notes')).toMatchObject({ multiline: true, fontSize: 10 });
    expect(byName(fields, 'reference')).toMatchObject({ readOnly: true, value: 'REF-42' });
    expect(byName(fields, 'country')).toMatchObject({ kind: 'dropdown', editable: true, value: '' });
    expect(byName(fields, 'languages')).toMatchObject({ kind: 'list', multiSelect: true, value: [] });
    expect(byName(fields, 'agree')).toMatchObject({ kind: 'checkbox', required: true, value: false });
  });

  it('reports no fields for a flat PDF, without adding a form', async () => {
    const doc = await PDFDocument.load(fixture('sample-3-pages.pdf'));
    expect(readForm(doc)).toEqual({ fields: [], xfa: false, signatures: 0 });
    expect(doc.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  });

  it('flags XFA forms', async () => {
    const doc = await PDFDocument.load(fixture('sample-form.pdf'));
    doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('XFA'), doc.context.obj([]));
    const info = readForm(doc);
    expect(info.xfa).toBe(true);
    expect(info.fields).toHaveLength(6);
  });

  it('dedupes repeated options and skips zero-area widgets', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const pick = form.createDropdown('pick');
    pick.addToPage(page, { x: 100, y: 700, width: 200, height: 24 });
    pick.acroField.dict.set(PDFName.of('Opt'), doc.context.obj(['A', 'B', 'A', ' '].map((t) => PDFHexString.fromText(t))));
    const total = form.createTextField('total');
    total.addToPage(page, { x: 0, y: 0, width: 0, height: 0, borderWidth: 0 });
    const { fields } = readForm(await PDFDocument.load(await doc.save()));
    expect(byName(fields, 'pick').options).toEqual(['A', 'B', ' ']);
    expect(byName(fields, 'total').widgets).toEqual([]);
  });

  it('treats a dynamic XFA form as XFA-only, even with AcroForm fields', async () => {
    const doc = await PDFDocument.load(fixture('sample-form.pdf'));
    doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('XFA'), doc.context.obj([]));
    doc.catalog.set(PDFName.of('NeedsRendering'), doc.context.obj(true));
    expect(readForm(doc)).toEqual({ fields: [], xfa: true, signatures: 0 });
  });

  it('spots a pure XFA form: an XFA packet and no AcroForm fields', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [], XFA: [] }));
    expect(readForm(doc)).toEqual({ fields: [], xfa: true, signatures: 0 });
  });
});

describe('fillForm', () => {
  it('fills every field type and keeps them editable', async () => {
    const bytes = await richForm();
    const { fields } = readForm(await PDFDocument.load(bytes));
    const doc = await PDFDocument.load(bytes);
    const values: Record<string, Change['value']> = {
      'applicant.full_name': 'Zoë Ελένη Łukasz',
      zip: '1234567',
      notes: 'Line one\nLine two',
      reference: 'hacked',
      country: 'Iceland',
      languages: ['French', 'German'],
      size: 'M',
      agree: true,
    };
    const changes = fields.map((f) => ({ index: f.index, name: f.name, value: values[f.name] }));
    const failed = fillForm(doc, changes, { font: await notoFont(doc) });
    expect(failed).toEqual([]);

    const out = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    const form = out.getForm();
    expect(form.getTextField('applicant.full_name').getText()).toBe('Zoë Ελένη Łukasz');
    expect(form.getTextField('zip').getText()).toBe('12345'); // cut to MaxLen
    expect(form.getTextField('notes').getText()).toBe('Line one\nLine two');
    expect(form.getTextField('reference').getText()).toBe('REF-42'); // read-only stays
    expect(form.getDropdown('country').getSelected()).toEqual(['Iceland']);
    expect(form.getOptionList('languages').getSelected()).toEqual(['French', 'German']);
    expect(form.getRadioGroup('size').getSelected()).toBe('M');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
  });

  it("keeps each field's own /DA (font and auto size) for later edits in other apps", async () => {
    const src = await PDFDocument.create();
    const field = src.getForm().createTextField('city');
    field.addToPage(src.addPage([612, 792]), { x: 100, y: 700, width: 200, height: 24 });
    field.acroField.setDefaultAppearance('/Helv 0 Tf 0 g');
    const doc = await PDFDocument.load(await src.save({ updateFieldAppearances: false }));
    const { fields } = readForm(doc);
    expect(fillForm(doc, [{ index: fields[0].index, name: 'city', value: 'Αθήνα' }], { font: await notoFont(doc) })).toEqual([]);
    const city = doc.getForm().getTextField('city');
    expect(city.acroField.getDefaultAppearance()).toBe('/Helv 0 Tf 0 g');
    expect(city.acroField.getWidgets()[0].getDefaultAppearance()).toBeUndefined();
    expect(city.acroField.getWidgets()[0].getNormalAppearance()).toBeDefined();
  });

  it('clears values', async () => {
    const doc = await PDFDocument.load(fixture('sample-form.pdf'));
    const { fields } = readForm(doc);
    fillForm(doc, [{ index: byName(fields, 'size').index, name: 'size', value: 'L' }], { font: await doc.embedFont(StandardFonts.Helvetica) });
    fillForm(doc, [{ index: byName(fields, 'size').index, name: 'size', value: '' }], { font: await doc.embedFont(StandardFonts.Helvetica) });
    expect(doc.getForm().getRadioGroup('size').getSelected()).toBeUndefined();
  });

  it('flattens: no fields left, values drawn into the page', async () => {
    const bytes = await richForm();
    const doc = await PDFDocument.load(bytes);
    const { fields } = readForm(doc);
    const name = byName(fields, 'applicant.full_name');
    fillForm(doc, [{ index: name.index, name: name.name, value: 'Ada Lovelace' }], { font: await doc.embedFont(StandardFonts.Helvetica), flatten: true });
    const out = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    expect(out.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(readForm(out).fields).toEqual([]);
    for (const page of out.getPages()) {
      expect(page.node.Annots()?.size() ?? 0).toBe(0);
      const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
      expect(xobjects?.keys().length).toBeGreaterThan(0);
    }
  });

  it('flattened Unicode text is real text where the field was, on every page it appeared', async () => {
    const doc = await PDFDocument.load(await richForm());
    const { fields } = readForm(doc);
    const name = byName(fields, 'applicant.full_name');
    fillForm(doc, [{ index: name.index, name: name.name, value: 'Zoë Ελένη Łukasz' }], { font: await notoFont(doc), flatten: true });
    const pdf = await openPdf(await doc.save({ updateFieldAppearances: false }));
    for (const [page, top] of [[0, 792 - 724], [1, 792 - 764]]) {
      const { items } = await getText(pdf, page);
      expect(textToString(items)).toContain('Zoë Ελένη Łukasz');
      const item = items.find((i) => i.str.includes('Zoë'))!;
      expect(item.x).toBeGreaterThan(100);
      const middle = item.y + item.height / 2;
      expect(middle).toBeGreaterThan(top);
      expect(middle).toBeLessThan(top + 24);
    }
    await pdf.destroy();
  });

  it('shows paired choices by their text but saves their export value', async () => {
    const src = await PDFDocument.create();
    const page = src.addPage([612, 792]);
    const state = src.getForm().createDropdown('state');
    state.addToPage(page, { x: 100, y: 700, width: 200, height: 24 });
    state.acroField.dict.set(PDFName.of('Opt'), src.context.obj([[PDFHexString.fromText('CA'), PDFHexString.fromText('California')], [PDFHexString.fromText('NY'), PDFHexString.fromText('New York')]]));
    state.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('CA'));
    src.getForm().updateFieldAppearances(await src.embedFont(StandardFonts.Helvetica));
    const bytes = await src.save();

    const doc = await PDFDocument.load(bytes);
    const field = readForm(doc).fields[0];
    expect(field).toMatchObject({ options: ['California', 'New York'], value: 'California' });
    fillForm(doc, [{ index: field.index, name: 'state', value: 'New York' }], { font: await doc.embedFont(StandardFonts.Helvetica) });
    const saved = await doc.save({ updateFieldAppearances: false });
    expect((await PDFDocument.load(saved)).getForm().getDropdown('state').getSelected()).toEqual(['NY']);
    expect(readForm(await PDFDocument.load(saved)).fields[0].value).toBe('New York');

    const flat = await PDFDocument.load(saved);
    fillForm(flat, [], { font: await flat.embedFont(StandardFonts.Helvetica), flatten: true });
    const pdf = await openPdf(await flat.save({ updateFieldAppearances: false }));
    expect(textToString((await getText(pdf, 0)).items)).toContain('New York');
    await pdf.destroy();
  });

  it('drops XFA from the saved copy', async () => {
    const doc = await PDFDocument.load(fixture('sample-form.pdf'));
    doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('XFA'), doc.context.obj([]));
    fillForm(doc, [], { font: await doc.embedFont(StandardFonts.Helvetica) });
    expect(doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).has(PDFName.of('XFA'))).toBe(false);
  });
});

describe('helpers', () => {
  it('prettyName', () => {
    expect(prettyName('topmostSubform[0].Page1[0].first_name[0]')).toBe('First name');
    expect(prettyName('dateOfBirth')).toBe('Date of birth');
    expect(prettyName('applicant_SSN')).toBe('Applicant SSN');
    expect(prettyName('email')).toBe('Email');
  });
  it('fontSizeFromDA', () => {
    expect(fontSizeFromDA('/Helv 9 Tf 0 g')).toBe(9);
    expect(fontSizeFromDA('0 g /F1 0 Tf')).toBe(0);
    expect(fontSizeFromDA(undefined)).toBe(0);
  });
  it('appearanceTransform maps BBox (and Matrix) onto Rect', () => {
    expect(appearanceTransform([100, 200, 300, 220], [0, 0, 200, 20])).toEqual([1, 0, 0, 1, 100, 200]);
    expect(appearanceTransform([100, 200, 300, 220], [10, 5, 110, 15])).toEqual([2, 0, 0, 2, 80, 190]);
    // a 90° rotated appearance: its transformed box is 20 × 200, mapped onto a 20 × 200 rect
    const m = appearanceTransform([0, 0, 20, 200], [0, 0, 200, 20], [0, 1, -1, 0, 20, 0]);
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it('sameValue, isFilled, fontTexts', () => {
    expect(sameValue(['a'], ['a'])).toBe(true);
    expect(sameValue(['a'], ['b'])).toBe(false);
    expect(sameValue('x', 'x')).toBe(true);
    expect(isFilled('  ')).toBe(false);
    expect(isFilled([])).toBe(false);
    expect(isFilled(true)).toBe(true);
    const f = { kind: 'dropdown', options: ['Ελλάδα'] } as FormField;
    const c = { kind: 'checkbox', options: [] as string[] } as FormField;
    expect(fontTexts([f, c], ['Polska', true])).toEqual(['Polska', 'Ελλάδα']);
  });
});
