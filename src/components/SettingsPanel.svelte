<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import {
    SETTING_SPECS,
    getSetting,
    parseSettingValue,
    resetSetting,
    setSetting,
    type SettingKey,
  } from '../lib/settings.ts';

  function fmt(n: number): string {
    return n === Infinity ? '∞' : n.toLocaleString('en-US');
  }

  // User-facing copy per field. Ranges derive from SETTING_SPECS so the
  // hints can't drift from the validation rules.
  const FIELDS: { key: SettingKey; label: string; what: string }[] = [
    { key: 'maxSteps', label: 'Max run steps', what: 'Continuous-run step cap; a run that reaches it stops as truncated.' },
    { key: 'workerTimeoutMs', label: 'Worker timeout (ms)', what: 'Wall-clock cap per worker request; a hung request kills the worker.' },
    { key: 'logRenderCap', label: 'Log render cap', what: 'Log entries kept in the rendered view; older ones fold into the overflow header.' },
  ];

  function rangeText(key: SettingKey): string {
    const spec = SETTING_SPECS[key];
    const infinity = spec.allowInfinity ? ' or ∞' : '';
    return `${fmt(spec.min)} – ${fmt(spec.max)}${infinity} (default ${fmt(spec.default)})`;
  }

  // Raw input text is the source of truth for display; the settings module
  // holds the last persisted (valid) value.
  function display(value: number): string {
    return value === Infinity ? '∞' : String(value);
  }

  function currentValues(): Record<SettingKey, string> {
    return {
      maxSteps: display(getSetting('maxSteps')),
      workerTimeoutMs: display(getSetting('workerTimeoutMs')),
      logRenderCap: display(getSetting('logRenderCap')),
    };
  }

  let open = $state(false);
  let dialogEl = $state<HTMLDialogElement | null>(null);
  let values = $state(currentValues());

  // Native <dialog> via showModal() — focus trap, Escape, return-focus,
  // ::backdrop dimmer come from the browser (graph-modal precedent).
  $effect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function openPanel() {
    // Re-read on every open so the fields reflect what is actually stored
    // (another tab may have written meanwhile).
    values = currentValues();
    open = true;
  }

  function onInput(key: SettingKey, raw: string) {
    values[key] = raw;
    const parsed = parseSettingValue(key, raw);
    if (parsed !== null) setSetting(key, parsed);
    // Invalid input persists nothing — the last valid value stays in effect.
  }

  function onReset(key: SettingKey) {
    resetSetting(key);
    values[key] = display(SETTING_SPECS[key].default);
  }
</script>

<button
  class="gear"
  onclick={openPanel}
  title="Settings"
  aria-label="Settings"
  aria-haspopup="dialog"
>
  {@html icons.settingsGear}
</button>

<!-- Backdrop click closes: a click landing on the <dialog> element itself
     (not its content) means the ::backdrop was hit (save-popover precedent). -->
<dialog
  bind:this={dialogEl}
  class="settings-dialog"
  data-testid="settings-dialog"
  aria-labelledby="settings-title"
  onclose={() => { open = false; }}
  oncancel={() => { open = false; }}
  onclick={(e) => { if (e.target === dialogEl) open = false; }}
>
  <div class="head">
    <h2 id="settings-title">Settings</h2>
    <button class="close" onclick={() => { open = false; }} aria-label="Close settings">
      {@html icons.xSmall}
    </button>
  </div>

  {#each FIELDS as field (field.key)}
    {@const parsed = parseSettingValue(field.key, values[field.key])}
    <div class="field">
      <div class="label-row">
        <label for={`settings-${field.key}`}>{field.label}</label>
        {#if parsed !== SETTING_SPECS[field.key].default}
          <button
            class="reset"
            onclick={() => onReset(field.key)}
            aria-label={`Reset ${field.label} to default`}
          >reset</button>
        {/if}
      </div>
      <input
        id={`settings-${field.key}`}
        type="text"
        inputmode="numeric"
        autocomplete="off"
        value={values[field.key]}
        aria-invalid={parsed === null ? 'true' : undefined}
        aria-describedby={parsed === null ? `settings-error-${field.key}` : undefined}
        oninput={(e) => onInput(field.key, e.currentTarget.value)}
      />
      <p class="hint">{field.what} {rangeText(field.key)}.</p>
      {#if parsed === null}
        <p
          class="field-error"
          id={`settings-error-${field.key}`}
          data-testid={`settings-error-${field.key}`}
        >Enter an integer in {rangeText(field.key)} — keeping the last valid value.</p>
      {/if}
    </div>
  {/each}

  <p class="note">Changes apply from the next run, worker request, or log update.</p>
</dialog>

<style>
  /* Mirrors .theme-toggle in App.svelte — same 28px icon-button treatment
     for header controls. */
  .gear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    transition: background-color var(--anim-button-hover-ms) ease, color var(--anim-button-hover-ms) ease;

    &:hover {
      background: var(--hover-bg);
      color: var(--fg);
    }

    :global(svg) {
      width: 18px;
      height: 18px;
      display: block;
    }
  }

  .settings-dialog {
    /* UA default centers via margin: auto; override the UA chrome with the
       app's surface treatment. */
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(420px, 90vw);
    max-height: 85vh;
    overflow-y: auto;
    padding: 16px;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--surface-border);
    border-radius: var(--surface-radius);
    box-shadow: 0 8px 32px var(--shadow);

    /* Restore the UA-default `dialog:not([open]) { display: none }` that
       the `display: flex` above would otherwise override. */
    &:not([open]) {
      display: none;
    }

    &::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;

    h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;

    &:hover {
      background: var(--hover-bg);
      color: var(--fg);
    }

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;

    label {
      font-size: 13px;
      font-weight: 600;
    }
  }

  .reset {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: var(--accent);
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  input {
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
      border-color: var(--accent);
    }

    /* Mouse-only focus suppression — border-color swap is enough cue for
       mouse users; keyboard focus keeps the global :focus-visible ring. */
    &:focus:not(:focus-visible) {
      outline: none;
    }

    &[aria-invalid='true'] {
      border-color: var(--error);
    }
  }

  .hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--muted);
  }

  .field-error {
    margin: 0;
    font-size: 11.5px;
    color: var(--error);
  }

  .note {
    margin: 0;
    font-size: 11.5px;
    color: var(--muted);
    border-top: 1px solid var(--divider);
    padding-top: 10px;
  }
</style>
