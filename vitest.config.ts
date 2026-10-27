import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // some suites run real wasm (qpdf, pdf.js, codecs), which can be slow on a busy machine
  test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 30_000 },
});
