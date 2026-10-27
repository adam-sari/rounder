import { expect, test, type Page, type Request } from '@playwright/test';
import { openTool } from './helpers';

// "Rate this tool": appears only after a run worked, never blocks the download, can be closed, remembers per tool.
// The API is stubbed here (the static e2e server has none); tests/unit/ratings-worker.test.ts covers the Worker.

/** a small PNG drawn in the page */
async function makePng(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
    const g = c.getContext('2d')!;
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
      g.fillRect((i * 97) % 320, (i * 61) % 240, 8, 8);
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  });
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

/** runs the image tool once and saves the result */
async function runOnce(page: Page) {
  await page.locator('section[aria-label="Tool"] input[type=file]').first().setInputFiles(await makePng(page));
  await expect(page.getByText('1/1 done')).toBeVisible({ timeout: 60_000 });
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
}

const prompt = (page: Page) => page.getByRole('region', { name: 'How did it go?' });

test.describe('rating prompt', () => {
  // page.route can't see requests that pass through the site's service worker
  test.use({ serviceWorkers: 'block' });

  test('asks after a download, sends the rating and never asks again for that tool', async ({ page }) => {
    const sent: Request[] = [];
    await page.route('**/api/rate', (route) => {
      sent.push(route.request());
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"replaced":false}' });
    });
    const errors = await openTool(page, 'image-compressor');
    await expect(prompt(page)).toHaveCount(0);

    await runOnce(page);
    await expect(prompt(page)).toBeVisible();
    // the download button is still there and usable: nothing is gated
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();

    await prompt(page).locator('label').filter({ hasText: '4 stars' }).click();
    await page.getByLabel('Anything we should know? (optional)').fill('  Fast and easy  ');
    await page.getByRole('button', { name: 'Send rating' }).click();
    await expect(page.getByRole('region', { name: 'Rating sent' })).toContainText('Thanks, your rating was saved.');
    expect(sent).toHaveLength(1);
    expect(sent[0].postDataJSON()).toEqual({ slug: 'image-compressor', stars: 4, comment: 'Fast and easy' });
    expect(await page.evaluate(() => localStorage.getItem('rounder:rate:image-compressor'))).toBe('rated');

    await page.reload();
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await runOnce(page);
    await page.waitForTimeout(500);
    await expect(prompt(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('can be closed, which a variant page remembers under its own slug', async ({ page }) => {
    const errors = await openTool(page, 'png-to-jpg');
    await runOnce(page);
    await expect(prompt(page)).toBeVisible();
    await page.getByRole('button', { name: 'No thanks' }).click();
    await expect(prompt(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('rounder:rate:png-to-jpg'))).toBe('dismissed');
    expect(errors).toEqual([]);
  });

  test('stays closed when closed while the rating is still sending', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/api/rate', async (route) => {
      await held;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    });
    const errors = await openTool(page, 'image-compressor');
    await runOnce(page);
    await prompt(page).locator('label').filter({ hasText: '5 stars' }).click();
    await page.getByRole('button', { name: 'Send rating' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await page.getByRole('button', { name: 'No thanks' }).click();
    release();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('rounder:rate:image-compressor'))).toBe('rated');
    await expect(prompt(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Rating sent' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('ad-free privacy tools have no rating box at all', async ({ page }) => {
    await openTool(page, 'protect-pdf');
    expect(await page.locator('astro-island[component-url*="RateSlot"]').count()).toBe(0);
  });

  test('says so when the rating could not be sent, and lets you try again', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/rate', (route) =>
      ++calls === 1
        ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Try again tomorrow.' }) })
        : route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' }),
    );
    const errors = await openTool(page, 'image-resizer');
    await runOnce(page);
    await prompt(page).locator('label').filter({ hasText: '2 stars' }).click();
    await page.getByRole('button', { name: 'Send rating' }).click();
    await expect(page.getByRole('alert')).toContainText('Try again tomorrow.');
    expect(await page.evaluate(() => localStorage.getItem('rounder:rate:image-resizer'))).toBeNull();
    await page.getByRole('button', { name: 'Send rating' }).click();
    await expect(page.getByRole('region', { name: 'Rating sent' })).toContainText('Thanks, your rating was saved.');
    expect(errors).toEqual([]);
  });
});
