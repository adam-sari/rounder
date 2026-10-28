# @roundertools/mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants the file tools from
[roundertools.com](https://roundertools.com): compress, merge, split and protect PDFs, convert and resize images, zip
files, and (with ffmpeg) shrink, convert and trim video. It runs on your computer over stdio. Files stay where they are,
and it makes no network requests.

## Install

Claude Code:

```sh
claude mcp add roundertools -- npx -y @roundertools/mcp
claude mcp add roundertools --scope user -- npx -y @roundertools/mcp --allow ~/Documents --allow ~/Downloads
```

Claude Desktop (`claude_desktop_config.json`, under Settings → Developer → Edit config):

```json
{ "mcpServers": { "roundertools": { "command": "npx", "args": ["-y", "@roundertools/mcp", "--allow", "/Users/you/Documents"] } } }
```

On Windows, if `npx` isn't found, use `"command": "cmd", "args": ["/c", "npx", "-y", "@roundertools/mcp", …]`.

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{ "mcpServers": { "roundertools": { "command": "npx", "args": ["-y", "@roundertools/mcp"] } } }
```

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "roundertools": { "type": "stdio", "command": "npx", "args": ["-y", "@roundertools/mcp"] } } }
```

Needs Node 22.13 or newer; video and audio tools appear when `ffmpeg` is on the PATH (or at `ROUNDERTOOLS_FFMPEG`).

## What it may touch

- **Reads** inside the folders given with `--allow DIR` (repeatable) or `ROUNDERTOOLS_ALLOW` (a path list). Without
  either: your home folder and the folder it starts in (when that's a project, not a system folder). A client's roots
  can narrow this, never widen it.
- **Never reads** hidden folders and files (`.ssh`, `.aws`, `.config`, `.env`…), key and password files, or app data such
  as browser profiles, even inside an allowed folder. Paths must be absolute; symlinks are resolved before checking.
- **Writes** only next to an input, or into the folder given with `--out DIR`. It never replaces an existing file and
  never writes over an input.
- **Network:** none. The server loads a guard first that blocks fetch, http, https, net, tls, dgram and DNS lookups in its
  process and its worker threads. On Node 26 and newer it also re-runs itself under Node's permission model, without
  network access. On Node 22 and 24 that guard isn't a sandbox; the promise rests on the packages having no network code.
  ffmpeg runs as a separate program with its inputs limited to local files (`-protocol_whitelist file,pipe`).
- **Checked before touching the disk:** a path outside the allowed folders is refused before anything looks it up, so a
  tool call can't probe which files exist, or (on Windows) make the computer connect to a `\\server\share`.

Text and details read out of files (pdf-to-text, a PDF's title, EXIF fields) come back framed as the file's content, not
instructions, between tags with a random name the file can't guess.

## Tools

By default: `merge-pdf`, `split-pdf`, `compress-pdf`, `protect-pdf`, `unlock-pdf`, `organize-pdf`,
`add-page-numbers-to-pdf`, `watermark-pdf`, `jpg-to-pdf`, `pdf-to-text`, `pdf-to-jpg` (with @napi-rs/canvas),
`extract-images-from-pdf`, `image-converter`, `image-compressor`, `image-resizer`, `crop-image`, `rotate-image`,
`exif-remover`, `zip-files`, `unzip-files`, `file-info`, and with ffmpeg `video-compressor`, `video-converter`,
`trim-video`, `mute-video`, `video-to-gif`, `video-to-mp3`, `audio-converter`. Plus:

- `find-tool`: searches every tool on the site by what you want done
- `describe-tool`: any tool's options as JSON Schema
- `run-tool`: runs any tool that works outside a browser, listed or not, with the same checks

Each tool takes `inputs` (absolute paths), an optional `output` (a folder, or a new file for a single result) and its own
options. Results come back as a summary, `resource_link`s to the files, and `structuredContent` with each output's path,
size and type. Image tools take `preview: true` for a small PNG of the result.

## Options

| Option | |
| --- | --- |
| `--allow DIR` | a folder it may read (repeatable) |
| `--out DIR` | a folder it may write to, besides next to the inputs |
| `--tools LIST` | `default`, `all`, families (`pdf,image,files,media`) or tool names |
| `--max-input SIZE` | per-file limit (default 1gb, media 2gb) |
| `--timeout MIN` | minutes per call (default 5, media 30) |
| `--max-outputs N` | files one call may write (default 500) |

Built on the official MCP TypeScript SDK (`@modelcontextprotocol/server`), stdio only; it logs to stderr, runs one heavy
job at a time, sends progress notifications and stops when a call is cancelled.

## License

MIT. Docs: [roundertools.com/developers/mcp](https://roundertools.com/developers/mcp). Source:
[github.com/adam-sari/rounder](https://github.com/adam-sari/rounder) in `packages/mcp`.
