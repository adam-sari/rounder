import { expect, type Page } from '@playwright/test';

/** waits until every Astro island hydrated and the tool chunk behind ToolHost finished loading */
export async function waitForTool(page: Page) {
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'), undefined, { timeout: 60_000 });
  const tool = page.locator('section[aria-label="Tool"]');
  if (await tool.count()) {
    await expect(tool).not.toContainText('warming up the tool', { timeout: 60_000 });
    await expect(tool).not.toContainText("Couldn't load this tool");
  }
}

/** collects uncaught errors; read it at the end of the test */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  return errors;
}

export async function openTool(page: Page, slug: string) {
  const errors = trackErrors(page);
  await page.goto(`/${slug}`);
  await waitForTool(page);
  return errors;
}
