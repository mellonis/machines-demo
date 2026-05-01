<script lang="ts">
  import { icons, type IconName } from '../lib/icons.ts';

  type Props = {
    icon: IconName;
    label?: string;
    title?: string;
    disabled?: boolean;
    class?: string;
    onclick?: (e: MouseEvent) => void;
  };

  let {
    icon,
    label,
    title,
    disabled = false,
    class: cls = '',
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class={cls}
  {disabled}
  {onclick}
  {title}
  aria-label={title ?? label}
>
  {@html icons[icon]}
  {#if label}<span class="btn-label">{label}</span>{/if}
</button>
