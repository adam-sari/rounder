<script lang="ts">
  import { onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import ArchiveTree from './ArchiveTree.svelte';
  import { downloadResult, formatBytes } from '@/tools/lib/files';
  import { ArchiveProblem, LIBARCHIVE_MAX_BYTES, OpenArchive, decompressStream, explain } from '@/tools/lib/unzip/archive';
  import { folderPicker, writeToFolder } from '@/tools/lib/unzip/disk';
  import {
    FORMAT_LABEL, SNIFF_BYTES, baseName, gzipStoredName, isSplitPart, isStreamFormat, mimeOf, previewKind, safeSegments, sniff, unwrappedName,
    type ArchiveFormat,
  } from '@/tools/lib/unzip/formats';
  import { buildTree, prefixSums, type Tree, type TreeNode } from '@/tools/lib/unzip/tree';
  import { buildZip } from '@/tools/lib/zip-files/client';
  import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from '@/tools/lib/zip-files/zip';

  interface Entry {
    path: string;
    size: number;
    /** the exact path inside the archive, used to extract it */
    raw: string;
  }
  type Node = TreeNode<Entry>;
  type Preview =
    | { kind: 'loading' }
    | { kind: 'image' | 'audio' | 'video'; url: string }
    | { kind: 'text'; text: string; cut: boolean }
    | { kind: 'none'; why: string };

  const PREVIEW_MAX = 150 * 1024 ** 2;
  const TEXT_MAX = 256 * 1024;
  /** above this many files still packed, one full pass beats pulling them out one by one */
  const ONE_PASS_FROM = 20;

  let phase = $state<'empty' | 'reading' | 'locked' | 'ready' | 'error'>('empty');
  let source = $state<File | null>(null);
  let format = $state<ArchiveFormat | null>(null);
  let label = $state('');
  let tree = $state.raw<Tree<Entry> | null>(null);
  let problem = $state('');
  let progress = $state<number | null>(null);
  let query = $state('');

  let archive: OpenArchive | null = null;
  let cache = new Map<string, Blob>();
  let opening: AbortController | null = null;

  let needsPassword = $state(false);
  let password = $state('');
  let showPassword = $state(false);
  let passwordError = $state('');
  let unlocking = $state(false);

  let picked = $state.raw(new Uint8Array(0));
  const sums = $derived(prefixSums(picked));
  const pickedCount = $derived(sums[sums.length - 1]);

  let active = $state.raw<Node | null>(null);
  let preview = $state<Preview | null>(null);
  let previewToken = 0;
  let previewCard = $state<HTMLElement>();

  let job = $state<{ label: string; done: number; total: number; unit: 'files' | 'bytes' } | null>(null);
  let jobCtrl: AbortController | null = null;
  let jobError = $state('');
  let jobDone = $state('');
  let intoSubfolder = $state(true);
  let canPickFolder = $state(false);

  const targets = $derived(tree ? (pickedCount ? tree.files.filter((f) => picked[f.first]) : tree.files) : []);
  const targetBytes = $derived(targets.reduce((s, f) => s + f.size, 0));
  const folderName = $derived(source ? (safeSegments(baseName(source.name))?.[0] ?? 'extracted') : '');
  const single = $derived(tree?.files.length === 1 ? tree.files[0] : null);

  onMount(() => {
    canPickFolder = !!folderPicker();
    return reset;
  });

  function reset() {
    opening?.abort();
    jobCtrl?.abort();
    jobCtrl = null;
    archive?.close();
    archive = null;
    cache = new Map();
    clearPreview();
    active = null;
    tree = null;
    picked = new Uint8Array(0);
    source = null;
    format = null;
    label = '';
    problem = '';
    progress = null;
    query = '';
    needsPassword = false;
    password = '';
    passwordError = '';
    job = null;
    jobError = '';
    jobDone = '';
    phase = 'empty';
  }

  async function open(file: File) {
    reset();
    const ctrl = (opening = new AbortController());
    source = file;
    phase = 'reading';
    try {
      const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
      if (ctrl.signal.aborted) return;
      format = sniff(head);
      let opened: OpenArchive | null = null;
      let failure: ArchiveProblem | null = null;
      if (file.size <= LIBARCHIVE_MAX_BYTES) {
        try {
          opened = await OpenArchive.open(file);
        } catch (e) {
          failure = explain(e);
        }
        if (ctrl.signal.aborted) return opened?.close();
      }
      if (opened?.entries.length) return show(opened);
      opened?.close();

      // 7z can lock the file list itself, which then reads as empty
      if (failure?.kind === 'password' || (opened && format === '7z')) {
        label = FORMAT_LABEL[format ?? 'zip'];
        phase = 'locked';
        return;
      }
      if (opened && format === 'rar') {
        throw new ArchiveProblem('No files could be read from this RAR archive. It may be empty, or its file list may be encrypted, and encrypted RAR files aren\'t supported yet.', 'unsupported');
      }
      if (isStreamFormat(format)) return await unpackStream(file, format, head, ctrl.signal);
      if (failure?.kind === 'unsupported') throw failure;
      if (file.size > LIBARCHIVE_MAX_BYTES) {
        throw new ArchiveProblem(`This archive is ${formatBytes(file.size)}. Archives over about 1.8 GB are more than a browser tab can unpack, so a desktop app is the way to go for this one.`, 'unsupported');
      }
      if (opened && format) throw new ArchiveProblem('This archive is empty: there are no files in it.', 'damaged');
      if (isSplitPart(file.name)) {
        throw new ArchiveProblem('This looks like one part of a split archive. Split archives can\'t be opened here yet, so join the parts with a desktop app first.', 'unsupported');
      }
      throw new ArchiveProblem('This doesn\'t look like an archive we can open. Try a ZIP, RAR, 7z, TAR, GZ, BZ2 or XZ file.', 'damaged');
    } catch (e) {
      if (ctrl.signal.aborted || (e as Error)?.name === 'AbortError') return;
      problem = explain(e).message;
      phase = 'error';
    }
  }

  function show(opened: OpenArchive) {
    archive = opened;
    const t = buildTree(opened.entries.map((e) => ({ path: e.path, size: e.size, raw: e.path })));
    tree = t;
    picked = new Uint8Array(t.files.length);
    needsPassword = opened.encrypted;
    label = format ? (isStreamFormat(format) ? `TAR.${FORMAT_LABEL[format]}` : FORMAT_LABEL[format]) : 'Archive';
    phase = 'ready';
  }

  async function unpackStream(file: File, f: 'gz' | 'bz2' | 'xz', head: Uint8Array, signal: AbortSignal) {
    progress = 0;
    const blob = await decompressStream(file, f, (read) => (progress = read / file.size), signal);
    const name = unwrappedName(file.name, f, f === 'gz' ? gzipStoredName(head) : undefined);
    const t = buildTree([{ path: name, size: blob.size, raw: name }]);
    cache.set(name, blob);
    tree = t;
    picked = new Uint8Array(1);
    label = FORMAT_LABEL[f];
    phase = 'ready';
    select(t.files[0]);
  }

  async function unlock(e: SubmitEvent) {
    e.preventDefault();
    if (!password || !source || unlocking) return;
    unlocking = true;
    passwordError = '';
    const from = source;
    try {
      if (phase === 'locked') {
        const opened = await OpenArchive.open(from, password);
        // "Open another archive" was pressed while the password was being checked
        if (source !== from) return opened.close();
        if (!opened.entries.length) {
          opened.close();
          throw new ArchiveProblem('', 'wrong-password');
        }
        show(opened);
      } else if (archive && tree) {
        await archive.usePassword(password);
        // prove the password on the smallest file before saying it worked
        const sized = tree.files.filter((f) => f.size > 0);
        const probe = (sized.length ? sized : tree.files).reduce((a, b) => (b.size < a.size ? b : a));
        cache.set(probe.item!.raw, await archive.extract(probe.item!.raw));
      }
      if (source !== from) return;
      needsPassword = false;
      password = '';
      jobError = '';
    } catch (err) {
      if (source !== from) return;
      const p = explain(err);
      passwordError = p.kind === 'password' || p.kind === 'wrong-password' ? 'That password isn\'t right. Check it and try again.' : p.message;
    } finally {
      unlocking = false;
    }
  }

  async function blobFor(node: Node) {
    // held locally so a result arriving after "Open another" can't land in the next archive's cache
    const store = cache;
    const from = archive;
    const raw = node.item!.raw;
    let blob = store.get(raw);
    if (!blob) {
      if (!from) throw new Error('The archive is closed.');
      blob = await from.extract(raw);
      store.set(raw, blob);
    }
    return blob;
  }

  /** a password problem sends people to the password box instead of a dead end */
  function trouble(e: unknown) {
    const p = explain(e);
    if (p.kind === 'password' || p.kind === 'wrong-password') {
      needsPassword = true;
      return 'Enter the archive\'s password above to unpack this.';
    }
    return p.message;
  }

  function clearPreview() {
    if (preview && 'url' in preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }

  async function select(node: Node) {
    active = node;
    clearPreview();
    const token = ++previewToken;
    if (matchMedia('(max-width: 1023px)').matches) {
      queueMicrotask(() => previewCard?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }
    const kind = previewKind(node.name);
    if (!kind) return (preview = { kind: 'none', why: 'No preview for this kind of file, but you can download it.' });
    if (node.size > PREVIEW_MAX) return (preview = { kind: 'none', why: `This file is too big to preview here (${formatBytes(node.size)}).` });
    preview = { kind: 'loading' };
    try {
      const blob = await blobFor(node);
      if (token !== previewToken) return;
      if (kind === 'text') {
        const text = await blob.slice(0, TEXT_MAX).text();
        if (token !== previewToken) return;
        // NUL characters mean a binary file wearing a text extension
        preview = text.slice(0, 8000).includes('\u0000')
          ? { kind: 'none', why: 'This looks like a binary file, so there is no text to show.' }
          : { kind: 'text', text, cut: blob.size > TEXT_MAX };
      } else {
        preview = { kind, url: URL.createObjectURL(new Blob([blob], { type: mimeOf(node.name) })) };
      }
    } catch (e) {
      if (token === previewToken) preview = { kind: 'none', why: trouble(e) };
    }
  }

  function toggle(node: Node) {
    const next = picked.slice();
    const all = sums[node.end] - sums[node.first] === node.count;
    next.fill(all ? 0 : 1, node.first, node.end);
    picked = next;
  }

  /** files ready to save, unpacking whatever isn't yet */
  async function collect(nodes: Node[]) {
    const missing = nodes.filter((n) => !cache.has(n.item!.raw));
    if (archive && missing.length > ONE_PASS_FROM) {
      job = { label: 'Unpacking', done: 0, total: 0, unit: 'files' };
      const store = cache;
      const from = archive;
      for (const [raw, blob] of await from.extractAll()) store.set(raw, blob);
      if (archive === from) archive = null;
    } else if (missing.length) {
      job = { label: 'Unpacking', done: 0, total: missing.length, unit: 'files' };
      for (const n of missing) {
        await blobFor(n);
        job.done++;
      }
    }
    return Promise.all(nodes.map(async (n) => ({ path: n.path, blob: await blobFor(n) })));
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (jobCtrl) return;
    jobError = '';
    jobDone = '';
    const ctrl = (jobCtrl = new AbortController());
    try {
      await task(ctrl.signal);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      jobError = (e as Error)?.name === 'NotAllowedError' ? 'Your browser didn\'t allow saving to that folder. Try again and allow access.' : trouble(e);
    } finally {
      if (jobCtrl === ctrl) {
        job = null;
        jobCtrl = null;
      }
    }
  }

  async function extractToFolder() {
    const pick = folderPicker();
    if (!pick || !targets.length) return;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pick({ mode: 'readwrite', id: 'rounder-unzip' });
    } catch {
      return; // the picker was closed
    }
    const nodes = targets;
    await run(async () => {
      const files = await collect(nodes);
      if (intoSubfolder) dir = await dir.getDirectoryHandle(folderName, { create: true });
      job = { label: 'Saving', done: 0, total: files.length, unit: 'files' };
      const failed = await writeToFolder(dir, files, (n) => (job!.done = n));
      const saved = files.length - failed;
      jobDone = `${saved.toLocaleString()} ${saved === 1 ? 'file' : 'files'} saved to “${dir.name}”${failed ? ` · ${failed} couldn't be written` : ''}`;
    });
  }

  /** `base` is cut from the front of every path, so a folder's ZIP starts at that folder */
  async function downloadZip(nodes: Node[], name: string, base = '') {
    // fflate can't write ZIP64, and a ZIP past these limits would come out broken
    if (nodes.length > ZIP_MAX_ENTRIES || nodes.reduce((s, n) => s + n.size, 0) >= ZIP_MAX_BYTES) {
      jobDone = '';
      jobError = `That's more than a standard ZIP can hold (4 GB or 65,535 files). ${canPickFolder ? 'Extract to a folder instead, or tick' : 'Tick'} fewer files and download them in a few parts.`;
      return;
    }
    await run(async (signal) => {
      const files = (await collect(nodes)).map((f) => ({ ...f, path: f.path.slice(base.length) }));
      job = { label: 'Zipping', done: 0, total: files.reduce((s, f) => s + f.blob.size, 0), unit: 'bytes' };
      const zip = await buildZip(files, 'normal', (read) => (job!.done = read), signal);
      downloadResult(zip, name);
      jobDone = `${name} · ${formatBytes(zip.size)}`;
    });
  }

  async function download(node: Node) {
    if (node.dir) return downloadZip(tree!.files.slice(node.first, node.end), `${node.name}.zip`, node.path.slice(0, -node.name.length));
    await run(async () => {
      if (!cache.has(node.item!.raw)) job = { label: 'Unpacking', done: 0, total: 0, unit: 'files' };
      downloadResult(await blobFor(node), node.name);
    });
  }

  const zipName = $derived(source ? `${baseName(source.name)}${pickedCount ? '-selected' : ''}.zip` : 'files.zip');

  const indeterminate = (on: boolean) => (el: HTMLInputElement) => {
    el.indeterminate = on;
  };
</script>

{#snippet lead(node: Node)}
  {@const n = sums[node.end] - sums[node.first]}
  <input
    type="checkbox"
    class="pick"
    checked={n > 0 && n === node.count}
    {@attach indeterminate(n > 0 && n < node.count)}
    onchange={() => toggle(node)}
    aria-label={`Select ${node.name}`}
  />
{/snippet}

{#snippet trail(node: Node)}
  <button
    type="button"
    class="btn icon-btn"
    onclick={() => download(node)}
    disabled={!!job}
    aria-label={node.dir ? `Download folder ${node.name} as a zip` : `Download ${node.name}`}
    title={node.dir ? 'Download folder as .zip' : 'Download'}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" /></svg>
  </button>
{/snippet}

{#snippet passwordForm(intro: string)}
  <form class="lockbox" onsubmit={unlock}>
    <div class="flex items-center gap-3">
      <svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
      <p class="text-sm text-soft">{intro}</p>
    </div>
    <label class="label" for="archive-password">password</label>
    <div class="flex gap-2">
      <div class="relative min-w-0 flex-1">
        <input
          id="archive-password"
          class="field pr-16!"
          type={showPassword ? 'text' : 'password'}
          autocomplete="off"
          spellcheck="false"
          bind:value={password}
        />
        <button type="button" class="reveal mono" aria-pressed={showPassword} onclick={() => (showPassword = !showPassword)}>
          {showPassword ? 'hide' : 'show'}
        </button>
      </div>
      <button type="submit" class="btn btn-primary" disabled={!password || unlocking}>{unlocking ? 'Checking…' : 'Unlock'}</button>
    </div>
    {#if passwordError}<p class="text-sm text-bad" role="alert">{passwordError}</p>{/if}
    <p class="mono">The password is only used here, on your device.</p>
  </form>
{/snippet}

{#if phase === 'empty'}
  <Dropzone title="Drop an archive here" hint="ZIP, RAR, 7z, TAR, GZ, BZ2, XZ · or click to choose" onfiles={(files) => open(files[0])} />
  <ul class="chips" aria-label="Formats you can open">
    {#each ['ZIP', 'RAR', '7z', 'TAR', 'TAR.GZ', 'TGZ', 'GZ', 'BZ2', 'XZ', 'ISO', 'CAB', 'JAR', 'APK', 'EPUB'] as f}
      <li class="mono">{f}</li>
    {/each}
  </ul>
{:else if phase === 'reading'}
  <div class="card status" aria-live="polite">
    <div class="stack" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="font-serif text-2xl">Reading the archive…</p>
    <p class="mono truncate">{source?.name} · {formatBytes(source?.size ?? 0)}</p>
    <div class="bar" class:indeterminate={progress === null}>
      <span style:width={progress === null ? undefined : `${Math.round(progress * 100)}%`}></span>
    </div>
    <button type="button" class="btn" onclick={reset}>Cancel</button>
  </div>
{:else if phase === 'locked'}
  <div class="card status">
    <p class="font-serif text-2xl">This {label} is locked</p>
    <p class="mono truncate">{source?.name}</p>
    <div class="w-full max-w-md text-left">
      {@render passwordForm('The file list is password-protected (or the archive is empty). Enter the password to see what\'s inside.')}
    </div>
    <button type="button" class="btn" onclick={reset}>Open another archive</button>
  </div>
{:else if phase === 'error'}
  <div class="grid gap-4">
    <div class="card status">
      <p class="font-serif text-2xl">Couldn't open {source?.name ?? 'this file'}</p>
      <p class="max-w-lg text-soft" role="alert">{problem}</p>
    </div>
    <Dropzone title="Try another archive" hint="drop or click to choose" onfiles={(files) => open(files[0])} />
  </div>
{:else if tree && source}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <section class="grid min-w-0 content-start gap-3" aria-label="Archive contents">
      <header class="head">
        <span class="badge mono">{label}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{source.name}</p>
          <p class="mono">
            {tree.files.length.toLocaleString()} {tree.files.length === 1 ? 'file' : 'files'}{#if tree.folders}
              · {tree.folders.toLocaleString()} {tree.folders === 1 ? 'folder' : 'folders'}{/if}
            · {formatBytes(tree.root.size)} unpacked from {formatBytes(source.size)}
          </p>
        </div>
        <button type="button" class="btn px-3! py-2! text-sm" onclick={reset}>Open another</button>
      </header>

      {#if isSplitPart(source.name)}
        <p class="note text-sm">This is one part of a split archive. Files that continue into the other parts can't be unpacked here.</p>
      {/if}

      {#if needsPassword}
        {@render passwordForm(`${source.name} is password-protected. Enter the password to unpack its files.`)}
      {/if}

      {#if tree.files.length > 1}
        <div class="toolbar">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="pick"
              checked={pickedCount === tree.files.length}
              {@attach indeterminate(pickedCount > 0 && pickedCount < tree.files.length)}
              onchange={() => toggle(tree!.root)}
            />
            Select all
          </label>
          <input class="field search" type="search" placeholder="Filter files…" aria-label="Filter files by name" bind:value={query} />
        </div>
      {/if}

      <div class="scroller">
        <ArchiveTree {tree} {query} {active} label="Files in the archive" onopen={select} {lead} {trail} />
      </div>
    </section>

    <aside class="grid content-start gap-4">
      <div class="card preview" bind:this={previewCard} aria-live="polite">
        {#if !active}
          <div class="blank">
            <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="6" width="30" height="36" rx="4" /><path d="M16 17h16M16 24h16M16 31h9" /></svg>
            <p class="mono">Pick a file to preview it</p>
          </div>
        {:else}
          <div class="min-w-0">
            <p class="truncate text-sm font-medium" title={active.path}>{active.name}</p>
            <p class="mono truncate">{formatBytes(active.size)}{#if active.path.includes('/')} · {active.path.slice(0, active.path.lastIndexOf('/'))}{/if}</p>
          </div>
          <div class="view">
            {#if preview?.kind === 'loading'}
              <div class="bar indeterminate w-2/3"><span></span></div>
            {:else if preview?.kind === 'image'}
              <img
                src={preview.url}
                alt={`Preview of ${active.name}`}
                onerror={() => {
                  clearPreview();
                  preview = { kind: 'none', why: 'Your browser can\'t display this image format.' };
                }}
              />
            {:else if preview?.kind === 'video'}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={preview.url} controls preload="metadata"></video>
            {:else if preview?.kind === 'audio'}
              <audio src={preview.url} controls preload="metadata"></audio>
            {:else if preview?.kind === 'text'}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <pre class="text" tabindex="0">{preview.text}{#if preview.cut}<span class="cut">… preview ends here; download for the rest</span>{/if}</pre>
            {:else if preview?.kind === 'none'}
              <p class="px-4 text-center text-sm text-soft">{preview.why}</p>
            {/if}
          </div>
          <button type="button" class="btn" disabled={!!job} onclick={() => download(active!)}>Download {active.name}</button>
        {/if}
      </div>

      <div class="grid gap-2 border-t border-line pt-4">
        <p class="mono">
          {#if single}
            {single.name} · {formatBytes(single.size)}
          {:else if pickedCount}
            {pickedCount.toLocaleString()} of {tree.files.length.toLocaleString()} selected · {formatBytes(targetBytes)}
          {:else}
            all {tree.files.length.toLocaleString()} files · {formatBytes(targetBytes)}
          {/if}
        </p>
        {#if single}
          <button type="button" class="btn btn-primary" disabled={!!job} onclick={() => download(single)}>Download {single.name}</button>
        {:else}
          {#if canPickFolder}
            <button type="button" class="btn btn-primary" disabled={!!job} onclick={extractToFolder}>
              Extract {pickedCount ? 'selected' : 'all'} to a folder…
            </button>
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" class="mt-1" bind:checked={intoSubfolder} />
              <span>Put them in a new “{folderName}” folder<span class="mono block">files with the same name are replaced</span></span>
            </label>
          {/if}
          <button type="button" class={['btn', !canPickFolder && 'btn-primary']} disabled={!!job} onclick={() => downloadZip(targets, zipName)}>
            Download {pickedCount ? 'selected' : 'all'} as .zip
          </button>
        {/if}

        {#if job}
          <div class="grid gap-1.5" aria-live="polite">
            <div class="bar" class:indeterminate={!job.total}>
              <span style:width={job.total ? `${Math.round((job.done / job.total) * 100)}%` : undefined}></span>
            </div>
            <p class="mono flex justify-between gap-2">
              <span>
                {job.label}…
                {#if job.total && job.unit === 'files'}{job.done.toLocaleString()} / {job.total.toLocaleString()}{:else if job.total}{Math.round((job.done / job.total) * 100)}%{/if}
              </span>
              {#if job.label === 'Zipping'}<button type="button" class="link" onclick={() => jobCtrl?.abort()}>cancel</button>{/if}
            </p>
          </div>
        {/if}
        {#if jobDone}<p class="done mono" role="status"><span class="tick" aria-hidden="true">✓</span> {jobDone}</p>{/if}
        {#if jobError}<p class="text-sm text-bad" role="alert">{jobError}</p>{/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 14px;
    & li {
      padding: 2px 9px;
      border: 1px solid var(--color-line-2);
      border-radius: 99px;
      font-size: 11.5px;
    }
  }
  .status {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 40px 20px;
    text-align: center;
  }
  .stack {
    display: grid;
    gap: 4px;
    width: 46px;
    & span {
      height: 9px;
      border-radius: 3px;
      background: var(--color-files);
      animation: lift 1.2s ease-in-out infinite;
    }
    & span:nth-child(2) {
      animation-delay: 0.15s;
      opacity: 0.75;
    }
    & span:nth-child(3) {
      animation-delay: 0.3s;
      opacity: 0.5;
    }
  }
  @keyframes lift {
    50% {
      transform: translateY(-4px) scaleX(0.85);
    }
  }
  .bar {
    position: relative;
    width: 100%;
    max-width: 360px;
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
    &.indeterminate span {
      width: 35%;
      animation: slide 1.1s ease-in-out infinite;
    }
  }
  aside .bar {
    max-width: none;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(290%);
    }
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
  .badge {
    flex: none;
    padding: 4px 8px;
    border-radius: 8px;
    color: var(--color-bg);
    background: var(--color-files);
    font-weight: 600;
  }
  .note {
    padding: 10px 12px;
    border-radius: 12px;
    color: var(--color-soft);
    background: #ffd25e12;
    border: 1px solid #ffd25e40;
  }
  .lockbox {
    display: grid;
    gap: 8px;
    padding: 14px;
    border: 1px solid #ffd25e55;
    border-radius: 14px;
    background: #ffd25e0a;
    & .label {
      margin: 4px 0 0;
    }
  }
  .lock {
    flex: none;
    width: 26px;
    height: 26px;
    fill: none;
    stroke: var(--color-sun);
    stroke-width: 1.6;
  }
  .reveal {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    padding: 4px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
    }
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 6px;
  }
  .search {
    flex: 1;
    max-width: 280px;
    margin-left: auto;
    padding-block: 7px;
    font-size: 14px;
  }
  .scroller {
    max-height: min(70vh, 640px);
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
    overscroll-behavior: contain;
  }
  .pick {
    flex: none;
    width: 16px;
    height: 16px;
    accent-color: var(--color-sun);
    cursor: pointer;
  }
  .icon-btn {
    flex: none;
    padding: 7px !important;
    border-color: transparent;
    background: transparent;
    & svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    &:hover {
      border-color: var(--color-line-2);
      background: var(--color-panel-2);
    }
  }
  .preview {
    display: grid;
    gap: 12px;
    padding: 14px;
  }
  .blank {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 36px 0;
    & svg {
      width: 44px;
      height: 44px;
      fill: none;
      stroke: var(--color-line-2);
      stroke-width: 1.5;
      stroke-dasharray: 3 3;
    }
  }
  .view {
    display: grid;
    place-items: center;
    min-height: 160px;
    max-height: 420px;
    overflow: hidden;
    border-radius: 12px;
    background: repeating-conic-gradient(#22211e 0 25%, #1c1b18 0 50%) 0 0 / 16px 16px;
    & img,
    & video {
      max-width: 100%;
      max-height: 420px;
      object-fit: contain;
      animation: appear 0.25s ease-out;
    }
    & audio {
      width: calc(100% - 24px);
    }
  }
  .text {
    width: 100%;
    max-height: 420px;
    align-self: stretch;
    overflow: auto;
    margin: 0;
    padding: 12px;
    font: 12px/1.5 var(--font-mono);
    color: var(--color-soft);
    white-space: pre-wrap;
    word-break: break-word;
    background: #141312;
  }
  .cut {
    display: block;
    margin-top: 8px;
    color: var(--color-muted);
  }
  .done {
    color: var(--color-ok);
  }
  .tick {
    display: inline-block;
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
  @keyframes appear {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
</style>
