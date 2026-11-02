# roundertools for Claude Code

Adds a skill that teaches Claude Code to use the [Rounder CLI](https://roundertools.com/developers/cli): 29 file tools
for PDFs, images, archives and video that run on your own computer. Files never leave the machine and the CLI makes no
network requests.

```
/plugin marketplace add adam-sari/rounder
/plugin install roundertools@roundertools
```

Then ask for what you want done, like "compress report.pdf to under 1 MB". Claude runs `npx -y roundertools <tool> …`
in its terminal, so you see and approve each command like any other. To stop the prompts, allow
`Bash(npx -y roundertools:*)` in your permissions.

There is no MCP server in the plugin. Until the skill is needed, Claude only sees its name and one-line description,
about 100 tokens. Results are written next to the input with a suffix (`report-compressed.pdf`) and never replace a file.
Video and audio tools need ffmpeg installed.

The skill is a copy of [packages/cli/skill/SKILL.md](../../packages/cli/skill/SKILL.md); a test keeps the two the same.
For other assistants, or if you'd rather have an MCP server, see [packages/mcp](../../packages/mcp/README.md).
