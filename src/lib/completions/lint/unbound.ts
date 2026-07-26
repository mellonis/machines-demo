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

  // `rawLocals` only carries top-level `const`/`let` and import destructures
  // (the completions scanner's scope). It misses bindings introduced by
  // for / for-of / for-in headers and by top-level block-scoped declarations,
  // so a bare `for (let i ...)` loop variable would be flagged as undefined.
  // Pre-pass collecting every `VariableDefinition` name at depth 0 and treat
  // those as bound; because it walks the whole tree up front, document order is
  // irrelevant — forward references and `var` hoisting fall out for free.
  //
  // Collection is scoped to the same depth the VariableName check runs at, so a
  // name bound only inside a function body (a param or an inner local) does NOT
  // suppress a genuine top-level undefined use of the same name.
  //
  // Two consequences of that shape are worth knowing:
  //  - Block scoping is flattened. A `const x` inside any top-level block marks
  //    `x` bound for the whole file, so a genuinely undefined use of `x`
  //    elsewhere goes unreported. Deliberate — this linter errs toward false
  //    negatives rather than crying wolf on valid code.
  //  - Function-declaration names are NOT collected: entering a
  //    `FunctionDeclaration` bumps the depth before the walk reaches the node
  //    carrying its name, so a top-level call to a hoisted `function foo() {}`
  //    is still flagged. Fixable by reading the name before the bump.
  const definedNames = new Set<string>();
  let collectDepth = 0;
  tree.iterate({
    enter(node) {
      if (FUNCTION_NODE_NAMES.has(node.name)) {
        collectDepth += 1;
        return;
      }
      if (collectDepth > 0) return;
      if (node.name === 'VariableDefinition') {
        definedNames.add(state.doc.sliceString(node.from, node.to));
      }
    },
    leave(node) {
      if (FUNCTION_NODE_NAMES.has(node.name)) {
        collectDepth -= 1;
      }
    },
  });

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
      if (definedNames.has(name)) return;
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
