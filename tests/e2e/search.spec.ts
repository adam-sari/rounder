// Search: the ⌘K palette and the home page's box find the right tool, deep-link its preset through the hash, keep the
// page still while results arrive, and never send anything about the query anywhere.
import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitForTool } from './helpers';

async function palette(page: Page, q: string) {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: /search tools/i }).or(page.locator('dialog.palette input[role=combobox]')).last();
  await expect(input).toBeFocused();
  await input.fill(q);
  return input;
}

const best = (page: Page) => page.locator('dialog.palette [role=option]').first();

test.describe('search', () => {
  test('palette finds the tool and opens it with its preset', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/about');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));

    await palette(page, 'make video smaller for discord');
    await expect(best(page)).toHaveAttribute('aria-label', /^Best match: Compress video to 10 MB, 10 MB for Discord$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/compress-video-to-10mb$/);

    await waitForTool(page);
    await palette(page, 'compress pdf to 150kb');
    await expect(best(page)).toContainText('under 150 KB');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/compress-pdf#target=150kb$/);
    await waitForTool(page);
    await expect(page.locator('section[aria-label="Tool"] input[type=number]').first()).toHaveValue('150');

    // Enter right away, before the index may have arrived on this new page
    await palette(page, 'iphone photo to jpg');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/heic-to-jpg$/);
    expect(errors).toEqual([]);
  });

  test('a plain sentence opens the tool with its preset', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/about');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));

    await palette(page, 'resize my photo to between 30 and 60 kb');
    await expect(best(page)).toHaveAttribute('aria-label', /^Best match: Image resizer, between 30 and 60 KB$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/image-resizer#range=30-60kb$/);
    await waitForTool(page);
    await expect(page.locator('section[aria-label="Tool"] input[placeholder="no limit"]')).toHaveValue('60');
    await expect(page.locator('section[aria-label="Tool"] input[placeholder="optional"]')).toHaveValue('30');

    await palette(page, 'cut first 10 seconds of my video');
    await expect(best(page)).toContainText('cut the first 10 s');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/trim-video#start=10$/);
    await waitForTool(page);
    expect(errors).toEqual([]);
  });

  test('is a keyboard combobox with honest "closest tools"', async ({ page }) => {
    await page.goto('/about');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    const input = await palette(page, 'crop pdf');
    await expect(page.locator('dialog.palette .head')).toHaveText('closest tools');
    await expect(input).toHaveAttribute('aria-activedescendant', 'palette-results-0');
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'palette-results-1');
    await expect(page.locator('#palette-results-1')).toHaveAttribute('aria-selected', 'true');

    await input.fill('png to gif');
    await expect(page.locator('dialog.palette .note')).toHaveText('No PNG to GIF converter yet.');
    // a kind word alone covers every tool of that kind; the kind's converter is the answer
    await input.fill('video converter');
    await expect(best(page)).toHaveAttribute('aria-label', /^Best match: Video converter/);
    await input.fill('word to jpg');
    await expect(page.locator('dialog.palette [role=option].plan')).toContainText('Word to PDF');
  });

  test('the home box searches in place without moving the page', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'on phones the hero hands over to the palette');
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    const box = page.locator('.hero-palette');
    const before = await box.boundingBox();
    const cls = () => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    // loading may nudge a few letters as the web fonts swap in (metric-matched fallbacks keep it tiny on a slow CPU);
    // typing must move nothing at all
    await page.evaluate(() => document.fonts.ready);
    const onLoad = await cls();
    expect(onLoad).toBeLessThan(0.01);
    const input = box.getByRole('combobox');
    await input.click();
    await input.pressSequentially('remove background noise from audio', { delay: 15 });
    await expect(box.locator('[role=option]').first()).toContainText('Remove background noise from audio');
    expect(await box.boundingBox()).toEqual(before);
    expect(await cls()).toBe(onLoad);
  });

  test('loads lazily, from this site only, and sends nothing while typing', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/about');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    expect(requests.some((u) => /\/search\/|\/models\/search\//.test(u))).toBe(false);

    const input = await palette(page, 'compress');
    await page.waitForResponse(/\/models\/search\/potion-2m-/);
    await page.waitForLoadState('networkidle');
    const mark = requests.length;
    for (const q of ['heic to jpg', 'pdf ko word me convert', 'make my voice louder', 'qr cod generater', '70 kg in lbs', 'karaoke version of a song', 'video too large for gmail', 'remove location from photo', 'merge pdf', 'what key is this song in']) {
      await input.fill(q);
      await expect(best(page)).toBeVisible();
    }
    expect(requests.slice(mark)).toEqual([]);
    const origin = new URL(page.url()).origin;
    expect(requests.filter((u) => /search|models/.test(u)).every((u) => u.startsWith(origin))).toBe(true);
    expect(requests.join(' ')).not.toMatch(/heic%20to|karaoke|voice%20louder/);
  });

  test('skips the model on Save-Data', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'navigator.connection is Chromium only');
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true, effectiveType: '4g' }) }));
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/about');
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await palette(page, 'make photo hd');
    await expect(best(page)).toContainText('image upscaler');
    await page.waitForTimeout(500);
    expect(requests.some((u) => u.includes('/models/search/'))).toBe(false);
  });

  test('tool pages open in the preset from the hash', async ({ page }) => {
    await page.goto('/unit-converter#from=ml&to=l&value=500');
    await waitForTool(page);
    await expect(page.locator('section[aria-label="Tool"]')).toContainText('0.5');
    await page.goto('/percentage-calculator#p=15&of=80');
    await waitForTool(page);
    await expect(page.locator('section[aria-label="Tool"]')).toContainText('12');
    await page.goto('/image-resizer#range=20-50kb');
    await waitForTool(page);
    const sizes = page.locator('section[aria-label="Tool"] input[type=number]');
    await expect(sizes.filter({ has: page.locator(':scope') })).not.toHaveCount(0);
    await expect(page.locator('section[aria-label="Tool"] input[placeholder="no limit"]')).toHaveValue('50');
    await expect(page.locator('section[aria-label="Tool"] input[placeholder="optional"]')).toHaveValue('20');
  });
});
