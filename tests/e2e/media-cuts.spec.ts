import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openTool, trackErrors, waitForTool } from './helpers';

// regressions for the trimmer's quality planning and the audio cutter's same-format copy

const fixture = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));
const fileInput = (page: Page) => page.locator('section[aria-label="Tool"] input[type=file]').first();
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: typeof name === 'string' });

async function download(page: Page, action: () => Promise<unknown>, timeout = 240_000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  return readFile((await d.path())!);
}

/** odd formats or missing codecs route through the ffmpeg.wasm decoder; accept its download when asked */
async function acceptDecoder(page: Page) {
  await page.addLocatorHandler(button(page, /^Download decoder/), (btn) => btn.click(), { noWaitAfter: true });
}

const isMp3 = (b: Buffer) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);

test.describe('media flows: cuts', () => {
  test.setTimeout(300_000);

  test('audio-cutter keeps MP3 as is after the start moves by keyboard', async ({ page }) => {
    const errors = await openTool(page, 'audio-cutter');
    await acceptDecoder(page);
    const src = fixture('media/sample.mp3');
    await fileInput(page).setInputFiles(src);
    const handle = page.getByRole('slider', { name: 'Trim start' });
    await handle.focus({ timeout: 120_000 });
    // ten 0.01 s steps land on 0.09999999999999999 s, the start that used to fail
    for (let i = 0; i < 10; i++) await handle.press('ArrowRight');
    await expect(page.getByLabel('Start time')).toHaveValue('00:00.10');

    // browsers that decode MP3 natively offer "same"; the fallback-decoded copy is re-encoded instead
    const same = button(page, 'same (MP3)');
    const copies = (await same.count()) > 0;
    if (copies) await expect(same).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Cut audio').click({ timeout: 60_000 });
    const out = await download(page, () => button(page, 'Download').click({ timeout: 240_000 }));
    if (copies) await expect(page.getByText('no re-encoding', { exact: true })).toBeVisible();
    expect(isMp3(out)).toBe(true);
    expect(out.length).toBeGreaterThan(1_000);
    if (copies) expect(out.length).toBeLessThan((await stat(src)).size);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('trim-video opens a file at the start the search preset asked for', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/trim-video#start=1');
    await waitForTool(page);
    test.skip(!(await page.evaluate(() => typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined')), 'no WebCodecs in this browser build');
    await acceptDecoder(page);
    await fileInput(page).setInputFiles(fixture('media/sample.mp4'));
    await expect(page.getByLabel('Start time')).toHaveValue('00:01.00', { timeout: 120_000 });
    // a cut that doesn't start on the first frame re-encodes at the source's bitrate rather than copying
    await expect(page.getByText(/re-encoded at the original's bitrate/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('trim-video Best copies an untouched clip and re-encodes a cut near the source bitrate', async ({ page }) => {
    const errors = await openTool(page, 'trim-video');
    // the trimmer decodes with WebCodecs, the fallback decoder's copy too (WebKit on Windows has none)
    test.skip(!(await page.evaluate(() => typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined')), 'no WebCodecs in this browser build');
    await acceptDecoder(page);
    const src = fixture('media/sample.mp4');
    const srcSize = (await stat(src)).size;
    await fileInput(page).setInputFiles(src);
    const quality = page.getByRole('group', { name: 'Quality' });
    await expect(button(quality, 'Best')).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 });

    // the whole clip: nothing needs re-encoding, so Best copies it
    await expect(page.getByText(/nothing needs re-encoding/)).toBeVisible();
    await button(page, 'Trim video').click();
    const whole = await download(page, () => button(page, 'Download MP4').click({ timeout: 240_000 }));
    expect(whole.subarray(4, 8).toString('latin1')).toBe('ftyp');
    // a remux: the same streams in a new box layout, so within a few percent of the source
    expect(Math.abs(whole.length - srcSize) / srcSize).toBeLessThan(0.05);
    await button(page, 'Back to editing').click();

    // start moved half a second in: a frame-exact re-encode at the source's bitrate
    const handle = page.getByRole('slider', { name: 'Trim start' });
    await handle.focus();
    for (let i = 0; i < 15; i++) await handle.press('ArrowRight');
    await expect(page.getByText(/re-encoded at the original's bitrate/)).toBeVisible();
    await button(page, 'Trim video').click();
    const cut = await download(page, () => button(page, 'Download MP4').click({ timeout: 240_000 }));
    expect(cut.subarray(4, 8).toString('latin1')).toBe('ftyp');
    // 2.5 of 3 seconds at the source's bitrate. Firefox's H.264 encoder overshoots a target this low on a
    // clip this short (about 600 kbps for 343), so it only gets the sanity bound that a quantizer-driven
    // encode (Best once wrote 42 Mbps for a 16 Mbps source) would blow through
    const portion = srcSize * (2.5 / 3);
    expect(cut.length).toBeLessThan(test.info().project.name === 'firefox' ? portion * 2 : portion * 1.2);
    expect(errors).toEqual([]);
  });
});
