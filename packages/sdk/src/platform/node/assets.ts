import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// every chunk sits flat in dist/, next to dist/assets/ (fonts and pdf.js data copied at build time)
const ROOT = fileURLToPath(new URL('./assets/', import.meta.url));

export const assetPath = (...parts: string[]) => join(ROOT, ...parts);
