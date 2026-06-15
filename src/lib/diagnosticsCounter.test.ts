// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { setDiagnostics, linter, type Diagnostic } from '@codemirror/lint';
import { DiagnosticsCounter } from './diagnosticsCounter.svelte.ts';

function stateWith(diagnostics: Diagnostic[]): EditorState {
  // linter(() => []) installs the diagnostic StateField that setDiagnostics
  // writes into. setDiagnostics returns a TransactionSpec (not a raw effect),
  // so it is spread directly into update() — not wrapped in { effects: ... }.
  const initial = EditorState.create({ doc: 'a'.repeat(20), extensions: [linter(() => [])] });
  const tr = initial.update(setDiagnostics(initial, diagnostics));
  return tr.state;
}

function diag(severity: Diagnostic['severity'], from = 0, to = 1, message = 'x'): Diagnostic {
  return { from, to, severity, message };
}

describe('DiagnosticsCounter', () => {
  it('S-diag-empty-state', () => {
    const c = new DiagnosticsCounter();
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(0);
    expect(c.info).toBe(0);
  });

  it('S-diag-count-errors-only', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('error'), diag('error', 1, 2), diag('error', 2, 3)]));
    expect(c.errors).toBe(3);
    expect(c.warnings).toBe(0);
    expect(c.info).toBe(0);
  });

  it('S-diag-count-mixed', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([
      diag('error'),
      diag('warning', 1, 2),
      diag('warning', 2, 3),
      diag('info', 3, 4),
    ]));
    expect(c.errors).toBe(1);
    expect(c.warnings).toBe(2);
    expect(c.info).toBe(1);
  });

  it('S-diag-folds-hint-into-info', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('info'), diag('hint', 1, 2)]));
    expect(c.info).toBe(2);
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(0);
  });

  it('S-diag-update-replaces-previous', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('error'), diag('error', 1, 2)]));
    expect(c.errors).toBe(2);
    c.update(stateWith([diag('warning')]));
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(1);
  });
});
