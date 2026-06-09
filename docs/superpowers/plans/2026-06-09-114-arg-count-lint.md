# Arg-Count Linter (Phase 1 of #114) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CodeMirror lint source that emits diagnostics when a known callable (schema-modelled namespace function, post-instruction, constructor, or member method) is called with the wrong number of arguments, including the bare-only `stop` case.

**Architecture:** Walk the Lezer syntax tree for every `CallExpression` / `NewExpression`; reuse the resolver from `src/lib/completions/hints/signature.ts` (exported as part of this plan) to classify the callee against the engine schema; count actual args from the `ArgList`'s direct children; emit `error` for too-few / bare-only-called-as-fn, `warning` for too-many. New module lives under `src/lib/completions/lint/`. Pure compute function is testable without DOM; the linter wrapper is a one-line `@codemirror/lint` `linter(...)` call.

**Tech Stack:** CodeMirror 6 (`@codemirror/lint` for the linter source + `Diagnostic` type, `@codemirror/language`'s `syntaxTree` for the walk), `@lezer/common` for tree walking, Vitest.

**Scope decisions (locked):**

- **Severity model:** missing required args + bare-only-called-as-function are `error`; extras past last declared are `warning`. Matches the issue's table. The diagnostic-counter widget (#106) will eventually surface both columns.
- **Diagnostic range:** the whole `CallExpression` / `NewExpression` (`call.from` to `call.to`). Lights up the entire `mark(...)` not just the `(...)`. Easier to spot in the gutter.
- **Cross-reference validation is OUT OF SCOPE** for this plan — it's Phase 2 of #114 and gets its own plan after this lands. Phase 2 needs a scope walk over the surrounding `new PostMachine(...)` argument; we don't pre-build infrastructure for it here.
- **Non-literal args don't suppress arity checks.** `mark(someVar)` counts as 1 arg (correct count for `mark`'s 1 required param). We're checking the call's arity, not the type/value of the arg.
- **Unknown callees pass silently.** If `resolveCallee` returns `null`, no diagnostic. User-defined functions, library calls we don't know, dynamic dispatch all skipped.
- **Chained member access** (`a.b.c()`) is silently passed through — `resolveCallee` already returns null for these. No new behavior here.

---

## Pre-execution step

Post a one-paragraph comment on [#114](https://github.com/mellonis/machines-demo/issues/114) confirming this plan covers Phase 1 only and that Phase 2 (cross-reference validation) will land in a separate PR. Keeps the issue's reader synced.

---

## File Structure

**New files:**
- `src/lib/completions/lint/argCount.ts` — exports `computeArgCountDiagnostics(state, env): Diagnostic[]` (pure) and `argCountLinter(env): Extension` (CodeMirror wrapper).
- `src/lib/completions/lint/argCount.test.ts` — black-box tests via a new `lintAll(source, engine)` helper.

**Modified files:**
- `src/lib/completions/hints/signature.ts` — `export` the existing `resolveCallee` function (no behavior change). Rename also exposes the helper to outside consumers; the signature-help layer is unchanged.
- `src/lib/testUtils.ts` — add `lintAll(source: string, engine: Engine): Diagnostic[]` helper next to `signatureAt`.
- `src/components/Editor.svelte` — add `argCountLinter(env)` to the extension array (alongside the existing `syntaxLinter`).
- `CLAUDE.md` (machines-demo) — extend the `lint/` directory line under `lib/completions/` in the tree; brief note in the Editor section.

**Why this split** — the pure `computeArgCountDiagnostics` is the unit. The CodeMirror `linter(...)` wrapper has no failure modes worth testing. Sharing `resolveCallee` with signature-help is the right amount of reuse — both layers need to classify the same call expressions, the rules are identical.

---

## Pre-execution: prove the `resolveCallee` signature is usable in tree-walk mode

Before any task, confirm the signature-help's `resolveCallee` is compatible with the tree-walk caller. Currently it takes the `ArgList`. Our linter has the `CallExpression` and needs to walk down to the ArgList.

Read the current signature in `src/lib/completions/hints/signature.ts:67-126` — confirm it does `argList.parent` to reach the call. For the linter we'll go the OPPOSITE direction (call → ArgList child). The shape works as-is; just add an `export` and call it from the linter with the call's ArgList child.

If `resolveCallee` is restructured in the future (e.g. Phase 2 wants a `call`-based signature), the call sites adjust together. For now keep it `argList`-based.

---

### Task 1: Export `resolveCallee` from signature.ts

**Files:**
- Modify: `src/lib/completions/hints/signature.ts:67` (change `function resolveCallee` to `export function resolveCallee`)

- [ ] **Step 1: Add the `export` keyword**

In `src/lib/completions/hints/signature.ts`, find the line:
```ts
function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
```

Change to:
```ts
export function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
```

Also export the `ResolvedCallee` type (it's already declared in `./types.ts` and exported there — verify the import path).

- [ ] **Step 2: Verify nothing broke**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check && npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/`
Expected: 0 errors / warnings, 127 specs pass (unchanged from main).

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/hints/signature.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(completions): export resolveCallee from signature.ts

Preparing the resolver for reuse by the upcoming arg-count linter
(#114). No behavior change — the function is unchanged."
```

---

### Task 2: Lint module skeleton + `lintAll` test helper

Creates the new file with stub `computeArgCountDiagnostics` returning `[]`, plus the test helper so subsequent TDD tasks can import. The CodeMirror `linter(...)` wrapper is added now but not wired into the editor until Task 8.

**Files:**
- Create: `src/lib/completions/lint/argCount.ts`
- Modify: `src/lib/testUtils.ts`

- [ ] **Step 1: Create the skeleton file**

```ts
// src/lib/completions/lint/argCount.ts
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';

export function computeArgCountDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walk implementation lands in Task 3.
  // Silences unused-import warnings until Task 3 fills the body in.
  void syntaxTree;
  void env;
  return diagnostics;
}

export function argCountLinter(env: Env): Extension {
  return linter((view) => computeArgCountDiagnostics(view.state, env));
}
```

- [ ] **Step 2: Add the `lintAll` test helper**

Open `src/lib/testUtils.ts`. Add two new imports at the top alongside the existing imports:

```ts
import type { Diagnostic } from '@codemirror/lint';
import { computeArgCountDiagnostics } from './completions/lint/argCount.ts';
```

Append at the bottom (after `signatureAt`):

```ts
export function lintAll(source: string, engine: Engine): Diagnostic[] {
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc: source,
    extensions: [javascript(), localsField],
  });
  return computeArgCountDiagnostics(state, env);
}
```

- [ ] **Step 3: Verify check + lint clean**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check && npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.ts src/lib/testUtils.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): skeleton + lintAll test helper

Empty walker shell + a lintAll(source, engine) test helper next to
signatureAt. Behavioral tests come in the next commits.

Refs #114."
```

---

### Task 3: Walk + emit for too-few-args (mark, simple case)

**Files:**
- Modify: `src/lib/completions/lint/argCount.ts`
- Create: `src/lib/completions/lint/argCount.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/lint/argCount.test.ts
import { describe, it, expect } from 'vitest';
import { lintAll } from '../../testUtils.ts';

describe('lint/argCount — missing required args', () => {
  it('S-lint-mark-empty-parens', () => {
    const src = `
      const { mark } = imports;
      mark()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('mark requires 1 argument (got 0)');
  });

  it('S-lint-mark-correct', () => {
    const src = `
      const { mark } = imports;
      mark(20)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toEqual([]);
  });

  it('S-lint-call-missing-name', () => {
    const src = `
      const { call } = imports;
      call()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('call requires 1 argument (got 0)');
  });

  it('S-lint-check-missing-branches', () => {
    const src = `
      const { check } = imports;
      check()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('check requires 2 arguments (got 0)');
  });

  it('S-lint-call-with-only-name', () => {
    // call(name) is valid — second jumpTo is optional.
    const src = `
      const { call } = imports;
      call('foo')
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: FAIL — 4 of 5 specs fail (the empty-array case passes by coincidence).

- [ ] **Step 3: Implement the walker**

Replace the body of `computeArgCountDiagnostics` in `src/lib/completions/lint/argCount.ts`:

```ts
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import { resolveCallee } from '../hints/signature.ts';
import type { ParamSpec } from '../schema/types.ts';

function findArgListChild(call: SyntaxNode): SyntaxNode | null {
  let child = call.firstChild;
  while (child) {
    if (child.name === 'ArgList') return child;
    child = child.nextSibling;
  }
  return null;
}

function actualArgCount(argList: SyntaxNode): number {
  let commas = 0;
  let hasExpr = false;
  let child = argList.firstChild;
  while (child) {
    if (child.name === ',') commas += 1;
    else if (child.name !== '(' && child.name !== ')') hasExpr = true;
    child = child.nextSibling;
  }
  return hasExpr ? commas + 1 : 0;
}

function requiredCount(params: ParamSpec[]): number {
  return params.filter((p) => p.optional !== true).length;
}

function pluralArg(n: number): string {
  return n === 1 ? 'argument' : 'arguments';
}

export function computeArgCountDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.name !== 'CallExpression' && node.name !== 'NewExpression') return;
      const call = node.node;
      const argList = findArgListChild(call);
      if (!argList) return;
      const resolved = resolveCallee(argList, state, env);
      if (!resolved) return;

      const actual = actualArgCount(argList);
      const required = requiredCount(resolved.params);

      if (actual < required) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'error',
          message: `${resolved.header} requires ${required} ${pluralArg(required)} (got ${actual})`,
        });
      }
    },
  });

  return diagnostics;
}

export function argCountLinter(env: Env): Extension {
  return linter((view) => computeArgCountDiagnostics(view.state, env));
}
```

Note: the `header` string from `resolveCallee` includes `new ` for `NewExpression` (e.g. `new Alphabet`). For lint messages, that means "new Alphabet requires 1 argument (got 0)" — which reads correctly in context. No special handling needed.

- [ ] **Step 4: Run tests — should pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: PASS (5 specs).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.ts src/lib/completions/lint/argCount.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): missing-required-args diagnostic

Walk CallExpression/NewExpression nodes; resolve callee via signature.ts;
count actual args from the ArgList's direct children; emit error when
actual < required. Optional params (e.g. call's second jumpTo) don't
count toward required.

Refs #114."
```

---

### Task 4: Too-many-args warning

**Files:**
- Modify: `src/lib/completions/lint/argCount.ts`
- Modify: `src/lib/completions/lint/argCount.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('lint/argCount — too many args', () => {
  it('S-lint-mark-too-many', () => {
    const src = `
      const { mark } = imports;
      mark(1, 2)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toBe('mark takes 1 argument (got 2)');
  });

  it('S-lint-mark-three-extras', () => {
    const src = `
      const { mark } = imports;
      mark(1, 2, 3)
    `;
    const diags = lintAll(src, 'post');
    expect(diags[0].message).toBe('mark takes 1 argument (got 3)');
  });

  it('S-lint-call-too-many', () => {
    // call has 2 params (1 required + 1 optional); 3 args is extra.
    const src = `
      const { call } = imports;
      call('foo', 5, 10)
    `;
    const diags = lintAll(src, 'post');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toBe('call takes 2 arguments (got 3)');
  });

  it('S-lint-check-correct-two-args', () => {
    const src = `
      const { check } = imports;
      check(20, 30)
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — 3 of 4 fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts -t "too many args"`
Expected: 3 specs fail (the no-diagnostics correct case passes).

- [ ] **Step 3: Add the too-many branch**

In `computeArgCountDiagnostics`, after the `if (actual < required)` block, add:

```ts
      if (actual > resolved.params.length) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'warning',
          message: `${resolved.header} takes ${resolved.params.length} ${pluralArg(resolved.params.length)} (got ${actual})`,
        });
      }
```

- [ ] **Step 4: Tests should pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: PASS (9 specs).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.ts src/lib/completions/lint/argCount.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): too-many-args warning

Emits a warning (not error) when actual > params.length. Less harsh than
the required-missing case — extras are usually a typo or stale code,
worth flagging but not blocking.

Refs #114."
```

---

### Task 5: Bare-only callable diagnostic (`stop`)

The existing `resolveCallee` filters out post-instructions without a `params` field (returns null for `stop`). The linter needs different behavior: emit an error specifically calling out the bare-only nature. Solution: do a separate schema lookup in the linter for this case (no resolveCallee refactor needed).

**Files:**
- Modify: `src/lib/completions/lint/argCount.ts`
- Modify: `src/lib/completions/lint/argCount.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('lint/argCount — bare-only instructions called', () => {
  it('S-lint-stop-with-parens', () => {
    const src = `
      const { stop } = imports;
      stop()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('stop has no callable form (use bare `stop` instead)');
  });

  it('S-lint-stop-with-arg-still-flagged', () => {
    // Even with an arg, stop(...) is still invalid syntax. One diagnostic,
    // the bare-only error (not arg-count, since there's no callable form to count against).
    const src = `
      const { stop } = imports;
      stop(20)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('stop has no callable form (use bare `stop` instead)');
  });

  it('S-lint-stop-renamed-still-flagged', () => {
    const src = `
      const { stop: halt } = imports;
      halt()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    // Message uses the user-typed alias so the diagnostic points at what's on screen.
    expect(diags[0].message).toBe('halt has no callable form (use bare `stop` instead)');
  });
});
```

- [ ] **Step 2: Run tests — all 3 fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts -t "bare-only"`
Expected: 3 specs fail (no diagnostics emitted today for stop calls).

- [ ] **Step 3: Add bare-only detection**

The detection needs the schema-name behind the call (`stop`, possibly via rename) AND the user-typed alias for the message. Use the same reverse-rename logic as signature.ts.

In `src/lib/completions/lint/argCount.ts`, add these imports and helpers:

```ts
import { inferLocalsFor } from '../scan/locals.ts';

function calleeIdentifier(call: SyntaxNode, state: EditorState): { typed: string; receiverShape: 'bare' | 'member' | 'new' | 'other' } | null {
  if (call.name === 'NewExpression') {
    // Walk past `new` keyword to the VariableName, mirroring signature.ts.
    const first = call.firstChild;
    if (!first) return null;
    const ident = first.name === 'VariableName' ? first : first.nextSibling;
    if (!ident || ident.name !== 'VariableName') return null;
    return { typed: state.doc.sliceString(ident.from, ident.to), receiverShape: 'new' };
  }
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === 'VariableName') {
    return { typed: state.doc.sliceString(callee.from, callee.to), receiverShape: 'bare' };
  }
  if (callee.name === 'MemberExpression') {
    return { typed: state.doc.sliceString(callee.from, callee.to), receiverShape: 'member' };
  }
  return { typed: '', receiverShape: 'other' };
}

function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}

function bareOnlyDiagnostic(call: SyntaxNode, state: EditorState, env: Env): Diagnostic | null {
  const ident = calleeIdentifier(call, state);
  if (!ident || ident.receiverShape !== 'bare') return null;
  const typed = ident.typed;
  const schemaName = env.schema.namespace[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
  const entry = env.schema.namespace[schemaName];
  if (!entry) return null;
  if (entry.kind !== 'post-instruction') return null;
  if (entry.params) return null; // has a callable form; arity check handles it
  return {
    from: call.from,
    to: call.to,
    severity: 'error',
    message: `${typed} has no callable form (use bare \`${schemaName}\` instead)`,
  };
}
```

Now update the walker. In the `enter(node)` callback, BEFORE the `resolveCallee` call, add:

```ts
      const bareOnly = bareOnlyDiagnostic(call, state, env);
      if (bareOnly) {
        diagnostics.push(bareOnly);
        return; // don't also try arity check — resolveCallee returns null here anyway
      }
```

- [ ] **Step 4: Tests should pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: PASS (12 specs).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.ts src/lib/completions/lint/argCount.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): bare-only callable diagnostic

Post-instructions with no params field (currently just stop) have no
callable form. Calling them as functions throws at PostMachine
construction. Emit error pointing the user at the bare-reference fix.
Renamed imports use the user-typed alias in the message so the gutter
matches what's on screen.

Refs #114."
```

---

### Task 6: Constructor + member-method cases

The resolver already handles `new Foo(...)` and `state.tag(...)` — those flow through the existing arity check without new code. This task adds tests to lock in the behavior, plus a small message tweak so `new Foo` reads naturally.

**Files:**
- Modify: `src/lib/completions/lint/argCount.test.ts`

- [ ] **Step 1: Write the tests (append)**

```ts
describe('lint/argCount — constructors and member methods', () => {
  it('S-lint-new-alphabet-empty', () => {
    const src = `new Alphabet()`;
    const diags = lintAll(src, 'turing');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('new Alphabet requires 1 argument (got 0)');
  });

  it('S-lint-new-alphabet-correct', () => {
    const src = `new Alphabet([' ', '*'])`;
    expect(lintAll(src, 'turing')).toEqual([]);
  });

  it('S-lint-new-state-positional-optional-name', () => {
    // State ctor: (symbolToData, name?). Calling with just the first is valid.
    const src = `
      const { State } = imports;
      new State({})
    `;
    expect(lintAll(src, 'turing')).toEqual([]);
  });

  it('S-lint-new-state-missing-required', () => {
    const src = `
      const { State } = imports;
      new State()
    `;
    const diags = lintAll(src, 'turing');
    expect(diags[0].message).toBe('new State requires 1 argument (got 0)');
  });

  it('S-lint-state-tag-empty', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag()
    `;
    const diags = lintAll(src, 'turing');
    // 2 calls in this source: new State({}) (valid, 1 arg), s.tag() (invalid, 0 args).
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('s.tag requires 1 argument (got 0)');
  });

  it('S-lint-state-tag-correct', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag(['x'])
    `;
    expect(lintAll(src, 'turing')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — confirm all pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: PASS (18 specs). No code change needed — the resolver already classifies these correctly.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "test(completions/lint): lock in ctor + member-method arity checks

Constructors (new Alphabet(), new State()) and member methods (s.tag())
already flow through the same arity check via resolveCallee. Add
fixtures so future refactors can't regress these cases silently.

Refs #114."
```

---

### Task 7: Unknown callees + nested calls + non-literal args

Negative-space tests: lock in what we DON'T flag.

**Files:**
- Modify: `src/lib/completions/lint/argCount.test.ts`

- [ ] **Step 1: Write the tests (append)**

```ts
describe('lint/argCount — passes silently', () => {
  it('S-lint-unknown-callee', () => {
    const src = `userDefined()`;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-non-literal-arg-still-counts', () => {
    // mark(someVar) is one arg — meets required count.
    const src = `
      const { mark } = imports;
      const target = 20;
      mark(target)
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-nested-call-counted-independently', () => {
    // Inner call(?): missing arg → error. Outer mark(...): 1 arg (the call expression) → ok.
    const src = `
      const { mark, call } = imports;
      mark(call())
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('call requires 1 argument (got 0)');
  });

  it('S-lint-chained-member-access', () => {
    // a.b.c() — resolveCallee returns null for chained member access. No diagnostic.
    const src = `
      const x = { a: { b: () => 1 } };
      x.a.b()
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-multiple-calls-all-checked', () => {
    const src = `
      const { mark, check, stop } = imports;
      mark()
      check()
      stop()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(3);
    expect(diags.map((d) => d.message)).toEqual([
      'mark requires 1 argument (got 0)',
      'check requires 2 arguments (got 0)',
      'stop has no callable form (use bare `stop` instead)',
    ]);
  });
});
```

- [ ] **Step 2: Run — all should pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/argCount.test.ts`
Expected: PASS (23 specs).

If `S-lint-multiple-calls-all-checked` reports diagnostics in a different order, that's a real concern — the `tree.iterate` walk is depth-first / source-order, so they should land in source order (`mark` then `check` then `stop`). If they don't, sort by `from` before asserting. But the standard iteration is in document order, so this should pass as-is.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/argCount.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "test(completions/lint): negative-space + multi-diagnostic specs

Unknown callees, non-literal args, nested calls, chained member access
all pass silently. Multiple bad calls in one source produce one
diagnostic each, in document order.

Refs #114."
```

---

### Task 8: Wire `argCountLinter` into the editor

**Files:**
- Modify: `src/components/Editor.svelte`

- [ ] **Step 1: Read the existing extensions list**

The current `extensions` is a `$derived` that combines `oneDark` (dark theme only), `completionExtensions(engine)`, and `syntaxLinter`. We add `argCountLinter(env)` to the array.

- [ ] **Step 2: Import and wire**

In `src/components/Editor.svelte`, add at the top of the `<script>`:

```ts
import { argCountLinter } from '../lib/completions/lint/argCount.ts';
import { getSchema } from '../lib/completions/schema/index.ts';
import type { Env } from '../lib/completions/contexts/types.ts';
```

(If `Env` or `getSchema` is already imported elsewhere in the file, don't duplicate — adjust the imports list accordingly.)

In the `extensions` `$derived` (around line 34), construct the env and append the linter. Replace the current `$derived` body:

```ts
  const extensions = $derived.by(() => {
    const env: Env = { engine, schema: getSchema(engine) };
    const base = [...completionExtensions(engine), syntaxLinter, argCountLinter(env)];
    return theme.resolved === 'dark' ? [oneDark, ...base] : base;
  });
```

(If the current code uses simple `$derived(expression)` instead of `$derived.by(() => {...})`, prefer the `.by` form for readability with the new env construction. If the codebase strongly prefers expression form, inline the env build.)

- [ ] **Step 3: Run full suite + check + lint**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check && npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint && npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run`
Expected: clean. Test count = previous + 23 (the new lint specs).

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/Editor.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(editor): wire argCountLinter alongside syntaxLinter

Schema-driven arg-count diagnostics now flow into the editor's gutter.
Builds the Env once per derived re-evaluation (engine / theme change),
matching the completionExtensions pattern.

Refs #114."
```

---

### Task 9: Manual smoke test against the dev server

Subagents can't drive a browser. After the wire-up commit, surface the smoke checklist to the user.

**Manual checklist:**

Open `/post` and paste/edit:

```js
const { PostMachine, Tape, mark, erase, noop, left, right, stop, call, check } = imports;
const m = new PostMachine({
  10: mark(),        // expect error: "mark requires 1 argument (got 0)"
  20: stop(),        // expect error: "stop has no callable form (use bare `stop` instead)"
  30: call(),        // expect error: "call requires 1 argument (got 0)"
  40: check(),       // expect error: "check requires 2 arguments (got 0)"
  50: mark(1, 2),    // expect warning: "mark takes 1 argument (got 2)"
  60: mark(20),      // expect no diagnostic
});
```

Confirm:
- 5 gutter markers (4 error, 1 warning) in the correct lines.
- Hovering each marker shows the expected message.
- Editing to fix one removes only that marker (others remain).
- Switching to `/turing` clears post-engine diagnostics; pasting `new Alphabet()` shows the error.
- Switching theme (light ↔ dark) preserves gutter markers.

If any of the above fails: stop, gather the specific repro, fix, add a regression test, recommit before opening the PR.

---

### Task 10: Docs touch-up + PR

**Files:**
- Modify: `CLAUDE.md` (machines-demo)
- New PR

- [ ] **Step 1: Update CLAUDE.md tree**

In the `src/lib/completions/` tree section, add a new sub-entry alongside `hints/` and `apply/`:

```
    │   ├── lint/                 schema-driven semantic linters (#114)
    │   │   ├── argCount.ts         computeArgCountDiagnostics(state, env) + argCountLinter(env)
    │   │   └── argCount.test.ts    per-case fixtures via lintAll helper (cites S-lint-...)
```

In the Editor section's prose paragraph (where `completionExtensions(engine)` is described), append a clause:

> Plus an arg-count lint source at `src/lib/completions/lint/argCount.ts` (#114) — walks `CallExpression` / `NewExpression`, reuses `resolveCallee` to classify the callee against the schema, emits `error` for missing required args + bare-only post-instructions called as functions (e.g. `stop()`), `warning` for extras past last declared.

- [ ] **Step 2: Commit docs + plan file**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add CLAUDE.md docs/superpowers/plans/2026-06-09-114-arg-count-lint.md
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs: add lint/ layer to CLAUDE.md tree + check in plan

argCount lint source documented next to the hints/ layer. Plan committed
alongside per the workspace convention for docs/superpowers/plans/."
```

- [ ] **Step 3: Rebase on master (per global git workflow)**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo fetch origin master
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo log HEAD..origin/master --oneline
```

If master moved, rebase: `git -C ... rebase origin/master`. If the branch was already pushed, force-push with lease.

- [ ] **Step 4: Open the PR (only with explicit user approval)**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo push -u origin feat/114-arg-count-lint
gh pr create --repo mellonis/machines-demo --head feat/114-arg-count-lint --base master --title "feat(completions/lint): schema-driven arg-count diagnostics (#114 Phase 1)" --body "$(cat <<'EOF'
## Summary
- New `src/lib/completions/lint/argCount.ts` — CodeMirror lint source that walks `CallExpression` / `NewExpression`, classifies the callee via `resolveCallee` (exported from `hints/signature.ts`), and emits:
  - `error` when actual arg count < schema's required count (e.g. `mark()` → `"mark requires 1 argument (got 0)"`).
  - `warning` when actual > params.length (e.g. `mark(1, 2)` → `"mark takes 1 argument (got 2)"`).
  - `error` when a bare-only post-instruction is called as a function (`stop()` → `"stop has no callable form (use bare \`stop\` instead)"`).
- Diagnostic range spans the whole `CallExpression` / `NewExpression` so the gutter marker lights up the entire bad call.
- Renamed imports use the user-typed alias in the message so the gutter matches what's on screen.

## Out of scope (Phase 2 — separate PR)
- Cross-reference validation (`call('typo')` flagged because no `'typo':` subroutine exists; `mark(99)` flagged because no instruction `99` defined). Tracked in #114's Phase 2 section.
- Type checking (string vs number).
- Quick-fix actions.

## Test plan
- [x] 23 new specs in `src/lib/completions/lint/argCount.test.ts` covering required-missing, too-many, bare-only, ctor, member-method, unknown-callee, non-literal args, nested calls, chained member access, multi-diagnostic source.
- [x] `npm run check` clean.
- [x] `npm run lint` clean.
- [x] `npm test` — full suite green.
- [x] Manual smoke on `/post` + `/turing` with the fixture in the plan file confirms gutter markers + hover messages.

Refs #114 (Phase 1 of two).
EOF
)"
```

Do not push or open the PR without explicit user approval.

---

## Self-review checklist

**Spec coverage:**
- `S-lint-mark-empty-parens` (issue's Phase 1 table row 1) — Task 3.
- `S-lint-mark-correct` (negative; no diagnostic for valid call) — Task 3.
- `S-lint-stop-with-parens` (bare-only) — Task 5.
- `S-lint-call-missing-name` — Task 3.
- `S-lint-call-with-optional-jumpto` (the no-diagnostics version of S-lint-call-with-only-name) — Task 3.
- `S-lint-extra-args-warning` (S-lint-mark-too-many in this plan) — Task 4.
- `S-lint-unknown-callee-passes` — Task 7.

All issue-listed specs mapped.

**Beyond the issue (deliberate additions):**
- `S-lint-stop-renamed-still-flagged` — confirms reverse-rename works for the bare-only message.
- `S-lint-nested-call-counted-independently` — confirms tree walk visits inner calls.
- `S-lint-multiple-calls-all-checked` — confirms order + multi-diagnostic emission.
- `S-lint-state-tag-empty` — confirms member-method path works.

**Placeholder scan:** every step has the actual code, the exact command, expected output. No TBDs, no "add appropriate handling".

**Type consistency:**
- `computeArgCountDiagnostics(state, env): Diagnostic[]` — same signature in Tasks 2, 3, 4, 5.
- `argCountLinter(env): Extension` — same in Task 2 (declared) and Task 8 (consumed).
- `resolveCallee(argList, state, env)` — Task 1 just adds `export`; Task 3 imports and calls with same signature.
- `lintAll(source, engine)` — declared in Task 2, used in Tasks 3–7.
- `bareOnlyDiagnostic(call, state, env)` / `calleeIdentifier(call, state)` / `originalImportName(alias, env, state)` — declared in Task 5, used only within argCount.ts.

**Risk callouts:**
- `tree.iterate` walks the full document on every linter invocation. CodeMirror's `linter()` wrapper debounces (default 750ms after last edit), so the cost is bounded — but for huge documents (>10kLoC) this could feel sluggish. Demo programs are small; not a concern. Document the assumption in the linter source if scope grows.
- Editor.svelte's `$derived` for extensions re-evaluates when `theme.resolved` or `engine` changes. Each evaluation produces a NEW `argCountLinter(env)` Extension. CodeMirror handles extension swapping cleanly, but the linter's debounce timer resets. Theme toggle would cause one re-lint, which is fine.
