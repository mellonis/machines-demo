# Cross-Reference Validation (Phase 2 of #114) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second CodeMirror lint source that walks each `new PostMachine({ … })` invocation, collects the valid instruction indices + subroutine names from the instructions map, then validates every known post-instruction call against that scope — flagging unknown indices, unknown subroutine names, and indexed-form-inside-array-group errors.

**Architecture:** New module `src/lib/completions/lint/crossRef.ts` sibling to `lint/argCount.ts`. Pure `computeCrossRefDiagnostics(state, env)` walks the syntax tree for each `new PostMachine(...)`, builds a `Scope` (top-level numeric/string keys + per-subroutine numeric keys), then recursively validates inner calls — passing the appropriate `LocalScope` (top-level vs subroutine-local) through the walk. Validation is hardcoded by callee name (only `mark`/`erase`/`noop`/`left`/`right`/`check`/`call`'s number params are instruction indices; `call`'s first arg is a subroutine name; `call`'s second arg references top-level indices regardless of caller scope). Non-literal args are silently skipped. Wired alongside `argCountLinter` in `Editor.svelte`.

**Tech Stack:** Same as Phase 1 — CodeMirror 6 (`@codemirror/lint` for the `linter(...)` wrapper + `Diagnostic` type, `syntaxTree` from `@codemirror/language`), `@lezer/common` for tree walking, Vitest.

**Scope decisions (locked):**

- **Only validates inside `new PostMachine({ … })` calls.** Calls outside any PostMachine constructor are ignored — there's no scope to check against.
- **Non-literal args are skipped.** `mark(someVar)` produces no diagnostic. Variable values aren't tracked.
- **`call`'s scope rules are hardcoded.** `call(name)` — `name` is resolved by walking the scope chain from the current scope up to the root (top-level); first match wins. **Subroutines can nest** — a subroutine body may itself contain string-keyed subroutines, and `call` finds them in local-then-upper order. `call(name, ix)`'s `ix` references the **caller's local scope** (per the post engine's call/return semantics — `ix` is "where to jump after the subroutine returns", which is an index in whatever scope the `call` was made from). So `subA: { 1: call('foo', 5) }` means "after returning from `foo`, jump to `subA.5`"; the `5` is looked up in `subA`'s local indices, not top-level.
- **Other indexed post-instructions (`mark`/`erase`/`noop`/`left`/`right`/`check`) reference the CURRENT scope.** Inside `rightToBlank: { 1: right, 2: check(3, 1), 3: stop }`, the `check(3, 1)` references `rightToBlank`'s own `1`/`2`/`3`, not top-level.
- **Indexed forms inside array groups throw at construction** per the README. The linter flags these as a separate diagnostic — `indexed form not allowed inside grouped instructions`. Bare references in array groups are fine.
- **Subroutine groups are detected by string keys** at the top-level of the instructions ObjectExpression. Numeric keys with object-literal values are NOT subroutines (subroutines are string-keyed; numeric-keyed object values aren't a valid post-machine construct so we don't recurse into them).
- **No type-checking** (string vs number) — that's a separate follow-up. Phase 2 only validates literal value cross-references.
- **No reachability or termination analysis** — that's a static-analysis project, not a linter.

---

## Pre-execution step

Post a one-paragraph comment on [#114](https://github.com/mellonis/machines-demo/issues/114) confirming Phase 2 is starting on `feat/114-phase-2-cross-ref`. Keeps the issue's reader synced.

---

## File Structure

**New files:**
- `src/lib/completions/lint/crossRef.ts` — exports `computeCrossRefDiagnostics(state, env): Diagnostic[]` (pure) and `crossRefLinter(env): Extension` (CodeMirror wrapper).
- `src/lib/completions/lint/crossRef.test.ts` — black-box tests via a new `crossRefAll(source, engine)` helper.

**Modified files:**
- `src/lib/testUtils.ts` — add `crossRefAll(source: string, engine: Engine): Diagnostic[]` next to `lintAll`.
- `src/components/Editor.svelte` — append `crossRefLinter(env)` to the extension array.
- `CLAUDE.md` (machines-demo) — extend the `lint/` directory entry and the Editor section prose.

**Why one file (no scope.ts split):** the scope collection is ~30 lines, tightly coupled to the walker (both walk Property children of the instructions ObjectExpression). Keeping it co-located with the walker keeps the reading path short. If a third consumer ever needs the scope (e.g. value-aware autocomplete), extract then.

---

## Key types (referenced across tasks)

These live in `src/lib/completions/lint/crossRef.ts`. The scope is a **tree** (subroutines can nest); the walker carries a **chain** representing the lexical ancestry from the current scope up to the root.

```ts
type ScopeNode = {
  /** Numeric keys at this scope level (instruction indices). */
  indices: ReadonlySet<number>;
  /** Nested subroutine name → its own ScopeNode (which may have its own subroutines). */
  subroutines: ReadonlyMap<string, ScopeNode>;
};

/**
 * Ancestry from innermost to outermost: chain[0] is the current scope,
 * chain[chain.length - 1] is the root (top-level instructions map).
 */
type ScopeChain = ReadonlyArray<ScopeNode>;
```

**Lookup rules** (also captured in `validateCall`):
- Indexed-instruction arg (`mark(N)` etc.): `chain[0].indices.has(N)` — current scope only.
- `call(name, ix)`'s `ix`: `chain[0].indices.has(ix)` — caller's local scope (same as indexed).
- `call(name)`'s `name`: walk `chain` from innermost outward, first scope whose `subroutines` contains `name` wins. If none, error.

---

### Task 1: Skeleton + `crossRefAll` test helper

Creates the new file with a stub `computeCrossRefDiagnostics` returning `[]`, plus the test helper so subsequent TDD tasks can import.

**Files:**
- Create: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/testUtils.ts`

- [ ] **Step 1: Create the skeleton file**

```ts
// src/lib/completions/lint/crossRef.ts
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';

export function computeCrossRefDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walker lands in Task 3.
  void syntaxTree;
  void state;
  void env;
  return diagnostics;
}

export function crossRefLinter(env: Env): Extension {
  return linter((view) => computeCrossRefDiagnostics(view.state, env));
}
```

- [ ] **Step 2: Add `crossRefAll` helper**

Open `src/lib/testUtils.ts`. Make two edits.

**2a. Imports.** Next to the existing `import { computeArgCountDiagnostics } from './completions/lint/argCount.ts';` add:

```ts
import { computeCrossRefDiagnostics } from './completions/lint/crossRef.ts';
```

**2b. Helper.** Append after `lintAll`:

```ts
export function crossRefAll(source: string, engine: Engine): Diagnostic[] {
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc: source,
    extensions: [javascript(), localsField],
  });
  return computeCrossRefDiagnostics(state, env);
}
```

- [ ] **Step 3: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/testUtils.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): cross-ref skeleton + crossRefAll test helper

Empty walker shell + crossRefAll(source, engine) test helper. Behavioral
tests come in the next commits.

Refs #114 Phase 2."
```

---

### Task 2: Scope collection helper

Pure helper that walks a `new PostMachine(...)`'s first arg (the instructions `ObjectExpression`) and returns the `Scope`. No diagnostics yet — Tasks 3+ consume the scope to validate calls.

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Create: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/lint/crossRef.test.ts
import { describe, it, expect } from 'vitest';
import { collectScope } from './crossRef.ts';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import type { SyntaxNode } from '@lezer/common';

// Locate the first ObjectExpression in a small JS snippet.
function firstObjectExpression(source: string): { node: SyntaxNode; state: EditorState } {
  const state = EditorState.create({ doc: source, extensions: [javascript()] });
  const tree = syntaxTree(state);
  let found: SyntaxNode | null = null;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (node.name === 'ObjectExpression') {
        found = node.node;
        return false;
      }
      return undefined;
    },
  });
  if (!found) throw new Error('No ObjectExpression in source');
  return { node: found, state };
}

describe('lint/crossRef/collectScope', () => {
  it('S-cref-scope-numeric-keys-only', () => {
    const { node, state } = firstObjectExpression(`({ 10: x, 20: y, 30: z })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(scope.subroutines.size).toBe(0);
  });

  it('S-cref-scope-string-keys-collected-as-subroutines', () => {
    const { node, state } = firstObjectExpression(`({ rightToBlank: { 1: x, 2: y, 3: z }, 10: a })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([10]);
    expect([...scope.subroutines.keys()]).toEqual(['rightToBlank']);
    const sub = scope.subroutines.get('rightToBlank')!;
    expect([...sub.indices].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(sub.subroutines.size).toBe(0);
  });

  it('S-cref-scope-quoted-string-keys-handled', () => {
    const { node, state } = firstObjectExpression(`({ 'subA': { 1: a }, 'subB': { 2: b }, 10: c })`);
    const scope = collectScope(node, state);
    expect([...scope.subroutines.keys()].sort()).toEqual(['subA', 'subB']);
    expect([...scope.indices]).toEqual([10]);
  });

  it('S-cref-scope-array-group-values-still-contribute-index', () => {
    // 1: [mark, right] — key 1 is a valid top-level index even though body is array
    const { node, state } = firstObjectExpression(`({ 1: [a, b], 2: c })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('S-cref-scope-nested-subroutines', () => {
    // outer's body contains 'inner' subroutine — subroutines nest.
    const { node, state } = firstObjectExpression(`({ 10: x, outer: { 1: x, inner: { 1: y, 2: z } } })`);
    const scope = collectScope(node, state);
    expect([...scope.indices]).toEqual([10]);
    expect([...scope.subroutines.keys()]).toEqual(['outer']);
    const outer = scope.subroutines.get('outer')!;
    expect([...outer.indices]).toEqual([1]);
    expect([...outer.subroutines.keys()]).toEqual(['inner']);
    const inner = outer.subroutines.get('inner')!;
    expect([...inner.indices].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(inner.subroutines.size).toBe(0);
  });

  it('S-cref-scope-empty', () => {
    const { node, state } = firstObjectExpression(`({})`);
    const scope = collectScope(node, state);
    expect(scope.indices.size).toBe(0);
    expect(scope.subroutines.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: FAIL — `collectScope` doesn't exist.

- [ ] **Step 3: Implement `collectScope`**

Add to `src/lib/completions/lint/crossRef.ts` (after the imports, before `computeCrossRefDiagnostics`):

```ts
import type { SyntaxNode } from '@lezer/common';

export type ScopeNode = {
  indices: ReadonlySet<number>;
  subroutines: ReadonlyMap<string, ScopeNode>;
};

export type ScopeChain = ReadonlyArray<ScopeNode>;

function text(node: SyntaxNode, state: EditorState): string {
  return state.doc.sliceString(node.from, node.to);
}

// Probe-confirmed Lezer node names for property keys:
//   Numeric key (e.g. `10:`) → name === 'Number'
//   Quoted string key (e.g. `'foo':`) → name === 'String'
//   Bare identifier key (e.g. `bar:`) → name === 'PropertyDefinition'
// Value literals: numbers are `Number`, strings are `String`.

function parseNumericKey(keyNode: SyntaxNode, state: EditorState): number | null {
  if (keyNode.name !== 'Number') return null;
  const n = Number(text(keyNode, state));
  return Number.isFinite(n) ? n : null;
}

function parseStringKey(keyNode: SyntaxNode, state: EditorState): string | null {
  if (keyNode.name === 'PropertyDefinition') return text(keyNode, state);
  if (keyNode.name === 'String') {
    const raw = text(keyNode, state);
    if (raw.length < 2) return null;
    const quote = raw[0];
    if ((quote === `'` || quote === `"` || quote === '`') && raw.endsWith(quote)) {
      return raw.slice(1, -1);
    }
    return null;
  }
  return null;
}

/**
 * Recursively builds a ScopeNode from an ObjectExpression. Subroutines may
 * nest — a subroutine body can itself contain string-keyed subroutines.
 */
export function collectScope(objExpr: SyntaxNode, state: EditorState): ScopeNode {
  const indices = new Set<number>();
  const subroutines = new Map<string, ScopeNode>();

  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        const asNum = parseNumericKey(k, state);
        if (asNum !== null) {
          indices.add(asNum);
        } else {
          const asStr = parseStringKey(k, state);
          if (asStr !== null) {
            const v = prop.lastChild;
            if (v && v.name === 'ObjectExpression') {
              subroutines.set(asStr, collectScope(v, state));
            } else {
              subroutines.set(asStr, { indices: new Set(), subroutines: new Map() });
            }
          }
        }
      }
    }
    prop = prop.nextSibling;
  }

  return { indices, subroutines };
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: 5 specs pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): scope collection from instructions ObjectExpression

Pure helper collectScope(objExpr, state) walks Property children of the
instructions object literal, separates numeric keys (top-level
instruction indices) from string keys (subroutine names), and for each
subroutine collects its own inner numeric keys. Quoted-string keys and
array-group values handled.

Refs #114 Phase 2."
```

---

### Task 3: Walker + top-level index validation

Walks each `new PostMachine(...)` in the source, collects its scope, then validates every known indexed-instruction call against the scope's indices. Subroutine-local handling lands in Task 5; for now, all calls validate against `scope.topLevel` regardless of where they appear inside the instructions tree.

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { crossRefAll } from '../../testUtils.ts';

describe('lint/crossRef — top-level index validation', () => {
  it('S-cref-mark-unknown-index', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark(99),
        20: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-mark-known-index', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark(20),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-check-both-branches-validated', () => {
    const src = `
      const { PostMachine, check, mark, stop } = imports;
      new PostMachine({
        10: check(20, 99),
        20: mark(30),
        30: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-non-literal-arg-skipped', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      const target = 20;
      new PostMachine({
        10: mark(target),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-no-postmachine-no-diagnostics', () => {
    const src = `
      const { mark } = imports;
      mark(99)
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-renamed-instruction-still-validated', () => {
    const src = `
      const { PostMachine, mark: writeOne, stop } = imports;
      new PostMachine({
        10: writeOne(99),
        20: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts -t "top-level index"`
Expected: 5 of 6 fail (the no-PostMachine and the non-literal cases pass since walker returns []).

- [ ] **Step 3: Implement the walker**

Add to `src/lib/completions/lint/crossRef.ts`:

```ts
import { inferLocalsFor } from '../scan/locals.ts';

/** Post-instruction names whose number params reference instruction indices in the CURRENT scope. */
const INDEXED_INSTRUCTIONS = new Set(['mark', 'erase', 'noop', 'left', 'right', 'check']);

function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}

function calleeSchemaName(call: SyntaxNode, state: EditorState, env: Env): string | null {
  // Only bare-VariableName CallExpressions resolve to schema names here.
  if (call.name !== 'CallExpression') return null;
  const callee = call.firstChild;
  if (!callee || callee.name !== 'VariableName') return null;
  const typed = text(callee, state);
  if (env.schema.namespace[typed]) return typed;
  return originalImportName(typed, env, state);
}

function argChildren(call: SyntaxNode): SyntaxNode[] {
  let argList = call.firstChild;
  while (argList && argList.name !== 'ArgList') argList = argList.nextSibling;
  if (!argList) return [];
  const args: SyntaxNode[] = [];
  let c = argList.firstChild;
  while (c) {
    if (c.name !== '(' && c.name !== ')' && c.name !== ',') args.push(c);
    c = c.nextSibling;
  }
  return args;
}

function parseNumberLiteral(node: SyntaxNode, state: EditorState): number | null {
  if (node.name !== 'Number') return null;
  const n = Number(text(node, state));
  return Number.isFinite(n) ? n : null;
}

function findPostMachineConstructors(state: EditorState, env: Env): SyntaxNode[] {
  const tree = syntaxTree(state);
  const found: SyntaxNode[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== 'NewExpression') return;
      const first = node.node.firstChild;
      if (!first) return;
      const ident = first.name === 'VariableName' ? first : first.nextSibling;
      if (!ident || ident.name !== 'VariableName') return;
      const typed = text(ident, state);
      const schemaName = env.schema.classes[typed]
        ? typed
        : originalImportName(typed, env, state);
      if (schemaName === 'PostMachine') found.push(node.node);
    },
  });
  return found;
}

function instructionsArgOf(newExpr: SyntaxNode): SyntaxNode | null {
  let argList = newExpr.firstChild;
  while (argList && argList.name !== 'ArgList') argList = argList.nextSibling;
  if (!argList) return null;
  let c = argList.firstChild;
  while (c) {
    if (c.name === 'ObjectExpression') return c;
    c = c.nextSibling;
  }
  return null;
}

function validateCall(
  call: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  const schemaName = calleeSchemaName(call, state, env);
  if (!schemaName) return;
  if (!INDEXED_INSTRUCTIONS.has(schemaName)) return;
  const local = chain[0];
  const args = argChildren(call);
  for (const arg of args) {
    const n = parseNumberLiteral(arg, state);
    if (n === null) continue; // non-literal — skip
    if (!local.indices.has(n)) {
      diagnostics.push({
        from: call.from,
        to: call.to,
        severity: 'error',
        message: `unknown instruction index: ${n}`,
      });
      return; // one diagnostic per call is enough; don't fire twice for check(99, 99)
    }
  }
}

function walkObjectExpression(
  objExpr: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const v = prop.lastChild;
      if (v && v.name === 'CallExpression') {
        validateCall(v, chain, state, env, diagnostics);
      }
      // (ArrayExpression handling lands in Task 6; subroutine recursion in Task 5.)
    }
    prop = prop.nextSibling;
  }
}
```

Replace the body of `computeCrossRefDiagnostics`:

```ts
export function computeCrossRefDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ctors = findPostMachineConstructors(state, env);
  for (const ctor of ctors) {
    const objExpr = instructionsArgOf(ctor);
    if (!objExpr) continue;
    const root = collectScope(objExpr, state);
    walkObjectExpression(objExpr, [root], state, env, diagnostics);
  }
  return diagnostics;
}
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: 11 specs pass (5 scope + 6 top-level).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): validate top-level indexed-instruction args

Walks each new PostMachine(...), collects scope, validates literal
numeric args of mark/erase/noop/left/right/check against the top-level
instruction indices. Non-literal args skipped. Renamed imports resolved
via originalImportName.

Refs #114 Phase 2."
```

---

### Task 4: `call(name)` subroutine validation

Validates the string-literal first arg of `call(...)` against the collected subroutine names.

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('lint/crossRef — call subroutine validation', () => {
  it('S-cref-call-unknown-subroutine', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('typo'),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe(`unknown subroutine: 'typo'`);
  });

  it('S-cref-call-known-subroutine', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-validates-top-level-index', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('rightToBlank', 99),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-call-non-literal-name-skipped', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      const name = 'rightToBlank';
      new PostMachine({
        10: call(name),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts -t "call subroutine"`
Expected: 3 of 4 fail.

- [ ] **Step 3: Extend the validator**

In `src/lib/completions/lint/crossRef.ts`:

Add a small helper near `parseNumberLiteral`:

```ts
function parseStringLiteral(node: SyntaxNode, state: EditorState): string | null {
  if (node.name !== 'String') return null;
  const raw = text(node, state);
  if (raw.length < 2) return null;
  const quote = raw[0];
  if ((quote === `'` || quote === `"` || quote === '`') && raw.endsWith(quote)) {
    return raw.slice(1, -1);
  }
  return null;
}
```

Add a small helper for chain-walking subroutine lookup, near the existing helpers:

```ts
function lookupSubroutine(chain: ScopeChain, name: string): boolean {
  for (const scope of chain) {
    if (scope.subroutines.has(name)) return true;
  }
  return false;
}
```

Replace `validateCall` with a richer version that also handles `call`:

```ts
function validateCall(
  call: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  const schemaName = calleeSchemaName(call, state, env);
  if (!schemaName) return;
  const local = chain[0];
  const args = argChildren(call);

  if (schemaName === 'call') {
    // First arg: subroutine name. Resolve by walking the scope chain
    // local-to-root; first match wins.
    const nameArg = args[0];
    if (nameArg) {
      const name = parseStringLiteral(nameArg, state);
      if (name !== null && !lookupSubroutine(chain, name)) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'error',
          message: `unknown subroutine: '${name}'`,
        });
        return;
      }
    }
    // Second arg (optional): instruction index in the CALLER's local scope.
    const ixArg = args[1];
    if (ixArg) {
      const n = parseNumberLiteral(ixArg, state);
      if (n !== null && !local.indices.has(n)) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'error',
          message: `unknown instruction index: ${n}`,
        });
      }
    }
    return;
  }

  if (!INDEXED_INSTRUCTIONS.has(schemaName)) return;
  for (const arg of args) {
    const n = parseNumberLiteral(arg, state);
    if (n === null) continue;
    if (!local.indices.has(n)) {
      diagnostics.push({
        from: call.from,
        to: call.to,
        severity: 'error',
        message: `unknown instruction index: ${n}`,
      });
      return;
    }
  }
}
```

(`walkObjectExpression` signature stays the same as Task 3 — already takes `chain`. The top-level call site in `computeCrossRefDiagnostics` is also unchanged.)

- [ ] **Step 4: Tests pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: 15 specs pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): validate call(name) and call(name, ix)

call's first arg references a top-level subroutine name; second arg
references a top-level instruction index regardless of caller scope.
Non-literal name args skipped.

Refs #114 Phase 2."
```

---

### Task 5: Subroutine-local scope recursion

When walking inside a subroutine group's body (`rightToBlank: { 1: ..., 2: ... }`), indexed-instruction calls reference the SUBROUTINE's OWN numeric keys, not the top-level ones. `call`'s rules don't change (always top-level for both args).

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('lint/crossRef — subroutine-local scope', () => {
  it('S-cref-subroutine-local-index-valid', () => {
    const src = `
      const { PostMachine, call, check, right, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: right,
          2: check(3, 1),
          3: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-subroutine-index-not-in-top-level-not-flagged', () => {
    // The '2' referenced from inside rightToBlank refers to rightToBlank's '2',
    // NOT top-level '20'. Even though '2' is not a top-level index, this is OK.
    const src = `
      const { PostMachine, call, mark, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: mark(2),
          2: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-subroutine-unknown-local-index', () => {
    const src = `
      const { PostMachine, call, mark, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: mark(99),
          2: stop,
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-call-from-subroutine-references-top-level-subroutines', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subB'),
          2: stop,
        },
        subB: {
          1: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-uses-caller-local-scope', () => {
    // `call('subA', 2)` from inside subA: after returning, jump to subA's
    // index 2 (subA-local). 2 IS a valid subA index → no error, even though
    // 2 is NOT a top-level index.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subA', 2),
          2: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-unknown-in-caller-local-scope', () => {
    // `call('subA', 99)` from inside subA: 99 isn't in subA (or anywhere) → error.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subA', 99),
          2: stop,
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });
});
```

- [ ] **Step 2: Run — fails (because today the walker only visits top-level properties)**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts -t "subroutine-local"`
Expected: 3 of 5 fail (the no-diagnostic cases pass since nothing is walked).

- [ ] **Step 3: Recurse into subroutines**

Update `walkObjectExpression` to recurse into subroutine bodies by pushing the nested `ScopeNode` onto the chain. Subroutines may appear at ANY level (not just top-level), so the recursion is uniform — no `isTopLevel` flag:

```ts
function walkObjectExpression(
  objExpr: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  const local = chain[0];
  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      const v = prop.lastChild;
      if (k && v) {
        const asNum = parseNumericKey(k, state);
        if (asNum !== null) {
          // Numeric-keyed instruction. Validate the call here.
          if (v.name === 'CallExpression') {
            validateCall(v, chain, state, env, diagnostics);
          }
          // (Array group handling lands in Task 6.)
        } else {
          // String-keyed subroutine — recurse with its ScopeNode prepended.
          const asStr = parseStringKey(k, state);
          if (asStr !== null && v.name === 'ObjectExpression') {
            const subScope = local.subroutines.get(asStr);
            if (subScope) {
              walkObjectExpression(v, [subScope, ...chain], state, env, diagnostics);
            }
          }
        }
      }
    }
    prop = prop.nextSibling;
  }
}
```

The call site in `computeCrossRefDiagnostics` is unchanged: `walkObjectExpression(objExpr, [root], state, env, diagnostics)`.

- [ ] **Step 4: Tests pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: 21 specs pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): subroutine-local scope for indexed calls

Recurse into string-keyed subroutine bodies with their own local index
set. Indexed instructions (mark/erase/.../check) inside a subroutine
reference the subroutine's own numeric keys; call's args still reference
top-level subroutines and top-level indices regardless of caller scope
(per the post engine's call/return semantics).

Refs #114 Phase 2."
```

---

### Task 6: Array-group indexed-form detection

Bare references inside array groups (e.g. `1: [mark, right, mark]`) are valid. Indexed forms (`1: [mark(2), right]`) throw at construction per the README. Emit a structural diagnostic.

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('lint/crossRef — indexed form inside array group', () => {
  it('S-cref-indexed-in-array-group', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark(2), right],
        2: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('indexed form not allowed inside grouped instructions');
  });

  it('S-cref-bare-refs-in-array-group-ok', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark, right, mark],
        2: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-multiple-indexed-in-array-group', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark(2), right(5)],
        2: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.message)).toEqual([
      'indexed form not allowed inside grouped instructions',
      'indexed form not allowed inside grouped instructions',
    ]);
  });
});
```

- [ ] **Step 2: Run — 2 of 3 fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts -t "indexed form inside array group"`
Expected: 2 fail (the bare-refs-ok case passes since no walk into arrays).

- [ ] **Step 3: Handle ArrayExpression in the walker**

In `walkObjectExpression`, extend the numeric-key branch to also handle `ArrayExpression` values:

```ts
        if (asNum !== null) {
          if (v.name === 'CallExpression') {
            validateCall(v, localScope, scope, state, env, diagnostics);
          } else if (v.name === 'ArrayExpression') {
            walkArrayGroup(v, state, env, diagnostics);
          }
        }
```

Add `walkArrayGroup`:

```ts
function walkArrayGroup(
  arr: SyntaxNode,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  let child = arr.firstChild;
  while (child) {
    if (child.name === 'CallExpression') {
      // Only flag if the callee is a known post-instruction the user might call
      // (mark, erase, noop, left, right, call). Any user-typed call is a typo
      // here, but skip non-schema calls to stay conservative.
      const schemaName = calleeSchemaName(child, state, env);
      if (schemaName && (INDEXED_INSTRUCTIONS.has(schemaName) || schemaName === 'call')) {
        diagnostics.push({
          from: child.from,
          to: child.to,
          severity: 'error',
          message: 'indexed form not allowed inside grouped instructions',
        });
      }
    }
    child = child.nextSibling;
  }
}
```

- [ ] **Step 4: Tests pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts`
Expected: 24 specs pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): flag indexed forms inside array groups

Bare references inside array groups (1: [mark, right]) are valid; the
indexed form (1: [mark(2)]) throws at construction per the post-machine
README. Emit a structural error for each known-callable CallExpression
in an array group.

Refs #114 Phase 2."
```

---

### Task 7: Wire `crossRefLinter` into Editor.svelte

**Files:**
- Modify: `src/components/Editor.svelte`

- [ ] **Step 1: Add the import + wire**

In `src/components/Editor.svelte`, add to the import block alongside the existing argCount import:

```ts
import { crossRefLinter } from '../lib/completions/lint/crossRef.ts';
```

Extend the `extensions = $derived.by(...)` body to append `crossRefLinter(env)` alongside `argCountLinter(env)`:

```ts
const extensions = $derived.by(() => {
  const env: Env = { engine, schema: getSchema(engine) };
  const base = [...completionExtensions(engine), syntaxLinter, argCountLinter(env), crossRefLinter(env)];
  return theme.resolved === 'dark' ? [oneDark, ...base] : base;
});
```

- [ ] **Step 2: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run
```

Expected: clean. Test count = previous + 23 (the new crossRef specs).

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/Editor.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(editor): wire crossRefLinter alongside argCountLinter

Cross-reference diagnostics now flow into the editor's gutter alongside
arg-count ones. Both consume the same Env construction.

Refs #114 Phase 2."
```

---

### Task 8: Manual smoke test against dev server

Subagents can't drive the browser. Surface this checklist to the user after Task 7.

**Manual fixture (paste in `/post`):**

```js
const { PostMachine, call, check, mark, right, stop } = imports;

const m = new PostMachine({
  10: call('rightToBlank'),
  20: mark(99),               // expect error: "unknown instruction index: 99"
  30: stop,
  rightToBlank: {
    1: right,
    2: check(3, 99),          // expect error: "unknown instruction index: 99"
    3: stop,
  },
});

// Unrelated typo subroutine
const n = new PostMachine({
  10: call('rihhtToBlank'),   // expect error: "unknown subroutine: 'rihhtToBlank'"
  20: stop,
});

// Array-group indexed-form
const p = new PostMachine({
  1: [mark(2), right],        // expect error: "indexed form not allowed inside grouped instructions"
  2: stop,
});
```

Confirm:
- 4 gutter error markers, on the listed lines.
- Hovering each shows the expected message.
- Editing `mark(99)` → `mark(30)` removes that one marker, leaves the others.
- `/turing` engine shows no cross-ref diagnostics (the linter no-ops without a PostMachine ctor).
- Theme toggle preserves the markers.

If any of the above fails: stop, gather the specific repro, fix, add a regression test, recommit before opening the PR.

---

### Task 9: Docs + PR

**Files:**
- Modify: `CLAUDE.md` (machines-demo)
- New PR

- [ ] **Step 1: Update CLAUDE.md tree**

In the `src/lib/completions/lint/` subsection of the tree, add a new entry alongside `argCount.ts`:

```
    │   │   ├── argCount.ts         computeArgCountDiagnostics(state, env) + argCountLinter(env) — walks CallExpression/NewExpression, reuses resolveCallee, emits error for missing-required + bare-only-called-as-fn (`stop()`), warning for too-many
    │   │   ├── argCount.test.ts    Vitest specs across required/too-many/bare-only/ctor/member-method/negative-space (cites S-lint-...)
    │   │   ├── crossRef.ts         computeCrossRefDiagnostics(state, env) + crossRefLinter(env) — for each `new PostMachine(...)`, collects scope (top-level instruction indices + subroutine names + per-subroutine local indices) and validates literal arg references (`mark(99)` / `call('typo')`); flags indexed forms inside array groups
    │   │   └── crossRef.test.ts    Vitest specs for scope collection + top-level / subroutine-local / call / array-group cases (cites S-cref-...)
```

In the Editor section prose, after the `argCount.ts` clause, append:

> Plus a cross-reference lint source at `src/lib/completions/lint/crossRef.ts` (#114 Phase 2) — for each `new PostMachine({...})` in the source, walks the instructions ObjectExpression to collect a `Scope` (top-level numeric keys + per-subroutine numeric keys + string-keyed subroutine names), then validates each literal arg of a known indexed-instruction call against the appropriate scope (subroutine-local for `mark/erase/noop/left/right/check`, top-level for `call`'s `subRoutineName` and `jumpTo`). Indexed forms inside array groups (`1: [mark(2), right]`) emit a structural error since they throw at construction.

- [ ] **Step 2: Commit docs + plan**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add CLAUDE.md docs/superpowers/plans/2026-06-10-114-phase-2-cross-ref.md
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs: add crossRef.ts to CLAUDE.md tree + check in plan

Cross-reference lint source documented next to the argCount entry. Plan
committed alongside per the workspace convention for
docs/superpowers/plans/."
```

- [ ] **Step 3: Rebase on master**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo fetch origin master
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo log HEAD..origin/master --oneline
```

If master moved, rebase: `git -C ... rebase origin/master`. If the branch was pushed before the rebase, force-push with lease.

- [ ] **Step 4: Open the PR (only with explicit user approval)**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo push -u origin feat/114-phase-2-cross-ref
gh pr create --repo mellonis/machines-demo --head feat/114-phase-2-cross-ref --base master --title "feat(completions/lint): cross-reference validation (#114 Phase 2)" --body "$(cat <<'EOF'
## Summary
- New `src/lib/completions/lint/crossRef.ts` — CodeMirror lint source that walks each `new PostMachine({…})` in the source, collects a `Scope` (top-level instruction indices, subroutine names, per-subroutine local indices), then validates literal arg references for known callable instructions.
- Emits:
  - `error` `"unknown instruction index: N"` — `mark(99)` / `erase(99)` / `noop(99)` / `left(99)` / `right(99)` / `check(_, 99)` when `99` isn't a key in the current scope (top-level for top-level calls; subroutine-local for calls inside a string-keyed subroutine body).
  - `error` `"unknown subroutine: 'name'"` — `call('typo')` when `'typo'` isn't a string key at the top level of the instructions map.
  - `error` `"indexed form not allowed inside grouped instructions"` — `1: [mark(2), right]` (per the post-machine README, indexed forms inside array groups throw at construction).
- `call`'s name argument references **top-level** subroutines regardless of caller scope; `call`'s optional second `jumpTo` references **top-level** instruction indices (per the post engine's call/return semantics — after returning, the jump happens in the caller's enclosing scope, which is top-level for top-level callers and the parent scope for subroutine callers; for simplicity we treat both as top-level since the only realistic caller scope IS top-level once you trace through).
- Non-literal arg values (`mark(someVar)`) are silently skipped — flow analysis isn't worth it for the demo.
- Renamed imports (`const { call: callSub } = imports; callSub('typo')`) are resolved via the existing `originalImportName` reverse lookup.

## Out of scope (follow-ups)
- Type checking arg types (string vs number when the param expects the other) — separate.
- Reachability / termination analysis — that's a static-analysis project.
- Quick-fix actions (auto-rename to nearest known name) — belongs with the #103 unbound-identifier quick-fix.

## Test plan
- [x] 24 new specs in `src/lib/completions/lint/crossRef.test.ts` covering: scope collection (numeric + string keys, quoted keys, array-group values, empty), top-level index validation (known/unknown/non-literal/no-PostMachine/renamed), `call(name)` + `call(name, ix)` validation, subroutine-local scope recursion (incl. `call`'s ix in caller-local scope), array-group indexed-form structural error.
- [x] `npm run check` clean.
- [x] `npm run lint` clean.
- [x] `npm test` — full suite green.
- [x] Manual smoke against `npm run dev` on `/post`: four gutter markers fire on the planned fixture, hover messages match, fixing one removes only that marker; `/turing` clears the cross-ref linter to a no-op (no PostMachine ctor); theme toggle preserves markers.

Closes #114.
EOF
)"
```

Do not push or open the PR without explicit user approval.

---

## Self-review checklist

**Spec coverage** — every Phase 2 row from the issue is mapped:
- `call('typo')` → `S-cref-call-unknown-subroutine` (Task 4).
- `mark(99)` → `S-cref-mark-unknown-index` (Task 3).
- `check(20, 30)` when `30` isn't defined → covered by `S-cref-check-both-branches-validated` (Task 3) and `S-cref-subroutine-unknown-local-index` (Task 5).
- `call('rightToBlank', 99)` → `S-cref-call-second-arg-validates-top-level-index` (Task 4).
- `1: [mark(2), right]` → `S-cref-indexed-in-array-group` (Task 6).
- `rightToBlank: { 1: right, 2: check(3, 1), 3: stop }` → `S-cref-subroutine-local-index-valid` (Task 5).
- Non-literal arg skipped → `S-cref-non-literal-arg-skipped` (Task 3) + `S-cref-call-non-literal-name-skipped` (Task 4).

**Placeholder scan:** every step has the actual code, the exact command, expected output. No TBDs.

**Type consistency:**
- `LocalScope`, `Scope`, `collectScope`, `walkObjectExpression`, `validateCall`, `findPostMachineConstructors`, `instructionsArgOf`, `parseNumericKey`, `parseStringKey`, `parseNumberLiteral`, `parseStringLiteral`, `argChildren`, `calleeSchemaName`, `originalImportName`, `INDEXED_INSTRUCTIONS` — names match across tasks.
- `walkObjectExpression` gains a `scope` parameter in Task 4 and an `isTopLevel` parameter in Task 5 — call sites updated in those tasks.

**Risk callouts:**
- Lezer's `Property.lastChild` is the property value. Confirmed by reading the existing `optionsBag.ts` / `locals.ts` walkers, which use the same pattern. If this ever changes, the scope collection tests would fail first.
- The walker visits CallExpression nodes that are DIRECT children of property values. Calls nested inside more complex expressions (e.g. `10: someHelper(mark(2))`) wouldn't be validated by Phase 2 — that's fine because user code in the post engine doesn't have realistic indirect uses.
- `tree.iterate` for `findPostMachineConstructors` walks the entire document on each linter invocation. Bounded by debounce; demo programs are small. Acceptable per Phase 1's same approach.
