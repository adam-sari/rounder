import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openTool } from './helpers';

// Preset pages (Tier 1 variants): each opens its main tool's island in its own starting state and still works end to end.

const fixture = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
const tool = (page: Page) => page.locator('section[aria-label="Tool"]');
const fileInput = (page: Page) => tool(page).locator('input[type=file]').first();
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: typeof name === 'string' });
const press = (target: Locator, o?: { timeout?: number }) => (test.info().project.use.hasTouch ? target.tap(o) : target.click(o));

async function download(page: Page, action: () => Promise<unknown>, timeout = 120_000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  return { name: d.suggestedFilename(), buf: await readFile((await d.path())!) };
}

/** a flat logo on a white box, drawn in the page: 800×600 */
async function makeImage(page: Page, type: 'image/jpeg' | 'image/png') {
  const b64 = await page.evaluate(async (type) => {
    const c = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#e4572e';
    g.beginPath();
    g.arc(400, 300, 200, 0, Math.PI * 2);
    g.fill();
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.92));
    let s = '';
    for (const b of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(b);
    return btoa(s);
  }, type);
  return { name: `logo.${type === 'image/png' ? 'png' : 'jpg'}`, mimeType: type, buffer: Buffer.from(b64, 'base64') };
}

test('character-counter leads with characters and meters each platform', async ({ page }) => {
  const errors = await openTool(page, 'character-counter');
  await page.locator('textarea').fill('Hi 👋 see https://example.com/a-very-long-link-indeed');
  const firstTile = tool(page).locator('div.rounded-xl').first();
  await expect(firstTile.locator('.mono')).toHaveText('characters');
  await expect(firstTile.locator('.font-serif')).toHaveText('52');
  const meter = (label: string) => page.getByRole('list', { name: 'Platform limits' }).locator('li', { hasText: label });
  // 3 + emoji 2 + 5 + link 23
  await expect(meter('X post')).toContainText('33 / 280');
  await expect(meter('SMS text')).toContainText('UCS-2 because of “👋”');
  await expect(meter('Meta description')).toContainText('52 / ~160');
  await page.locator('textarea').fill('x'.repeat(101));
  await expect(meter('YouTube title')).toContainText('1 over');
  await expect(meter('YouTube title')).toHaveAttribute('data-state', 'over');
  expect(errors).toEqual([]);
});

test('png-to-ico makes a Windows icon named after the PNG', async ({ page }) => {
  const errors = await openTool(page, 'png-to-ico');
  await expect(tool(page)).toContainText('Drop a PNG to turn into an .ico');
  await fileInput(page).setInputFiles(await makeImage(page, 'image/png'));
  await press(button(page, 'Windows icon'));
  await expect(tool(page)).toContainText('16, 24, 32, 48, 64, 128, 256 px');
  const out = await download(page, () => press(button(page, 'Download .ico')));
  expect(out.name).toBe('logo.ico');
  expect([out.buf.readUInt16LE(0), out.buf.readUInt16LE(2), out.buf.readUInt16LE(4)]).toEqual([0, 1, 7]);
  // the last entry is 256 px, stored as 0
  expect(out.buf[6 + 16 * 6]).toBe(0);
  expect(errors).toEqual([]);
});

test('jpg-to-svg starts with the background removed', async ({ page }) => {
  const errors = await openTool(page, 'jpg-to-svg');
  await expect(tool(page)).toContainText('Drop a JPG to vectorize');
  await fileInput(page).setInputFiles(await makeImage(page, 'image/jpeg'));
  await expect(page.getByRole('checkbox', { name: /Remove background/ })).toBeChecked();
  const out = await download(page, () => press(button(page, 'Download SVG'), { timeout: 60_000 }));
  expect(out.name).toBe('logo.svg');
  expect(out.buf.toString('utf8')).toMatch(/<svg[\s\S]*<\/svg>/);
  expect(errors).toEqual([]);
});

test('png-to-pdf shapes each page like its PNG', async ({ page }) => {
  const errors = await openTool(page, 'png-to-pdf');
  await fileInput(page).setInputFiles(await makeImage(page, 'image/png'));
  await expect(page.getByRole('group', { name: 'page size' }).getByRole('button', { name: 'Fit image' })).toHaveAttribute('aria-pressed', 'true');
  await press(button(page, 'Create PDF'), { timeout: 60_000 });
  const out = await download(page, () => press(button(page, 'Download PDF'), { timeout: 60_000 }));
  const doc = await PDFDocument.load(out.buf);
  // 800 × 600 px at 96 per inch = 600 × 450 pt
  expect(doc.getPage(0).getSize()).toEqual({ width: 600, height: 450 });
  expect(errors).toEqual([]);
});

test('heic-to-pdf starts with Compress images on', async ({ page }) => {
  const errors = await openTool(page, 'heic-to-pdf');
  await fileInput(page).setInputFiles(await makeImage(page, 'image/jpeg'));
  await expect(page.getByRole('checkbox', { name: /Compress images/ })).toBeChecked();
  await expect(page.getByRole('group', { name: 'page size' }).getByRole('button', { name: 'A4' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test.describe('media flows', () => {
  test.setTimeout(300_000);

  test('mp4-to-mp3', async ({ page }) => {
    const errors = await openTool(page, 'mp4-to-mp3');
    await expect(tool(page)).toContainText('Drop MP4 videos here');
    await page.addLocatorHandler(button(page, /^Download decoder/), (b) => press(b), { noWaitAfter: true });
    await fileInput(page).setInputFiles(fixture('media/sample.mp4'));
    await press(button(page, 'Extract audio as MP3'), { timeout: 120_000 });
    if (!(await page.evaluate(() => typeof VideoDecoder !== 'undefined'))) {
      // Playwright's WebKit on Windows ships without WebCodecs; the tool should say so rather than hang
      await expect(page.getByRole('alert')).toContainText('no WebCodecs');
      expect(errors).toEqual([]);
      test.skip(true, 'no WebCodecs in this browser build; the tool explains that');
    }
    const out = await download(page, () => press(button(page, 'Download MP3').first(), { timeout: 240_000 }), 240_000);
    expect(out.name).toMatch(/\.mp3$/);
    expect(out.buf.subarray(0, 3).toString('latin1') === 'ID3' || (out.buf[0] === 0xff && (out.buf[1] & 0xe0) === 0xe0)).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const [slug, label] of [['mp4-to-gif', 'MP4'], ['mov-to-gif', 'MOV']]) {
    test(`${slug} opens on GIF`, async ({ page }) => {
      const errors = await openTool(page, slug);
      await expect(tool(page)).toContainText(`Drop your ${label} to make a GIF`);
      expect(errors).toEqual([]);
    });
  }
});
