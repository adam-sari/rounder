// static server for the e2e build: clean URLs like Cloudflare Pages, plus the repo's fixtures under /tests
// usage: node scripts/serve-dist.mjs <dist> <repo> <port>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';

const [dist, repo, port] = process.argv.slice(2);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.gif': 'image/gif', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain', '.xml': 'application/xml', '.tflite': 'application/octet-stream', '.onnx': 'application/octet-stream',
};
const file = async (p) => { try { return (await stat(p)).isFile() ? p : null; } catch { return null; } };

createServer(async (req, res) => {
  // URL paths are always posix; join() turns them into native paths
  const path = posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const base = path.startsWith('/tests/') ? join(repo, path) : join(dist, path);
  const hit = (await file(base)) || (await file(base + '.html')) || (await file(join(base, 'index.html')));
  if (!hit) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(await readFile(join(dist, '404.html')).catch(() => 'not found'));
  }
  res.writeHead(200, { 'content-type': types[extname(hit)] || 'application/octet-stream' });
  res.end(await readFile(hit));
}).listen(Number(port), () => console.log(`serving ${dist} on http://localhost:${port}`));
