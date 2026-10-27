<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    accept?: string;
    multiple?: boolean;
    title?: string;
    hint?: string;
    /** also accept files pasted anywhere on the page */
    paste?: boolean;
    onfiles: (files: File[]) => void;
    /** files that didn't match accept; without it the dropzone says so itself */
    onreject?: (files: File[]) => void;
  }

  let { accept = '', multiple = false, title = 'Drop files here', hint = 'or click to choose', paste = true, onfiles, onreject }: Props = $props();

  let input: HTMLInputElement;
  let over = $state(false);
  let rejected = $state('');
  let rejectTimer: ReturnType<typeof setTimeout>;

  function matches(file: File) {
    if (!accept) return true;
    return accept.split(',').some((rule) => {
      const r = rule.trim().toLowerCase();
      if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r);
      if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1));
      return file.type === r;
    });
  }

  function take(list: FileList | File[] | null | undefined) {
    const all = Array.from(list ?? []);
    const files = all.filter(matches);
    const skipped = all.filter((f) => !matches(f));
    if (files.length) onfiles(multiple ? files : files.slice(0, 1));
    if (!skipped.length) return;
    if (onreject) return onreject(skipped);
    const names = skipped.length === 1 ? skipped[0].name : `${skipped.length} files`;
    rejected = `${names} can't be used here${files.length ? ', so we skipped it' : ''}.`;
    clearTimeout(rejectTimer);
    rejectTimer = setTimeout(() => (rejected = ''), 5000);
  }

  onMount(() => {
    if (!paste) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) take(e.clipboardData.files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
</script>

<button
  type="button"
  class="drop"
  class:over
  onclick={() => input.click()}
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={(e) => {
    e.preventDefault();
    over = false;
    take(e.dataTransfer?.files);
  }}
>
  <span class="title">{title}</span>
  <span class="mono">{hint}{paste ? ' · ⌘V to paste' : ''}</span>
  <span class="mono lock">● processed on your device · nothing is uploaded</span>
</button>
{#if rejected}<p class="mono reject" role="status">{rejected}</p>{/if}
<input bind:this={input} type="file" {accept} {multiple} hidden onchange={(e) => take(e.currentTarget.files)} />

<style>
  .drop {
    display: grid;
    justify-items: center;
    gap: 8px;
    width: 100%;
    text-align: center;
    padding: 48px 20px;
    color: inherit;
    border: 1.5px dashed #f2ede466;
    border-radius: 18px;
    cursor: pointer;
    background: repeating-linear-gradient(-45deg, transparent 0 14px, #f2ede408 14px 15px);
    transition: border-color 0.2s, background-color 0.2s;
  }
  .drop:hover,
  .drop.over {
    border-color: var(--color-sun);
    background-color: #ffd25e0d;
  }
  .title {
    font: 400 30px/1.1 var(--font-serif);
  }
  .reject {
    margin-top: 8px;
    color: var(--color-bad);
  }
  .lock {
    margin-top: 8px;
    color: var(--color-ok);
  }
</style>
