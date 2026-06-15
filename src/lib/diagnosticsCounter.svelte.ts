import { forEachDiagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

/**
 * Aggregates current lint diagnostics by severity. The three $state fields
 * are written by update(state) (called from diagnosticsCounterPlugin) and
 * read reactively by <DiagnosticsCounter>.
 *
 * Info-tier severities (info + hint) are folded into a single info count —
 * the demo's linters don't emit hint today and unlikely to.
 */
export class DiagnosticsCounter {
  errors = $state(0);
  warnings = $state(0);
  info = $state(0);

  update(state: EditorState): void {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    forEachDiagnostic(state, (d) => {
      if (d.severity === 'error') errors += 1;
      else if (d.severity === 'warning') warnings += 1;
      else info += 1; // info or hint
    });
    this.errors = errors;
    this.warnings = warnings;
    this.info = info;
  }
}
