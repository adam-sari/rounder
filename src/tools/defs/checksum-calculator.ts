import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'checksum-calculator',
  category: 'files',
  name: 'File checksum calculator (MD5, SHA-256)',
  title: 'File Checksum Calculator: MD5, SHA-256, SHA-512 & CRC32',
  h1: 'File *checksum* calculator',
  description: 'Get the MD5, SHA-1, SHA-256, SHA-512 or CRC32 checksum of any file, even many GB, and verify a download. Runs in your browser, no upload.',
  tagline: 'Hash files of any size and verify downloads, without uploading them.',
  keywords: ['checksum calculator', 'md5 checksum', 'sha256 checksum', 'verify file hash', 'file hash online', 'sha512 checksum', 'crc32 calculator', 'verify download'],
  island: 'ChecksumCalculator',
  steps: [
    'Drop one or more files of any size.',
    'Pick the algorithms you need. They run in parallel, in background workers.',
    'Paste the checksum from the download page to see whether the file matches.',
  ],
  faq: [
    {
      q: 'How do I verify a download?',
      a: 'Drop the file, then paste the checksum the publisher lists (often labelled SHA256 or "checksum"). The algorithm is recognized from its length, so you don\'t need to pick it. A match means your copy is byte-for-byte identical to theirs.',
    },
    {
      q: 'Can it handle very large files?',
      a: 'Yes. Files are read in 8 MB pieces and hashed incrementally in background workers, so even a disk image many gigabytes in size never has to fit in memory and the page stays responsive. Speed depends on your device and disk.',
    },
    {
      q: 'Which algorithm should I use?',
      a: 'SHA-256 is the standard today. MD5 and SHA-1 are still fine for spotting accidental corruption, but they are broken against deliberate tampering, so don\'t rely on them for security. CRC32 is a quick check used inside zip files.',
    },
    {
      q: 'Can I paste sha256sum output?',
      a: 'Yes. A bare hash, a line like "hash  filename" from sha256sum, BSD style "SHA256 (file) = hash" and SRI strings like "sha384-…" all work, in upper or lower case.',
    },
    filePrivacyFaq,
  ],
  related: ['hash-generator', 'file-encryptor', 'unzip-files'],
} satisfies Tool;
