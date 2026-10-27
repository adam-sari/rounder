<script lang="ts">
  let { before, after, beforeLabel = 'before', afterLabel = 'after' }: { before: string; after: string; beforeLabel?: string; afterLabel?: string } = $props();
  let split = $state(50);
</script>

<div class="compare">
  <img src={before} alt={beforeLabel} draggable="false" />
  <img src={after} alt={afterLabel} draggable="false" class="after" style={`clip-path: inset(0 0 0 ${split}%)`} />
  <div class="handle" style={`left:${split}%`} aria-hidden="true"><span>⟷</span></div>
  <span class="tag mono left-3">{beforeLabel}</span>
  <span class="tag mono right-3">{afterLabel}</span>
  <input type="range" min="0" max="100" step="0.1" bind:value={split} aria-label="Drag to compare before and after" />
</div>

<style>
  .compare {
    position: relative;
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid var(--color-line-2);
    /* checkerboard so transparency is visible */
    background: repeating-conic-gradient(#2a2926 0 25%, #1f1e1b 0 50%) 0 0 / 20px 20px;
    user-select: none;
  }
  img {
    display: block;
    width: 100%;
    max-height: 520px;
    object-fit: contain;
  }
  .after {
    position: absolute;
    inset: 0;
    height: 100%;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--color-sun);
    transform: translateX(-1px);
    pointer-events: none;
    & span {
      position: absolute;
      top: 50%;
      left: 50%;
      translate: -50% -50%;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 99px;
      background: var(--color-sun);
      color: var(--color-bg);
      font-size: 15px;
    }
  }
  .tag {
    position: absolute;
    top: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #131211cc;
    color: var(--color-chalk);
    pointer-events: none;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: ew-resize;
    margin: 0;
  }
</style>
