import { z } from 'zod';
import { defineOp } from '../core/op';
import { size } from '../core/size';

const password = z.string().min(1).optional().describe('Password that opens the PDF, if it has one');
const pages = z.string().min(1).optional().describe('Pages, like "1-3, 5, 8-" (default: all)');
const anchor = z.enum(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']);
const kb = (props: Record<string, unknown>) => (typeof props.targetKb === 'number' ? `${props.targetKb}kb` : undefined);

export const mergePdf = defineOp({
  slug: 'merge-pdf',
  family: 'pdf',
  fn: 'merge',
  title: 'Merge PDF',
  summary: 'Combine PDFs (and JPG or PNG images) into one PDF, in the order given.',
  inputs: { accept: ['pdf', 'jpg', 'jpeg', 'png'], min: 2, max: 500, mode: 'all' },
  returns: 'file',
  suffix: '-merged',
  options: z.object({
    bookmarks: z.boolean().default(false).describe('Add one bookmark per input file'),
    keepInfo: z.boolean().default(true).describe("Copy the first PDF's title, author and dates"),
    title: z.string().optional().describe('Document title when the inputs have none'),
    password: z.string().min(1).optional().describe('Password for encrypted inputs (the same one for each)'),
  }),
  examples: [{ inputs: ['a.pdf', 'b.pdf', 'c.pdf'], prompt: 'Merge a.pdf, b.pdf and c.pdf in my Downloads folder into one PDF' }],
});

export const splitPdf = defineOp({
  slug: 'split-pdf',
  family: 'pdf',
  fn: 'split',
  title: 'Split PDF',
  summary: 'Cut a PDF into several files: by page ranges, every N pages, or parts under a size limit.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'files',
  options: z.object({
    ranges: z.string().min(1).optional().describe('One file per range, like "1-3, 4-6, 7-"'),
    every: z.number().int().min(1).optional().describe('One file per N pages'),
    maxSize: size().optional().describe('Parts no bigger than this, like "10mb"'),
    password,
  }),
  examples: [
    { inputs: ['book.pdf'], options: { ranges: '1-10, 11-20, 21-' }, prompt: 'Split book.pdf into pages 1-10, 11-20 and the rest' },
    { inputs: ['scan.pdf'], options: { maxSize: '10mb' }, prompt: 'Split scan.pdf into parts under 10 MB for email' },
  ],
});

export const compressPdf = defineOp({
  slug: 'compress-pdf',
  family: 'pdf',
  fn: 'compress',
  title: 'Compress PDF',
  summary: 'Shrink a PDF: downscale and recompress its photos, then repack the file losslessly, or hit a size target.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-compressed',
  options: z.object({
    level: z.enum(['light', 'recommended', 'strong']).default('recommended').describe('light: lossless only · recommended: photos at 150 dpi · strong: 100 dpi'),
    target: size().optional().describe('Upper size limit, like "100kb" or "2mb" (1 KB = 1,000 bytes); overrides level'),
    dpi: z.number().int().min(50).max(300).optional().describe('Custom photo resolution (with quality, overrides level)'),
    quality: z.number().int().min(10).max(95).optional().describe('Custom JPEG quality for photos'),
    grayscale: z.boolean().default(false).describe('Turn photos gray'),
    stripMetadata: z.boolean().default(false).describe('Remove title, author and XMP metadata'),
    password,
  }),
  short: { target: 't', level: 'l' },
  examples: [
    { inputs: ['report.pdf'], prompt: 'Compress report.pdf' },
    { inputs: ['report.pdf'], options: { target: '1mb' }, prompt: 'Compress ~/Downloads/report.pdf to under 1 MB' },
  ],
  presets: (p) => (kb(p) ? { target: kb(p) } : null),
  deepLink: (o) => (typeof o.target === 'string' && /^\d+(\.\d+)?\s*(kb|mb)$/i.test(o.target) ? `#${o.target.replace(/\s+/g, '').toLowerCase()}` : ''),
});

export const protectPdf = defineOp({
  slug: 'protect-pdf',
  family: 'pdf',
  fn: 'protect',
  title: 'Protect PDF',
  summary: 'Lock a PDF with a password (AES-256), and optionally stop printing, copying or editing.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-protected',
  options: z.object({
    password: z.string().min(1).describe('The password needed to open the PDF'),
    ownerPassword: z.string().min(1).optional().describe('Permissions password (random when restricting without one)'),
    print: z.boolean().default(true).describe('Allow printing'),
    copy: z.boolean().default(true).describe('Allow copying text and images'),
    edit: z.boolean().default(true).describe('Allow editing pages and content'),
    comment: z.boolean().default(true).describe('Allow comments'),
    forms: z.boolean().default(true).describe('Allow filling in forms'),
  }),
  short: { password: 'p' },
  examples: [{ inputs: ['contract.pdf'], options: { password: 'correct horse' }, prompt: 'Password-protect contract.pdf' }],
});

export const unlockPdf = defineOp({
  slug: 'unlock-pdf',
  family: 'pdf',
  fn: 'unlock',
  title: 'Unlock PDF',
  summary: 'Remove the password and restrictions from a PDF you can open.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-unlocked',
  options: z.object({ password }),
  short: { password: 'p' },
  examples: [{ inputs: ['statement.pdf'], options: { password: '1234' }, prompt: 'Remove the password from statement.pdf (it is 1234)' }],
});

export const organizePdf = defineOp({
  slug: 'organize-pdf',
  family: 'pdf',
  fn: 'organize',
  title: 'Organize PDF',
  summary: 'Reorder, rotate and delete pages of a PDF.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-organized',
  options: z.object({
    order: z.string().min(1).optional().describe('New page order, like "3, 1-2, 4-" or "reverse"'),
    rotate: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional().describe('Turn pages clockwise by this many degrees'),
    rotatePages: pages.describe('Which pages to rotate (default: all)'),
    remove: z.string().min(1).optional().describe('Pages to delete, like "2, 5-6"'),
    password,
  }),
  examples: [
    { inputs: ['scan.pdf'], options: { rotate: 90 }, prompt: 'Rotate every page of scan.pdf 90 degrees clockwise' },
    { inputs: ['deck.pdf'], options: { remove: '2, 5-6' }, prompt: 'Delete pages 2, 5 and 6 from deck.pdf' },
  ],
});

export const addPageNumbers = defineOp({
  slug: 'add-page-numbers-to-pdf',
  family: 'pdf',
  fn: 'addPageNumbers',
  title: 'Add page numbers',
  summary: 'Stamp page numbers on a PDF, in any corner, with "Page 1 of N" style labels.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-numbered',
  options: z.object({
    format: z.string().min(1).default('{n}').describe('Label template: {n} is the number, {total} the last one, e.g. "Page {n} of {total}"'),
    position: anchor.default('bc').describe('tl, tc, tr, ml, mc, mr, bl, bc or br'),
    start: z.number().int().min(0).default(1).describe('First number'),
    pages,
    skipFirst: z.boolean().default(false).describe('Leave the first page (a cover) unnumbered'),
    size: z.number().min(4).max(96).default(11).describe('Font size in points'),
    margin: z.number().min(0).max(200).default(28).describe('Distance from the edge in points'),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#222222'),
    font: z.enum(['sans', 'serif', 'mono']).default('sans'),
    bold: z.boolean().default(false),
    password,
  }),
  examples: [{ inputs: ['thesis.pdf'], options: { format: 'Page {n} of {total}', skipFirst: true }, prompt: 'Add "Page X of Y" numbers to thesis.pdf, skipping the cover' }],
});

export const watermarkPdf = defineOp({
  slug: 'watermark-pdf',
  family: 'pdf',
  fn: 'watermark',
  title: 'Watermark PDF',
  summary: 'Stamp text like CONFIDENTIAL across the pages of a PDF.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-watermarked',
  options: z.object({
    text: z.string().min(1).default('CONFIDENTIAL'),
    opacity: z.number().min(0.05).max(1).default(0.25),
    angle: z.union([z.enum(['diagonal', 'level']), z.number().min(-180).max(180)]).default('diagonal').describe('"diagonal", "level", or degrees'),
    position: z.union([anchor, z.literal('tile')]).default('mc').describe('An anchor (tl … br) or "tile"'),
    size: z.number().min(6).max(300).default(64).describe('Font size in points'),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#e5484d'),
    font: z.enum(['sans', 'serif', 'mono']).default('sans'),
    bold: z.boolean().default(true),
    margin: z.number().min(0).max(300).default(36).describe('Margin from the edges, or the gap between tiles'),
    under: z.boolean().default(false).describe('Put the mark under the page content'),
    pages,
    password,
  }),
  examples: [{ inputs: ['draft.pdf'], options: { text: 'DRAFT' }, prompt: 'Watermark draft.pdf with DRAFT on every page' }],
});

export const jpgToPdf = defineOp({
  slug: 'jpg-to-pdf',
  family: 'pdf',
  fn: 'fromImages',
  title: 'JPG to PDF',
  summary: 'Turn photos and images (JPG, PNG, WebP, AVIF) into one PDF, one image per page.',
  inputs: { accept: ['jpg', 'jpeg', 'png', 'webp', 'avif'], min: 1, max: 1000, mode: 'all' },
  returns: 'file',
  options: z.object({
    pageSize: z.enum(['A4', 'Letter', 'fit']).default('A4').describe('"fit" makes each page the size of its image'),
    orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
    margin: z.enum(['none', 'small', 'big']).default('small'),
    placement: z.enum(['fit', 'fill']).default('fit').describe('fit shows the whole image; fill covers the page and crops'),
  }),
  examples: [{ inputs: ['page1.jpg', 'page2.jpg'], prompt: 'Make a PDF from page1.jpg and page2.jpg' }],
  presets: (p) => (p.size === 'fit' ? { pageSize: 'fit' as const } : null),
});

export const pdfToText = defineOp({
  slug: 'pdf-to-text',
  family: 'pdf',
  fn: 'toText',
  title: 'PDF to text',
  summary: 'Pull the text out of a PDF, in reading order, as plain text or Markdown.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'text',
  readOnly: true,
  untrustedText: true,
  options: z.object({
    format: z.enum(['text', 'markdown']).default('text'),
    markers: z.boolean().default(false).describe('Add a "Page N" line before each page'),
    join: z.boolean().default(true).describe('Join lines that wrap inside a paragraph'),
    pages,
    password,
  }),
  examples: [{ inputs: ['paper.pdf'], prompt: 'What does paper.pdf say about the method?' }],
});

export const pdfToJpg = defineOp({
  slug: 'pdf-to-jpg',
  family: 'pdf',
  fn: 'toImages',
  title: 'PDF to JPG',
  summary: 'Save each PDF page as a JPG or PNG image.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'files',
  requires: ['canvas'],
  options: z.object({
    format: z.enum(['jpeg', 'png']).default('jpeg'),
    dpi: z.number().int().min(36).max(600).default(150),
    quality: z.number().int().min(10).max(100).default(90).describe('JPEG quality'),
    pages,
    password,
  }),
  examples: [{ inputs: ['slides.pdf'], options: { dpi: 200 }, prompt: 'Export every page of slides.pdf as a JPG' }],
  presets: (p) => (p.format === 'png' ? { format: 'png' as const } : null),
});

export const extractImages = defineOp({
  slug: 'extract-images-from-pdf',
  family: 'pdf',
  fn: 'extractImages',
  title: 'Extract images from PDF',
  summary: 'Save the photos and pictures inside a PDF as the original JPGs, or as PNGs.',
  inputs: { accept: ['pdf'], min: 1, max: 1, mode: 'each' },
  returns: 'files',
  options: z.object({
    minSize: z.number().int().min(1).default(32).describe('Skip images smaller than this many pixels on their longer side'),
    password,
  }),
  examples: [{ inputs: ['brochure.pdf'], prompt: 'Pull the photos out of brochure.pdf' }],
});

export const pdfOps = [mergePdf, splitPdf, compressPdf, protectPdf, unlockPdf, organizePdf, addPageNumbers, watermarkPdf, jpgToPdf, pdfToText, pdfToJpg, extractImages];
