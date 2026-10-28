import { createRequire } from 'node:module';

/** The parts of @napi-rs/canvas the SDK uses */
export interface NapiCanvas {
  createCanvas(width: number, height: number): {
    width: number;
    height: number;
    getContext(type: '2d'): { drawImage(img: unknown, x: number, y: number, w?: number, h?: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } };
    encode(format: 'png' | 'jpeg' | 'webp', quality?: number): Promise<Uint8Array>;
  };
  loadImage(src: Uint8Array): Promise<{ width: number; height: number }>;
}

const require = createRequire(import.meta.url);
let cached: NapiCanvas | null | undefined;

/** @napi-rs/canvas when the user has it installed (an optional peer), else null */
export function loadCanvas(): NapiCanvas | null {
  if (cached === undefined) {
    try {
      cached = require('@napi-rs/canvas') as NapiCanvas;
    } catch {
      cached = null;
    }
  }
  return cached;
}
