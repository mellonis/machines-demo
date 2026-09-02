<script lang="ts">
  import CodeMirror from 'svelte-codemirror-editor';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { completionExtensions } from '../lib/completions/index.ts';
  import { argCountLinter } from '../lib/completions/lint/argCount.ts';
  import { crossRefLinter } from '../lib/completions/lint/crossRef.ts';
  import { unboundLinter } from '../lib/completions/lint/unbound.ts';
  import { getSchema } from '../lib/completions/schema/index.ts';
  import type { Env } from '../lib/completions/contexts/types.ts';
  import { syntaxLinter } from '../lib/syntaxLinter.ts';
  import { saveCode } from '../lib/persist.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { DiagnosticsCounter, diagnosticsCounterPlugin } from '../lib/diagnosticsCounter.svelte.ts';
  import DiagnosticsCounterComponent from './DiagnosticsCounter.svelte';
  import IconButton from './IconButton.svelte';
  import { isToolchainEngine, type Engine } from '../lib/types.ts';
  import { langFor, type Lang } from '../lib/toolchain/types.ts';
  import { toolchainLanguage } from '../lib/toolchain/lang/index.ts';

  type Props = {
    engine: Engine;
    code: string;
    onReset: () => void;
    resetVisible?: boolean;
    resetTitle?: string;
    /** Toolchain engines only: which stream mode to use. Ignored for JS engines. */
    lang?: Lang;
    /** Appended after the built-in set — the orchestrator's lint / gutter / highlight / completion. */
    extensions?: Extension[];
    /** Read-only viewer (the stdlib tab): no persistence, no reset, no counter. */
    readOnly?: boolean;
    onReady?: (view: EditorView) => void;
  };

  let {
    engine, code = $bindable(), onReset, resetVisible = true, resetTitle = 'Reset code to selected example',
    lang, extensions: extra = [], readOnly = false, onReady,
  }: Props = $props();

  // Persist code to localStorage on every change (editable buffers only).
  $effect(() => {
    if (!readOnly) saveCode(engine, code);
  });

  const counter = new DiagnosticsCounter();

  const jsLang = javascript();
  // isToolchainEngine(engine) is called at each use site (rather than hoisted
  // to a shared const) so its type-predicate narrows `engine` for langFor()
  // below, and so every read of the `engine` prop stays inside a reactive
  // ($derived) closure — a plain top-level read would only capture engine's
  // initial value (Svelte's state_referenced_locally warning).
  const cmLang = $derived(isToolchainEngine(engine) ? toolchainLanguage(lang ?? langFor(engine, 'source')) : jsLang);

  // Bundle oneDark only when the *resolved* theme is dark; the light theme
  // falls back to CodeMirror's default highlighting paired with --editor-bg.
  // Use `resolved`, not `current`: `current` may be 'system', and a 'system'
  // choice on a dark OS would otherwise drop oneDark while the rest of the
  // page renders dark.
  const extensions = $derived.by(() => {
    const base: Extension[] = [];
    if (!isToolchainEngine(engine)) {
      const env: Env = { engine, schema: getSchema(engine) };
      base.push(...completionExtensions(engine), syntaxLinter, argCountLinter(env), crossRefLinter(env), unboundLinter(env));
    }
    base.push(...extra);
    if (!readOnly) base.push(diagnosticsCounterPlugin(counter));
    if (readOnly) base.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    return theme.resolved === 'dark' ? [oneDark, ...base] : base;
  });
</script>

<div class="editor" class:read-only={readOnly}>
  {#if resetVisible && !readOnly}
    <IconButton icon="resetCode" title={resetTitle} onClick={onReset} />
  {/if}
  <CodeMirror bind:value={code} lang={cmLang} {extensions} onready={onReady} />
  {#if !readOnly}
    <DiagnosticsCounterComponent {counter} />
  {/if}
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

    /* CodeMirror's default focus outline removed; keyboard users still get
       the global `:focus-visible` ring from app.css on the focused element. */

    :global(.cm-scroller) {
      font-family: ui-monospace, 'SF Mono', Consolas, monospace;
      line-height: 1.5;
    }

    /* CodeMirror adds .cm-tooltip to MY div (same element), not a parent — so
       the selector must be a compound class, not descendant. Previously
       `.cm-tooltip .cm-tooltip-sig-help` never matched, so `white-space: nowrap`
       wasn't applied; the text wrapped, and near-top-of-editor placement
       triggered CM's height-clipping which left line 2 without background. */
    :global(.cm-tooltip-sig-help) {
      padding: 4px 8px;
      font-family: ui-monospace, 'SF Mono', Consolas, monospace;
      font-size: 12px;
      white-space: nowrap;
      color: var(--fg);
      background: var(--bg);
      border: 1px solid var(--cell-border);
      border-radius: 4px;
    }

    :global(.cm-tooltip-sig-help .sig-param) {
      opacity: 0.7;
    }

    :global(.cm-tooltip-sig-help .sig-active) {
      opacity: 1;
      font-weight: 600;
      color: var(--accent, var(--fg));
    }

    :global(.cm-tooltip-sig-help .sig-callee) {
      opacity: 0.9;
    }

    :global(.cm-ip-line) {
      background: color-mix(in srgb, var(--graph-highlight) 18%, transparent);
    }
    :global(.cm-bp-gutter) {
      width: 14px;
    }
    :global(.cm-bp-gutter .cm-gutterElement) {
      cursor: pointer;
    }
    :global(.cm-bp-gutter .cm-gutterElement.cm-bp-unmappable) {
      cursor: not-allowed;
    }
    :global(.cm-bp-gutter .cm-bp-refuse) {
      display: block;
      width: 100%;
      height: 100%;
    }
    :global(.cm-bp-marker) {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 2px;
      border-radius: 50%;
      background: var(--graph-breakpoint);
    }
  }
</style>
