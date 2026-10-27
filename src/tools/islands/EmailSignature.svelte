<script lang="ts">
  import { onMount } from 'svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { downloadBlob, formatBytes } from '../lib/files';
  import { FONTS, NETWORKS, TEMPLATES, blankSignature, imageSrc, parseSignature, signatureHtml, signaturePlain, validEmail, type FontId } from '../lib/email-signature/render';

  const KEY = 'rounder:email-signature';
  const COLORS = [['#1f6feb', 'Blue'], ['#0f766e', 'Teal'], ['#7c3aed', 'Violet'], ['#c2410c', 'Orange'], ['#be123c', 'Rose'], ['#1f1f1f', 'Black']] as const;
  const GMAIL_LIMIT = 10_000;

  let sig = $state(blankSignature());
  let loaded = $state(false);
  let client = $state<'gmail' | 'outlook' | 'apple'>('gmail');
  let copied = $state(false);
  let copyError = $state('');
  let imageError = $state('');
  let preview: HTMLDivElement;

  onMount(() => {
    try {
      const saved = parseSignature(localStorage.getItem(KEY));
      if (saved) sig = saved;
    } catch {
      // storage blocked: nothing is remembered
    }
    loaded = true;
  });

  $effect(() => {
    if (!loaded) return;
    const data = JSON.stringify(sig);
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, data);
      } catch {
        // full or blocked storage just means nothing is remembered
      }
    }, 300);
    return () => clearTimeout(t);
  });

  // rebuild the preview once typing pauses
  let html = $state('');
  $effect(() => {
    const next = signatureHtml($state.snapshot(sig));
    if (!html) {
      html = next;
      return;
    }
    const t = setTimeout(() => (html = next), 120);
    return () => clearTimeout(t);
  });

  const embedded = $derived(sig.image.startsWith('data:'));
  const imageOk = $derived(!sig.image.trim() || !!imageSrc(sig.image));
  const insecure = $derived(/^http:\/\//i.test(sig.image.trim()));
  const empty = $derived(!sig.name.trim() && !sig.email.trim() && !sig.company.trim());
  const tooLong = $derived(html.length > GMAIL_LIMIT);

  // keep the image's real proportions, so Outlook (which ignores CSS sizing) doesn't stretch it;
  // waits for typing to pause so half-typed addresses aren't fetched
  $effect(() => {
    const src = imageSrc(sig.image);
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth) sig.imageRatio = Math.round((img.naturalHeight / img.naturalWidth) * 1000) / 1000;
    };
    const t = setTimeout(() => (img.src = src), 400);
    return () => {
      clearTimeout(t);
      img.onload = null;
    };
  });

  // the preview lags typing slightly; copies and downloads always use what's in the fields now
  const currentHtml = () => signatureHtml($state.snapshot(sig));

  async function embed(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    imageError = '';
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // twice the shown size keeps it sharp on high-density screens, and the signature small
      const max = sig.imageSize * 2;
      const w = img.naturalWidth || max;
      const h = img.naturalHeight || max;
      const s = Math.min(1, max / Math.max(w, h));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) });
      const ctx = canvas.getContext('2d')!;
      const png = /png|gif|svg/.test(file.type);
      if (!png) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      sig.image = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
    } catch {
      imageError = "Couldn't read that image. Try a PNG, JPG, WebP or SVG.";
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copyRich() {
    copyError = '';
    const plain = signaturePlain(sig);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([currentHtml()],{ type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) }),
      ]);
    } catch {
      // older browsers: copy the rendered preview as a selection, which keeps the formatting too
      const sel = getSelection();
      const range = document.createRange();
      range.selectNodeContents(preview);
      sel?.removeAllRanges();
      sel?.addRange(range);
      const ok = document.execCommand('copy');
      sel?.removeAllRanges();
      if (!ok) {
        copyError = 'Your browser blocked the clipboard. Select the signature in the preview and copy it with Ctrl+C or ⌘C.';
        return;
      }
    }
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  function downloadHtml() {
    const doc = `<!doctype html>\n<html><head><meta charset="utf-8"><title>Email signature</title></head><body>\n${currentHtml()}\n</body></html>\n`;
    downloadBlob(new Blob([doc], { type: 'text/html' }), 'email-signature.html');
  }

  const fields = [
    ['name', 'full name', 'text', 'name'],
    ['title', 'job title', 'text', 'organization-title'],
    ['company', 'company', 'text', 'organization'],
    ['email', 'email', 'email', 'email'],
    ['phone', 'phone', 'tel', 'tel'],
    ['mobile', 'mobile (optional)', 'tel', 'off'],
    ['website', 'website', 'url', 'url'],
  ] as const;
</script>

<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
  <div class="grid content-start gap-5">
    <fieldset class="sec">
      <legend>You</legend>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each fields as [key, label, type, auto]}
          <label class={key === 'website' ? 'sm:col-span-2' : ''}>
            <span class="label">{label}</span>
            <input class="field" {type} bind:value={sig[key]} autocomplete={auto} aria-invalid={key === 'email' && !!sig.email.trim() && !validEmail(sig.email)} />
          </label>
        {/each}
        <label class="sm:col-span-2"><span class="label">address (optional)</span><textarea class="field area" rows="2" bind:value={sig.address}></textarea></label>
      </div>
    </fieldset>

    <fieldset class="sec">
      <legend>Photo or logo</legend>
      <div class="grid gap-3">
        {#if embedded}
          <div class="flex flex-wrap items-center gap-3">
            <img src={sig.image} alt="" class="thumb" class:round={sig.imageShape === 'round'} />
            <span class="mono">embedded image · {formatBytes(Math.round((sig.image.length * 3) / 4))}</span>
            <button type="button" class="btn py-2! text-sm!" onclick={() => (sig.image = '')}>Remove</button>
          </div>
          <p class="warn" role="note">
            <strong>Embedded images often don't show.</strong> Gmail removes them from signatures, and Outlook may block them or turn them into attachments.
            A hosted image URL works everywhere.
          </p>
        {:else}
          <label>
            <span class="label">image URL (https)</span>
            <input class="field" type="url" bind:value={sig.image} placeholder="https://yoursite.com/photo.jpg" aria-invalid={!imageOk} aria-describedby="img-help" />
          </label>
          {#if !imageOk}<p class="text-bad text-sm" role="alert">That doesn't look like an image web address. It should start with https://</p>{/if}
          {#if insecure}<p class="text-sm text-soft">Some email clients block images on plain http. Use https if you can.</p>{/if}
          <p id="img-help" class="text-sm text-soft">
            Email clients load signature images from the web; they can't use a file on your computer. Upload your photo or logo somewhere public, such as your website,
            then paste the image's address here.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <label class="btn cursor-pointer py-2! text-sm!">Embed a file instead<input type="file" accept="image/*" class="sr-only" onchange={embed} /></label>
            <span class="mono">not recommended for Gmail</span>
          </div>
        {/if}
        {#if imageError}<p class="text-bad text-sm" role="alert">{imageError}</p>{/if}
        <div class="flex flex-wrap gap-x-6 gap-y-3">
          <div>
            <span class="label">shape</span>
            <div class="seg" role="group" aria-label="Image shape">
              <button type="button" aria-pressed={sig.imageShape === 'round'} onclick={() => (sig.imageShape = 'round')}>round</button>
              <button type="button" aria-pressed={sig.imageShape === 'square'} onclick={() => (sig.imageShape = 'square')}>square</button>
            </div>
          </div>
          <div>
            <span class="label">size</span>
            <div class="seg" role="group" aria-label="Image size">
              {#each [[64, 'S'], [80, 'M'], [104, 'L']] as const as [px, l]}
                <button type="button" aria-pressed={sig.imageSize === px} onclick={() => (sig.imageSize = px)}>{l}</button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset class="sec">
      <legend>Social links</legend>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each NETWORKS as n}
          <label><span class="label">{n.label}</span><input class="field" bind:value={sig.socials[n.id]} placeholder="profile link or @handle" /></label>
        {/each}
      </div>
    </fieldset>
  </div>

  <div class="grid content-start gap-5 lg:sticky lg:top-4 lg:self-start">
    <div class="grid gap-4">
      <div>
        <span class="label">template</span>
        <div class="seg" role="group" aria-label="Template">
          {#each TEMPLATES as t}
            <button type="button" aria-pressed={sig.template === t.id} onclick={() => (sig.template = t.id)}>{t.label.toLowerCase()}</button>
          {/each}
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div>
          <span class="label">color</span>
          <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
            {#each COLORS as [c, name]}
              <button type="button" class="swatch" style:--c={c} aria-pressed={sig.color === c} aria-label={name} title={name} onclick={() => (sig.color = c)}></button>
            {/each}
            <label class="custom" title="Custom color"><input type="color" bind:value={sig.color} aria-label="Custom color" /></label>
          </div>
        </div>
        <label class="min-w-[180px] flex-1">
          <span class="label">font</span>
          <select class="field py-2.5!" bind:value={sig.font}>
            {#each Object.entries(FONTS) as [id, f]}
              <option value={id as FontId}>{f.label}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>

    <div class="mail" aria-label="Signature preview">
      <div class="mail-head" aria-hidden="true">
        <span></span><span></span><span></span>
        <b>New message</b>
      </div>
      <div class="mail-body">
        <p class="mail-line" aria-hidden="true">Best regards,</p>
        <div class="sig" class:dim={empty} bind:this={preview}>{@html html}</div>
        {#if empty}<p class="hint">Start with your name and email to see your signature here.</p>{/if}
      </div>
    </div>

    <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <button type="button" class="btn btn-primary" class:done={copied} disabled={empty} onclick={copyRich}>
        {#if copied}<span class="tick" aria-hidden="true">✓</span> Copied, now paste it{:else}Copy signature{/if}
      </button>
      <CopyButton text={currentHtml} label="Copy HTML" />
      <button type="button" class="btn" disabled={empty} onclick={downloadHtml}>.html</button>
    </div>
    <p class="sr-only" aria-live="polite">{copied ? 'Signature copied' : ''}</p>
    {#if copyError}<p class="text-bad text-sm" role="alert">{copyError}</p>{/if}
    <p class="mono">
      {html.length.toLocaleString('en-US')} characters of HTML
      {#if tooLong}<span class="text-bad">· over Gmail's 10,000 limit{embedded ? ', mostly the embedded image' : ''}</span>{/if}
    </p>

    <div class="howto card">
      <div class="seg" role="group" aria-label="Email app">
        <button type="button" aria-pressed={client === 'gmail'} onclick={() => (client = 'gmail')}>Gmail</button>
        <button type="button" aria-pressed={client === 'outlook'} onclick={() => (client = 'outlook')}>Outlook</button>
        <button type="button" aria-pressed={client === 'apple'} onclick={() => (client = 'apple')}>Apple Mail</button>
      </div>
      {#if client === 'gmail'}
        <ol>
          <li>Click <b>Copy signature</b> above.</li>
          <li>In Gmail, open the gear icon, then <b>See all settings</b>.</li>
          <li>On the General tab, scroll to <b>Signature</b>, click <b>Create new</b> and name it.</li>
          <li>Click into the box and paste (Ctrl+V or ⌘V), then <b>Save Changes</b> at the bottom of the page.</li>
        </ol>
      {:else if client === 'outlook'}
        <ol>
          <li>Click <b>Copy signature</b> above.</li>
          <li>New Outlook and Outlook on the web: <b>Settings</b>, then <b>Account</b>, then <b>Signatures</b>. Classic Outlook for Windows: <b>File</b>, <b>Options</b>, <b>Mail</b>, <b>Signatures</b>.</li>
          <li>Create a new signature, paste it into the editor and save.</li>
          <li>Choose it as the default for new messages and replies.</li>
        </ol>
      {:else}
        <ol>
          <li>Click <b>Copy signature</b> above.</li>
          <li>In Mail on your Mac, open <b>Mail</b>, then <b>Settings</b>, then <b>Signatures</b>.</li>
          <li>Pick your account, click <b>+</b>, and untick <b>Always match my default message font</b>.</li>
          <li>Select the placeholder text on the right and paste over it.</li>
        </ol>
      {/if}
    </div>
  </div>
</div>

<style>
  .sec {
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background: var(--color-panel);
    padding: 16px 16px 18px;
    min-width: 0;
  }
  .sec legend {
    font: 400 22px/1 var(--font-serif);
    padding: 0 8px;
    margin-left: -6px;
  }
  .area {
    font-family: var(--font-sans);
    font-size: 15px;
    min-height: 0;
  }
  .field[aria-invalid='true'] {
    border-color: var(--color-bad);
  }
  .thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 8px;
    background: #fff;
  }
  .thumb.round {
    border-radius: 50%;
  }
  .warn {
    font-size: 14px;
    color: var(--color-soft);
    border-left: 3px solid var(--color-sun);
    padding: 8px 12px;
    background: var(--color-panel-2);
    border-radius: 0 10px 10px 0;
  }
  .warn strong {
    color: var(--color-chalk);
    font-weight: 600;
  }
  .swatch {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--c);
    border: 2px solid var(--color-bg);
    box-shadow: 0 0 0 1px var(--color-line-2);
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring), box-shadow 0.2s;
  }
  .swatch[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--color-sun);
    transform: scale(1.08);
  }
  .custom {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: conic-gradient(#ff7a6b, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff7a6b);
    box-shadow: 0 0 0 1px var(--color-line-2);
    overflow: hidden;
    cursor: pointer;
  }
  .custom:focus-within {
    outline: 2px solid var(--color-sun);
    outline-offset: 2px;
  }
  .custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .mail {
    background: #fff;
    color: #1f1f1f;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 1px 0 #ffffff14, 0 24px 60px -24px #000e;
  }
  .mail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    background: #f1efeb;
    border-bottom: 1px solid #e4e0d8;
    font: 500 12.5px var(--font-sans);
    color: #57534c;
  }
  .mail-head span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #d9d4cb;
  }
  .mail-head b {
    margin-left: 8px;
    font-weight: 500;
  }
  .mail-body {
    padding: 22px 20px 26px;
    min-height: 220px;
    overflow-x: auto;
  }
  .mail-line {
    font: 14px Arial, Helvetica, sans-serif;
    color: #3c4043;
    margin-bottom: 16px;
  }
  .sig {
    transition: opacity 0.25s;
  }
  .sig.dim {
    opacity: 0.25;
  }
  .hint {
    font: 13px var(--font-sans);
    color: #8a857c;
  }
  .done {
    background: var(--color-ok);
    border-color: var(--color-ok);
  }
  .tick {
    display: inline-block;
    animation: tick 0.45s var(--ease-spring);
  }
  @keyframes tick {
    from {
      transform: scale(0.2) rotate(-30deg);
      opacity: 0;
    }
  }
  .howto {
    padding: 14px 16px 16px;
    display: grid;
    gap: 12px;
  }
  .howto ol {
    list-style: decimal;
    padding-left: 20px;
    display: grid;
    gap: 6px;
    font-size: 14px;
    color: var(--color-soft);
  }
  .howto b {
    color: var(--color-chalk);
    font-weight: 600;
  }
</style>
