import { z } from 'zod';
import { defineOp } from '../core/op';
import { size } from '../core/size';

export const zipFiles = defineOp({
  slug: 'zip-files',
  family: 'files',
  fn: 'zip',
  title: 'Zip files',
  summary: 'Pack files into one ZIP archive.',
  inputs: { accept: ['*'], min: 1, max: 65535, mode: 'all' },
  returns: 'file',
  options: z.object({
    level: z.enum(['store', 'normal', 'max']).default('normal').describe('normal skips files that are compressed already'),
    name: z.string().min(1).optional().describe('Archive name (default: the first file\'s, or "archive.zip")'),
  }),
  examples: [{ inputs: ['notes.txt', 'photo.jpg'], prompt: 'Zip notes.txt and photo.jpg together' }],
});

export const unzipFiles = defineOp({
  slug: 'unzip-files',
  family: 'files',
  fn: 'unzip',
  title: 'Unzip files',
  summary: 'Extract the files from a ZIP archive, safely: no paths outside the output folder, no symlinks, size caps.',
  inputs: { accept: ['zip'], min: 1, max: 1, mode: 'each' },
  returns: 'files',
  options: z.object({
    maxTotal: size().optional().describe('Refuse archives that unpack to more than this (default: 4× the archive, 2 GB at most)'),
    maxEntries: z.number().int().min(1).max(100000).default(10000),
  }),
  examples: [{ inputs: ['photos.zip'], prompt: 'Unzip photos.zip into a folder next to it' }],
});

export const checksum = defineOp({
  slug: 'checksum-calculator',
  family: 'files',
  fn: 'checksum',
  title: 'Checksum calculator',
  summary: 'MD5, SHA-1, SHA-256, SHA-384, SHA-512 and CRC32 of a file, and a check against an expected value.',
  inputs: { accept: ['*'], min: 1, max: 1, mode: 'each' },
  returns: 'data',
  readOnly: true,
  options: z.object({
    algorithms: z.array(z.enum(['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'])).min(1).default(['SHA-256']),
    expected: z.string().min(1).optional().describe('A checksum to compare against (hex, "hash  file" or SRI)'),
  }),
  short: { algorithms: 'a' },
  examples: [{ inputs: ['installer.dmg'], options: { expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, prompt: 'Check installer.dmg against this SHA-256: e3b0…' }],
});

export const fileInfo = defineOp({
  slug: 'file-info',
  family: 'files',
  fn: 'info',
  title: 'File info',
  summary: 'What a file is: PDF pages, encryption and metadata; image size and format; video and audio streams and length.',
  inputs: { accept: ['*'], min: 1, max: 1, mode: 'each' },
  returns: 'data',
  readOnly: true,
  options: z.object({ password: z.string().min(1).optional().describe('Opens an encrypted PDF') }),
  examples: [{ inputs: ['clip.mov'], prompt: 'How long is clip.mov and what resolution is it?' }],
});

export const fileOps = [zipFiles, unzipFiles, checksum, fileInfo];
