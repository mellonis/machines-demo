import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';

export function computeArgCountDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walk implementation lands in Task 3.
  // Silences unused-parameter/import warnings until Task 3 fills the body in.
  void syntaxTree;
  void state;
  void env;
  return diagnostics;
}

export function argCountLinter(env: Env): Extension {
  return linter((view) => computeArgCountDiagnostics(view.state, env));
}
