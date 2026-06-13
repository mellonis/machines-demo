import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';

export function computeUnboundDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walker lands in Task 3.
  void syntaxTree;
  void state;
  void env;
  return diagnostics;
}

export function unboundLinter(env: Env): Extension {
  return linter((view) => computeUnboundDiagnostics(view.state, env));
}
