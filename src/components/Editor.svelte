<script lang="ts">
  import CodeMirror from 'svelte-codemirror-editor';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { importsCompletion } from '../lib/completions.ts';
  import { syntaxLinter } from '../lib/syntaxLinter.ts';
  import { saveCode } from '../lib/persist.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import IconButton from './IconButton.svelte';
  import type { Engine } from '../lib/types.ts';

  type Props = {
    engine: Engine;
    code: string;
    onReset: () => void;
    resetVisible?: boolean;
  };

  let { engine, code = $bindable(), onReset, resetVisible = true }: Props = $props();

  // Persist code to localStorage on every change. saveCode swallows quota /
  // private-mode errors internally.
  $effect(() => {
    saveCode(engine, code);
  });

  const lang = javascript();
  // Bundle oneDark only when the *resolved* theme is dark; the light theme
  // falls back to CodeMirror's default highlighting paired with --editor-bg.
  // Use `resolved`, not `current`: `current` may be 'system', and a 'system'
  // choice on a dark OS would otherwise drop oneDark while the rest of the
  // page renders dark.
  const extensions = $derived(
    theme.resolved === 'dark'
      ? [oneDark, ...importsCompletion(engine), syntaxLinter]
      : [...importsCompletion(engine), syntaxLinter],
  );
</script>

<div class="editor">
  {#if resetVisible}
    <IconButton icon="resetCode" title="Reset code to selected example" onClick={onReset} />
  {/if}
  <CodeMirror
    bind:value={code}
    {lang}
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

    /* svelte-codemirror-editor wraps CodeMirror in <div
       class="codemirror-wrapper">. Without an explicit height on that
       wrapper, .cm-editor's `height: 100%` resolves against an auto-
       sized parent and CodeMirror's internal .cm-scroller never gets a
       definite height — so the editor grows to its full code height
       instead of scrolling internally. */
    :global(.codemirror-wrapper) {
      height: 100%;
    }

    :global(.cm-editor) {
      height: 100%;
      font-size: 13px;
    }

    :global(.cm-editor.cm-focused) {
      outline: none;
    }

    :global(.cm-scroller) {
      font-family: ui-monospace, 'SF Mono', Consolas, monospace;
      line-height: 1.5;
    }
  }
</style>
