// Measures each tool's starting height at phone, tablet and desktop widths, so the "warming up" placeholder that the
// server renders can reserve exactly that much room and the page below doesn't jump when the tool loads (CLS).
// Writes src/tools/island-heights.json. Re-run after changing a tool's first screen:
//   npm run build -- --outDir D:/work/personal/.rounder-lh
//   node scripts/serve-dist.mjs D:/work/personal/.rounder-lh . 4600 &
//   node scripts/measure-islands.mjs http://127.0.0.1:4600 D:/work/personal/.rounder-lh
import { chromium } from 'playwright';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:4600', dist = 'D:/work/personal/.rounder-lh'] = process.argv.slice(2);
// one width per placeholder breakpoint (see ToolHost.svelte): phones, tablets, desktop (the page column stops growing at ~1100px)
const WIDTHS = [390, 768, 1280];

const slugs = [];
for (const f of await readdir(dist)) {
  if (!f.endsWith('.html')) continue;
  const m = (await readFile(join(dist, f), 'utf8')).match(/data-tool-slug="([^"]+)"/);
  if (m) slugs.push(m[1]);
}
slugs.sort();

const browser = await chromium.launch();
const out = {};
const failed = [];
await Promise.all(Array.from({ length: 6 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  while (slugs.length) {
    const slug = slugs.shift();
    const hs = [];
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/${slug}`, { waitUntil: 'networkidle' });
      const h = await page
        .waitForFunction(() => {
          const s = document.querySelector('section[aria-label="Tool"]');
          return s && !s.querySelector('.loading') && s.querySelector('[data-tool-slug]')?.firstElementChild ? s : null;
        }, null, { timeout: 15000 })
        .then(async () => {
          await page.keyboard.press('Shift'); // lets go of the height ToolHost holds until the first interaction
          await page.waitForTimeout(600); // async first-screen work (feature checks, saved settings)
          return page.evaluate(() => {
            const s = document.querySelector('section[aria-label="Tool"]');
            const cs = getComputedStyle(s);
            return Math.round(s.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
          });
        })
        .catch(() => null);
      hs.push(h);
    }
    if (hs.some((h) => !h)) failed.push(slug);
    else out[slug] = hs;
  }
  await ctx.close();
}));
await browser.close();

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
await writeFile('src/tools/island-heights.json', JSON.stringify(sorted, null, 0).replace(/\],/g, '],\n ') + '\n');
console.log(`measured ${Object.keys(sorted).length} tools${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
