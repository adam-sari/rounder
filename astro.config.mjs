import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions } from 'vite';
import { updateLastmod } from './scripts/seo/lastmod.mjs';

// the /dev lab pages exercise engines with local fixtures; they stay out of production
const dropDevPages = {
  name: 'drop-dev-pages',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await rm(new URL('dev', dir), { recursive: true, force: true });
      await rm(new URL('dev.html', dir), { force: true });
    },
  },
};

// sitemap <lastmod> dates come from src/seo/lastmod.json, refreshed before every build
// (the sitemaps themselves are routes: src/pages/sitemap-*.xml.ts)
const seoLastmod = {
  name: 'seo-lastmod',
  hooks: {
    'astro:config:setup': ({ command, config }) => {
      if (command === 'build') updateLastmod(fileURLToPath(config.root));
    },
  },
};

export default defineConfig({
  site: 'https://roundertools.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [svelte(), dropDevPages, seoLastmod],
  vite: {
    plugins: [tailwindcss()],
    worker: {
      format: 'es',
      // WebKit evaluates a module worker's entry a second time when one of its lazy chunks imports from it:
      // Comlink then answers every call twice, and mediabunny splits in two, so its wasm mp3/aac encoders
      // register on the copy nobody asks. Vite lets the bundler fold shared code into worker entries;
      // strict entry signatures keep it in chunks of its own, so lazy chunks never import an entry.
      plugins: () => [{ name: 'strict-worker-entries', options: (o) => ({ ...o, preserveEntrySignatures: 'strict' }) }],
    },
    // onnxruntime-web's extern-wasm build never references its 27 MB .wasm (over Cloudflare's 25 MB file
    // limit); the AI engine loads split, version-matched copies from /vendor/ort instead
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
    // wasm codecs locate their .wasm files relative to themselves; pre-bundling breaks that
    optimizeDeps: {
      include: [
        'comlink', 'fflate', 'qr-code-styling', 'gifenc', 'exifr', 'imagetracerjs',
        'pdf-lib', '@pdf-lib/fontkit', 'papaparse', 'marked', 'dompurify', 'diff', 'sql-formatter', 'cronstrue',
        'jsbarcode', 'csso', 'terser', '@zxcvbn-ts/core', '@zxcvbn-ts/language-common', '@zxcvbn-ts/language-en',
        // one shared mediabunny instance, so the wasm mp3/aac encoders register where the engine looks
        'mediabunny', '@mediabunny/mp3-encoder', '@mediabunny/aac-encoder', '@ffmpeg/ffmpeg',
        'pdfjs-dist/legacy/build/pdf.mjs', '@shiguredo/rnnoise-wasm', '@huggingface/transformers',
      ],
      exclude: [
        '@jsquash/jpeg', '@jsquash/png', '@jsquash/webp', '@jsquash/avif', '@jsquash/oxipng', '@jsquash/resize', 'heic-to',
        '@embedpdf/pdfium', '@neslinesli93/qpdf-wasm', 'zxing-wasm', 'libarchive.js',
      ],
    },
  },
});
