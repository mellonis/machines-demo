# Tape-block copy + paste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Copy and Paste icon buttons next to "Take Control" in `MachineView`'s tape area. Copy serializes the current tape block (per-tape symbols/head + per-tape alphabets) to a JSON snapshot in the clipboard. Paste validates and applies a snapshot to the mirror (MANUAL/DEMO modes only; DEMO auto-takes-control). Paste is mirror-only — subsequent Build/Step/Run reloads the worker from the editor's code and discards the pasted state.

**Architecture:** New pure module `src/lib/tapeSnapshot.ts` owns `serialize()` and `parse()` with categorized `ParseError` results. `MachineView` wires Copy/Paste buttons in a `.tape-actions` flex row alongside the existing Take Control button, adds `onCopy()` / `onPaste()` handlers, validates tape-count compatibility, and surfaces all errors via `log.report(..., 'error')`. No worker protocol changes.

**Tech Stack:** Svelte 5 (runes — `$state`, `$derived`), TypeScript 5.x, Vitest 2.x (node env), `navigator.clipboard` API. No new dependencies; two new Tabler icon imports.

**Spec:** `docs/superpowers/specs/2026-05-18-tape-snapshot-copy-paste-design.md`

**Tracks:** [#63](https://github.com/mellonis/machines-demo/issues/63).

---

## File map

| File | Change |
|---|---|
| `src/lib/tapeSnapshot.ts` | **Create** — `SNAPSHOT_FORMAT` / `SNAPSHOT_VERSION` constants, `TapeSnapshotPayload` + `ParseError` types, `serialize(tapes, alphabets) → string`, `parse(text) → TapeSnapshotPayload \| ParseError`. |
| `src/lib/tapeSnapshot.test.ts` | **Create** — 7 Vitest unit tests (node env), one per scenario. |
| `src/lib/icons.ts` | **Modify** — add `copy` (Tabler `copy.svg`) and `clipboard` (Tabler `clipboard.svg`) imports + entries in the `icons` map and `IconName` type. |
| `src/components/MachineView.svelte` | **Modify** — add `tapeSnapshot` import, `pasteEnabled` $derived, `onCopy()` / `onPaste()` handlers; wrap the existing Take Control button plus two new icon buttons in a `.tape-actions` flex row; add CSS for `.tape-actions` and `.tape-action-btn`. |
| `docs/execution-model.md` | **Modify** — extend §14 `<topic>` row to register `tapeSnapshot.test.ts` topics. |

`Log.svelte`, `lib/logStore.svelte.ts`, `lib/caps.ts`, `lib/log.ts`, the worker, and the protocol are all unchanged.

---

## Verification model

Each task ends with one or more of these checks:

1. `npm run check` — `svelte-check` + `tsc --noEmit`. Must exit 0.
2. `npm run lint` — ESLint flat config. Must exit 0.
3. `npm test` — Vitest one-shot. After T3 lands the first new test, each test-adding task expects the passing count to grow by 1.
4. `npm run dev` manual smoke (only at T10) — exercise copy/paste end-to-end in the browser.

---

## Task 1: Extend §14 Scenario ID grammar

**Files:**
- Modify: `docs/execution-model.md`

- [ ] **Step 1: Update the `<topic>` row**

In `## 14. Scenario ID grammar`, find the row beginning with `| \`<topic>\` (R / C / E) |`. Replace the value cell to add a `tapeSnapshot.test.ts` entry. The whole row becomes:

```markdown
| `<topic>` (R / C / E) | `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. `logStore.test.ts`: `buffer-append`, `cap-overflow`, `cap-boundary`, `separator-skip-empty`, `latest-skips-separator`, `latest-synchronous`, `clear`, `dispose`, `flush-coalesce`, `flush-no-pending-timer`. `tapeSnapshot.test.ts`: `roundtrip`, `parse-not-json`, `parse-wrong-format`, `parse-unsupported-version`, `parse-wrong-shape-tapes`, `parse-wrong-shape-alphabets`, `parse-length-mismatch`. `Toolbar.test.ts`: `run-label`, `disabled`, `visibility`, `interval`, `callbacks`. `e2e/cold-start.spec.ts`: `cold-start`, `continue-from-step`, `stop-while-paused`. |
```

- [ ] **Step 2: Verify**

Run: `grep -c "tapeSnapshot.test.ts" docs/execution-model.md`
Expected: `1`

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/execution-model.md
git commit -m "docs: register tapeSnapshot.test.ts topics in scenario ID grammar"
```

---

## Task 2: Add `copy` and `clipboard` icons

**Files:**
- Modify: `src/lib/icons.ts`

- [ ] **Step 1: Add the two new icon imports**

At the top of `src/lib/icons.ts`, in alphabetical order with the existing imports, add:

```typescript
import clipboard from '@tabler/icons/outline/clipboard.svg?raw';
import copy from '@tabler/icons/outline/copy.svg?raw';
```

(`clipboard` belongs alphabetically between `build` and `deviceDesktop`; `copy` belongs between `clipboard` and `deviceDesktop`.)

- [ ] **Step 2: Add the two icons to the `icons` map**

The existing `icons` object literal must include the two new entries. They go in alphabetical order, matching how the file currently lists them. Append them at the appropriate positions in the object.

- [ ] **Step 3: Confirm `IconName` type updates automatically**

`IconName` is derived from `keyof typeof icons`, so adding new entries to the map automatically makes them valid `IconName` values. Verify by running:

Run: `npm run check`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/icons.ts
git commit -m "icons: add copy + clipboard (for tape snapshot actions)"
```

---

## Task 3: Create `tapeSnapshot.ts` with `serialize` + minimal `parse`; first test (R-snapshot-roundtrip)

**Files:**
- Create: `src/lib/tapeSnapshot.ts`
- Create: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tapeSnapshot.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  parse,
  serialize,
} from './tapeSnapshot.ts';
import type { Alphabets, TapeSnapshot } from './types.ts';

describe('tapeSnapshot', () => {
  describe('roundtrip', () => {
    it('R-snapshot-roundtrip: serialize → parse returns a deep-equal payload', () => {
      const tapes: TapeSnapshot[] = [
        { symbols: [' ', 'a', 'b', ' '], position: 2 },
      ];
      const alphabets: Alphabets = [[' ', 'a', 'b']];

      const text = serialize(tapes, alphabets);
      const parsed = parse(text);

      expect(parsed).toEqual({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        tapes,
        alphabets,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL with module-not-found for `./tapeSnapshot.ts`.

- [ ] **Step 3: Create the minimal `tapeSnapshot.ts` to pass**

Create `src/lib/tapeSnapshot.ts`:

```typescript
import type { Alphabets, TapeSnapshot } from './types.ts';

export const SNAPSHOT_FORMAT = 'machines-demo.tape-snapshot';
export const SNAPSHOT_VERSION = 1;

export type TapeSnapshotPayload = {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  tapes: TapeSnapshot[];
  alphabets: Alphabets;
};

export type ParseError =
  | { reason: 'not-json' }
  | { reason: 'wrong-format'; got: unknown }
  | { reason: 'unsupported-version'; got: number }
  | { reason: 'wrong-shape'; detail: string };

export function serialize(tapes: TapeSnapshot[], alphabets: Alphabets): string {
  const payload: TapeSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    tapes,
    alphabets,
  };
  return JSON.stringify(payload, null, 2);
}

export function parse(text: string): TapeSnapshotPayload | ParseError {
  // T3: minimal happy-path parse. Subsequent tasks add validation layers
  // for not-json, wrong-format, unsupported-version, and wrong-shape.
  return JSON.parse(text) as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Verify**

Run: `npm run check` → exit 0.
Run: `npm run lint` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: scaffold module with serialize + minimal parse (R-snapshot-roundtrip)"
```

---

## Task 4: Add `not-json` parse handling (R-snapshot-parse-not-json)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/lib/tapeSnapshot.test.ts` (inside the outer `describe('tapeSnapshot', …)`):

```typescript
describe('parse-not-json', () => {
  it('R-snapshot-parse-not-json: returns { reason: "not-json" } on JSON.parse failure', () => {
    expect(parse('not valid json')).toEqual({ reason: 'not-json' });
    expect(parse('{ unterminated')).toEqual({ reason: 'not-json' });
    expect(parse('')).toEqual({ reason: 'not-json' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — the current `parse` does `JSON.parse(text)` without try/catch, so it throws on bad input.

- [ ] **Step 3: Wrap `JSON.parse` with error handling**

In `src/lib/tapeSnapshot.ts`, replace the body of `parse` with:

```typescript
export function parse(text: string): TapeSnapshotPayload | ParseError {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { reason: 'not-json' };
  }
  return raw as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: parse catches JSON.parse errors (R-snapshot-parse-not-json)"
```

---

## Task 5: Add `wrong-format` parse handling (R-snapshot-parse-wrong-format)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tapeSnapshot.test.ts`:

```typescript
describe('parse-wrong-format', () => {
  it('R-snapshot-parse-wrong-format: returns { reason: "wrong-format" } when format field is missing or wrong', () => {
    // Missing format.
    const missing = JSON.stringify({
      version: 1,
      tapes: [{ symbols: [' '], position: 0 }],
      alphabets: [[' ']],
    });
    expect(parse(missing)).toEqual({ reason: 'wrong-format', got: undefined });

    // Wrong format string.
    const wrong = JSON.stringify({
      format: 'something-else',
      version: 1,
      tapes: [{ symbols: [' '], position: 0 }],
      alphabets: [[' ']],
    });
    expect(parse(wrong)).toEqual({ reason: 'wrong-format', got: 'something-else' });

    // Top-level not an object.
    expect(parse('null')).toEqual({ reason: 'wrong-format', got: undefined });
    expect(parse('"a string"')).toEqual({ reason: 'wrong-format', got: undefined });
    expect(parse('[]')).toEqual({ reason: 'wrong-format', got: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — current parse returns whatever raw is, without format validation.

- [ ] **Step 3: Add format validation**

In `src/lib/tapeSnapshot.ts`, replace the body of `parse` with:

```typescript
export function parse(text: string): TapeSnapshotPayload | ParseError {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { reason: 'not-json' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'wrong-format', got: undefined };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.format !== SNAPSHOT_FORMAT) {
    return { reason: 'wrong-format', got: obj.format };
  }

  return obj as unknown as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: validate format discriminator (R-snapshot-parse-wrong-format)"
```

---

## Task 6: Add `unsupported-version` parse handling (R-snapshot-parse-unsupported-version)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tapeSnapshot.test.ts`:

```typescript
describe('parse-unsupported-version', () => {
  it('R-snapshot-parse-unsupported-version: returns { reason: "unsupported-version", got: N } for version !== 1', () => {
    const v99 = JSON.stringify({
      format: SNAPSHOT_FORMAT,
      version: 99,
      tapes: [{ symbols: [' '], position: 0 }],
      alphabets: [[' ']],
    });
    expect(parse(v99)).toEqual({ reason: 'unsupported-version', got: 99 });

    const v0 = JSON.stringify({
      format: SNAPSHOT_FORMAT,
      version: 0,
      tapes: [{ symbols: [' '], position: 0 }],
      alphabets: [[' ']],
    });
    expect(parse(v0)).toEqual({ reason: 'unsupported-version', got: 0 });

    // Non-number version → still treated as unsupported (with NaN as the `got`).
    const vStr = JSON.stringify({
      format: SNAPSHOT_FORMAT,
      version: 'one',
      tapes: [{ symbols: [' '], position: 0 }],
      alphabets: [[' ']],
    });
    const result = parse(vStr);
    expect(result).toMatchObject({ reason: 'unsupported-version' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — current parse doesn't check version.

- [ ] **Step 3: Add version validation**

In `src/lib/tapeSnapshot.ts`, insert the version check after the format check in `parse`:

```typescript
  if (obj.format !== SNAPSHOT_FORMAT) {
    return { reason: 'wrong-format', got: obj.format };
  }

  if (obj.version !== SNAPSHOT_VERSION) {
    return { reason: 'unsupported-version', got: obj.version as number };
  }

  return obj as unknown as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: validate version field (R-snapshot-parse-unsupported-version)"
```

---

## Task 7: Add `wrong-shape-tapes` parse handling (R-snapshot-parse-wrong-shape-tapes)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tapeSnapshot.test.ts`:

```typescript
describe('parse-wrong-shape-tapes', () => {
  const baseValid = {
    format: SNAPSHOT_FORMAT,
    version: 1,
    alphabets: [[' ', 'a']],
  };

  const expectWrongShape = (text: string): void => {
    const result = parse(text);
    expect(result).toMatchObject({ reason: 'wrong-shape' });
  };

  it('R-snapshot-parse-wrong-shape-tapes: missing or non-array tapes', () => {
    expectWrongShape(JSON.stringify({ ...baseValid }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: 'not-array' }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: null }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: {} }));
  });

  it('R-snapshot-parse-wrong-shape-tapes: tape entry missing symbols or position', () => {
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ position: 0 }] }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' '] }] }));
  });

  it('R-snapshot-parse-wrong-shape-tapes: symbols must be array of strings', () => {
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: 'abc', position: 0 }] }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [1, 2], position: 0 }] }));
  });

  it('R-snapshot-parse-wrong-shape-tapes: position must be non-negative integer in range', () => {
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: -1 }] }));
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: 2 }] }));   // out of range
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: 0.5 }] })); // not integer
    expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [], position: 0 }] }));            // empty symbols
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — current parse doesn't validate tapes shape.

- [ ] **Step 3: Add tapes shape validation**

In `src/lib/tapeSnapshot.ts`, insert the tapes validation after the version check in `parse`:

```typescript
  if (obj.version !== SNAPSHOT_VERSION) {
    return { reason: 'unsupported-version', got: obj.version as number };
  }

  if (!Array.isArray(obj.tapes)) {
    return { reason: 'wrong-shape', detail: 'tapes missing or not an array' };
  }

  for (let i = 0; i < obj.tapes.length; i++) {
    const t = obj.tapes[i];
    if (typeof t !== 'object' || t === null || Array.isArray(t)) {
      return { reason: 'wrong-shape', detail: `tapes[${i}] is not an object` };
    }
    const tape = t as Record<string, unknown>;
    if (!Array.isArray(tape.symbols) || !tape.symbols.every((s) => typeof s === 'string')) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].symbols must be string[]` };
    }
    if (typeof tape.position !== 'number' || !Number.isInteger(tape.position)) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].position must be an integer` };
    }
    if (tape.position < 0 || tape.position >= tape.symbols.length) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].position ${tape.position} out of range [0, ${tape.symbols.length})` };
    }
  }

  return obj as unknown as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (8 tests — the new `describe` adds 4 `it` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: validate tapes shape + position range (R-snapshot-parse-wrong-shape-tapes)"
```

---

## Task 8: Add `wrong-shape-alphabets` parse handling (R-snapshot-parse-wrong-shape-alphabets)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tapeSnapshot.test.ts`:

```typescript
describe('parse-wrong-shape-alphabets', () => {
  const baseValid = {
    format: SNAPSHOT_FORMAT,
    version: 1,
    tapes: [{ symbols: [' ', 'a'], position: 0 }],
  };

  const expectWrongShape = (text: string): void => {
    const result = parse(text);
    expect(result).toMatchObject({ reason: 'wrong-shape' });
  };

  it('R-snapshot-parse-wrong-shape-alphabets: missing or non-array alphabets', () => {
    expectWrongShape(JSON.stringify({ ...baseValid }));
    expectWrongShape(JSON.stringify({ ...baseValid, alphabets: 'not-array' }));
    expectWrongShape(JSON.stringify({ ...baseValid, alphabets: null }));
  });

  it('R-snapshot-parse-wrong-shape-alphabets: alphabet entry must be array of strings', () => {
    expectWrongShape(JSON.stringify({ ...baseValid, alphabets: ['not-array'] }));
    expectWrongShape(JSON.stringify({ ...baseValid, alphabets: [[1, 2, 3]] }));
    expectWrongShape(JSON.stringify({ ...baseValid, alphabets: [null] }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — current parse doesn't validate alphabets.

- [ ] **Step 3: Add alphabets shape validation**

In `src/lib/tapeSnapshot.ts`, insert the alphabets validation after the tapes-loop validation in `parse`:

```typescript
    if (tape.position < 0 || tape.position >= tape.symbols.length) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].position ${tape.position} out of range [0, ${tape.symbols.length})` };
    }
  }

  if (!Array.isArray(obj.alphabets)) {
    return { reason: 'wrong-shape', detail: 'alphabets missing or not an array' };
  }

  for (let i = 0; i < obj.alphabets.length; i++) {
    const a = obj.alphabets[i];
    if (!Array.isArray(a) || !a.every((s) => typeof s === 'string')) {
      return { reason: 'wrong-shape', detail: `alphabets[${i}] must be string[]` };
    }
  }

  return obj as unknown as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: validate alphabets shape (R-snapshot-parse-wrong-shape-alphabets)"
```

---

## Task 9: Add `length-mismatch` parse handling (R-snapshot-parse-length-mismatch)

**Files:**
- Modify: `src/lib/tapeSnapshot.ts`
- Modify: `src/lib/tapeSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tapeSnapshot.test.ts`:

```typescript
describe('parse-length-mismatch', () => {
  it('R-snapshot-parse-length-mismatch: tapes.length !== alphabets.length → wrong-shape', () => {
    const result = parse(JSON.stringify({
      format: SNAPSHOT_FORMAT,
      version: 1,
      tapes: [
        { symbols: [' '], position: 0 },
        { symbols: [' '], position: 0 },
      ],
      alphabets: [[' ']],  // only 1 alphabet for 2 tapes
    }));
    expect(result).toMatchObject({ reason: 'wrong-shape' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: FAIL — current parse doesn't check length equality.

- [ ] **Step 3: Add length-mismatch validation**

In `src/lib/tapeSnapshot.ts`, insert the length check just before the final `return obj as ...` line in `parse`:

```typescript
  for (let i = 0; i < obj.alphabets.length; i++) {
    const a = obj.alphabets[i];
    if (!Array.isArray(a) || !a.every((s) => typeof s === 'string')) {
      return { reason: 'wrong-shape', detail: `alphabets[${i}] must be string[]` };
    }
  }

  if (obj.tapes.length !== obj.alphabets.length) {
    return {
      reason: 'wrong-shape',
      detail: `tape count (${obj.tapes.length}) does not match alphabet count (${obj.alphabets.length})`,
    };
  }

  return obj as unknown as TapeSnapshotPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/tapeSnapshot.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tapeSnapshot.ts src/lib/tapeSnapshot.test.ts
git commit -m "tapeSnapshot: validate tapes.length === alphabets.length (R-snapshot-parse-length-mismatch)"
```

---

## Task 10: Wire Copy / Paste buttons into `MachineView.svelte`

**Files:**
- Modify: `src/components/MachineView.svelte`

This task adds: imports, `pasteEnabled` $derived, `onCopy()` / `onPaste()` handlers, the markup row, and the CSS.

- [ ] **Step 1: Add imports**

In the import block of `MachineView.svelte` (near the existing icon and lib imports, around line 14), add:

```typescript
import { parse as parseSnapshot, serialize as serializeSnapshot } from '../lib/tapeSnapshot.ts';
```

- [ ] **Step 2: Add `pasteEnabled` $derived**

Find the existing `takeControlVisible` $derived (around line 157) and add `pasteEnabled` right below it:

```typescript
const takeControlVisible = $derived(
  executionMode !== 'MANUAL' &&
  executionMode !== 'RUNNING_CONTINUOUS' &&
  executionMode !== 'RUNNING_PAUSED_AT_BREAK',
);
const pasteEnabled = $derived(
  executionMode === 'MANUAL' || executionMode === 'DEMO',
);
```

- [ ] **Step 3: Add `onCopy` handler**

Find the `takeControl()` function (around line 567). Add `onCopy()` right above it:

```typescript
async function onCopy(): Promise<void> {
  if (!lastSnapshots) {
    log.report('copy failed: no tape state to copy', 'error');
    return;
  }
  try {
    const text = serializeSnapshot(lastSnapshots, alphabets);
    await navigator.clipboard.writeText(text);
    const n = lastSnapshots.length;
    log.report(`copied ${n}-tape snapshot`, 'ok');
  } catch {
    log.report('copy failed: clipboard unavailable', 'error');
  }
}
```

- [ ] **Step 4: Add `onPaste` handler**

Right below `onCopy`, add `onPaste()`:

```typescript
async function onPaste(): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    log.report('paste failed: clipboard unavailable', 'error');
    return;
  }

  const result = parseSnapshot(text);
  if ('reason' in result) {
    switch (result.reason) {
      case 'not-json':
        log.report('paste failed: not JSON', 'error');
        return;
      case 'wrong-format':
        log.report('paste failed: not a machines-demo snapshot', 'error');
        return;
      case 'unsupported-version':
        log.report(`paste failed: unsupported snapshot version (got ${result.got}, expected 1)`, 'error');
        return;
      case 'wrong-shape':
        log.report(`paste failed: malformed — ${result.detail}`, 'error');
        return;
    }
  }

  // Tape-count compatibility check against the current machine.
  if (lastSnapshots && result.tapes.length !== lastSnapshots.length) {
    log.report(
      `paste failed: snapshot has ${result.tapes.length} tapes, current machine emits ${lastSnapshots.length}`,
      'error',
    );
    return;
  }

  // DEMO auto-take-control. After this, executionMode is MANUAL and
  // demoEnabled is false, matching the existing Apply-during-DEMO transition.
  if (executionMode === 'DEMO') {
    demoEnabled = false;
    userTookControl = true;
    executionMode = 'MANUAL';
  }

  alphabets = result.alphabets;
  lastSnapshots = result.tapes;
  _buildMirrorMachine(result.tapes, result.alphabets);
  setAllFromMirror();

  log.report(`pasted ${result.tapes.length}-tape snapshot`, 'ok');
}
```

- [ ] **Step 5: Update markup — wrap Take Control + add Copy/Paste buttons**

Find the existing `{#if takeControlVisible}` block in the markup (around line 734):

```svelte
{#if takeControlVisible}
  <button class="take-control" type="button" onclick={takeControl}>
    {@html icons.takeControl}
    <span class="btn-label">Take control</span>
  </button>
{/if}
```

Replace it with:

```svelte
<div class="tape-actions">
  <button
    class="tape-action-btn"
    type="button"
    onclick={onCopy}
    title="Copy tape state"
    aria-label="Copy tape state"
  >
    {@html icons.copy}
  </button>
  <button
    class="tape-action-btn"
    type="button"
    onclick={onPaste}
    disabled={!pasteEnabled}
    title="Paste tape state"
    aria-label="Paste tape state"
  >
    {@html icons.clipboard}
  </button>
  {#if takeControlVisible}
    <button class="take-control" type="button" onclick={takeControl}>
      {@html icons.takeControl}
      <span class="btn-label">Take control</span>
    </button>
  {/if}
</div>
```

- [ ] **Step 6: Add CSS for `.tape-actions` and `.tape-action-btn`**

Find the existing `.take-control` style block (around line 849) and add a new block immediately before it:

```css
.tape-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.tape-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--cell-border);
  color: var(--muted);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color var(--anim-button-hover-ms) ease,
    border-color var(--anim-button-hover-ms) ease,
    color var(--anim-button-hover-ms) ease;

  &:hover:not(:disabled) {
    background: var(--hover-bg);
    color: var(--fg);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
  }
}
```

Inside the existing `.take-control` rule, `width: 100%` will force Take Control to expand and consume the remaining horizontal space in the `.tape-actions` row, keeping the two square buttons compact on the left. Verify this works as expected during the manual smoke (Step 9).

- [ ] **Step 7: Verify**

Run: `npm run check` → exit 0.
Run: `npm run lint` → exit 0.
Run: `npm test` → confirm all tests pass (11 LogStore + 11 tapeSnapshot + existing component / runner / worker tests).

- [ ] **Step 8: Build smoke**

Run: `npm run build`
Expected: production build succeeds. No new chunk-size warnings beyond what existed before.

- [ ] **Step 9: Manual smoke (dev server)**

Run: `npm run dev`

In the browser, exercise these flows on the Turing tab:

1. **Copy in DEMO** — Page loads; demo loop is running. Click Copy (clipboard icon). Log shows `copied 1-tape snapshot` in green. Paste into a text editor and confirm the JSON has `format`, `version: 1`, `tapes`, `alphabets`.
2. **Paste in DEMO (auto-take-control)** — Edit the copied JSON: change `tapes[0].symbols` and `tapes[0].position`. Copy the modified JSON. In the browser, click Paste. Log shows the user-took-control transition and `pasted 1-tape snapshot`. The tape display reflects the modified state. Demo loop has stopped (executionMode is MANUAL).
3. **Paste in MANUAL** — Modify the snapshot again. Click Paste. Tape updates without a Take Control message (already in MANUAL).
4. **Paste in RUNNING_*** — Click Build, then Run. While running, the Paste button is disabled (greyed). Confirm by hovering — tooltip should still show "Paste tape state" but the button is not clickable.
5. **Paste with malformed JSON** — Manually copy `not valid json` to the clipboard via a text editor. Click Paste. Log shows `paste failed: not JSON` (red).
6. **Paste with wrong format** — Copy `{"format": "other", "version": 1, "tapes": [], "alphabets": []}`. Click Paste. Log shows `paste failed: not a machines-demo snapshot`.
7. **Paste with tape-count mismatch** — Hand-craft a 2-tape snapshot. The default Turing example is 1-tape. Paste it. Log shows the tape-count mismatch error.
8. **Switch engine tab** — Switch to Post tab. The tape-actions row should render with the new instance's state (fresh log, fresh tape).
9. **Mobile layout** — In DevTools, set the viewport to ≤768px. Confirm the tape-actions row still looks sensible (Take Control expands; the two icon buttons remain on the left).

Stop the dev server when satisfied.

- [ ] **Step 10: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: wire copy + paste tape-snapshot actions (closes #63)"
```

---

## Task 11: Final verification

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Full check + lint + tests + build**

Run sequentially:

```bash
npm run check && npm run lint && npm test && npm run build
```

Expected: all exit 0. Vitest reports the 11 new `tapeSnapshot` tests (across 7 scenarios) passing plus every pre-existing test.

- [ ] **Step 2: Spec coverage**

Spot-check against `docs/superpowers/specs/2026-05-18-tape-snapshot-copy-paste-design.md`:

| Spec decision | Implemented in |
|---|---|
| Payload: tapes + per-tape alphabets | T3 (`serialize` shape) |
| Format: JSON | T3 (`JSON.stringify` in `serialize`) |
| Schema discriminator + version | T3 (constants) + T5 + T6 |
| Copy always enabled | T10 (no disabled binding on Copy button) |
| Paste enabled in MANUAL + DEMO; greyed elsewhere | T10 (`pasteEnabled` $derived) |
| Paste is mirror-only | T10 (`onPaste` updates state, no worker round-trip) |
| Atomic application | T10 (`onPaste` only mutates state after all checks pass) |
| Errors via existing log | T10 (`log.report(..., 'error')` for each branch) |
| Button placement: alongside Take Control | T10 (`.tape-actions` wraps all three) |
| Extract `lib/tapeSnapshot.ts` | T3 |
| Clipboard API | T10 (`navigator.clipboard.writeText/readText`) |

- [ ] **Step 3: No leftover stubs**

Run: `grep -nE 'TODO|FIXME|XXX' src/lib/tapeSnapshot.ts src/components/MachineView.svelte`
Expected: no matches.

- [ ] **Step 4: No commit needed** — verification only.
