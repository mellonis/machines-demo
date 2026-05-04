import { linter, type Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';

/**
 * Editor preflight using the Lezer JS parser already loaded by
 * @codemirror/lang-javascript. Catches obvious syntax errors (unclosed braces,
 * missing parens, etc.) before the user clicks Build. Does NOT catch semantic
 * issues like `let const = 1` — for that you'd need a real type checker.
 */
export const syntaxLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  syntaxTree(view.state)
    .cursor()
    .iterate((node) => {
      if (node.type.isError) {
        diagnostics.push({
          from: node.from,
          to: Math.max(node.from + 1, node.to),
          severity: 'error',
          message: 'syntax error',
        });
      }
    });
  return diagnostics;
});
