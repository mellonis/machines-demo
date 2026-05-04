<script lang="ts">
  import { icons, type IconName } from '../lib/icons.ts';

  type Props = {
    icon: IconName;
    title?: string;
    onClick?: (e: MouseEvent) => void;
  };

  let { icon, title, onClick }: Props = $props();
</script>

<button
  type="button"
  class="overlay"
  onclick={onClick}
  {title}
  aria-label={title}
>
  {@html icons[icon]}
</button>

<style>
  /* Corner-overlay icon button — sits at top-right of a position:relative
     parent (editor box, log panel) as a tertiary action like reset / clear.
     z-index lifts it above content that paints later in the DOM (CodeMirror
     chrome, log entries). */
  .overlay {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 10;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--fg);
    }

    :global(svg) {
      width: 14px;
      height: 14px;
      display: block;
    }
  }
</style>
