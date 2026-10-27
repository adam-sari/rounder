/*
 * Sample PDFs for trying the PDF tools. Run from the project root:
 *   node tests/fixtures/pdf/generate.mjs
 *
 * sample-3-pages.pdf      Letter, big page numbers and a line of text per page
 * sample-50-pages.pdf     for thumbnails, scrolling and range inputs
 * sample-mixed-sizes.pdf  A4, Letter landscape, A5, and an A4 page with /Rotate 90
 * sample-form.pdf         text, multiline, checkbox, dropdown and radio fields
 * sample-unicode.pdf      Greek, Cyrillic and Central European text in Noto Sans
 * sample-images.pdf       two embedded PNGs (for image extraction)
 * sample-encrypted.pdf    open password "rounder" (AES-256), owner password "owner"
 * sample-restricted.pdf   no open password; printing/editing restricted (owner "owner")
 * sample-damaged.pdf      sample-3-pages cut short, for error handling
 * not-a-pdf.pdf           plain text with a .pdf name
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const { PDFDocument, StandardFonts, rgb, degrees } = pdfLib;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const require = createRequire(import.meta.url);
mkdirSync(here, { recursive: true });

const SIZES = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792] };
const save = (name, bytes) => {
  writeFileSync(join(here, name), bytes);
  console.log(`${name.padEnd(24)} ${bytes.length} bytes`);
};

async function numbered(count, title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Rounder test fixtures');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage(SIZES.Letter);
    const { width, height } = page.getSize();
    const hue = (i * 47) % 360;
    const [r, g, b] = [hue, hue + 120, hue + 240].map((h) => 0.55 + 0.35 * Math.cos((h * Math.PI) / 180));
    page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: rgb(r, g, b) });
    page.drawText(`Sample page ${i} of ${count}`, { x: 48, y: height - 58, size: 24, font: bold, color: rgb(0.1, 0.1, 0.1) });
    const label = String(i);
    page.drawText(label, { x: (width - bold.widthOfTextAtSize(label, 220)) / 2, y: height / 2 - 80, size: 220, font: bold, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(`The quick brown fox jumps over the lazy dog. Line for page ${i}.`, { x: 48, y: 72, size: 12, font });
  }
  return doc.save();
}

async function mixedSizes() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [
    ['A4 portrait', SIZES.A4, 0],
    ['Letter landscape', [SIZES.Letter[1], SIZES.Letter[0]], 0],
    ['A5 portrait', SIZES.A5, 0],
    ['A4 with /Rotate 90', SIZES.A4, 90],
  ];
  for (const [label, size, rotate] of pages) {
    const page = doc.addPage(size);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 12, y: 12, width: width - 24, height: height - 24, borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 3 });
    page.drawText(label, { x: 40, y: height - 70, size: 28, font });
    page.drawText('top-left', { x: 40, y: height - 110, size: 14, font, color: rgb(0.8, 0.2, 0.2) });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

async function form() {
  const doc = await PDFDocument.create();
  const page = doc.addPage(SIZES.Letter);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const f = doc.getForm();
  const label = (text, y) => page.drawText(text, { x: 60, y: y + 6, size: 12, font });

  label('Full name', 680);
  f.createTextField('name').addToPage(page, { x: 180, y: 672, width: 300, height: 26 });
  label('Email', 630);
  f.createTextField('email').addToPage(page, { x: 180, y: 622, width: 300, height: 26 });
  label('Notes', 560);
  const notes = f.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 180, y: 500, width: 300, height: 90 });
  label('Country', 450);
  const country = f.createDropdown('country');
  country.addOptions(['Canada', 'Germany', 'India', 'United Kingdom', 'United States']);
  country.addToPage(page, { x: 180, y: 442, width: 200, height: 26 });
  label('T-shirt size', 400);
  const size = f.createRadioGroup('size');
  ['S', 'M', 'L'].forEach((opt, i) => {
    size.addOptionToPage(opt, page, { x: 180 + i * 70, y: 396, width: 18, height: 18 });
    page.drawText(opt, { x: 204 + i * 70, y: 400, size: 12, font });
  });
  label('I agree to the terms', 350);
  f.createCheckBox('agree').addToPage(page, { x: 180, y: 348, width: 18, height: 18 });
  f.updateFieldAppearances(font);
  return doc.save();
}

async function unicode() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(join(root, 'public/fonts/pdf/NotoSans-Regular.ttf')), { subset: true });
  const page = doc.addPage(SIZES.A4);
  const lines = [
    'English: The quick brown fox jumps over the lazy dog.',
    'Ελληνικά: Γαζέες καὶ μυρτιὲς δὲν θὰ βρῶ πιά.',
    'Русский: Съешь же ещё этих мягких французских булок.',
    'Polski: Zażółć gęślą jaźń.',
    'Čeština: Příliš žluťoučký kůň úpěl ďábelské ódy.',
    'Türkçe: Pijamalı hasta yağız şoföre çabucak güvendi.',
  ];
  lines.forEach((text, i) => page.drawText(text, { x: 48, y: 780 - i * 32, size: 15, font }));
  return doc.save();
}

/** a minimal RGB PNG encoder, enough for a test image */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function images() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const gradient = await doc.embedPng(png(320, 200, (x, y) => [x * 0.8, y * 1.2, 255 - x * 0.6]));
  const checker = await doc.embedPng(png(160, 160, (x, y) => (((x >> 4) + (y >> 4)) % 2 ? [255, 210, 94] : [30, 28, 26])));
  const p1 = doc.addPage(SIZES.A4);
  p1.drawText('Page with a gradient image', { x: 48, y: 780, size: 18, font });
  p1.drawImage(gradient, { x: 48, y: 480, width: 480, height: 300 });
  const p2 = doc.addPage(SIZES.A4);
  p2.drawText('Page with a checkerboard image, drawn twice', { x: 48, y: 780, size: 18, font });
  p2.drawImage(checker, { x: 48, y: 560, width: 160, height: 160 });
  p2.drawImage(checker, { x: 260, y: 560, width: 80, height: 80 });
  return doc.save();
}

async function qpdf(args, input) {
  const createModule = require('@neslinesli93/qpdf-wasm');
  const q = await createModule({ locateFile: () => join(root, 'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm') });
  q.FS.writeFile('/in.pdf', input);
  const code = q.callMain([...args.map((a) => (a.endsWith('.pdf') ? `/${a}` : a))]);
  if (code !== 0 && code !== 3) throw new Error(`qpdf exited with ${code}`);
  return q.FS.readFile('/out.pdf');
}

const three = await numbered(3, 'Sample, 3 pages');
save('sample-3-pages.pdf', three);
save('sample-50-pages.pdf', await numbered(50, 'Sample, 50 pages'));
save('sample-mixed-sizes.pdf', await mixedSizes());
save('sample-form.pdf', await form());
save('sample-unicode.pdf', await unicode());
save('sample-images.pdf', await images());
save('sample-encrypted.pdf', await qpdf(['--encrypt', 'rounder', 'owner', '256', '--', 'in.pdf', 'out.pdf'], three));
save('sample-restricted.pdf', await qpdf(['--encrypt', '', 'owner', '256', '--print=none', '--modify=none', '--extract=n', '--', 'in.pdf', 'out.pdf'], three));
save('sample-damaged.pdf', three.slice(0, Math.floor(three.length * 0.6)));
save('not-a-pdf.pdf', new TextEncoder().encode('This is a plain text file pretending to be a PDF.\n'));
