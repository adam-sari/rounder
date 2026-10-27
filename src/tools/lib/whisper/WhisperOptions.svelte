<!-- Spoken language (or auto-detect) and the translate-to-English switch, shared by the Whisper tools -->
<script lang="ts">
  import { languageOptions, type LanguageChoice } from './languages';

  interface Props {
    language: LanguageChoice;
    translate: boolean;
    /** large-v3 turbo was trained without translation */
    canTranslate?: boolean;
    disabled?: boolean;
  }
  let { language = $bindable(), translate = $bindable(), canTranslate = true, disabled = false }: Props = $props();

  const uid = $props.id();
  const options = languageOptions();
</script>

<div class="opts">
  <div>
    <label class="label" for={`${uid}-lang`}>spoken language</label>
    <select id={`${uid}-lang`} class="field" bind:value={language} {disabled}>
      <option value="auto">Detect automatically</option>
      {#each options as o (o.code)}
        <option value={o.code}>{o.name}</option>
      {/each}
    </select>
  </div>
  <label class="check" class:off={!canTranslate}>
    <input type="checkbox" checked={translate && canTranslate} disabled={disabled || !canTranslate} onchange={(e) => (translate = e.currentTarget.checked)} />
    <span>
      Translate into English
      <span class="mono block">{canTranslate ? 'writes English whatever language is spoken' : 'switch to the standard model to translate'}</span>
    </span>
  </label>
</div>

<style>
  .opts {
    display: grid;
    gap: 12px 20px;
    align-items: end;
    @media (min-width: 640px) {
      grid-template-columns: minmax(200px, 280px) 1fr;
    }
  }
  select.field {
    padding-block: 9px;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 15px;
    cursor: pointer;
    & input {
      margin-top: 4px;
      accent-color: var(--color-ai);
    }
    &.off {
      color: var(--color-muted);
      cursor: not-allowed;
    }
  }
</style>
