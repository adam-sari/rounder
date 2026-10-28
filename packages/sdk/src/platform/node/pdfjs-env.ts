import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { RounderError } from '../../core/errors';
import { assetPath } from './assets';
import { loadCanvas } from './canvas';

/*
 * Node twin of src/engines/pdf/pdfjs-env.ts. pdf.js's legacy build is bundled into the package; its worker code runs in
 * this process (pdf.js's "fake worker"), and its cmaps, fonts and wasm are read from the package's assets folder.
 * Rendering needs the optional @napi-rs/canvas; text, info and everything else work without it.
 */

type PdfjsModule = typeof import('pdfjs-dist');

let loaded: Promise<PdfjsModule> | undefined;

export function importPdfjs(): Promise<PdfjsModule> {
  loaded ??= (async () => {
    // pdf.js warns on stdout at import time when the optional canvas is missing; stdout belongs to --json and MCP
    const log = console.log;
    console.log = (...a: unknown[]) => {
      if (!/^Warning: Cannot (load|polyfill|access)/.test(String(a[0]))) console.error(...a);
    };
    try {
      const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
      // @ts-expect-error: pdfjs-dist ships no types for the worker module
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return lib;
    } finally {
      console.log = log;
    }
  })();
  return loaded;
}

export function pdfjsAsset(dir: 'cmaps' | 'standard_fonts' | 'wasm' | 'iccs') {
  return assetPath('pdfjs', dir) + '/';
}

/**
 * No console noise (stdout belongs to --json and MCP) and only the bundled fonts. pdf.js 6 no longer compiles code from
 * a PDF at all (no eval or new Function, so no isEvalSupported option); a bug like CVE-2024-4367's font matrix would
 * otherwise run with the user's full rights in Node, not in a browser tab.
 */
export const documentOptions: Partial<DocumentInitParameters> = { verbosity: 0, useSystemFonts: false };

export function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = loadCanvas();
  if (!canvas) throw new RounderError('missing-dependency', 'Rendering PDF pages needs the optional @napi-rs/canvas package.', { hint: 'npm install @napi-rs/canvas' });
  return canvas.createCanvas(width, height) as unknown as HTMLCanvasElement;
}
