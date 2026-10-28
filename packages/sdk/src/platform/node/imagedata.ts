// Node has no ImageData, which the site's pixel code and jSquash use. The codecs install a 3-argument stand-in when it's
// missing; this one also takes (width, height), like the browser's, and is installed first.
class NodeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace = 'srgb';
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? a.length / 4 / b;
    }
  }
}

(globalThis as { ImageData?: unknown }).ImageData ??= NodeImageData;

export {};
