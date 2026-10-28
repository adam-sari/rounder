# roundertools

The tools from [roundertools.com](https://roundertools.com) on the command line. Compress, merge and split PDFs, convert
and resize images, zip files, and shrink video with your own ffmpeg. Everything runs on your machine; files are never
uploaded and the CLI makes no network requests.

```sh
npx roundertools compress-pdf report.pdf --target 1mb
npx roundertools merge-pdf a.pdf b.pdf c.pdf -o merged.pdf
npx roundertools image-converter "photos/*.png" --to webp -o webp/
npx roundertools png-to-jpg scan.png             # the site's preset pages work as commands
npx roundertools video-compressor clip.mov --target 25mb
cat in.pdf | npx roundertools compress-pdf - -o - > out.pdf
```

Commands are the tools' addresses on the site. `roundertools list` shows them all, `roundertools help <tool>` explains
a tool's options, and `roundertools doctor` checks Node, ffmpeg and the optional canvas.

Needs Node 22.13 or newer. Video and audio need `ffmpeg` on your PATH or at `ROUNDERTOOLS_FFMPEG`. PDF to JPG and GIF,
BMP or SVG input need `npm install @napi-rs/canvas`.

## Inputs and outputs

- Inputs: files, quoted globs (they expand the same way on Windows), folders with `--recursive`, or `-` for stdin.
- Outputs: next to each input with the site's names (`report-compressed.pdf`), into a folder with `-o out/`, one file
  with `-o name.pdf`, or stdout with `-o -`.
- Nothing is ever replaced: a clash gets `report-compressed (2).pdf`, and naming an existing file with `-o` is an error.
  `--overwrite` allows replacing outputs. Inputs are never replaced.
- Batches carry on past a failed file. `-j N` runs N files at a time.
- `ROUNDERTOOLS_PASSWORD` supplies passwords without putting them in your shell history.

## For scripts and AI agents

`--json` prints one JSON document at the end; `--ndjson` streams `progress`, `result`, `error` and `summary` lines.

```json
{ "schema": 1, "ok": true, "tool": "compress-pdf", "version": "0.1.0",
  "results": [{ "input": "/work/report.pdf", "output": "/work/report-compressed.pdf", "outputs": [ … ],
                "bytesIn": 3375514, "bytesOut": 118735, "ratio": 0.035, "meta": { … }, "warnings": [] }],
  "errors": [], "durationMs": 1012, "web": "https://roundertools.com/compress-pdf" }
```

The package includes an Agent Skill, `skill/SKILL.md`, that teaches coding agents to use the CLI.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every input worked |
| 1 | the tool failed |
| 2 | usage error: unknown tool, flag or option value |
| 3 | some inputs failed, the rest were written |
| 4 | a dependency is missing (ffmpeg, @napi-rs/canvas) |
| 5 | a size target was missed, with `--strict` |
| 6 | a password is needed or wrong |
| 130 | interrupted (Ctrl+C); nothing half-written is left |

## MCP

`roundertools mcp` starts [@roundertools/mcp](https://www.npmjs.com/package/@roundertools/mcp) when it's installed, and
otherwise prints the `npx` line for it.

## License

MIT. Docs: [roundertools.com/developers/cli](https://roundertools.com/developers/cli). Source:
[github.com/adam-sari/rounder](https://github.com/adam-sari/rounder) in `packages/cli`.
