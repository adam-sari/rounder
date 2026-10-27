declare module 'gifenc' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: Format; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number },
  ): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: Format): Uint8Array;
  export function nearestColorIndex(palette: number[][], pixel: number[]): number;
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number; first?: boolean },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  };
}

declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG(imgd: ImageData, options?: Record<string, unknown> | string): string;
    imagedataToTracedata(imgd: ImageData, options?: Record<string, unknown> | string): unknown;
    getsvgstring(tracedata: unknown, options?: Record<string, unknown>): string;
    optionpresets: Record<string, Record<string, unknown>>;
  };
  export default ImageTracer;
}
