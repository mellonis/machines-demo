<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { Example } from '../lib/defaultCode.ts';
  import type { Snippets } from '../lib/persist.ts';

  // Execution-mode strings the toolbar cares about. Kept loose (string union
  // matching MachineView's ExecutionMode) so we don't duplicate the type.
  type Mode =
    | 'DEMO' | 'MANUAL'
    | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS'
    | 'RUNNING_PAUSED'
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
    debugMode: boolean;
    intervalText: string;
    snippets: Snippets;
    loadedSnippetId: string | null;
    dirty: boolean;
    onBuild: () => void;
    onStep: () => void;
    onRun: () => void;
    onStop: () => void;
    onPickExample: (ex: Example) => void;
    onSaveSnippet: (title: string) => void;
    onSaveChanges: () => void;
    onLoadSnippet: (id: string) => void;
    onDeleteSnippet: (id: string) => void;
    onRenameSnippet: (id: string, newTitle: string) => void;
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
    debugMode = $bindable(),
    intervalText = $bindable(),
    snippets,
    loadedSnippetId,
    dirty,
    onBuild,
    onStep,
    onRun,
    onStop,
    onPickExample,
    onSaveSnippet,
    onSaveChanges,
    onLoadSnippet,
    onDeleteSnippet,
    onRenameSnippet,
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

  let saveOpen = $state(false);
  let saveName = $state('');
  let pendingOverwrite = $state(false);
  let saveMenuEl: HTMLDivElement | undefined;
  let nameInputEl = $state<HTMLInputElement | undefined>(undefined);

  const loadedSnippet = $derived(
    loadedSnippetId !== null ? snippets[loadedSnippetId] ?? null : null,
  );
  const trimmedName = $derived(saveName.trim());
  const snippetTitles = $derived(new Set(Object.values(snippets).map((s) => s.title)));
  const saveNameExists = $derived(trimmedName !== '' && snippetTitles.has(trimmedName));
  const saveEnabled = $derived(trimmedName !== '');

  $effect(() => {
    if (!saveOpen) return;
    const onPointer = (e: MouseEvent): void => {
      if (!saveMenuEl?.contains(e.target as Node)) closeSavePopover();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSavePopover();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  $effect(() => {
    if (saveOpen && nameInputEl) nameInputEl.focus();
  });

  $effect(() => {
    if (!saveOpen) return;
    void trimmedName;
    pendingOverwrite = false;
  });

  function closeSavePopover(): void {
    saveOpen = false;
    saveName = '';
    pendingOverwrite = false;
  }

  // ⌘S / ⌘⇧S — preventDefault is what stops the browser's Save Page dialog.
  $effect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      if (saveOpen) return; // popover has its own Enter binding
      if (e.shiftKey) {
        saveName = '';
        saveOpen = true;
      } else if (loadedSnippet !== null) {
        onSaveChanges();
      } else {
        saveName = '';
        saveOpen = true;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function doSave(): void {
    if (!saveEnabled) return;
    if (saveNameExists && !pendingOverwrite) {
      pendingOverwrite = true;
      return;
    }
    onSaveSnippet(trimmedName);
    closeSavePopover();
  }

  const sortedSnippets = $derived(
    Object.entries(snippets).sort((a, b) => b[1].savedAt - a[1].savedAt),
  );

  let deletePendingId = $state<string | null>(null);

  let renameId = $state<string | null>(null);
  let renameDraft = $state('');
  let renameOverwrite = $state(false);
  let renameInputEl = $state<HTMLInputElement | undefined>(undefined);

  const snippetTitlesExcludingRename = $derived(
    renameId !== null
      ? new Set(Object.entries(snippets).filter(([k]) => k !== renameId).map(([, s]) => s.title))
      : snippetTitles,
  );
  const renameTrimmed = $derived(renameDraft.trim());
  const renameConflicts = $derived(
    renameTrimmed !== '' && snippetTitlesExcludingRename.has(renameTrimmed),
  );

  $effect(() => {
    if (renameId !== null && renameInputEl) renameInputEl.focus();
  });

  $effect(() => {
    void renameTrimmed;
    renameOverwrite = false;
  });

  function openRename(id: string): void {
    renameId = id;
    renameDraft = snippets[id]?.title ?? '';
    renameOverwrite = false;
  }

  function cancelRename(): void {
    renameId = null;
    renameDraft = '';
    renameOverwrite = false;
  }

  function commitRename(): void {
    if (!renameId || renameTrimmed === '') return;
    if (renameConflicts && !renameOverwrite) {
      renameOverwrite = true;
      return;
    }
    onRenameSnippet(renameId, renameTrimmed);
    cancelRename();
  }

  // with-pause / interval are configuration for the *next* Run / Continue.
  // They're still meaningful in RUNNING_PAUSED (where Continue re-reads them),
  // so only hide them in actively-running modes.
  const configVisible = $derived(
    executionMode !== 'RUNNING_AUTO' && executionMode !== 'RUNNING_CONTINUOUS',
  );
  // Stop is the user's kill-switch for any non-halted run state. Without it
  // in RUNNING_CONTINUOUS the user is locked into the run until halt (or the
  // worker-side timeout backstop) — visible across all three running modes.
  const stopVisible = $derived(
    executionMode === 'RUNNING_AUTO' ||
      executionMode === 'RUNNING_CONTINUOUS' ||
      executionMode === 'RUNNING_PAUSED',
  );
  // Once a run is in flight (any RUNNING_*), the only meaningful action this
  // button could take is "resume / let the run finish", so it reads as
  // `Continue` — enabled in RUNNING_PAUSED, disabled in RUNNING_AUTO /
  // RUNNING_CONTINUOUS where the run is already advancing on its own. In
  // resting modes (DEMO/IDLE/MANUAL/HALTED) it's a fresh-start action and
  // reads `Run`.
  const runLabel = $derived(
    executionMode === 'RUNNING_AUTO' ||
      executionMode === 'RUNNING_CONTINUOUS' ||
      executionMode === 'RUNNING_PAUSED'
      ? 'Continue'
      : 'Run',
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
              class:selected={ex.id === selectedExampleId && loadedSnippetId === null}
              onclick={() => pick(ex)}
            >
              {ex.title}
            </button>
          </li>
        {/each}
        {#if sortedSnippets.length > 0}
          <li role="separator" class="divider"></li>
          <li role="none" class="section-label">My snippets</li>
          {#each sortedSnippets as [id, snippet] (id)}
            <li role="none" class="snippet-row">
              {#if deletePendingId === id}
                <span class="delete-confirm-label">{snippet.title}</span>
                <button
                  type="button"
                  class="delete-confirm-yes"
                  aria-label="Confirm delete"
                  title="Yes, delete"
                  onclick={(e) => { e.stopPropagation(); onDeleteSnippet(id); deletePendingId = null; }}
                >Delete</button>
                <button
                  type="button"
                  class="delete-confirm-no"
                  aria-label="Cancel delete"
                  title="Cancel"
                  onclick={(e) => { e.stopPropagation(); deletePendingId = null; }}
                >Cancel</button>
              {:else if renameId === id}
                {#if renameOverwrite}
                  <span class="rename-conflict-label">Overwrite "{renameTrimmed}"?</span>
                  <button
                    type="button"
                    class="rename-confirm-yes"
                    onclick={(e) => { e.stopPropagation(); commitRename(); }}
                  >Yes</button>
                  <button
                    type="button"
                    class="rename-confirm-no"
                    onclick={(e) => { e.stopPropagation(); renameOverwrite = false; }}
                  >No</button>
                {:else}
                  <input
                    type="text"
                    class="rename-input"
                    class:conflict={renameConflicts}
                    bind:this={renameInputEl}
                    bind:value={renameDraft}
                    maxlength="80"
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') { e.stopPropagation(); commitRename(); }
                      if (e.key === 'Escape') { e.stopPropagation(); cancelRename(); }
                    }}
                  />
                  <button
                    type="button"
                    class="rename-ok-btn"
                    disabled={renameTrimmed === ''}
                    aria-label="Confirm rename"
                    title="Confirm rename"
                    onclick={(e) => { e.stopPropagation(); commitRename(); }}
                  >{@html icons.apply}</button>
                  <button
                    type="button"
                    class="delete-btn"
                    aria-label="Cancel rename"
                    title="Cancel"
                    onclick={(e) => { e.stopPropagation(); cancelRename(); }}
                  >{@html icons.xSmall}</button>
                {/if}
              {:else}
                <button
                  type="button"
                  role="menuitem"
                  class:selected={id === loadedSnippetId}
                  onclick={() => { onLoadSnippet(id); examplesOpen = false; }}
                >{snippet.title}</button>
                <button
                  type="button"
                  class="rename-btn"
                  aria-label="Rename snippet {snippet.title}"
                  title="Rename"
                  onclick={(e) => { e.stopPropagation(); openRename(id); }}
                >{@html icons.pencil}</button>
                <button
                  type="button"
                  class="delete-btn"
                  aria-label="Delete snippet {snippet.title}"
                  title="Delete"
                  onclick={(e) => { e.stopPropagation(); deletePendingId = id; }}
                >{@html icons.xSmall}</button>
              {/if}
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  </div>

  <div class="save-menu" bind:this={saveMenuEl}>
    <button
      type="button"
      class="icon-only"
      class:dirty
      aria-label="Save snippet"
      aria-haspopup="dialog"
      aria-expanded={saveOpen}
      title="Save snippet (⌘S)"
      onclick={() => { if (saveOpen) closeSavePopover(); else { saveName = ''; saveOpen = true; } }}
    >
      {@html icons.saveFloppy}
    </button>
    {#if saveOpen}
      <div class="save-popover" role="dialog" aria-label="Save snippet">
        {#if loadedSnippet !== null}
          <button
            type="button"
            class="save-changes"
            disabled={!dirty}
            onclick={() => { onSaveChanges(); closeSavePopover(); }}
          >
            Save changes to "{loadedSnippet.title}"
          </button>
          <div class="popover-section-label">or save as new</div>
        {/if}
        <input
          type="text"
          bind:this={nameInputEl}
          bind:value={saveName}
          placeholder="Snippet name"
          maxlength="80"
          onkeydown={(e) => {
            if (e.key === 'Enter') doSave();
            if (e.key === 'Escape') closeSavePopover();
          }}
        />
        {#if pendingOverwrite}
          <div class="overwrite-confirm">
            <span>Overwrite "{trimmedName}"?</span>
            <button type="button" class="confirm-yes" onclick={doSave}>Yes</button>
            <button type="button" onclick={() => (pendingOverwrite = false)}>No</button>
          </div>
        {:else}
          <button type="button" disabled={!saveEnabled} onclick={doSave}>
            {loadedSnippet !== null ? 'Save as new' : 'Save'}
          </button>
        {/if}
      </div>
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
    {@html icons.run}<span class="btn-label">{runLabel}</span>
  </button>
  {#if configVisible}
    <label class="checkbox">
      <input type="checkbox" bind:checked={withPause} disabled={runDisabled} class="visually-hidden" />
      <span class="checkbox-icon" aria-hidden="true">
        {@html withPause ? icons.checkboxChecked : icons.checkboxEmpty}
      </span>
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
    <label class="checkbox" title="When on, breaks set via state.debug pause execution at a Continue/Step prompt.">
      <input type="checkbox" bind:checked={debugMode} disabled={runDisabled} class="visually-hidden" />
      <span class="checkbox-icon" aria-hidden="true">
        {@html debugMode ? icons.checkboxChecked : icons.checkboxEmpty}
      </span>
      <span>debug</span>
    </label>
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
    border-color: color-mix(in srgb, var(--error) 40%, transparent);
    color: color-mix(in srgb, var(--error) 80%, transparent);

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

  .toolbar .examples-menu .icon-only,
  .toolbar .save-menu .icon-only {
    padding: 6px 8px;
  }

  .toolbar .save-menu .icon-only.dirty {
    position: relative;

    &::after {
      content: '';
      position: absolute;
      top: 4px;
      right: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }
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
    box-shadow: 0 8px 24px var(--shadow);

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
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        color: var(--accent);
      }

      &.selected {
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 18%, transparent);
      }
    }
  }

  .divider {
    height: 1px;
    background: var(--divider);
    margin: 4px 6px;
    padding: 0;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 4px 10px 2px;
  }

  .snippet-row {
    display: flex;
    align-items: center;

    button:first-child {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .delete-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      padding: 4px;
      background: transparent;
      border: none;
      color: var(--muted);
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.6;

      &:hover {
        color: var(--error);
        background: color-mix(in srgb, var(--error) 12%, transparent);
        opacity: 1;
      }

      :global(svg) {
        width: 14px;
        height: 14px;
      }
    }

    .rename-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      padding: 4px;
      background: transparent;
      border: none;
      color: var(--muted);
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;

      :global(svg) {
        width: 14px;
        height: 14px;
      }
    }

    &:hover .rename-btn {
      opacity: 0.6;

      &:hover {
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        opacity: 1;
      }
    }

    .rename-input {
      flex: 1;
      min-width: 0;
      background: var(--cell-bg);
      border: 1px solid var(--cell-border);
      color: var(--fg);
      padding: 3px 6px;
      font: inherit;
      font-size: 13px;
      border-radius: 4px;

      &:focus {
        outline: none;
        border-color: var(--accent);
      }

      &.conflict {
        border-color: var(--error);
      }
    }

    .rename-ok-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      padding: 4px;
      background: transparent;
      border: none;
      color: var(--accent);
      border-radius: 4px;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      :global(svg) {
        width: 14px;
        height: 14px;
      }
    }

    .rename-conflict-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      color: var(--muted);
      padding: 0 4px;
    }

    .rename-confirm-yes {
      flex-shrink: 0;
      font-size: 12px;
      padding: 3px 8px;
      border-color: color-mix(in srgb, var(--ok) 50%, transparent);
      color: var(--ok);

      &:hover {
        border-color: var(--ok) !important;
        color: var(--ok) !important;
      }
    }

    .rename-confirm-no {
      flex-shrink: 0;
      font-size: 12px;
      padding: 3px 8px;
    }

    .delete-confirm-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: var(--muted);
      padding: 0 6px;
    }

    .delete-confirm-yes {
      flex-shrink: 0;
      font-size: 12px;
      padding: 3px 8px;
      border-color: color-mix(in srgb, var(--error) 50%, transparent);
      color: var(--error);

      &:hover {
        border-color: var(--error) !important;
        color: var(--error) !important;
      }
    }

    .delete-confirm-no {
      flex-shrink: 0;
      font-size: 12px;
      padding: 3px 8px;
    }
  }

  .save-menu {
    position: relative;
    display: inline-flex;
  }

  .save-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    min-width: 220px;
    background: var(--cell-bg);
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--shadow);

    input[type='text'] {
      background: var(--cell-bg);
      border: 1px solid var(--cell-border);
      color: var(--fg);
      padding: 5px 8px;
      font: inherit;
      font-size: 13px;
      border-radius: 4px;
      width: 100%;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--accent);
      }
    }

    > button {
      align-self: flex-end;
      padding: 5px 14px;
      font-size: 13px;
    }

    .save-changes {
      align-self: stretch;
      text-align: left;
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--accent);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &:hover:not(:disabled) {
        border-color: var(--accent) !important;
        background: color-mix(in srgb, var(--accent) 10%, transparent);
      }
    }

    .popover-section-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      padding: 4px 0 0;
      border-top: 1px solid var(--divider);
      margin-top: 2px;
    }
  }

  .overwrite-confirm {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;

    span {
      flex: 1;
      font-size: 12px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .confirm-yes {
      border-color: color-mix(in srgb, var(--ok) 50%, transparent);
      color: var(--ok);
      font-size: 12px;
      padding: 3px 10px;

      &:hover {
        border-color: var(--ok) !important;
        color: var(--ok) !important;
      }
    }

    button:not(.confirm-yes) {
      font-size: 12px;
      padding: 3px 10px;
    }
  }

  .checkbox {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
    user-select: none;

    &:has(input:disabled) {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  /* Visually hide the native input but stretch it over the whole label so
     pointer + keyboard + screen-reader all reach the real <input>. The
     custom Tabler icon next to it renders the visible state. */
  .visually-hidden {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    opacity: 0;
    cursor: pointer;
    border: 0;
  }

  .visually-hidden:disabled {
    cursor: not-allowed;
  }

  .checkbox-icon {
    display: inline-flex;
    align-items: center;
    width: 16px;
    height: 16px;
    color: inherit;
    /* Decorative (aria-hidden); the underlying input handles all interaction. */
    pointer-events: none;

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
    }
  }

  /* Keyboard focus ring on the icon when the hidden input has focus. */
  .checkbox:has(input:focus-visible) .checkbox-icon {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
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
