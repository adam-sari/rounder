<script lang="ts">
  import { onMount } from 'svelte';
  import ArchiveTree from './ArchiveTree.svelte';
  import { downloadResult, formatBytes } from '@/tools/lib/files';
  import { buildTree, type TreeNode } from '@/tools/lib/unzip/tree';
  import { buildZip } from '@/tools/lib/zip-files/client';
  import { droppedFiles, inputFiles, type PickedFile } from '@/tools/lib/zip-files/folders';
  import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, freePath, isJunk, ratioLabel, zipName, type Level } from '@/tools/lib/zip-files/zip';

  interface Entry {
    path: string;
    size: number;
    picked: PickedFile;
  }

  let items = $state.raw<PickedFile[]>([]);
  let level = $state<Level>('normal');
  let name = $state('');
  let skipJunk = $state(true);
  let over = $state(false);
  let reading = $state(false);
  let error = $state('');
  let job = $state<{ done: number; total: number } | null>(null);
  let jobCtrl: AbortController | null = null;
  let result = $state.raw<{ blob: Blob; name: string; before: number } | null>(null);

  let filesInput: HTMLInputElement;
  let folderInput: HTMLInputElement;

  const tree = $derived(buildTree<Entry>(items.map((picked) => ({ path: picked.path, size: picked.file.size, picked }))));
  const junk = $derived(tree.files.filter((f) => isJunk(f.path)));
  const packing = $derived(skipJunk ? tree.files.filter((f) => !isJunk(f.path)) : tree.files);
  const packBytes = $derived(packing.reduce((s, f) => s + f.size, 0));
  const suggested = $derived.by(() => {
    const top = tree.root.children;
    if (top.length !== 1) return 'archive';
    return top[0].dir ? top[0].name : top[0].name.replace(/\.[^.]+$/, '');
  });
  const finalName = $derived(zipName(name.trim() || suggested));
  const tooBig = $derived(packBytes >= ZIP_MAX_BYTES || packing.length > ZIP_MAX_ENTRIES);

  const levels: [Level, string, string][] = [
    ['store', 'store', 'No compression: the fastest choice, and fine for photos and videos.'],
    ['normal', 'normal', 'Compresses documents, code and text. Photos, videos and other archives are stored as they are, since they barely shrink.'],
    ['max', 'max', 'Squeezes every file as hard as possible. Slower, and usually only a little smaller than normal.'],
  ];

  // any change makes the finished archive out of date
  $effect(() => {
    void [items, level, skipJunk];
    result = null;
  });

  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) add(inputFiles(e.clipboardData.files));
    };
    // a drop that misses the drop area would make the browser open the file and lose the list, so take it anyway
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!e.defaultPrevented && e.dataTransfer?.types.includes('Files')) onDrop(e);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onWindowDrop);
      jobCtrl?.abort();
    };
  });

  function add(incoming: PickedFile[]) {
    error = '';
    const taken = new Map(items.map((i) => [i.path, i.file]));
    const next = [...items];
    for (const it of incoming) {
      const same = taken.get(it.path);
      // the very same file dropped twice is added once; a different file with that name gets " (2)"
      if (same && same.size === it.file.size && same.lastModified === it.file.lastModified) continue;
      const path = freePath(it.path, taken);
      taken.set(path, it.file);
      next.push({ file: it.file, path });
    }
    items = next;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (!e.dataTransfer) return;
    const pending = droppedFiles(e.dataTransfer);
    reading = true;
    try {
      add(await pending);
    } catch (err) {
      console.error(err);
      error = 'Some of the dropped items couldn\'t be read. Try adding that folder with "Choose a folder" instead.';
    } finally {
      reading = false;
    }
  }

  function remove(node: TreeNode<Entry>) {
    const gone = new Set(tree.files.slice(node.first, node.end).map((f) => f.item!.picked));
    items = items.filter((i) => !gone.has(i));
  }

  function clear() {
    jobCtrl?.abort();
    items = [];
    name = '';
    error = '';
  }

  async function create() {
    if (job || !packing.length || tooBig) return;
    error = '';
    const ctrl = (jobCtrl = new AbortController());
    job = { done: 0, total: packBytes };
    const out = finalName;
    const before = packBytes;
    const made = [items, level, skipJunk];
    try {
      const entries = packing.map((f) => ({ blob: f.item!.picked.file, path: f.path, mtime: f.item!.picked.file.lastModified }));
      const blob = await buildZip(entries, level, (read) => (job!.done = read), ctrl.signal);
      downloadResult(blob, out);
      // files added or settings changed while zipping: the download is fine, but it no longer matches the page
      if (made.every((v, i) => v === [items, level, skipJunk][i])) result = { blob, name: out, before };
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        console.error(e);
        error = (e as Error)?.name === 'NotReadableError'
          ? 'One of the files couldn\'t be read. It may have been moved or changed since you added it; remove it and add it again.'
          : `Couldn't create the ZIP (${(e as Error)?.message ?? e}).`;
      }
    } finally {
      if (jobCtrl === ctrl) {
        job = null;
        jobCtrl = null;
      }
    }
  }
</script>

{#snippet dropArea(big: boolean)}
  <div
    class="drop"
    class:big
    class:over
    role="region"
    aria-label="Add files and folders"
    ondragover={(e) => {
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={onDrop}
  >
    {#if reading}
      <span class="title">Reading folders…</span>
    {:else}
      <span class="title">{big ? 'Drop files or folders here' : 'Add more'}</span>
      <span class="flex flex-wrap justify-center gap-2">
        <button type="button" class="btn" onclick={() => filesInput.click()}>Choose files</button>
        <button type="button" class="btn" onclick={() => folderInput.click()}>Choose a folder</button>
      </span>
      {#if big}
        <span class="mono">or paste files with ⌘V / Ctrl+V</span>
        <span class="mono lock">● zipped on your device · nothing is uploaded</span>
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet trail(node: TreeNode<Entry>)}
  <button
    type="button"
    class="btn icon-btn"
    disabled={!!job}
    onclick={() => remove(node)}
    aria-label={node.dir ? `Remove folder ${node.name}` : `Remove ${node.name}`}
    title="Remove"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
  </button>
{/snippet}

<input bind:this={filesInput} type="file" multiple hidden onchange={(e) => { add(inputFiles(e.currentTarget.files)); e.currentTarget.value = ''; }} />
<input bind:this={folderInput} type="file" webkitdirectory hidden onchange={(e) => { add(inputFiles(e.currentTarget.files)); e.currentTarget.value = ''; }} />

{#if !items.length}
  {@render dropArea(true)}
  {#if error}<p class="mt-3 text-center text-sm text-bad" role="alert">{error}</p>{/if}
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <section class="grid min-w-0 content-start gap-3" aria-label="Files to zip">
      <header class="head">
        <div class="min-w-0 flex-1">
          <p class="font-medium">{tree.files.length.toLocaleString()} {tree.files.length === 1 ? 'file' : 'files'}{#if tree.folders} in {tree.folders.toLocaleString()} {tree.folders === 1 ? 'folder' : 'folders'}{/if}</p>
          <p class="mono">{formatBytes(tree.root.size)} before zipping</p>
        </div>
        <button type="button" class="btn px-3! py-2! text-sm" disabled={!!job} onclick={clear}>Clear all</button>
      </header>
      <div class="scroller">
        <ArchiveTree {tree} label="Files to zip" {trail} />
      </div>
      {@render dropArea(false)}
    </section>

    <aside class="grid content-start gap-5">
      <label>
        <span class="label">archive name</span>
        <span class="relative block">
          <input class="field pr-14!" type="text" placeholder={suggested} bind:value={name} spellcheck="false" />
          <span class="ext mono" aria-hidden="true">.zip</span>
        </span>
      </label>

      <div>
        <span class="label">compression</span>
        <div class="seg" role="group" aria-label="Compression">
          {#each levels as [value, text]}
            <button type="button" aria-pressed={level === value} onclick={() => (level = value)}>{text}</button>
          {/each}
        </div>
        <p class="mono mt-2">{levels.find(([v]) => v === level)?.[2]}</p>
      </div>

      {#if junk.length}
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" class="mt-1" bind:checked={skipJunk} />
          <span>
            Leave out {junk.length} system {junk.length === 1 ? 'file' : 'files'}
            <span class="mono block">.DS_Store, Thumbs.db and similar clutter</span>
          </span>
        </label>
      {/if}

      <div class="grid gap-2 border-t border-line pt-5">
        {#if tooBig}
          <p class="text-sm text-bad" role="alert">
            That's more than a standard ZIP can hold (4 GB or 65,535 files). Bigger archives need the ZIP64 format, which this tool can't write yet, so split the files into a few smaller ZIPs.
          </p>
        {/if}
        <button type="button" class="btn btn-primary" disabled={!!job || !packing.length || tooBig} onclick={create}>
          {job ? 'Zipping…' : `Create ${finalName}`}
        </button>

        {#if job}
          <div class="grid gap-1.5" aria-live="polite">
            <div class="bar"><span style:width={`${job.total ? Math.round((job.done / job.total) * 100) : 0}%`}></span></div>
            <p class="mono flex justify-between">
              <span>{formatBytes(job.done)} of {formatBytes(job.total)}</span>
              <button type="button" class="link" onclick={() => jobCtrl?.abort()}>cancel</button>
            </p>
          </div>
        {:else if result}
          {@const ratio = result.before ? Math.min(1, result.blob.size / result.before) : 1}
          <div class="result" role="status">
            <p class="text-sm"><span class="tick" aria-hidden="true">✓</span> <span class="font-medium">{result.name}</span> is ready</p>
            <div class="bars" aria-hidden="true">
              <span class="before"></span>
              <span class="after" style:--ratio={ratio}></span>
            </div>
            <p class="mono flex justify-between">
              <span>{formatBytes(result.before)} → <span class="text-chalk">{formatBytes(result.blob.size)}</span></span>
              <span class={result.blob.size < result.before ? 'text-ok' : 'text-muted'}>{ratioLabel(result.before, result.blob.size)}</span>
            </p>
            <button type="button" class="btn" onclick={() => downloadResult(result!.blob, result!.name)}>Download again</button>
          </div>
        {/if}
        {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
      </div>

      <p class="mono">
        Want a password on it? This tool can't add one, but you can lock the finished ZIP with the
        <a href="/file-encryptor" class="text-soft underline">file encryptor</a>.
      </p>
    </aside>
  </div>
{/if}

<style>
  .drop {
    display: grid;
    justify-items: center;
    gap: 12px;
    width: 100%;
    padding: 20px;
    text-align: center;
    border: 1.5px dashed #f2ede466;
    border-radius: 18px;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px);
    transition: border-color 0.2s, background-color 0.2s;
    &.big {
      padding: 48px 20px;
    }
    &.over {
      border-color: var(--color-sun);
      background-color: #ffd25e0d;
    }
  }
  .title {
    font: 400 30px/1.1 var(--font-serif);
  }
  .drop:not(.big) .title {
    font-size: 22px;
  }
  .lock {
    color: var(--color-ok);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel);
  }
  .scroller {
    max-height: min(60vh, 560px);
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    overscroll-behavior: contain;
  }
  .icon-btn {
    flex: none;
    padding: 7px !important;
    border-color: transparent;
    background: transparent;
    & svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
    }
    &:hover {
      border-color: var(--color-line-2);
      background: var(--color-panel-2);
      color: var(--color-bad);
    }
  }
  .ext {
    position: absolute;
    top: 50%;
    right: 14px;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .bar {
    height: 6px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--color-panel-2);
    & span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-sun);
      transition: width 0.2s;
    }
  }
  .result {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel);
    animation: appear 0.3s ease-out;
  }
  .bars {
    display: grid;
    gap: 4px;
    & span {
      height: 8px;
      border-radius: 99px;
    }
    & .before {
      background: var(--color-line-2);
    }
    & .after {
      width: calc(var(--ratio) * 100%);
      min-width: 8px;
      background: var(--color-sun);
      animation: shrink 0.9s var(--ease-spring) both;
    }
  }
  .tick {
    display: inline-block;
    color: var(--color-ok);
    animation: pop 0.4s var(--ease-spring);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-muted);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  @keyframes shrink {
    from {
      width: 100%;
    }
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
</style>
