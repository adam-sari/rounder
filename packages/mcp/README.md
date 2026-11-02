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

In Claude Code you may not need a server at all. The `roundertools` plugin (`/plugin marketplace add adam-sari/rounder`,
then `/plugin install roundertools@roundertools`) is a skill that teaches Claude to run the
[CLI](https://www.npmjs.com/package/roundertools), about 100 tokens until it's used.

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
  as browser profiles, even inside an allowed folder. Paths must be absolute; symlinks are resolved before checking. The
  one exception is the server's own [settings folder](#settings), which it reads at startup; no tool call can.
- **Writes** only next to an input, or into the folder given with `--out DIR`. It never replaces an existing file and
  never writes over an input. The one other place it writes is its own [settings folder](#settings).
- **Network:** none. The server loads a guard first that blocks fetch, http, https, net, tls, dgram and DNS lookups in its
  process and its worker threads. On Node 26 and newer it also re-runs itself under Node's permission model, without
  network access. On Node 22 and 24 that guard isn't a sandbox; the promise rests on the packages having no network code.
  ffmpeg runs as a separate program with its inputs limited to local files (`-protocol_whitelist file,pipe`).
- **Checked before touching the disk:** a path outside the allowed folders is refused before anything looks it up, so a
  tool call can't probe which files exist, or (on Windows) make the computer connect to a `\\server\share`.

Text and details read out of files (pdf-to-text, a PDF's title, EXIF fields) come back framed as the file's content, not
instructions, between tags with a random name the file can't guess.

## What gets loaded

A client sends every tool a server lists to the model at the start of every conversation, used or not. Listing every
tool up front (32 with ffmpeg) costs about 14,800 tokens. So by default the server lists three helpers, about 700 tokens,
plus a short paragraph of instructions (about 150):

- `find-tool`: searches every tool on the site by what you want done
- `describe-tool`: any tool's options as JSON Schema
- `run-tool`: runs any tool that works outside a browser, with the same checks

Behind them are `merge-pdf`, `split-pdf`, `compress-pdf`, `protect-pdf`, `unlock-pdf`, `organize-pdf`,
`add-page-numbers-to-pdf`, `watermark-pdf`, `jpg-to-pdf`, `pdf-to-text`, `pdf-to-jpg` (with @napi-rs/canvas),
`extract-images-from-pdf`, `image-converter`, `image-compressor`, `image-resizer`, `crop-image`, `rotate-image`,
`exif-remover`, `zip-files`, `unzip-files`, `file-info`, and with ffmpeg `video-compressor`, `video-converter`,
`trim-video`, `mute-video`, `video-to-gif`, `video-to-mp3`, `audio-converter`, plus the site's other tools that run
outside a browser.

The list grows with use:

- **Per tool.** When the assistant describes a tool with `describe-tool`, or runs one successfully with `run-tool`, the
  server lists that tool directly and tells the client (`notifications/tools/list_changed`), so next time it can call it
  by name. `find-tool` only searches, and a failed run adds nothing. A client that ignores list changes still reaches
  every tool through `run-tool`, which is what `find-tool` and the prompts name for any tool not listed from the start.
  Each change to the list can make a client re-read it (and lose a cached prompt), so it happens once per tool.
- **Favourites.** Tools you've used at least twice in the last 90 days (up to five) are listed from the start, when they
  work on this computer. See [Memory](#memory).

`--tools all` lists every tool up front, if you'd rather pay the tokens once than have the assistant search.
`--tools default` lists the set 0.1 listed by default (everything but `checksum-calculator`). Families
(`--tools pdf,image`) and tool names (`--tools compress-pdf,merge-pdf`) list just those. They all combine:
`--tools lean,pdf` or `--tools default,checksum-calculator`. The helpers are always there. The flag wins over the
settings file, and the settings file wins over the lean default.

Each tool takes `inputs` (absolute paths), an optional `output` (a folder, or a new file for a single result) and its own
options. Results come back as a summary, `resource_link`s to the files, and `structuredContent` with each output's path,
size and type. Image tools take `preview: true` for a small PNG of the result.

In a terminal coding agent (Claude Code, Codex, Gemini CLI, opencode), the first `find-tool` result says once that
`npx -y roundertools <tool> …` does the same without MCP. Nothing else depends on which client is connected.

## Prompts

Prompts cost nothing until you pick one. Each tells the assistant which tool to call, with which arguments.

| Prompt | Arguments |
| --- | --- |
| `compress-pdf` | `file`, optional `size` (like `1mb`) |
| `merge-pdfs` | `files` |
| `convert-images` | `files`, `format` |
| `pdf-to-text` | `file` |
| `shrink-video` | `file`, optional `size` (only with ffmpeg) |

## Memory

Favourites come from a count of the tools you use. After a tool runs successfully, the server adds one to its count and
notes the date in `usage.json`:

```json
{ "version": 1, "tools": { "compress-pdf": { "count": 4, "last": "2026-11-02" } } }
```

That's all it stores: tool names, counts and dates. Never paths, file names, options or anything read from a file. It
stays on your computer like everything else.

Turn it off with `--no-memory`, `ROUNDERTOOLS_MEMORY=off`, or `npx roundertools config set memory off`. Forget it all
with `npx roundertools config reset`.

## Settings

`settings.json` and `usage.json` live in one folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\roundertools` |
| macOS | `~/Library/Application Support/roundertools` |
| Linux and others | `$XDG_CONFIG_HOME/roundertools`, or `~/.config/roundertools` |

`ROUNDERTOOLS_CONFIG_DIR` picks another folder. The [CLI](https://www.npmjs.com/package/roundertools) shows and changes
them:

```sh
npx roundertools config                  # the folder, the settings and your favourites
npx roundertools config set tools all    # lean, all, default, families or tool names
npx roundertools config set memory off   # on or off
npx roundertools config reset            # remove both files
```

A change applies the next time the server starts, and flags on its command line win. On Node 26 and newer the permission
model gives the server read and write access to this folder, so memory keeps working there too. With memory off it may
only read it.

## Options

| Option | |
| --- | --- |
| `--allow DIR` | a folder it may read (repeatable) |
| `--out DIR` | a folder it may write to, besides next to the inputs |
| `--tools LIST` | `lean` (the default), `all`, `default`, families (`pdf,image,files,media`) or tool names |
| `--no-memory` | don't count which tools you use |
| `--experimental` | turn on features that aren't finished (there are none yet) |
| `--max-input SIZE` | per-file limit (default 1gb, media 2gb) |
| `--timeout MIN` | minutes per call (default 5, media 30) |
| `--max-outputs N` | files one call may write (default 500) |

Built on the official MCP TypeScript SDK (`@modelcontextprotocol/server`), stdio only; it logs to stderr, runs one heavy
job at a time, sends progress notifications and stops when a call is cancelled.

## License

MIT. Docs: [roundertools.com/developers/mcp](https://roundertools.com/developers/mcp). Source:
[github.com/adam-sari/rounder](https://github.com/adam-sari/rounder) in `packages/mcp`.
