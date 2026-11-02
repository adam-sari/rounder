<script lang="ts">
  import { onMount } from 'svelte';
  import InstallCode from './InstallCode.svelte';
  import {
    DEFAULT_STATE,
    DESKTOP_CONFIG,
    ENVS,
    FAMILIES,
    FAMILY_NAMES,
    FAMILY_TOOLS,
    FAVOURITE_TOKENS,
    FOLDER_PICKS,
    OS_NAMES,
    PRESETS,
    SKILL_URL,
    cleanFolders,
    folderProblem,
    formatNumber,
    fromHash,
    install,
    mainSnippet,
    needsFfmpeg,
    selectedSlugs,
    toHash,
    upFrontTokens,
    type EnvId,
    type InstallerOp,
    type InstallerState,
    type Os,
    type Preset,
  } from '@/developers/installer';

  // "Where do you use AI?": picks an app and shows exactly what to paste. The server renders the default (Claude Code,
  // lean) in full, and nothing about the browser (the hash, the OS) is read until after hydration, so the first client
  // render matches the static HTML and the page doesn't move when it hydrates.
  let { catalog, id = 'install' }: { catalog: InstallerOp[]; id?: string } = $props();

  let env = $state<EnvId>(DEFAULT_STATE.env);
  let preset = $state<Preset>(DEFAULT_STATE.preset);
  let picked = $state<string[]>([]);
  let allow = $state<string[]>([]);
  let memory = $state(DEFAULT_STATE.memory);
  let experimental = $state(DEFAULT_STATE.experimental);
  let os = $state<Os>('mac');
  let customising = $state(false);
  let mcpOpen = $state(false);
  let folder = $state('');
  let hydrated = $state(false);

  const options = $derived({ preset, picked, allow, memory, experimental });
  const out = $derived(install(env, options, catalog, os));
  const snip = $derived(out.snippets);
  // what the options change, repeated at the foot of the panel: on a phone the original is a long scroll away
  const main = $derived(mainSnippet(env, out));
  const folderError = $derived(folderProblem(folder));
  const tokens = $derived(formatNumber(upFrontTokens(options, catalog)));
  const isMcp = $derived(ENVS.find((e) => e.id === env)?.mcp ?? true);
  const customFolders = $derived(allow.filter((f) => !FOLDER_PICKS.some((p) => p.path === f)));
  const grouped = $derived(FAMILIES.map((f) => ({ family: f, tools: catalog.filter((t) => t.family === f) })).filter((g) => g.tools.length));
  const presetHelp = $derived(
    preset === 'lean'
      ? 'Three helpers that find, describe and run any tool. Recommended.'
      : preset === 'all'
        ? 'Every tool, listed by name, plus the three helpers.'
        : preset === 'custom'
          ? 'The tools you tick, plus the three helpers.'
          : `The ${FAMILY_TOOLS[preset]}, plus the three helpers that reach the rest.`,
  );

  function apply(s: InstallerState) {
    env = s.env;
    preset = s.preset;
    picked = s.picked;
    allow = s.allow;
    memory = s.memory;
    experimental = s.experimental;
    // a shared link with options shows them
    if (s.preset !== 'lean' || s.allow.length || !s.memory || s.experimental) {
      customising = true;
      mcpOpen = true;
    }
  }

  function detectOs(): Os {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const p = `${nav.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`;
    if (/win/i.test(p)) return 'windows';
    if (/mac|iphone|ipad/i.test(p)) return 'mac';
    if (/linux/i.test(p) && !/android/i.test(p)) return 'linux';
    return 'mac';
  }

  onMount(() => {
    os = detectOs();
    const s = fromHash(location.hash, catalog);
    if (s) apply(s);
    hydrated = true;
    const onHash = () => {
      const next = fromHash(location.hash, catalog);
      if (next) apply(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  // keeps the choices in the URL so the link can be shared; replaceState, so it neither scrolls nor adds history
  $effect(() => {
    const hash = toHash({ env, ...options }, catalog);
    if (!hydrated) return;
    const current = location.hash.replace(/^#/, '');
    // a plain #section anchor stays put while everything is at its default
    if (!hash && !fromHash(current, catalog)) return;
    if (current === hash) return;
    history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
  });

  function pickPreset(p: Preset) {
    // ticking your own starts from what the current choice lists
    if (p === 'custom' && preset !== 'custom') picked = selectedSlugs(options, catalog);
    preset = p;
  }

  function toggleTool(slug: string, on: boolean) {
    picked = on ? [...picked, slug] : picked.filter((s) => s !== slug);
  }

  function toggleFolder(path: string) {
    allow = allow.includes(path) ? allow.filter((f) => f !== path) : [...allow, path];
  }

  function addFolder(e: SubmitEvent) {
    e.preventDefault();
    if (folderError) return;
    allow = cleanFolders([...allow, folder]);
    folder = '';
  }

  function toggleCustomise() {
    customising = !customising;
    // in Claude Code the options change the MCP command, which sits behind "Prefer the MCP server?"
    if (customising) mcpOpen = true;
  }
</script>

<section class="installer card" aria-labelledby="{id}-title" {id}>
  <h2 id="{id}-title">Where do you use <em>AI</em>?</h2>
  <p class="lede">Pick your app and you get exactly what to paste.</p>

  <div class="envs" role="group" aria-label="Where you use AI">
    {#each ENVS as e (e.id)}
      <button type="button" class="env" aria-pressed={env === e.id} onclick={() => (env = e.id)}>{e.label}</button>
    {/each}
  </div>

  <div class="output" data-env={env}>
    {#if env === 'claude-code'}
      <p>
        We recommend the <strong>roundertools plugin</strong>. It teaches Claude Code to run the
        <a href="/developers/cli">command-line tool</a>, so you approve each command, and costs about 100 tokens until it's
        used. Type these in Claude Code, one at a time:
      </p>
      <InstallCode {...snip.market} />
      <InstallCode {...snip.plugin} />
      <details class="more" bind:open={mcpOpen}>
        <summary>Prefer the MCP server?</summary>
        <p>Run this in a terminal. Claude then sees the tools directly, for about {tokens} tokens per conversation.</p>
        <InstallCode {...snip.mcp} />
      </details>
    {:else if env === 'codex'}
      <p>Run this in a terminal:</p>
      <InstallCode {...snip.mcp} />
      <p>Or add it to <code>~/.codex/config.toml</code> yourself:</p>
      <InstallCode {...snip.toml} />
      <details class="more">
        <summary>Or skip the server: use the skill</summary>
        <p>
          A skill teaches Codex to run the <a href="/developers/cli">command-line tool</a> instead, for about 100 tokens until
          it's used. This saves it where Codex looks for your skills:
        </p>
        <InstallCode {...snip.skill} />
        <p>On Windows, save <a href={SKILL_URL}>the same file</a> to <code>.agents\skills\roundertools\SKILL.md</code> in your user folder.</p>
      </details>
    {:else if env === 'gemini'}
      <p>
        Add this to <code>~/.gemini/settings.json</code> (every project) or <code>.gemini/settings.json</code> (one project).
        If the file already has <code>mcpServers</code>, put <code>roundertools</code> next to the others.
      </p>
      <InstallCode {...snip.json} />
      <details class="more">
        <summary>Or skip the server: use the skill</summary>
        <p>
          A skill teaches Gemini CLI to run the <a href="/developers/cli">command-line tool</a> instead, for about 100 tokens
          until it's used. This saves it where Gemini CLI (and Codex) look for your skills:
        </p>
        <InstallCode {...snip.skill} />
        <p>On Windows, save <a href={SKILL_URL}>the same file</a> to <code>.agents\skills\roundertools\SKILL.md</code> in your user folder.</p>
      </details>
    {:else if env === 'claude-desktop'}
      <div class="seg mb-3" role="group" aria-label="Your computer">
        {#each Object.entries(OS_NAMES) as [key, name] (key)}
          <button type="button" aria-pressed={os === key} onclick={() => (os = key as Os)}>{name}</button>
        {/each}
      </div>
      <p>
        In Claude Desktop, open Settings → Developer → Edit config. That opens <code>{DESKTOP_CONFIG[os]}</code>. Add this,
        save, then quit Claude fully and open it again.
      </p>
      <InstallCode {...snip.json} />
      {#if os === 'windows'}
        <p class="note">If it doesn't start, the logs are in <code>%APPDATA%\Claude\logs</code>.</p>
      {/if}
    {:else if env === 'cursor'}
      <div class="links"><a class="btn btn-primary cta" href={out.links.cursor}>Add to Cursor</a></div>
      <p>Or put it in <code>~/.cursor/mcp.json</code> (every project) or <code>.cursor/mcp.json</code> (one project):</p>
      <InstallCode {...snip.json} />
    {:else if env === 'vscode'}
      <div class="links"><a class="btn btn-primary cta" href={out.links.vscode}>Add to VS Code</a></div>
      <p>
        Or put it in <code>.vscode/mcp.json</code> in your project. For every project, run <strong>MCP: Open User
        Configuration</strong> from the Command Palette and add it there.
      </p>
      <InstallCode {...snip.json} />
    {:else if env === 'windsurf'}
      <p>
        Windsurf is now Devin Desktop. Open Cascade's MCP menu → Open MCP config file, or edit
        <code>~/.config/devin/mcp_config.json</code> (on Windows, <code>%APPDATA%\devin\mcp_config.json</code>). Older
        Windsurf versions use <code>~/.codeium/windsurf/mcp_config.json</code>.
      </p>
      <InstallCode {...snip.json} />
    {:else if env === 'other'}
      <p>
        Most MCP apps take this. Some call the list <code>servers</code>, or want just the part inside: a
        <code>command</code> and its <code>args</code>.
      </p>
      <InstallCode {...snip.json} />
    {:else}
      <p>Add the SDK to a project (Node 22.13 or newer):</p>
      <InstallCode {...snip.install} />
      <InstallCode {...snip.example} />
      <p>Or run any tool from a terminal, with nothing to install:</p>
      <InstallCode {...snip.cli} />
      <p class="note"><a href="/developers/sdk">SDK docs →</a> · <a href="/developers/cli">CLI docs →</a></p>
    {/if}
  </div>

  {#if isMcp}
    <div class="bar">
      <button type="button" class="btn toggle" aria-expanded={customising} aria-controls={customising ? `${id}-custom` : undefined} onclick={toggleCustomise}>
        {customising ? 'Hide options' : 'Customise'}
      </button>
      <span class="mono">
        {env === 'claude-code' ? 'changes the MCP command; the plugin has nothing to set' : `about ${tokens} tokens per conversation`}
      </span>
    </div>
  {:else}
    <p class="note bar">Nothing to customise here: the SDK and CLI take options with each call.</p>
  {/if}

  {#if isMcp && customising}
    <div class="panel" id="{id}-custom">
      <div class="group">
        <span class="label" id="{id}-tools">what's listed up front</span>
        <div class="seg" role="group" aria-labelledby="{id}-tools">
          {#each PRESETS as p (p.id)}
            <button type="button" aria-pressed={preset === p.id} onclick={() => pickPreset(p.id)}>{p.label}</button>
          {/each}
        </div>
        <p class="note">{presetHelp}</p>
        {#if preset === 'custom'}
          <div class="families">
            {#each grouped as g (g.family)}
              <fieldset>
                <legend class="mono">{FAMILY_NAMES[g.family]}</legend>
                {#each g.tools as t (t.slug)}
                  <label class="tick">
                    <input type="checkbox" checked={picked.includes(t.slug)} onchange={(e) => toggleTool(t.slug, e.currentTarget.checked)} />
                    <span>{t.title}</span>
                  </label>
                {/each}
              </fieldset>
            {/each}
          </div>
        {/if}
        <p class="cost" aria-live="polite">
          About <strong>{tokens} tokens</strong> per conversation{#if preset === 'lean' && memory}, plus about
            {formatNumber(FAVOURITE_TOKENS)} for each tool it remembers you use (up to five){/if}.
          {#if needsFfmpeg(options, catalog)}Video and audio tools are listed only when ffmpeg is installed.{/if}
        </p>
      </div>

      <div class="group">
        <span class="label" id="{id}-folders">folders it may read</span>
        <div class="chips" role="group" aria-labelledby="{id}-folders">
          {#each FOLDER_PICKS as f (f.path)}
            <button type="button" class="chip" aria-pressed={allow.includes(f.path)} onclick={() => toggleFolder(f.path)}>{f.label}</button>
          {/each}
          {#each customFolders as f (f)}
            <button type="button" class="chip on" aria-label="Remove {f}" onclick={() => toggleFolder(f)}>{f} ×</button>
          {/each}
        </div>
        <form class="add" onsubmit={addFolder}>
          <label class="grow">
            <span class="sr-only">Another folder</span>
            <input
              class="field"
              bind:value={folder}
              placeholder="another folder, like ~/Projects"
              autocomplete="off"
              spellcheck="false"
              aria-invalid={folderError ? 'true' : undefined}
              aria-describedby={folderError ? `${id}-folder-error` : undefined}
            />
          </label>
          <button type="submit" class="btn" disabled={!folder.trim() || !!folderError}>Add</button>
        </form>
        {#if folderError}<p class="note error" id="{id}-folder-error">{folderError}</p>{/if}
        <p class="note">
          {allow.length ? 'Only these.' : 'None picked: your home folder and the folder it starts in.'} Hidden folders and key
          files are never read.
        </p>
      </div>

      <div class="group">
        <span class="label" id="{id}-memory">remember my tools</span>
        <div class="seg" role="group" aria-labelledby="{id}-memory">
          <button type="button" aria-pressed={memory} onclick={() => (memory = true)}>On</button>
          <button type="button" aria-pressed={!memory} onclick={() => (memory = false)}>Off</button>
        </div>
        <p class="note">Lists the tools you use most from the start. It keeps tool names, counts and dates, nothing else.</p>
      </div>

      <div class="group">
        <span class="label" id="{id}-exp">experimental features</span>
        <div class="seg" role="group" aria-labelledby="{id}-exp">
          <button type="button" aria-pressed={!experimental} onclick={() => (experimental = false)}>Off</button>
          <button type="button" aria-pressed={experimental} onclick={() => (experimental = true)}>On</button>
        </div>
        <p class="note">None yet. With this on, new ones turn on here when they ship.</p>
      </div>

      {#if main}
        <div class="group">
          <span class="label">with these options</span>
          <p class="note">
            The {env === 'claude-code' ? 'MCP command' : env === 'codex' ? 'command' : 'config'} from above, as you've set it. Options
            left at their defaults follow your <code>npx roundertools config</code> settings, if you've changed any.
          </p>
          <InstallCode {...main} name="{main.name}, with these options" />
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .installer {
    margin: 32px 0 40px;
    padding: 20px 16px;
    background: var(--color-panel-2);
    min-width: 0;
  }
  @media (min-width: 640px) {
    .installer {
      padding: 26px 28px;
    }
  }
  .installer h2 {
    margin: 0 0 6px;
    font-size: 34px;
    line-height: 1.1;
  }
  .lede {
    margin: 0 0 16px;
  }
  .envs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
  }
  /* on a phone, a grid: the pills' width (and so how they wrap) no longer depends on the text, so nothing moves when
     the web font replaces the fallback */
  @media (max-width: 639px) {
    .envs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    }
    .env {
      text-align: center;
    }
  }
  .env {
    font: 400 14px/1 var(--font-sans);
    color: var(--color-soft);
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 99px;
    padding: 9px 14px;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s var(--ease-spring);
    &:hover {
      border-color: var(--color-sun);
    }
    &:active {
      transform: scale(0.97);
    }
    &[aria-pressed='true'] {
      background: var(--color-chalk);
      border-color: var(--color-chalk);
      color: var(--color-bg);
    }
  }
  .output {
    min-width: 0;
  }
  .output p,
  .panel p {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .output p.note,
  .panel p.note,
  p.note {
    font-size: 14px;
    color: var(--color-muted);
  }
  .links {
    margin: 4px 0 14px;
  }
  .links a.cta {
    color: var(--color-bg);
    text-decoration: none;
  }
  .more {
    margin: 4px 0 8px;
    border-top: 1px solid var(--color-line);
    padding-top: 10px;
  }
  .more summary {
    cursor: pointer;
    color: var(--color-chalk);
    font-size: 15px;
    padding: 4px 0 8px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-top: 8px;
  }
  .toggle {
    padding: 7px 14px;
    font-size: 14px;
  }
  .panel {
    display: grid;
    gap: 22px;
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--color-line);
    min-width: 0;
  }
  .group {
    min-width: 0;
  }
  .group .seg {
    margin-bottom: 8px;
  }
  .families {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
    margin: 6px 0 12px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    margin-bottom: 4px;
  }
  .tick {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 14px;
    color: var(--color-soft);
    cursor: pointer;
  }
  .tick input {
    accent-color: var(--color-sun);
  }
  .cost {
    color: var(--color-soft);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .chip {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 9px;
    padding: 6px 10px;
    cursor: pointer;
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: left;
    &:hover {
      border-color: var(--color-sun);
    }
    &[aria-pressed='true'],
    &.on {
      background: var(--color-chalk);
      border-color: var(--color-chalk);
      color: var(--color-bg);
    }
  }
  .add {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .add .btn {
    padding: 10px 16px;
  }
  .panel p.note.error {
    color: var(--color-bad);
  }
</style>
