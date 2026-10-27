/// <reference lib="webworker" />
import { defaultOptions, MinifyError, type Lang, type MinifyOptions, type MinifyResult, type Note } from './options';

export interface MinifyRequest {
  lang: Lang;
  code: string;
  options: MinifyOptions;
}

export interface Sizes {
  original: number;
  minified: number;
  /** null where the browser has no CompressionStream */
  originalGzip: number | null;
  minifiedGzip: number | null;
}

export type MinifyResponse = { ok: true; code: string; notes: Note[]; sizes: Sizes } | { ok: false; error: Note };

async function gzipSize(text: string) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

// each minifier loads on first use, so the CSS page never downloads Terser
async function minify({ lang, code, options }: MinifyRequest): Promise<MinifyResult> {
  if (lang === 'css') return (await import('./css')).minifyCss(code, options);
  if (lang === 'js') return (await import('./js')).minifyJs(code, options);
  const [{ minifyHtml }, { minifyCss }] = await Promise.all([import('./html'), import('./css')]);
  return minifyHtml(code, options, {
    css: (css, context) => minifyCss(css, defaultOptions, context),
    js: async (js, module) => (await import('./js')).minifyJs(js, { ...defaultOptions, module }),
  });
}

self.onmessage = async (e: MessageEvent<MinifyRequest>) => {
  let response: MinifyResponse;
  try {
    const { code, notes } = await minify(e.data);
    const encoder = new TextEncoder();
    const [originalGzip, minifiedGzip] = await Promise.all([gzipSize(e.data.code), gzipSize(code)]);
    const sizes = { original: encoder.encode(e.data.code).byteLength, minified: encoder.encode(code).byteLength, originalGzip, minifiedGzip };
    response = { ok: true, code, notes, sizes };
  } catch (err) {
    response = err instanceof MinifyError
      ? { ok: false, error: { message: err.message, line: err.line, column: err.column } }
      : { ok: false, error: { message: (err as Error)?.message || 'Minifying failed.' } };
  }
  self.postMessage(response);
};
