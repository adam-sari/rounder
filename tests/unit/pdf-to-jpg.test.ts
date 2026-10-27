import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DESKTOP_LIMITS, IOS_LIMITS, pageImageName, planRender } from '@/tools/lib/pdf-to-jpg/render';
import { zipBlobs } from '@/tools/lib/pdf-to-jpg/zip';

const A4 = [595.28, 841.89] as const;

describe('planRender', () => {
  it('turns dpi into pixels', () => {
    const p = planRender(612, 792, { mode: 'dpi', dpi: 300 });
    expect([p.width, p.height]).toEqual([2550, 3300]);
    expect(p.dpi).toBe(300);
    expect(p.limited).toBe(false);
    expect(planRender(...A4, { mode: 'dpi', dpi: 72 })).toMatchObject({ width: 595, height: 841, scale: 1 });
  });

  it('sizes by width and reports the dpi that gives', () => {
    const p = planRender(612, 792, { mode: 'width', width: 1224 });
    expect(p.width).toBe(1224);
    expect(p.height).toBe(1584);
    expect(p.dpi).toBe(144);
  });

  it('lowers the resolution for pages too wide for a canvas', () => {
    // a 2 m long banner at 300 dpi would be ~23,600 px wide
    const p = planRender(5669, 850, { mode: 'dpi', dpi: 300 });
    expect(p.limited).toBe(true);
    expect(p.width).toBeLessThanOrEqual(DESKTOP_LIMITS.maxSide);
    expect(p.dpi).toBeLessThan(300);
  });

  it('lowers the resolution for pages over the pixel budget', () => {
    // A0 at 300 dpi is ~139 MP
    const p = planRender(2384, 3370, { mode: 'dpi', dpi: 300 });
    expect(p.limited).toBe(true);
    expect(p.width * p.height).toBeLessThanOrEqual(DESKTOP_LIMITS.maxPixels);
    const ios = planRender(...A4, { mode: 'dpi', dpi: 600 }, IOS_LIMITS);
    expect(ios.limited).toBe(true);
    expect(ios.width * ios.height).toBeLessThanOrEqual(IOS_LIMITS.maxPixels);
  });

  it('leaves ordinary pages alone', () => {
    expect(planRender(...A4, { mode: 'dpi', dpi: 300 }, IOS_LIMITS).limited).toBe(false);
  });
});

describe('pageImageName', () => {
  it('numbers pages, padded so they sort', () => {
    expect(pageImageName('Report.pdf', 2, 'jpg')).toBe('Report-page-3.jpg');
    expect(pageImageName('Report.pdf', 2, 'png', 120)).toBe('Report-page-003.png');
    expect(pageImageName('scan', 9, 'webp', 10)).toBe('scan-page-10.webp');
  });
});

describe('zipBlobs', () => {
  it('stores every file, renaming clashes', async () => {
    const zip = await zipBlobs([
      { name: 'a.jpg', blob: new Blob([new Uint8Array([1, 2, 3])]) },
      { name: 'b.jpg', blob: new Blob([new Uint8Array([4])]) },
      { name: 'a.jpg', blob: new Blob([new Uint8Array([5, 6])]) },
    ]);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['a.jpg', 'b.jpg', 'a (2).jpg']);
    expect([...files['a.jpg']]).toEqual([1, 2, 3]);
    expect([...files['a (2).jpg']]).toEqual([5, 6]);
  });
});
