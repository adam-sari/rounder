import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
// the legacy build carries polyfills (e.g. Map.getOrInsertComputed) that the modern one assumes are native
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/*
 * What pdfjs.ts needs from its surroundings: the module and its worker, the static files it reads, and canvases. A
 * leaf of its own so the npm packages can swap in a Node version (files from disk, an optional native canvas).
 */

type PdfjsModule = typeof import('pdfjs-dist');

export function importPdfjs(): Promise<PdfjsModule> {
  return import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
}

/** cmaps (CJK text), standard fonts, image codecs and ICC profiles, copied from pdfjs-dist */
export function pdfjsAsset(dir: 'cmaps' | 'standard_fonts' | 'wasm' | 'iccs') {
  return new URL(`${import.meta.env.BASE_URL}vendor/pdfjs/${dir}/`, location.href).href;
}

/** extra getDocument options for this platform */
export const documentOptions: Partial<DocumentInitParameters> = {};

export function newCanvas(width: number, height: number, offscreen: boolean): HTMLCanvasElement | OffscreenCanvas {
  return offscreen ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
}
