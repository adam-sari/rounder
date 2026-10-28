import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { simd } from 'wasm-feature-detect';
import decodeAvif, { init as initAvifDec } from '@jsquash/avif/decode.js';
import { init as initAvifEnc } from '@jsquash/avif/encode.js';
import decodeJpeg, { init as initJpegDec } from '@jsquash/jpeg/decode.js';
import { init as initJpegEnc } from '@jsquash/jpeg/encode.js';
import { init as initOxipng } from '@jsquash/oxipng/optimise.js';
import decodePng, { init as initPngDec } from '@jsquash/png/decode.js';
import { initResize } from '@jsquash/resize';
import decodeWebp, { init as initWebpDec } from '@jsquash/webp/decode.js';
import { init as initWebpEnc } from '@jsquash/webp/encode.js';

/*
 * jSquash's codecs fetch their .wasm by URL, which Node's fetch can't do for file: URLs. Compiling each one from disk
 * and handing it to init() first makes the site's own codec code (src/engines/image/codec.ts) work unchanged.
 */

const require = createRequire(import.meta.url);
const wasm = async (spec: string) => WebAssembly.compile(await readFile(require.resolve(spec)));

// mozjpeg warns on stderr at low qualities ("quantization tables are too coarse"): harmless, and noise in a CLI.
// The Emscripten codecs take module overrides as a second argument, which their typings leave out.
const quietly = (init: unknown) => (m: WebAssembly.Module) => (init as (m: WebAssembly.Module, o: object) => Promise<unknown>)(m, { print: () => {}, printErr: () => {} });

let ready: Promise<void> | undefined;

export function initCodecs(): Promise<void> {
  ready ??= (async () => {
    const webpEnc = (await simd()) ? 'webp_enc_simd' : 'webp_enc';
    await Promise.all([
      wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm').then(quietly(initJpegDec)),
      wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm').then(quietly(initJpegEnc)),
      wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm').then((m) => initPngDec(m)),
      wasm('@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm').then((m) => initOxipng(m)),
      wasm('@jsquash/webp/codec/dec/webp_dec.wasm').then(quietly(initWebpDec)),
      wasm(`@jsquash/webp/codec/enc/${webpEnc}.wasm`).then(quietly(initWebpEnc)),
      wasm('@jsquash/avif/codec/dec/avif_dec.wasm').then(quietly(initAvifDec)),
      wasm('@jsquash/avif/codec/enc/avif_enc.wasm').then(quietly(initAvifEnc)),
      wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm').then((m) => initResize(m)),
    ]);
  })().catch((e) => {
    ready = undefined;
    throw e;
  });
  return ready;
}

export const decoders = { jpeg: decodeJpeg, png: decodePng, webp: decodeWebp, avif: decodeAvif };
