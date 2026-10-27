// Exact-size presets: each page opens its tool at the preset, the file it makes meets the number, and the result line
// says so (or says why not).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openTool } from './helpers';

const fixture = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
const fileInput = (page: Page) => page.locator('section[aria-label="Tool"] input[type=file]').first();
const tool = (page: Page) => page.locator('section[aria-label="Tool"]');
const press = (target: Locator, o?: { timeout?: number }) => (test.info().project.use.hasTouch ? target.tap(o) : target.click(o));

async function download(page: Page, action: () => Promise<unknown>, timeout = 180_000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  return { name: d.suggestedFilename(), buf: await readFile((await d.path())!) };
}

/** a noisy picture drawn in the page, so it compresses like a photo */
async function makeImage(page: Page, width = 800, height = 600) {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#f4a261');
      grad.addColorStop(1, '#264653');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < (w * h) / 120; i++) {
        g.fillStyle = `hsl(${(i * 37) % 360} 70% 50% / .5)`;
        g.fillRect((i * 97) % w, (i * 61) % h, 6, 6);
      }
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.97));
      let s = '';
      for (const b of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(b);
      return btoa(s);
    },
    [width, height],
  );
  return { name: `photo-${width}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

function jpegSize(b: Buffer) {
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

test.describe('exact-size flows', () => {
  test.setTimeout(300_000);

  test('compress-pdf-to-200kb fits and says so', async ({ page }) => {
    const errors = await openTool(page, 'compress-pdf-to-200kb');
    await expect(page.getByLabel('keep each PDF under · KB')).toHaveValue('200');
    await fileInput(page).setInputFiles(fixture('compress-pdf/photos.pdf'));
    // photos are redrawn on an OffscreenCanvas in a worker; a browser without one (Playwright's Windows WebKit) must
    // say so instead of blaming the file
    if (!(await page.evaluate(() => typeof OffscreenCanvas !== 'undefined'))) {
      await expect(tool(page)).toContainText("This browser couldn't recompress the photos", { timeout: 240_000 });
      await expect(tool(page)).not.toContainText('Try grayscale photos');
      return;
    }
    await expect(tool(page)).toContainText(/Result: .* ✓ fits under 200 KB/, { timeout: 240_000 });
    const out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true })));
    expect(out.buf.length).toBeLessThanOrEqual(200_000);
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBe(3);
    expect(errors).toEqual([]);
  });

  test('a target a text PDF cannot reach is reported, not faked', async ({ page }) => {
    const errors = await openTool(page, 'compress-pdf#5kb');
    await expect(page.getByLabel('keep each PDF under · KB')).toHaveValue('5');
    await fileInput(page).setInputFiles(fixture('pdf/sample-50-pages.pdf'));
    await expect(tool(page)).toContainText(/Result: .* ✗ over 5 KB/, { timeout: 120_000 });
    await expect(tool(page).getByRole('link', { name: /Split it into about \d+ parts/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('compress-image-to-20kb', async ({ page }) => {
    const errors = await openTool(page, 'compress-image-to-20kb');
    await fileInput(page).setInputFiles(await makeImage(page, 1600, 1200));
    await expect(tool(page)).toContainText(/Result: .* ✓ fits under 20 KB/, { timeout: 120_000 });
    const out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true })));
    expect(out.buf.length).toBeLessThanOrEqual(20_000);
    expect(errors).toEqual([]);
  });

  test('exam photo and signature land inside their ranges at their pixel sizes', async ({ page }) => {
    const errors = await openTool(page, 'exam-photo-signature-resizer');
    await fileInput(page).setInputFiles(await makeImage(page));
    await expect(tool(page)).toContainText(/Result: .* ✓ within 20–50 KB/, { timeout: 120_000 });
    let out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true })));
    expect(jpegSize(out.buf)).toEqual({ width: 200, height: 230 });
    expect(out.buf.length).toBeGreaterThanOrEqual(20_000);
    expect(out.buf.length).toBeLessThanOrEqual(50_000);

    await press(page.getByRole('button', { name: /^Signature/ }));
    await expect(tool(page)).toContainText(/Result: .* ✓ within 10–20 KB/, { timeout: 120_000 });
    out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true })));
    expect(jpegSize(out.buf)).toEqual({ width: 140, height: 60 });
    expect(out.buf.length).toBeGreaterThanOrEqual(10_000);
    expect(out.buf.length).toBeLessThanOrEqual(20_000);
    // padding sits after the headers, so the file still starts FF D8 FF E0 as upload checks expect
    expect([...out.buf.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(errors).toEqual([]);
  });

  test('increase-image-size-in-kb reaches the minimum', async ({ page }) => {
    const errors = await openTool(page, 'increase-image-size-in-kb');
    await fileInput(page).setInputFiles(await makeImage(page, 160, 120));
    await expect(tool(page)).toContainText(/Result: .* ✓ at least 50 KB/, { timeout: 120_000 });
    const out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true })));
    expect(out.buf.length).toBeGreaterThanOrEqual(50_000);
    expect(errors).toEqual([]);
  });

  test('resize-image-in-cm makes 3.5 × 4.5 cm at 300 dpi', async ({ page }) => {
    const errors = await openTool(page, 'resize-image-in-cm');
    await expect(tool(page)).toContainText('= 413×531 px at 300 dpi');
    await fileInput(page).setInputFiles(await makeImage(page));
    const out = await download(page, () => press(page.getByRole('button', { name: 'Download', exact: true }), { timeout: 120_000 }));
    expect(jpegSize(out.buf)).toEqual({ width: 413, height: 531 });
    // JFIF density: units 1 (dpi), 300 × 300
    expect([out.buf[13], out.buf.readUInt16BE(14), out.buf.readUInt16BE(16)]).toEqual([1, 300, 300]);
    expect(errors).toEqual([]);
  });

  test('jpg-to-pdf-under-200kb', async ({ page }) => {
    const errors = await openTool(page, 'jpg-to-pdf-under-200kb');
    await fileInput(page).setInputFiles([await makeImage(page, 1600, 1200), await makeImage(page, 1400, 1000), await makeImage(page, 1200, 900)]);
    await press(page.getByRole('button', { name: 'Create PDF' }));
    await expect(tool(page)).toContainText(/Result: .* ✓ fits under 200 KB/, { timeout: 240_000 });
    const out = await download(page, () => press(page.getByRole('button', { name: 'Download PDF' })));
    expect(out.buf.length).toBeLessThanOrEqual(200_000);
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBe(3);
    expect(errors).toEqual([]);
  });

  test('compress-video-to-8mb opens at 8 MB and checks the result', async ({ page }) => {
    const errors = await openTool(page, 'compress-video-to-8mb');
    await expect(page.getByLabel('Target size in MB')).toHaveValue('8');
    // without WebCodecs the tool offers the ffmpeg.wasm decoder (served from /vendor) first
    await page.addLocatorHandler(page.getByRole('button', { name: /^Download decoder/ }), (b) => press(b), { noWaitAfter: true });
    await fileInput(page).setInputFiles(fixture('media/sample.mp4'));
    await press(page.getByRole('button', { name: 'Compress video' }));
    await expect(tool(page)).toContainText(/Result: .* ✓ fits under 8 MB/, { timeout: 240_000 });
    expect(errors).toEqual([]);
  });

  test('the hub links every preset and opens a tool at any size', async ({ page }) => {
    await page.goto('/compress-to-exact-size');
    for (const slug of ['compress-pdf-to-100kb', 'compress-image-to-20kb', 'compress-video-to-10mb', 'exam-photo-signature-resizer', 'jpg-to-pdf-under-200kb'])
      await expect(page.locator(`a[href="/${slug}"]`).first()).toBeVisible();
    await page.getByRole('spinbutton', { name: 'under' }).fill('150');
    await press(page.getByRole('button', { name: 'Open the tool' }));
    await expect(page).toHaveURL(/\/compress-pdf#150kb$/);
    await openTool(page, 'compress-pdf#150kb');
    await expect(page.getByLabel('keep each PDF under · KB')).toHaveValue('150');
    // the main tool lists its presets as "Common targets"
    await expect(page.getByRole('heading', { name: 'Common targets' })).toBeVisible();
    await expect(page.locator('a[href="/compress-pdf-to-100kb"]')).toBeVisible();
  });
});
