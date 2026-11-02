import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('Claude Code plugin', () => {
  it("ships the CLI package's skill unchanged", () => {
    // plugins/roundertools is a copy so the plugin installs on its own; edit packages/cli/skill/SKILL.md and copy it over
    expect(read('plugins/roundertools/skills/roundertools/SKILL.md')).toBe(read('packages/cli/skill/SKILL.md'));
  });

  it('is the skill and the CLI, with no MCP server', () => {
    expect(existsSync(new URL('plugins/roundertools/.mcp.json', root))).toBe(false);
    expect(JSON.parse(read('plugins/roundertools/.claude-plugin/plugin.json')).mcpServers).toBeUndefined();
  });

  it("has the CLI's version", () => {
    const plugin = JSON.parse(read('plugins/roundertools/.claude-plugin/plugin.json'));
    expect(plugin.version).toBe(JSON.parse(read('packages/cli/package.json')).version);
  });
});
