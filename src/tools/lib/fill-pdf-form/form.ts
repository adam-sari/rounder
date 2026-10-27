import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFBool,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
  popGraphicsState,
  pushGraphicsState,
  TextAlignment,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
  type PDFWidgetAnnotation,
} from 'pdf-lib';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';
/** text, dropdown and radio: string ('' = empty); checkbox: boolean; option list: string[] */
export type FieldValue = string | boolean | string[];
export type Rect = [x1: number, y1: number, x2: number, y2: number];

export interface Widget {
  /** 0-based page, or -1 when the widget isn't on any page */
  page: number;
  /** PDF user space, normalized so x1 < x2 and y1 < y2 */
  rect: Rect;
  /** radio buttons: the option this button selects */
  option?: string;
}

export interface FormField {
  /** position in form.getFields(), stable for the same bytes */
  index: number;
  name: string;
  label: string;
  kind: FieldKind;
  value: FieldValue;
  readOnly: boolean;
  required: boolean;
  /** dropdown, list and radio choices, as shown */
  options: string[];
  multiline: boolean;
  maxLength?: number;
  comb: boolean;
  password: boolean;
  /** a dropdown that also accepts its own text */
  editable: boolean;
  multiSelect: boolean;
  align: 'left' | 'center' | 'right';
  /** from the field's default appearance, in points; 0 = auto-fit */
  fontSize: number;
  widgets: Widget[];
}

export interface FormInfo {
  fields: FormField[];
  /** the file carries an XFA (Adobe LiveCycle) form */
  xfa: boolean;
  /** signature fields, which this tool leaves for Sign PDF */
  signatures: number;
}

const XFA = PDFName.of('XFA');
const HIDDEN = 1 << 1;
const NO_VIEW = 1 << 5;

function acroFormDict(doc: PDFDocument) {
  return doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
}

/** pdf-lib drops XFA on getForm() with a console warning; doing it ourselves keeps the console clean */
function formWithoutXfa(doc: PDFDocument): PDFForm {
  acroFormDict(doc)?.delete(XFA);
  return doc.getForm();
}

type PageMap = Map<PDFDict, { page: number; ref?: PDFRef }>;

/** annotation dict → its page and ref; pdf-lib hands out one PDFDict instance per object, so identity works */
function widgetPages(doc: PDFDocument): PageMap {
  const map: PageMap = new Map();
  doc.getPages().forEach((page, i) => {
    const annots = page.node.Annots();
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const raw = annots!.get(k);
      const d = annots!.lookup(k);
      if (d instanceof PDFDict) map.set(d, { page: i, ref: raw instanceof PDFRef ? raw : undefined });
    }
  });
  return map;
}

function pageOf(doc: PDFDocument, pages: PageMap, widget: PDFWidgetAnnotation) {
  const found = pages.get(widget.dict);
  if (found) return found.page;
  const ref = widget.P();
  return ref ? doc.getPages().findIndex((p) => p.ref === ref) : -1;
}

export function normalizeRect(r: number[]): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** "/Helv 9 Tf 0 g" → 9; 0 means auto-size */
export function fontSizeFromDA(da: string | undefined): number {
  const m = da?.match(/([\d.]+)\s+Tf\b/);
  return m ? Number(m[1]) || 0 : 0;
}

/** "topmostSubform[0].Page1[0].first_name[0]" → "First name" */
export function prettyName(name: string): string {
  const last = name.split('.').filter(Boolean).pop() ?? name;
  const words = last
    .replace(/\[\d+\]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    // sentence case, but acronyms such as SSN stay as they are
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  return words.length ? words.join(' ') : name;
}

function textOf(obj: unknown) {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText().trim() : '';
}

function kindOf(field: PDFField): FieldKind | null {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  return null; // push buttons and signatures
}

type Choice = PDFDropdown | PDFOptionList;

/**
 * Choice options can be [export value, shown text] pairs. pdf-lib works in
 * shown text but reads and draws the stored export value, so these translate.
 */
function choiceText(field: Choice) {
  const pairs = field.acroField.getOptions().map(({ value, display }) => [value.decodeText(), (display ?? value).decodeText()]);
  const toExport = (v: string) => (pairs.some(([e]) => e === v) ? v : (pairs.find(([, d]) => d === v)?.[0] ?? v));
  return {
    paired: pairs.some(([e, d]) => e !== d),
    toExport,
    toShown: (v: string) => pairs.find(([e]) => e === toExport(v))?.[1] ?? v,
  };
}

function setChoiceValue(field: Choice, values: string[]) {
  const V = PDFName.of('V');
  const hex = values.map((v) => PDFHexString.fromText(v));
  if (!hex.length) field.acroField.dict.delete(V);
  else field.acroField.dict.set(V, hex.length === 1 ? hex[0] : field.doc.context.obj(hex));
}

function valueOf(field: PDFField): FieldValue {
  try {
    if (field instanceof PDFTextField) return field.getText() ?? '';
    if (field instanceof PDFCheckBox) return field.isChecked();
    if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
    if (field instanceof PDFDropdown) return field.getSelected().map(choiceText(field).toShown)[0] ?? '';
    if (field instanceof PDFOptionList) return field.getSelected().map(choiceText(field).toShown);
  } catch {
    // rich-text fields can't be read by pdf-lib; they start empty
  }
  return field instanceof PDFCheckBox ? false : field instanceof PDFOptionList ? [] : '';
}

/** Reads the AcroForm fields, with each widget's page and rectangle */
export function readForm(doc: PDFDocument): FormInfo {
  const acro = acroFormDict(doc);
  if (!acro) return { fields: [], xfa: false, signatures: 0 };
  const xfa = acro.has(XFA);
  // dynamic XFA: the pages are only a "please wait" placeholder, so any AcroForm fields are meaningless
  if (xfa && doc.catalog.get(PDFName.of('NeedsRendering')) === PDFBool.True) return { fields: [], xfa, signatures: 0 };
  const formDA = textOf(acro.lookup(PDFName.of('DA')));
  const pages = widgetPages(doc);
  const fields: FormField[] = [];
  let signatures = 0;

  formWithoutXfa(doc).getFields().forEach((field, index) => {
    if (field instanceof PDFSignature) signatures++;
    const kind = kindOf(field);
    if (!kind) return;
    const acroField = field.acroField;
    const name = field.getName();
    const exportValues = field instanceof PDFRadioGroup ? field.acroField.getExportValues() : undefined;
    const widgets: Widget[] = [];
    let da = acroField.getDefaultAppearance();
    acroField.getWidgets().forEach((w, i) => {
      da ??= w.getDefaultAppearance();
      if (w.hasFlag(HIDDEN) || w.hasFlag(NO_VIEW)) return;
      const r = w.dict.lookup(PDFName.of('Rect'));
      if (!(r instanceof PDFArray) || r.size() < 4) return;
      const rect = normalizeRect(r.asArray().slice(0, 4).map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)));
      // zero-area widgets (common for calculated or hidden helper fields) would be invisible tab stops
      if (rect[2] - rect[0] < 1 || rect[3] - rect[1] < 1) return;
      const widget: Widget = { page: pageOf(doc, pages, w), rect };
      if (kind === 'radio') widget.option = exportValues?.[i]?.decodeText() ?? w.getOnValue()?.decodeText();
      widgets.push(widget);
    });

    const text = field instanceof PDFTextField ? field : undefined;
    const choice = field instanceof PDFDropdown || field instanceof PDFOptionList ? field : undefined;
    const align = text?.getAlignment();
    // deduped: forms do repeat options, and the page keys its option lists by text
    const options = [...new Set(choice ? choice.getOptions() : field instanceof PDFRadioGroup ? field.getOptions().filter(Boolean) : [])];

    fields.push({
      index,
      name,
      label: textOf(acroField.dict.lookup(PDFName.of('TU'))) || prettyName(name),
      kind,
      value: valueOf(field),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      options,
      multiline: !!text?.isMultiline(),
      maxLength: text?.getMaxLength(),
      comb: !!text?.isCombed() && !!text.getMaxLength(),
      password: !!text?.isPassword(),
      editable: field instanceof PDFDropdown && field.isEditable(),
      multiSelect: !!choice?.isMultiselect(),
      align: align === TextAlignment.Center ? 'center' : align === TextAlignment.Right ? 'right' : 'left',
      fontSize: fontSizeFromDA(da ?? formDA),
      widgets,
    });
  });
  return { fields, xfa, signatures };
}

export interface Change {
  index: number;
  name: string;
  value: FieldValue;
}

/**
 * Writes the changed values into `doc`, regenerates their appearances with
 * `font` (so non-Latin text shows in every viewer) and optionally flattens.
 * Returns the names of fields whose appearance couldn't be drawn.
 */
export function fillForm(doc: PDFDocument, changes: Change[], { font, flatten = false }: { font: PDFFont; flatten?: boolean }): string[] {
  const form = formWithoutXfa(doc);
  const all = form.getFields();
  for (const { index, name, value } of changes) {
    const field = all[index]?.getName() === name ? all[index] : form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField) {
      const max = field.getMaxLength();
      const text = String(value);
      field.setText((max !== undefined ? text.slice(0, max) : text) || undefined);
    } else if (field instanceof PDFCheckBox) {
      if (value) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (value && field.getOptions().includes(String(value))) field.select(String(value));
      else field.clear();
    } else if (field instanceof PDFDropdown) {
      if (value) field.select(String(value));
      else field.clear();
    } else if (field instanceof PDFOptionList) {
      const picked = (value as string[]).filter((v) => field.getOptions().includes(v));
      if (picked.length) field.select(picked);
      else field.clear();
    }
  }

  // paired choices: shown text while appearances are drawn, export values in the saved file
  const paired = form.getFields().flatMap((field) => {
    if (!(field instanceof PDFDropdown || field instanceof PDFOptionList)) return [];
    const text = choiceText(field);
    const current = field.getSelected();
    if (!text.paired || !current.length) return [];
    setChoiceValue(field, current.map(text.toShown));
    return [() => setChoiceValue(field, current.map(text.toExport))];
  });

  // like form.updateFieldAppearances(font), but one odd field doesn't sink the rest
  const failed: string[] = [];
  const DA = PDFName.of('DA');
  for (const field of form.getFields()) {
    if (!field.needsAppearancesUpdate()) continue;
    // pdf-lib rewrites /DA with its embedded font's name (absent from the form's /DR) and the fitted
    // size, which viewers then use for later edits; the drawn appearance carries its own font, so keep the old /DA
    const dicts = [field.acroField.dict, ...field.acroField.getWidgets().map((w) => w.dict)];
    const das = dicts.map((d) => d.get(DA));
    try {
      field.defaultUpdateAppearances(font);
    } catch {
      failed.push(field.getName());
    }
    dicts.forEach((d, i) => (das[i] ? d.set(DA, das[i]) : d.delete(DA)));
  }
  for (const restore of paired) restore();
  if (flatten) flattenForm(doc, form);
  return failed;
}

/**
 * Maps an appearance stream onto its widget rectangle (PDF 32000 §12.5.5):
 * the BBox, transformed by the form's own Matrix, is scaled and moved onto
 * Rect. The viewer applies Matrix itself when drawing, so this is the cm to add.
 */
export function appearanceTransform(rect: Rect, bbox: number[], matrix: number[] = [1, 0, 0, 1, 0, 0]) {
  const [a, b, c, d, e, f] = matrix;
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const sx = (rect[2] - rect[0]) / (Math.max(...xs) - minX || 1);
  const sy = (rect[3] - rect[1]) / (Math.max(...ys) - minY || 1);
  return [sx, 0, 0, sy, rect[0] - minX * sx, rect[1] - minY * sy];
}

const numbers = (arr: PDFArray | undefined) => arr?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));

/** The widget's current normal appearance as an indirect stream, or undefined when it has none */
function appearanceOf(doc: PDFDocument, widget: PDFWidgetAnnotation): { ref: PDFRef; stream: PDFStream } | undefined {
  let n = widget.dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'));
  let resolved = n instanceof PDFRef ? doc.context.lookup(n) : n;
  if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
    // checkbox / radio: one appearance per state
    n = resolved.get(widget.getAppearanceState() ?? PDFName.of('Off'));
    resolved = n instanceof PDFRef ? doc.context.lookup(n) : n;
  }
  if (!(resolved instanceof PDFStream)) return undefined;
  return { ref: n instanceof PDFRef ? n : doc.context.register(resolved), stream: resolved };
}

/**
 * Draws every field's appearance into its page and removes the fields.
 * Written here rather than form.flatten() because that one throws on widgets
 * without an appearance, ignores BBox/Matrix, and leaves kid widgets in /Annots.
 */
function flattenForm(doc: PDFDocument, form: PDFForm) {
  const pages = doc.getPages();
  const pageMap = widgetPages(doc);
  const wrapped = new Set<number>();
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const pageIndex = pageOf(doc, pageMap, widget);
      const page = pages[pageIndex];
      if (!page) continue;
      const ref = pageMap.get(widget.dict)?.ref;
      if (ref) page.node.removeAnnot(ref);
      const ap = widget.hasFlag(HIDDEN) || widget.hasFlag(NO_VIEW) ? undefined : appearanceOf(doc, widget);
      const rect = numbers(widget.dict.lookupMaybe(PDFName.of('Rect'), PDFArray));
      const bbox = numbers(ap?.stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray));
      if (!ap || !rect || rect.length < 4 || !bbox || bbox.length < 4) continue;
      if (!wrapped.has(pageIndex)) {
        // keep whatever graphics state the page content leaves behind from shifting the stamps
        page.node.normalize();
        page.node.wrapContentStreams(doc.context.register(doc.context.stream('q')), doc.context.register(doc.context.stream('Q')));
        wrapped.add(pageIndex);
      }
      const name = page.node.newXObject('FlatWidget', ap.ref);
      const m = appearanceTransform(normalizeRect(rect), bbox, numbers(ap.stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(name), popGraphicsState());
    }
    try {
      form.acroForm.removeField(field.acroField);
    } catch {
      // not listed where its parent says; its widgets are already off the pages
    }
  }
  // nothing left to fill, so viewers shouldn't offer a form
  if (!form.getFields().length) doc.catalog.delete(PDFName.of('AcroForm'));
}
