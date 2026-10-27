import { minify } from 'terser';
import { MinifyError, type Ecma, type MinifyResult } from './options';

export interface JsOptions {
  mangle: boolean;
  compress: boolean;
  keepLicense: boolean;
  module: boolean;
  ecma: Ecma;
}

export async function minifyJs(src: string, opts: JsOptions): Promise<MinifyResult> {
  try {
    const out = await minify(src, {
      ecma: opts.ecma,
      module: opts.module,
      mangle: opts.mangle,
      compress: opts.compress,
      // 'some' keeps /*! … */ and @license / @preserve comments
      format: { comments: opts.keepLicense ? 'some' : false },
    });
    return { code: out.code ?? '', notes: [] };
  } catch (e) {
    const err = e as { message?: string; line?: number; col?: number };
    let message = (err.message ?? String(e)).replace(/\.?$/, '.');
    // top-level await only parses in a module, and Terser's message doesn't say so
    if (!opts.module && (/\b(import|export)\b|top.?level await/i.test(message) || (await parsesAsModule(src)))) {
      message += ' Try turning on "ES module".';
    }
    // terser columns are 0-based
    throw new MinifyError(message, err.line, err.col === undefined ? undefined : err.col + 1);
  }
}

async function parsesAsModule(src: string) {
  try {
    await minify(src, { module: true, compress: false, mangle: false });
    return true;
  } catch {
    return false;
  }
}
