/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { clip, endPath, PDFDocument, popGraphicsState, pushGraphicsState, rectangle } from 'pdf-lib';
import type { PageLayout } from './layout';

/*
 * Builds the PDF off the main thread: embedding PNGs (pdf-lib inflates and
 * re-deflates them) and saving a few hundred MB of photos would freeze the page.
 */
let doc: PDFDocument | null = null;

const api = {
  async start(title: string) {
    doc = await PDFDocument.create();
    doc.setTitle(title);
    doc.setCreator('Rounder');
  },

  /** throws "embed" when pdf-lib can't take these bytes as they are, so the caller can re-encode */
  async add(bytes: Uint8Array, type: 'jpg' | 'png', layout: PageLayout) {
    if (!doc) throw new Error('No PDF started');
    let image;
    try {
      image = type === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    } catch {
      throw new Error('embed');
    }
    const { width, height, box, image: r } = layout;
    const page = doc.addPage([width, height]);
    // layout is top-left based, PDF space is bottom-left
    const y = (rect: { y: number; h: number }) => height - rect.y - rect.h;
    const clipped = r.x < box.x - 0.01 || r.y < box.y - 0.01 || r.w > box.w + 0.01 || r.h > box.h + 0.01;
    if (clipped) page.pushOperators(pushGraphicsState(), rectangle(box.x, y(box), box.w, box.h), clip(), endPath());
    page.drawImage(image, { x: r.x, y: y(r), width: r.w, height: r.h });
    if (clipped) page.pushOperators(popGraphicsState());
  },

  async save(): Promise<Uint8Array> {
    if (!doc) throw new Error('No PDF started');
    const bytes = await doc.save();
    doc = null;
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type ImagesPdfWorker = typeof api;

Comlink.expose(api);
