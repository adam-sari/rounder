# @roundertools/sdk

The file tools from [roundertools.com](https://roundertools.com) for Node.js: compress, merge, split, protect and
unlock PDFs, convert, compress and resize images, zip and unzip files, and shrink, convert or trim video with your own
ffmpeg. It's the site's own code, bundled for Node, so the results match what the site makes. Everything runs in your
process: no API keys, no uploads, no network requests.

```sh
npm install @roundertools/sdk
```

Node 22.13 or newer. Optional: [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas) for PDF to JPG and for
GIF, BMP or SVG input, and an `ffmpeg` on your PATH (or at `ROUNDERTOOLS_FFMPEG`) for video and audio.

## Use

```js
import { pdf, image, media, files } from '@roundertools/sdk';

const small = await pdf.compress('report.pdf', { target: '1mb' });
console.log(small.size, small.meta.fits);
await small.save(); // ./report-compressed.pdf; never replaces an existing file

const merged = await pdf.merge(['a.pdf', 'b.pdf', 'cover.jpg'], { bookmarks: true });
await merged.save('out/merged.pdf');

const webp = await image.convert('photo.png', { to: 'webp', quality: 80 });
const parts = await pdf.split('book.pdf', { ranges: '1-10, 11-' });
const text = await pdf.toText('paper.pdf');
const clip = await media.compress('clip.mov', { target: '25mb' }); // uses your ffmpeg
const sums = await files.checksum('installer.dmg', { algorithms: ['SHA-256'] });
```

Inputs are paths, `file:` URLs, `Uint8Array`s, `ArrayBuffer`s, Blobs or `{ name, data }`. Results are `FileOutput`s:
`data`, `name`, `mime`, `size`, `meta` (page counts, pixel sizes, whether a target was met…), `warnings`, `save(path?, {
overwrite? })` and `toBlob()`. `save()` writes atomically (a temp file, then a link) and refuses to clobber.

Sizes are decimal like the site's targets (`"100kb"` = 100,000 bytes); `"100KiB"` is binary.

## Every tool by name

```js
import { run, describe, ops } from '@roundertools/sdk';

const r = await run('compress-pdf-to-100kb', ['scan.pdf']); // the site's preset pages work too
describe('image-resizer').options; // JSON Schema of the options
```

`run(slug, inputs, options, { signal, onProgress })` is what the CLI and the MCP server call.

## Errors

Everything throws `RounderError` with a readable `message`, an optional `hint` and a `code`: `needs-password`,
`wrong-password`, `damaged`, `unsupported-input`, `unsupported-codec`, `missing-dependency`, `invalid-options`,
`out-of-memory`, `aborted`, `exists` or `failed`.

## The tools

| PDF | Images | Files | Video and audio (ffmpeg) |
| --- | --- | --- | --- |
| `pdf.merge`, `split`, `compress`, `protect`, `unlock`, `organize`, `addPageNumbers`, `watermark`, `fromImages`, `toText`, `toImages`, `extractImages` | `image.convert`, `compress`, `resize`, `crop`, `rotate`, `stripMetadata` | `files.zip`, `unzip`, `checksum`, `info` | `media.compress`, `convert`, `trim`, `mute`, `toGif`, `toAudio`, `convertAudio` |

Options for each: [roundertools.com/developers/tools](https://roundertools.com/developers/tools), or your editor's
autocomplete.

## Safety

- Unzipping refuses paths that climb out of the folder, never creates symlinks, and caps the unpacked size and entry
  count. Image decoding refuses pictures over 100 megapixels before decoding them.
- ffmpeg runs as a separate program with an argument list (never a shell), with `-protocol_whitelist file,pipe` and
  `file:` paths, so file names can't be read as protocols or options.
- `@roundertools/sdk/no-network` blocks every outgoing connection in the process (fetch, http, https, net, tls, dgram,
  DNS lookups, and worker threads): `node --import @roundertools/sdk/no-network app.mjs`. The SDK makes none; this is a safeguard.

## License

MIT. The bundle includes the site's engine code (offered under MIT as well; see the repository's REUSE.toml) and the
packages listed in THIRD_PARTY_NOTICES.md. Source: [github.com/adam-sari/rounder](https://github.com/adam-sari/rounder)
in `packages/sdk`.
