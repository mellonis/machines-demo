<script lang="ts">
  import CodeMirror from 'svelte-codemirror-editor';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { importsCompletion } from '../lib/completions.ts';
  import { syntaxLinter } from '../lib/syntaxLinter.ts';
  import { saveCode } from '../lib/persist.ts';
  import { icons } from '../lib/icons.ts';
  import type { Engine } from '../lib/types.ts';

  type Props = {
    engine: Engine;
    code: string;
    onreset: () => void;
  };

  let { engine, code = $bindable(), onreset }: Props = $props();

  // Persist code to localStorage on every change. saveCode swallows quota /
  // private-mode errors internally.
  $effect(() => {
    saveCode(engine, code);
  });

  const lang = javascript();
  const extensions = $derived([...importsCompletion(engine), syntaxLinter]);
</script>

<div class="editor">
  <button
    type="button"
    class="reset"
    onclick={onreset}
    title="Reset code to default example"
    aria-label="Reset code to default example"
  >
    {@html icons.resetCode}
  </button>
  <CodeMirror
    bind:value={code}
    {lang}
    theme={oneDark}
    {extensions}
  />
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .reset {
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
  }

  .reset:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
  }

  .reset :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }

  .editor :global(.cm-editor) {
    height: 100%;
    font-size: 13px;
  }

  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }

  .editor :global(.cm-scroller) {
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    line-height: 1.5;
  }
</style>
