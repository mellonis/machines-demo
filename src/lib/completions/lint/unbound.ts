import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

/** JS built-ins + the `imports` bridge that the worker passes into user code. */
const GLOBAL_ALLOWLIST = new Set([
  'imports',
  'console', 'Math', 'JSON', 'Date',
  'Array', 'Object', 'Number', 'String', 'Boolean', 'Symbol', 'RegExp',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'undefined', 'NaN', 'Infinity', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
]);

const FUNCTION_NODE_NAMES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunction',
  'MethodDeclaration', 'ClassMethod', 'ClassExpression',
]);

export function computeUnboundDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);
  const { rawLocals } = inferLocalsFor(state, env.schema);

  let funcDepth = 0;
  tree.iterate({
    enter(node) {
      if (FUNCTION_NODE_NAMES.has(node.name)) {
        funcDepth += 1;
        return;
      }
      if (funcDepth > 0) return;
      if (node.name !== 'VariableName') return;
      const name = state.doc.sliceString(node.from, node.to);
      if (rawLocals.has(name)) return;
      if (GLOBAL_ALLOWLIST.has(name)) return;
      diagnostics.push({
        from: node.from,
        to: node.to,
        severity: 'error',
        message: `'${name}' is not defined`,
      });
    },
    leave(node) {
      if (FUNCTION_NODE_NAMES.has(node.name)) {
        funcDepth -= 1;
      }
    },
  });

  return diagnostics;
}

export function unboundLinter(env: Env): Extension {
  return linter((view) => computeUnboundDiagnostics(view.state, env));
}
