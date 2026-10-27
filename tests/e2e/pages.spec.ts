import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { DIST } from '../../playwright.config';
import { trackErrors, waitForTool } from './helpers';

// every page in the build: walk the output for .html files and turn them back into clean URLs
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    if (!e.name.endsWith('.html')) return [];
    const url = '/' + relative(DIST, p).split(sep).join('/').replace(/(index)?\.html$/, '');
    return [url === '/' ? url : url.replace(/\/$/, '')];
  });
}

for (const url of pages(DIST)) {
  test(`page ${url}`, async ({ page, isMobile }) => {
    // desktop engines get a small phone's width; the phone projects keep their own screens
    if (!isMobile) await page.setViewportSize({ width: 375, height: 800 });
    const errors = trackErrors(page);
    const res = await page.goto(url);
    expect(res?.status()).toBe(200);
    // the canonical is the clean URL the sitemaps list, never the .html file the static build writes
    expect(await page.locator('link[rel=canonical]').getAttribute('href')).toBe(new URL(url, 'https://roundertools.com').href);
    await waitForTool(page);
    // give effects that run right after mount a moment to throw
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      if (root.scrollWidth <= root.clientWidth + 1) return null;
      // name the widest offenders so a failure points somewhere useful
      return [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(el.getBoundingClientRect().right)}px`);
    });
    expect(overflow, 'horizontal overflow on a phone-sized screen').toBeNull();
    expect(errors, 'uncaught page errors').toEqual([]);
  });
}
