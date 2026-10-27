<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';

  let version = $state<'v4' | 'v7'>('v4');
  let count = $state(5);
  let upper = $state(false);
  let hyphens = $state(true);
  let ids = $state<string[]>([]);

  const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const format = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

  function v7(): string {
    const b = crypto.getRandomValues(new Uint8Array(16));
    const ms = Date.now();
    // 48-bit big-endian millisecond timestamp
    for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    return format(hex(b));
  }

  function generate() {
    const n = Math.min(Math.max(1, Math.floor(count) || 1), 1000);
    ids = Array.from({ length: n }, () => (version === 'v4' ? crypto.randomUUID() : v7()));
  }

  const shown = $derived(ids.map((id) => {
    const s = hyphens ? id : id.replaceAll('-', '');
    return upper ? s.toUpperCase() : s;
  }));

  generate();
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-end gap-4">
    <div>
      <span class="label">version</span>
      <div class="seg" role="group" aria-label="Version">
        <button type="button" aria-pressed={version === 'v4'} onclick={() => { version = 'v4'; generate(); }}>v4 random</button>
        <button type="button" aria-pressed={version === 'v7'} onclick={() => { version = 'v7'; generate(); }}>v7 time-ordered</button>
      </div>
    </div>
    <label class="w-28">
      <span class="label">how many</span>
      <input class="field" type="number" min="1" max="1000" bind:value={count} />
    </label>
    <label class="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" bind:checked={upper} /> uppercase</label>
    <label class="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" bind:checked={hyphens} /> hyphens</label>
  </div>
  <textarea class="field min-h-[260px]!" readonly value={shown.join('\n')} aria-label="Generated UUIDs" spellcheck="false"></textarea>
  <div class="flex gap-2">
    <button type="button" class="btn" onclick={generate}>Generate again</button>
    <CopyButton text={() => shown.join('\n')} class="btn-primary" label={shown.length > 1 ? `Copy all ${shown.length}` : 'Copy'} />
  </div>
</div>
