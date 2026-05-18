# Tape-block copy + paste (serialize / deserialize round-trip) — design

Tracks: [#63](https://github.com/mellonis/machines-demo/issues/63).

## Problem

Three use cases for round-tripping tape-block state via the clipboard:

1. **Share a starting configuration** — paste-recipient gets the same alphabets and tape contents the sender had.
2. **Snapshot before "Take Control" experiments** — capture the current state, hit Take Control, poke around, paste back if you want to redo.
3. **Save a tricky mid-run state for later inspection** — copy a state mid-run, come back to it later and explore via MANUAL.

No current mechanism does this. The user can't share, can't checkpoint, and a Take Control session is one-way.

## Decisions

- **Payload: tapes + per-tape alphabets.** Both are needed for use case (1); use cases (2) and (3) ignore alphabets if they're unchanged, but they fit naturally into the payload. Editor source code is **out of scope** — it's already in localStorage + snippets, and `#63`'s text explicitly notes "the source is already in the editor."
- **Format: JSON.** With nested per-tape alphabets, a custom compact string would be parser-heavy and validation-hostile for negligible payload savings. JSON is human-readable in the clipboard and trivial to validate.
- **Schema discriminator + version.** Top-level `format: "machines-demo.tape-snapshot"` distinguishes our snapshots from random pasted JSON, and `version: 1` gives a future-proofing knob without committing to a migration story today.
- **Copy: always enabled.** Tape state exists in every `executionMode` (DEMO has the demo-loop tape; RUNNING_* has the mirror; MANUAL/HALTED have the user's tape). Copy is a pure read with no side effects.
- **Paste: enabled in MANUAL + DEMO; greyed in all RUNNING_* and HALTED.** Paste replaces mirror tape state, which can't safely interact with a worker that's actively running, mid-step, paused at a break, or holding the post-halt tape. In DEMO, paste auto-takes-control (stops the demo loop, transitions to MANUAL) — mirrors the existing Apply-during-DEMO transition.
- **Paste is mirror-only.** It replaces `lastSnapshots` + `alphabets` + the mirror machine on the main thread. The next Build/Step/Run reloads the worker from the editor's code, **discarding the pasted state** — paste does NOT make the machine resume execution from the snapshot. Supporting that would require a worker `build` variant that accepts `initialTapes`; tracked separately if needed.
- **Atomic application.** Any validation failure → zero state mutation. Either the entire snapshot lands or none of it does.
- **Errors via the existing log.** Same surface as other failures (snippet-not-found, code errors, etc.) — `log.report('paste failed: ...', 'error')` with a categorized message per error reason. No alerts, no toasts.
- **Button placement: alongside Take Control, icons right-aligned.** A `.tape-actions` flex row groups the three "user-controls-tape-state" actions: `[Take Control (fills available space)] [Copy] [Paste]`. Copy / Paste are icon-only with tooltips, anchored at the right edge of the row (`justify-content: flex-end`). When Take Control is hidden (MANUAL / RUNNING_CONTINUOUS / PAUSED_AT_BREAK), the two icon buttons stay pinned to the right of the empty row. Take Control keeps its existing icon + label and uses `flex: 1` so it fills the remaining space without crowding the icons. Paste greys when disabled (matches `Step`/`Run` disabled convention; consistent visual anchoring across modes).
- **Extract `lib/tapeSnapshot.ts`.** Pure serialize/parse with categorized errors — no DOM, no clipboard, no machine knowledge. Unit-testable in isolation. Keeps MachineView focused on orchestration; mirrors the `lib/logStore.svelte.ts` extraction pattern from #45.
- **Clipboard API: `navigator.clipboard.readText` / `writeText`.** Both are well-supported on HTTPS and localhost (the only contexts where the demo runs). No fallback to hidden-textarea hacks — if the API rejects (no permission, no support), surface as a log error.

## Schema

Wire format (formatted JSON, 2-space indent for readability):

```json
{
  "format": "machines-demo.tape-snapshot",
  "version": 1,
  "tapes": [
    { "symbols": [" ", "a", "b", " "], "position": 2 }
  ],
  "alphabets": [
    [" ", "a", "b"]
  ]
}
```

- `format` — fixed string `"machines-demo.tape-snapshot"`.
- `version` — integer `1` for this PR's schema. Unknown values reject with `unsupported-version`.
- `tapes[i].symbols` — array of single-character strings (alphabet symbols). Length unbounded.
- `tapes[i].position` — non-negative integer, head index into `symbols`. Validated `0 ≤ position < symbols.length`.
- `alphabets[i]` — array of single-character strings. First entry is the blank symbol; rest is the alphabet body. Matches the existing `Alphabets` type in `lib/types.ts`.
- `tapes.length === alphabets.length` — N tapes share N alphabets, one per tape.

## Parse errors (categorized)

`parse(text: string): TapeSnapshotPayload | ParseError`. The `ParseError` shape is a discriminated union so callers can render a specific user-facing message per reason:

| `reason` | When | Log message (rendered by MachineView) |
|---|---|---|
| `not-json` | `JSON.parse` throws | `paste failed: not JSON` |
| `wrong-format` | `format` field missing or not `"machines-demo.tape-snapshot"` | `paste failed: not a machines-demo snapshot` |
| `unsupported-version` | `version` is not `1` | `paste failed: unsupported snapshot version (got <N>, expected 1)` |
| `wrong-shape` | missing `tapes`/`alphabets`, wrong types, length mismatch, position out of range | `paste failed: malformed — <detail>` |

`parse` does NOT check tape-count *bounds* — that's a separate guard at the MachineView call site, where `MAX_TAPES` is available. Empty snapshots (`tapes.length === 0`) and over-cap snapshots (`tapes.length > MAX_TAPES`) are rejected with a `paste failed: …` log entry. There is no compatibility check against the *current machine's* emit count — paste is mirror-only and the user is implicitly taking control, so they're free to paste any in-bounds snapshot regardless of what the editor's code would emit on the next Build.

## File map

| File | Change | Roughly |
|---|---|---|
| `src/lib/tapeSnapshot.ts` | **Create** — `SNAPSHOT_FORMAT` / `SNAPSHOT_VERSION` constants, `TapeSnapshotPayload` + `ParseError` types, `serialize(tapes, alphabets) → string`, `parse(text) → payload \| ParseError`. | ~80 lines |
| `src/lib/tapeSnapshot.test.ts` | **Create** — node-env Vitest suite, ~7 scenarios (see Test plan). | ~120 lines |
| `src/lib/icons.ts` | **Modify** — add `clipboard` and `clipboardPlus` (or equivalents from Tabler) icon imports. | +2 lines |
| `src/components/MachineView.svelte` | **Modify** — wrap existing Take Control button in `.tape-actions` row (icons right-aligned via `justify-content: flex-end`; Take Control uses `flex: 1`); add Copy/Paste icon buttons; add `onCopy()` / `onPaste()` handlers; add `pasteEnabled` $derived; `MAX_TAPES` upper bound + empty-snapshot lower bound at paste site; `await tick()` before `setAllFromMirror()` (tape count can change). Adds `MAX_TAPES` to the existing `caps` import. | ~55 lines added |
| `docs/execution-model.md` | **Modify** — extend §14 `<topic>` row to include `tapeSnapshot.test.ts` topics. | +1 line |

`Log.svelte`, `lib/logStore.svelte.ts`, `lib/caps.ts`, `lib/log.ts`, the worker, and the protocol are all unchanged.

## Test plan

New file `src/lib/tapeSnapshot.test.ts`, node environment, pure unit tests. Scenario IDs use the existing `R-` prefix.

| ID | What it verifies |
|---|---|
| `R-snapshot-roundtrip` | `serialize` then `parse` of the same input returns a deep-equal payload (with `format`, `version`, `tapes`, `alphabets`). |
| `R-snapshot-parse-not-json` | `parse('garbage')` returns `{ reason: 'not-json' }`. |
| `R-snapshot-parse-wrong-format` | JSON without `format` field; with `format: 'something-else'` — both return `{ reason: 'wrong-format', got: ... }`. |
| `R-snapshot-parse-unsupported-version` | `version: 99` returns `{ reason: 'unsupported-version', got: 99 }`. |
| `R-snapshot-parse-wrong-shape-tapes` | Missing `tapes`, non-array `tapes`, tape entry missing `symbols`/`position`, non-string symbols, `position` out of range — all `{ reason: 'wrong-shape', detail: ... }`. |
| `R-snapshot-parse-wrong-shape-alphabets` | Missing `alphabets`, non-array, alphabet entry not array of strings — all `{ reason: 'wrong-shape', detail: ... }`. |
| `R-snapshot-parse-length-mismatch` | `tapes.length !== alphabets.length` → `{ reason: 'wrong-shape', detail: ... }`. |

No component tests for the Copy/Paste buttons themselves — UI wiring is mechanical (1:1 handler calls + a `pasteEnabled` derived). A Playwright smoke test for the round-trip flow (click Copy in DEMO → switch to MANUAL → click Paste → tape restored) would be nice-to-have but is **out of scope** here; the unit tests over `tapeSnapshot.ts` cover the validation surface, and the integration is small enough to verify via manual smoke.

## Out of scope

- **Resume execution from pasted state.** Requires a worker `build` variant that accepts `initialTapes`. Tracked separately if needed.
- **URL / share-link encoding.** This PR ships JSON-via-clipboard only. A future PR can layer base64 / compression / `encodeURIComponent` on top of the same `serialize` / `parse` for shorter shareable URLs.
- **Snippet integration.** Snippets store editor code, not tape state — different concept. Not blending the two.
- **History / undo of paste.** Paste is destructive (replaces tape state). User wants an undo? They should Copy first.
- **Multi-machine snapshots.** The snapshot format only carries the data for the current MachineView's engine; no cross-engine portability. A Turing-style snapshot pasted into the Post tab is technically permitted (alphabets and tapes pass shape validation), but the alphabet glyphs won't match the Post engine's `{blank, mark}` semantics — the user gets a visually loaded but semantically meaningless tape. Not worth a separate rejection rule today.
