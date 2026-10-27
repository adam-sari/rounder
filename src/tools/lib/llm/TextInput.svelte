<!-- The writing tools' input: a text box that also opens or takes a dropped .txt, .md or .pdf file. -->
<script lang="ts">
  import { readTextFile, TEXT_ACCEPT } from './read-file';
  import { countWords } from './text';

  interface Props {
    value: string;
    /** name of the file the text came from, '' when typed or pasted */
    name?: string;
    label: string;
    placeholder: string;
    disabled?: boolean;
  }
  let { value = $bindable(), name = $bindable(''), label, placeholder, disabled = false }: Props = $props();

  const uid = $props.id();
  let input: HTMLInputElement;
  let over = $state(false);
  let reading = $state(false);
  let error = $state('');

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  async function open(file: File | undefined) {
    if (!file) return;
    reading = true;
    error = '';
    try {
      value = await readTextFile(file);
      name = file.name;
    } catch (err) {
      console.error(err);
      error = (err as Error)?.message || "That file couldn't be read.";
    } finally {
      reading = false;
    }
  }
</script>

<div class="grid gap-2">
  <div class="flex items-end justify-between gap-3">
    <label class="label mb-0!" for={`${uid}-text`}>{label}</label>
    <span class="mono">{countWords(value).toLocaleString('en-US')} words</span>
  </div>
  <div
    class="wrap"
    class:over
    role="group"
    aria-label={label}
    ondragover={(e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={(e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      over = false;
      open(e.dataTransfer?.files[0]);
    }}
  >
    <textarea id={`${uid}-text`} class="field font-sans! text-base!" bind:value oninput={() => (name = '')} {placeholder} disabled={disabled || reading} spellcheck="true"></textarea>
    {#if over}<div class="hint" aria-hidden="true">Drop to open</div>{/if}
  </div>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <button type="button" class="btn py-2! text-sm!" onclick={() => input.click()} disabled={disabled || reading}>{reading ? 'Reading…' : 'Open .txt, .md or .pdf'}</button>
    <span class="mono">{name ? name : 'or drop a file on the box · read on your device'}</span>
    <input bind:this={input} type="file" accept={TEXT_ACCEPT} hidden onchange={(e) => {
        open(e.currentTarget.files?.[0]);
        e.currentTarget.value = '';
      }} />
  </div>
  {#if error}<p class="text-sm text-bad" role="alert">{error}</p>{/if}
</div>

<style>
  .wrap {
    position: relative;
    & textarea {
      min-height: 260px;
      resize: vertical;
    }
  }
  .hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 400 28px var(--font-serif);
    border: 1.5px dashed var(--color-sun);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-bg) 85%, transparent);
    pointer-events: none;
  }
  .over textarea {
    border-color: var(--color-sun);
  }
</style>
