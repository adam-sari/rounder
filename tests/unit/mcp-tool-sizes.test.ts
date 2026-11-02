import { describe, expect, it } from 'vitest';
import { ops } from '@/developers';
import sizes from '@/developers/mcp-tool-sizes.json';
import { version } from '../../packages/mcp/package.json';

// the installer's token estimates come from these; re-run scripts/measure-mcp-tools.mjs when a tool changes
describe('measured MCP tool sizes', () => {
  it('has a size for every op, and nothing else', () => {
    const tools = sizes.tools as Record<string, number>;
    for (const op of ops) expect(tools[op.slug], op.slug).toBeGreaterThan(200);
    expect(Object.keys(tools).sort()).toEqual(ops.map((o) => o.slug).sort());
  });

  it('has the three helpers and the instructions', () => {
    expect(Object.keys(sizes.helpers).sort()).toEqual(['describe-tool', 'find-tool', 'run-tool']);
    for (const n of Object.values(sizes.instructions)) expect(n).toBeGreaterThan(100);
  });

  it('was measured on the current server version', () => {
    expect(sizes.version).toBe(version);
  });
});
