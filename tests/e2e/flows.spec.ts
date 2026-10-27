import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { openTool } from './helpers';

const fixture = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));

interface Out {
  name: string;
  buf: Buffer;
}

/** runs the action and returns the file it made the browser download */
async function download(page: Page, action: () => Promise<unknown>, timeout = 120_000): Promise<Out> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  return { name: d.suggestedFilename(), buf: await readFile((await d.path())!) };
}

/** the tool's own file input (dropzones keep theirs hidden) */
const fileInput = (page: Page) => page.locator('section[aria-label="Tool"] input[type=file]').first();
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: typeof name === 'string' });
/** taps on touch devices (the mobile projects), clicks elsewhere */
const press = (target: Locator, o?: { timeout?: number }) => (test.info().project.use.hasTouch ? target.tap(o) : target.click(o));

/** a noisy 800×600 picture drawn in the page, so it compresses like a photo and needs no fixture */
async function makeImage(page: Page, type: 'image/jpeg' | 'image/png') {
  const b64 = await page.evaluate(async (type) => {
    const c = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 800, 600);
    grad.addColorStop(0, '#f4a261');
    grad.addColorStop(1, '#264653');
    g.fillStyle = grad;
    g.fillRect(0, 0, 800, 600);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360} 70% 50% / .5)`;
      g.fillRect((i * 97) % 800, (i * 61) % 600, 6, 6);
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.97));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, type);
  const ext = type === 'image/png' ? 'png' : 'jpg';
  return { name: `photo.${ext}`, mimeType: type, buffer: Buffer.from(b64, 'base64') };
}

const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'PK\x03\x04';
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

function jpegSize(b: Buffer) {
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

/**
 * Media tools ask before fetching the ffmpeg.wasm fallback (served from /vendor, so it works offline here).
 * Agree whenever they ask, and note it on the test so the report shows which browsers needed it.
 */
async function acceptDecoder(page: Page, name: RegExp) {
  await page.addLocatorHandler(
    button(page, name),
    async (btn) => {
      test.info().annotations.push({ type: 'fallback', description: 'used the ffmpeg.wasm decoder' });
      await press(btn);
    },
    { noWaitAfter: true },
  );
}

test.describe('images', () => {
  for (const type of ['image/jpeg', 'image/png'] as const) {
    test(`image-compressor ${type}`, async ({ page }) => {
      const errors = await openTool(page, 'image-compressor');
      const input = await makeImage(page, type);
      await fileInput(page).setInputFiles(input);
      await expect(page.getByText('1/1 done')).toBeVisible({ timeout: 60_000 });
      const out = await download(page, () => press(button(page, 'Download')));
      expect(type === 'image/png' ? isPng(out.buf) : isJpeg(out.buf)).toBe(true);
      // WebKit's canvas already writes compact PNGs; then the tool keeps the original, as it should
      expect(out.buf.length).toBeLessThanOrEqual(input.buffer.length);
      if (out.buf.length === input.buffer.length) await expect(page.locator('section[aria-label="Tool"]').getByText('already optimal')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('heic-to-jpg loads', async ({ page }) => {
    const errors = await openTool(page, 'heic-to-jpg');
    await expect(page.locator('section[aria-label="Tool"] input[type=file]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('image-resizer', async ({ page }) => {
    const errors = await openTool(page, 'image-resizer');
    await press(button(page, 'percent'));
    await fileInput(page).setInputFiles(await makeImage(page, 'image/png'));
    await expect(page.getByText('1/1 done')).toBeVisible({ timeout: 60_000 });
    const out = await download(page, () => press(button(page, 'Download')));
    expect(isPng(out.buf)).toBe(true);
    expect(pngSize(out.buf)).toEqual({ width: 400, height: 300 });
    expect(errors).toEqual([]);
  });

  test('image-resizer jpeg', async ({ page }) => {
    const errors = await openTool(page, 'image-resizer');
    await press(button(page, 'percent'));
    await fileInput(page).setInputFiles(await makeImage(page, 'image/jpeg'));
    await expect(page.getByText('1/1 done')).toBeVisible({ timeout: 60_000 });
    const out = await download(page, () => press(button(page, 'Download')));
    expect(isJpeg(out.buf)).toBe(true);
    expect(jpegSize(out.buf)).toEqual({ width: 400, height: 300 });
    expect(errors).toEqual([]);
  });
});

test('rotate-image', async ({ page }) => {
  const errors = await openTool(page, 'rotate-image');
  await press(button(page, 'Rotate right 90°'));
  await fileInput(page).setInputFiles(await makeImage(page, 'image/png'));
  await expect(page.getByText('1/1 done')).toBeVisible({ timeout: 60_000 });
  const out = await download(page, () => press(button(page, 'Download')));
  expect(pngSize(out.buf)).toEqual({ width: 600, height: 800 });
  expect(errors).toEqual([]);
});

test.describe('pdf', () => {
  test('merge-pdf', async ({ page }) => {
    const errors = await openTool(page, 'merge-pdf');
    await fileInput(page).setInputFiles([fixture('pdf/sample-3-pages.pdf'), fixture('pdf/sample-mixed-sizes.pdf')]);
    await press(button(page, 'Merge 2 files'));
    const out = await download(page, () => press(button(page, 'Download PDF')));
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBe(7);
    expect(errors).toEqual([]);
  });

  test('split-pdf', async ({ page }) => {
    const errors = await openTool(page, 'split-pdf');
    await fileInput(page).setInputFiles(fixture('pdf/sample-3-pages.pdf'));
    await press(page.locator('section[aria-label="Tool"] .btn-primary'));
    const out = await download(page, () => press(button(page, 'Download all (.zip)')));
    const files = Object.values(unzipSync(out.buf));
    expect(files).toHaveLength(2);
    const counts = await Promise.all(files.map(async (f) => (await PDFDocument.load(f)).getPageCount()));
    expect(counts.reduce((a, b) => a + b)).toBe(3);
    expect(errors).toEqual([]);
  });

  test('compress-pdf', async ({ page }) => {
    const errors = await openTool(page, 'compress-pdf');
    const src = await readFile(fixture('compress-pdf/photos.pdf'));
    await fileInput(page).setInputFiles(fixture('compress-pdf/photos.pdf'));
    const out = await download(page, () => press(button(page, 'Download'), { timeout: 120_000 }));
    expect(isPdf(out.buf)).toBe(true);
    expect(out.buf.length).toBeLessThan(src.length);
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBe((await PDFDocument.load(src)).getPageCount());
    expect(errors).toEqual([]);
  });

  test('protect-pdf then unlock-pdf', async ({ page }) => {
    const errors = await openTool(page, 'protect-pdf');
    await fileInput(page).setInputFiles(fixture('pdf/sample-3-pages.pdf'));
    await page.getByPlaceholder('Needed to open the PDF').fill('correct horse battery');
    await page.locator('input[autocomplete="new-password"]').nth(1).fill('correct horse battery');
    await press(button(page, 'Protect 1 PDF'));
    const locked = await download(page, () => press(button(page, 'Download')));
    expect(locked.buf.includes('/Encrypt')).toBe(true);
    await expect(PDFDocument.load(locked.buf)).rejects.toThrow(/encrypted/i);

    errors.push(...(await openTool(page, 'unlock-pdf')));
    await fileInput(page).setInputFiles({ name: locked.name, mimeType: 'application/pdf', buffer: locked.buf });
    await page.locator('input[type=password]').fill('correct horse battery');
    await press(button(page, 'Unlock'));
    const open = await download(page, () => press(button(page, 'Download')));
    expect(open.buf.includes('/Encrypt')).toBe(false);
    expect((await PDFDocument.load(open.buf)).getPageCount()).toBe(3);
    expect(errors).toEqual([]);
  });

  test('pdf-to-text', async ({ page }) => {
    const errors = await openTool(page, 'pdf-to-text');
    await fileInput(page).setInputFiles(fixture('pdf/sample-3-pages.pdf'));
    const out = await download(page, () => press(button(page, 'Download .txt')));
    const text = out.buf.toString('utf8');
    for (const n of [1, 2, 3]) expect(text).toContain(`Sample page ${n} of 3`);
    expect(text).toContain('The quick brown fox');
    expect(errors).toEqual([]);
  });

  test('markdown-to-pdf', async ({ page }) => {
    const errors = await openTool(page, 'markdown-to-pdf');
    await page.locator('textarea.editor').fill('# Hello Rounder\n\nSome **bold** text and a list:\n\n- one\n- two\n');
    const out = await download(page, () => press(button(page, 'Download PDF')));
    expect(isPdf(out.buf)).toBe(true);
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('watermark-pdf', async ({ page }) => {
    const errors = await openTool(page, 'watermark-pdf');
    await fileInput(page).setInputFiles(fixture('pdf/sample-3-pages.pdf'));
    await press(button(page, 'Add watermark'));
    const out = await download(page, () => press(button(page, 'Download PDF')));
    const doc = await PDFDocument.load(out.buf);
    expect(doc.getPageCount()).toBe(3);
    expect(out.buf.length).toBeGreaterThan((await readFile(fixture('pdf/sample-3-pages.pdf'))).length);
    expect(errors).toEqual([]);
  });

  test('fill-pdf-form', async ({ page }) => {
    const errors = await openTool(page, 'fill-pdf-form');
    await fileInput(page).setInputFiles(fixture('pdf/sample-form.pdf'));
    const onPage = page.locator('section[aria-label="Form pages"]');
    await onPage.getByRole('textbox', { name: 'Name' }).fill('Ada Lovelace');
    await onPage.getByRole('combobox', { name: 'Country' }).selectOption('Germany');
    await onPage.getByRole('radio', { name: 'Size: M' }).check();
    const out = await download(page, () => press(button(page, 'Download filled PDF')));
    const form = (await PDFDocument.load(out.buf)).getForm();
    expect(form.getTextField('name').getText()).toBe('Ada Lovelace');
    expect(form.getDropdown('country').getSelected()).toEqual(['Germany']);
    expect(form.getRadioGroup('size').getSelected()).toBe('M');
    expect(errors).toEqual([]);
  });

  test('invoice-generator', async ({ page }) => {
    const errors = await openTool(page, 'invoice-generator');
    const out = await download(page, () => press(button(page, 'Download PDF')));
    expect(isPdf(out.buf)).toBe(true);
    expect((await PDFDocument.load(out.buf)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

test.describe('files', () => {
  test('zip-files then unzip-files', async ({ page }) => {
    const errors = await openTool(page, 'zip-files');
    const a = 'hello from rounder\n'.repeat(200);
    const b = JSON.stringify({ n: 42, list: [1, 2, 3] });
    await fileInput(page).setInputFiles([
      { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from(a) },
      { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(b) },
    ]);
    const zip = await download(page, () => press(button(page, /^Create /)));
    expect(isZip(zip.buf)).toBe(true);
    const packed = unzipSync(zip.buf);
    expect(strFromU8(packed['a.txt'])).toBe(a);
    expect(strFromU8(packed['b.json'])).toBe(b);

    errors.push(...(await openTool(page, 'unzip-files')));
    await fileInput(page).setInputFiles({ name: zip.name, mimeType: 'application/zip', buffer: zip.buf });
    await expect(page.getByText('a.txt').first()).toBeVisible();
    const again = await download(page, () => press(button(page, 'Download all as .zip')));
    const unpacked = unzipSync(again.buf);
    const byName = Object.fromEntries(Object.entries(unpacked).map(([k, v]) => [k.split('/').pop(), v]));
    expect(strFromU8(byName['a.txt'])).toBe(a);
    expect(strFromU8(byName['b.json'])).toBe(b);
    expect(errors).toEqual([]);
  });

  test('file-encryptor round trip', async ({ page }) => {
    const errors = await openTool(page, 'file-encryptor');
    const original = Buffer.from(strToU8('secret payload '.repeat(5000)));
    await fileInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: original });
    await page.getByPlaceholder('Choose a strong password').fill('tulip-orbit-canvas-77');
    await page.locator('input[autocomplete="new-password"]').nth(1).fill('tulip-orbit-canvas-77');
    await press(button(page, 'Encrypt file'));
    const locked = await download(page, () => press(button(page, 'Download')));
    expect(locked.name).toMatch(/\.rndr$/);
    expect(locked.buf.includes(original.subarray(0, 64))).toBe(false);

    errors.push(...(await openTool(page, 'file-encryptor')));
    await fileInput(page).setInputFiles({ name: locked.name, mimeType: 'application/octet-stream', buffer: locked.buf });
    await page.getByPlaceholder('The password it was encrypted with').fill('tulip-orbit-canvas-77');
    await press(button(page, 'Decrypt file'));
    const back = await download(page, () => press(button(page, 'Download')));
    expect(back.buf.equals(original)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('media flows', () => {
  test.setTimeout(300_000);

  test('video-compressor', async ({ page }) => {
    const errors = await openTool(page, 'video-compressor');
    await acceptDecoder(page, /^Download decoder/);
    await fileInput(page).setInputFiles(fixture('media/sample.mp4'));
    await press(button(page, 'Compress video'));
    const out = await download(page, () => press(page.locator('button.btn-primary', { hasText: /^Download .+\.mp4$/ }), { timeout: 240_000 }), 240_000);
    expect(out.buf.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(errors).toEqual([]);
  });

  test('video-to-gif', async ({ page }) => {
    const errors = await openTool(page, 'video-to-gif');
    await acceptDecoder(page, /^Download decoder/);
    await fileInput(page).setInputFiles(fixture('media/sample.mp4'));
    if (!(await page.evaluate(() => typeof VideoDecoder !== 'undefined'))) {
      // frames are read with WebCodecs (the ffmpeg copy too), so the tool should say so instead of offering a download
      await expect(page.getByRole('alert')).toContainText('no WebCodecs');
      expect(errors).toEqual([]);
      test.skip(true, 'no WebCodecs VideoDecoder in this browser build; the tool explains that');
    }
    await press(button(page, 'Make GIF'), { timeout: 120_000 });
    const out = await download(page, () => press(button(page, /^Download .+\.gif$/), { timeout: 240_000 }), 240_000);
    expect(out.buf.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(errors).toEqual([]);
  });

  test('audio-converter wav to mp3', async ({ page }) => {
    const errors = await openTool(page, 'audio-converter');
    await acceptDecoder(page, /^Download it and convert$/);
    await press(page.getByRole('group', { name: 'Output format' }).getByRole('button', { name: 'MP3', exact: true }));
    await fileInput(page).setInputFiles(fixture('media/sample.wav'));
    await press(button(page, 'Convert 1 file to MP3'), { timeout: 60_000 });
    const out = await download(page, () => press(button(page, /^Download .+\.mp3$/), { timeout: 240_000 }), 240_000);
    const id3 = out.buf.subarray(0, 3).toString('latin1') === 'ID3';
    const sync = out.buf[0] === 0xff && (out.buf[1] & 0xe0) === 0xe0;
    expect(id3 || sync).toBe(true);
    expect(out.buf.length).toBeGreaterThan(10_000);
    expect(errors).toEqual([]);
  });

  test('audio-cutter', async ({ page }) => {
    const errors = await openTool(page, 'audio-cutter');
    await acceptDecoder(page, /^Download decoder/);
    await fileInput(page).setInputFiles(fixture('media/sample.mp3'));
    await press(button(page, 'Cut audio'), { timeout: 60_000 });
    const out = await download(page, () => press(button(page, 'Download'), { timeout: 240_000 }), 240_000);
    expect(out.buf.length).toBeGreaterThan(1_000);
    const head = out.buf.subarray(0, 12).toString('latin1');
    expect(/^ID3|^RIFF|^OggS|^fLaC|ftyp/.test(head) || (out.buf[0] === 0xff && (out.buf[1] & 0xe0) === 0xe0)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('everyday flows', () => {
  test('qr-code-generator', async ({ page }) => {
    const errors = await openTool(page, 'qr-code-generator');
    await page.locator('input[type=url]').fill('https://roundertools.com');
    const out = await download(page, () => press(button(page, 'Download PNG')));
    expect(isPng(out.buf)).toBe(true);
    expect(pngSize(out.buf).width).toBeGreaterThanOrEqual(200);
    expect(errors).toEqual([]);
  });

  test('json-formatter', async ({ page }) => {
    const errors = await openTool(page, 'json-formatter');
    const [input, output] = [page.locator('textarea').first(), page.locator('textarea[readonly]')];
    await input.fill('{"b":1,"a":[1,2]}');
    await expect(page.getByText('✓ valid JSON')).toBeVisible();
    await expect(output).toHaveValue('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
    await input.fill('{"b":1,');
    await expect(page.getByText('✕ invalid')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('word-counter', async ({ page }) => {
    const errors = await openTool(page, 'word-counter');
    await page.locator('textarea').fill('The quick brown fox jumps. Over the lazy dog!');
    const tile = (label: string) => page.locator('div.rounded-xl', { has: page.getByText(label, { exact: true }) }).locator('.font-serif');
    await expect(tile('words')).toHaveText('9');
    await expect(tile('sentences')).toHaveText('2');
    expect(errors).toEqual([]);
  });

  test('currency-converter', async ({ page }) => {
    const errors = await openTool(page, 'currency-converter');
    const converter = page.locator('section[aria-label="Converter"]');
    const failed = page.getByText('Rates are out of reach');
    await expect(converter.or(failed)).toBeVisible({ timeout: 30_000 });
    if (await failed.isVisible()) {
      // the live API can be down or blocked; failing politely is the behaviour to check then
      test.info().annotations.push({ type: 'network', description: 'Frankfurter API unreachable; checked the error state' });
      await expect(button(page, 'Try again')).toBeVisible();
    } else {
      await converter.locator('input.amount').fill('100');
      await expect(converter.locator('.text-sun').first()).toHaveText(/\d/);
    }
    expect(errors).toEqual([]);
  });

});

test.describe('offline flows', () => {
  // routes don't see requests a service worker makes in WebKit, so keep ours out of the way
  test.use({ serviceWorkers: 'block' });

  test('currency-converter offline', async ({ page }) => {
    await page.route(/frankfurter/, (r) => r.abort());
    const errors = await openTool(page, 'currency-converter');
    await expect(page.getByText('Rates are out of reach')).toBeVisible({ timeout: 30_000 });
    await expect(button(page, 'Try again')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
