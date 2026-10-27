# Rounder

Free browser tools with no junk: [roundertools.com](https://roundertools.com). Every tool runs on the visitor's
device, so files are never uploaded and hosting is a static site.

## Stack

- **Astro 7** (static output) with **Svelte 5** islands and **Tailwind 4**
- One page per tool, generated from the registry in `src/tools/`
- Engines that run in Web Workers:
  - `src/engines/image`: jSquash codecs (MozJPEG, OxiPNG, WebP, AVIF), HEIC via heic-to
  - `src/engines/pdf`: pdf-lib, PDF.js and qpdf (wasm)
  - `src/engines/media`: Mediabunny (WebCodecs), with an ffmpeg.wasm fallback for unusual formats
  - `src/engines/ai`: transformers.js and onnxruntime-web, on WebGPU with a WASM fallback
- Hosted on **Cloudflare Pages**

## Adding a tool

1. Write the island in `src/tools/islands/<Name>.svelte`, and put pure logic in `src/tools/lib/<tool>/`.
2. Add `src/tools/defs/<slug>.ts`. It default-exports a `Tool` (or a list of them, for variant pages); see `src/tools/types.ts`.
   The registry picks it up automatically, and the page, search entry, sitemap entry and share image are all generated.
3. Add unit tests for the pure logic in `tests/unit/<slug>.test.ts`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:4321 |
| `npm run build` | Production build into `dist/` |
| `npm run check` | Type checks (`astro check` plus `svelte-check --incremental`; the plain mode skips files here) |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Browser tests (Playwright): builds into `../.rounder-e2edist`, serves it on :4600 and runs every page plus real file flows in Chromium, Firefox, WebKit and two phone profiles. Install the browsers once with `npx playwright install chromium firefox webkit`; `E2E_SKIP_BUILD=1` reuses the last build. |
| `npm run vendor` | Copies runtime files (ffmpeg, onnxruntime, Tesseract, PDF.js, libarchive) into `public/vendor`. It runs automatically before `dev` and `build`. |

Engine test pages live under `/dev/` (for example `/dev/media-lab`, `/dev/ai-lab`). They are dropped from production builds.

## Deploying to Cloudflare Pages

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variable:** `NODE_VERSION=22`

`public/_headers` sets security and cache headers. Cloudflare Pages rejects files over 25 MB, so the vendor
scripts split large wasm files into parts that are joined again in the browser and checked against a SHA-256.

The site sends no COOP/COEP headers on purpose, so that ad iframes keep working. Tools therefore avoid
SharedArrayBuffer, and onnxruntime runs single-threaded on WASM.

## Network use

Everything runs locally, with these exceptions:

- AI model weights are downloaded once from Hugging Face, pinned to exact revisions.
- Tesseract language data comes from jsDelivr.
- The currency converter fetches European Central Bank rates from the Frankfurter API.
- The password checker's breach lookup (Have I Been Pwned) runs only when the user clicks it.

All of this is described on `/privacy`. Licenses for libraries, fonts and models are listed on `/credits`.
