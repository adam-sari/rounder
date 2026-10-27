<script lang="ts">
  import { onDestroy } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import PdfLockRow from './PdfLockRow.svelte';
  import { pdfName, PdfError, runQpdf } from '@/engines/pdf';
  import { downloadBlob, formatBytes, zipFiles } from '@/tools/lib/files';
  import { inspectPdf, type PdfLockInfo } from '@/tools/lib/pdf-security/inspect';
  import { ALLOW_ALL, encryptArgs, formsAllowed, isRestricting, PERMISSIONS, protectProblem } from '@/tools/lib/pdf-security/security';
  import { loadZxcvbn, SCORE_COLORS, SCORE_LABELS, type ZxcvbnResult } from '@/tools/lib/password-strength/zxcvbn';

  interface Item {
    id: number;
    file: File;
    /** what opened it, if it already had an open password */
    password?: string;
    pages: number;
    info?: PdfLockInfo;
    status: 'idle' | 'working' | 'done' | 'error';
    blob?: Blob;
    /** the settings it was protected with; other settings make the result stale */
    sig?: string;
    error?: string;
  }

  let items = $state<Item[]>([]);
  let openPassword = $state('');
  let confirm = $state('');
  let ownerPassword = $state('');
  let visible = $state(false);
  let restrict = $state(false);
  let allow = $state({ ...ALLOW_ALL });
  let strength = $state<ZxcvbnResult | null>(null);
  let running = $state(false);
  let zipping = $state(false);
  let nextId = 0;

  const settings = $derived({ openPassword, confirm, ownerPassword, restrict, allow });
  const problem = $derived(protectProblem(settings));
  const sig = $derived(JSON.stringify([openPassword, isRestricting(settings) ?[ownerPassword, allow] : null]));
  const view = (it: Item) => (it.status === 'done' && it.sig !== sig ? 'idle' : it.status);
  const pending = $derived(items.filter((it) => view(it) !== 'done'));
  const done = $derived(items.filter((it) => view(it) === 'done'));
  const mismatch = $derived(confirm.length > 0 && confirm !== openPassword);
  const plural = (n: number) => `${n} PDF${n === 1 ? '' : 's'}`;

  function add({ file, doc, password }: OpenedPdf) {
    items.push({ id: nextId++, file, password, pages: doc.numPages, status: 'idle' });
    const it = items.at(-1)!;
    inspectPdf(doc).then(
      (info) => {
        if (items.includes(it)) it.info = info;
        else if (info.thumb) URL.revokeObjectURL(info.thumb);
      },
      () => {},
    );
  }

  function remove(it: Item) {
    if (it.info?.thumb) URL.revokeObjectURL(it.info.thumb);
    items = items.filter((i) => i !== it);
  }

  function clearAll() {
    for (const it of items) if (it.info?.thumb) URL.revokeObjectURL(it.info.thumb);
    items = [];
  }

  async function protect() {
    if (problem || running) return;
    running = true;
    const runSig = sig;
    // one call, so a random permissions password is shared by the whole batch
    const args = encryptArgs(settings);
    for (const it of items.filter((i) => view(i) !== 'done')) {
      if (!items.includes(it)) continue;
      it.status = 'working';
      it.error = undefined;
      try {
        const out = await runQpdf(args, new Uint8Array(await it.file.arrayBuffer()), { password: it.password });
        Object.assign(it, { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), sig: runSig, status: 'done' });
      } catch (e) {
        it.error =
          e instanceof PdfError ? e.message
          : (e as Error).name === 'NotReadableError' ? 'Your browser lost access to this file. Add it again and retry.'
          : `Something went wrong: ${(e as Error).message || 'unknown error'}`;
        it.status = 'error';
      }
    }
    running = false;
  }

  const outName = (it: Item) => pdfName(it.file.name, '-protected');

  async function downloadAll() {
    zipping = true;
    try {
      downloadBlob(await zipFiles(done.map((it) => ({ name: outName(it), blob: it.blob! }))), 'protected-pdfs.zip');
    } finally {
      zipping = false;
    }
  }

  function note(it: Item): { text?: string; tone?: 'muted' | 'ok' | 'bad' | 'sun' } {
    const v = view(it);
    if (v === 'working') return { text: 'Encrypting…' };
    if (v === 'done') return { text: `Protected with AES-256 · ${formatBytes(it.blob!.size)}`, tone: 'ok' };
    if (v === 'error') return { text: it.error, tone: 'bad' };
    // restricting without an open password would quietly drop the one the file has now
    if (it.password) return { text: openPassword ? 'Already has a password. Yours will replace it.' : 'Has an open password now. Without one here, the copy will open for anyone.', tone: 'sun' };
    if (it.info?.restrictions.length) return { text: 'Already has restrictions. Your settings will replace them.', tone: 'sun' };
    if (it.info?.encrypted) return { text: 'Already encrypted. Your settings will replace it.', tone: 'sun' };
    return {};
  }

  $effect(() => {
    const pw = openPassword;
    if (!pw) {
      strength = null;
      return;
    }
    // the meter is a hint, so a failed dictionary load just leaves it hidden
    const timer = setTimeout(() => loadZxcvbn().then((check) => pw === openPassword && (strength = check(pw)), () => {}), 150);
    return () => clearTimeout(timer);
  });

  onDestroy(clearAll);
</script>

<div class="grid gap-5">
  {#if items.length}
    <ul class="grid gap-2" aria-label="PDFs to protect">
      {#each items as it (it.id)}
        {@const n = note(it)}
        <PdfLockRow
          name={it.file.name}
          meta="{it.pages} page{it.pages === 1 ? '' : 's'} · {formatBytes(it.file.size)}"
          thumb={it.info?.thumb}
          note={n.text}
          tone={n.tone}
          lock={view(it) === 'done' ? 'closed' : it.info?.encrypted || it.password ? 'closed' : 'open'}
          busy={view(it) === 'working'}
        >
          {#snippet actions()}
            {#if view(it) === 'done'}
              <button type="button" class="btn px-3! py-2! text-sm!" onclick={() => downloadBlob(it.blob!, outName(it))}>Download</button>
            {/if}
            {#if !running}
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
      <PdfDrop multiple compact={items.length > 0} title={items.length ? undefined : 'Drop PDFs to protect'} onopen={add} />
    </div>
    {#if items.length && !running}
      <button type="button" class="btn" onclick={clearAll}>Clear all</button>
    {/if}
  </div>
  {#if items.length}
    <form
      class="settings grid gap-5"
      onsubmit={(e) => {
        e.preventDefault();
        protect();
      }}
    >
      <div class="grid gap-4 md:grid-cols-2">
        <label class="block">
          <span class="label">open password</span>
          <span class="relative block">
            <input
              class="field pr-20! font-mono"
              type={visible ? 'text' : 'password'}
              bind:value={openPassword}
              autocomplete="new-password"
              spellcheck="false"
              placeholder="Needed to open the PDF"
              onfocus={() => loadZxcvbn().catch(() => {})}
            />
            <button
              type="button"
              class="mono eye"
              aria-pressed={visible}
              aria-label="Show passwords"
              onclick={() => (visible = !visible)}>{visible ? 'hide' : 'show'}</button
            >
          </span>
        </label>
        <label class="block">
          <span class="label">confirm password</span>
          <input
            class="field font-mono {mismatch ? 'border-bad!' : ''}"
            type={visible ? 'text' : 'password'}
            bind:value={confirm}
            autocomplete="new-password"
            spellcheck="false"
            disabled={!openPassword}
            aria-invalid={mismatch}
          />
        </label>
      </div>

      {#if openPassword}
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
        <p class="warn">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /><path d="M8 6.2v3.6M8 11.6v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          <span>Save this password somewhere safe. If it's forgotten, nobody can open the PDF again, us included: there is no reset.</span>
        </p>
      {/if}

      <div class="restrict" class:on={restrict}>
        <label class="flex cursor-pointer items-center gap-3">
          <input type="checkbox" class="size-4 accent-(--color-sun)" bind:checked={restrict} />
          <span>Also restrict printing, copying and editing</span>
        </label>
        {#if restrict}
          <div class="mt-4 grid gap-4">
            <fieldset>
              <legend class="label">people who open the PDF can</legend>
              <div class="flex flex-wrap gap-2">
                {#each PERMISSIONS as p (p.key)}
                  {@const implied = p.key === 'forms' && allow.comment}
                  <label class="chip" class:implied title={implied ? 'Anyone who can add comments can also fill in forms' : undefined}>
                    <input
                      type="checkbox"
                      class="accent-(--color-sun)"
                      checked={p.key === 'forms' ? formsAllowed(allow) : allow[p.key]}
                      disabled={implied}
                      onchange={(e) => (allow[p.key] = e.currentTarget.checked)}
                    />
                    {p.label}
                  </label>
                {/each}
              </div>
              {#if allow.comment}
                <p class="mono mt-2">Commenting includes filling in forms, as the PDF standard defines it.</p>
              {/if}
            </fieldset>
            <label class="block md:max-w-[calc(50%-8px)]">
              <span class="label">permissions password (optional)</span>
              <input class="field font-mono" type={visible ? 'text' : 'password'} bind:value={ownerPassword} autocomplete="new-password" spellcheck="false" placeholder="Blank = a random one" />
            </label>
            <p class="mono leading-relaxed">
              This password lets you change the permissions later in apps like Acrobat. Permissions are a request, not a lock: most PDF apps respect them, but some
              ignore them. To keep a PDF private, set an open password.
            </p>
          </div>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="btn btn-primary" disabled={!!problem || running || !pending.length}>
          {running ? 'Protecting…' : pending.length ? `Protect ${plural(pending.length)}` : 'All protected'}
        </button>
        {#if done.length > 1 && !running}
          <button type="button" class="btn" disabled={zipping} onclick={downloadAll}>{zipping ? 'Zipping…' : `Download all ${done.length} (.zip)`}</button>
        {/if}
        {#if problem && (openPassword || restrict)}
          <p class="mono {mismatch ? 'text-bad' : ''}" role={mismatch ? 'alert' : undefined}>{problem}</p>
        {:else if !problem}
          <p class="mono">AES-256 encryption · opens in Acrobat, browsers and other PDF apps</p>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  .settings {
    padding: 20px;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: var(--color-panel-2);
  }
  @media (max-width: 480px) {
    .settings {
      padding: 16px;
    }
  }
  .eye {
    position: absolute;
    top: 50%;
    right: 8px;
    translate: 0 -50%;
    padding: 6px 12px;
    border-radius: 8px;
    &:hover {
      color: var(--color-chalk);
    }
  }
  .meter {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 5px;
    & span {
      height: 5px;
      border-radius: 99px;
      background: #141312;
      transition: background-color 0.3s;
    }
  }
  .warn {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid #ffd25e40;
    background: #ffd25e0d;
    color: var(--color-soft);
    font-size: 14px;
    & svg {
      flex: none;
      margin-top: 3px;
      color: var(--color-sun);
    }
  }
  .restrict {
    padding: 14px 16px;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    transition: border-color 0.2s;
    &.on {
      border-color: #ffd25e55;
    }
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--color-line-2);
    background: #141312;
    font-size: 14px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
    &:has(input:checked) {
      border-color: #ffd25e66;
    }
    &:not(:has(input:checked)) {
      color: var(--color-muted);
      text-decoration: line-through;
      text-decoration-color: #ff7a6b99;
    }
    &:has(input:focus-visible) {
      outline: 2px solid var(--color-sun);
      outline-offset: 2px;
    }
    &.implied {
      cursor: default;
      opacity: 0.7;
    }
  }
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
