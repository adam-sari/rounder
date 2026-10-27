/// <reference lib="webworker" />
import { formatToLabel, prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// serve the wasm from our own origin instead of the package's default CDN
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

export interface ScanRequest {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  /** live camera frames get a lighter pass so the scanner keeps up */
  live: boolean;
}

export interface Found {
  text: string;
  /** zxing format name, e.g. "QRCode", "EAN13" */
  format: string;
  /** readable name, e.g. "QR Code", "EAN-13" */
  label: string;
  binary: boolean;
  /** corners in image pixels: top-left, top-right, bottom-right, bottom-left */
  corners: [number, number][];
}

const fileOptions: ReaderOptions = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, tryDenoise: true, maxNumberOfSymbols: 255 };
const liveOptions: ReaderOptions = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, tryDenoise: false, maxNumberOfSymbols: 8 };

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { id, width, height, data, live } = e.data;
  try {
    const results = await readBarcodes(new ImageData(data, width, height), live ? liveOptions : fileOptions);
    const found: Found[] = results
      .filter((r) => r.isValid && r.text)
      .map((r) => {
        const p = r.position;
        return {
          text: r.text,
          format: r.format,
          label: formatToLabel(r.format) ?? r.format,
          binary: r.contentType === 'Binary',
          corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((pt) => [pt.x, pt.y] as [number, number]),
        };
      });
    self.postMessage({ id, found });
  } catch (err) {
    self.postMessage({ id, error: (err as Error)?.message || 'Scanning failed.' });
  }
};
