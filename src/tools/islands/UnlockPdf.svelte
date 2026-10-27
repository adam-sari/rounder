<script lang="ts">
  import { onDestroy } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import PdfLockRow from './PdfLockRow.svelte';
  import { pdfName, PdfError, runQpdf } from '@/engines/pdf';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { inspectPdf, type PdfLockInfo } from '@/tools/lib/pdf-security/inspect';
  import { listPhrase } from '@/tools/lib/pdf-security/security';

  interface Item {
    id: number;
    file: File;
    /** the password typed in to open it, if it had one */
    password?: string;
    pages: number;
    info?: PdfLockInfo;
    /** plain: not encrypted, so there's nothing to remove */
    status: 'checking' | 'plain' | 'working' | 'done' | 'error';
    blob?: Blob;
    error?: string;
  }

  let items = $state<Item[]>([]);
  let zipping = $state(false);
  let nextId = 0;
  // qpdf runs one file at a time, so only one file's bytes are in memory at once
  let queue = Promise.resolve();

  const done = $derived(items.filter((it) => it.status === 'done'));
  const busy = $derived(items.some((it) => it.status === 'checking' || it.status === 'working'));

  function add({ file, doc, password }: OpenedPdf) {
    items.push({ id: nextId++, file, password, pages: doc.numPages, status: 'checking' });
    const it = items.at(-1)!;
    inspectPdf(doc).then(
      (info) => {
        if (!items.includes(it)) {
          if (info.thumb) URL.revokeObjectURL(info.thumb);
          return;
        }
        it.info = info;
        if (!info.encrypted && !password) it.status = 'plain';
        else queue = queue.then(() => unlock(it));
      },
      // couldn't read the details: qpdf will still say what's wrong, if anything
      () => (queue = queue.then(() => unlock(it))),
    );
  }

  async function unlock(it: Item) {
    if (!items.includes(it)) return;
    it.status = 'working';
    try {
      const out = await runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], new Uint8Array(await it.file.arrayBuffer()), { password: it.password });
      it.blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      it.status = 'done';
    } catch (e) {
      it.error =
        e instanceof PdfError ? e.message
        : (e as Error).name === 'NotReadableError' ? 'Your browser lost access to this file. Add it again.'
        : `Something went wrong: ${(e as Error).message || 'unknown error'}`;
      it.status = 'error';
    }
  }

  function remove(it: Item) {
    if (it.info?.thumb) URL.revokeObjectURL(it.info.thumb);
    items = items.filter((i) => i !== it);
  }

  function clearAll() {
    for (const it of items) if (it.info?.thumb) URL.revokeObjectURL(it.info.thumb);
    items = [];
  }

  const outName = (it: Item) => pdfName(it.file.name, '-unlocked');

  async function downloadAll() {
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((it) => ({ name: outName(it), blob: it.blob! }))), 'unlocked-pdfs.zip');
    } finally {
      zipping = false;
    }
  }

  function note(it: Item): { text?: string; tone?: 'muted' | 'ok' | 'bad' | 'sun' } {
    const limits = it.info?.restrictions ?? [];
    switch (it.status) {
      case 'checking':
        return { text: 'Checking…' };
      case 'plain':
        return { text: "This PDF isn't locked: it has no password or restrictions to remove." };
      case 'working':
        return { text: it.password ? 'Removing the password…' : 'Removing restrictions…' };
      case 'error':
        return { text: it.error, tone: 'bad' };
    }
    const what =
      it.password ? (limits.length ? `Password and limits on ${listPhrase(limits)} removed` : 'Password removed')
      : limits.length ? `Limits on ${listPhrase(limits)} removed`
      : 'Encryption removed';
    return { text: `${what} · ${formatBytes(it.blob!.size)}`, tone: 'ok' };
  }

  onDestroy(clearAll);
</script>

<div class="grid gap-5">
  {#if items.length}
    <ul class="grid gap-2" aria-label="PDFs to unlock" aria-live="polite">
      {#each items as it (it.id)}
        {@const n = note(it)}
        <PdfLockRow
          name={it.file.name}
          meta="{it.pages} page{it.pages === 1 ? '' : 's'} · {formatBytes(it.file.size)}"
          thumb={it.info?.thumb}
          note={n.text}
          tone={n.tone}
          lock={it.status === 'done' || it.status === 'plain' ? 'open' : 'closed'}
          busy={it.status === 'working' || it.status === 'checking'}
        >
          {#snippet actions()}
            {#if it.status === 'done'}
              <button type="button" class="btn px-3! py-2! text-sm!" onclick={() => downloadBlob(it.blob!, outName(it))}>Download</button>
            {/if}
            {#if it.status !== 'working'}
              <button type="button" class="x" aria-label="Remove {it.file.name}" onclick={() => remove(it)}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
              </button>
            {/if}
          {/snippet}
        </PdfLockRow>
      {/each}
    </ul>
  {/if}
  <!-- one PdfDrop for both states, so files still opening (or asking for a password) survive the switch to compact -->
  <div class="flex flex-wrap items-start gap-2">
    <div class="min-w-0 flex-1 basis-60">
      <PdfDrop multiple compact={items.length > 0} title={items.length ? undefined : 'Drop locked PDFs'} onopen={add} />
    </div>
    {#if done.length > 1}
      <button type="button" class="btn btn-primary" disabled={zipping || busy} onclick={downloadAll}>{zipping ? 'Zipping…' : `Download all ${done.length} (.zip)`}</button>
    {/if}
    {#if items.length}
      <button type="button" class="btn" disabled={busy} onclick={clearAll}>Clear all</button>
    {/if}
  </div>
  {#if !items.length}
    <p class="mono -mt-2 text-center leading-relaxed">
      For PDFs you know the password to, or that only block printing, copying or editing. We can't recover a forgotten open password.
    </p>
  {/if}
</div>

<style>
  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 0;
    background: none;
    color: var(--color-muted);
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
      background: var(--color-panel-2);
    }
  }
</style>
