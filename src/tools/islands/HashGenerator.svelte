<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';

  const ALGOS = ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'] as const;

  let text = $state('');
  let file = $state<File | null>(null);
  let hashes = $state<Record<string, string>>({});
  let busy = $state(false);
  let expected = $state('');

  const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

  async function compute(data: BufferSource) {
    const out: Record<string, string> = {};
    for (const a of ALGOS) out[a] = hex(await crypto.subtle.digest(a, data));
    return out;
  }

  $effect(() => {
    const source = file;
    const value = text;
    let cancelled = false;
    busy = true;
    (async () => {
      const data = source ? await source.arrayBuffer() : new TextEncoder().encode(value);
      const out = await compute(data);
      if (!cancelled) {
        hashes = out;
        busy = false;
      }
    })();
    return () => (cancelled = true);
  });

  const match = $derived.by(() => {
    const e = expected.trim().toLowerCase();
    if (!e) return null;
    return Object.entries(hashes).find(([, h]) => h === e)?.[0] ?? false;
  });
</script>

<div class="grid gap-4">
  <div class="grid gap-4 md:grid-cols-2">
    {#if file}
      <div class="field flex items-center justify-between gap-3">
        <span class="truncate">📄 {file.name} <span class="mono">{(file.size / 1024 / 1024).toFixed(2)} MB</span></span>
        <button type="button" class="btn py-1.5!" onclick={() => (file = null)}>Clear</button>
      </div>
    {:else}
      <label>
        <span class="label">text</span>
        <textarea class="field min-h-[160px]!" bind:value={text} spellcheck="false" placeholder="Type text to hash…"></textarea>
      </label>
    {/if}
    {#if !file}
      <Dropzone title="…or drop a file" hint="hash any file, any size your browser can hold" paste={false} onfiles={([f]) => (file = f)} />
    {/if}
  </div>

  <div class="grid gap-2" aria-busy={busy}>
    {#each ALGOS as a}
      <div class="grid items-center gap-2 rounded-xl border px-3 py-2 sm:grid-cols-[90px_1fr_auto] {match === a ? 'border-ok' : 'border-line-2'}">
        <span class="mono">{a}</span>
        <code class="font-mono text-sm break-all">{hashes[a] ?? '…'}</code>
        <CopyButton text={() => hashes[a] ?? ''} class="py-1.5!" />
      </div>
    {/each}
  </div>

  <label>
    <span class="label">verify a checksum (paste the expected hash)</span>
    <input class="field font-mono" bind:value={expected} spellcheck="false" />
  </label>
  {#if match}
    <p class="text-ok" role="status">✓ Match: this is the {match} hash.</p>
  {:else if match === false}
    <p class="text-bad" role="status">✕ No match. The file or text differs from the one the checksum was made from.</p>
  {/if}
</div>
