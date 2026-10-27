<script module lang="ts">
  import type { PdfDoc } from '@/engines/pdf';

  export interface OpenedPdf {
    file: File;
    /** open in pdf.js, ready for thumbnails; the tool owns it and calls destroy() */
    doc: PdfDoc;
    /** what unlocked it, if it was encrypted; pass on to loadEditablePdf */
    password?: string;
  }
</script>

<script lang="ts">
  import Dropzone from './Dropzone.svelte';
  import PdfPasswordPrompt from './PdfPasswordPrompt.svelte';
  import { openPdf, PdfPasswordError } from '@/engines/pdf';

  interface Props {
    multiple?: boolean;
    title?: string;
    hint?: string;
    /** a slim "add more" button instead of the big drop area, for when files are already loaded */
    compact?: boolean;
    /** called once per file that opened, in the order they were dropped */
    onopen: (pdf: OpenedPdf) => void;
  }

  let { multiple = false, title, hint = 'or click to choose', compact = false, onopen }: Props = $props();

  const ACCEPT = 'application/pdf,.pdf';

  let queue: File[] = [];
  let working = $state<string | null>(null);
  let asking = $state<{ file: File; wrong: boolean; busy: boolean; resolve: (pw: string | null) => void } | null>(null);
  let errors = $state<string[]>([]);
  let picker = $state<HTMLInputElement>();
  let over = $state(false);

  /** also callable via bind:this, e.g. from the tool's own drop target */
  export function add(files: File[]) {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    for (const f of files) if (!pdfs.includes(f)) errors.push(`${f.name} isn't a PDF.`);
    queue.push(...(multiple ? pdfs : pdfs.slice(0, 1)));
    if (!working) void drain();
  }

  async function drain() {
    let file: File | undefined;
    while ((file = queue.shift())) {
      working = file.name;
      try {
        onopen({ file, doc: await openPdf(file) });
      } catch (e) {
        if (e instanceof PdfPasswordError) await unlock(file);
        else errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    working = null;
  }

  // asks until the password works or the user skips the file
  async function unlock(file: File) {
    let wrong = false;
    for (;;) {
      const password = await new Promise<string | null>((resolve) => (asking = { file, wrong, busy: false, resolve }));
      if (password === null) break;
      asking!.busy = true;
      try {
        onopen({ file, doc: await openPdf(file, { password }), password });
        break;
      } catch (e) {
        if (!(e instanceof PdfPasswordError)) {
          errors.push(`${file.name}: ${(e as Error).message}`);
          break;
        }
        wrong = true;
      }
    }
    asking = null;
  }
</script>

{#if asking}
  <PdfPasswordPrompt
    fileName={asking.file.name}
    wrong={asking.wrong}
    busy={asking.busy}
    onsubmit={(pw) => asking?.resolve(pw)}
    oncancel={() => asking?.resolve(null)}
  />
{:else if compact}
  <button
    type="button"
    class="btn add"
    class:over
    disabled={!!working}
    onclick={() => picker?.click()}
    ondragover={(e) => {
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={(e) => {
      e.preventDefault();
      over = false;
      add(Array.from(e.dataTransfer?.files ?? []));
    }}
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
    {working ? `Opening ${working}…` : (title ?? (multiple ? 'Add PDFs' : 'Choose another PDF'))}
  </button>
  <input bind:this={picker} type="file" accept={ACCEPT} {multiple} hidden onchange={(e) => (add(Array.from(e.currentTarget.files ?? [])), (e.currentTarget.value = ''))} />
{:else if working}
  <div class="opening" role="status">
    <span class="spinner" aria-hidden="true"></span>
    <span class="mono">Opening {working}…</span>
  </div>
{:else}
  <Dropzone accept={ACCEPT} {multiple} title={title ?? (multiple ? 'Drop PDFs here' : 'Drop a PDF here')} {hint} onfiles={add} />
{/if}

{#if errors.length}
  <div class="errors" role="alert">
    <ul>
      {#each errors as msg, i (i)}
        <li>{msg}</li>
      {/each}
    </ul>
    <button type="button" class="mono dismiss" onclick={() => (errors = [])}>Dismiss</button>
  </div>
{/if}

<style>
  .add {
    border-style: dashed;
    &.over {
      border-color: var(--color-sun);
      background: #ffd25e14;
    }
  }
  .opening {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 200px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--color-line-2);
    border-top-color: var(--color-sun);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .errors {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid #ff7a6b55;
    background: #ff7a6b12;
    color: var(--color-bad);
    font-size: 14px;
    & ul {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }
  .dismiss {
    flex: none;
    background: none;
    border: 0;
    cursor: pointer;
    color: var(--color-soft);
    text-decoration: underline;
  }
</style>
