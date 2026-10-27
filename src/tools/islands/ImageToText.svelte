<script lang="ts">
  import { untrack } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { toAiError } from '@/engines/ai/errors';
  import { downloadBlob, withExtension } from '@/tools/lib/files';
  import type { OcrEngine } from '@/tools/lib/ocr/engine';
  import { languageNames } from '@/tools/lib/ocr/languages';
  import { joinLines, LOW_CONFIDENCE, meanConfidence, pageText, pageWords, type OcrWord } from '@/tools/lib/ocr/text';
  import OcrSetup from './OcrSetup.svelte';

  interface Item {
    id: number;
    file: File;
    status: 'queued' | 'reading' | 'done' | 'failed' | 'stopped';
    progress: number;
    preview?: string;
    width?: number;
    height?: number;
    /** what Tesseract read, and the (editable) text shown */
    raw?: string;
    text?: string;
    words?: OcrWord[];
    confidence?: number | null;
    langs?: string;
    error?: string;
  }

  const ACCEPT = 'image/*,.heic,.heif,.avif,.tif,.tiff';

  let engine = $state<OcrEngine | null>(null);
  let items = $state<Item[]>([]);
  let selectedId = $state<number | null>(null);
  let boxes = $state(true);
  let hover = $state<number | null>(null);
  let nextId = 0;
  let busy = false;
  let ctl: AbortController | null = null;
  let adder = $state<HTMLInputElement>();

  const current = $derived(items.find((i) => i.id === selectedId) ?? items[0]);
  const done = $derived(items.filter((i) => i.status === 'done'));
  const working = $derived(items.some((i) => i.status === 'queued' || i.status === 'reading'));
  const word = $derived(hover !== null ? current?.words?.[hover] : undefined);
  const wordCount = (t: string) => (t.match(/\S+/g) ?? []).length;

  function add(files: File[]) {
    const fresh = files.map((file) => ({ id: ++nextId, file, status: 'queued' as const, progress: 0 }));
    items.push(...fresh);
    selectedId ??= fresh[0]?.id ?? null;
    void pump();
  }

  // a new or reloaded engine picks up whatever is waiting
  $effect(() => {
    if (engine) untrack(pump);
  });

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      let item: Item | undefined;
      while (engine && (item = items.find((i) => i.status === 'queued'))) await read(item, engine);
    } finally {
      busy = false;
    }
  }

  async function read(item: Item, ocr: OcrEngine) {
    const job = (ctl = new AbortController());
    item.status = 'reading';
    item.progress = 0;
    item.error = undefined;
    try {
      const { prepareImage } = await import('@/tools/lib/ocr/image');
      const { image, scale, preview, width, height } = await prepareImage(item.file);
      // reading again (e.g. with other languages) keeps the preview it already has
      if (item.preview) URL.revokeObjectURL(preview);
      else Object.assign(item, { preview, width, height });
      const page = await ocr.recognize({ image, layout: true, onProgress: (p) => (item.progress = p) }, job.signal);
      const text = pageText(page);
      const words = pageWords(page, scale);
      Object.assign(item, { raw: text, text, words, confidence: meanConfidence(words), langs: ocr.langs, status: 'done', progress: 1 });
    } catch (e) {
      const err = toAiError(e);
      if (err.code === 'aborted') {
        // our Stop button, or the engine reloading for other languages (then it runs again)
        item.status = job.signal.aborted ? 'stopped' : 'queued';
        return;
      }
      console.error(e);
      item.status = 'failed';
      item.error = err.code === 'out-of-memory' ? 'Your device ran out of memory on this image. Try a smaller one, or close other tabs.' : !item.preview ? "This image couldn't be opened. Try saving it as PNG or JPG." : "The text couldn't be read from this image.";
    } finally {
      if (ctl === job) ctl = null;
    }
  }

  function stop() {
    for (const i of items) if (i.status === 'queued') i.status = 'stopped';
    ctl?.abort();
  }

  function again(item: Item) {
    item.status = 'queued';
    void pump();
  }

  function remove(item: Item) {
    if (item.status === 'reading') ctl?.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
    items = items.filter((i) => i !== item);
    if (selectedId === item.id) selectedId = items[0]?.id ?? null;
  }

  function reset() {
    stop();
    for (const i of items) if (i.preview) URL.revokeObjectURL(i.preview);
    items = [];
    selectedId = null;
  }

  $effect(() => () => {
    ctl?.abort();
    for (const i of items) if (i.preview) URL.revokeObjectURL(i.preview);
  });

  const txtName = (item: Item) => withExtension(item.file.name || 'image', 'txt');
  const allText = () => done.map((i) => (done.length > 1 ? `── ${i.file.name} ──\n\n${i.text}` : i.text)).join('\n\n\n');
  const saveTxt = (text: string, name: string) => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
</script>

<OcrSetup bind:engine speed="2–6 seconds per image">
  {#if !items.length}
    <Dropzone accept={ACCEPT} multiple title="Drop images or paste a screenshot" hint="JPG, PNG, WebP, HEIC… or click to choose" onfiles={add} />
  {:else}
    {#if items.length > 1}
      <div class="strip" role="list" aria-label="Your images">
        {#each items as item (item.id)}
          <div class="thumb" class:on={item === current} role="listitem">
            <button type="button" class="pick" onclick={() => ((selectedId = item.id), (hover = null))} aria-pressed={item === current} aria-label={`Show ${item.file.name}`}>
              {#if item.preview}<img src={item.preview} alt="" />{:else}<span class="mono">{item.file.name.slice(0, 3)}</span>{/if}
              <span class={`state ${item.status}`} aria-hidden="true"></span>
            </button>
            <button type="button" class="x" onclick={() => remove(item)} aria-label={`Remove ${item.file.name}`}>×</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if current}
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div class="grid min-w-0 content-start gap-3">
          {#if current.preview && current.width && current.height}
            <!-- sized by width, so tall screenshots keep their shape instead of being squashed to the height cap -->
            <div class="stage" style:aspect-ratio={`${current.width} / ${current.height}`} style:width={`min(100%, calc(72vh * ${current.width / current.height}))`}>
              <img src={current.preview} alt={`Your image ${current.file.name}`} />
              {#if boxes && current.words?.length}
                <svg viewBox={`0 0 ${current.width} ${current.height}`} preserveAspectRatio="none" aria-hidden="true">
                  {#each current.words as w, i (i)}
                    <rect
                      x={w.x}
                      y={w.y}
                      width={w.w}
                      height={w.h}
                      rx={Math.min(w.h * 0.15, 6)}
                      class:low={w.confidence < LOW_CONFIDENCE}
                      class:hot={hover === i}
                      role="presentation"
                      onpointerenter={() => (hover = i)}
                      onpointerleave={() => hover === i && (hover = null)}
                    />
                  {/each}
                </svg>
                {#if word}
                  {@const below = word.y / current.height < 0.15}
                  <!-- under the word near the top edge, where above it would be cut off -->

                  <p
                    class="tip"
                    class:below
                    style:left={`${Math.min(85, Math.max(15, ((word.x + word.w / 2) / current.width) * 100))}%`}
                    style:top={`${((below ? word.y + word.h : word.y) / current.height) * 100}%`}
                    dir="auto"
                  >
                    {word.text}<span class="mono"> · {word.confidence}% sure</span>
                  </p>
                {/if}
              {/if}
              {#if current.status === 'reading'}
                <div class="scan" aria-hidden="true"><span></span></div>
              {/if}
            </div>
          {:else}
            <div class="stage empty"><span class="mono">{current.status === 'failed' ? 'no preview' : 'opening…'}</span></div>
          {/if}
          <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={boxes} class="accent-ai" />
              Show word boxes
            </label>
            <p class="mono legend"><span class="key"></span>read <span class="key low"></span>check these (under {LOW_CONFIDENCE}% sure)</p>
          </div>
        </div>

        <div class="grid min-w-0 content-start gap-3">
          <div class="file">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{current.file.name}</p>
              <p class="mono" aria-live="polite">
                {#if current.status === 'reading'}<span class="text-ai">reading… {pct(current.progress)}</span>
                {:else if current.status === 'queued'}{engine ? 'waiting its turn' : 'waiting for the OCR engine (see above)'}
                {:else if current.status === 'stopped'}stopped
                {:else if current.status === 'failed'}<span class="text-bad">{current.error}</span>
                {:else if current.text !== undefined}
                  {wordCount(current.text).toLocaleString()} words{#if current.confidence != null} · {current.confidence}% average confidence{/if} · {languageNames(current.langs?.split('+') ?? [])}
                {/if}
              </p>
              {#if current.status === 'reading'}
                <div class="track" role="progressbar" aria-label="Reading the image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(current.progress * 100)}>
                  <span style:transform={`scaleX(${current.progress})`}></span>
                </div>
              {/if}
            </div>
            {#if working}
              <button type="button" class="btn px-3! py-2! text-sm!" onclick={stop}>Stop</button>
            {:else if current.status === 'done' || current.status === 'stopped' || current.status === 'failed'}
              <button type="button" class="btn px-3! py-2! text-sm!" disabled={!engine} onclick={() => again(current)} title="Read it again with the languages picked above">Read again</button>
            {/if}
          </div>

          {#if current.status === 'done' && current.text !== undefined}
            {#if !current.raw}
              <p class="note">
                No text found. If there is text, pick its language above and press Read again; very small, blurry or handwritten text often can't be read.
              </p>
            {:else if current.confidence != null && current.confidence < 70}
              <p class="note warn">Low confidence: check the text carefully. A sharper or larger image, or the right language above, usually helps.</p>
            {/if}
            <label>
              <span class="sr-only">Recognized text (you can edit it)</span>
              <textarea class="field output" dir="auto" spellcheck="false" bind:value={current.text}></textarea>
            </label>
            <div class="flex flex-wrap gap-2">
              <CopyButton text={() => current.text ?? ''} label="Copy text" class="btn-primary" />
              <button type="button" class="btn" disabled={!current.text} onclick={() => saveTxt(current.text ?? '', txtName(current))}>Download .txt</button>
              <button type="button" class="btn" disabled={!current.text} onclick={() => (current.text = joinLines(current.text ?? ''))} title="One line per paragraph, mending words split at line ends">
                Join lines
              </button>
              {#if current.text !== current.raw}
                <button type="button" class="btn" onclick={() => (current.text = current.raw)}>Undo edits</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={() => adder?.click()}>Add images</button>
      <input bind:this={adder} type="file" accept={ACCEPT} multiple hidden onchange={(e) => (add([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ''))} />
      {#if done.length > 1}
        <CopyButton text={allText} label={`Copy all (${done.length})`} />
        <button type="button" class="btn" onclick={() => saveTxt(allText(), 'images-text.txt')}>Download all as .txt</button>
      {/if}
      <button type="button" class="btn" onclick={reset}>Start over</button>
      <span class="mono">⌘V pastes a screenshot</span>
    </div>
  {/if}
</OcrSetup>

<svelte:window
  onpaste={(e) => {
    // the drop zone listens itself; once results are showing, pasting adds to the batch
    if (!items.length || !e.clipboardData?.files.length) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('textarea, input')) return;
    add([...e.clipboardData.files].filter((f) => f.type.startsWith('image/')));
  }}
/>

<style>
  .strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 6px;
    margin-bottom: 16px;
  }
  .thumb {
    position: relative;
    flex: none;
    &.on .pick {
      border-color: var(--color-ai);
      box-shadow: 0 0 0 1px var(--color-ai);
    }
  }
  .pick {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: 12px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    overflow: hidden;
    cursor: pointer;
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .state {
    position: absolute;
    left: 6px;
    bottom: 6px;
    width: 9px;
    height: 9px;
    border-radius: 99px;
    border: 2px solid var(--color-bg);
    background: var(--color-muted);
    &.reading {
      background: var(--color-ai);
    }
    &.done {
      background: var(--color-ok);
    }
    &.failed {
      background: var(--color-bad);
    }
  }
  .x {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 22px;
    height: 22px;
    border-radius: 99px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-soft);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .stage {
    position: relative;
    width: 100%;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--color-line);
    background: repeating-conic-gradient(#1d1c1a 0 25%, #171615 0 50%) 0 0 / 18px 18px;
    margin-inline: auto;
    & img,
    & svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    & img {
      object-fit: fill;
    }
    &.empty {
      display: grid;
      place-items: center;
      aspect-ratio: 4 / 3;
    }
  }
  rect {
    fill: color-mix(in srgb, var(--color-ai) 14%, transparent);
    stroke: var(--color-ai);
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
    &.low {
      fill: color-mix(in srgb, var(--color-sun) 20%, transparent);
      stroke: var(--color-sun);
    }
    &.hot {
      fill: color-mix(in srgb, var(--color-ai) 35%, transparent);
      stroke-width: 2;
    }
  }
  .tip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 8px));
    max-width: min(320px, 80%);
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    box-shadow: 0 8px 24px #0008;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    &.below {
      transform: translate(-50%, 8px);
    }
  }
  .scan {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: color-mix(in srgb, var(--color-bg) 25%, transparent);
    & span {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--color-ai);
      box-shadow: 0 0 16px var(--color-ai);
      animation: scan 1.8s ease-in-out infinite alternate;
    }
  }
  @keyframes scan {
    from {
      top: 4%;
    }
    to {
      top: 96%;
    }
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    display: inline-block;
    width: 12px;
    height: 10px;
    border-radius: 3px;
    border: 1.5px solid var(--color-ai);
    background: color-mix(in srgb, var(--color-ai) 14%, transparent);
    &.low {
      margin-left: 6px;
      border-color: var(--color-sun);
      background: color-mix(in srgb, var(--color-sun) 20%, transparent);
    }
  }
  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #141312;
  }
  .track {
    height: 4px;
    margin-top: 8px;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-ai);
      transform-origin: left;
      transition: transform 0.2s ease-out;
    }
  }
  .output {
    min-height: 320px;
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.55;
  }
  .note {
    font-size: 14px;
    color: var(--color-soft);
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-ai) 60%, transparent);
    &.warn {
      border-color: var(--color-sun);
    }
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--color-line);
  }
  .accent-ai {
    accent-color: var(--color-ai);
  }
  @media (prefers-reduced-motion: reduce) {
    .scan span {
      animation: none;
      top: 50%;
    }
  }
</style>
