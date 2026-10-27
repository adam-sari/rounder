// Low-end device safety (src/tools/lib/device-guard.ts): with a small navigator.deviceMemory, few cores (CDP) and big
// synthetic inputs, heavy tools explain what's too big and what to try instead of starting a job that would crash.
// A simulated allocation failure checks that out-of-memory errors become the same advice. Chromium only: deviceMemory
// and the CDP overrides are Chromium features.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { devices, expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openTool } from './helpers';

const fixture = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
const fileInput = (page: Page) => page.locator('section[aria-label="Tool"] input[type=file]').first();
const blocked = (page: Page) => page.locator('[data-device-guard="block"]');

/** a phone that says it has `gb` of memory and two cores */
async function lowEnd(page: Page, gb: number) {
  await page.addInitScript((gb) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => gb }), gb);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: 2 });
}

/** a valid one-page PDF padded to about `mb` MB with an incompressible attachment */
async function bigPdf(mb: number) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText('padding test', { x: 40, y: 150, size: 24 });
  await doc.attach(randomBytes(mb * 2 ** 20), 'padding.bin', { mimeType: 'application/octet-stream' });
  const path = test.info().outputPath(`big-${mb}mb.pdf`);
  await writeFile(path, await doc.save());
  return path;
}

test.skip(({ browserName }) => browserName !== 'chromium', 'deviceMemory and CDP emulation are Chromium-only');

test.describe('low-end phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('trim-video: the backup decoder on a 256 MB phone is stopped before the download, blaming the device, not the small file', async ({ page }) => {
    await lowEnd(page, 0.25);
    const errors = await openTool(page, 'trim-video');
    await fileInput(page).setInputFiles(fixture('media/sample.avi'));
    await expect(blocked(page)).toContainText(/^This tool needs about \d+ MB of memory even for a small file, more than a browser tab gets on a device with 0\.25 GB\./);
    await expect(blocked(page)).toContainText('Try it on a computer');
    await expect(page.getByRole('button', { name: /Download decoder/ })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('merge-pdf: a 60 MB PDF on a 512 MB phone can’t be merged, and says why', async ({ page }) => {
    await lowEnd(page, 0.5);
    const errors = await openTool(page, 'merge-pdf');
    await fileInput(page).setInputFiles(await bigPdf(60));
    await expect(blocked(page)).toContainText(/too big for this device: it needs about \d+ MB of memory, more than a browser tab gets on a device with 0\.5 GB\. Try merging fewer/, {
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test('compress-pdf: the guard stops a 60 MB PDF on a 512 MB phone with advice', async ({ page }) => {
    await lowEnd(page, 0.5);
    const errors = await openTool(page, 'compress-pdf');
    await fileInput(page).setInputFiles(await bigPdf(60));
    await expect(page.locator('section[aria-label="Tool"] .text-bad')).toContainText('Try splitting the PDF into smaller parts first.', { timeout: 60_000 });
    expect(errors).toEqual([]);
  });

  test('transcriber: Whisper on a 256 MB phone is stopped as soon as the file is read', async ({ page }) => {
    await lowEnd(page, 0.25);
    const errors = await openTool(page, 'audio-to-text');
    await fileInput(page).setInputFiles(fixture('media/sample.mp3'));
    await expect(page.getByRole('alert')).toContainText('This tool needs about', { timeout: 60_000 });
    await expect(page.getByRole('alert')).toContainText('more than a browser tab gets on a device with 0.25 GB');
    expect(errors).toEqual([]);
  });

  test('transcriber: on a 1 GB phone it warns but still lets the visitor try', async ({ page }) => {
    await lowEnd(page, 1);
    const errors = await openTool(page, 'audio-to-text');
    await fileInput(page).setInputFiles(fixture('media/sample.mp3'));
    await expect(page.locator('[data-device-guard="warn"]')).toHaveText(
      'This tool uses a lot of memory and this device has little to spare, so it may not finish. Close other tabs and apps first.',
      { timeout: 60_000 },
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('transcriber: a short clip on a 2 GB phone gets no note', async ({ page }) => {
    await lowEnd(page, 2);
    const errors = await openTool(page, 'audio-to-text');
    await fileInput(page).setInputFiles(fixture('media/sample.mp3'));
    // the same file raises the note on a 1 GB phone within a second or two; give it time, then check nothing was said
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-device-guard]')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('roomy computer', () => {
  test('trim-video: the same AVI on an 8 GB computer gets no warning', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => 8 }));
    const errors = await openTool(page, 'trim-video');
    await fileInput(page).setInputFiles(fixture('media/sample.avi'));
    await expect(page.getByRole('button', { name: /Download decoder/ })).toBeEnabled();
    await expect(page.locator('[data-device-guard]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('collage-maker: running out of memory while saving shows advice, not a crash', async ({ page }) => {
    // the full-size export canvas fails the way Chrome fails a huge allocation; previews stay small and work
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof get>) {
        if (Math.max(this.width, this.height) >= 2000) throw new RangeError('Array buffer allocation failed');
        return get.apply(this, args);
      } as typeof get;
    });
    const errors = await openTool(page, 'collage-maker');
    const photo = await page.evaluate(async () => {
      const c = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
      const g = c.getContext('2d')!;
      g.fillStyle = '#264653';
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#f4a261';
      g.fillRect(200, 150, 400, 300);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const file = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(photo) });
    await fileInput(page).setInputFiles([file('a.jpg'), file('b.jpg')]);
    const save = page.getByRole('button', { name: /^Download / });
    await expect(save).toBeEnabled({ timeout: 30_000 });
    await save.click();
    await expect(page.getByRole('alert')).toHaveText('This collage is too big for this device: it ran out of memory. Try the 1080 or 2160 size.');
    expect(errors).toEqual([]);
  });
});
