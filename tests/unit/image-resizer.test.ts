import { describe, expect, it } from 'vitest';
import { fitFileSize } from '@/tools/lib/image-resizer/fit-file-size';

// a rough stand-in for a jpeg encoder: bytes grow with pixels and with quality
function fakeEncoder(fullSize: number, overhead = 0) {
  const calls: number[] = [];
  const encode = async (quality: number, scale: number) => {
    const size = Math.round(overhead + fullSize * scale * scale * (quality / 100) ** 2);
    calls.push(size);
    return { size };
  };
  return { encode, calls };
}

describe('fitFileSize', () => {
  it('keeps top quality when it already fits', async () => {
    const { encode, calls } = fakeEncoder(100_000);
    const r = await fitFileSize(200_000, encode);
    expect(r).toMatchObject({ quality: 92, scale: 1, fits: true });
    expect(calls).toHaveLength(1);
  });

  it('lowers quality at full size before shrinking', async () => {
    const { encode, calls } = fakeEncoder(1_000_000);
    const r = await fitFileSize(500_000, encode); // fits up to quality ~70
    expect(r.fits).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.quality).toBeGreaterThanOrEqual(67);
    expect(r.quality).toBeLessThanOrEqual(70);
    expect(r.out.size).toBeLessThanOrEqual(500_000);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('shrinks the image when low quality is not enough', async () => {
    const { encode, calls } = fakeEncoder(10_000_000);
    const r = await fitFileSize(100_000, encode);
    expect(r.fits).toBe(true);
    expect(r.scale).toBeLessThan(1);
    expect(r.quality).toBeGreaterThanOrEqual(50);
    expect(r.out.size).toBeLessThanOrEqual(100_000);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('returns the smallest attempt when the target is out of reach', async () => {
    const { encode, calls } = fakeEncoder(1_000_000, 5_000);
    const r = await fitFileSize(1_000, encode);
    expect(r.fits).toBe(false);
    expect(r.out.size).toBe(Math.min(...calls));
    expect(calls.length).toBeLessThanOrEqual(12);
  });
});
