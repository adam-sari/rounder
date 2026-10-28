import { z } from 'zod';
import { defineOp } from '../core/op';
import { size } from '../core/size';

const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'];
const format = z.enum(['jpeg', 'png', 'webp', 'avif']);
const keepOrFormat = z.enum(['keep', 'jpeg', 'png', 'webp', 'avif']).default('keep').describe('Output format; "keep" uses the input\'s');

export const imageConverter = defineOp({
  slug: 'image-converter',
  family: 'image',
  fn: 'convert',
  title: 'Image converter',
  summary: 'Convert images between JPG, PNG, WebP and AVIF.',
  inputs: { accept: IMAGES, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  options: z.object({
    to: format.default('jpeg').describe('jpeg, png, webp or avif'),
    quality: z.number().int().min(1).max(100).optional().describe('1–100 (default: 90 JPG, 85 WebP, 65 AVIF)'),
    lossless: z.boolean().default(false).describe('Lossless WebP or AVIF'),
    background: z.string().regex(/^#[0-9a-f]{6}$/i).default('#ffffff').describe('Fill behind transparency for JPG'),
  }),
  examples: [{ inputs: ['photo.png'], options: { to: 'webp' }, prompt: 'Convert photo.png to WebP' }],
  presets: (p) => (p.to === 'jpeg' || p.to === 'png' || p.to === 'webp' || p.to === 'avif' ? { to: p.to as 'jpeg' } : null),
});

export const imageCompressor = defineOp({
  slug: 'image-compressor',
  family: 'image',
  fn: 'compress',
  title: 'Image compressor',
  summary: 'Make images smaller: re-encode at a lower quality, or hit a size target.',
  inputs: { accept: IMAGES, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-compressed',
  options: z.object({
    quality: z.number().int().min(1).max(100).default(75),
    target: size().optional().describe('Upper size limit, like "200kb" (overrides quality)'),
    format: keepOrFormat,
    maxSide: z.number().int().min(16).optional().describe('Also shrink so the longer side is at most this many pixels'),
    neverBigger: z.boolean().default(true).describe('Keep the original when compressing would make it bigger'),
  }),
  short: { target: 't' },
  examples: [
    { inputs: ['photo.jpg'], prompt: 'Compress photo.jpg' },
    { inputs: ['photo.jpg'], options: { target: '200kb' }, prompt: 'Get photo.jpg under 200 KB' },
  ],
});

export const imageResizer = defineOp({
  slug: 'image-resizer',
  family: 'image',
  fn: 'resize',
  title: 'Image resizer',
  summary: 'Resize images by pixels, by percent, or down to a file size.',
  inputs: { accept: IMAGES, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-resized',
  options: z.object({
    width: z.number().int().min(1).max(30000).optional(),
    height: z.number().int().min(1).max(30000).optional(),
    mode: z.enum(['fit', 'fill', 'stretch', 'scale']).default('fit').describe('fit keeps the shape inside width × height; fill crops to cover it'),
    percent: z.number().min(1).max(1000).optional().describe('Scale by this percent (mode "scale")'),
    enlarge: z.boolean().default(false).describe('Allow making images bigger'),
    target: size().optional().describe('Shrink until the file is under this size, like "100kb"'),
    format: keepOrFormat,
    quality: z.number().int().min(1).max(100).default(85),
  }),
  short: { width: 'w' },
  examples: [
    { inputs: ['banner.png'], options: { width: 1200 }, prompt: 'Resize banner.png to 1200 pixels wide' },
    { inputs: ['photo.jpg'], options: { target: '100kb' }, prompt: 'Shrink photo.jpg under 100 KB for a form' },
  ],
  presets: (p) => {
    if (p.mode === 'target' && typeof p.targetKb === 'number') return { target: `${p.targetKb}kb` };
    if (p.mode === 'target' && Array.isArray(p.rangeKb)) return { target: `${p.rangeKb[1]}kb` };
    return null;
  },
});

export const cropImage = defineOp({
  slug: 'crop-image',
  family: 'image',
  fn: 'crop',
  title: 'Crop image',
  summary: 'Crop an image to a box in pixels, or to an aspect ratio from the center.',
  inputs: { accept: IMAGES, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-cropped',
  options: z.object({
    aspect: z.string().regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/).optional().describe('Largest centered box with this shape, like "1:1" or "16:9"'),
    x: z.number().int().min(0).optional(),
    y: z.number().int().min(0).optional(),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    format: keepOrFormat,
    quality: z.number().int().min(1).max(100).default(90),
  }),
  examples: [{ inputs: ['portrait.jpg'], options: { aspect: '1:1' }, prompt: 'Crop portrait.jpg to a square' }],
});

export const rotateImage = defineOp({
  slug: 'rotate-image',
  family: 'image',
  fn: 'rotate',
  title: 'Rotate image',
  summary: 'Turn images by 90, 180 or 270 degrees, or flip them.',
  inputs: { accept: IMAGES, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-rotated',
  options: z.object({
    by: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(90).describe('Degrees clockwise'),
    flip: z.enum(['none', 'horizontal', 'vertical']).default('none'),
    format: keepOrFormat,
    quality: z.number().int().min(1).max(100).default(92),
  }),
  examples: [{ inputs: ['sideways.jpg'], options: { by: 90 }, prompt: 'Rotate sideways.jpg a quarter turn clockwise' }],
});

export const exifRemover = defineOp({
  slug: 'exif-remover',
  family: 'image',
  fn: 'stripMetadata',
  title: 'EXIF remover',
  summary: 'Remove EXIF, GPS location, XMP and other metadata from JPG, PNG and WebP, without re-encoding.',
  inputs: { accept: ['jpg', 'jpeg', 'png', 'webp'], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-clean',
  options: z.object({
    keepOrientation: z.boolean().default(true).describe('Keep only the rotation tag, so photos stay upright'),
    keepColorProfile: z.boolean().default(true).describe('Keep the ICC profile, so colors look the same'),
  }),
  examples: [{ inputs: ['IMG_2041.jpg'], prompt: 'Remove the location data from IMG_2041.jpg before I post it' }],
});

export const imageOps = [imageConverter, imageCompressor, imageResizer, cropImage, rotateImage, exifRemover];
