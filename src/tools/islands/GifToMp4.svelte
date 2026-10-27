<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { capabilities, downloadName, formatBytes, gifToVideo, type Capabilities, type QualityLevel } from '@/engines/media';
  import { isGif } from '@/engines/media/gif';
  import { downloadBlob, zipFiles } from '@/tools/lib/files';
  import { describeSaving, gifStats, playsFor, REPEATS, savedPercent, type GifStats } from '@/tools/lib/gif-to-mp4/gif';
  import { eta, formatDuration } from '@/tools/lib/video-to-gif/plan';
  import { friendlyError } from '@/tools/lib/video-to-gif/errors';

  type Target = 'mp4' | 'webm';
  interface Output {
    blob: Blob;
    url: string;
    name: string;
    seconds: number;
    key: string;
  }
  interface Item {
    id: number;
    file: File;
    url: string;
    stats: GifStats | null;
    status: 'ready' | 'working' | 'done' | 'error';
    progress: number;
    out?: Output;
    error?: string;
  }

  const backgrounds: [string, string][] = [['#000000', 'black'], ['#ffffff', 'white']];
  const qualities: [QualityLevel, string][] = [['medium', 'smaller'], ['high', 'balanced'], ['very-high', 'sharpest']];

  let items = $state<Item[]>([]);
  let target = $state<Target>('mp4');
  let repeat = $state(1);
  let background = $state('#000000');
  let quality = $state<QualityLevel>('high');
  let caps = $state.raw<Capabilities | null>(null);
  let capsFailed = $state(false);
  let selected = $state<number | null>(null);

  let running = $state(false);
  let queued = $state(0);
  let finished = $state(0);
  let startedAt = $state(0);
  let now = $state(0);
  let zipping = $state(false);
  let picker = $state<HTMLInputElement>();
  /** aborts the GIF being converted; `stopped` also ends the batch */
  let controller: AbortController | null = null;
  let stopped = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let nextId = 0;

  const key = $derived(JSON.stringify([target, repeat, background, quality]));
  const todo = $derived(items.filter((i) => i.stats && i.out?.key !== key));
  const done = $derived(items.filter((i): i is Item & { out: Output } => !!i.out && i.out.key === key));
  const current = $derived(items.find((i) => i.status === 'working'));
  const overall = $derived(queued ? (finished + (current?.progress ?? 0)) / queued : 0);
  const elapsed = $derived(Math.max(0, now - startedAt));
  const remaining = $derived(eta(overall, elapsed));
  const before = $derived(done.reduce((s, i) => s + i.file.size, 0));
  const after = $derived(done.reduce((s, i) => s + i.out.blob.size, 0));
  const shown = $derived(items.find((i) => i.id === selected) ?? null);

  const targets = $derived<{ id: Target; label: string; reason: string }[]>(
    (['mp4', 'webm'] as const).map((id) => ({
      id,
      label: id === 'mp4' ? 'MP4' : 'WebM',
      reason: capsFailed ? "Your browser can't encode video" : !caps ? 'Checking your browser…' : caps.containers[id] ? '' : `Your browser can't encode ${id === 'mp4' ? 'MP4' : 'WebM'}`,
    })),
  );
  const blocked = $derived(targets.find((t) => t.id === target)?.reason ?? '');

  onMount(() => {
    capabilities().then(
      (c) => {
        caps = c;
        if (!c.containers.mp4 && c.containers.webm) target = 'webm';
      },
      () => (capsFailed = true),
    );
  });

  onDestroy(() => {
    cancel();
    clearInterval(ticker);
    for (const i of items) revoke(i);
  });

  function revoke(i: Item) {
    URL.revokeObjectURL(i.url);
    if (i.out) URL.revokeObjectURL(i.out.url);
  }

  async function add(files: File[]) {
    for (const file of files) {
      const item: Item = { id: nextId++, file, url: URL.createObjectURL(file), stats: null, status: 'ready', progress: 0 };
      try {
        // check the signature first so a stray big video isn't read into memory
        if (!isGif(new Uint8Array(await file.slice(0, 6).arrayBuffer()))) throw new Error('not a GIF');
        item.stats = gifStats(new Uint8Array(await file.arrayBuffer()));
      } catch {
        item.status = 'error';
        item.error = "This doesn't look like a working GIF.";
      }
      items.push(item);
      selected ??= item.id;
    }
  }

  async function convert() {
    if (running || blocked) return;
    const batch = todo.slice();
    const k = key;
    const opts = { container: target, background, quality };
    stopped = false;
    running = true;
    queued = batch.length;
    finished = 0;
    startedAt = now = performance.now();
    ticker = setInterval(() => (now = performance.now()), 500);
    for (const item of batch) {
      // removed GIFs drop out of the count so "n of N" and the percentage stay right
      if (!items.includes(item)) {
        queued--;
        continue;
      }
      item.status = 'working';
      item.progress = 0;
      item.error = undefined;
      controller = new AbortController();
      try {
        const r = await gifToVideo(item.file, { ...opts, repeat: playsFor(item.stats!.durationMs, repeat) }, { signal: controller.signal, onProgress: (p) => (item.progress = p) });
        if (items.includes(item)) {
          if (item.out) URL.revokeObjectURL(item.out.url);
          item.out = { blob: r.blob, url: URL.createObjectURL(r.blob), name: downloadName(item.file.name, opts.container), seconds: r.durationSec, key: k };
          item.status = 'done';
        }
      } catch (e) {
        const msg = friendlyError(e);
        item.status = msg ? 'error' : item.out ? 'done' : 'ready';
        item.error = msg ?? undefined;
        if (stopped) break; // cancelled: leave the rest as they were
      }
      if (items.includes(item)) finished++;
      else queued--;
    }
    running = false;
    queued = 0;
    clearInterval(ticker);
    controller = null;
  }

  function cancel() {
    stopped = true;
    controller?.abort();
  }

  function remove(item: Item) {
    if (item.status === 'working') controller?.abort();
    revoke(item);
    items = items.filter((i) => i !== item);
    if (selected === item.id) selected = items[0]?.id ?? null;
  }

  function startOver() {
    cancel();
    for (const i of items) revoke(i);
    items = [];
    selected = null;
  }

  async function downloadAll() {
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((i) => ({ name: i.out.name, blob: i.out.blob }))), 'rounder-gif-videos.zip');
    } finally {
      zipping = false;
    }
  }

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const label = (t: Target) => (t === 'mp4' ? 'MP4' : 'WebM');
</script>

{#if !items.length}
  <Dropzone accept="image/gif,.gif" multiple title="Drop GIFs to convert" hint="one GIF or a whole batch" onfiles={add} />
{:else}
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div class="grid min-w-0 content-start gap-4">
      {#if shown}
        <section class="compare card" aria-label="Before and after">
          <figure>
            <div class="stage"><img src={shown.url} alt={`Original GIF: ${shown.file.name}`} /></div>
            <figcaption class="mono">GIF · {formatBytes(shown.file.size)}</figcaption>
          </figure>
          <figure>
            <div class="stage">
              {#if shown.out}
                <video src={shown.out.url} autoplay loop muted playsinline controls aria-label={`Converted video: ${shown.out.name}`}></video>
              {:else}
                <span class="mono px-4 text-center">{shown.status === 'working' ? `converting… ${Math.round(shown.progress * 100)}%` : shown.error ? 'not converted' : 'convert to see the video here'}</span>
              {/if}
            </div>
            <figcaption class="mono">
              {#if shown.out}
                {shown.out.name.split('.').pop()?.toUpperCase()} · {formatBytes(shown.out.blob.size)} ·
                <span class={savedPercent(shown.file.size, shown.out.blob.size) > 0 ? 'text-ok' : 'text-bad'}>{describeSaving(shown.file.size, shown.out.blob.size)}</span>
                {#if shown.out.key !== key}<span> · old settings</span>{/if}
              {:else}video{/if}
            </figcaption>
          </figure>
        </section>
      {/if}

      <ul class="list" aria-label="GIFs">
        {#each items as item (item.id)}
          <li class:active={item.id === selected}>
            <button type="button" class="pick" aria-pressed={item.id === selected} onclick={() => (selected = item.id)} aria-label={`Show ${item.file.name}`}>
              <img src={item.url} alt="" loading="lazy" />
            </button>
            <div class="min-w-0">
              <p class="truncate text-sm">{item.file.name}</p>
              {#if item.stats}
                <p class="mono">
                  {item.stats.width} × {item.stats.height} · {item.stats.frames} frames · {seconds(item.stats.durationMs)} · {formatBytes(item.file.size)}
                </p>
              {/if}
              {#if item.status === 'working'}
                <div class="bar mt-2" role="progressbar" aria-label={`Converting ${item.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(item.progress * 100)}>
                  <span style:width="{item.progress * 100}%"></span>
                </div>
              {:else if item.error}
                <p class="text-sm text-bad">{item.error}</p>
              {:else if item.out}
                <p class="mono">
                  → <span class="text-chalk">{formatBytes(item.out.blob.size)}</span> · {item.out.seconds.toFixed(1)} s ·
                  <span class={savedPercent(item.file.size, item.out.blob.size) > 0 ? 'text-ok' : 'text-bad'}>{describeSaving(item.file.size, item.out.blob.size)}</span>
                  {#if item.out.key !== key}· settings changed{/if}
                </p>
              {/if}
            </div>
            <div class="flex items-center gap-1">
              {#if item.out}
                <button type="button" class="icon" title="Download" aria-label={`Download ${item.out.name}`} onclick={() => item.out && downloadBlob(item.out.blob, item.out.name)}>↓</button>
              {/if}
              <button type="button" class="icon" title="Remove" aria-label={`Remove ${item.file.name}`} onclick={() => remove(item)}>✕</button>
            </div>
          </li>
        {/each}
      </ul>
      <div>
        <button type="button" class="btn" onclick={() => picker?.click()}>Add more GIFs</button>
        <input
          bind:this={picker}
          type="file"
          accept="image/gif,.gif"
          multiple
          class="hidden"
          onchange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length) add(files);
          }}
        />
      </div>
    </div>

    <aside class="grid content-start gap-5">
      <fieldset class="grid gap-5" disabled={running}>
        <div>
          <span class="label">convert to</span>
          <div class="seg" role="group" aria-label="Output format">
            {#each targets as t}
              <button type="button" aria-pressed={target === t.id} disabled={!!t.reason} title={t.reason || undefined} onclick={() => (target = t.id)}>{t.label}</button>
            {/each}
          </div>
          <p class="mono mt-2">{target === 'mp4' ? 'H.264: plays on every phone, browser and app' : 'VP9: smaller, plays in browsers and Android'}</p>
          {#each targets.filter((t) => t.reason && (caps || capsFailed)) as t}<p class="mono mt-1">{t.reason}</p>{/each}
        </div>

        <div>
          <span class="label">play the GIF</span>
          <div class="seg" role="group" aria-label="Times the GIF plays in the video">
            {#each REPEATS as [n, text]}<button type="button" aria-pressed={repeat === n} onclick={() => (repeat = n)}>{text}</button>{/each}
          </div>
          <p class="mono mt-2">{repeat === 0 ? 'repeats short GIFs until the video lasts at least 3 seconds' : repeat === 1 ? 'once; most players can loop it' : `${repeat} times in a row inside the video`}</p>
        </div>

        <div>
          <span class="label">background for transparent areas</span>
          <div class="flex flex-wrap items-center gap-2">
            {#each backgrounds as [color, name]}
              <button type="button" class="swatch" style:background={color} aria-pressed={background === color} aria-label={name} title={name} onclick={() => (background = color)}></button>
            {/each}
            <label class="swatch custom" class:on={!backgrounds.some(([c]) => c === background)} title="Pick a color">
              <input type="color" bind:value={background} aria-label="Custom background color" />
            </label>
            <span class="mono">{background}</span>
          </div>
          <p class="mono mt-2">videos can't be see-through, so these pixels get a solid color</p>
        </div>

        <div>
          <span class="label">quality</span>
          <div class="seg" role="group" aria-label="Quality">
            {#each qualities as [q, text]}<button type="button" aria-pressed={quality === q} onclick={() => (quality = q)}>{text}</button>{/each}
          </div>
        </div>
      </fieldset>

      <div class="grid gap-3 border-t border-line pt-5">
        {#if running}
          <div class="grid gap-2" aria-live="polite">
            <div class="flex items-baseline justify-between">
              <span class="font-serif text-3xl">{Math.round(overall * 100)}%</span>
              <span class="mono">{Math.min(finished + 1, queued)} of {queued}</span>
            </div>
            <div class="bar" role="progressbar" aria-label="Overall progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(overall * 100)}>
              <span style:width="{overall * 100}%"></span>
            </div>
            <p class="mono">{formatDuration(elapsed / 1000)} elapsed{remaining !== null ? ` · about ${formatDuration(remaining)} left` : ''}</p>
            <button type="button" class="btn" onclick={cancel}>Cancel</button>
          </div>
        {:else if todo.length}
          <button type="button" class="btn btn-primary" disabled={!!blocked} onclick={convert}>
            Convert {todo.length === 1 ? '1 GIF' : `${todo.length} GIFs`} to {label(target)}
          </button>
          {#if blocked && (caps || capsFailed)}<p class="mono">{blocked}</p>{/if}
        {/if}

        {#if done.length && !running}
          <div class="saved" role="status">
            <span class="tick" aria-hidden="true">✓</span>
            <p>
              <span class="font-serif text-2xl">{describeSaving(before, after)}</span>
              <span class="mono block">{formatBytes(before)} of GIFs → {formatBytes(after)} of video</span>
            </p>
          </div>
          {#if done.length > 1}
            <button type="button" class="btn btn-primary" disabled={zipping} onclick={downloadAll}>{zipping ? 'Zipping…' : `Download all ${done.length} (zip)`}</button>
          {:else}
            <button type="button" class="btn btn-primary" onclick={() => downloadBlob(done[0].out.blob, done[0].out.name)}>Download {done[0].out.name}</button>
          {/if}
        {/if}
        <button type="button" class="btn" onclick={startOver}>Start over</button>
      </div>
    </aside>
  </div>
{/if}

<style>
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    & figure {
      display: grid;
      gap: 6px;
      margin: 0;
      min-width: 0;
    }
  }
  @media (max-width: 520px) {
    .compare {
      grid-template-columns: 1fr;
    }
  }
  .stage {
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    border-radius: 12px;
    overflow: hidden;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 16px 16px;
    & img,
    & video {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  }
  .list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    & li {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 8px 10px 8px 8px;
      border: 1px solid var(--color-line-2);
      border-radius: 14px;
      background: var(--color-panel);
      transition: border-color 0.2s;
    }
    & li.active {
      border-color: var(--color-sun);
    }
  }
  .pick {
    width: 56px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 10px 10px;
    & img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  .icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: var(--color-panel-2);
    color: var(--color-soft);
    cursor: pointer;
    &:hover {
      color: var(--color-chalk);
      border-color: var(--color-muted);
    }
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #ffd25e, #ffb23e);
      border-radius: inherit;
      transition: width 0.3s ease-out;
    }
  }
  .swatch {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--color-line-2);
    cursor: pointer;
    &[aria-pressed='true'],
    &.on {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .custom {
    overflow: hidden;
    background: conic-gradient(#ff6b4a, #ffd25e, #9be58f, #7cc4ff, #c8a6ff, #ff6b4a);
    & input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    &:focus-within {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
  }
  .saved {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tick {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-ok);
    color: var(--color-bg);
    font-weight: 700;
    animation: pop 0.45s var(--ease-spring);
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
</style>
