# roundertools for Claude Code

Adds the [Rounder MCP server](https://roundertools.com/developers/mcp) to Claude Code: 30 file tools for PDFs, images,
archives and video that run on your own computer. Files never leave the machine and the server makes no network requests.

```
/plugin marketplace add adam-sari/rounder
/plugin install roundertools@roundertools
```

Then ask for what you want done, like "compress report.pdf to under 1 MB". Without `--allow`, the server reads your home
folder and the project you start it in, never hidden folders or key files, and writes next to the input without
overwriting anything. Video and audio tools need ffmpeg installed. Details and options:
[packages/mcp](../../packages/mcp/README.md).
