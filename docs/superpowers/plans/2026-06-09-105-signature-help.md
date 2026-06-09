# Signature Help (Parameter Hints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a tooltip with the parameter signature of the call site (method, function, or `new`-expression) the cursor is inside, with the active parameter highlighted.

**Architecture:** A pure function `computeSignatureInfo(state, schema): SignatureInfo | null` walks the Lezer tree from the cursor up to the nearest `ArgList`, resolves its parent `CallExpression`/`NewExpression`'s callee against the engine schema (namespace functions, post-instructions, member methods via `inferLocalsFor`, or constructors), counts commas before the cursor for the active-arg index, and returns a structured result. A `StateField<Tooltip | null>` wraps that result for the CodeMirror `showTooltip` facet. Tests target the pure function directly so we don't need a mounted `EditorView`.

**Tech Stack:** CodeMirror 6 (`@codemirror/state`, `@codemirror/view`'s `showTooltip` + `Tooltip`), `@lezer/common` for tree walking, Vitest for tests.

**Scope notes (decisions locked in here, not subject to revisitation during implementation):**

- **Header rendering follows what the user typed**, not the schema name. We slice the callee node's source text. For `const { tapeBlock: tb } = imports; tb.symbol(▮)` the header reads `tb.symbol(…)`. Matches the rationale of `namespaceIdentifier.ts` showing both alias and original.
- **Callee resolution for renamed imports** uses a reverse map built from `importsBinding.renames` (`local → original`); only namespace functions / post-instructions / constructors take this path. Member methods already resolve via `inferLocalsFor` regardless of how the receiver was bound.
- **No tooltip when active index ≥ params.length.** Trailing comma past the last parameter just hides the tooltip (mirrors IntelliJ — there's nothing to hint). Zero-param signatures (e.g. post-instruction `mark`, no `params` field) also produce no tooltip — there's no signal to surface.
- **No multi-line, no markdown, no docs prose.** Single-line `name: typeStr, name: typeStr, …` body, active param bolded via CSS class. Matches the issue's non-goal.
- **Pre-existing dead infrastructure** in `scan/locals.ts` (`InferredType.kind === 'function'` with `signatureRef: 'tapeBlock.symbol'`) IS consumed by this plan — the resolver handles the `signatureRef` string by splitting on `.` and looking up via the schema namespace. This is the first reader of that field. **The emit is changed in Task 4 Step 0** from `'tapeBlock.symbol'` (lowercase) to `'TapeBlock.symbol'` (capitalized) so the resolver can use the schema namespace key as-is — the existing format would not match `schema.namespace[receiverName]` since the namespace is keyed by class name (`TapeBlock`).

---

## Pre-execution step (do once, before Task 1)

Post a comment on [#105](https://github.com/mellonis/machines-demo/issues/105) summarizing the decisions locked in this plan that aren't in the issue text, so the issue stays the source of truth for the design (per the workspace's "capture design decisions in their tracking issue" rule):

```
Locking these decisions before implementation:

1. Tooltip header reflects what the user typed (e.g. `tb.symbol(...)` when
   `const { tapeBlock: tb } = imports`), not the schema name. Matches the
   call-site context.
2. No tooltip when the cursor is past the last declared parameter (trailing
   comma after final arg). Mirrors IntelliJ — no hint, since there's nothing
   left to declare.
3. Post-instruction calls are in scope (the issue text mentions "function"
   but post-instructions are the natural sibling — `call(▮)`, `check(▮)`,
   `left(▮)` etc. all get hints; zero-param `mark`/`erase`/`noop`/`stop`
   produce no tooltip).
4. Consume — and re-key — the existing dead `InferredType.kind === 'function'`
   infrastructure in `scan/locals.ts`. The current `signatureRef:
   'tapeBlock.symbol'` emit will become `'TapeBlock.symbol'` so the
   resolver can look up `schema.namespace['TapeBlock']` directly.
```

---

## File Structure

**New files:**
- `src/lib/completions/hints/types.ts` — `SignatureInfo`, `ParamRender`, `ResolvedCallee` types.
- `src/lib/completions/hints/format.ts` — `formatTypeRef(t: TypeRef): string` pure helper. Separate file because it's exhaustive over `TypeRef` and worth testing in isolation.
- `src/lib/completions/hints/format.test.ts` — unit tests for `formatTypeRef`.
- `src/lib/completions/hints/signature.ts` — `computeSignatureInfo(state, env): SignatureInfo | null` (the cursor walk + callee resolution + active-arg count) and `signatureHelp(env): Extension` (the `StateField` + `showTooltip` wrapper).
- `src/lib/completions/hints/signature.test.ts` — black-box tests using a new `signatureAt(marked, engine)` helper.

**Modified files:**
- `src/lib/testUtils.ts` — add `signatureAt(marked, engine): SignatureInfo | null` next to `completionAt`.
- `src/lib/completions/index.ts` — wire `signatureHelp(env)` into the extension array returned by `completionExtensions(engine)`.
- `src/components/Editor.svelte` — add CSS for `.cm-tooltip.sig-help` and `.sig-help .sig-active` (kept in the same file as the existing CodeMirror `:global(...)` styles).
- `CLAUDE.md` (machines-demo) — add the new `hints/` directory to the lib tree and a one-paragraph reference to the sig-help layer next to the completions section.

**Why this split** — `computeSignatureInfo` is the testable unit; the `StateField` + `showTooltip` glue is a 15-line wrapper that doesn't add interesting failure modes. `formatTypeRef` is a small recursive function that's easier to exhaustively test on its own than via signature fixtures.

---

## Type definitions (used across tasks)

These types live in `src/lib/completions/hints/types.ts` and are referenced by later tasks. They are defined once in Task 1 and then imported.

```ts
import type { ParamSpec } from '../schema/types.ts';

export type ParamRender = {
  name: string;
  typeStr: string;
  optional: boolean;
};

export type SignatureInfo = {
  /** Source text of the callee as the user typed it (e.g. "tb.symbol", "tm", "new Alphabet"). */
  header: string;
  params: ParamRender[];
  /** 0-based index of the parameter the cursor is currently typing. May equal params.length, in which case no tooltip is produced. */
  activeIndex: number;
  /** Document position of the open paren — used as the tooltip's anchor. */
  anchor: number;
};

export type ResolvedCallee = {
  /** Parameters from the schema. */
  params: ParamSpec[];
  /** Source-text header (what the user typed for the callee, including `new` for NewExpression). */
  header: string;
};
```

---

### Task 1: Type-ref formatter (pure helper)

**Files:**
- Create: `src/lib/completions/hints/format.ts`
- Test: `src/lib/completions/hints/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/completions/hints/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatTypeRef } from './format.ts';

describe('hints/format/formatTypeRef', () => {
  it('S-fmt-primitive', () => {
    expect(formatTypeRef({ kind: 'primitive', name: 'string' })).toBe('string');
    expect(formatTypeRef({ kind: 'primitive', name: 'number' })).toBe('number');
    expect(formatTypeRef({ kind: 'primitive', name: 'boolean' })).toBe('boolean');
    expect(formatTypeRef({ kind: 'primitive', name: 'unknown' })).toBe('unknown');
  });

  it('S-fmt-class', () => {
    expect(formatTypeRef({ kind: 'class', name: 'State' })).toBe('State');
  });

  it('S-fmt-shape', () => {
    expect(formatTypeRef({ kind: 'shape', name: 'TapeOptions' })).toBe('TapeOptions');
  });

  it('S-fmt-constants', () => {
    expect(formatTypeRef({ kind: 'constants', name: 'movements' })).toBe('movements');
  });

  it('S-fmt-symbol', () => {
    expect(formatTypeRef({ kind: 'symbol' })).toBe('symbol');
  });

  it('S-fmt-array', () => {
    expect(formatTypeRef({ kind: 'array', of: { kind: 'primitive', name: 'string' } })).toBe('string[]');
    expect(formatTypeRef({ kind: 'array', of: { kind: 'class', name: 'Tape' } })).toBe('Tape[]');
  });

  it('S-fmt-union', () => {
    expect(formatTypeRef({
      kind: 'union',
      of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }],
    })).toBe('string | number');
  });

  it('S-fmt-union-of-arrays-wraps-each-side', () => {
    expect(formatTypeRef({
      kind: 'union',
      of: [
        { kind: 'array', of: { kind: 'primitive', name: 'string' } },
        { kind: 'symbol' },
      ],
    })).toBe('string[] | symbol');
  });

  it('S-fmt-array-of-union-wraps-union-in-parens', () => {
    expect(formatTypeRef({
      kind: 'array',
      of: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'symbol' }] },
    })).toBe('(string | symbol)[]');
  });

  it('S-fmt-literal', () => {
    expect(formatTypeRef({ kind: 'literal', value: 'keep' })).toBe('"keep"');
    expect(formatTypeRef({ kind: 'literal', value: 0 })).toBe('0');
    expect(formatTypeRef({ kind: 'literal', value: true })).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/completions/hints/format.test.ts`
Expected: FAIL with `Cannot find module './format.ts'`.

- [ ] **Step 3: Implement `formatTypeRef`**

```ts
// src/lib/completions/hints/format.ts
import type { TypeRef } from '../schema/types.ts';

export function formatTypeRef(t: TypeRef): string {
  switch (t.kind) {
    case 'primitive':
      return t.name;
    case 'class':
    case 'shape':
    case 'constants':
      return t.name;
    case 'symbol':
      return 'symbol';
    case 'array': {
      const inner = formatTypeRef(t.of);
      return t.of.kind === 'union' ? `(${inner})[]` : `${inner}[]`;
    }
    case 'union':
      return t.of.map(formatTypeRef).join(' | ');
    case 'literal':
      return typeof t.value === 'string' ? `"${t.value}"` : String(t.value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/completions/hints/format.test.ts`
Expected: PASS (10 specs).

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/format.ts src/lib/completions/hints/format.test.ts
git commit -m "feat(completions): add formatTypeRef helper for signature rendering

Pure formatter from schema TypeRef to human-readable string. Will be
consumed by the upcoming signature-help tooltip extension (#105)."
```

---

### Task 2: SignatureInfo types + namespace-function resolution (no rename, no active highlight yet)

This task gets a tooltip showing up for the simplest case — a bare-identifier call like `toMermaid(▮)` where the callee is a known namespace function. Active index is always 0 here; comma counting is wired in Task 3.

**Files:**
- Create: `src/lib/completions/hints/types.ts`
- Create: `src/lib/completions/hints/signature.ts`
- Create: `src/lib/completions/hints/signature.test.ts`
- Modify: `src/lib/testUtils.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/completions/hints/types.ts
import type { ParamSpec } from '../schema/types.ts';

export type ParamRender = {
  name: string;
  typeStr: string;
  optional: boolean;
};

export type SignatureInfo = {
  header: string;
  params: ParamRender[];
  activeIndex: number;
  anchor: number;
};

export type ResolvedCallee = {
  params: ParamSpec[];
  header: string;
};
```

- [ ] **Step 2: Add the `signatureAt` test helper**

Open `src/lib/testUtils.ts`. Make two separate edits — the file already has imports at the top and exports below.

**2a. Add the new imports to the imports block at the top of the file** (next to the existing `import { localsField } from './completions/scan/locals.ts';` line):

```ts
import { computeSignatureInfo } from './completions/hints/signature.ts';
import type { SignatureInfo } from './completions/hints/types.ts';
```

**2b. Append the `signatureAt` helper to the bottom of the file** (after the existing `completionAt` function):

```ts
export function signatureAt(marked: string, engine: Engine): SignatureInfo | null {
  const cursorPos = marked.indexOf('▮');
  if (cursorPos === -1) throw new Error('signatureAt: source must contain ▮');
  const doc = marked.slice(0, cursorPos) + marked.slice(cursorPos + 1);
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursorPos },
  });
  return computeSignatureInfo(state, env);
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/completions/hints/signature.test.ts
import { describe, it, expect } from 'vitest';
import { signatureAt } from '../../testUtils.ts';

describe('hints/signature — namespace function (Phase 1)', () => {
  it('S-sig-namespace-function-toMermaid', () => {
    const r = signatureAt(`toMermaid(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('toMermaid');
    expect(r!.params).toEqual([{ name: 'graph', typeStr: 'Graph', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-namespace-function-summarize', () => {
    const r = signatureAt(`summarize(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.params.map((p) => p.name)).toEqual(['state', 'block']);
    expect(r!.params.map((p) => p.typeStr)).toEqual(['State', 'TapeBlock']);
  });

  it('S-sig-not-a-call — null', () => {
    const r = signatureAt(`const x = 1 + ▮`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-unknown-callee — null', () => {
    const r = signatureAt(`thisIsNotInTheSchema(▮)`, 'turing');
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts`
Expected: FAIL with `Cannot find module './signature.ts'`.

- [ ] **Step 5: Implement `computeSignatureInfo` (namespace-function path only)**

```ts
// src/lib/completions/hints/signature.ts
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import type { ParamSpec } from '../schema/types.ts';
import type { ResolvedCallee, SignatureInfo } from './types.ts';
import { formatTypeRef } from './format.ts';

function findEnclosingArgList(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node) {
    if (node.name === 'ArgList') return node;
    node = node.parent;
  }
  return null;
}

function text(node: SyntaxNode, state: EditorState): string {
  return state.doc.sliceString(node.from, node.to);
}

function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
  const call = argList.parent;
  if (!call) return null;
  if (call.name !== 'CallExpression' && call.name !== 'NewExpression') return null;

  const callee = call.firstChild;
  if (!callee) return null;
  if (callee === argList) return null;

  if (call.name === 'CallExpression' && callee.name === 'VariableName') {
    const name = text(callee, state);
    const entry = env.schema.namespace[name];
    if (!entry) return null;
    if (entry.kind === 'function') {
      return { params: entry.params, header: name };
    }
    return null;
  }

  return null;
}

export function computeSignatureInfo(state: EditorState, env: Env): SignatureInfo | null {
  const pos = state.selection.main.head;
  const argList = findEnclosingArgList(state, pos);
  if (!argList) return null;

  const resolved = resolveCallee(argList, state, env);
  if (!resolved) return null;
  if (resolved.params.length === 0) return null;

  const params = resolved.params.map<{ name: string; typeStr: string; optional: boolean }>((p: ParamSpec) => ({
    name: p.name,
    typeStr: formatTypeRef(p.type),
    optional: p.optional === true,
  }));

  return {
    header: resolved.header,
    params,
    activeIndex: 0,
    anchor: argList.from,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts src/lib/completions/hints/format.test.ts`
Expected: PASS — 4 sig specs + 10 format specs.

- [ ] **Step 7: Commit**

```bash
git add src/lib/completions/hints/types.ts \
        src/lib/completions/hints/signature.ts \
        src/lib/completions/hints/signature.test.ts \
        src/lib/testUtils.ts
git commit -m "feat(completions): signature info for namespace function calls

computeSignatureInfo + signatureAt test helper. First slice covers
bare-VariableName callees resolving to schema namespace 'function'
entries (toMermaid, summarize, etc.). Active-arg counting, methods,
constructors, post-instructions, and renames follow in later commits.

Refs #105."
```

---

### Task 3: Active-argument index from comma count

**Files:**
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/hints/signature.test.ts`

- [ ] **Step 0: Verify the Lezer node name for commas inside `ArgList`**

The implementation in Step 3 assumes `child.name === ','` for the comma separator nodes inside an `ArgList`. Confirm before red-green so a failing spec is unambiguous. Open a Vitest scratch file or run a one-shot:

```ts
// Throwaway probe — paste into a temporary signature.probe.test.ts or run via
// `npx vitest run -t probe` after pasting.
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxTree } from '@codemirror/language';
import { it } from 'vitest';

it('probe: Lezer ArgList structure', () => {
  const state = EditorState.create({ doc: `f(a, b)`, extensions: [javascript()] });
  const tree = syntaxTree(state);
  // Print the whole tree shape:
   
  console.log(tree.toString());
  // Walk into the ArgList and list child names:
  let argList = tree.topNode.firstChild?.firstChild;
  while (argList && argList.name !== 'ArgList') argList = argList.nextSibling ?? null;
  let c = argList?.firstChild ?? null;
  while (c) {
     
    console.log('child:', JSON.stringify(c.name), c.from, c.to);
    c = c.nextSibling;
  }
});
```

Expected: child names include `'('`, the expression node for `a`, `','`, the expression node for `b`, `')'`. If commas appear with a different name (e.g. anonymous tokens skipped), the iteration in Step 3 must switch to "count distinct expression children whose `to <= pos`" — same surface, different traversal. Delete this probe file once confirmed; do not commit it.

- [ ] **Step 1: Write the failing test (append to signature.test.ts)**

```ts
describe('hints/signature — active argument', () => {
  it('S-sig-active-first-arg', () => {
    const r = signatureAt(`summarize(▮)`, 'turing');
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-active-second-arg', () => {
    const r = signatureAt(`summarize(myState, ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-active-second-arg-no-space', () => {
    const r = signatureAt(`summarize(myState,▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-active-past-last-returns-null', () => {
    // toMermaid takes one param — cursor after a trailing comma is past-last.
    const r = signatureAt(`toMermaid(g, ▮)`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-active-skips-commas-inside-nested-args', () => {
    // The cursor is inside summarize's ArgList; the comma inside the inner
    // array literal must not increment summarize's active index.
    const r = signatureAt(`summarize(makeState([a, b]), ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify the first three pass (already do — activeIndex is always 0 for arg 0 but always 0 in current impl) and the last two fail**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts`
Expected: 2 of the 4 new specs PASS by coincidence (`active-first-arg` and `active-second-arg-no-space` accidentally — actually `active-second-arg-no-space` expects `1` which current code returns `0`, so it FAILS). Net: 3 of 4 new specs FAIL.

- [ ] **Step 3: Implement active-arg counting**

Replace the body of `computeSignatureInfo` after the `resolveCallee` check with a comma-counting pass. The walk is "direct children of the ArgList only", which naturally excludes commas inside nested calls / arrays / objects because those live in their own subtrees, not as direct ArgList children.

```ts
// In src/lib/completions/hints/signature.ts:
function activeArgIndex(argList: SyntaxNode, pos: number): number {
  let commas = 0;
  let child = argList.firstChild;
  while (child) {
    if (child.name === ',' && child.to <= pos) commas += 1;
    child = child.nextSibling;
  }
  return commas;
}

// Update computeSignatureInfo: replace the `activeIndex: 0` line with:
export function computeSignatureInfo(state: EditorState, env: Env): SignatureInfo | null {
  const pos = state.selection.main.head;
  const argList = findEnclosingArgList(state, pos);
  if (!argList) return null;

  const resolved = resolveCallee(argList, state, env);
  if (!resolved) return null;
  if (resolved.params.length === 0) return null;

  const activeIndex = activeArgIndex(argList, pos);
  if (activeIndex >= resolved.params.length) return null;

  const params = resolved.params.map((p) => ({
    name: p.name,
    typeStr: formatTypeRef(p.type),
    optional: p.optional === true,
  }));

  return {
    header: resolved.header,
    params,
    activeIndex,
    anchor: argList.from,
  };
}
```

- [ ] **Step 4: Run tests to verify all sig + format specs pass**

Run: `npx vitest run src/lib/completions/hints/`
Expected: PASS (4 from Task 2 + 5 new + 10 format = 19).

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/hints/signature.test.ts
git commit -m "feat(completions): activeIndex from comma count

Walk direct children of ArgList counting commas before the cursor. Nested
calls/arrays/objects are skipped because their commas live in subtrees.
Past-last active index returns null (matches IntelliJ — no hint when
typing past the last declared parameter).

Refs #105."
```

---

### Task 4: Member-method calls (resolved via inferLocalsFor)

This is the bulk of the user value — `state.tag(▮)`, `tb.symbol(▮)`, `pm.stateAt(▮)`, etc.

**Files:**
- Modify: `src/lib/completions/scan/locals.ts`
- Modify: `src/lib/completions/scan/locals.test.ts`
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/hints/signature.test.ts`

- [ ] **Step 0: Re-key the `signatureRef` emit to schema-namespace casing**

The existing emit at `src/lib/completions/scan/locals.ts:184` uses lowercase `'tapeBlock.symbol'`, but `schema.namespace` is keyed by class name (`TapeBlock`). The Task 4 resolver does a direct namespace lookup, so the emit must use the namespace key.

**Edit 1** — `src/lib/completions/scan/locals.ts:184`:

```ts
// Before:
locals.set(local, { kind: 'function', signatureRef: 'tapeBlock.symbol' });
// After:
locals.set(local, { kind: 'function', signatureRef: 'TapeBlock.symbol' });
```

**Edit 2** — `src/lib/completions/scan/locals.test.ts:105` (the `S-scan-destructure-tapeblock-symbol` spec):

```ts
// Before:
expect(r.locals.get('symbol')).toEqual({ kind: 'function', signatureRef: 'tapeBlock.symbol' });
// After:
expect(r.locals.get('symbol')).toEqual({ kind: 'function', signatureRef: 'TapeBlock.symbol' });
```

Run the scanner suite to confirm green:

```bash
npx vitest run src/lib/completions/scan/
```

Expected: PASS.

Commit this as a small standalone change so the rest of Task 4 builds on a clean tree:

```bash
git add src/lib/completions/scan/locals.ts src/lib/completions/scan/locals.test.ts
git commit -m "refactor(completions/scan): use schema-namespace casing for signatureRef

The destructured-method signatureRef now uses 'TapeBlock.symbol' instead
of 'tapeBlock.symbol' so the upcoming signature-help resolver can look
up schema.namespace[receiverName] directly. Dead infrastructure today;
becomes load-bearing in #105."
```

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('hints/signature — member methods', () => {
  it('S-sig-member-state-tag', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('s.tag');
    expect(r!.params).toEqual([{ name: 'tags', typeStr: 'string[]', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-member-state-wohs', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.withOverriddenHaltState(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('s.withOverriddenHaltState');
    expect(r!.params).toEqual([{ name: 'continuation', typeStr: 'State', optional: false }]);
  });

  it('S-sig-member-tapeblock-symbol', () => {
    const src = `
      const { TapeBlock } = imports;
      const tb = new TapeBlock({ tapes: [] });
      tb.symbol(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('tb.symbol');
    expect(r!.params).toEqual([{ name: 'pattern', typeStr: '(string | symbol)[]', optional: false }]);
  });

  it('S-sig-member-postmachine-stateAt', () => {
    const src = `
      const { PostMachine } = imports;
      const pm = new PostMachine({});
      pm.stateAt(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.header).toBe('pm.stateAt');
    expect(r!.params).toEqual([{ name: 'path', typeStr: 'string', optional: false }]);
  });

  it('S-sig-member-destructured-tapeblock-symbol', () => {
    // Uses the existing scan/locals.ts signatureRef:'tapeBlock.symbol' path.
    const src = `
      const { TapeBlock } = imports;
      const tb = new TapeBlock({ tapes: [] });
      const { symbol } = tb;
      symbol(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('symbol');
    expect(r!.params).toEqual([{ name: 'pattern', typeStr: '(string | symbol)[]', optional: false }]);
  });

  it('S-sig-member-on-unknown-local — null', () => {
    const r = signatureAt(`somethingUntyped.tag(▮)`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-member-method-not-in-schema — null', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.totallyMadeUp(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts -t "member methods"`
Expected: FAIL — all 7 new specs return null (no member-call branch in resolver yet).

- [ ] **Step 3: Implement member-call resolution**

Extend `resolveCallee` to handle `MemberExpression` callees. Add a small helper that splits a `signatureRef` like `"tapeBlock.symbol"` into a class-key + method-name and looks up the method spec.

```ts
// Add to src/lib/completions/hints/signature.ts:

import { inferLocalsFor } from '../scan/locals.ts';
import type { InferredType } from '../scan/types.ts';
import type { MemberSpec } from '../schema/types.ts';

// Maps the signatureRef string back to its (class, member) pair via the schema.
// Currently only `tapeBlock.symbol` is emitted; the resolver is written to handle
// any "<receiver>.<member>" where <receiver> matches a namespace entry.
function resolveSignatureRef(signatureRef: string, env: Env): MemberSpec | null {
  const dot = signatureRef.indexOf('.');
  if (dot < 0) return null;
  const receiverName = signatureRef.slice(0, dot);
  const methodName = signatureRef.slice(dot + 1);
  const ns = env.schema.namespace[receiverName];
  if (!ns) return null;
  let className: string | null = null;
  if (ns.kind === 'class') className = ns.classRef;
  else if (ns.kind === 'singleton' && ns.type.kind === 'class') className = ns.type.name;
  if (!className) return null;
  const cls = env.schema.classes[className];
  if (!cls) return null;
  return cls.members.find((m) => m.name === methodName) ?? null;
}

function lookupMethod(localType: InferredType, methodName: string, env: Env): MemberSpec | null {
  if (localType.kind === 'class') {
    const cls = env.schema.classes[localType.name];
    if (!cls) return null;
    return cls.members.find((m) => m.name === methodName && m.kind === 'method') ?? null;
  }
  if (localType.kind === 'function') {
    // The local is itself a destructured method (e.g. `const { symbol } = tb`).
    // The methodName here would be something invoked ON that function — out of scope.
    return null;
  }
  return null;
}
```

Now extend `resolveCallee`. Replace the existing function body with:

```ts
function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
  const call = argList.parent;
  if (!call) return null;
  if (call.name !== 'CallExpression' && call.name !== 'NewExpression') return null;

  const callee = call.firstChild;
  if (!callee || callee === argList) return null;

  // CallExpression with bare VariableName: namespace function or a typed local function.
  if (call.name === 'CallExpression' && callee.name === 'VariableName') {
    const name = text(callee, state);
    const entry = env.schema.namespace[name];
    if (entry?.kind === 'function') {
      return { params: entry.params, header: name };
    }
    // Locally-typed function (e.g. destructured `{ symbol } = tb`)
    const { locals } = inferLocalsFor(state, env.schema);
    const local = locals.get(name);
    if (local?.kind === 'function') {
      const member = resolveSignatureRef(local.signatureRef, env);
      if (member?.params) return { params: member.params, header: name };
    }
    return null;
  }

  // CallExpression with MemberExpression callee: receiver.method(...)
  if (call.name === 'CallExpression' && callee.name === 'MemberExpression') {
    const receiver = callee.firstChild;
    const dot = receiver?.nextSibling;
    const method = callee.lastChild;
    if (!receiver || receiver.name !== 'VariableName' || !method || method.name !== 'PropertyName') return null;
    if (!dot || dot.name !== '.') return null;

    const receiverName = text(receiver, state);
    const methodName = text(method, state);
    const { locals } = inferLocalsFor(state, env.schema);

    let localType: InferredType | null = locals.get(receiverName) ?? null;
    if (!localType) {
      // Fall back to namespace (e.g. `haltState.<...>` if the user typed it bare).
      const ns = env.schema.namespace[receiverName];
      if (ns?.kind === 'class') localType = { kind: 'class', name: ns.classRef };
      else if (ns?.kind === 'singleton' && ns.type.kind === 'class') localType = { kind: 'class', name: ns.type.name };
    }
    if (!localType) return null;

    const member = lookupMethod(localType, methodName, env);
    if (!member?.params) return null;

    return { params: member.params, header: `${receiverName}.${methodName}` };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts`
Expected: PASS — all sig specs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/hints/signature.test.ts
git commit -m "feat(completions): resolve member-method calls for signature help

receiver.method(▮) — resolves the receiver via inferLocalsFor (or
namespace fallback for bare singletons), looks up the method's params on
the schema class. Also handles destructured methods carrying a
signatureRef (the existing 'tapeBlock.symbol' case).

Refs #105."
```

---

### Task 5: NewExpression (constructor signatures)

**Files:**
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/hints/signature.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('hints/signature — constructors', () => {
  it('S-sig-new-alphabet', () => {
    const r = signatureAt(`new Alphabet(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('new Alphabet');
    expect(r!.params).toEqual([{ name: 'symbols', typeStr: 'string[]', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-new-state-positional', () => {
    // State ctor: (symbolToData, name?)
    const r = signatureAt(`new State(▮)`, 'turing');
    expect(r!.params.map((p) => p.name)).toEqual(['symbolToData', 'name']);
    expect(r!.params.map((p) => p.optional)).toEqual([false, true]);
  });

  it('S-sig-new-state-second-arg', () => {
    const r = signatureAt(`new State({}, ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-new-postmachine', () => {
    const r = signatureAt(`new PostMachine(▮)`, 'post');
    expect(r!.params.map((p) => p.name)).toEqual(['instructions', 'options']);
    expect(r!.params[1].optional).toBe(true);
  });

  it('S-sig-new-unknown-class — null', () => {
    const r = signatureAt(`new NoSuchClass(▮)`, 'turing');
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — they fail (resolver returns null on NewExpression)**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts -t "constructors"`
Expected: FAIL — 4 of 5 new specs return null (the negative case passes by coincidence).

- [ ] **Step 3: Implement NewExpression branch**

Inside `resolveCallee`, add the NewExpression case before the final `return null`:

```ts
  if (call.name === 'NewExpression' && callee.name === 'VariableName') {
    const className = text(callee, state);
    const cls = env.schema.classes[className];
    if (!cls?.ctor) return null;
    return { params: cls.ctor.params, header: `new ${className}` };
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/hints/signature.test.ts
git commit -m "feat(completions): constructor signatures (new Foo(...))

Resolves NewExpression callees via schema.classes[...].ctor.params.
State ctor is positional (symbolToData, name?) — options-bag callees
already get their per-key surface from contexts/optionsBag.ts; the
signature tooltip complements it at the top-level.

Refs #105."
```

---

### Task 6: Post-instruction calls

**Files:**
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/hints/signature.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('hints/signature — post instructions', () => {
  it('S-sig-post-call', () => {
    const src = `
      const { call } = imports;
      call(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('call');
    expect(r!.params).toEqual([{ name: 'label', typeStr: 'string', optional: false }]);
  });

  it('S-sig-post-check-second-arg', () => {
    const src = `
      const { check } = imports;
      check('then', ▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.params.map((p) => p.name)).toEqual(['thenLabel', 'elseLabel']);
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-post-mark — null (no params)', () => {
    const src = `
      const { mark } = imports;
      mark(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r).toBeNull();
  });

  it('S-sig-post-left-optional-jumpTo', () => {
    const src = `
      const { left } = imports;
      left(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.params).toEqual([{ name: 'jumpTo', typeStr: 'string | number', optional: true }]);
  });
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts -t "post instructions"`
Expected: FAIL — namespace branch only handles `kind: 'function'`, not `'post-instruction'`.

- [ ] **Step 3: Extend the namespace branch**

In `resolveCallee`, change the bare-VariableName lookup to also accept post-instruction entries:

```ts
    // Replace the existing entry?.kind === 'function' branch with:
    if (entry?.kind === 'function') {
      return { params: entry.params, header: name };
    }
    if (entry?.kind === 'post-instruction' && entry.params) {
      return { params: entry.params, header: name };
    }
```

(Note: `entry.params` is optional on post-instructions — if absent, we return null and produce no tooltip. `mark` / `erase` / `noop` / `stop` fall through naturally.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/hints/signature.test.ts
git commit -m "feat(completions): post-instruction signatures

Namespace entries of kind 'post-instruction' with declared params now
produce a tooltip. mark/erase/noop/stop have no params field and are
skipped naturally (zero-param signatures don't render).

Refs #105."
```

---

### Task 7: Renamed imports

`const { toMermaid: tm } = imports; tm(▮)` — `tm` is not in `schema.namespace`, but the `importsBinding.renames` map records the rename. We need a reverse lookup.

**Files:**
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/hints/signature.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('hints/signature — renamed imports', () => {
  it('S-sig-rename-namespace-function', () => {
    const src = `
      const { toMermaid: tm } = imports;
      tm(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).not.toBeNull();
    // Header reflects what the user typed (the local alias), not the original name.
    expect(r!.header).toBe('tm');
    expect(r!.params).toEqual([{ name: 'graph', typeStr: 'Graph', optional: false }]);
  });

  it('S-sig-rename-class-ctor', () => {
    const src = `
      const { Alphabet: A } = imports;
      new A(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('new A');
    expect(r!.params).toEqual([{ name: 'symbols', typeStr: 'string[]', optional: false }]);
  });

  it('S-sig-rename-post-instruction', () => {
    const src = `
      const { call: callSub } = imports;
      callSub(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.header).toBe('callSub');
    expect(r!.params).toEqual([{ name: 'label', typeStr: 'string', optional: false }]);
  });
});
```

- [ ] **Step 2: Run tests — they fail**

Run: `npx vitest run src/lib/completions/hints/signature.test.ts -t "renamed imports"`
Expected: FAIL — bare-VariableName lookup hits `schema.namespace[name]` directly and finds nothing for the alias.

- [ ] **Step 3: Add reverse-rename resolution**

Add a small helper, and update both the CallExpression-bare-VariableName branch and the NewExpression branch to consult it:

```ts
// Add to src/lib/completions/hints/signature.ts:

function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}
```

Refactor the namespace lookup so both branches reuse it. Update the bare-VariableName CallExpression branch:

```ts
  if (call.name === 'CallExpression' && callee.name === 'VariableName') {
    const typed = text(callee, state);
    const schemaName = env.schema.namespace[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
    const entry = env.schema.namespace[schemaName];
    if (entry?.kind === 'function') return { params: entry.params, header: typed };
    if (entry?.kind === 'post-instruction' && entry.params) return { params: entry.params, header: typed };

    // Locally-typed function fallback (destructured method) — unchanged.
    const { locals } = inferLocalsFor(state, env.schema);
    const local = locals.get(typed);
    if (local?.kind === 'function') {
      const member = resolveSignatureRef(local.signatureRef, env);
      if (member?.params) return { params: member.params, header: typed };
    }
    return null;
  }
```

Update the NewExpression branch:

```ts
  if (call.name === 'NewExpression' && callee.name === 'VariableName') {
    const typed = text(callee, state);
    const schemaName = env.schema.classes[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
    const cls = env.schema.classes[schemaName];
    if (!cls?.ctor) return null;
    return { params: cls.ctor.params, header: `new ${typed}` };
  }
```

- [ ] **Step 4: Run all hints tests**

Run: `npx vitest run src/lib/completions/hints/`
Expected: PASS — all sig + format specs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/hints/signature.test.ts
git commit -m "feat(completions): resolve renamed imports for signature help

const { toMermaid: tm } = imports; tm(▮) — reverse-rename lookup against
importsBinding.renames so the alias resolves to its original schema entry.
Header still shows what the user typed; only the schema lookup uses the
original name.

Refs #105."
```

---

### Task 8: StateField + showTooltip wiring (the runtime extension)

Pure logic is done. This task adds the actual editor integration: a `StateField<Tooltip | null>` that reads `computeSignatureInfo` on each transaction, builds DOM, and feeds the `showTooltip` facet.

**Files:**
- Modify: `src/lib/completions/hints/signature.ts`
- Modify: `src/lib/completions/index.ts`

- [ ] **Step 1: Add `signatureHelp(env)` to signature.ts**

```ts
// Add imports at the top:
import { StateField } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';

// Add at the bottom of src/lib/completions/hints/signature.ts:

function renderTooltipDom(info: SignatureInfo): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-tooltip-sig-help sig-help';
  const head = document.createElement('span');
  head.className = 'sig-callee';
  head.textContent = `${info.header}(`;
  dom.appendChild(head);

  info.params.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.textContent = ', ';
      dom.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = i === info.activeIndex ? 'sig-param sig-active' : 'sig-param';
    span.textContent = `${p.name}${p.optional ? '?' : ''}: ${p.typeStr}`;
    dom.appendChild(span);
  });

  const tail = document.createElement('span');
  tail.className = 'sig-callee';
  tail.textContent = ')';
  dom.appendChild(tail);
  return dom;
}

function infoToTooltip(info: SignatureInfo): Tooltip {
  return {
    pos: info.anchor,
    above: true,
    arrow: false,
    create: () => ({ dom: renderTooltipDom(info) }),
  };
}

export function signatureHelp(env: Env) {
  const field = StateField.define<Tooltip | null>({
    create: (state) => {
      const info = computeSignatureInfo(state, env);
      return info ? infoToTooltip(info) : null;
    },
    update: (_value, tr) => {
      const info = computeSignatureInfo(tr.state, env);
      return info ? infoToTooltip(info) : null;
    },
    provide: (f) => showTooltip.from(f),
  });
  return field;
}
```

- [ ] **Step 2: Wire it into `completionExtensions`**

```ts
// src/lib/completions/index.ts
// Add import:
import { signatureHelp } from './hints/signature.ts';

// In completionExtensions(), add signatureHelp(env) to the array (place it after
// localsField — it depends on it):
export function completionExtensions(engine: Engine): Extension[] {
  const env: Env = { engine, schema: getSchema(engine) };
  return [
    localsField,
    signatureHelp(env),
    javascriptLanguage.data.of({ autocomplete: memberAccess(env) }),
    javascriptLanguage.data.of({ autocomplete: debugAssignment(env) }),
    javascriptLanguage.data.of({ autocomplete: optionsBag(env) }),
    javascriptLanguage.data.of({ autocomplete: namespaceIdentifier(env) }),
    javascriptLanguage.data.of({ autocomplete: destructureBag(env) }),
    javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
  ];
}
```

- [ ] **Step 3: Type-check, lint, run all tests**

Run: `npm run check && npm run lint && npx vitest run`
Expected: PASS across the suite.

- [ ] **Step 4: Commit**

```bash
git add src/lib/completions/hints/signature.ts src/lib/completions/index.ts
git commit -m "feat(completions): wire signature-help StateField into editor

StateField<Tooltip|null> recomputes computeSignatureInfo on every
transaction and feeds the showTooltip facet. DOM render is a single-line
'callee(name: type, ...)' with the active param in a .sig-active span.

Refs #105."
```

---

### Task 9: Tooltip CSS

**Files:**
- Modify: `src/components/Editor.svelte`

- [ ] **Step 1: Read the existing CodeMirror :global block**

Read `src/components/Editor.svelte` to locate the `:global(...)` style block.

- [ ] **Step 2: Add sig-help styles inside the existing `<style>` block**

Append these rules inside the existing `<style>` block, alongside the other `:global(.cm-*)` rules. Use existing palette tokens (`--fg`, `--bg`, `--accent`, `--border` — confirm exact names from `app.css` while implementing) so the tooltip reads alongside the autocompletion popover.

```css
:global(.cm-tooltip .cm-tooltip-sig-help) {
  padding: 4px 8px;
  font-family: var(--mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
  white-space: nowrap;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}

:global(.cm-tooltip .sig-help .sig-param) {
  opacity: 0.7;
}

:global(.cm-tooltip .sig-help .sig-active) {
  opacity: 1;
  font-weight: 600;
  color: var(--accent, var(--fg));
}

:global(.cm-tooltip .sig-help .sig-callee) {
  opacity: 0.9;
}
```

(If exact token names differ in `app.css`, swap them — the goal is to match the existing autocomplete popover surface.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Editor.svelte
git commit -m "feat(editor): styling for signature-help tooltip

Single-line monospace tooltip matching the existing CodeMirror popover
surface; active parameter is bolded and uses --accent.

Refs #105."
```

---

### Task 10: Manual smoke test against the running dev server

This is the verification-before-completion step. Skipping it risks declaring the feature done with the tooltip never actually appearing because of e.g. a CSS-scoping bug or facet wiring mistake that unit tests can't catch.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open `http://localhost:5173/turing` in a browser.

- [ ] **Step 2: Reset the editor to the default example and try each scenario**

Type each of these (clearing between attempts) and confirm a tooltip appears with the expected active parameter:

| Type | Expected tooltip text | Active param |
|---|---|---|
| `summarize(` | `summarize(state: State, block: TapeBlock)` | `state` bolded |
| `summarize(s, ` | same | `block` bolded |
| `summarize(s, b)` (cursor after `)` ) | (no tooltip) | — |
| `new Alphabet(` | `new Alphabet(symbols: string[])` | `symbols` bolded |
| `new State(` | `new State(symbolToData: StateSymbolMap, name?: string)` | `symbolToData` bolded |
| In the default Turing example, place cursor inside the `tapeBlock.symbol([` arg | `tapeBlock.symbol(pattern: (string \| symbol)[])` | `pattern` bolded |

Switch to `/post`:

| Type | Expected tooltip text | Active param |
|---|---|---|
| `call(` | `call(label: string)` | `label` bolded |
| `check('a', ` | `check(thenLabel: string \| number, elseLabel: string \| number)` | `elseLabel` bolded |
| `mark(` | (no tooltip — no params) | — |
| `left(` | `left(jumpTo?: string \| number)` | `jumpTo` bolded |

- [ ] **Step 3: Confirm theme switching works**

Toggle the demo's light/dark theme — the tooltip background/border/text colors should update without re-render.

- [ ] **Step 4: Verify no regressions**

- Open autocomplete (Ctrl-Space) at a typical location — the existing menu should still work alongside the new tooltip.
- Build / Step / Run still operate normally.

- [ ] **Step 5: If smoke test reveals issues, fix and add an E2E or unit test before committing the fix.**

The cost of a unit-test backfill that pins the bug is small; rolling forward without one risks the same bug recurring on the next refactor.

- [ ] **Step 6: Commit anything found in Step 5 as a follow-up**

```bash
git add <whatever-changed>
git commit -m "fix(completions): <one-liner>

<2-3 lines on what the smoke test caught + how the fix narrows it.>

Refs #105."
```

---

### Task 11: Docs touch-up + PR

**Files:**
- Modify: `CLAUDE.md` (machines-demo)
- New PR

- [ ] **Step 1: Update CLAUDE.md to mention the hints layer**

In the `src/lib/completions/` section of the lib tree, add a new sub-entry:

```
    │   ├── hints/                # signature-help tooltip layer (#105)
    │   │   ├── format.ts           formatTypeRef(TypeRef): string — schema TypeRef -> human-readable
    │   │   ├── types.ts            SignatureInfo / ParamRender / ResolvedCallee
    │   │   ├── signature.ts        computeSignatureInfo(state, env) + signatureHelp(env) StateField
    │   │   └── signature.test.ts   black-box specs via signatureAt helper
```

In the prose paragraph describing `completionExtensions(engine)`, add a short note: "Plus the signature-help layer at `src/lib/completions/hints/` (#105) — a `StateField<Tooltip | null>` that walks the Lezer tree from the cursor up to the enclosing `ArgList`, resolves the parent `CallExpression`/`NewExpression`'s callee against the schema (namespace functions, post-instructions, member methods via `inferLocalsFor`, or constructors — with reverse-rename resolution against `importsBinding.renames`), counts commas before the cursor for the active-arg index, and renders a single-line tooltip via the `showTooltip` facet."

- [ ] **Step 2: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: add hints/ layer to CLAUDE.md tree

Signature-help (#105) lives at src/lib/completions/hints/. Notes the
StateField wiring + the callee resolution surface (namespace function,
post-instruction, member method, constructor; reverse-rename via
importsBinding)."
```

- [ ] **Step 3: Rebase on master (per global git workflow)**

```bash
git fetch origin master
git rebase origin/master
```

If a rebase is needed and the branch was already pushed, force-push (`git push --force-with-lease`).

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(completions): signature help / parameter hints (#105)" --body "$(cat <<'EOF'
## Summary
- New \`src/lib/completions/hints/\` layer: \`computeSignatureInfo(state, env)\` (Lezer walk + schema-driven callee resolution + comma-count active-arg index) and \`signatureHelp(env)\` (StateField wiring into the showTooltip facet).
- Resolves the callee for: namespace functions (\`toMermaid\`, \`summarize\`, …), post-instructions (\`call\`, \`check\`, \`left\`, \`right\`), member methods (\`state.tag\`, \`tb.symbol\`, \`pm.stateAt\`), and constructors (\`new Alphabet\`, \`new State\`, …) — with reverse-rename resolution for aliased imports (\`const { toMermaid: tm } = imports; tm(▮)\`).
- No tooltip when active-arg index is past the last declared parameter, or when the callee has no \`params\` (e.g. post \`mark\`/\`erase\`).
- Tooltip header shows what the user typed (alias if renamed), keeping call-site context.

## Test plan
- [x] Unit specs for format helper (\`format.test.ts\`, 10 specs).
- [x] Unit specs for resolver covering namespace, member, constructor, post-instruction, rename, and out-of-context cases (\`signature.test.ts\`, ~20 specs).
- [x] Manual smoke against \`npm run dev\` on both engines; theme toggle preserves styling.
- [x] \`npm run check && npm run lint && npm test\` green.

Closes #105.
EOF
)"
```

- [ ] **Step 5: Once CI is green, merge via squash (per repo convention) — wait for user's say-so**

Do not merge without explicit user approval per global commit policy.

---

## Self-review checklist

**Spec coverage** — every section of #105 mapped:
- "Inside `tapeBlock.symbol(▮)`" → Task 4 (`S-sig-member-tapeblock-symbol`).
- "Inside `state.tag(▮)`" → Task 4 (`S-sig-member-state-tag`).
- "Inside `state.withOverriddenHaltState(▮)`" → Task 4 (`S-sig-member-state-wohs`).
- "Inside `new Alphabet(▮)`" → Task 5 (`S-sig-new-alphabet`).
- "Inside `toMermaid(▮)`" → Task 2 (`S-sig-namespace-function-toMermaid`).
- "Detect cursor context" / "Identify active argument" / "Render tooltip" — Tasks 2 / 3 / 8.
- "Unit test pattern: extend `completionAt` helper" — Task 2 adds `signatureAt` to `testUtils.ts`.
- Issue's named specs (`S-sig-member-method`, `S-sig-namespace-function`, `S-sig-new-expression`, `S-sig-out-of-context`) — covered by named specs in Tasks 2, 4, 5; `S-sig-out-of-context` covered by `S-sig-not-a-call` and `S-sig-unknown-callee`.

Beyond the issue:
- Rename handling (called out as the lock-in question in my pre-plan reply) — Task 7.
- Post-instructions (issue mentions "function" only; post engine is in scope per existing schema) — Task 6.
- Dead-infrastructure `signatureRef` consumption — Task 4 makes this the first reader.

**Placeholder scan** — no TBDs, no "implement as appropriate", no "similar to Task N" without inlined code. All code blocks are complete; commands have expected outputs.

**Type consistency** —
- `SignatureInfo`, `ParamRender`, `ResolvedCallee` defined once in Task 2 and imported afterward.
- `computeSignatureInfo(state, env)`, `signatureHelp(env)`, `signatureAt(marked, engine)` — names used consistently across tasks.
- `resolveSignatureRef` / `lookupMethod` / `originalImportName` — added in Tasks 4 and 7 respectively, no name drift.
- Imports added incrementally: `inferLocalsFor`, `InferredType`, `MemberSpec` in Task 4; `StateField`, `showTooltip`, `Tooltip` in Task 8.

**Risk callouts** —
- Lezer's exact node name for commas inside `ArgList` is assumed to be `","`. If Lezer's JS grammar names it differently (e.g. `'Punctuation'`), Task 3 specs surface this immediately — the fix is a one-line node-name change. Worth verifying against `syntaxTree(state).toString()` during Task 3 implementation if specs fail.
- `text(callee, state)` for a `MemberExpression`'s receiver assumes the receiver is a `VariableName`. Chained access (`a.b.c(▮)`) is out of scope — the plan returns null for it. This is intentional and matches the schema's vocabulary (receivers are user-typed local variables or namespace identifiers, not nested members).
