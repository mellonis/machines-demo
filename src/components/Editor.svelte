<script lang="ts">
  import CodeMirror from 'svelte-codemirror-editor';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { importsCompletion } from '../lib/completions.ts';
  import { syntaxLinter } from '../lib/syntaxLinter.ts';
  import { saveCode } from '../lib/persist.ts';
  import IconButton from './IconButton.svelte';
  import type { Engine } from '../lib/types.ts';

  type Props = {
    engine: Engine;
    code: string;
    onReset: () => void;
  };

  let { engine, code = $bindable(), onReset }: Props = $props();

  // Persist code to localStorage on every change. saveCode swallows quota /
  // private-mode errors internally.
  $effect(() => {
    saveCode(engine, code);
  });

  const lang = javascript();
  const extensions = $derived([...importsCompletion(engine), syntaxLinter]);
</script>

<div class="editor">
  <IconButton icon="resetCode" title="Reset code to selected example" onClick={onReset} />
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
