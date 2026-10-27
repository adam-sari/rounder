<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import PdfPasswordPrompt from '@/components/tool/PdfPasswordPrompt.svelte';
  import { getText, getThumbnail, isAbort, openPdf, PdfPasswordError, textToString, type PdfDoc } from '@/engines/pdf';
  import { closeCompare, compareTextsOff } from '@/tools/lib/compare-pdf/client';
  import { examplePdfs } from '@/tools/lib/compare-pdf/example';
  import { pairKey } from '@/tools/lib/compare-pdf/render';
  import { reportHtml, reportName, reportText } from '@/tools/lib/compare-pdf/report';
  import type { Granularity, Pairing, TextComparison } from '@/tools/lib/compare-pdf/text';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import ComparePdfText from './ComparePdfText.svelte';
  import ComparePdfVisual from './ComparePdfVisual.svelte';

  interface Slot {
    pdf: { file: File; doc: PdfDoc } | null;
    thumb: string;
    opening: string;
    error: string;
    asking: { file: File; wrong: boolean; busy: boolean } | null;
    over: boolean;
    /** the file being opened for this side; a slower, older one is dropped when it arrives */
    want: File | null;
  }

  const LABELS = ['original', 'changed'];
  const blank = (): Slot => ({ pdf: null, thumb: '', opening: '', error: '', asking: null, over: false, want: null });

  let slots = $state([blank(), blank()]);
  let mode = $state<'text' | 'visual'>('text');
  let granularity = $state<Granularity>('words');
  let pairing = $state<Pairing>('content');
  let swaps = $state(0);
  let loadingExample = $state(false);

  let shown = $state.raw<{ result: TextComparison; docs: [PdfDoc, PdfDoc]; textless: string[] } | null>(null);
  let busy = $state(false);
  let failure = $state('');
  /** pages whose text has been read, per document id */
  const read = new SvelteMap<string, number>();
  /** visible share of changed pixels per page pair, filled in by the visual scan */
  const scores = new SvelteMap<string, number>();
  const texts = new Map<string, Promise<string[]>>();
  const pickers: HTMLInputElement[] = [];
  let seq = 0;

  const docs = $derived(slots[0].pdf && slots[1].pdf ? ([slots[0].pdf.doc, slots[1].pdf.doc] as [PdfDoc, PdfDoc]) : null);
  const reading = $derived.by(() => {
    if (!docs) return null;
    const total = docs[0].numPages + docs[1].numPages;
    const done = (read.get(docs[0].id) ?? 0) + (read.get(docs[1].id) ?? 0);
    return done < total ? { done, total } : null;
  });

  // text is read once per document, a few pages at a time (pdf.js parses in its own worker)
  function textsOf(doc: PdfDoc) {
    let p = texts.get(doc.id);
    if (!p) {
      p = (async () => {
        const out: string[] = new Array(doc.numPages);
        let next = 0;
        const reader = async () => {
          while (next < doc.numPages) {
            const i = next++;
            try {
              out[i] = textToString((await getText(doc, i)).items);
            } catch {
              throw new Error(`The text on page ${i + 1} of ${doc.name || 'a PDF'} couldn’t be read. The file may be damaged.`);
            }
            read.set(doc.id, (read.get(doc.id) ?? 0) + 1);
          }
        };
        await Promise.all([reader(), reader(), reader(), reader()]);
        return out;
      })();
      texts.set(doc.id, p);
      p.catch(() => {
        texts.delete(doc.id);
        read.delete(doc.id);
      });
    }
    return p;
  }

  $effect(() => {
    const pair = docs;
    const options = { granularity, pairing };
    const id = ++seq;
    untrack(() => {
      if (!pair || shown?.docs[0] !== pair[0] || shown?.docs[1] !== pair[1]) shown = null;
      failure = '';
    });
    if (!pair) {
      busy = false;
      return;
    }
    busy = true;
    Promise.all(pair.map(textsOf))
      .then(async ([a, b]) => {
        if (id !== seq) return;
        const result = await compareTextsOff(a, b, options);
        if (id !== seq) return;
        const textless = pair.filter((_, i) => ![a, b][i].some((t) => t.trim())).map((d) => d.name);
        shown = { result, docs: pair, textless };
      })
      .catch((e: Error) => {
        if (id === seq && !isAbort(e)) failure = e.message || 'Comparing failed.';
      })
      .finally(() => id === seq && (busy = false));
  });

  const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  function take(i: number, files: File[]) {
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) {
      if (files.length) slots[i].error = `${files[0].name} isn’t a PDF.`;
      return;
    }
    const [first, second] = pdfs;
    void open(i, first);
    // two files dropped at once fill both sides
    if (second) void open(1 - i, second);
  }

  async function open(i: number, file: File, password?: string) {
    const slot = slots[i];
    slot.error = '';
    slot.want = file;
    if (slot.asking) slot.asking.busy = true;
    else slot.opening = file.name;
    try {
      const doc = await openPdf(file, { password });
      // another file may have been chosen for this side meanwhile, or this one removed
      if (slot.want !== file) return void doc.destroy();
      set(slot, { file, doc });
    } catch (e) {
      if (slot.want !== file) return;
      slot.opening = '';
      if (e instanceof PdfPasswordError) slot.asking = { file, wrong: e.reason === 'wrongPassword', busy: false };
      else {
        slot.asking = null;
        slot.error = `${file.name}: ${(e as Error).message}`;
      }
    }
  }

  function set(slot: Slot, pdf: Slot['pdf']) {
    const old = slot.pdf?.doc;
    Object.assign(slot, { ...blank(), pdf });
    if (old) forget(old);
    if (!pdf) return;
    getThumbnail(pdf.doc, 0, { width: 160 * Math.min(2, devicePixelRatio) })
      .then((t) => slot.pdf?.doc === pdf.doc && (slot.thumb = t.url))
      .catch(() => {});
  }

  function forget(doc: PdfDoc) {
    texts.delete(doc.id);
    read.delete(doc.id);
    for (const key of scores.keys()) if (key.includes(`${doc.id}:`)) scores.delete(key);
    void doc.destroy();
  }

  /** where a file dropped outside the cards (or pasted) goes: the first empty side, else the changed one */
  function free() {
    const k = slots.findIndex((s) => !s.pdf && !s.opening && !s.asking);
    return k < 0 ? 1 : k;
  }

  function swap() {
    slots.reverse();
    swaps++;
  }

  async function example() {
    loadingExample = true;
    try {
      const files = await examplePdfs();
      files.forEach((f, i) => void open(i, f));
    } catch (e) {
      slots[0].error = (e as Error).message;
    } finally {
      loadingExample = false;
    }
  }

  function download(ext: 'txt' | 'html') {
    if (!shown) return;
    const [A, B] = shown.docs;
    const input = {
      nameA: A.name,
      nameB: B.name,
      pagesA: A.numPages,
      pagesB: B.numPages,
      text: shown.result,
      visual: shown.result.pairs.map((p) => {
        const share = scores.get(pairKey(shown!.docs, p));
        // NaN: the page couldn't be drawn, so there's nothing to report
        return Number.isNaN(share) ? undefined : share;
      }),
      date: new Date(),
    };
    const blob = ext === 'txt' ? new Blob([reportText(input)], { type: 'text/plain;charset=utf-8' }) : new Blob([reportHtml(input)], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, reportName(A.name, B.name, ext));
  }

  onDestroy(() => {
    seq++;
    closeCompare();
    for (const s of slots) {
      s.want = null; // a file still opening is destroyed when it arrives
      if (s.pdf) void s.pdf.doc.destroy();
    }
  });
</script>

{#snippet slotCard(slot: Slot, i: number)}
  <div
    class="slot"
    class:over={slot.over}
    role="group"
    aria-label="{LABELS[i]} PDF"
    ondragover={(e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      slot.over = true;
    }}
    ondragleave={() => (slot.over = false)}
    ondrop={(e) => {
      slot.over = false;
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      take(i, Array.from(e.dataTransfer.files));
    }}
  >
    <p class="label flex items-center gap-2"><span class="dot dot-{i}" aria-hidden="true"></span>{LABELS[i]}</p>
    {#if slot.asking}
      <PdfPasswordPrompt
        fileName={slot.asking.file.name}
        wrong={slot.asking.wrong}
        busy={slot.asking.busy}
        onsubmit={(pw) => slot.asking && open(i, slot.asking.file, pw)}
        oncancel={() => Object.assign(slot, { asking: null, want: null })}
      />
    {:else if slot.opening}
      <div class="pick" role="status"><span class="spinner" aria-hidden="true"></span><span class="mono truncate">Opening {slot.opening}…</span></div>
    {:else if slot.pdf}
      {#key slot.pdf.doc}
        <div class="loaded">
          <div class="thumb">
            {#if slot.thumb}<img src={slot.thumb} alt="First page of {slot.pdf.file.name}" />{/if}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium" title={slot.pdf.file.name}>{slot.pdf.file.name}</p>
            <p class="mono">{slot.pdf.doc.numPages.toLocaleString()} page{slot.pdf.doc.numPages === 1 ? '' : 's'} · {formatBytes(slot.pdf.file.size)}</p>
            <div class="mt-3 flex gap-1.5">
              <button type="button" class="mini" onclick={() => pickers[i].click()}>replace</button>
              <button type="button" class="mini" onclick={() => set(slot, null)}>remove</button>
            </div>
          </div>
        </div>
      {/key}
    {:else}
      <button type="button" class="pick" onclick={() => pickers[i].click()}>
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path d="M9 4h10l7 7v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M19 4v7h7M16 15v8M12 19h8" /></svg>
        <span class="font-serif text-2xl leading-tight">{i ? 'Changed PDF' : 'Original PDF'}</span>
        <span class="mono">drop it here or click to choose</span>
      </button>
    {/if}
    {#if slot.error}<p class="mt-2 text-sm text-bad" role="alert">{slot.error}</p>{/if}
    <input
      bind:this={pickers[i]}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      onchange={(e) => {
        take(i, Array.from(e.currentTarget.files ?? []));
        e.currentTarget.value = '';
      }}
    />
  </div>
{/snippet}

<svelte:window
  onpaste={(e) => {
    if (e.clipboardData?.files.length) take(free(), Array.from(e.clipboardData.files));
  }}
/>

<!-- a PDF dropped anywhere on the tool is taken here, rather than the browser navigating away to it -->
<div
  class="grid gap-5"
  role="presentation"
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  }}
  ondrop={(e) => {
    if (e.defaultPrevented || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    take(free(), Array.from(e.dataTransfer.files));
  }}
>
  <div class="slots">
    {@render slotCard(slots[0], 0)}
    <button type="button" class="swap" onclick={swap} disabled={!slots[0].pdf && !slots[1].pdf} aria-label="Swap original and changed" title="Swap sides">
      <span style="--turns: {swaps}" aria-hidden="true">⇄</span>
    </button>
    {@render slotCard(slots[1], 1)}
  </div>

  {#if docs}
    <div class="toolbar">
      <div class="seg modes" role="group" aria-label="Compare">
        <button type="button" aria-pressed={mode === 'text'} onclick={() => (mode = 'text')}>Text changes</button>
        <button type="button" aria-pressed={mode === 'visual'} onclick={() => (mode = 'visual')}>Visual changes</button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="mono">match pages</span>
        <div class="seg" role="group" aria-label="Match pages">
          <button type="button" aria-pressed={pairing === 'content'} onclick={() => (pairing = 'content')} title="Finds inserted and removed pages">by content</button>
          <button type="button" aria-pressed={pairing === 'number'} onclick={() => (pairing = 'number')} title="Page 1 with page 1, 2 with 2…">by number</button>
        </div>
      </div>
      {#if shown}
        <div class="ml-auto flex items-center gap-2">
          <span class="mono">report</span>
          <button type="button" class="btn px-3! py-2! text-sm!" onclick={() => download('txt')} aria-label="Download the report as plain text">.txt</button>
          <button type="button" class="btn px-3! py-2! text-sm!" onclick={() => download('html')} aria-label="Download the report as a web page">.html</button>
        </div>
      {/if}
    </div>

    {#if failure}
      <p class="text-bad" role="alert">{failure}</p>
    {:else if !shown}
      <div class="waiting" role="status">
        {#if reading}
          <p class="mono">Reading text · page {reading.done.toLocaleString()} of {reading.total.toLocaleString()}</p>
          <div class="bar"><span style="width: {(reading.done / reading.total) * 100}%"></span></div>
        {:else}
          <p class="mono animate-pulse">Comparing…</p>
        {/if}
      </div>
    {:else if mode === 'text'}
      <ComparePdfText result={shown.result} {busy} bind:granularity textless={shown.textless} onvisual={() => (mode = 'visual')} />
    {:else}
      <ComparePdfVisual docs={shown.docs} pairs={shown.result.pairs} {scores} />
    {/if}
  {:else}
    <div class="empty">
      <p class="font-serif text-3xl">Find what changed</p>
      <p class="mono max-w-md text-center">Add the original PDF and the changed one. You'll see every edited word, plus a visual check for changes in images and layout.</p>
      <button type="button" class="btn mt-2 px-3.5! py-2.5! text-sm!" onclick={example} disabled={loadingExample}>{loadingExample ? 'Making example…' : 'Try an example'}</button>
      <p class="mono mt-2 text-ok">● processed on your device · nothing is uploaded</p>
    </div>
  {/if}
</div>

<style>
  .slots {
    display: grid;
    gap: 10px;
    align-items: stretch;
    @media (min-width: 768px) {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    }
  }
  .slot {
    min-width: 0;
    padding: 14px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel);
    transition: border-color 0.2s, background-color 0.2s;
    &.over {
      border-color: var(--color-sun);
      background: #ffd25e0d;
    }
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 99px;
  }
  .dot-0 {
    background: #e23b30;
  }
  .dot-1 {
    background: #2468f2;
  }
  .pick {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 6px;
    width: 100%;
    min-height: 148px;
    padding: 16px;
    color: var(--color-chalk);
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede406 14px 15px);
    border: 1.5px dashed var(--color-line-2);
    border-radius: 14px;
    text-align: center;
    &:is(button) {
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
      &:hover {
        border-color: var(--color-sun);
      }
    }
    & svg {
      fill: none;
      stroke: var(--color-sun);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
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
    to {
      transform: rotate(360deg);
    }
  }
  .loaded {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 148px;
    animation: rise 0.4s var(--ease-spring);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .thumb {
    flex: none;
    width: 84px;
    height: 116px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    overflow: hidden;
    & img {
      max-width: 100%;
      max-height: 100%;
      background: #fff;
      animation: fade 0.3s ease-out;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .mini {
    font: 400 12px var(--font-mono);
    color: var(--color-muted);
    padding: 4px 9px;
    border: 1px solid var(--color-line-2);
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .swap {
    align-self: center;
    justify-self: center;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    font-size: 17px;
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 99px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:hover:not(:disabled) {
      border-color: var(--color-sun);
      color: var(--color-sun);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    & span {
      display: inline-block;
      transform: rotate(calc(var(--turns) * 180deg));
      transition: transform 0.45s var(--ease-spring);
      @media (max-width: 767px) {
        rotate: 90deg;
      }
    }
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }
  .modes button {
    font-size: 14px;
    padding: 10px 16px;
  }
  .waiting,
  .empty {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 10px;
    min-height: 220px;
    padding: 40px 20px;
    text-align: center;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .empty {
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px);
  }
  .bar {
    width: min(320px, 100%);
    height: 4px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.2s;
    }
  }
</style>
