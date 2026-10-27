<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { closeMinifier, minifyCode } from '@/tools/lib/code-minifier/client';
  import { defaultOptions, describeNote, type Ecma, type Lang, type MinifyOptions, type Note } from '@/tools/lib/code-minifier/options';
  import { samples } from '@/tools/lib/code-minifier/samples';
  import type { MinifyResponse } from '@/tools/lib/code-minifier/worker';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';

  let { lang = 'css' }: { lang?: Lang } = $props();

  type Flag = { [K in keyof MinifyOptions]: MinifyOptions[K] extends boolean ? K : never }[keyof MinifyOptions];
  interface LangInfo {
    label: string;
    href: string;
    exts: string[];
    accept: string;
    mime: string;
    base: string;
    flags: [Flag, string][];
  }

  const LANGS = {
    css: {
      label: 'CSS', href: '/css-minifier', exts: ['css'], accept: '.css,text/css', mime: 'text/css', base: 'styles',
      flags: [['restructure', 'Merge & restructure rules'], ['keepLicense', 'Keep /*! comments']],
    },
    js: {
      label: 'JavaScript', href: '/js-minifier', exts: ['js', 'mjs', 'cjs'], accept: '.js,.mjs,.cjs,text/javascript', mime: 'text/javascript', base: 'script',
      flags: [['compress', 'Compress'], ['mangle', 'Shorten names'], ['keepLicense', 'Keep /*! comments'], ['module', 'ES module']],
    },
    html: {
      label: 'HTML', href: '/html-minifier', exts: ['html', 'htm'], accept: '.html,.htm,text/html', mime: 'text/html', base: 'index',
      flags: [['removeComments', 'Remove comments'], ['collapseWhitespace', 'Collapse whitespace'], ['minifyCss', 'Minify inline CSS'], ['minifyJs', 'Minify inline JS']],
    },
  } satisfies Record<Lang, LangInfo>;
  const ECMAS: [Ecma, string][] = [[5, 'ES5'], [2015, 'ES2015'], [2020, 'ES2020']];

  // bigger inputs skip the editor (typing in a multi-megabyte textarea crawls) and show a file card instead
  const BIG = 1_000_000;
  // the output box shows at most this much; copy and download always get everything
  const PREVIEW = 1_000_000;

  const info = $derived<LangInfo>(LANGS[lang]);
  const opts = $state({ ...defaultOptions });

  let text = $state('');
  let big = $state.raw<{ name: string; text: string; bytes: number } | null>(null);
  let fileName = $state<string | null>(null);
  let fileError = $state('');
  let dragging = $state(false);
  let input = $state<HTMLTextAreaElement>();
  let picker = $state<HTMLInputElement>();

  let result = $state.raw<MinifyResponse | null>(null);
  let busy = $state(false);
  let run = 0;

  const source = $derived(big?.text ?? text);

  $effect(() => {
    const code = source;
    const options = { ...opts };
    const id = ++run;
    if (!code.trim()) {
      result = null;
      busy = false;
      return;
    }
    const timer = setTimeout(async () => {
      busy = true;
      try {
        const response = await minifyCode({ lang, code, options });
        if (id === run) result = response;
      } catch (e) {
        if (id === run) result = { ok: false, error: { message: (e as Error).message } };
      } finally {
        if (id === run) busy = false;
      }
    }, code.length > 200_000 ? 400 : 120);
    return () => clearTimeout(timer);
  });

  onMount(() => closeMinifier);

  const output = $derived(result?.ok ? result.code : '');
  const sizes = $derived(result?.ok ? result.sizes : null);
  const notes = $derived(result?.ok ? result.notes : []);
  const ratio = $derived(sizes ? sizes.minified / Math.max(sizes.original, 1) : 1);
  const savedLabel = $derived.by(() => {
    if (!sizes) return '';
    const saved = (1 - ratio) * 100;
    if (saved < 0) return `+${(-saved).toFixed(1)}%`;
    if (saved > 0 && saved < 0.1) return '<0.1%';
    return `−${saved.toFixed(1)}%`;
  });

  async function load(file: File) {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    // a .js dropped on the CSS page is text too, but minifying it as CSS would only mangle it
    const otherLang = Object.values(LANGS).some((l) => l !== info && (l.exts as string[]).includes(ext));
    if (otherLang || (!info.exts.includes(ext) && ext !== 'txt' && !file.type.startsWith('text/'))) {
      fileError = `${file.name} doesn't look like a ${info.label} file. Choose a ${info.exts.map((e) => `.${e}`).join(' or ')} file instead.`;
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      fileError = `Couldn't read ${file.name}. Try opening it again.`;
      return;
    }
    if (content.includes('\u0000')) {
      fileError = `${file.name} looks like a binary file, not ${info.label}.`;
      return;
    }
    fileError = '';
    fileName = file.name;
    if (content.length > BIG) {
      big = { name: file.name, text: content, bytes: file.size };
      text = '';
    } else {
      big = null;
      text = content;
    }
  }

  function clear() {
    text = '';
    big = null;
    fileName = null;
    fileError = '';
    input?.focus();
  }

  function useSample() {
    big = null;
    fileName = null;
    fileError = '';
    text = samples[lang];
  }

  /** Puts the caret on a note's line and column in the input */
  function reveal(note: Note) {
    if (!input || !note.line || big) return;
    // the textarea turns CRLF into LF, so offsets come from what it holds, not from the loaded file
    const text = input.value;
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(note.line - 1, lines.length); i++) offset += lines[i].length + 1;
    offset = Math.min(offset + (note.column ?? 1) - 1, text.length);
    input.focus();
    input.setSelectionRange(offset, Math.min(offset + 1, text.length));
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 21;
    input.scrollTop = Math.max(0, (note.line - 4) * lineHeight);
  }

  function outName() {
    const ext = info.exts[0];
    if (!fileName) return `${info.base}.min.${ext}`;
    // "app.js" and "app.min.js" both become "app.min.js"; "notes.txt" becomes "notes.min.css"
    const own = info.exts.find((e) => fileName!.toLowerCase().endsWith(`.${e}`));
    return `${fileName.replace(/(\.min)?\.[^.]+$/i, '')}.min.${own ?? ext}`;
  }

  function download() {
    downloadBlob(new Blob([output], { type: `${info.mime};charset=utf-8` }), outName());
  }

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <nav class="langs" aria-label="Minifier type">
      {#each Object.entries(LANGS) as [key, l] (key)}
        <a href={l.href} aria-current={key === lang ? 'page' : undefined}>{l.label}</a>
      {/each}
    </nav>
    {#if lang === 'js'}
      <div class="flex items-center gap-2">
        <span class="mono" id="ecma-label">output syntax</span>
        <div class="seg" role="group" aria-labelledby="ecma-label">
          {#each ECMAS as [value, label] (value)}
            <button type="button" aria-pressed={opts.ecma === value} onclick={() => (opts.ecma = value)}>{label}</button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap gap-x-5 gap-y-2">
    {#each info.flags as [key, label] (key)}
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" class="accent-(--color-sun)" bind:checked={opts[key]} />
        {label}
      </label>
    {/each}
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <div
      class="pane"
      class:dragging
      role="group"
      aria-label={`${info.label} input`}
      ondragover={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dragging = false;
      }}
      ondrop={(e) => {
        const file = e.dataTransfer?.files[0];
        dragging = false;
        if (!file) return;
        e.preventDefault();
        load(file);
      }}
    >
      <div class="head">
        <label class="label mb-0!" for="minifier-input">your {info.label}</label>
        <div class="flex gap-1.5">
          <button type="button" class="btn mini" onclick={() => picker?.click()}>Open file</button>
          {#if source}
            <button type="button" class="btn mini" onclick={clear}>Clear</button>
          {:else}
            <button type="button" class="btn mini" onclick={useSample}>Sample</button>
          {/if}
        </div>
      </div>
      {#if big}
        <div class="field box file">
          <span class="font-serif text-2xl break-all">{big.name}</span>
          <span class="mono">{formatBytes(big.bytes)} · too big to edit here, but it minifies just the same</span>
          <button type="button" class="btn mini" onclick={clear}>Remove file</button>
        </div>
      {:else}
        <textarea
          id="minifier-input"
          bind:this={input}
          bind:value={text}
          class="field code"
          wrap="off"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          placeholder={`Paste your ${info.label} here, or drop a .${info.exts[0]} file`}
        ></textarea>
      {/if}
      {#if dragging}
        <div class="drop-hint" aria-hidden="true"><span class="font-serif text-3xl">Drop to load</span></div>
      {/if}
      <input bind:this={picker} type="file" accept={info.accept} hidden onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (file) load(file);
      }} />
    </div>

    <div class="pane">
      <div class="head">
        <label class="label mb-0!" for="minifier-output">minified</label>
        <span class="mono" aria-live="polite">
          {#if busy}<span class="pulse" aria-hidden="true"></span> minifying…{:else if result?.ok}<span class="text-ok">✓ done</span>{:else if result}<span class="text-bad">✕ error</span>{/if}
        </span>
      </div>
      {#if result && !result.ok}
        {@const error = result.error}
        <div class="field box" role="alert">
          <p class="text-bad">{describeNote(error)}</p>
          {#if error.line && !big}
            <button type="button" class="btn mini mt-3" onclick={() => reveal(error)}>Show in input</button>
          {/if}
        </div>
      {:else if result}
        <textarea id="minifier-output" class="field code break-all" readonly value={output.length > PREVIEW ? output.slice(0, PREVIEW) : output} spellcheck="false"></textarea>
        {#if output.length > PREVIEW}
          <p class="mono mt-2">Showing the first {formatBytes(PREVIEW)}. Copy or download for the full result.</p>
        {/if}
      {:else}
        <div class="field box">
          <span class="font-serif text-3xl">Minified {info.label} lands here</span>
          <span class="mono">It updates as you type, right on your device.</span>
          {#if !source}<button type="button" class="btn mini mt-2" onclick={useSample}>Try a sample</button>{/if}
        </div>
      {/if}
    </div>
  </div>

  {#if fileError}<p class="text-bad text-sm" role="alert">{fileError}</p>{/if}

  {#if sizes}
    <div class="card result">
      <div class="meter" aria-hidden="true"><span style:--r={Math.min(ratio, 1)}></span></div>
      <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="tile">
          <dt class="mono">saved</dt>
          <dd class="font-serif text-3xl leading-none text-sun">{savedLabel}</dd>
        </div>
        <div class="tile">
          <dt class="mono">original</dt>
          <dd class="font-serif text-3xl leading-none">{formatBytes(sizes.original)}</dd>
        </div>
        <div class="tile">
          <dt class="mono">minified</dt>
          <dd class="font-serif text-3xl leading-none">{formatBytes(sizes.minified)}</dd>
        </div>
        <div class="tile">
          <dt class="mono">gzipped</dt>
          <dd class="font-serif text-3xl leading-none">
            {#if sizes.originalGzip !== null && sizes.minifiedGzip !== null}
              {formatBytes(sizes.minifiedGzip)}
              <span class="mono block mt-1">was {formatBytes(sizes.originalGzip)}</span>
            {:else}—{/if}
          </dd>
        </div>
      </dl>
    </div>
  {/if}

  {#if notes.length}
    <ul class="grid gap-2" aria-label="Notes">
      {#each notes as note, i (i)}
        <li class="note">
          <span>{describeNote(note)}</span>
          {#if note.line && !big}
            <button type="button" class="btn mini shrink-0" onclick={() => reveal(note)}>Show</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="flex flex-wrap gap-2">
    <CopyButton text={() => output} class="btn-primary" label="Copy minified" />
    <button type="button" class="btn" onclick={download} disabled={!output}>Download {outName()}</button>
  </div>
</div>

<style>
  .langs {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    overflow: hidden;
    & a {
      font: 400 13px var(--font-mono);
      color: var(--color-muted);
      padding: 8px 14px;
      text-decoration: none;
    }
    & a:hover {
      color: var(--color-chalk);
    }
    & a[aria-current='page'] {
      background: var(--color-chalk);
      color: var(--color-bg);
    }
  }
  .pane {
    position: relative;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 36px;
    margin-bottom: 6px;
  }
  .mini {
    padding: 7px 11px;
    font-size: 13px;
    border-radius: 9px;
  }
  .code {
    min-height: 380px;
    font-size: 13px;
    tab-size: 2;
  }
  .box {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    min-height: 380px;
    text-align: center;
  }
  .file {
    border-style: dashed;
  }
  .drop-hint {
    position: absolute;
    inset: 42px 0 0;
    display: grid;
    place-items: center;
    border: 1.5px dashed var(--color-sun);
    border-radius: 12px;
    background: #131211e6;
    pointer-events: none;
  }
  .pulse {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--color-sun);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    from { opacity: 0.25; }
  }
  .result {
    padding: 16px;
  }
  .meter {
    height: 6px;
    margin-bottom: 14px;
    border-radius: 99px;
    background: var(--color-line-2);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-sun);
      transform-origin: left;
      transform: scaleX(var(--r));
      transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
      /* the bar starts at the original size and shrinks to the minified one */
      animation: shrink 0.9s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes shrink {
    from { transform: scaleX(1); }
  }
  .tile {
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
  }
  .note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    font-size: 14px;
    color: var(--color-soft);
    border: 1px solid var(--color-line-2);
    border-left: 3px solid var(--color-sun);
    border-radius: 12px;
  }
</style>
