// Copies runtime files that pdf.js and libarchive.js load by URL into public/vendor, so they
// come from our own origin and stay in step with the installed package versions.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = (p) => join(root, 'node_modules', p);
const to = (p) => join(root, 'public/vendor', p);

// pdf.js: CJK cmaps, the standard 14 fonts, colour profiles and image decoders.
// The quickjs sandbox (form scripting) is left out: we never run PDF JavaScript.
await mkdir(to('pdfjs'), { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'iccs']) await cp(from(`pdfjs-dist/${dir}`), to(`pdfjs/${dir}`), { recursive: true });
await cp(from('pdfjs-dist/wasm'), to('pdfjs/wasm'), { recursive: true, filter: (src) => !/quickjs/i.test(src) });
await cp(from('pdfjs-dist/LICENSE'), to('pdfjs/LICENSE'));

// libarchive.js: its worker and wasm for ZIP, RAR, 7z and TAR
await mkdir(to('libarchive'), { recursive: true });
for (const file of ['worker-bundle.js', 'libarchive.wasm']) await cp(from(`libarchive.js/dist/${file}`), to(`libarchive/${file}`));
await cp(from('libarchive.js/LICENSE'), to('libarchive/LICENSE'));

console.log('vendor-libs: pdf.js and libarchive runtime files copied');
