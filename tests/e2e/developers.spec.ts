// The developer installer: each app gets its own install, the options change the command live, the copy buttons copy
// it, and the choices travel in the URL hash so a configured install can be shared.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { trackErrors, waitForTool } from './helpers';

const installer = (page: Page) => page.locator('section.installer');
const envButton = (page: Page, name: string) => installer(page).getByRole('group', { name: 'Where you use AI' }).getByRole('button', { name, exact: true });
const code = (page: Page) => installer(page).locator('.output');

/** the server arguments inside Cursor's one-click link */
async function cursorArgs(link: Locator): Promise<string[]> {
  const href = (await link.getAttribute('href'))!;
  const config = new URL(href).searchParams.get('config')!;
  const json = new TextDecoder().decode(Uint8Array.from(atob(config), (c) => c.charCodeAt(0)));
  return JSON.parse(json).args;
}

async function open(page: Page, url: string) {
  const errors = trackErrors(page);
  await page.goto(url);
  await waitForTool(page);
  return errors;
}

test.describe('developer installer', () => {
  test('gives each app its own install', async ({ page }) => {
    const errors = await open(page, '/developers');
    // the server already rendered the default: Claude Code's plugin
    await expect(envButton(page, 'Claude Code')).toHaveAttribute('aria-pressed', 'true');
    await expect(code(page)).toContainText('/plugin marketplace add adam-sari/rounder');

    const cases: [string, string | RegExp][] = [
      ['Codex CLI', 'codex mcp add roundertools -- npx -y @roundertools/mcp'],
      ['Gemini CLI', '~/.gemini/settings.json'],
      ['Claude Desktop', 'claude_desktop_config.json'],
      ['Cursor', '~/.cursor/mcp.json'],
      ['VS Code', '.vscode/mcp.json'],
      ['Windsurf', 'mcp_config.json'],
      ['Other MCP app', '"command": "npx"'],
      ['My own code', 'npm install @roundertools/sdk'],
      ['Claude Code', '/plugin install roundertools@roundertools'],
    ];
    for (const [name, text] of cases) {
      await envButton(page, name).click();
      await expect(envButton(page, name)).toHaveAttribute('aria-pressed', 'true');
      await expect(code(page)).toContainText(text);
    }
    await envButton(page, 'Cursor').click();
    await expect(installer(page).getByRole('link', { name: 'Add to Cursor' })).toHaveAttribute('href', /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=roundertools&config=/);
    await envButton(page, 'VS Code').click();
    await expect(installer(page).getByRole('link', { name: 'Add to VS Code' })).toHaveAttribute('href', /^vscode:mcp\/install\?/);
    await expect(page).toHaveURL(/#env=vscode$/);
    // the SDK has nothing to customise
    await envButton(page, 'My own code').click();
    await expect(installer(page).getByRole('button', { name: 'Customise' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('options change the command as you pick them', async ({ page }) => {
    const errors = await open(page, '/developers');
    await envButton(page, 'Cursor').click();
    const link = installer(page).getByRole('link', { name: 'Add to Cursor' });
    expect(await cursorArgs(link)).toEqual(['-y', '@roundertools/mcp']);

    const toggle = installer(page).getByRole('button', { name: 'Customise' });
    await toggle.click();
    await expect(installer(page).getByRole('button', { name: 'Hide options' })).toHaveAttribute('aria-expanded', 'true');
    const cost = installer(page).locator('.cost');
    const lean = await cost.textContent();
    expect(lean).toMatch(/About [\d,]+ tokens per conversation/);

    await installer(page).getByRole('group', { name: "what's listed up front" }).getByRole('button', { name: 'PDF' }).click();
    await expect(code(page)).toContainText('"pdf"');
    await expect.poll(() => cursorArgs(link)).toEqual(['-y', '@roundertools/mcp', '--tools', 'pdf']);
    await expect(cost).not.toHaveText(lean!);

    await installer(page).getByRole('button', { name: 'Documents' }).click();
    await installer(page).getByRole('group', { name: 'remember my tools' }).getByRole('button', { name: 'Off' }).click();
    await expect.poll(() => cursorArgs(link)).toEqual(['-y', '@roundertools/mcp', '--allow', '~/Documents', '--tools', 'pdf', '--no-memory']);
    await expect(page).toHaveURL(/#env=cursor&tools=pdf&allow=~\/Documents&memory=off$/);

    // a hand-picked list
    await installer(page).getByRole('group', { name: "what's listed up front" }).getByRole('button', { name: 'Choose tools' }).click();
    await installer(page).getByRole('checkbox', { name: 'Zip files', exact: true }).check();
    await expect.poll(() => cursorArgs(link)).toContain('pdf,zip-files');

    // Claude Code shows the same options in its MCP command
    await envButton(page, 'Claude Code').click();
    await expect(code(page)).toContainText('claude mcp add --scope user roundertools -- npx -y @roundertools/mcp --allow ~/Documents --tools pdf,zip-files --no-memory');
    expect(errors).toEqual([]);
  });

  test('copy buttons copy the current command', async ({ page, context, browserName }) => {
    const errors = await open(page, '/developers');
    await envButton(page, 'Codex CLI').click();
    const block = code(page).locator('figure').first();
    const button = block.getByRole('button');
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await button.click();
    // only Chromium lets a test read the clipboard; the others must at least say what happened
    await expect(button).toHaveText(/Copied ✓|Copy blocked/);
    if (browserName === 'chromium') {
      await expect(button).toHaveText('Copied ✓');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await block.locator('code').textContent());
    }
    await expect(button).toHaveText(/^Copy(?!ied)/, { timeout: 5_000 });
    // each copy button says what it copies
    await expect(button).toHaveAccessibleName('Copy the MCP server command');
    expect(errors).toEqual([]);
  });

  test('a shared link opens with its choices', async ({ page }) => {
    const errors = await open(page, '/developers#env=cursor&tools=pdf,image&memory=off');
    await expect(envButton(page, 'Cursor')).toHaveAttribute('aria-pressed', 'true');
    const link = installer(page).getByRole('link', { name: 'Add to Cursor' });
    await expect.poll(() => cursorArgs(link)).toEqual(['-y', '@roundertools/mcp', '--tools', 'pdf,image', '--no-memory']);
    await expect(installer(page).getByRole('button', { name: 'Hide options' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a crafted link cannot put a command into the copy-paste commands', async ({ page }) => {
    const errors = await open(page, '/developers#env=codex&allow=' + encodeURIComponent('$(calc)') + '&allow=' + encodeURIComponent('x";calc;"') + '&allow=~/Documents');
    await expect(envButton(page, 'Codex CLI')).toHaveAttribute('aria-pressed', 'true');
    const first = code(page).locator('figure').first().locator('code');
    await expect(first).toHaveText('codex mcp add roundertools -- npx -y @roundertools/mcp --allow ~/Documents');
    expect(errors).toEqual([]);
  });

  test('a folder a shell would read is refused, and the panel repeats the result', async ({ page }) => {
    const errors = await open(page, '/developers');
    await envButton(page, 'Codex CLI').click();
    await installer(page).getByRole('button', { name: 'Customise' }).click();
    const box = installer(page).getByRole('textbox', { name: 'Another folder' });
    const add = installer(page).getByRole('button', { name: 'Add', exact: true });
    await box.fill('~/$(calc)');
    await expect(add).toBeDisabled();
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(installer(page).locator('.panel')).toContainText('a shell would read them');
    await box.fill("~/Adam's files/");
    await add.click();
    const expected = `codex mcp add roundertools -- npx -y @roundertools/mcp --allow "~/Adam's files"`;
    await expect(code(page).locator('figure').first().locator('code')).toHaveText(expected);
    // the same command at the foot of the panel, next to the options that changed it
    await expect(installer(page).locator('.panel figure code')).toHaveText(expected);
    expect(errors).toEqual([]);
  });

  test('the MCP page has it too, and keeps its section links', async ({ page }) => {
    const errors = await open(page, '/developers/mcp#memory');
    await expect(installer(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).hash).toBe('#memory');
    await envButton(page, 'Claude Desktop').click();
    await expect(code(page)).toContainText('"mcpServers"');
    expect(errors).toEqual([]);
  });
});
