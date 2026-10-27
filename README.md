# Rounder

Free browser tools with no junk: [roundertools.com](https://roundertools.com). Every tool runs on the visitor's
device, so files are never uploaded and hosting is a static site.

## Stack

- **Astro 7** (static output) with **Svelte 5** islands and **Tailwind 4**
- One page per tool, generated from the registry in `src/tools/`
- Engines that run in Web Workers:
  - `src/engines/image`: jSquash codecs (MozJPEG, OxiPNG, WebP, AVIF), HEIC via heic-to
  - `src/engines/pdf`: pdf-lib, PDF.js and qpdf (wasm)
  - `src/tools/lib/office`: Office conversions. PDF → Word/Excel/PowerPoint rebuilds pages from PDF.js text and
    layout (`docx`, ExcelJS, PptxGenJS). Word/Excel/PowerPoint → PDF lays the file out in the browser (docx-preview,
    ExcelJS, pptx-renderer) and paints that layout into a PDF with real text, in metric-compatible fonts
  - `src/engines/media`: Mediabunny (WebCodecs), with an ffmpeg.wasm fallback for unusual formats
  - `src/engines/ai`: transformers.js and onnxruntime-web, on WebGPU with a WASM fallback
- Hosted on **Cloudflare** as a Worker with static assets (the ratings API is its only server code)

## Adding a tool

1. Write the island in `src/tools/islands/<Name>.svelte`, and put pure logic in `src/tools/lib/<tool>/`.
2. Add `src/tools/defs/<slug>.ts`. It default-exports a `Tool` (or a list of them, for variant pages); see `src/tools/types.ts`.
   The registry picks it up automatically, and the page, search entry, sitemap entry and share image are all generated.
3. Add unit tests for the pure logic in `tests/unit/<slug>.test.ts`.

Two optional hooks, both off unless a tool uses them:

- **`notes`** (in the def): first-hand content, rendered between "How it works" and the questions, never between the
  tool and its download button. `settings` (what each control does), `results` (real, measured runs, never estimates;
  they need `measured: { date: 'YYYY-MM-DD', device: 'Chrome 141 on a 2021 MacBook Air' }`, shown as the table's
  caption), `formats` and `limits` (a platform's file caps, with an https `source` link to its own docs).
  `notesProblems()` in the registry checks them, and `tests/unit/tool-notes.test.ts` runs it over every tool.
- **Success signal**: once a run gives the visitor a usable result (a download is ready, a result was copied), the island
  calls `toolSucceeded()` from `src/tools/lib/success.ts`, once per run and never for errors. Saving the result with
  `downloadResult()` (`src/tools/lib/files.ts`) instead of `downloadBlob()` does both; listeners ignore repeats. It dispatches
  `CustomEvent('rounder:tool-success', { detail: { slug } })` from ToolHost's wrapper (which carries the page's slug, so
  variant pages report their own) up to `window`; page-level islands subscribe with `onToolSuccess()`. The rating prompt
  (`src/components/tool/RatePrompt.svelte`, rendered under the tool card through `RateSlot.svelte`) listens for it. It must
  never gate a download or offer anything in exchange for a rating. Leave it unwired on the ad-free privacy tools.

Heavy tools (video, ffmpeg fallback, AI, big PDFs, collages, slideshows) check the device before a run with
`checkDevice(job, { bytes, seconds, width, height, count })` from `src/tools/lib/device-guard.ts`: `ok`, `warn` (show it
with `DeviceNote.svelte` and let the run start) or `block` (disable the start button; only for hard limits, or when
`navigator.deviceMemory` says the job needs far more than the device has). In the catch, `deviceMessage(job, err)` turns
any out-of-memory shape (RangeError, wasm `Aborted(OOM)`, Safari's canvas limit, an engine's `out-of-memory` code) into
"too big for this device: try …" advice. `tests/e2e/device-guard.spec.ts` covers it with emulated low-memory phones.

## Ratings

"Rate this tool" is the site's only server code: `worker/index.ts` on the same Worker as the static assets, run first for
`/api/*` only (`run_worker_first` in `wrangler.jsonc`), with a D1 database (`rounder-ratings`, schema in `migrations/`).
`POST /api/rate` stores `{ slug, stars, comment? }`, one per visitor and tool a day; rate limiting keys on a hash of the
IP with a salt that is deleted after each UTC day, and no IP is stored. `GET /api/rating/:slug` and `GET /api/ratings`
return `{ avg, count }`. Before each build `scripts/seo/ratings.mjs` snapshots the aggregates into `src/seo/ratings.json`
(keeping the last snapshot when offline). A tool page shows its rating, and adds `aggregateRating` to its WebApplication
JSON-LD, only from 20 ratings on (`src/seo/ratings.ts`). Never seed, edit or hard-code ratings.

To try the API locally: `npm run build`, then `npx wrangler@4 d1 migrations apply rounder-ratings --local` and
`npx wrangler@4 dev`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:4321 |
| `npm run build` | Production build into `dist/` |
| `npm run check` | Type checks (`astro check` plus `svelte-check --incremental`; the plain mode skips files here) |
| `npm run check:dist` | Checks a build in `dist/`: every sitemap page is linked and no link is broken, no ad code on ad-free pages, no two pages share more than 80% of their text |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Browser tests (Playwright): builds into `../.rounder-e2edist`, serves it on :4600 (`E2E_PORT` to change it) and runs every page plus real file flows in Chromium, Firefox, WebKit and two phone profiles. Install the browsers once with `npx playwright install chromium firefox webkit`; `E2E_SKIP_BUILD=1` reuses the last build, `E2E_DIST=<dir>` picks the build folder. |
| `npm run vendor` | Copies runtime files (ffmpeg, onnxruntime, Tesseract, PDF.js, libarchive, the Office to PDF fonts) into `public/vendor`. It runs automatically before `dev` and `build`. |

Engine test pages live under `/dev/` (for example `/dev/media-lab`, `/dev/ai-lab`). They are dropped from production builds.

## Deploying (Cloudflare)

Production runs as a Cloudflare Worker with static assets (`wrangler.jsonc`). Asset requests are free and unmetered and
never run server code; only `/api/*` (ratings) does. The custom domain's DNS record is created on deploy.

```sh
npm run build     # also runs the vendor step
npm run deploy    # wrangler: ratings DB migrations, the site on roundertools.com, plus workers/www-redirect (www → apex, 301)
```

`.env.production` holds the public build settings (AdSense publisher id, analytics token). Self-hosters can delete
it to build without ads or analytics. There is no `*.workers.dev` copy of the site, so only roundertools.com is
indexed. `public/_headers` sets security and cache headers.

Large wasm files are split into parts under 25 MB that are joined again in the browser and checked against a SHA-256,
so the site also fits Cloudflare Pages if you prefer it (build output `dist`, `NODE_VERSION=22`).

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
- Ratings: `POST /api/rate` on roundertools.com, only when a visitor sends one (tool slug, stars, optional comment).
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
6. Ratings need the Worker and D1 database in `worker/`. Without them, delete `src/components/tool/RatePrompt.svelte`
   (no rating box) and build with `RATINGS_OFFLINE=1` and an empty `src/seo/ratings.json`, so your copy never shows
   roundertools.com's ratings.

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
