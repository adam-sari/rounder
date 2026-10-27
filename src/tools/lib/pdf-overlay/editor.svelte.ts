import { decodeImage, imageKind } from '@/engines/image/client';
import { clampBox, fitInside, LINE_HEIGHT, normalizeInk, simplify, textLines } from './geometry';
import { cssFonts, formatDate, INK, type Asset, type Box, type DateFormat, type FontFamily, type ImageObj, type OverlayObject, type PageInfo, type TextObj } from './model';
import type { SigRole } from './saved';

export type Tool =
  | 'select'
  | 'text'
  | 'name'
  | 'date'
  | 'check'
  | 'cross'
  | 'signature'
  | 'initials'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'whiteout'
  | 'highlight'
  | 'line'
  | 'arrow'
  | 'ink';

/** tools that create something where you click */
export const clickTools: Tool[] = ['text', 'name', 'date', 'check', 'cross'];
/** tools that create something where you drag */
export const dragTools: Tool[] = ['rect', 'ellipse', 'whiteout', 'highlight', 'line', 'arrow', 'ink'];
/** these stay active after use, since you usually want several in a row */
export const stickyTools: Tool[] = ['check', 'cross', 'highlight', 'ink'];

export interface Style {
  text: { size: number; font: FontFamily; bold: boolean; color: string };
  shape: { fill: string | null; stroke: string | null; strokeWidth: number; opacity: number };
  line: { color: string; width: number };
  ink: { color: string; width: number };
  mark: { color: string };
  highlight: string;
  dateFormat: DateFormat;
}

/** an image waiting to be dropped where the person clicks */
export interface Pending {
  asset: string;
  w: number;
  h: number;
  role?: SigRole;
}

export interface Sig {
  id: string;
  role: SigRole;
  asset: string;
  /** stored on this device */
  saved: boolean;
}

let ids = 0;
const newId = (prefix = 'o') => `${prefix}${++ids}`;

let measurer: CanvasRenderingContext2D | null = null;

/** a text object's box, measured with the same fonts the screen uses */
export function measureText(o: Pick<TextObj, 'text' | 'size' | 'font' | 'bold'>) {
  measurer ??= document.createElement('canvas').getContext('2d');
  const lines = textLines(o.text);
  let w = 0;
  if (measurer) {
    measurer.font = `${o.bold ? 700 : 400} 100px ${cssFonts[o.font]}`;
    for (const l of lines) w = Math.max(w, measurer.measureText(l).width);
  }
  return { w: Math.max((w * o.size) / 100, o.size * 0.3), h: lines.length * o.size * LINE_HEIGHT };
}

export async function assetFromBlob(blob: Blob, type: Asset['type'], width: number, height: number): Promise<Asset> {
  return { url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), type, width, height };
}

/**
 * Any image the browser (or our decoder) can read, as PNG or JPEG for the PDF.
 * Upright JPEGs keep their original bytes; everything else is redrawn, which
 * also applies EXIF rotation so the picture isn't sideways in the PDF.
 */
export async function imageFileAsset(file: File): Promise<Asset> {
  const kind = await imageKind(file);
  if (kind === 'unknown') throw new Error(`${file.name} isn't an image we can read. Try a PNG or JPG.`);
  if (kind === 'jpeg') {
    const { default: exifr } = await import('exifr');
    const turn = await exifr.orientation(file).catch(() => 1);
    if (!turn || turn === 1) {
      const bmp = await createImageBitmap(file);
      const { width, height } = bmp;
      bmp.close();
      return assetFromBlob(file, 'jpg', width, height);
    }
  }
  const px = await decodeImage(file);
  // already-lossy photos become JPEG; PNG, GIF, SVG… stay lossless so text and logos stay crisp
  let jpg = kind === 'jpeg' || kind === 'webp' || kind === 'heic' || kind === 'avif';
  for (let i = 3; jpg && i < px.data.length; i += 4) if (px.data[i] < 255) jpg = false;
  const canvas = Object.assign(document.createElement('canvas'), { width: px.width, height: px.height });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This image is too large for your browser to handle.');
  ctx.putImageData(px, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.92));
  canvas.width = 0;
  if (!blob) throw new Error("This image couldn't be prepared. Try a PNG or JPG.");
  return assetFromBlob(blob, jpg ? 'jpg' : 'png', px.width, px.height);
}

/** Objects, selection, tools and undo history for one open PDF */
export class Editor {
  objects = $state<OverlayObject[]>([]);
  selected = $state<string | null>(null);
  /** the text object being typed into */
  editing = $state<string | null>(null);
  tool = $state<Tool>('select');
  pending = $state<Pending | null>(null);
  sigs = $state<Sig[]>([]);
  /** for the Name tool */
  name = $state('');
  date = $state(new Date());
  style = $state<Style>({
    text: { size: 12, font: 'sans', bold: false, color: INK },
    shape: { fill: null, stroke: '#d62828', strokeWidth: 2, opacity: 1 },
    line: { color: '#d62828', width: 2 },
    ink: { color: INK, width: 2 },
    mark: { color: INK },
    highlight: '#ffe066',
    dateFormat: 'mdy',
  });
  past = $state.raw<OverlayObject[][]>([]);
  future = $state.raw<OverlayObject[][]>([]);
  /** changed since the last download */
  dirty = $state(false);
  readonly assets = new Map<string, Asset>();

  #lastKey = '';
  #lastAt = 0;

  get current(): OverlayObject | null {
    return this.objects.find((o) => o.id === this.selected) ?? null;
  }

  find(id: string) {
    return this.objects.find((o) => o.id === id);
  }

  /** remembers the current state for undo; repeated changes with the same key within a moment count as one */
  checkpoint(key = '') {
    const now = Date.now();
    const same = key && key === this.#lastKey && now - this.#lastAt < 1000;
    this.#lastKey = key;
    this.#lastAt = now;
    this.dirty = true;
    if (same) return;
    this.past = [...this.past.slice(-99), $state.snapshot(this.objects) as OverlayObject[]];
    this.future = [];
  }

  add(o: OverlayObject) {
    this.checkpoint();
    this.objects.push(o);
    this.selected = o.id;
  }

  /** changes an object (text objects are re-measured), recording an undo step */
  update(id: string, patch: Partial<OverlayObject>, key?: string) {
    const o = this.find(id);
    if (!o) return;
    this.checkpoint(key ?? `${id}:${Object.keys(patch).join()}`);
    this.patch(o, patch);
  }

  /** changes an object without an undo step (live drags, typing: the step was taken when they began) */
  patch(o: OverlayObject, patch: Partial<OverlayObject>) {
    Object.assign(o, patch);
    if (o.kind === 'text' && ('text' in patch || 'size' in patch || 'font' in patch || 'bold' in patch)) Object.assign(o, measureText(o));
  }

  remove(id: string) {
    this.checkpoint();
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.selected === id) this.selected = null;
    if (this.editing === id) this.editing = null;
  }

  duplicate(id: string) {
    const o = this.find(id);
    if (!o) return;
    const copy = { ...($state.snapshot(o) as OverlayObject), id: newId() };
    if (copy.kind === 'line') Object.assign(copy, { x1: copy.x1 + 12, y1: copy.y1 + 12, x2: copy.x2 + 12, y2: copy.y2 + 12 });
    else Object.assign(copy, { x: copy.x + 12, y: copy.y + 12 });
    this.add(copy);
  }

  #restore(from: OverlayObject[][], to: 'past' | 'future') {
    const snap = from.at(-1);
    if (!snap) return false;
    this[to] = [...this[to], $state.snapshot(this.objects) as OverlayObject[]];
    this.objects = snap;
    this.editing = null;
    this.#lastKey = '';
    this.dirty = true;
    if (this.selected && !this.find(this.selected)) this.selected = null;
    return true;
  }

  undo() {
    if (this.#restore(this.past, 'future')) this.past = this.past.slice(0, -1);
  }

  redo() {
    if (this.#restore(this.future, 'past')) this.future = this.future.slice(0, -1);
  }

  startEditing(id: string) {
    this.checkpoint(`${id}:typing`);
    this.selected = id;
    this.editing = id;
  }

  /** leaves text editing; a text left empty disappears */
  stopEditing() {
    const o = this.editing ? this.find(this.editing) : undefined;
    this.editing = null;
    if (o?.kind === 'text' && !o.text.trim()) {
      this.objects = this.objects.filter((x) => x !== o);
      this.selected = null;
    }
  }

  addAsset(a: Asset) {
    const id = newId('a');
    this.assets.set(id, a);
    return id;
  }

  /** creates what a click tool makes, at point p (points) on a page */
  create(tool: Tool, page: number, p: { x: number; y: number }, info: PageInfo) {
    const s = this.style;
    if (tool === 'check' || tool === 'cross') {
      const size = 16;
      const box = clampBox({ x: p.x - size / 2, y: p.y - size / 2, w: size, h: size }, info.w, info.h);
      this.add({ id: newId(), page, kind: 'mark', mark: tool, color: s.mark.color, ...box });
      return;
    }
    const text = tool === 'name' ? this.name.trim() : tool === 'date' ? formatDate(this.date, s.dateFormat) : '';
    const o: TextObj = { id: newId(), page, kind: 'text', text, ...s.text, x: 0, y: 0, w: 0, h: 0 };
    const m = measureText(o);
    // the click lands in the middle of the first line
    Object.assign(o, clampBox({ x: p.x, y: p.y - (o.size * LINE_HEIGHT) / 2, ...m }, info.w, info.h));
    this.add(o);
    // no second undo step: undoing the typing should remove the box, not leave an invisible empty one
    if (!text) this.editing = o.id;
  }

  /** a shape from a drag between two points; a plain click gets a default size */
  createDragged(tool: Tool, page: number, a: { x: number; y: number }, b: { x: number; y: number }, info: PageInfo) {
    const s = this.style;
    if (tool === 'line' || tool === 'arrow') {
      const short = Math.hypot(b.x - a.x, b.y - a.y) < 3;
      const end = short ? { x: Math.min(a.x + 100, info.w), y: a.y } : b;
      this.add({ id: newId(), page, kind: 'line', x1: a.x, y1: a.y, x2: end.x, y2: end.y, arrow: tool === 'arrow', ...s.line });
      return;
    }
    let box: Box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    if (box.w < 3 || box.h < 3) {
      const [w, h] = tool === 'whiteout' ? [120, 24] : tool === 'highlight' ? [120, 14] : tool === 'ellipse' ? [100, 60] : [120, 60];
      box = clampBox({ x: a.x - w / 2, y: a.y - h / 2, w, h }, info.w, info.h);
    }
    const id = newId();
    if (tool === 'highlight') this.add({ id, page, kind: 'highlight', color: s.highlight, ...box });
    else if (tool === 'whiteout') this.add({ id, page, kind: 'rect', fill: '#ffffff', stroke: null, strokeWidth: 0, opacity: 1, ...box });
    else this.add({ id, page, kind: tool === 'ellipse' ? 'ellipse' : 'rect', ...s.shape, ...box });
  }

  /** one freehand stroke, points in page space */
  createInk(page: number, pts: number[]) {
    const { color, width } = this.style.ink;
    const { box, points } = normalizeInk(simplify(pts, 0.6), width);
    this.add({ id: newId(), page, kind: 'ink', points, color, width, ...box });
  }

  /** drops the pending image centred on p */
  place(page: number, p: { x: number; y: number }, info: PageInfo) {
    const pend = this.pending;
    if (!pend) return;
    const { w, h } = fitInside(pend.w, pend.h, info.w * 0.9, info.h * 0.9);
    const box = clampBox({ x: p.x - w / 2, y: p.y - h / 2, w, h }, info.w, info.h);
    const o: ImageObj = { id: newId(), page, kind: 'image', asset: pend.asset, opacity: 1, role: pend.role, ...box };
    this.add(o);
    this.pending = null;
    this.tool = 'select';
  }

  /** frees every image's object URL; call when the editor goes away */
  destroy() {
    for (const a of this.assets.values()) URL.revokeObjectURL(a.url);
    this.assets.clear();
  }
}
