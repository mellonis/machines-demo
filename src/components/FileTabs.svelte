<script lang="ts">
  import type { Arch, BufferKind, SourceTab } from '../lib/toolchain/types.ts';

  type Props = {
    active: SourceTab;
    arch: Arch;
    kind: BufferKind;
    kindSwitchEnabled: boolean;
    onSelect: (tab: SourceTab) => void;
    onKindChange: (kind: BufferKind) => void;
  };

  let { active, arch, kind, kindSwitchEnabled, onSelect, onKindChange }: Props = $props();

  const srcExt = $derived(`${arch}c`);
  const asmExt = $derived(`${arch}a`);
  const mainExt = $derived(kind === 'source' ? srcExt : asmExt);
</script>

<div class="file-tabs" role="tablist" data-testid="file-tabs">
  <button
    type="button"
    role="tab"
    class="tab"
    aria-selected={active === 'main'}
    onclick={() => onSelect('main')}
  >main.{mainExt}</button>
  <select
    class="kind"
    aria-label="Buffer language"
    disabled={!kindSwitchEnabled}
    value={kind}
    onchange={(e) => onKindChange((e.currentTarget as HTMLSelectElement).value as BufferKind)}
  >
    <option value="source">.{srcExt}</option>
    <option value="asm">.{asmExt}</option>
  </select>
  <button
    type="button"
    role="tab"
    class="tab"
    aria-selected={active === 'std'}
    onclick={() => onSelect('std')}
  >std.{srcExt}</button>
</div>

<style>
  .file-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 12px;

    .tab {
      background: transparent;
      border: 1px solid transparent;
      border-bottom: none;
      color: var(--muted);
      padding: 4px 10px;
      font: inherit;
      cursor: pointer;
      border-radius: 6px 6px 0 0;

      &[aria-selected='true'] {
        color: var(--fg);
        background: var(--editor-bg);
        border-color: var(--cell-border);
      }
    }

    .kind {
      font: inherit;
      color: var(--muted);
      background: var(--cell-bg);
      border: 1px solid var(--cell-border);
      border-radius: 4px;
      padding: 2px 4px;
      margin-right: 8px;

      &:disabled {
        opacity: 0.4;
      }
    }
  }
</style>
