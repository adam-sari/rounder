import { describe, expect, it } from 'vitest';
import { KB, limitText, MB, partsFor, sizeText, targetFromHash, verdict } from '@/tools/lib/exact-size/target';
import { estimateSizes, LADDER, missReason, searchLadder, type ImageSample } from '@/tools/lib/compress-pdf/target';
import { fitRange, fromPixels, jpegDpi, padJpeg, setJpegDpi, toPixels } from '@/tools/lib/image-resizer/form-size';
import { jpegInfo } from '@/tools/lib/compress-pdf/pixels';
import { overReason, retryAimMB, type Plan } from '@/tools/lib/video-compressor/plan';

describe('sizes and verdicts', () => {
  it('prints decimal sizes, rounded down', () => {
    expect(sizeText(98_400)).toBe('98 KB');
    expect(sizeText(9_650)).toBe('9.6 KB');
    expect(sizeText(1_249_000)).toBe('1.24 MB');
    expect(sizeText(200 * KB)).toBe('200 KB');
  });

  it('says whether a result fits, without contradicting itself near the limit', () => {
    expect(verdict(98_000, { max: 100 * KB })).toEqual({ ok: true, text: '98 KB ✓ fits under 100 KB' });
    expect(verdict(112_000, { max: 100 * KB })).toMatchObject({ ok: false, miss: 'over', text: '112 KB ✗ over 100 KB' });
    // 100.4 KB would print as "100 KB" and read like a fit
    expect(verdict(100_400, { max: 100 * KB }).text).toBe('100.4 KB ✗ over 100 KB');
    expect(verdict(12_000, { min: 20 * KB, max: 50 * KB })).toMatchObject({ ok: false, miss: 'under', text: '12 KB ✗ under the 20 KB minimum' });
    expect(verdict(34_000, { min: 20 * KB, max: 50 * KB }).text).toBe('34 KB ✓ within 20–50 KB');
    expect(verdict(9.6 * MB, { max: 10 * MB }).text).toBe('9.6 MB ✓ fits under 10 MB');
    expect(verdict(51_000, { min: 50 * KB }).text).toBe('51 KB ✓ at least 50 KB');
  });

  it('describes limits', () => {
    expect(limitText({ max: 100 * KB })).toBe('under 100 KB');
    expect(limitText({ min: 20 * KB, max: 50 * KB })).toBe('20–50 KB');
    expect(limitText({ min: 500 * KB, max: 2 * MB })).toBe('500 KB–2 MB');
    expect(limitText({ min: 20 * KB })).toBe('at least 20 KB');
  });

  it('reads a target from the address hash', () => {
    expect(targetFromHash('#150kb')).toBe(150);
    expect(targetFromHash('#target=2MB')).toBe(2000);
    expect(targetFromHash('#1.5mb')).toBe(1500);
    expect(targetFromHash('')).toBeNull();
    expect(targetFromHash('#faq')).toBeNull();
    expect(targetFromHash('#0kb')).toBeNull();
    expect(targetFromHash('#%E0kb')).toBeNull(); // malformed escape: ignored, not thrown
  });

  it('counts the parts a split needs', () => {
    expect(partsFor(450 * KB, 100 * KB)).toBe(5);
    expect(partsFor(101 * KB, 100 * KB)).toBe(2);
  });
});

describe('PDF target search', () => {
  const sample: ImageSample = {
    found: 4,
    candidates: 4,
    candidateBytes: 2_000_000,
    // the sampled photos shrink to 50%, 25%, 12.5%… of their bytes down the ladder
    samples: [{ before: 1_000_000, after: LADDER.map((_, i) => 1_000_000 / 2 ** (i + 1)) }],
  };

  it('estimates each rung from the sample and the fixed part', () => {
    const est = estimateSizes(sample, 2_100_000);
    expect(est).toHaveLength(LADDER.length);
    expect(est[0]).toBe(100_000 + 1_000_000);
    expect(est[1]).toBe(100_000 + 500_000);
    expect(est.every((e, i) => i === 0 || e < est[i - 1])).toBe(true);
    // nothing to sample: every rung is the lossless size
    expect(estimateSizes({ ...sample, samples: [] }, 900)).toEqual(LADDER.map(() => 900));
  });

  it('lands on the sharpest rung that fits, in few passes, when estimates are right', async () => {
    const est = estimateSizes(sample, 2_100_000);
    const passes: number[] = [];
    const r = await searchLadder(300_000, est, async (i) => (passes.push(i), { size: est[i], out: i }));
    expect(r.fits).toBe(true);
    // rung 2 is 350 KB, rung 3 is 225 KB
    expect(r.best.rung).toBe(3);
    expect(passes).toEqual([3]);
  });

  it('corrects for estimates that were too low', async () => {
    const est = estimateSizes(sample, 2_100_000);
    // real passes come out 40% bigger than estimated
    const r = await searchLadder(300_000, est, async (i) => ({ size: est[i] * 1.4, out: i }));
    expect(r.fits).toBe(true);
    expect(r.best.size).toBeLessThanOrEqual(300_000);
    expect(r.tries.length).toBeLessThanOrEqual(3);
  });

  it('climbs back up when the first pass came out far smaller', async () => {
    const est = estimateSizes(sample, 2_100_000);
    // the first pass (rung 3) comes out at half its estimate, so rung 2 (350 KB, really 175 KB) is worth a try
    const passes: number[] = [];
    const r = await searchLadder(300_000, est, async (i) => (passes.push(i), { size: est[i] * 0.5, out: i }));
    expect(r.fits).toBe(true);
    expect(passes[0]).toBe(3);
    expect(r.best.rung).toBeLessThan(3);
    expect(passes.length).toBeLessThanOrEqual(3);
  });

  it('returns the smallest attempt and stops when nothing fits', async () => {
    const est = estimateSizes(sample, 2_100_000);
    const passes: number[] = [];
    const r = await searchLadder(10_000, est, async (i) => (passes.push(i), { size: est[i], out: i }));
    expect(r.fits).toBe(false);
    expect(r.best.rung).toBe(LADDER.length - 1);
    expect(passes).toEqual([LADDER.length - 1]);
  });

  it('explains a miss', () => {
    const text = missReason({ target: 100 * KB, size: 400 * KB, lossless: 500 * KB, candidateBytes: 50 * KB, candidates: 2, grayscale: false });
    expect(text.why).toMatch(/Text, fonts and drawings alone take about 450 KB/);
    expect(text.parts).toBe(5);
    expect(missReason({ target: 100 * KB, size: 300 * KB, lossless: 300 * KB, candidateBytes: 0, candidates: 0, grayscale: false }).why).toMatch(/no photos/);
    expect(missReason({ target: 100 * KB, size: 150 * KB, lossless: 2 * MB, candidateBytes: 1.95 * MB, candidates: 9, grayscale: true }).why).toMatch(/50 dpi in grayscale/);
  });
});

describe('form sizes', () => {
  it('converts physical units through the DPI', () => {
    expect(toPixels(3.5, 'cm', 300)).toBeCloseTo(413.4, 1);
    expect(toPixels(2, 'in', 150)).toBe(300);
    expect(toPixels(640, 'px', 72)).toBe(640);
    expect(fromPixels(300, 'in', 150)).toBe(2);
    expect(fromPixels(toPixels(45, 'mm', 300), 'mm', 300)).toBe(45);
  });

  // a stand-in JPEG encoder: bytes grow with pixels and quality
  const encoder = (full: number) => {
    const calls: [number, number][] = [];
    return { calls, encode: async (q: number, scale: number) => (calls.push([q, scale]), { size: Math.round(full * scale * scale * (q / 100) ** 2) }) };
  };

  it('fits a range from above', async () => {
    const { encode } = encoder(400_000);
    const r = await fitRange({ min: 20_000, max: 50_000 }, encode);
    expect(r.out.size).toBeGreaterThanOrEqual(20_000);
    expect(r.out.size).toBeLessThanOrEqual(50_000);
    expect(r.short).toBe(0);
  });

  it('raises quality, then enlarges, to reach a minimum', async () => {
    const small = encoder(30_000); // 25.4 KB at quality 92
    const q = await fitRange({ min: 28_000, max: 50_000 }, small.encode);
    expect(q.scale).toBe(1);
    expect(q.quality).toBeGreaterThan(92);
    expect(q.out.size).toBeGreaterThanOrEqual(28_000);

    const tiny = encoder(5_000);
    const r = await fitRange({ min: 20_000 }, tiny.encode);
    expect(r.scale).toBeGreaterThan(1);
    expect(r.out.size + r.short).toBeGreaterThanOrEqual(20_000);
  });

  it('keeps fixed dimensions and reports what padding must add', async () => {
    const { encode, calls } = encoder(4_000);
    const r = await fitRange({ min: 10_000, max: 20_000 }, encode, { fixedSize: true });
    expect(calls.every(([, s]) => s === 1)).toBe(true);
    expect(r.short).toBe(10_000 - r.out.size);
    // over the maximum at a fixed size, quality may drop to 10
    const big = encoder(900_000);
    const over = await fitRange({ max: 20_000 }, big.encode, { fixedSize: true });
    expect(over.scale).toBe(1);
    expect(over.quality).toBeLessThan(50);
  });

  const jpeg = () => {
    const out = new Uint8Array(200).fill(0x22);
    out.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    out.set([0xff, 0xc0, 0, 17, 8, 0, 60, 0, 140, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 20);
    out.set([0xff, 0xd9], 198);
    return out;
  };

  it('pads a JPEG with blank comments by exactly the bytes asked', () => {
    const src = jpeg();
    for (const extra of [10, 5_000, 70_000, 200_001]) {
      const out = padJpeg(src, extra);
      expect(out.length).toBeGreaterThanOrEqual(src.length + extra);
      expect(out.length - src.length - extra).toBeLessThan(4);
      // the JFIF header stays first (upload checks look for FF D8 FF E0); the comments follow it
      expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
      expect([out[20], out[21]]).toEqual([0xff, 0xfe]);
      // the frame is still found after the comments
      expect(jpegInfo(out)).toMatchObject({ width: 140, height: 60 });
    }
    expect(padJpeg(src, 0)).toBe(src);
    // a stored DPI survives padding
    expect(jpegDpi(padJpeg(setJpegDpi(src, 300), 5_000))).toBe(300);
  });

  it('stores the DPI in the JFIF header, adding one when missing', () => {
    const src = jpeg();
    expect(jpegDpi(src)).toBeNull(); // aspect-ratio only
    expect(jpegDpi(setJpegDpi(src, 300))).toBe(300);
    const bare = new Uint8Array([0xff, 0xd8, ...src.subarray(20)]);
    const withHeader = setJpegDpi(bare, 200);
    expect(jpegDpi(withHeader)).toBe(200);
    expect(jpegInfo(withHeader)).toMatchObject({ width: 140, height: 60 });
  });
});

describe('video retries', () => {
  it('aims lower by the overshoot', () => {
    expect(retryAimMB(10, 10, 10.6 * MB)).toBe(9.15);
    expect(retryAimMB(10, 9.15, 10.2 * MB)).toBe(8.7);
  });

  it('explains an overshoot', () => {
    const plan = { feasible: true, audioBitrate: 128_000, videoBitrate: 2_000_000 } as Plan;
    expect(overReason({ ...plan, feasible: false }, 600, 8)).toMatch(/8 MB leaves too little room for 10:00/);
    expect(overReason({ ...plan, videoBitrate: 150_000 }, 60, 1)).toMatch(/sound/);
    expect(overReason(plan, 60, 10)).toMatch(/aims lower/);
  });
});
