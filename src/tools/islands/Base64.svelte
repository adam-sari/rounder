<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';

  let mode = $state<'encode' | 'decode'>('encode');
  let urlSafe = $state(false);
  let text = $state('');
  let file = $state<{ name: string; type: string; b64: string } | null>(null);

  function bytesToB64(bytes: Uint8Array) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const toUrlSafe = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const result = $derived.by(() => {
    try {
      if (mode === 'encode') {
        const b64 = file ? file.b64 : bytesToB64(new TextEncoder().encode(text));
        return { out: urlSafe ? toUrlSafe(b64) : b64, error: '' };
      }
      let s = text.trim().replace(/^data:[^,]*,/, '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
      while (s.length % 4) s += '=';
      const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      return { out: new TextDecoder('utf-8', { fatal: false }).decode(bytes), error: '' };
    } catch {
      return { out: '', error: 'That is not valid Base64.' };
    }
  });

  async function onfiles([f]: File[]) {
    const b64 = bytesToB64(new Uint8Array(await f.arrayBuffer()));
    file = { name: f.name, type: f.type || 'application/octet-stream', b64 };
    mode = 'encode';
  }
</script>

<div class="grid gap-4">
  <div class="flex flex-wrap items-center gap-4">
    <div class="seg" role="group" aria-label="Mode">
      <button type="button" aria-pressed={mode === 'encode'} onclick={() => (mode = 'encode')}>encode</button>
      <button type="button" aria-pressed={mode === 'decode'} onclick={() => { mode = 'decode'; file = null; }}>decode</button>
    </div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={urlSafe} /> URL-safe</label>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="grid gap-3">
      {#if file}
        <div class="field flex items-center justify-between gap-3">
          <span class="truncate">📄 {file.name}</span>
          <button type="button" class="btn py-1.5!" onclick={() => (file = null)}>Clear</button>
        </div>
      {:else}
        <label>
          <span class="label">{mode === 'encode' ? 'text to encode' : 'Base64 to decode'}</span>
          <textarea class="field" bind:value={text} spellcheck="false"></textarea>
        </label>
      {/if}
      {#if mode === 'encode' && !file}
        <Dropzone title="…or drop a file" hint="any file type" paste={false} {onfiles} />
      {/if}
    </div>
    <label>
      <span class="label">result</span>
      {#if result.error && text.trim()}
        <div class="field min-h-[220px] text-bad" role="alert">{result.error}</div>
      {:else}
        <textarea class="field" readonly value={result.out} spellcheck="false"></textarea>
      {/if}
    </label>
  </div>
  <div class="flex flex-wrap gap-2">
    <CopyButton text={() => result.out} class="btn-primary" label="Copy result" />
    {#if file}
      <CopyButton text={() => `data:${file!.type};base64,${file!.b64}`} label="Copy as data URI" />
    {/if}
  </div>
</div>
