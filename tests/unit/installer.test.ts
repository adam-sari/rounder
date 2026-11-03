import { describe, expect, it } from 'vitest';
import { MCP_INSTALL, MCP_INSTALL_LINKS, MCP_TOKENS, installerCatalog as catalog, ops } from '@/developers';
import { chooseTools } from '../../packages/mcp/src/server';
import {
  DEFAULT_OPTIONS,
  DEFAULT_STATE,
  ENVS,
  FAMILIES,
  PRESETS,
  claudeCodeCommand,
  cleanFolders,
  codexCommand,
  folderProblem,
  friendlyTokens,
  fromHash,
  install,
  mainSnippet,
  needsFfmpeg,
  parseTools,
  serverArgs,
  shellWord,
  toHash,
  toolsValue,
  upFrontTokens,
  type InstallOptions,
  type InstallerState,
  type Os,
} from '@/developers/installer';

/** a word splitter for what shellWord writes: bare words and double-quoted ones, nothing escaped */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m; (m = re.exec(line)); ) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

const decodeBase64 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

/** what the flags should be, written out independently of the module */
function expectedArgs(o: InstallOptions, tools: string | undefined) {
  const folders = [...new Set(o.allow.map((f) => f.trim()).filter(Boolean))];
  return [
    '-y',
    '@roundertools/mcp',
    ...folders.flatMap((f) => ['--allow', f]),
    ...(tools ? ['--tools', tools] : []),
    ...(o.memory ? [] : ['--no-memory']),
    ...(o.experimental ? ['--experimental'] : []),
  ];
}

const pdfSlugs = catalog.filter((t) => t.family === 'pdf').map((t) => t.slug);
const optionSets: InstallOptions[] = [];
const toolChoices: Pick<InstallOptions, 'preset' | 'picked'>[] = [
  ...PRESETS.filter((p) => p.id !== 'custom').map((p) => ({ preset: p.id, picked: [] })),
  { preset: 'custom', picked: [] },
  { preset: 'custom', picked: ['compress-pdf', 'image-resizer'] },
  { preset: 'custom', picked: [...pdfSlugs, 'zip-files'] },
];
for (const tools of toolChoices)
  for (const allow of [[], ['~/Documents'], ['~/Documents', '~/My Files', ' ~/Documents '], ['/srv/scans', 'D:\\Ünïcode files', "~/Adam's (old) files"]])
    for (const memory of [true, false]) for (const experimental of [false, true]) optionSets.push({ ...tools, allow, memory, experimental });

describe('installer: every app and option', () => {
  it('has outputs for every environment', () => {
    expect(ENVS.map((e) => e.id)).toEqual(['claude-code', 'codex', 'gemini', 'claude-desktop', 'cursor', 'vscode', 'windsurf', 'other', 'code']);
  });

  for (const env of ENVS) {
    it(`${env.id}: valid JSON, commands and links for every combination`, () => {
      for (const o of optionSets) {
        for (const os of ['mac', 'windows', 'linux'] as Os[]) {
          const tools = toolsValue(o, catalog);
          const args = expectedArgs(o, tools);
          const out = install(env.id, o, catalog, os);
          const ctx = `${env.id} ${os} ${JSON.stringify(o)}`;
          expect(Object.keys(out.snippets).length, ctx).toBeGreaterThan(0);
          for (const [key, s] of Object.entries(out.snippets)) {
            expect(s.code.trim(), `${ctx} ${key}`).not.toBe('');
            expect(s.label, `${ctx} ${key}`).not.toBe('');
            if (s.kind === 'json') {
              const parsed = JSON.parse(s.code);
              const entry = (parsed.mcpServers ?? parsed.servers).roundertools;
              expect(entry.command, ctx).toBe('npx');
              expect(entry.args, ctx).toEqual(args);
            }
            if (s.kind === 'toml') {
              expect(s.code, ctx).toMatch(/^\[mcp_servers\.roundertools\]\ncommand = "npx"\nargs = \[.*\]$/);
              expect(JSON.parse(s.code.match(/args = (\[.*\])/)![1]), ctx).toEqual(args);
            }
            if (s.kind === 'shell' && /^(claude|codex) mcp add /.test(s.code)) {
              const w = words(s.code);
              expect(w.slice(w.indexOf('--') + 1), ctx).toEqual(['npx', ...args]);
            }
          }
          if (out.links.cursor) {
            const url = new URL(out.links.cursor);
            expect(url.protocol, ctx).toBe('cursor:');
            expect(url.searchParams.get('name')).toBe('roundertools');
            expect(JSON.parse(decodeBase64(url.searchParams.get('config')!)), ctx).toEqual({ command: 'npx', args });
          }
          if (out.links.vscode) {
            expect(out.links.vscode.startsWith('vscode:mcp/install?'), ctx).toBe(true);
            const config = JSON.parse(decodeURIComponent(out.links.vscode.slice('vscode:mcp/install?'.length)));
            expect(config, ctx).toEqual({ name: 'roundertools', type: 'stdio', command: 'npx', args });
          }
          // the MCP outputs pass --tools only when something other than lean is chosen
          if (env.mcp && !tools) for (const s of Object.values(out.snippets)) expect(s.code, ctx).not.toContain('--tools');
        }
      }
    });
  }

  it('Claude Code: the plugin first, then the MCP command with user scope', () => {
    const out = install('claude-code', DEFAULT_OPTIONS, catalog);
    expect(out.snippets.market.code).toBe('/plugin marketplace add adam-sari/rounder');
    expect(out.snippets.plugin.code).toBe('/plugin install roundertools@roundertools');
    expect(out.snippets.mcp.code).toBe('claude mcp add --scope user roundertools -- npx -y @roundertools/mcp');
  });

  it('writes flags in one order', () => {
    const o: InstallOptions = { preset: 'pdf', picked: [], allow: ['~/Documents', '~/Downloads'], memory: false, experimental: true };
    expect(claudeCodeCommand(o, catalog)).toBe(
      'claude mcp add --scope user roundertools -- npx -y @roundertools/mcp --allow ~/Documents --allow ~/Downloads --tools pdf --no-memory --experimental',
    );
    expect(install('codex', o, catalog).snippets.mcp.code).toBe(
      'codex mcp add roundertools -- npx -y @roundertools/mcp --allow ~/Documents --allow ~/Downloads --tools pdf --no-memory --experimental',
    );
  });

  it('Claude Desktop: the same config on every system, ~ included (the server expands it on Windows too)', () => {
    const o = { ...DEFAULT_OPTIONS, allow: ['~/Documents', '~', 'D:\\Scans'] };
    const win = JSON.parse(install('claude-desktop', o, catalog, 'windows').snippets.json.code).mcpServers.roundertools;
    expect(win.command).toBe('npx');
    expect(win.args).toEqual(['-y', '@roundertools/mcp', '--allow', '~/Documents', '--allow', '~', '--allow', 'D:\\Scans']);
    const json = (os: Os) => install('claude-desktop', o, catalog, os).snippets.json.code;
    expect(json('mac')).toBe(json('windows'));
    expect(json('linux')).toBe(json('windows'));
  });

  it('Cursor and VS Code configs carry type stdio; the others leave it out', () => {
    expect(JSON.parse(install('cursor', DEFAULT_OPTIONS, catalog).snippets.json.code).mcpServers.roundertools.type).toBe('stdio');
    expect(JSON.parse(install('vscode', DEFAULT_OPTIONS, catalog).snippets.json.code).servers.roundertools.type).toBe('stdio');
    for (const env of ['gemini', 'windsurf', 'other', 'claude-desktop'] as const) {
      expect(JSON.parse(install(env, DEFAULT_OPTIONS, catalog).snippets.json.code).mcpServers.roundertools).not.toHaveProperty('type');
    }
  });

  it('quotes folders only when a shell needs it, in plain double quotes', () => {
    expect(shellWord('~/Documents')).toBe('~/Documents');
    expect(shellWord('~/My Files')).toBe('"~/My Files"');
    expect(shellWord("~/Adam's files")).toBe('"~/Adam' + "'" + 's files"');
    expect(shellWord('D:\\Scans')).toBe('"D:\\Scans"');
    // a word no quoting is safe for in every shell is never written
    for (const w of ['a"b', '$(calc)', '`calc`', '%PATH%', 'a;b', 'a&b']) expect(() => shellWord(w), w).toThrow();
  });

  it('every snippet names what its copy button copies, and the panel repeats the one the options change', () => {
    for (const env of ENVS) {
      const out = install(env.id, DEFAULT_OPTIONS, catalog);
      for (const s of Object.values(out.snippets)) expect(s.name, env.id).toMatch(/\w/);
      const main = mainSnippet(env.id, out);
      if (env.mcp) expect(main?.code, env.id).toMatch(/@roundertools\/mcp/);
      else expect(main).toBeNull();
    }
  });
});

describe('installer: --tools', () => {
  it('leaves the flag out for lean', () => {
    expect(toolsValue(DEFAULT_OPTIONS, catalog)).toBeUndefined();
    expect(toolsValue({ ...DEFAULT_OPTIONS, preset: 'custom', picked: [] }, catalog)).toBeUndefined();
  });

  it('names presets as the server reads them', () => {
    for (const f of FAMILIES) expect(toolsValue({ ...DEFAULT_OPTIONS, preset: f }, catalog)).toBe(f);
    expect(toolsValue({ ...DEFAULT_OPTIONS, preset: 'all' }, catalog)).toBe('all');
  });

  it('writes a hand-picked list short, in catalog order', () => {
    const pick = (picked: string[]) => toolsValue({ ...DEFAULT_OPTIONS, preset: 'custom', picked }, catalog);
    expect(pick(['image-resizer', 'compress-pdf'])).toBe('compress-pdf,image-resizer');
    expect(pick([...pdfSlugs, 'zip-files'])).toBe('pdf,zip-files');
    expect(pick(catalog.map((t) => t.slug))).toBe('all');
    expect(pick(['nope', 'compress-pdf'])).toBe('compress-pdf');
  });

  it('reads a value back', () => {
    expect(parseTools('', catalog)).toEqual({ preset: 'lean', picked: [] });
    expect(parseTools('pdf', catalog)).toEqual({ preset: 'pdf', picked: [] });
    expect(parseTools('lean,all', catalog)).toEqual({ preset: 'all', picked: [] });
    expect(parseTools('compress-pdf,bogus', catalog)).toEqual({ preset: 'custom', picked: ['compress-pdf'] });
    expect(parseTools('bogus', catalog)).toEqual({ preset: 'lean', picked: [] });
    expect(parseTools('pdf,image', catalog).picked.length).toBe(catalog.filter((t) => t.family === 'pdf' || t.family === 'image').length);
  });
});

describe('installer: the URL hash', () => {
  it('is empty at the defaults', () => {
    expect(toHash(DEFAULT_STATE, catalog)).toBe('');
  });

  it('reads back what it writes', () => {
    const states: InstallerState[] = [
      { ...DEFAULT_STATE, env: 'cursor', preset: 'custom', picked: [...catalog.filter((t) => t.family === 'pdf' || t.family === 'image').map((t) => t.slug)], memory: false },
      { ...DEFAULT_STATE, env: 'claude-desktop', preset: 'media', allow: ['~/Documents', "~/My Files, 2026 (Adam's)"], experimental: true },
      { ...DEFAULT_STATE, env: 'code' },
      { ...DEFAULT_STATE, preset: 'custom', picked: ['compress-pdf', 'trim-video'] },
    ];
    for (const s of states) {
      const back = fromHash(`#${toHash(s, catalog)}`, catalog)!;
      expect(back.env).toBe(s.env);
      expect(toolsValue(back, catalog)).toBe(toolsValue(s, catalog));
      expect(back.allow).toEqual(s.allow);
      expect(back.memory).toBe(s.memory);
      expect(back.experimental).toBe(s.experimental);
    }
  });

  it('writes a readable hash', () => {
    const s: InstallerState = { ...DEFAULT_STATE, env: 'cursor', preset: 'custom', picked: [...catalog.filter((t) => t.family === 'pdf' || t.family === 'image').map((t) => t.slug)], memory: false };
    expect(toHash(s, catalog)).toBe('env=cursor&tools=pdf,image&memory=off');
  });

  it('drops folders from a link that a shell would run or misread', () => {
    const evil = ['$(calc)', 'x";calc;"', '~/a\"; Write-Output INJECTED; \"b', '`calc`', '%COMSPEC%', '!x', 'a|b', 'a&calc', 'a>b', 'a\nb', '-x', '--tools=all'];
    for (const value of evil) {
      const s = fromHash('#' + new URLSearchParams({ allow: value, env: 'codex' }).toString(), catalog)!;
      expect(s.allow, value).toEqual([]);
      for (const env of ['claude-code', 'codex'] as const) {
        const cmd = install(env, s, catalog).snippets.mcp.code;
        expect(cmd, value).not.toMatch(/[$`%!;&|<>"\\]/);
        expect(cmd, value).not.toContain('--allow');
      }
    }
    // the others in the same link still come through
    expect(fromHash('#allow=$(calc)&allow=~/Documents', catalog)!.allow).toEqual(['~/Documents']);
  });

  it('ignores plain anchors and unknown apps', () => {
    expect(fromHash('#memory', catalog)).toBeNull();
    expect(fromHash('', catalog)).toBeNull();
    expect(fromHash('#foo=bar', catalog)).toBeNull();
    expect(fromHash('#env=emacs', catalog)!.env).toBe('claude-code');
  });
});

describe('installer: folders', () => {
  it('says why a folder cannot be added', () => {
    expect(folderProblem('')).toBeNull();
    expect(folderProblem('~/Projects')).toBeNull();
    expect(folderProblem("D:\\Adam's (old) files")).toBeNull();
    expect(folderProblem('~/$HOME')).toMatch(/shell/);
    expect(folderProblem('-x')).toMatch(/dash/);
  });

  it('tidies trailing slashes, so a trailing \\ never escapes a closing quote', () => {
    expect(cleanFolders(['~/Projects/', 'D:\\My Scans\\', 'C:\\', '/', '~/'])).toEqual(['~/Projects', 'D:\\My Scans', 'C:/', '/', '~']);
    expect(codexCommand({ ...DEFAULT_OPTIONS, allow: ['D:\\My Scans\\'] }, catalog)).toBe('codex mcp add roundertools -- npx -y @roundertools/mcp --allow "D:\\My Scans"');
  });
});

describe('installer: the catalog', () => {
  it('leaves out what an npx install never lists: pdf-to-jpg and redact-pdf need the optional @napi-rs/canvas', () => {
    expect(catalog.map((t) => t.slug)).not.toContain('pdf-to-jpg');
    expect(catalog.map((t) => t.slug)).not.toContain('redact-pdf');
    expect(catalog.length).toBe(ops.length - 2);
  });

  it('reads "default" as the server does', () => {
    const available = new Set(chooseTools('all').map((o) => o.slug));
    const ours = parseTools('default', catalog).picked.filter((s) => available.has(s));
    const server = chooseTools('default').map((o) => o.slug).filter((s) => catalog.some((t) => t.slug === s));
    expect(ours).toEqual(server);
  });

  it('knows which picks need ffmpeg', () => {
    expect(needsFfmpeg(DEFAULT_OPTIONS, catalog)).toBe(false);
    expect(needsFfmpeg({ ...DEFAULT_OPTIONS, preset: 'pdf' }, catalog)).toBe(false);
    expect(needsFfmpeg({ ...DEFAULT_OPTIONS, preset: 'all' }, catalog)).toBe(true);
    expect(needsFfmpeg({ ...DEFAULT_OPTIONS, preset: 'custom', picked: ['compress-pdf', 'trim-video'] }, catalog)).toBe(true);
  });
});

describe('installer: cost', () => {
  it('rounds to friendly numbers', () => {
    expect(friendlyTokens(3348)).toBe(850);
    expect(friendlyTokens(59552)).toBe(14900);
    expect(friendlyTokens(10)).toBe(50);
  });

  it('grows with what is listed', () => {
    const lean = upFrontTokens(DEFAULT_OPTIONS, catalog);
    const pdf = upFrontTokens({ ...DEFAULT_OPTIONS, preset: 'pdf' }, catalog);
    const all = upFrontTokens({ ...DEFAULT_OPTIONS, preset: 'all' }, catalog);
    expect(lean).toBeGreaterThanOrEqual(600);
    expect(lean).toBeLessThan(1200);
    expect(pdf).toBeGreaterThan(lean);
    expect(all).toBeGreaterThan(pdf);
    expect(all).toBeGreaterThan(12_000);
  });
});

describe('installer: the docs use the same strings', () => {
  it('builds the static examples from the installer', () => {
    expect(MCP_INSTALL.claudeCode).toBe('claude mcp add --scope user roundertools -- npx -y @roundertools/mcp --allow ~/Documents');
    expect(MCP_INSTALL.claudeCodeAllow).toBe(MCP_INSTALL.claudeCode + ' --allow ~/Downloads');
    const o = { ...DEFAULT_OPTIONS, allow: ['~/Documents'] };
    expect(MCP_INSTALL_LINKS.cursor).toBe(install('cursor', o, catalog).links.cursor);
    expect(MCP_INSTALL_LINKS.vscode).toBe(install('vscode', o, catalog).links.vscode);
    expect(JSON.parse(MCP_INSTALL.claudeDesktop).mcpServers.roundertools).toEqual({ command: 'npx', args: serverArgs(o, catalog) });
    expect(MCP_TOKENS.lean).toBe(upFrontTokens(DEFAULT_OPTIONS, catalog));
    // what a real npx install lists (38 with the helpers; no pdf-to-jpg or redact-pdf), from the measured sizes
    expect(MCP_TOKENS.all).toBe(18000);
  });
});
