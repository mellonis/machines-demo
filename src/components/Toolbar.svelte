<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { Example } from '../lib/defaultCode.ts';

  // Execution-mode strings the toolbar cares about. Kept loose (string union
  // matching MachineView's ExecutionMode) so we don't duplicate the type.
  type Mode =
    | 'DEMO' | 'MANUAL'
    | 'RUNNING_STEP' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS'
    | 'HALTED';

  type Props = {
    executionMode: Mode;
    loadDisabled: boolean;
    stepDisabled: boolean;
    runDisabled: boolean;
    intervalIsValid: boolean;
    examples: readonly Example[];
    selectedExampleId: string;
    withPause: boolean;
    intervalText: string;
    onBuild: () => void;
    onStep: () => void;
    onRun: () => void;
    onStop: () => void;
    onPickExample: (ex: Example) => void;
  };

  let {
    executionMode,
    loadDisabled,
    stepDisabled,
    runDisabled,
    intervalIsValid,
    examples,
    selectedExampleId,
    withPause = $bindable(),
    intervalText = $bindable(),
    onBuild,
    onStep,
    onRun,
    onStop,
    onPickExample,
  }: Props = $props();

  // Examples dropdown — fully owned here so the outside-click and Escape
  // handlers stay colocated with the menu they close.
  let examplesOpen = $state(false);
  let examplesMenuEl: HTMLDivElement | undefined;

  function pick(ex: Example): void {
    onPickExample(ex);
    examplesOpen = false;
  }

  // Close dropdown on outside click / Escape — only while open.
  $effect(() => {
    if (!examplesOpen) return;
    const onPointer = (e: MouseEvent): void => {
      if (!examplesMenuEl?.contains(e.target as Node)) examplesOpen = false;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') examplesOpen = false;
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  // with-pause / interval are configuration for the *next* Run; meaningless
  // mid-run, so hide them in the running modes (they'd just be inert chrome).
  const configVisible = $derived(
    executionMode !== 'RUNNING_AUTO' && executionMode !== 'RUNNING_CONTINUOUS',
  );
  const stopVisible = $derived(
    executionMode === 'RUNNING_STEP' || executionMode === 'RUNNING_AUTO',
  );
</script>

<div class="toolbar">
  <div class="examples-menu" bind:this={examplesMenuEl}>
    <button
      type="button"
      class="icon-only"
      aria-label="Example code sources"
      aria-haspopup="menu"
      aria-expanded={examplesOpen}
      title="Example code sources"
      onclick={() => (examplesOpen = !examplesOpen)}
    >
      {@html icons.examples}
    </button>
    {#if examplesOpen}
      <ul class="dropdown" role="menu">
        {#each examples as ex (ex.id)}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class:selected={ex.id === selectedExampleId}
              onclick={() => pick(ex)}
            >
              {ex.title}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <button type="button" disabled={loadDisabled} onclick={onBuild}>
    {@html icons.build}<span class="btn-label">Build</span>
  </button>
  <button type="button" disabled={stepDisabled} onclick={onStep}>
    {@html executionMode === 'RUNNING_AUTO' ? icons.pause : icons.step}
    <span class="btn-label">{executionMode === 'RUNNING_AUTO' ? 'Pause' : 'Step'}</span>
  </button>
  <button type="button" disabled={runDisabled} onclick={onRun}>
    {@html icons.run}<span class="btn-label">Run</span>
  </button>
  {#if configVisible}
    <label class="checkbox">
      <input type="checkbox" bind:checked={withPause} disabled={runDisabled} />
      <span>with pause</span>
    </label>
    {#if withPause}
      <input
        type="text"
        class="interval-input"
        class:invalid={!intervalIsValid}
        bind:value={intervalText}
        placeholder="1s"
      />
    {/if}
  {/if}
  {#if stopVisible}
    <button type="button" class="stop-btn" onclick={onStop}>
      {@html icons.stop}<span class="btn-label">Stop</span>
    </button>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;

    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--cell-bg);
      border: 1px solid var(--cell-border);
      color: var(--fg);
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
      border-radius: 6px;

      &:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      :global(svg) {
        width: 16px;
        height: 16px;
        display: block;
        flex-shrink: 0;
      }

      @media (max-width: 768px) {
        padding: 4px 10px;
        font-size: 13px;
        gap: 4px;

        :global(svg) {
          width: 14px;
          height: 14px;
        }
      }
    }
  }

  .stop-btn {
    border-color: rgba(255, 107, 107, 0.4);
    color: rgba(255, 107, 107, 0.8);

    &:hover {
      border-color: var(--error) !important;
      color: var(--error) !important;
    }
  }

  /* Examples dropdown — anchored to its trigger via position:relative on the
     wrapper. The button is icon-only; the menu floats below it. */
  .examples-menu {
    position: relative;
    display: inline-flex;
  }

  .toolbar .examples-menu .icon-only {
    padding: 6px 8px;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    list-style: none;
    margin: 0;
    padding: 4px;
    min-width: 220px;
    /* Opaque: --surface-bg has alpha and would let the editor code show
       through when the dropdown overlays CodeMirror. */
    background: var(--cell-bg);
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);

    li {
      list-style: none;
    }

    button {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      color: var(--fg);
      padding: 6px 10px;
      font: inherit;
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: rgba(110, 168, 254, 0.14);
        color: var(--accent);
      }

      &.selected {
        color: var(--accent);
        background: rgba(110, 168, 254, 0.18);
      }
    }
  }

  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
    user-select: none;

    input {
      accent-color: var(--accent);
      margin: 0;
    }
  }

  .interval-input {
    width: 64px;
    background: var(--cell-bg);
    border: 1px solid var(--cell-border);
    color: var(--fg);
    padding: 4px 8px;
    font: inherit;
    font-size: 13px;
    border-radius: 4px;

    &:focus {
      outline: none;
      border-color: var(--accent);
    }

    &.invalid {
      border-color: var(--error);
      color: var(--error);
    }
  }
</style>
