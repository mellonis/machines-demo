// Editor lint source over the toolchain's `check` channel. Positions arrive
// as UTF-16 offsets (the toolchains' `docs/wasm.md (positions)`), which is
// CodeMirror's coordinate, so they map one to one after clamping.
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { Diagnostic } from '../types.ts';

export function mapToolchainDiagnostics(raw: Diagnostic[], docLength: number): CmDiagnostic[] {
  const clamp = (n: number) => Math.max(0, Math.min(n, docLength));
  return raw.map((d) => {
    const from = clamp(d.from);
    const to = Math.max(from, clamp(d.to));
    const out: CmDiagnostic = { from, to, severity: d.severity, message: d.message, source: d.code };
    if (d.fix) {
      const fix = d.fix;
      out.actions = [{
        name: fix.applicability === 'maybeIncorrect' ? `${fix.description} (may be incorrect)` : fix.description,
        apply(view) {
          const len = view.state.doc.length;
          view.dispatch({ changes: fix.edits.map((e) => ({ from: clamp2(e.from, len), to: clamp2(e.to, len), insert: e.replacement })) });
        },
      }];
    }
    return out;
  });
}

function clamp2(n: number, len: number): number { return Math.max(0, Math.min(n, len)); }

export function toolchainLinter(check: () => Promise<Diagnostic[]>): Extension {
  return linter(async (view) => {
    try {
      return mapToolchainDiagnostics(await check(), view.state.doc.length);
    } catch {
      return []; // a dead worker or a superseded request — the next keystroke retries
    }
  }, { delay: 400 });
}
