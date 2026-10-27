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

- AI model weights are downloaded once from Hugging Face, pinned to exact revisions. The video background remover's
  selfie-segmenter model comes from Google's model storage (storage.googleapis.com).
- Tesseract language data comes from jsDelivr.
- The currency converter fetches European Central Bank rates from the Frankfurter API.
- The password checker's breach lookup (Have I Been Pwned) runs only when the user clicks it.
- Images a document links to (Markdown editor, Markdown to PDF, HTML to PDF), and the email signature generator's
  photo or logo address, load from wherever they're hosted.
- In Chrome, the translator, summarizer, paraphraser and grammar checker can use the browser's built-in AI. Chrome may
  download that model from Google itself.
- Cloudflare Web Analytics (cookieless), only when `PUBLIC_CF_BEACON_TOKEN` is set.
- Google AdSense and its consent message, only when `PUBLIC_ADSENSE_CLIENT` is set (ad slots also need
  `PUBLIC_ADS_LIVE=true`). Never on the privacy, legal and trust pages, 404, offline, or the ad-free tools (`noAds` in
  their defs, mirrored in `SITE.adFree` for `scripts/seo/check-ads.mjs`).

The full list for users is on `/security` (keep the two in step), and `/privacy` explains what each service sees. Licenses for libraries, fonts and models are listed on `/credits`.

## Open source

Rounder is open source so anyone can check that the tools do what the site says: files stay on the device, and every
network request is the one listed on `/security`. Bug reports, tool ideas and pull requests are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) for vulnerabilities, and the
[code of conduct](CODE_OF_CONDUCT.md).

## Self-hosting

The build is a folder of static files, so any static host works.

1. Set `site` in `astro.config.mjs` to your own address (it drives canonical URLs, the sitemap and share cards).
2. `npm ci`, then `npm run build` (Node 22). The output is `dist/`.
3. Serve `dist/` over HTTPS (browsers allow WebGPU, camera access, Web Crypto and the service worker only on secure
   origins).
4. Copy the headers from `public/_headers` into your host's config. That file uses the Cloudflare Pages format.
   Don't add COOP/COEP headers; the tools are built without them.
5. Leave `PUBLIC_ADSENSE_CLIENT`, `PUBLIC_ADS_LIVE` and `PUBLIC_CF_BEACON_TOKEN` unset, and your copy carries no ads
   and no analytics. Please give your copy its own name and logo, and replace
   `public/.well-known/security.txt` and the contact details in `src/site.ts` with your own.

AI tools download model weights from Hugging Face at runtime, and OCR downloads language data from jsDelivr. To run
fully offline, mirror those files, set `baseUrl` on the models in `src/engines/ai/models.ts` and point
`LANGUAGE_BASE` in `src/tools/lib/ocr/languages.ts` at your copies.

## License

Rounder is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You may use, change and
share it under that license. If you run a modified version as a network service, you must offer its users the
corresponding source code (section 13).

## Third-party licenses

Libraries, vendored runtime files (`public/vendor`, copied from npm by `npm run vendor`), self-hosted models
(`public/models`), fonts and downloaded AI models keep their own licenses. They are listed with links on
[`/credits`](https://roundertools.com/credits) (source: `src/pages/credits.astro`), and each npm package's license is in its
folder under `node_modules`.
