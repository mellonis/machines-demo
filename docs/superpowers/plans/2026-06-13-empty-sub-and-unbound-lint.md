# Empty-Subroutine + Unbound-Identifier Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch two PostMachine/JS build-time errors in the editor: (1) empty subroutine bodies (`sss: {}`) — extends the existing cross-ref linter, post-only; (2) bare identifiers that aren't declared in lexical scope (`call('sss')` when `call` isn't destructured from `imports`) — new linter, works on both engines.

**Architecture:** Empty-subroutine = a single extra check inside `crossRef.ts`'s `walkObjectExpression` (when a subroutine body has empty `indices` AND empty `subroutines`, emit). Unbound-identifier = new `src/lib/completions/lint/unbound.ts` that walks the syntax tree for `VariableName` nodes at function-scope depth 0, checks each against `scanLocals`'s `rawLocals` set + a small `GLOBAL_ALLOWLIST` of common JS built-ins + `imports`. Anything not found is flagged. Function bodies (FunctionDeclaration / FunctionExpression / ArrowFunction) are skipped to avoid false positives on params and inner-scope locals.

**Tech Stack:** Same as Phase 2 — CodeMirror 6, `@codemirror/lint`, `@lezer/common` for the walk, Vitest.

**Scope decisions (locked):**

- **Empty-subroutine** flags only when `subScope.indices.size === 0` AND `subScope.subroutines.size === 0`. A subroutine that only contains nested subroutines (`sub: { inner: {…} }` with no own numeric keys) is NOT flagged in this PR — uncertain whether PostMachine throws on that, leave it for a follow-up if it bites.
- **Unbound-identifier** walks `VariableName` nodes ONLY when not inside a function/arrow scope (depth 0). Function bodies have their own params/locals that `scanLocals` doesn't track, so flagging them would produce false positives. Conservative skip is safer than a half-correct check.
- **`imports` is in the allowlist** since it's the bridge argument the worker passes into `new Function('imports', userCode)`. Not a `let`/`const` declaration anywhere, but always available.
- **Allowlist is small and pragmatic** — common JS built-ins users might reach for (`console`, `Math`, `JSON`, `Date`, `Array`, `Object`, `Number`, `String`, `Boolean`, `Symbol`, `RegExp`, `Promise`, `Map`, `Set`, `Error`, `TypeError`, `undefined`, `NaN`, `Infinity`, `globalThis`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`). NOT exhaustive — users who reach for exotic globals get a false positive; we can extend if it bites.
- **Both engines** for the unbound check (the user explicitly confirmed this — same `imports` bridge model on `/turing` and `/post`).
- **Empty-subroutine is post-only** by virtue of being inside `crossRef.ts`, which already short-circuits when there's no `new PostMachine(...)` in the source.

---

## File Structure

**New files:**
- `src/lib/completions/lint/unbound.ts` — `computeUnboundDiagnostics(state, env): Diagnostic[]` + `unboundLinter(env): Extension`.
- `src/lib/completions/lint/unbound.test.ts` — black-box tests via a new `unboundAll(source, engine)` helper.

**Modified files:**
- `src/lib/completions/lint/crossRef.ts` — add the empty-subroutine check inside `walkObjectExpression`.
- `src/lib/completions/lint/crossRef.test.ts` — 3 new specs covering empty / non-empty / nested cases.
- `src/lib/testUtils.ts` — add `unboundAll(source, engine): Diagnostic[]`.
- `src/components/Editor.svelte` — append `unboundLinter(env)` to the extensions array.
- `CLAUDE.md` (machines-demo) — extend the `lint/` tree entry + the Editor section prose.

---

### Task 1: Empty-subroutine diagnostic

**Files:**
- Modify: `src/lib/completions/lint/crossRef.ts`
- Modify: `src/lib/completions/lint/crossRef.test.ts`

- [ ] **Step 1: Write the failing tests (append to crossRef.test.ts)**

```ts
describe('lint/crossRef — empty subroutine', () => {
  it('S-cref-empty-subroutine-flagged', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('sss'),
        20: stop,
        sss: {},
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe(`empty subroutine: 'sss' has no instructions`);
  });

  it('S-cref-non-empty-subroutine-ok', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('sss'),
        20: stop,
        sss: { 1: stop },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-empty-nested-subroutine-flagged', () => {
    // The empty subroutine is inside outer — outer itself has its own
    // instruction so it's not empty, but inner is.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('outer'),
        20: stop,
        outer: {
          1: stop,
          inner: {},
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe(`empty subroutine: 'inner' has no instructions`);
  });
});
```

- [ ] **Step 2: Run — all 3 specs fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts -t "empty subroutine"`
Expected: 2 of 3 fail. The "non-empty" case passes coincidentally (nothing emits).

- [ ] **Step 3: Add the check in `walkObjectExpression`**

In `src/lib/completions/lint/crossRef.ts`, find the string-keyed-subroutine branch inside `walkObjectExpression` (the `} else { const asStr = parseStringKey(...)` block). Add an empty-check BEFORE the recursion. The full updated branch should look like:

```ts
        } else {
          // String-keyed subroutine — recurse with its ScopeNode prepended.
          const asStr = parseStringKey(k, state);
          if (asStr !== null && v.name === 'ObjectExpression') {
            const subScope = local.subroutines.get(asStr);
            if (subScope) {
              if (subScope.indices.size === 0 && subScope.subroutines.size === 0) {
                diagnostics.push({
                  from: prop.from,
                  to: prop.to,
                  severity: 'error',
                  message: `empty subroutine: '${asStr}' has no instructions`,
                });
              }
              walkObjectExpression(v, [subScope, ...chain], state, env, diagnostics);
            }
          }
        }
```

(The recursion is preserved so further errors inside the subroutine still surface. For a truly empty subroutine the recursion produces nothing — there's no body to walk.)

- [ ] **Step 4: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/crossRef.test.ts
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```

Expected: 30 specs pass (27 prior + 3 new). Check + lint clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/crossRef.ts src/lib/completions/lint/crossRef.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): flag empty subroutine bodies

PostMachine throws 'there is no instructions' at construction when a
subroutine has no numbered instructions. Detect the case where a
subroutine's ScopeNode has both indices.size === 0 AND subroutines.size
=== 0 — pure empty body.

Subroutines that contain only nested subroutines (no own numeric keys)
are intentionally NOT flagged here; uncertain whether the engine throws
on them, leave for a follow-up if it bites.

Refs machines-demo build-error smoke."
```

Stage only those 2 files. No attribution footer.

---

### Task 2: Unbound-identifier skeleton + test helper

Creates the new file with a stub returning `[]`, plus the `unboundAll` test helper. No behavior yet.

**Files:**
- Create: `src/lib/completions/lint/unbound.ts`
- Modify: `src/lib/testUtils.ts`

- [ ] **Step 1: Create the skeleton file**

```ts
// src/lib/completions/lint/unbound.ts
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { Env } from '../contexts/types.ts';

export function computeUnboundDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walker lands in Task 3.
  void syntaxTree;
  void state;
  void env;
  return diagnostics;
}

export function unboundLinter(env: Env): Extension {
  return linter((view) => computeUnboundDiagnostics(view.state, env));
}
```

- [ ] **Step 2: Add the `unboundAll` test helper**

Open `src/lib/testUtils.ts`. Two edits:

**2a. Imports.** Next to the existing `import { computeCrossRefDiagnostics } from './completions/lint/crossRef.ts';` line, add:

```ts
import { computeUnboundDiagnostics } from './completions/lint/unbound.ts';
```

**2b. Helper.** Append after `crossRefAll`:

```ts
export function unboundAll(source: string, engine: Engine): Diagnostic[] {
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc: source,
    extensions: [javascript(), localsField],
  });
  return computeUnboundDiagnostics(state, env);
}
```

- [ ] **Step 3: Verify**

Run:
```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/unbound.ts src/lib/testUtils.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): unbound-identifier skeleton + unboundAll helper

Empty walker shell + unboundAll(source, engine) test helper next to
crossRefAll. Behavioral tests come in Task 3.

Refs machines-demo build-error smoke."
```

Stage only those 2 files. No attribution footer.

---

### Task 3: Unbound-identifier walker

**Files:**
- Modify: `src/lib/completions/lint/unbound.ts`
- Create: `src/lib/completions/lint/unbound.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/lint/unbound.test.ts
import { describe, it, expect } from 'vitest';
import { unboundAll } from '../../testUtils.ts';

describe('lint/unbound — bare identifier references', () => {
  it('S-unbound-call-not-destructured', () => {
    // User typed call('sss') but didn't destructure call from imports.
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark,
        20: call('sss'),
        30: stop,
      })
    `;
    const diags = unboundAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe(`'call' is not defined`);
  });

  it('S-unbound-all-destructured-ok', () => {
    const src = `
      const { PostMachine, mark, call, stop } = imports;
      new PostMachine({
        10: mark,
        20: call('sss'),
        30: stop,
      })
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-local-const-ok', () => {
    const src = `
      const { PostMachine } = imports;
      const cfg = { a: 1 };
      new PostMachine(cfg)
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-imports-is-allowlisted', () => {
    // The `imports` bridge is always available, never declared.
    const src = `const { mark } = imports;`;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-common-globals-allowed', () => {
    const src = `
      const x = Math.floor(1.5);
      const y = JSON.stringify({ a: 1 });
      const z = console.log;
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-skips-arrow-params', () => {
    // x is an arrow param — not declared at top level, but used only inside
    // the arrow body. Walker should skip function/arrow scopes entirely.
    const src = `
      const xs = [1, 2, 3];
      const doubled = xs.map(x => x + 1);
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-skips-function-decls', () => {
    const src = `
      const greeting = 'hi';
      function helper(name) {
        return greeting + name;
      }
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-renamed-destructure', () => {
    // The local alias is bound, not the original.
    const src = `
      const { mark: writeOne } = imports;
      new PostMachine({ 10: writeOne(20) })
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-works-on-turing', () => {
    // Same check applies on /turing — undeclared 'State' in a new expr.
    const src = `
      const { Alphabet } = imports;
      const a = new Alphabet(['_', 'X']);
      const s = new State({});
    `;
    const diags = unboundAll(src, 'turing');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe(`'State' is not defined`);
  });

  it('S-unbound-multiple-undeclared', () => {
    const src = `
      const { PostMachine } = imports;
      new PostMachine({
        10: foo(),
        20: bar(),
      })
    `;
    const diags = unboundAll(src, 'post');
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.message)).toEqual([
      `'foo' is not defined`,
      `'bar' is not defined`,
    ]);
  });
});
```

- [ ] **Step 2: Run tests — many should fail**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/unbound.test.ts`
Expected: the "expect diagnostics" specs fail (no walker yet). The no-diagnostics-expected specs pass coincidentally.

- [ ] **Step 3: Implement the walker**

Replace the stub body of `src/lib/completions/lint/unbound.ts` with:

```ts
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
```

- [ ] **Step 4: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/completions/lint/unbound.test.ts
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```

Expected: 10 specs pass. Check + lint clean.

If `S-unbound-skips-arrow-params` or `S-unbound-skips-function-decls` fail, the FUNCTION_NODE_NAMES list might be missing a Lezer node name. Verify by writing a one-off probe (probe pattern from earlier Phase 1 work) — `console.log(syntaxTree(state).toString())` and check what node `(x) => x + 1` produces. Likely candidates: `ArrowFunction`, `ArrowExpression`.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/completions/lint/unbound.ts src/lib/completions/lint/unbound.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(completions/lint): unbound-identifier walker

Walks VariableName nodes at function-scope depth 0; flags any not in
scanLocals' rawLocals set + a small allowlist of common JS built-ins +
the 'imports' bridge. Function/arrow bodies are skipped — scanLocals
doesn't track their params, and flagging them would produce false
positives.

Works on both engines. Catches the common case where a user typed
call('sss') / new State({}) without destructuring call / State from
imports.

Refs machines-demo build-error smoke."
```

Stage only those 2 files. No attribution footer.

---

### Task 4: Wire `unboundLinter` into Editor.svelte

**Files:**
- Modify: `src/components/Editor.svelte`

- [ ] **Step 1: Add the import**

In `src/components/Editor.svelte`, alongside the existing `import { argCountLinter } from '../lib/completions/lint/argCount.ts';` and `import { crossRefLinter } from '../lib/completions/lint/crossRef.ts';`, add:

```ts
import { unboundLinter } from '../lib/completions/lint/unbound.ts';
```

- [ ] **Step 2: Append to the extensions array**

In the `$derived.by` body, append `unboundLinter(env)` to the `base` array right after `crossRefLinter(env)`:

```ts
const extensions = $derived.by(() => {
  const env: Env = { engine, schema: getSchema(engine) };
  const base = [...completionExtensions(engine), syntaxLinter, argCountLinter(env), crossRefLinter(env), unboundLinter(env)];
  return theme.resolved === 'dark' ? [oneDark, ...base] : base;
});
```

- [ ] **Step 3: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run
```

Expected: clean. Test count = previous + the new unbound + empty-subroutine specs.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/Editor.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(editor): wire unboundLinter alongside argCount + crossRef

Unbound-identifier diagnostics now flow into the editor's gutter
alongside the other lint sources. Same Env construction.

Refs machines-demo build-error smoke."
```

Stage only Editor.svelte. No attribution footer.

---

### Task 5: Manual smoke + docs + PR

**Manual fixture (paste in `/post`):**

```js
const { PostMachine, Tape, mark, right, stop } = imports;
//                                                  ^ note: 'call' NOT destructured

const machine = new PostMachine({
  sss: {},                  // expect: empty subroutine: 'sss' has no instructions
  10: mark,
  20: right,
  50: call('sss'),          // expect: 'call' is not defined
  60: stop,
}, { blankSymbol: '␣', markSymbol: '•' });
```

Confirm:
- Gutter shows 2 error markers — one on the `sss: {}` line, one on the `call` token at line 50.
- Adding `call` to the destructure removes only the unbound error.
- Adding `1: stop` inside `sss: { ... }` removes only the empty-subroutine error.

On `/turing`, paste:

```js
const { Alphabet } = imports;
const a = new Alphabet(['_', 'X']);
const s = new State({});       // expect: 'State' is not defined
```

Confirm one gutter marker on `State`.

If anything misbehaves, gather the specific repro and recommit a fix + regression test before opening the PR.

- [ ] **Step 1: Update CLAUDE.md**

In the `src/lib/completions/lint/` tree subsection, add a new entry under the existing `crossRef.ts`/`crossRef.test.ts` pair:

```
    │       ├── unbound.ts        computeUnboundDiagnostics(state, env) + unboundLinter(env) — walks VariableName nodes at function-scope depth 0, flags any not in scanLocals' rawLocals + a small GLOBAL_ALLOWLIST (common JS built-ins + the `imports` bridge). Function/arrow bodies are skipped to avoid false positives on params and inner-scope locals. Both engines.
    │       └── unbound.test.ts   Vitest specs across not-destructured / allowlisted / arrow-skipped / function-skipped / renamed-destructure / multi-undeclared cases (cites S-unbound-...)
```

In the Editor section prose (where `crossRef.ts` is described), append:

> And an unbound-identifier source at `src/lib/completions/lint/unbound.ts` — catches bare identifiers used in expression position that aren't destructured from `imports`, declared locally, or in the small JS-built-in allowlist. Skips function/arrow bodies to avoid false positives on their params.

Also extend the existing `crossRef.ts` tree-entry to mention the empty-subroutine check at the end of the existing description:

> Also flags empty subroutine bodies (`sss: {}`) — PostMachine throws "there is no instructions" at construction.

- [ ] **Step 2: Commit docs + plan**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add CLAUDE.md docs/superpowers/plans/2026-06-13-empty-sub-and-unbound-lint.md
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs: add unbound.ts to CLAUDE.md tree + check in plan

unbound-identifier lint source documented next to crossRef.ts; the
empty-subroutine check noted on the crossRef entry. Plan committed
alongside per the workspace convention for docs/superpowers/plans/."
```

- [ ] **Step 3: Rebase on master**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo fetch origin master
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo log HEAD..origin/master --oneline
```

If master moved, rebase: `git -C ... rebase origin/master`. If the branch was already pushed, force-push with lease.

- [ ] **Step 4: Open the PR (only with explicit user approval)**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo push -u origin feat/lint-empty-sub-and-unbound
gh pr create --repo mellonis/machines-demo --head feat/lint-empty-sub-and-unbound --base master --title "feat(completions/lint): empty subroutine + unbound-identifier diagnostics" --body "$(cat <<'EOF'
## Summary

Two build-time errors that the existing linters didn't catch — surfaced during smoke testing of the demo:

- **Empty subroutine** (\`sss: {}\`) — PostMachine throws \"there is no instructions\" at construction. Added inside the existing cross-ref linter: when \`collectScope\` records a subroutine with both \`indices.size === 0\` and \`subroutines.size === 0\`, emit \`error: \"empty subroutine: 'name' has no instructions\"\`. Post-only.
- **Unbound identifier** (\`call('sss')\` when \`call\` isn't destructured from \`imports\`) — would have surfaced at runtime as \`Can't find variable: call\`. New \`src/lib/completions/lint/unbound.ts\` walks \`VariableName\` nodes at function-scope depth 0 and flags anything not in \`scanLocals\` rawLocals + a small allowlist of common JS built-ins + the \`imports\` bridge. Works on both engines.

## Scope decisions

- The unbound walker SKIPS function/arrow bodies (FunctionDeclaration / FunctionExpression / ArrowFunction / MethodDeclaration / ClassMethod / ClassExpression). \`scanLocals\` only tracks top-level declarations; checking inside function scopes would falsely flag params and inner-block locals. Conservative skip is safer than a half-correct check; can be extended in a follow-up if it bites.
- The allowlist is pragmatic, not exhaustive. Users who reach for exotic globals (e.g. \`Reflect\`, \`Atomics\`) get a false positive; can extend as needed.
- Empty-subroutine flags only fully-empty bodies (no own numeric keys AND no nested subroutines). A subroutine containing only nested subroutines is NOT flagged here — uncertain whether PostMachine throws on that, left for follow-up.

## Out of scope

- Quick-fix actions (auto-add to destructure, auto-import suggestion) — belongs with the #103 unbound-identifier quick-fix.
- Type-checking arg types.
- Reachability / termination analysis.

## Test plan

- [x] 3 new specs in \`src/lib/completions/lint/crossRef.test.ts\` covering empty-subroutine / non-empty / empty-nested cases.
- [x] 10 new specs in a new \`src/lib/completions/lint/unbound.test.ts\` covering: not-destructured call, all-destructured-ok, local const ok, imports allowlisted, common globals allowed, arrow params skipped, function decl skipped, renamed destructure, both engines, multiple undeclared.
- [x] \`npm run check\` clean.
- [x] \`npm run lint\` clean.
- [x] \`npm test\` — full suite green.
- [x] Manual smoke on /post + /turing with the fixtures in the plan: gutter markers fire where expected; fixing each error individually clears its own marker without touching the other.

Closes the manual build-error report.
EOF
)"
```

Do not push or open the PR without explicit user approval.

---

## Self-review checklist

**Spec coverage:**
- Empty subroutine: Task 1 (3 specs).
- Unbound identifier on post: Task 3 (S-unbound-call-not-destructured + others).
- Unbound identifier on Turing: Task 3 (S-unbound-works-on-turing).
- Editor wire-up: Task 4.

**Placeholder scan:** every code step has the full code; commands have expected output.

**Type consistency:**
- `computeUnboundDiagnostics(state, env): Diagnostic[]` — Task 2 stub, Task 3 impl. Same signature.
- `unboundLinter(env): Extension` — Task 2 declared, Task 4 consumed. Same signature.
- `unboundAll(source, engine): Diagnostic[]` — Task 2 declared, Task 3 used. Same signature.
- `GLOBAL_ALLOWLIST`, `FUNCTION_NODE_NAMES` — declared once in Task 3, used inside the walker.

**Risk callouts:**
- Lezer node names for arrow functions: if `ArrowFunction` isn't the exact name in this Lezer JS version, the S-unbound-skips-arrow-params spec fails. Task 3's fallback is a probe — same pattern as Phase 1 / Phase 2. The plan covers this in Step 4's "If those specs fail" note.
- `scanLocals`'s `rawLocals` already includes destructured names (verified during Phase 1 work). The renamed-destructure case (`mark: writeOne`) puts `writeOne` in rawLocals (not `mark`); the unbound walker checks `writeOne` and finds it. ✓
- Function-scope skip uses `funcDepth` counter on `enter`/`leave`. If a Lezer node is in the function-node set but doesn't fire a `leave` callback for some reason (incomplete parse, early bailout), the depth could go stale. CodeMirror's `tree.iterate` reliably fires `leave` for every `enter` though — this is a non-issue in practice.
