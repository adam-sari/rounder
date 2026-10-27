<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { ALGOS, parseExpected, type Algo } from '@/tools/lib/checksum-calculator/algorithms';
  import { hashFile } from '@/tools/lib/checksum-calculator/client';
  import { formatBytes } from '@/tools/lib/files';

  interface Entry {
    id: number;
    file: File;
    hashes: Partial<Record<Algo, string>>;
    progress: Partial<Record<Algo, number>>;
    seconds?: number;
    error?: string;
  }

  let entries = $state<Entry[]>([]);
  let selected = $state<Record<Algo, boolean>>({ MD5: true, 'SHA-1': true, 'SHA-256': true, 'SHA-384': false, 'SHA-512': true, CRC32: false });
  let upper = $state(false);
  let expectedText = $state('');
  let more = $state<HTMLInputElement>();
  let nextId = 0;
  let running: { id: number; controller: AbortController } | null = null;

  const wanted = $derived(ALGOS.filter((a) => selected[a]));
  const expected = $derived(parseExpected(expectedText));

  const verdict = $derived.by(() => {
    if (!expected || entries.every((e) => e.error)) return null;
    const hit = entries.find((e) => e.hashes[expected.algo] === expected.hex);
    if (hit) return { match: true, name: hit.file.name } as const;
    const pending = entries.some((e) => !e.error && e.hashes[expected.algo] === undefined);
    return pending ? null : ({ match: false } as const);
  });

  /** Hashes one file at a time, all of its missing algorithms in parallel */
  async function pump() {
    if (running) return;
    const entry = entries.find((e) => !e.error && wanted.some((a) => e.hashes[a] === undefined));
    if (!entry) return;
    const algos = wanted.filter((a) => entry.hashes[a] === undefined);
    const controller = new AbortController();
    running = { id: entry.id, controller };
    const started = performance.now();
    try {
      await Promise.all(
        algos.map(async (algo) => {
          entry.progress[algo] = 0;
          entry.hashes[algo] = await hashFile(entry.file, algo, (p) => (entry.progress[algo] = p), controller.signal);
        }),
      );
      entry.seconds = (performance.now() - started) / 1000;
    } catch (err) {
      controller.abort();
      if ((err as Error).name !== 'AbortError') {
        entry.error = 'Could not read this file. It may have been moved or deleted since you added it.';
      }
    }
    running = null;
    pump();
  }

  function add(files: File[]) {
    entries.push(...files.map((file) => ({ id: nextId++, file, hashes: {}, progress: {} })));
    pump();
  }

  function remove(id: number) {
    if (running?.id === id) running.controller.abort();
    entries = entries.filter((e) => e.id !== id);
  }

  function clearAll() {
    running?.controller.abort();
    entries = [];
  }

  function toggle(algo: Algo) {
    selected[algo] = !selected[algo];
    pump();
  }

  // pasting a SHA-384 when SHA-384 is off switches it on, so the check can complete
  $effect(() => {
    const algo = expected?.algo;
    if (algo && !selected[algo]) {
      selected[algo] = true;
      untrack(pump);
    }
  });

  onDestroy(() => running?.controller.abort());

  const show = (hex: string) => (upper ? hex.toUpperCase() : hex);
  const overall = (e: Entry) => {
    const parts = wanted.map((a) => (e.hashes[a] !== undefined ? 1 : (e.progress[a] ?? 0)));
    return parts.length ? parts.reduce((s, p) => s + p, 0) / parts.length : 1;
  };
</script>

<div class="grid gap-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <span class="label">algorithms</span>
      <div class="seg" role="group" aria-label="Algorithms">
        {#each ALGOS as algo}
          <button type="button" aria-pressed={selected[algo]} onclick={() => toggle(algo)}>{algo}</button>
        {/each}
      </div>
    </div>
    <div class="seg" role="group" aria-label="Letter case">
      <button type="button" aria-pressed={!upper} onclick={() => (upper = false)}>abc</button>
      <button type="button" aria-pressed={upper} onclick={() => (upper = true)}>ABC</button>
    </div>
  </div>

  {#if !wanted.length}
    <p class="mono -mt-2">Pick at least one algorithm.</p>
  {/if}

  {#if !entries.length}
    <Dropzone multiple title="Drop files to checksum" hint="any type, any size · or click to choose" onfiles={add} />
  {:else}
    <ul class="grid gap-3">
      {#each entries as entry (entry.id)}
        {@const done = overall(entry)}
        <li class="rounded-2xl border border-line-2 bg-[#141312] p-3 sm:p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium" title={entry.file.name}>{entry.file.name}</p>
              <p class="mono">
                {formatBytes(entry.file.size)}
                {#if entry.error}
                  · <span class="text-bad">failed</span>
                {:else if done < 1}
                  · hashing {Math.floor(done * 100)}%
                {:else if entry.seconds !== undefined}
                  · done in {entry.seconds < 1 ? '<1' : entry.seconds.toFixed(1)} s
                {/if}
              </p>
            </div>
            <button type="button" class="btn px-3! py-1.5!" aria-label={`Remove ${entry.file.name}`} onclick={() => remove(entry.id)}>✕</button>
          </div>

          {#if entry.error}
            <p class="mt-3 text-sm text-bad" role="alert">{entry.error}</p>
          {:else}
            <div class="mt-3 grid gap-2">
              {#each wanted as algo (algo)}
                {@const hex = entry.hashes[algo]}
                {@const hit = hex !== undefined && expected?.algo === algo && expected.hex === hex}
                <div class="row grid items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 sm:grid-cols-[72px_1fr_auto] {hit ? 'hit border-ok' : 'border-line-2'}">
                  <span class="mono {hit ? 'text-ok!' : ''}">{algo}{hit ? ' ✓' : ''}</span>
                  {#if hex !== undefined}
                    <code class="font-mono text-[13px] break-all">{show(hex)}</code>
                    <CopyButton text={() => show(hex)} class="justify-self-start py-1.5! sm:justify-self-auto" />
                  {:else}
                    <span class="bar" aria-label={`${algo} progress`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((entry.progress[algo] ?? 0) * 100)}>
                      <span style:width={`${(entry.progress[algo] ?? 0) * 100}%`}></span>
                    </span>
                    <span class="mono hidden sm:block">{entry.progress[algo] === undefined ? 'queued' : `${Math.floor((entry.progress[algo] ?? 0) * 100)}%`}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn" onclick={() => more?.click()}>+ Add files</button>
      <button type="button" class="btn" onclick={clearAll}>Clear all</button>
    </div>
    <input
      bind:this={more}
      type="file"
      multiple
      hidden
      onchange={(e) => {
        add(Array.from(e.currentTarget.files ?? []));
        e.currentTarget.value = '';
      }}
    />
  {/if}

  <label class="block">
    <span class="label">verify · paste the checksum from the download page</span>
    <input class="field font-mono" bind:value={expectedText} spellcheck="false" autocomplete="off" placeholder="e.g. 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" />
  </label>
  <div role="status" aria-live="polite" class="-mt-2 text-sm">
    {#if expectedText.trim() && !expected}
      <p class="text-muted">That doesn't look like an MD5, SHA or CRC32 checksum. Check that you copied all of it.</p>
    {:else if expected && verdict?.match}
      <p class="verdict text-ok">✓ Match. {verdict.name} has exactly this {expected.algo} checksum, so it arrived intact.</p>
    {:else if expected && verdict}
      <p class="verdict text-bad">✕ No match. The {expected.algo} of {entries.length === 1 ? 'this file' : 'these files'} is different, so the file is damaged, incomplete or not the one the checksum was made for.</p>
    {:else if expected}
      <p class="text-muted">Looks like a {expected.algo} checksum.{entries.some((e) => !e.error) ? ' Checking…' : ' Now drop the file to compare.'}</p>
    {/if}
  </div>
</div>

<style>
  .bar {
    display: block;
    height: 6px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--color-sun);
    border-radius: inherit;
    transition: width 0.25s;
  }
  .row.hit {
    animation: glow 1.2s ease-out;
  }
  .verdict {
    animation: rise 0.35s var(--ease-spring);
  }
  @keyframes glow {
    from { box-shadow: 0 0 0 6px #9be58f40; }
    to { box-shadow: 0 0 0 0 #9be58f00; }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(4px); }
  }
</style>
