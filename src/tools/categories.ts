export type CategoryId =
  | 'video' | 'audio' | 'image' | 'pdf' | 'ai'
  | 'text' | 'dev' | 'everyday' | 'files' | 'creator';

export interface Category {
  id: CategoryId;
  name: string;
  /** short line for cards */
  blurb: string;
  /** intro paragraph on the category page */
  intro: string;
  /** css color token for this category */
  spot: string;
}

export const categories: Category[] = [
  {
    id: 'video', name: 'Video', blurb: 'Compress, trim, convert, GIF',
    intro: 'Compress, trim, crop and convert videos right in your browser. No upload queue, no watermark, no file-size cap.',
    spot: 'var(--color-video)',
  },
  {
    id: 'audio', name: 'Audio', blurb: 'Cut, convert, boost, clean up',
    intro: 'Cut, join, convert and clean up audio files without installing anything or sending them to a server.',
    spot: 'var(--color-audio)',
  },
  {
    id: 'image', name: 'Image', blurb: 'Compress, resize, HEIC to JPG',
    intro: 'Compress, resize, crop and convert images in bulk. Everything happens on your device, so it is fast and private.',
    spot: 'var(--color-image)',
  },
  {
    id: 'pdf', name: 'PDF', blurb: 'Merge, split, sign, edit',
    intro: 'Merge, split, compress, sign and edit PDFs for free. Your documents never leave your computer.',
    spot: 'var(--color-pdf)',
  },
  {
    id: 'ai', name: 'AI tools', blurb: 'Backgrounds, subtitles, upscaling',
    intro: 'AI tools that usually cost a subscription, running locally in your browser: background removal, subtitles, upscaling and more.',
    spot: 'var(--color-ai)',
  },
  {
    id: 'text', name: 'Text', blurb: 'Count, compare, convert case',
    intro: 'Quick text utilities for writers, students and anyone wrangling words.',
    spot: 'var(--color-text)',
  },
  {
    id: 'dev', name: 'Developer', blurb: 'JSON, Base64, hashes, UUIDs',
    intro: 'Everyday developer utilities with no tracking and no pasting your data into someone else\'s server.',
    spot: 'var(--color-dev)',
  },
  {
    id: 'everyday', name: 'Everyday', blurb: 'QR codes, calculators, timers',
    intro: 'Handy little tools for everyday jobs: QR codes, converters, calculators and timers.',
    spot: 'var(--color-everyday)',
  },
  {
    id: 'files', name: 'Files & privacy', blurb: 'Zip, encrypt, passwords',
    intro: 'Zip, unzip, encrypt and generate passwords, all locally, because privacy tools should be private.',
    spot: 'var(--color-files)',
  },
  {
    id: 'creator', name: 'Creator', blurb: 'Thumbnails, invoices, socials',
    intro: 'Tools for creators and freelancers: thumbnails, social image sizes, invoices and signatures.',
    spot: 'var(--color-creator)',
  },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

export const categoryPath = (id: CategoryId) => `/${id}-tools`;
