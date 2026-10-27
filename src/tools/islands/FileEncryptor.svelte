<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { CryptError, decryptFile, encryptFile, isEncrypted, outputName, unlock, type Unlocked } from '@/tools/lib/file-encryptor/format';
  import { loadZxcvbn, SCORE_COLORS, SCORE_LABELS, type ZxcvbnResult } from '@/tools/lib/password-strength/zxcvbn';

  type Mode = 'encrypt' | 'decrypt';
  type SavePicker = (options: { suggestedName?: string }) => Promise<FileSystemFileHandle>;

  // above this, write straight to disk where the browser allows it instead of holding the output in memory
  const STREAM_TO_DISK = 200 * 1024 * 1024;

  let file = $state<File | null>(null);
  let mode = $state<Mode>('encrypt');
  let password = $state('');
  let confirm = $state('');
  let visible = $state(false);
  let strength = $state<ZxcvbnResult | null>(null);
  let phase = $state<'idle' | 'key' | 'working' | 'done' | 'error'>('idle');
  let progress = $state(0);
  let error = $state('');
  let result = $state<{ name: string; size: number; blob?: Blob; mode: Mode } | null>(null);
  let controller: AbortController | undefined;

  const busy = $derived(phase === 'key' || phase === 'working');
  const mismatch = $derived(mode === 'encrypt' && confirm.length > 0 && confirm !== password);
  const ready = $derived(!!file && !!password && !busy && (mode === 'decrypt' || confirm === password));

  async function pick([f]: File[]) {
    reset();
    file = f;
    const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    if (file === f) mode = isEncrypted(head) ? 'decrypt' : 'encrypt';
  }

  function reset() {
    controller?.abort();
    phase = 'idle';
    error = '';
    result = null;
    progress = 0;
  }

  function setMode(m: Mode) {
    if (busy) return;
    mode = m;
    reset();
  }

  /** Asks where to save; undefined means "keep it in memory and offer a download" */
  async function diskTarget(name: string, size: number) {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (!picker || size < STREAM_TO_DISK) return undefined;
    try {
      return await (await picker({ suggestedName: name })).createWritable();
    } catch (err) {
      // the user closed the dialog: stop. Anything else (e.g. the click is too long ago): fall back to memory
      if ((err as Error).name === 'AbortError') throw err;
      return undefined;
    }
  }

  async function run() {
    if (!ready || !file) return;
    const source = file;
    const m = mode;
    const name = outputName(source.name, m);
    reset();
    controller = new AbortController();
    const signal = controller.signal;
    let target: FileSystemWritableFileStream | undefined;
    try {
      let unlocked: Unlocked | undefined;
      if (m === 'decrypt') {
        // check the password before asking where to save, so a typo never leaves an empty file behind
        phase = 'key';
        unlocked = await unlock(source, password);
        signal.throwIfAborted();
      }
      target = await diskTarget(name, source.size);
      phase = m === 'encrypt' ? 'key' : 'working';

      const parts: Uint8Array<ArrayBuffer>[] = [];
      const write = target ? (c: Uint8Array<ArrayBuffer>) => target!.write(c) : (c: Uint8Array<ArrayBuffer>) => parts.push(c);
      const onProgress = (done: number, total: number) => {
        if (signal.aborted) return;
        phase = 'working';
        progress = total ? done / total : 1;
      };
      if (m === 'encrypt') await encryptFile(source, password, write, { onProgress, signal });
      else await decryptFile(source, unlocked!, write, { onProgress, signal });

      signal.throwIfAborted();
      await target?.close();
      const blob = target ? undefined : new Blob(parts, { type: 'application/octet-stream' });
      result = { name, size: blob?.size ?? 0, blob, mode: m };
      phase = 'done';
    } catch (err) {
      await target?.abort().catch(() => {});
      // cancelled or replaced by a newer run: that run (or reset) owns the state now
      if (signal.aborted) return;
      if ((err as Error).name === 'AbortError') {
        phase = 'idle';
        return;
      }
      error =
        err instanceof CryptError ? err.message
        : (err as Error).name === 'NotReadableError' ? 'Your browser lost access to the file. Choose it again and retry.'
        : (err as Error).name === 'QuotaExceededError' ? 'Not enough disk space to save the result.'
        : `Something went wrong: ${(err as Error).message || 'unknown error'}`;
      phase = 'error';
    }
  }

  $effect(() => {
    const pw = password;
    if (mode !== 'encrypt' || !pw) {
      strength = null;
      return;
    }
    // the meter is a hint, so a failed dictionary load just leaves it hidden
    const timer = setTimeout(() => loadZxcvbn().then((check) => pw === password && (strength = check(pw)), () => {}), 150);
    return () => clearTimeout(timer);
  });

  onDestroy(() => controller?.abort());
</script>

<form
  class="grid gap-5"
  onsubmit={(e) => {
    e.preventDefault();
    run();
  }}
>
  <div class="seg self-start justify-self-start" role="group" aria-label="Mode">
    <button type="button" aria-pressed={mode === 'encrypt'} onclick={() => setMode('encrypt')}>encrypt</button>
    <button type="button" aria-pressed={mode === 'decrypt'} onclick={() => setMode('decrypt')}>decrypt</button>
  </div>

  {#if !file}
    <Dropzone title="Drop a file to encrypt or decrypt" hint="any file, any size · .rndr files open in decrypt mode" onfiles={pick} />
  {:else}
    <div class="flex items-center gap-3 rounded-2xl border border-line-2 bg-[#141312] p-3 sm:p-4">
      <span class="badge" aria-hidden="true">{mode === 'decrypt' ? 'RNDR' : file.name.includes('.') ? file.name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE'}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium" title={file.name}>{file.name}</p>
        <p class="mono">{formatBytes(file.size)} · {mode === 'decrypt' ? 'encrypted file, ready to decrypt' : 'ready to encrypt'}</p>
      </div>
      <button type="button" class="btn px-3! py-1.5!" disabled={busy} onclick={() => ((file = null), reset())}>Change</button>
    </div>
  {/if}

  <div class="grid gap-4 {mode === 'encrypt' ? 'md:grid-cols-2' : ''}">
    <label class="block">
      <span class="label">password</span>
      <span class="relative block">
        <input
          class="field pr-20! font-mono"
          type={visible ? 'text' : 'password'}
          bind:value={password}
          autocomplete={mode === 'encrypt' ? 'new-password' : 'current-password'}
          spellcheck="false"
          onfocus={() => mode === 'encrypt' && loadZxcvbn().catch(() => {})}
          placeholder={mode === 'encrypt' ? 'Choose a strong password' : 'The password it was encrypted with'}
        />
        <button
          type="button"
          class="mono absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-3 py-1.5 hover:text-chalk"
          aria-pressed={visible}
          aria-label="Show password"
          onclick={() => (visible = !visible)}>{visible ? 'hide' : 'show'}</button
        >
      </span>
    </label>
    {#if mode === 'encrypt'}
      <label class="block">
        <span class="label">confirm password</span>
        <input class="field font-mono {mismatch ? 'border-bad!' : ''}" type={visible ? 'text' : 'password'} bind:value={confirm} autocomplete="new-password" spellcheck="false" aria-invalid={mismatch} />
        {#if mismatch}<span class="mt-1 block text-sm text-bad">The passwords don't match yet.</span>{/if}
      </label>
    {/if}
  </div>

  {#if mode === 'encrypt' && password}
    <div class="grid gap-2" aria-live="polite">
      <div class="meter" aria-hidden="true">
        {#each [0, 1, 2, 3, 4] as i}
          <span style:background={strength && i <= strength.score ? SCORE_COLORS[strength.score] : ''}></span>
        {/each}
      </div>
      {#if strength}
        <p class="mono">
          <span style:color={SCORE_COLORS[strength.score]}>{SCORE_LABELS[strength.score].toLowerCase()}</span>
          · {strength.crackTimes.offlineSlowHashingXPerSecond.display} to guess at 10,000 tries a second
          {#if strength.score < 3}· try four or more random words{/if}
        </p>
      {/if}
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-3">
    <button type="submit" class="btn btn-primary" disabled={!ready}>
      {mode === 'encrypt' ? 'Encrypt file' : 'Decrypt file'}
    </button>
    {#if busy}
      <button type="button" class="btn" onclick={reset}>Cancel</button>
    {/if}
    {#if mode === 'encrypt' && !busy}
      <p class="mono">There is no password reset. Forget it and the file is gone for good.</p>
    {/if}
  </div>

  {#if busy}
    <div class="grid gap-2" role="status">
      <div class="bar"><span style:width={`${phase === 'key' ? 0 : progress * 100}%`}></span></div>
      <p class="mono">
        {phase === 'key' ? (mode === 'encrypt' ? 'Deriving the key (600,000 rounds of PBKDF2)…' : 'Checking the password…') : `${mode === 'encrypt' ? 'Encrypting' : 'Decrypting'} · ${Math.floor(progress * 100)}%`}
      </p>
    </div>
  {:else if phase === 'error'}
    <p class="rounded-xl border border-bad/50 px-4 py-3 text-sm text-bad" role="alert">{error}</p>
  {:else if phase === 'done' && result}
    <div class="result flex flex-wrap items-center gap-4 rounded-2xl border border-ok/40 bg-[#141312] p-4" role="status">
      <svg class="lock {result.mode}" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
        <path class="shackle" d="M16 23v-7a8 8 0 0 1 16 0v7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" />
        <rect x="10" y="22" width="28" height="21" rx="6" fill="currentColor" />
        <circle cx="24" cy="32" r="2.6" fill="var(--color-bg)" />
      </svg>
      <div class="min-w-0 flex-1">
        <p class="font-serif text-2xl leading-tight">{result.mode === 'encrypt' ? 'Locked.' : 'Unlocked.'}</p>
        <p class="mono truncate">
          {result.name}{result.blob ? ` · ${formatBytes(result.size)}` : ' · saved to your disk'}
        </p>
      </div>
      {#if result.blob}
        <button type="button" class="btn btn-primary" onclick={() => downloadBlob(result!.blob!, result!.name)}>Download</button>
      {/if}
    </div>
  {/if}
</form>

<style>
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 12px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    font: 500 11px var(--font-mono);
    color: var(--color-files);
  }
  .meter {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 5px;
  }
  .meter span {
    height: 5px;
    border-radius: 99px;
    background: var(--color-panel-2);
    transition: background-color 0.3s;
  }
  .bar {
    height: 8px;
    border-radius: 99px;
    background: var(--color-panel-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-sun);
    transition: width 0.2s;
  }
  .result {
    animation: rise 0.4s var(--ease-spring);
  }
  .lock {
    flex: none;
    color: var(--color-ok);
  }
  .shackle {
    transform-box: fill-box;
    transform-origin: right bottom;
  }
  /* the shackle snaps shut on encrypt and swings open on decrypt */
  .lock.encrypt .shackle {
    animation: shut 0.55s var(--ease-spring) 0.1s both;
  }
  .lock.decrypt .shackle {
    animation: open 0.55s var(--ease-spring) 0.1s both;
  }
  @keyframes shut {
    from { transform: translateY(-6px); }
    to { transform: none; }
  }
  @keyframes open {
    from { transform: none; }
    to { transform: translateY(-5px) rotate(-18deg); }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px); }
  }
</style>
