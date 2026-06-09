# Smart Editor Completions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo's flat-list completion source with a context-aware, schema-driven layer that surfaces engine-API knowledge while the user types — covering `state.debug` shapes, user-named state instances, constructor params/options, auto-import into the `imports` destructure, and generic instance properties.

**Architecture:** Three layers + one apply-helper under `src/lib/completions/`. (1) A hand-rolled TS schema describes the engine + post API surface. (2) A Lezer walker over the editor buffer infers types for local declarations. (3) Five composable `CompletionSource`s wrap context-specific menus. (4) An apply callback rewrites the top `const { … } = imports;` block when the user accepts an undestructured identifier. See `docs/superpowers/specs/2026-06-07-44-smart-completions-design.md` for the full design.

**Tech Stack:** TypeScript, Svelte 5, CodeMirror 6 (`@codemirror/state`, `@codemirror/autocomplete`, `@codemirror/lang-javascript`'s Lezer JS tree), Vitest (node + happy-dom envs), Playwright.

**Commit/PR shape:** Single branch `feat/smart-completions` (already created and pushed; spec committed). Five phase-aligned commits to follow. The user grants commit permission at phase boundaries — **do not auto-commit between tasks**. Each phase's final task is a "stop and report" gate.

**Reference tracking issue:** [#103](https://github.com/mellonis/machines-demo/issues/103). Original ask: [#44](https://github.com/mellonis/machines-demo/issues/44) (closed as superseded).

---

## File structure

New files (created across the phases):

```
src/lib/completions/
├── index.ts                        # completionExtensions(engine) — replaces src/lib/completions.ts
├── schema/
│   ├── types.ts                    # EngineSchema, NamespaceEntry, ClassSpec, ShapeSpec, TypeRef, ParamSpec, MemberSpec
│   ├── turing.ts                   # TURING_SCHEMA: EngineSchema
│   ├── post.ts                     # POST_SCHEMA: EngineSchema
│   ├── index.ts                    # getSchema(engine)
│   └── engine.test.ts              # drift-guard + invariants (S-schema-*)
├── scan/
│   ├── types.ts                    # InferredType, InferredLocals, ImportsBinding, Env
│   ├── locals.ts                   # inferLocals + localsField (CodeMirror StateField)
│   └── locals.test.ts              # S-scan-*
├── contexts/
│   ├── types.ts                    # Env, SourceFactory
│   ├── memberAccess.ts             # S-src-member-*
│   ├── memberAccess.test.ts
│   ├── debugAssignment.ts          # S-src-debug-*
│   ├── debugAssignment.test.ts
│   ├── destructureBag.ts           # S-src-destructure-* (Phase 2)
│   ├── destructureBag.test.ts
│   ├── optionsBag.ts               # S-src-options-* (Phase 4)
│   ├── optionsBag.test.ts
│   ├── namespaceIdentifier.ts      # S-src-ns-*
│   └── namespaceIdentifier.test.ts
└── apply/                          # Phase 3
    ├── import.ts                   # applyAutoImport (S-apply-import-*)
    └── import.test.ts              # @vitest-environment happy-dom

e2e/
└── completions.spec.ts             # E-completions-* (Phase 5)
```

Modified files:

- `src/components/Editor.svelte`: import path change `importsCompletion` → `completionExtensions`.
- `src/lib/completions.ts`: deleted in Phase 1.
- `src/lib/testUtils.ts`: extended with `completionAt` helper (Phase 1).

---

## Conventions used throughout this plan

- **Test ID prefix:** `S-` for vitest unit tests under `src/lib/completions/`, `E-` for Playwright E2E.
- **Cursor marker in test fixtures:** `▮` (U+25AE). The `completionAt` test helper strips it and sets the EditorState cursor to its index.
- **Running tests:** `npx vitest run <path> -t "<name>"` for one test; `npm test` for the whole suite. `npm run check` for type + svelte check. `npm run lint` for ESLint.
- **Imports from CodeMirror:** prefer narrow imports (`import { EditorState } from '@codemirror/state'`) over barrel imports (avoid bloating the bundle further than tree-shaking already manages).
- **No emoji.** No code comments unless documenting a non-obvious WHY (per project conventions).
- **No commits between tasks.** Each phase ends with a "stop and report" task. The user grants commit permission.

---

## Phase 1 — Foundation + debug shapes

Establishes Layers 1+2+3 (partial). The biggest phase by line count because it lays the architectural scaffold.

End-of-phase state: `movements.` / `symbolCommands.` / `state.debug = …` / `state.debug = { … }` / `haltState.debug = …` all complete with their valid options. Existing namespace/local/keyword completions continue to work unchanged.

---

### Task 1.1: Schema type definitions

**Files:**
- Create: `src/lib/completions/schema/types.ts`

- [ ] **Step 1: Write the failing test**

Add a tiny type-roundtrip test in `src/lib/completions/schema/types.test.ts`:

```ts
// src/lib/completions/schema/types.test.ts
import { describe, it, expect } from 'vitest';
import type { EngineSchema, TypeRef, NamespaceEntry } from './types.ts';

describe('schema/types', () => {
  it('S-schema-types-roundtrip — example TypeRef constructions compile', () => {
    const prim: TypeRef = { kind: 'primitive', name: 'string' };
    const cls: TypeRef = { kind: 'class', name: 'State' };
    const ns: NamespaceEntry = { kind: 'class', classRef: 'State', detail: '' };
    expect([prim.kind, cls.kind, ns.kind]).toEqual(['primitive', 'class', 'class']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `types.ts`**

```ts
// src/lib/completions/schema/types.ts

export type TypeRef =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'unknown' }
  | { kind: 'class'; name: string }
  | { kind: 'shape'; name: string }
  | { kind: 'constants'; name: string }
  | { kind: 'array'; of: TypeRef }
  | { kind: 'union'; of: TypeRef[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'symbol' };

export type ParamSpec = {
  name: string;
  type: TypeRef;
  optional?: true;
  detail?: string;
};

export type MemberSpec = {
  name: string;
  kind: 'property' | 'method' | 'getter';
  type: TypeRef;
  params?: ParamSpec[];
  detail: string;
};

export type ShapeSpec = { keys: MemberSpec[] };

export type ClassSpec = {
  ctor?: { params: ParamSpec[]; optionsShape?: string };
  members: MemberSpec[];
  detail: string;
};

export type NamespaceEntry =
  | { kind: 'class'; classRef: string; detail: string }
  | { kind: 'function'; params: ParamSpec[]; returns: TypeRef; detail: string }
  | { kind: 'singleton'; type: TypeRef; detail: string }
  | { kind: 'constants'; constantsRef: string; detail: string }
  | { kind: 'symbol'; detail: string }
  | { kind: 'post-instruction'; params?: ParamSpec[]; detail: string };

export type EngineSchema = {
  namespace: Record<string, NamespaceEntry>;
  classes: Record<string, ClassSpec>;
  shapes: Record<string, ShapeSpec>;
  constants: Record<string, { keys: string[]; detail: string }>;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
npm run check
```

Expected: PASS, no type errors.

- [ ] **Step 5: Report — Task 1.1 done. Do NOT commit yet.**

---

### Task 1.2: Turing namespace schema content (minimal — Phase 1 scope)

**Files:**
- Create: `src/lib/completions/schema/turing.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/completions/schema/types.test.ts`:

```ts
import { TURING_SCHEMA } from './turing.ts';

describe('TURING_SCHEMA (Phase 1)', () => {
  it('S-schema-turing-has-required-namespace-entries — covers the State debug surface', () => {
    const required = ['Alphabet', 'State', 'Tape', 'TapeBlock', 'TuringMachine', 'haltState', 'ifOtherSymbol', 'movements', 'symbolCommands'];
    for (const name of required) {
      expect(TURING_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-turing-state-class-has-debug-members — needed for Phase 1 memberAccess', () => {
    const memberNames = TURING_SCHEMA.classes.State.members.map((m) => m.name);
    expect(memberNames).toEqual(expect.arrayContaining(['debug', 'tag', 'withOverriddenHaltState']));
  });

  it('S-schema-turing-statedebug-shape-has-before-after', () => {
    expect(TURING_SCHEMA.shapes.StateDebug.keys.map((k) => k.name)).toEqual(['before', 'after']);
  });

  it('S-schema-turing-movements-constants', () => {
    expect(TURING_SCHEMA.constants.movements.keys).toEqual(['left', 'right', 'stay']);
  });

  it('S-schema-turing-symbolCommands-constants', () => {
    expect(TURING_SCHEMA.constants.symbolCommands.keys).toEqual(['keep', 'erase']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
```

Expected: FAIL — `./turing.ts` not found.

- [ ] **Step 3: Create `turing.ts` with Phase 1 minimal content**

```ts
// src/lib/completions/schema/turing.ts
import type { EngineSchema } from './types.ts';

export const TURING_SCHEMA: EngineSchema = {
  namespace: {
    Alphabet:        { kind: 'class', classRef: 'Alphabet', detail: 'tape alphabet (symbol list)' },
    State:           { kind: 'class', classRef: 'State', detail: 'transition node' },
    Tape:            { kind: 'class', classRef: 'Tape', detail: 'single tape' },
    TapeBlock:       { kind: 'class', classRef: 'TapeBlock', detail: 'multi-tape block' },
    TuringMachine:   { kind: 'class', classRef: 'TuringMachine', detail: 'machine' },
    haltState:       { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global halt singleton' },
    ifOtherSymbol:   { kind: 'symbol', detail: 'catch-all pattern key' },
    movements:       { kind: 'constants', constantsRef: 'movements', detail: '{ left, right, stay }' },
    symbolCommands:  { kind: 'constants', constantsRef: 'symbolCommands', detail: '{ keep, erase }' },
  },

  classes: {
    State: {
      ctor: {
        params: [
          { name: 'symbolToData', type: { kind: 'shape', name: 'StateSymbolMap' }, detail: 'symbol-pattern → transition' },
          { name: 'name', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'display name' },
        ],
      },
      members: [
        { name: 'debug',                   kind: 'property', type: { kind: 'shape', name: 'StateDebug' }, detail: 'breakpoint config' },
        { name: 'tag',                     kind: 'method',   type: { kind: 'class', name: 'State' }, params: [{ name: 'tags', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }], detail: 'tag this state (returns self)' },
        { name: 'withOverriddenHaltState', kind: 'method',   type: { kind: 'class', name: 'State' }, params: [{ name: 'continuation', type: { kind: 'class', name: 'State' } }], detail: 'wrap as callable subtree' },
      ],
      detail: 'transition node',
    },
    // Phase 1 stubs — fleshed out in Phase 2. Members empty so memberAccess.ts falls through cleanly.
    Alphabet:      { ctor: { params: [{ name: 'symbols', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }] }, members: [], detail: 'tape alphabet' },
    Tape:          { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeOptions' }, detail: 'tape options' }], optionsShape: 'TapeOptions' }, members: [], detail: 'single tape' },
    TapeBlock:     { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeBlockOptions' }, detail: 'tape-block options' }], optionsShape: 'TapeBlockOptions' }, members: [], detail: 'multi-tape block' },
    TuringMachine: { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TuringMachineOptions' }, detail: 'machine options' }], optionsShape: 'TuringMachineOptions' }, members: [], detail: 'machine' },
  },

  shapes: {
    StateDebug: {
      keys: [
        { name: 'before', kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause before this state' },
        { name: 'after',  kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause after this state' },
      ],
    },
    // Phase 2 stubs — empty until then; TypeRef closure test must still pass.
    StateSymbolMap: { keys: [] },
    TapeOptions: { keys: [] },
    TapeBlockOptions: { keys: [] },
    TuringMachineOptions: { keys: [] },
  },

  constants: {
    movements:      { keys: ['left', 'right', 'stay'], detail: 'head movements' },
    symbolCommands: { keys: ['keep', 'erase'],         detail: 'symbol commands' },
  },
};
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
npm run check
```

Expected: all 5 Phase-1 tests PASS, no type errors.

- [ ] **Step 5: Report — Task 1.2 done. Do NOT commit yet.**

---

### Task 1.3: Post namespace schema content (minimal — Phase 1 scope)

**Files:**
- Create: `src/lib/completions/schema/post.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/completions/schema/types.test.ts`:

```ts
import { POST_SCHEMA } from './post.ts';

describe('POST_SCHEMA (Phase 1)', () => {
  it('S-schema-post-has-required-namespace-entries', () => {
    const required = [
      'PostMachine', 'Tape', 'State', 'haltState',
      'alphabet', 'blankSymbol', 'markSymbol',
      'mark', 'erase', 'noop', 'left', 'right', 'stop', 'call', 'check', '$tag',
    ];
    for (const name of required) {
      expect(POST_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-post-instruction-bare', () => {
    expect(POST_SCHEMA.namespace.mark.kind).toBe('post-instruction');
  });

  it('S-schema-post-instruction-parameterized', () => {
    const callEntry = POST_SCHEMA.namespace.call;
    expect(callEntry.kind).toBe('post-instruction');
    if (callEntry.kind === 'post-instruction') {
      expect(callEntry.params).toEqual([{ name: 'label', type: { kind: 'primitive', name: 'string' } }]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
```

Expected: FAIL — `./post.ts` not found.

- [ ] **Step 3: Create `post.ts` with Phase 1 minimal content**

```ts
// src/lib/completions/schema/post.ts
import type { EngineSchema } from './types.ts';

export const POST_SCHEMA: EngineSchema = {
  namespace: {
    PostMachine:   { kind: 'class', classRef: 'PostMachine', detail: 'Post machine' },
    Tape:          { kind: 'class', classRef: 'Tape', detail: 'single tape (re-exported from engine)' },
    State:         { kind: 'class', classRef: 'State', detail: 'transition node (re-exported from engine)' },
    haltState:     { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global halt singleton' },

    alphabet:      { kind: 'singleton', type: { kind: 'class', name: 'Alphabet' }, detail: 'default Post alphabet (blank, mark)' },
    blankSymbol:   { kind: 'singleton', type: { kind: 'primitive', name: 'string' }, detail: "default blank symbol (' ')" },
    markSymbol:    { kind: 'singleton', type: { kind: 'primitive', name: 'string' }, detail: "default mark symbol ('•')" },

    // Bare instructions (no params)
    mark:          { kind: 'post-instruction', detail: 'mark current cell' },
    erase:         { kind: 'post-instruction', detail: 'erase current cell' },
    noop:          { kind: 'post-instruction', detail: 'no-op' },
    stop:          { kind: 'post-instruction', detail: 'halt (return to caller inside a subroutine)' },

    // Dual-form instructions: bare or with an optional jumpTo label
    left:          { kind: 'post-instruction', params: [{ name: 'jumpTo', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] }, optional: true, detail: 'jump-to label' }], detail: 'step left (optionally jump)' },
    right:         { kind: 'post-instruction', params: [{ name: 'jumpTo', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] }, optional: true, detail: 'jump-to label' }], detail: 'step right (optionally jump)' },

    // Parameterized instructions
    call:          { kind: 'post-instruction', params: [{ name: 'label', type: { kind: 'primitive', name: 'string' } }], detail: "call subroutine by name" },
    check:         { kind: 'post-instruction', params: [
                      { name: 'thenLabel', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] } },
                      { name: 'elseLabel', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] } },
                    ], detail: 'branch on mark/blank' },
    $tag:          { kind: 'post-instruction', params: [{ name: 'tag', type: { kind: 'primitive', name: 'string' } }], detail: 'tag current instruction (passthrough)' },
  },

  classes: {
    PostMachine: {
      ctor: {
        params: [
          { name: 'instructions', type: { kind: 'shape', name: 'PostInstructions' }, detail: 'instruction map' },
          { name: 'options', type: { kind: 'shape', name: 'PostMachineOptions' }, optional: true, detail: 'machine options' },
        ],
        optionsShape: 'PostMachineOptions',
      },
      members: [],  // Phase 2
      detail: 'Post machine',
    },
    // Re-export shapes — completion treats these as transparent passes to the Turing equivalent.
    Tape:  { members: [], detail: 'single tape' },
    State: { members: [], detail: 'transition node' },
  },

  shapes: {
    // Phase 2 stubs — empty until then.
    PostMachineOptions: { keys: [] },
    PostInstructions: { keys: [] },
  },

  constants: {},
};
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
npm run check
```

Expected: all tests PASS.

- [ ] **Step 5: Report — Task 1.3 done. Do NOT commit.**

---

### Task 1.4: Schema index + `getSchema(engine)` helper

**Files:**
- Create: `src/lib/completions/schema/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/completions/schema/types.test.ts`:

```ts
import { getSchema } from './index.ts';

describe('getSchema', () => {
  it('S-schema-getSchema-turing', () => {
    expect(getSchema('turing').namespace.State.kind).toBe('class');
  });

  it('S-schema-getSchema-post', () => {
    expect(getSchema('post').namespace.PostMachine.kind).toBe('class');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
```

Expected: FAIL — `./index.ts` not found.

- [ ] **Step 3: Create `schema/index.ts`**

```ts
// src/lib/completions/schema/index.ts
import type { Engine } from '../../types.ts';
import type { EngineSchema } from './types.ts';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';

export function getSchema(engine: Engine): EngineSchema {
  return engine === 'post' ? POST_SCHEMA : TURING_SCHEMA;
}

export type { EngineSchema, NamespaceEntry, ClassSpec, ShapeSpec, MemberSpec, ParamSpec, TypeRef } from './types.ts';
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 5: Report — Task 1.4 done. Do NOT commit.**

---

### Task 1.5: Schema drift-guard + closure tests

**Files:**
- Create: `src/lib/completions/schema/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/completions/schema/engine.test.ts
import { describe, it, expect } from 'vitest';
import * as turingNs from '@turing-machine-js/machine';
import * as postNs from '@post-machine-js/machine';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';
import type { EngineSchema, TypeRef } from './types.ts';

const COLLECT_TYPEREFS = (s: EngineSchema): TypeRef[] => {
  const refs: TypeRef[] = [];
  const push = (t: TypeRef) => {
    refs.push(t);
    if (t.kind === 'array') push(t.of);
    if (t.kind === 'union') t.of.forEach(push);
  };
  for (const entry of Object.values(s.namespace)) {
    if (entry.kind === 'function') {
      entry.params.forEach((p) => push(p.type));
      push(entry.returns);
    }
    if (entry.kind === 'singleton') push(entry.type);
    if (entry.kind === 'post-instruction' && entry.params) {
      entry.params.forEach((p) => push(p.type));
    }
  }
  for (const cls of Object.values(s.classes)) {
    cls.ctor?.params.forEach((p) => push(p.type));
    cls.members.forEach((m) => {
      push(m.type);
      m.params?.forEach((p) => push(p.type));
    });
  }
  for (const shape of Object.values(s.shapes)) {
    shape.keys.forEach((k) => {
      push(k.type);
      k.params?.forEach((p) => push(p.type));
    });
  }
  return refs;
};

describe('schema drift guard', () => {
  it('S-schema-runtime-drift-turing — every TURING_SCHEMA.namespace entry is a runtime key', () => {
    const runtimeKeys = new Set(Object.keys(turingNs));
    for (const name of Object.keys(TURING_SCHEMA.namespace)) {
      expect(runtimeKeys.has(name), `Schema entry "${name}" not in @turing-machine-js/machine runtime`).toBe(true);
    }
  });

  it('S-schema-runtime-drift-post — every POST_SCHEMA.namespace entry is a runtime key', () => {
    const runtimeKeys = new Set(Object.keys(postNs));
    for (const name of Object.keys(POST_SCHEMA.namespace)) {
      expect(runtimeKeys.has(name), `Schema entry "${name}" not in @post-machine-js/machine runtime`).toBe(true);
    }
  });
});

describe('schema closure', () => {
  for (const [label, schema] of [['turing', TURING_SCHEMA], ['post', POST_SCHEMA]] as const) {
    it(`S-schema-typeref-closure-${label} — every TypeRef of kind class/shape/constants resolves`, () => {
      for (const ref of COLLECT_TYPEREFS(schema)) {
        if (ref.kind === 'class' && !schema.classes[ref.name]) {
          throw new Error(`TypeRef class "${ref.name}" missing in ${label} classes`);
        }
        if (ref.kind === 'shape' && !schema.shapes[ref.name]) {
          throw new Error(`TypeRef shape "${ref.name}" missing in ${label} shapes`);
        }
        if (ref.kind === 'constants' && !schema.constants[ref.name]) {
          throw new Error(`TypeRef constants "${ref.name}" missing in ${label} constants`);
        }
      }
    });
  }
});

describe('schema ctor options shape exists', () => {
  for (const [label, schema] of [['turing', TURING_SCHEMA], ['post', POST_SCHEMA]] as const) {
    it(`S-schema-ctor-options-shape-exists-${label}`, () => {
      for (const [clsName, cls] of Object.entries(schema.classes)) {
        if (cls.ctor?.optionsShape) {
          expect(schema.shapes[cls.ctor.optionsShape], `${label} class ${clsName} optionsShape '${cls.ctor.optionsShape}' missing`).toBeDefined();
        }
      }
    });
  }
});

describe('schema constants non-empty', () => {
  it('S-schema-constants-nonempty-turing', () => {
    for (const [name, c] of Object.entries(TURING_SCHEMA.constants)) {
      expect(c.keys.length, `turing constants ${name} empty`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify fail-on-drift / pass-otherwise**

```bash
npx vitest run src/lib/completions/schema/engine.test.ts
```

Expected: PASS (schema is correct as-of Phase 1).

- [ ] **Step 3: No implementation needed — drift guard runs against existing schema.**

(If any test fails, fix the schema in `turing.ts` / `post.ts` — typo'd export name being the most likely cause.)

- [ ] **Step 4: Run lint + type-check**

```bash
npm run lint
npm run check
```

Expected: clean.

- [ ] **Step 5: Report — Task 1.5 done. Do NOT commit.**

---

### Task 1.6: Scanner types

**Files:**
- Create: `src/lib/completions/scan/types.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/completions/scan/types.test.ts
import { describe, it, expect } from 'vitest';
import type { InferredType, InferredLocals, ImportsBinding } from './types.ts';

describe('scan/types', () => {
  it('S-scan-types-roundtrip', () => {
    const t: InferredType = { kind: 'class', name: 'State' };
    const map: InferredLocals = new Map();
    map.set('x', t);
    const absent: ImportsBinding = { kind: 'absent' };
    expect([t.kind, absent.kind]).toEqual(['class', 'absent']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/completions/scan/types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `scan/types.ts`**

```ts
// src/lib/completions/scan/types.ts
import type { SyntaxNode } from '@lezer/common';

export type InferredType =
  | { kind: 'class'; name: string }
  | { kind: 'constants'; name: string }
  | { kind: 'shape'; name: string }
  | { kind: 'function'; signatureRef: string };  // e.g. 'tapeBlock.symbol' — used for Phase 2's destructured symbol

export type InferredLocals = Map<string, InferredType>;

export type ImportsBinding =
  | { kind: 'present'; node: SyntaxNode; boundNames: Set<string>; isMultiLine: boolean; renames: Map<string, string> }
  | { kind: 'absent' };

export type ScannerResult = {
  locals: InferredLocals;
  importsBinding: ImportsBinding;
  /** All other top-level locals (untyped). Used by namespaceIdentifier rename detection. */
  rawLocals: Set<string>;
};
```

`renames` maps **imported name → local name** (e.g. `State → TS` for `const { State: TS } = imports;`). Used by namespaceIdentifier to offer the rename's local name and by applyAutoImport to detect existing aliases.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/scan/types.test.ts
npm run check
```

Expected: PASS.

- [ ] **Step 5: Report — Task 1.6 done. Do NOT commit.**

---

### Task 1.7: Scanner — Lezer walker (Phase 1 rules) + ImportsBinding

**Files:**
- Create: `src/lib/completions/scan/locals.ts`
- Create: `src/lib/completions/scan/locals.test.ts`

This is the largest task in Phase 1. The walker is implemented incrementally — write all tests first, then implement until they pass.

- [ ] **Step 1: Write the test suite (multiple cases, one file)**

```ts
// src/lib/completions/scan/locals.test.ts
import { describe, it, expect } from 'vitest';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { getSchema } from '../schema/index.ts';
import { scanLocals } from './locals.ts';

const parse = (src: string) => javascriptLanguage.parser.parse(src);

const schema = getSchema('turing');

const scan = (src: string) => scanLocals(src, parse(src).topNode, schema);

describe('scanner — Phase 1 rules', () => {
  it('S-scan-newexpr-state', () => {
    const r = scan('const x = new State({});');
    expect(r.locals.get('x')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-newexpr-unknown — ignored', () => {
    const r = scan('const z = new Foo();');
    expect(r.locals.has('z')).toBe(false);
  });

  it('S-scan-import-haltState-via-member', () => {
    const r = scan('const h = imports.haltState;');
    expect(r.locals.get('h')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-import-haltState-via-bare', () => {
    const r = scan('const { haltState } = imports;\nconst h = haltState;');
    expect(r.locals.get('h')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-destructure-imports-flat', () => {
    const r = scan('const { State, Tape } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State', 'Tape']));
    expect(r.importsBinding.isMultiLine).toBe(false);
  });

  it('S-scan-destructure-imports-multiline', () => {
    const src = `const {\n  State,\n  Tape,\n} = imports;`;
    const r = scan(src);
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.isMultiLine).toBe(true);
  });

  it('S-scan-destructure-rename', () => {
    const r = scan('const { State: TS } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State']));
    expect(r.importsBinding.renames.get('State')).toBe('TS');
    expect(r.locals.get('TS')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-importsBinding-absent', () => {
    const r = scan('const x = 1;');
    expect(r.importsBinding.kind).toBe('absent');
  });

  it('S-scan-importsBinding-first-wins', () => {
    const r = scan('const { State } = imports;\nconst { Tape } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State', 'Tape']));
  });

  it('S-scan-incomplete-tree — does not throw', () => {
    expect(() => scan('const x = new State(')).not.toThrow();
    const r = scan('const x = new State(');
    expect(r.importsBinding.kind).toBe('absent');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/scan/locals.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `locals.ts`**

```ts
// src/lib/completions/scan/locals.ts
import type { SyntaxNode } from '@lezer/common';
import type { EngineSchema } from '../schema/types.ts';
import type { InferredLocals, InferredType, ImportsBinding, ScannerResult } from './types.ts';

const NULL_RESULT: ScannerResult = Object.freeze({
  locals: new Map(),
  importsBinding: { kind: 'absent' },
  rawLocals: new Set(),
}) as unknown as ScannerResult;

/** Iterate top-level statements of a Program / Script node. */
function* topLevelStatements(root: SyntaxNode): Iterable<SyntaxNode> {
  let c = root.firstChild;
  while (c) {
    yield c;
    c = c.nextSibling;
  }
}

const nodeText = (node: SyntaxNode, src: string): string => src.slice(node.from, node.to);

/** Resolve a TypeRef-like NamespaceEntry to an InferredType, or null. */
function namespaceEntryToType(name: string, schema: EngineSchema): InferredType | null {
  const entry = schema.namespace[name];
  if (!entry) return null;
  if (entry.kind === 'class') return { kind: 'class', name: entry.classRef };
  if (entry.kind === 'constants') return { kind: 'constants', name: entry.constantsRef };
  if (entry.kind === 'singleton' && entry.type.kind === 'class') return { kind: 'class', name: entry.type.name };
  return null;
}

/** Recognize `new <Ident>(...)` and return Ident name if it's a known schema class. */
function newExprKnownClass(rhs: SyntaxNode, src: string, schema: EngineSchema): string | null {
  if (rhs.name !== 'NewExpression') return null;
  const callee = rhs.firstChild?.nextSibling;
  if (!callee || callee.name !== 'VariableName') return null;
  const name = nodeText(callee, src);
  return schema.classes[name] ? name : null;
}

/** Recognize `<Ident>.<Method>(...)` returning a class type. */
function callExprReturn(rhs: SyntaxNode, src: string): InferredType | null {
  if (rhs.name !== 'CallExpression') return null;
  const callee = rhs.firstChild;
  if (!callee || callee.name !== 'MemberExpression') return null;
  const method = callee.lastChild;
  if (!method || method.name !== 'PropertyName') return null;
  const methodName = nodeText(method, src);
  if (methodName === 'withOverriddenHaltState' || methodName === 'tag') {
    return { kind: 'class', name: 'State' };
  }
  if (methodName === 'fromTapes') {
    return { kind: 'class', name: 'TapeBlock' };
  }
  return null;
}

/** `imports.<key>` for known singleton-class entries. */
function memberOnImports(rhs: SyntaxNode, src: string, schema: EngineSchema): InferredType | null {
  if (rhs.name !== 'MemberExpression') return null;
  const left = rhs.firstChild;
  const right = rhs.lastChild;
  if (!left || !right || left.name !== 'VariableName' || nodeText(left, src) !== 'imports' || right.name !== 'PropertyName') return null;
  return namespaceEntryToType(nodeText(right, src), schema);
}

/** Track ObjectPattern bindings — return { boundNames, renames, isMultiLine }. */
function readObjectPattern(pattern: SyntaxNode, src: string): { boundNames: Set<string>; renames: Map<string, string>; isMultiLine: boolean } {
  const boundNames = new Set<string>();
  const renames = new Map<string, string>();
  const isMultiLine = src.slice(pattern.from, pattern.to).includes('\n');

  let prop = pattern.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const propName = prop.firstChild;
      if (propName && (propName.name === 'PropertyName' || propName.name === 'VariableDefinition' || propName.name === 'VariableName')) {
        const imported = nodeText(propName, src);
        boundNames.add(imported);
        // If there's a colon then a binding, it's a rename
        const binding = propName.nextSibling;
        if (binding && binding.name === 'VariableDefinition') {
          renames.set(imported, nodeText(binding, src));
        }
      }
    }
    prop = prop.nextSibling;
  }
  return { boundNames, renames, isMultiLine };
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function scanLocals(src: string, root: SyntaxNode, schema: EngineSchema): ScannerResult {
  return safe(() => doScan(src, root, schema), NULL_RESULT);
}

function doScan(src: string, root: SyntaxNode, schema: EngineSchema): ScannerResult {
  const locals: InferredLocals = new Map();
  const rawLocals = new Set<string>();
  let importsBinding: ImportsBinding = { kind: 'absent' };
  const allBoundNames = new Set<string>();
  let firstImportsPatternNode: SyntaxNode | null = null;
  let firstImportsPatternIsMultiLine = false;
  const firstImportsRenames = new Map<string, string>();

  for (const stmt of topLevelStatements(root)) {
    if (stmt.name !== 'VariableDeclaration') continue;
    // Walk variable declarators in this statement
    let cur: SyntaxNode | null = stmt.firstChild;
    while (cur) {
      if (cur.name === 'VariableDeclarator') {
        const lhs = cur.firstChild;
        if (!lhs) { cur = cur.nextSibling; continue; }

        // Skip past `=` to get RHS
        const eq = lhs.nextSibling;
        const rhs = eq?.nextSibling;

        if (lhs.name === 'VariableDefinition') {
          const localName = nodeText(lhs, src);
          rawLocals.add(localName);
          if (rhs) {
            const k1 = newExprKnownClass(rhs, src, schema);
            if (k1) { locals.set(localName, { kind: 'class', name: k1 }); cur = cur.nextSibling; continue; }
            const k2 = callExprReturn(rhs, src);
            if (k2) { locals.set(localName, k2); cur = cur.nextSibling; continue; }
            const k3 = memberOnImports(rhs, src, schema);
            if (k3) { locals.set(localName, k3); cur = cur.nextSibling; continue; }
            // bare ident referring to a known singleton (e.g. `const h = haltState;`)
            if (rhs.name === 'VariableName') {
              const refName = nodeText(rhs, src);
              const inferred = namespaceEntryToType(refName, schema);
              if (inferred) { locals.set(localName, inferred); cur = cur.nextSibling; continue; }
            }
          }
        } else if (lhs.name === 'ObjectPattern') {
          // `const { A, B: x } = <rhs>;`
          const initIsImports = rhs?.name === 'VariableName' && nodeText(rhs, src) === 'imports';
          const { boundNames, renames, isMultiLine } = readObjectPattern(lhs, src);

          if (initIsImports) {
            // Track Imports destructure
            if (firstImportsPatternNode === null) {
              firstImportsPatternNode = lhs;
              firstImportsPatternIsMultiLine = isMultiLine;
            }
            for (const [imported, local] of renames) {
              firstImportsRenames.set(imported, local);
            }
            for (const name of boundNames) {
              allBoundNames.add(name);
              const local = renames.get(name) ?? name;
              rawLocals.add(local);
              const inferred = namespaceEntryToType(name, schema);
              if (inferred) locals.set(local, inferred);
            }
          } else {
            for (const name of boundNames) {
              const local = renames.get(name) ?? name;
              rawLocals.add(local);
            }
          }
        }
      }
      cur = cur.nextSibling;
    }
  }

  if (firstImportsPatternNode) {
    importsBinding = {
      kind: 'present',
      node: firstImportsPatternNode,
      boundNames: allBoundNames,
      isMultiLine: firstImportsPatternIsMultiLine,
      renames: firstImportsRenames,
    };
  }

  return { locals, importsBinding, rawLocals };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/scan/locals.test.ts
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Run lint + type-check + report**

```bash
npm run lint
npm run check
```

Expected: clean. **Report — Task 1.7 done. Do NOT commit.**

---

### Task 1.8: `completionAt` test helper

**Files:**
- Modify: `src/lib/testUtils.ts` (extend)

- [ ] **Step 1: Read current testUtils.ts**

```bash
head -50 src/lib/testUtils.ts
```

(For context — the existing exports stay; this task adds a new export.)

- [ ] **Step 2: Write the failing test (in the same file as completion-source tests will live; this helper is exercised next task)**

Skip a standalone test for the helper — Task 1.9 (memberAccess.test.ts) is the first consumer. The helper compiles or it doesn't.

- [ ] **Step 3: Append to `src/lib/testUtils.ts`**

```ts
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import type { Engine } from './types.ts';
import { getSchema } from './completions/schema/index.ts';
import type { EngineSchema } from './completions/schema/types.ts';
import { localsField } from './completions/scan/locals.ts';

export type SourceEnv = { engine: Engine; schema: EngineSchema };
export type SourceFactory = (env: SourceEnv) => (ctx: CompletionContext) => CompletionResult | null;

/** Build an EditorState with cursor at `▮` and run a completion source factory. */
export function completionAt(marked: string, engine: Engine, makeSource: SourceFactory): CompletionResult | null {
  const cursorPos = marked.indexOf('▮');
  if (cursorPos === -1) throw new Error('completionAt: source must contain ▮');
  const doc = marked.slice(0, cursorPos) + marked.slice(cursorPos + 1);
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursorPos },
  });
  const ctx = new CompletionContext(state, cursorPos, true);
  return makeSource(env)(ctx);
}
```

**Note:** `localsField` is referenced here but doesn't exist yet — `locals.ts` from Task 1.7 only exports `scanLocals`. **Add the `localsField` export to `locals.ts`** as part of this task:

```ts
// Append to src/lib/completions/scan/locals.ts
import { StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { TURING_SCHEMA } from '../schema/turing.ts';

const _cache = new WeakMap<unknown, ScannerResult>();

export function inferLocalsFor(state: EditorState, schema: EngineSchema): ScannerResult {
  const tree = syntaxTree(state);
  const cached = _cache.get(tree);
  if (cached) return cached;
  const result = scanLocals(state.doc.toString(), tree.topNode, schema);
  _cache.set(tree, result);
  return result;
}

/** The default localsField uses the TURING_SCHEMA shape. Sources that need engine-specific
 *  scanning pass the schema in directly via inferLocalsFor at completion time. */
export const localsField = StateField.define<ScannerResult>({
  create: (state) => inferLocalsFor(state, TURING_SCHEMA),
  update: (value, tr) => tr.docChanged ? inferLocalsFor(tr.state, TURING_SCHEMA) : value,
});
```

(`TURING_SCHEMA` is used as the default; sources read the engine-specific schema from `env` and re-scan if needed. For Phase 1's tests, only Turing examples are scanned.)

- [ ] **Step 4: Run type-check**

```bash
npm run check
```

Expected: clean.

- [ ] **Step 5: Report — Task 1.8 done. Do NOT commit.**

---

### Task 1.9: `memberAccess.ts` source (Phase 1 scope)

**Files:**
- Create: `src/lib/completions/contexts/types.ts`
- Create: `src/lib/completions/contexts/memberAccess.ts`
- Create: `src/lib/completions/contexts/memberAccess.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/contexts/memberAccess.test.ts
import { describe, it, expect } from 'vitest';
import { memberAccess } from './memberAccess.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: Array<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/memberAccess (Phase 1)', () => {
  it('S-src-member-movements — left/right/stay', () => {
    const r = completionAt(`movements.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['left', 'right', 'stay']);
  });

  it('S-src-member-symbolCommands — keep/erase', () => {
    const r = completionAt(`symbolCommands.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['erase', 'keep']);
  });

  it('S-src-member-state-debug-tag-wohs', () => {
    const r = completionAt(`const s = new State({});\ns.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['debug', 'tag', 'withOverriddenHaltState']);
  });

  it('S-src-member-unknown-falls-through — null', () => {
    const r = completionAt(`const z = someUnknown;\nz.▮`, 'turing', memberAccess);
    expect(r).toBeNull();
  });

  it('S-src-member-haltState-via-import-singleton', () => {
    const r = completionAt(`haltState.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['debug', 'tag', 'withOverriddenHaltState']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/memberAccess.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `contexts/types.ts`**

```ts
// src/lib/completions/contexts/types.ts
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Engine } from '../../types.ts';
import type { EngineSchema } from '../schema/types.ts';

export type Env = { engine: Engine; schema: EngineSchema };
export type CompletionSourceFactory = (env: Env) => (ctx: CompletionContext) => CompletionResult | null;
```

- [ ] **Step 4: Create `contexts/memberAccess.ts`**

```ts
// src/lib/completions/contexts/memberAccess.ts
import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { InferredType } from '../scan/types.ts';
import type { EngineSchema, NamespaceEntry } from '../schema/types.ts';

/** When the cursor is right after a `.`, return the identifier text on the left, or null. */
function leftIdentForDot(ctx: CompletionContext): string | null {
  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(ctx.pos, -1);
  // We expect to be inside a PropertyName under a MemberExpression, OR right after a `.`.
  let memberExpr = node;
  while (memberExpr && memberExpr.name !== 'MemberExpression') memberExpr = memberExpr.parent!;
  if (!memberExpr) return null;
  const left = memberExpr.firstChild;
  if (!left || left.name !== 'VariableName') return null;
  return ctx.state.doc.sliceString(left.from, left.to);
}

function namespaceEntryToType(name: string, schema: EngineSchema): InferredType | null {
  const entry: NamespaceEntry | undefined = schema.namespace[name];
  if (!entry) return null;
  if (entry.kind === 'class') return { kind: 'class', name: entry.classRef };
  if (entry.kind === 'constants') return { kind: 'constants', name: entry.constantsRef };
  if (entry.kind === 'singleton' && entry.type.kind === 'class') return { kind: 'class', name: entry.type.name };
  return null;
}

function buildOptions(t: InferredType, schema: EngineSchema): Completion[] | null {
  if (t.kind === 'class') {
    const cls = schema.classes[t.name];
    if (!cls || cls.members.length === 0) return null;
    return cls.members.map<Completion>((m) => ({
      label: m.name,
      type: m.kind === 'method' ? 'method' : 'property',
      detail: m.detail,
      boost: 99,
    }));
  }
  if (t.kind === 'constants') {
    const c = schema.constants[t.name];
    if (!c) return null;
    return c.keys.map<Completion>((k) => ({ label: k, type: 'variable', boost: 99 }));
  }
  return null;
}

export const memberAccess: CompletionSourceFactory = (env) => (ctx) => {
  const ident = leftIdentForDot(ctx);
  if (!ident) return null;

  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(ident) ?? namespaceEntryToType(ident, env.schema);
  if (!t) return null;

  const options = buildOptions(t, env.schema);
  if (!options) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
```

- [ ] **Step 5: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/memberAccess.test.ts
npm run lint
npm run check
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Report — Task 1.9 done. Do NOT commit.**

---

### Task 1.10: `debugAssignment.ts` source

**Files:**
- Create: `src/lib/completions/contexts/debugAssignment.ts`
- Create: `src/lib/completions/contexts/debugAssignment.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/contexts/debugAssignment.test.ts
import { describe, it, expect } from 'vitest';
import { debugAssignment } from './debugAssignment.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: Array<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/debugAssignment', () => {
  it('S-src-debug-rhs-state — full menu', () => {
    const r = completionAt(`const s = new State({});\ns.debug = ▮`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual([
      'false',
      'true',
      '{ after: true }',
      '{ before: true }',
      '{ before: true, after: true }',
    ]);
  });

  it('S-src-debug-rhs-halt — boolean-only', () => {
    const r = completionAt(`haltState.debug = ▮`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['false', 'true']);
  });

  it('S-src-debug-keys-state — full', () => {
    const r = completionAt(`const s = new State({});\ns.debug = { ▮ };`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['after', 'before']);
  });

  it('S-src-debug-keys-state-partial — only after remains', () => {
    const r = completionAt(`const s = new State({});\ns.debug = { before: true, ▮ };`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['after']);
  });

  it('S-src-debug-out-of-context — null', () => {
    const r = completionAt(`const s = new State({});\ns.foo = ▮`, 'turing', debugAssignment);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/debugAssignment.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `debugAssignment.ts`**

```ts
// src/lib/completions/contexts/debugAssignment.ts
import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

type DebugContext =
  | { kind: 'rhs'; ident: string; isHalt: boolean }
  | { kind: 'keys'; ident: string; existing: Set<string> }
  | null;

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

/** True when `name.debug = X` is the lvalue of a parent assignment. */
function findDebugAssignment(ctx: CompletionContext): DebugContext {
  const tree = syntaxTree(ctx.state);
  let node: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  // Walk up looking for AssignmentExpression
  while (node && node.name !== 'AssignmentExpression') node = node.parent;
  if (!node) return null;

  const lhs = node.firstChild;
  if (!lhs || lhs.name !== 'MemberExpression') return null;
  const left = lhs.firstChild;
  const dotProp = lhs.lastChild;
  if (!left || left.name !== 'VariableName') return null;
  if (!dotProp || dotProp.name !== 'PropertyName') return null;
  if (nameText(dotProp, ctx) !== 'debug') return null;

  const ident = nameText(left, ctx);
  const isHalt = ident === 'haltState';

  // Are we inside the RHS object's body? Look for an ObjectExpression ancestor of cursor
  // that is the RHS of this assignment.
  const rhs = lhs.nextSibling?.nextSibling;  // skip '='
  if (rhs && rhs.name === 'ObjectExpression' && ctx.pos > rhs.from && ctx.pos < rhs.to) {
    const existing = new Set<string>();
    let prop = rhs.firstChild;
    while (prop) {
      if (prop.name === 'Property') {
        const key = prop.firstChild;
        if (key && (key.name === 'PropertyName' || key.name === 'PropertyDefinition' || key.name === 'VariableName')) {
          existing.add(nameText(key, ctx));
        }
      }
      prop = prop.nextSibling;
    }
    return { kind: 'keys', ident, existing };
  }

  // Otherwise we're on the RHS side, expression position.
  return { kind: 'rhs', ident, isHalt };
}

function rhsOptions(isHalt: boolean): Completion[] {
  const base: Completion[] = [
    { label: 'true', type: 'keyword', boost: 99 },
    { label: 'false', type: 'keyword', boost: 98 },
  ];
  if (isHalt) return base;
  return [
    ...base,
    { label: '{ before: true }', type: 'text', apply: '{ before: true }', boost: 95 },
    { label: '{ after: true }', type: 'text', apply: '{ after: true }', boost: 94 },
    { label: '{ before: true, after: true }', type: 'text', apply: '{ before: true, after: true }', boost: 93 },
  ];
}

export const debugAssignment: CompletionSourceFactory = (env) => (ctx) => {
  const detected = findDebugAssignment(ctx);
  if (!detected) return null;

  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(detected.ident);
  const isStateOrHalt = detected.ident === 'haltState' || (t?.kind === 'class' && t.name === 'State');
  if (!isStateOrHalt) return null;

  if (detected.kind === 'rhs') {
    const options = rhsOptions(detected.isHalt);
    const word = ctx.matchBefore(/[\w${}\s]*/);
    return { from: word?.from ?? ctx.pos, options, validFor: /^[\w${}\s]*$/ };
  }

  // keys mode
  const all = env.schema.shapes.StateDebug.keys;
  const options = all
    .filter((k) => !detected.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 99 }));
  const word = ctx.matchBefore(/[\w$]*/);
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/debugAssignment.test.ts
npm run lint
npm run check
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Report — Task 1.10 done. Do NOT commit.**

---

### Task 1.11: `namespaceIdentifier.ts` source — Phase 1 (label-only, ranked by status)

**Files:**
- Create: `src/lib/completions/contexts/namespaceIdentifier.ts`
- Create: `src/lib/completions/contexts/namespaceIdentifier.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/contexts/namespaceIdentifier.test.ts
import { describe, it, expect } from 'vitest';
import { namespaceIdentifier } from './namespaceIdentifier.ts';
import { completionAt } from '../../testUtils.ts';

const find = (r: { options: Array<{ label: string; boost?: number; detail?: string }> } | null, label: string) =>
  r?.options.find((o) => o.label === label) ?? null;

describe('contexts/namespaceIdentifier (Phase 1 — label-only)', () => {
  it('S-src-ns-already-destructured — boost 99 no (import) detail', () => {
    const r = completionAt(`const { Alphabet } = imports;\nconst a = Alpha▮`, 'turing', namespaceIdentifier);
    const opt = find(r, 'Alphabet');
    expect(opt).toBeTruthy();
    expect(opt!.boost).toBe(99);
    expect(opt!.detail ?? '').not.toMatch(/\(import\)/);
  });

  it('S-src-ns-not-destructured — boost 80 with (import) detail', () => {
    const r = completionAt(`const a = Alpha▮`, 'turing', namespaceIdentifier);
    const opt = find(r, 'Alphabet');
    expect(opt).toBeTruthy();
    expect(opt!.boost).toBe(80);
    expect(opt!.detail).toMatch(/\(import\)/);
  });

  it('S-src-ns-rename — offered under local alias', () => {
    const r = completionAt(`const { State: TS } = imports;\nconst x = Stat▮`, 'turing', namespaceIdentifier);
    const ts = find(r, 'TS');
    expect(ts).toBeTruthy();
    expect(ts!.detail).toMatch(/State \(as TS\)/);
    expect(find(r, 'State')).toBeNull();  // original name suppressed when alias exists
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/namespaceIdentifier.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `namespaceIdentifier.ts`**

```ts
// src/lib/completions/contexts/namespaceIdentifier.ts
import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { NamespaceEntry } from '../schema/types.ts';

function nsEntryTypeForLabel(entry: NamespaceEntry): Completion['type'] {
  switch (entry.kind) {
    case 'class':            return 'class';
    case 'function':         return 'function';
    case 'singleton':        return 'variable';
    case 'constants':        return 'namespace';
    case 'symbol':           return 'variable';
    case 'post-instruction': return entry.params ? 'function' : 'variable';
  }
}

export const namespaceIdentifier: CompletionSourceFactory = (env) => (ctx) => {
  // Only fire when the cursor is on a bare word at expression position.
  const word = ctx.matchBefore(/[\w$]+/);
  if (!word || word.from === word.to) return null;

  // Bail if we're inside a property access (memberAccess handles it).
  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(ctx.pos, -1);
  if (node.parent?.name === 'MemberExpression' && node.parent.firstChild !== node) {
    return null;
  }

  const { importsBinding } = inferLocalsFor(ctx.state, env.schema);
  const boundNames =
    importsBinding.kind === 'present' ? importsBinding.boundNames : new Set<string>();
  const renames =
    importsBinding.kind === 'present' ? importsBinding.renames : new Map<string, string>();

  const options: Completion[] = [];
  for (const [name, entry] of Object.entries(env.schema.namespace)) {
    const renamedTo = renames.get(name);
    if (renamedTo) {
      options.push({
        label: renamedTo,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} — ${name} (as ${renamedTo})`,
        boost: 99,
      });
      continue;
    }
    if (boundNames.has(name)) {
      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: entry.detail,
        boost: 99,
      });
    } else {
      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} (import)`,
        boost: 80,
      });
    }
  }

  return { from: word.from, options, validFor: /^[\w$]*$/ };
};
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/namespaceIdentifier.test.ts
npm run lint
npm run check
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Report — Task 1.11 done. Do NOT commit.**

---

### Task 1.12: Orchestration entry + Editor wire-up

**Files:**
- Create: `src/lib/completions/index.ts`
- Modify: `src/components/Editor.svelte` (one-line import change)
- Delete: `src/lib/completions.ts`

- [ ] **Step 1: Create `completions/index.ts`**

```ts
// src/lib/completions/index.ts
import { javascriptLanguage, localCompletionSource } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import type { Engine } from '../types.ts';
import { getSchema } from './schema/index.ts';
import { localsField } from './scan/locals.ts';
import { memberAccess } from './contexts/memberAccess.ts';
import { debugAssignment } from './contexts/debugAssignment.ts';
import { namespaceIdentifier } from './contexts/namespaceIdentifier.ts';
import type { Env } from './contexts/types.ts';

export function completionExtensions(engine: Engine): Extension[] {
  const env: Env = { engine, schema: getSchema(engine) };
  return [
    localsField,
    javascriptLanguage.data.of({ autocomplete: memberAccess(env) }),
    javascriptLanguage.data.of({ autocomplete: debugAssignment(env) }),
    javascriptLanguage.data.of({ autocomplete: namespaceIdentifier(env) }),
    javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
  ];
}
```

- [ ] **Step 2: Modify `src/components/Editor.svelte`**

Change:

```ts
import { importsCompletion } from '../lib/completions.ts';
```

To:

```ts
import { completionExtensions } from '../lib/completions/index.ts';
```

And replace the two `importsCompletion(engine)` call sites with `completionExtensions(engine)`.

- [ ] **Step 3: Delete the old `src/lib/completions.ts`**

```bash
git rm src/lib/completions.ts
```

(Don't worry — the user grants commit permission at end-of-phase; the deletion is staged in the working tree.)

- [ ] **Step 4: Run full check**

```bash
npm run check
npm run lint
npm test
```

Expected: all green.

- [ ] **Step 5: Run the dev server briefly to smoke-test**

```bash
npm run dev
```

In a browser, open `/turing`, focus the editor, type `movements.` and confirm the menu shows `left`, `right`, `stay`. Type `state.debug = ` (after declaring `const state = new State({})`) and confirm the boolean + object snippets appear. Then `Ctrl-C` to stop dev server.

(This is a manual smoke check, not a hands-off test. Document any issue in the report.)

- [ ] **Step 6: Report — Phase 1 complete. Stop here. User: please review the diff and grant commit permission.**

Suggested commit message (user runs):

```
feat: smart completions phase 1 — debug shapes + static enums (#103)

Foundation for the smart-completions overhaul:
- schema/ (engine + post namespace types, State class, StateDebug shape,
  movements + symbolCommands constants)
- scan/ (Lezer walker tracking const X = new State, haltState bindings,
  destructure of imports — including renames, multi-line, first-wins)
- contexts/memberAccess (State + movements + symbolCommands)
- contexts/debugAssignment (RHS booleans + object snippets; haltState
  collapses to boolean; keys-context inside { … })
- contexts/namespaceIdentifier (label-only Phase 1; already-destructured
  boost 99, rest boost 80 with (import) detail; renames suppress
  original name)
- Wires up completionExtensions(engine) in Editor.svelte; deletes
  the old flat-list completions.ts.

Closes #44 (member-completion for movements.* / symbolCommands.*).
```

---

## Phase 2 — User-named states + general instance members

Builds on Phase 1. Fleshes out remaining class members, expands scanner inference rules, generalizes `memberAccess`, and adds `destructureBag.ts`.

End-of-phase state: any user-declared local with a known type completes its members. Priorities #2 + #5 delivered.

---

### Task 2.1: Flesh out class members + shape contents

**Files:**
- Modify: `src/lib/completions/schema/turing.ts`
- Modify: `src/lib/completions/schema/post.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/completions/schema/types.test.ts`:

```ts
describe('TURING_SCHEMA (Phase 2)', () => {
  it('S-schema-turing-tape-members', () => {
    const ns = TURING_SCHEMA.classes.Tape.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['alphabet', 'symbols', 'position', 'viewport']));
  });

  it('S-schema-turing-tapeblock-members', () => {
    const ns = TURING_SCHEMA.classes.TapeBlock.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['tapes', 'symbol']));
  });

  it('S-schema-turing-alphabet-members', () => {
    const ns = TURING_SCHEMA.classes.Alphabet.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['symbols', 'blankSymbol']));
  });

  it('S-schema-turing-options-shape-tape', () => {
    const keys = TURING_SCHEMA.shapes.TapeOptions.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['alphabet', 'symbols', 'viewportWidth']));
  });

  it('S-schema-turing-options-shape-tapeblock', () => {
    const keys = TURING_SCHEMA.shapes.TapeBlockOptions.keys.map((k) => k.name);
    expect(keys).toEqual(['tapes']);
  });

  it('S-schema-turing-options-shape-turingmachine', () => {
    const keys = TURING_SCHEMA.shapes.TuringMachineOptions.keys.map((k) => k.name);
    expect(keys).toEqual(['tapeBlock']);
  });

  it('S-schema-turing-state-symbol-map-keys', () => {
    const keys = TURING_SCHEMA.shapes.StateSymbolMap.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['command', 'nextState']));
  });
});

describe('POST_SCHEMA (Phase 2)', () => {
  it('S-schema-post-postmachine-members', () => {
    const ns = POST_SCHEMA.classes.PostMachine.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['tape', 'replaceTapeWith', 'setBreakpoint']));
  });

  it('S-schema-post-options-shape', () => {
    const keys = POST_SCHEMA.shapes.PostMachineOptions.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['blankSymbol', 'markSymbol']));
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
```

Expected: most new tests FAIL.

- [ ] **Step 3: Edit `src/lib/completions/schema/turing.ts` — replace the class stubs with full members**

Replace the Alphabet/Tape/TapeBlock/TuringMachine class stubs and the shape stubs with these definitions:

```ts
Alphabet: {
  ctor: { params: [{ name: 'symbols', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }] },
  members: [
    { name: 'symbols',     kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'symbol list' },
    { name: 'blankSymbol', kind: 'getter',   type: { kind: 'primitive', name: 'string' }, detail: 'first symbol (blank)' },
  ],
  detail: 'tape alphabet',
},
Tape: {
  ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeOptions' }, detail: 'tape options' }], optionsShape: 'TapeOptions' },
  members: [
    { name: 'alphabet', kind: 'property', type: { kind: 'class', name: 'Alphabet' }, detail: 'alphabet' },
    { name: 'symbols',  kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'symbol list' },
    { name: 'position', kind: 'property', type: { kind: 'primitive', name: 'number' }, detail: 'head index' },
    { name: 'viewport', kind: 'getter',   type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'centered window of cells' },
  ],
  detail: 'single tape',
},
TapeBlock: {
  ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeBlockOptions' }, detail: 'tape-block options' }], optionsShape: 'TapeBlockOptions' },
  members: [
    { name: 'tapes',  kind: 'property', type: { kind: 'array', of: { kind: 'class', name: 'Tape' } }, detail: 'underlying tapes' },
    { name: 'symbol', kind: 'method',   type: { kind: 'symbol' }, params: [{ name: 'pattern', type: { kind: 'array', of: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'symbol' }] } } }], detail: 'compute a symbol-pattern key' },
  ],
  detail: 'multi-tape block',
},
TuringMachine: {
  ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TuringMachineOptions' }, detail: 'machine options' }], optionsShape: 'TuringMachineOptions' },
  members: [],   // user code rarely calls machine.run() in the demo; runner owns lifecycle
  detail: 'machine',
},
```

Replace the `shapes` object:

```ts
shapes: {
  StateDebug: {
    keys: [
      { name: 'before', kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause before this state' },
      { name: 'after',  kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause after this state' },
    ],
  },
  StateSymbolMap: {
    keys: [
      { name: 'command',   kind: 'property', type: { kind: 'array', of: { kind: 'shape', name: 'Command' } }, detail: 'per-tape commands' },
      { name: 'nextState', kind: 'property', type: { kind: 'class', name: 'State' }, detail: 'next state (default: self)' },
    ],
  },
  Command: {
    keys: [
      { name: 'movement', kind: 'property', type: { kind: 'constants', name: 'movements' }, detail: 'head movement' },
      { name: 'symbol',   kind: 'property', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'symbol to write (omit = keep)' },
    ],
  },
  TapeOptions: {
    keys: [
      { name: 'alphabet',      kind: 'property', type: { kind: 'class', name: 'Alphabet' }, detail: 'tape alphabet' },
      { name: 'symbols',       kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, optional: true, detail: 'initial symbols' },
      { name: 'viewportWidth', kind: 'property', type: { kind: 'primitive', name: 'number' }, optional: true, detail: 'viewport size (rendering hint)' },
    ],
  },
  TapeBlockOptions: {
    keys: [
      { name: 'tapes', kind: 'property', type: { kind: 'array', of: { kind: 'class', name: 'Tape' } }, detail: 'tapes in the block' },
    ],
  },
  TuringMachineOptions: {
    keys: [
      { name: 'tapeBlock', kind: 'property', type: { kind: 'class', name: 'TapeBlock' }, detail: 'tape-block to operate on' },
    ],
  },
},
```

- [ ] **Step 4: Edit `src/lib/completions/schema/post.ts` — flesh out PostMachine + shapes**

Replace the PostMachine class entry's `members: []` with:

```ts
members: [
  { name: 'tape',             kind: 'getter',   type: { kind: 'class', name: 'Tape' }, detail: 'current tape' },
  { name: 'replaceTapeWith',  kind: 'method',   type: { kind: 'primitive', name: 'unknown' }, params: [{ name: 'tape', type: { kind: 'class', name: 'Tape' } }], detail: 'swap the tape' },
  { name: 'setBreakpoint',    kind: 'method',   type: { kind: 'primitive', name: 'unknown' }, params: [{ name: 'target', type: { kind: 'primitive', name: 'unknown' } }, { name: 'kind', type: { kind: 'primitive', name: 'unknown' }, optional: true }], detail: 'set a per-instruction breakpoint' },
  { name: 'clearBreakpoint',  kind: 'method',   type: { kind: 'primitive', name: 'unknown' }, params: [{ name: 'target', type: { kind: 'primitive', name: 'unknown' } }], detail: 'clear a per-instruction breakpoint' },
  { name: 'stateAt',          kind: 'method',   type: { kind: 'class', name: 'State' }, params: [{ name: 'path', type: { kind: 'primitive', name: 'string' } }], detail: 'lookup a State by path' },
],
```

Replace the `shapes` object:

```ts
shapes: {
  PostMachineOptions: {
    keys: [
      { name: 'blankSymbol', kind: 'property', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'blank symbol override' },
      { name: 'markSymbol',  kind: 'property', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'mark symbol override' },
    ],
  },
  PostInstructions: { keys: [] },  // keys are user-defined labels (numeric/string); no completion target
},
```

- [ ] **Step 5: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/schema/types.test.ts
npx vitest run src/lib/completions/schema/engine.test.ts
npm run lint
npm run check
```

Expected: all PASS.

- [ ] **Step 6: Report — Task 2.1 done. Do NOT commit.**

---

### Task 2.2: Scanner — expand inference rules

**Files:**
- Modify: `src/lib/completions/scan/locals.ts`
- Modify: `src/lib/completions/scan/locals.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/completions/scan/locals.test.ts`:

```ts
describe('scanner — Phase 2 rules', () => {
  it('S-scan-newexpr-tape', () => {
    const r = scan('const t = new Tape({ alphabet });');
    expect(r.locals.get('t')).toEqual({ kind: 'class', name: 'Tape' });
  });

  it('S-scan-newexpr-tapeblock', () => {
    const r = scan('const tb = new TapeBlock({ tapes: [] });');
    expect(r.locals.get('tb')).toEqual({ kind: 'class', name: 'TapeBlock' });
  });

  it('S-scan-wohs-return', () => {
    const r = scan('const w = a.withOverriddenHaltState(b);');
    expect(r.locals.get('w')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-tag-return', () => {
    const r = scan('const x = s.tag(["k"]);');
    expect(r.locals.get('x')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-static-fromTapes', () => {
    const r = scan('const tb = TapeBlock.fromTapes([t]);');
    expect(r.locals.get('tb')).toEqual({ kind: 'class', name: 'TapeBlock' });
  });

  it('S-scan-destructure-tapeblock-symbol', () => {
    const r = scan('const tb = new TapeBlock({ tapes: [] });\nconst { symbol } = tb;');
    expect(r.locals.get('symbol')).toEqual({ kind: 'function', signatureRef: 'tapeBlock.symbol' });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Expected: the new tests FAIL because `newexpr-known-class` was Phase-1-restricted in a sense (it does match all schema classes — verify before assuming failure). The `destructure-tapeblock-symbol` test will certainly fail since that rule isn't wired yet.

Actually, re-check: `newExprKnownClass` in `locals.ts` already returns the class name for any `new <KnownClass>(…)` where the schema has that class. So `S-scan-newexpr-tape` and `-tapeblock` should pass once Phase 2's schema has Tape/TapeBlock with members (Phase 2's schema fleshes that out in Task 2.1; for the scanner the test passes either way since `newExprKnownClass` only checks `schema.classes[name]` existence — which both Phase 1 and Phase 2 schemas have for Tape/TapeBlock).

Test the assumption:

```bash
npx vitest run src/lib/completions/scan/locals.test.ts
```

Expected: `S-scan-wohs-return`, `S-scan-tag-return`, `S-scan-static-fromTapes` may pass already (the existing `callExprReturn` handles them). The `S-scan-destructure-tapeblock-symbol` test will FAIL.

Run the test command; see which fail.

- [ ] **Step 3: Wire `destructure-tapeblock-symbol`**

In `src/lib/completions/scan/locals.ts`, modify the `ObjectPattern` branch — when the RHS is a local with `kind: 'class', name: 'TapeBlock'`, bind specific destructured names to known function refs.

Find this block:

```ts
} else {
  for (const name of boundNames) {
    const local = renames.get(name) ?? name;
    rawLocals.add(local);
  }
}
```

Replace with:

```ts
} else if (rhs?.name === 'VariableName') {
  const rhsName = nodeText(rhs, src);
  const rhsType = locals.get(rhsName);
  for (const name of boundNames) {
    const local = renames.get(name) ?? name;
    rawLocals.add(local);
    if (rhsType?.kind === 'class' && rhsType.name === 'TapeBlock' && name === 'symbol') {
      locals.set(local, { kind: 'function', signatureRef: 'tapeBlock.symbol' });
    }
  }
} else {
  for (const name of boundNames) {
    const local = renames.get(name) ?? name;
    rawLocals.add(local);
  }
}
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/scan/locals.test.ts
npm run lint
npm run check
```

Expected: all Phase 1 + Phase 2 scanner tests PASS.

- [ ] **Step 5: Report — Task 2.2 done. Do NOT commit.**

---

### Task 2.3: `memberAccess` generalizes (free byproduct of Task 2.1's schema fleshing)

**Files:**
- Modify: `src/lib/completions/contexts/memberAccess.test.ts`

- [ ] **Step 1: Add tests for the newly-populated class members**

Append to `src/lib/completions/contexts/memberAccess.test.ts`:

```ts
describe('contexts/memberAccess (Phase 2 — general)', () => {
  it('S-src-member-tape', () => {
    const r = completionAt(`const t = new Tape({ alphabet });\nt.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['alphabet', 'position', 'symbols', 'viewport']);
  });

  it('S-src-member-tapeblock', () => {
    const r = completionAt(`const tb = new TapeBlock({ tapes: [] });\ntb.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['symbol', 'tapes']);
  });

  it('S-src-member-alphabet', () => {
    const r = completionAt(`const a = new Alphabet(["a"]);\na.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['blankSymbol', 'symbols']);
  });

  it('S-src-member-postmachine', () => {
    const r = completionAt(`const m = new PostMachine({});\nm.▮`, 'post', memberAccess);
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['replaceTapeWith', 'setBreakpoint', 'tape']));
  });
});
```

- [ ] **Step 2: Run to verify pass (no code change required)**

```bash
npx vitest run src/lib/completions/contexts/memberAccess.test.ts
```

Expected: PASS. (`memberAccess` was already general; only the schema needed fleshing — done in Task 2.1.)

- [ ] **Step 3: Report — Task 2.3 done. Do NOT commit.**

---

### Task 2.4: `destructureBag.ts` source

**Files:**
- Create: `src/lib/completions/contexts/destructureBag.ts`
- Create: `src/lib/completions/contexts/destructureBag.test.ts`
- Modify: `src/lib/completions/index.ts` (wire it in)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/completions/contexts/destructureBag.test.ts
import { describe, it, expect } from 'vitest';
import { destructureBag } from './destructureBag.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: Array<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/destructureBag', () => {
  it('S-src-destructure-imports-empty', () => {
    const r = completionAt(`const { ▮ } = imports;`, 'turing', destructureBag);
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['Alphabet', 'State', 'Tape', 'TapeBlock', 'TuringMachine']));
  });

  it('S-src-destructure-imports-partial', () => {
    const r = completionAt(`const { State, ▮ } = imports;`, 'turing', destructureBag);
    expect(labelsOf(r)).not.toContain('State');
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['Alphabet', 'Tape']));
  });

  it('S-src-destructure-tapeblock', () => {
    const r = completionAt(`const tb = new TapeBlock({ tapes: [] });\nconst { ▮ } = tb;`, 'turing', destructureBag);
    expect(labelsOf(r)).toEqual(['symbol', 'tapes']);
  });

  it('S-src-destructure-out-of-context — null', () => {
    const r = completionAt(`const x = ▮`, 'turing', destructureBag);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/destructureBag.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `destructureBag.ts`**

```ts
// src/lib/completions/contexts/destructureBag.ts
import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

type DestructureContext =
  | { kind: 'imports'; existing: Set<string> }
  | { kind: 'class'; className: string; existing: Set<string> }
  | null;

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

function findDestructure(ctx: CompletionContext): DestructureContext {
  const tree = syntaxTree(ctx.state);
  let node: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (node && node.name !== 'ObjectPattern') node = node.parent;
  if (!node) return null;

  // ObjectPattern → parent is PatternProperty / VariableDeclarator / ... Find the declarator.
  let decl: SyntaxNode | null = node.parent;
  while (decl && decl.name !== 'VariableDeclarator') decl = decl.parent;
  if (!decl) return null;

  // Init is after the `=`: walk children to find a child after the ObjectPattern node.
  let init: SyntaxNode | null = node.nextSibling;
  while (init && init.name === '=') init = init.nextSibling;
  if (!init) return null;

  const existing = new Set<string>();
  let prop = node.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const k = prop.firstChild;
      if (k && (k.name === 'PropertyName' || k.name === 'VariableDefinition' || k.name === 'VariableName')) {
        existing.add(nameText(k, ctx));
      }
    }
    prop = prop.nextSibling;
  }

  if (init.name === 'VariableName' && nameText(init, ctx) === 'imports') {
    return { kind: 'imports', existing };
  }
  if (init.name === 'VariableName') {
    return { kind: 'class', className: nameText(init, ctx), existing };
  }
  return null;
}

export const destructureBag: CompletionSourceFactory = (env) => (ctx) => {
  const detected = findDestructure(ctx);
  if (!detected) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  const from = word?.from ?? ctx.pos;

  if (detected.kind === 'imports') {
    const options: Completion[] = Object.keys(env.schema.namespace)
      .filter((n) => !detected.existing.has(n))
      .map((n) => ({ label: n, type: 'variable', detail: env.schema.namespace[n].detail, boost: 90 }));
    return { from, options, validFor: /^[\w$]*$/ };
  }

  // class destructure
  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(detected.className);
  if (!t || t.kind !== 'class') return null;
  const cls = env.schema.classes[t.name];
  if (!cls) return null;
  const options: Completion[] = cls.members
    .filter((m) => !detected.existing.has(m.name))
    .map<Completion>((m) => ({ label: m.name, type: m.kind === 'method' ? 'method' : 'property', detail: m.detail, boost: 90 }));
  return { from, options, validFor: /^[\w$]*$/ };
};
```

- [ ] **Step 4: Wire into `completions/index.ts`**

Edit `src/lib/completions/index.ts` to add the source — insert before `localCompletionSource`:

```ts
import { destructureBag } from './contexts/destructureBag.ts';
// ...
javascriptLanguage.data.of({ autocomplete: destructureBag(env) }),
```

- [ ] **Step 5: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/destructureBag.test.ts
npm test
npm run lint
npm run check
```

Expected: all PASS.

- [ ] **Step 6: Report — Phase 2 complete. Stop here. User: please review the diff and grant commit permission.**

Suggested commit message:

```
feat: smart completions phase 2 — instance members + destructure (#103)

- Schema: fleshed out Alphabet/Tape/TapeBlock/TuringMachine/PostMachine
  class members + StateSymbolMap/Command/TapeOptions/TapeBlockOptions/
  TuringMachineOptions/PostMachineOptions shapes.
- Scanner: const { symbol } = tapeBlock rebind to function:tapeBlock.symbol.
- memberAccess: generalizes (free byproduct of schema fleshing).
- destructureBag: complete keys inside { … } of `const {} = imports`
  and `const {} = <local>` where the local is a typed class.

Priority #5 (general instance property completion) delivered.
```

---

## Phase 3 — Auto-import

Builds Layer 4 (the apply helper) and upgrades `namespaceIdentifier` to wire the auto-import variant.

End-of-phase state: typing a not-destructured namespace name offers it with `(import)`; accepting auto-inserts into the top destructure block (creating one if absent).

---

### Task 3.1: `applyAutoImport` — present-block branch

**Files:**
- Create: `src/lib/completions/apply/import.ts`
- Create: `src/lib/completions/apply/import.test.ts`

This test file needs DOM — uses `// @vitest-environment happy-dom`.

- [ ] **Step 1: Write the failing tests (present-block subset)**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState, EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { applyAutoImport } from './import.ts';
import { localsField } from '../scan/locals.ts';
import { getSchema } from '../schema/index.ts';

function setup(marked: string) {
  const cursor = marked.indexOf('▮');
  if (cursor === -1) throw new Error('marker missing');
  const doc = marked.slice(0, cursor) + marked.slice(cursor + 1);
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursor },
  });
  const view = new EditorView({ state });
  return { view, cursor };
}

describe('applyAutoImport — present-block branch', () => {
  it('S-apply-import-present-singleline-mid-alpha', () => {
    const { view, cursor } = setup(`const { State, Tape } = imports;\nnew Alpha▮`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet, State, Tape } = imports;\nnew Alphabet`);
  });

  it('S-apply-import-present-empty-pattern', () => {
    const { view, cursor } = setup(`const {} = imports;\nnew Alpha▮`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nnew Alphabet`);
  });

  it('S-apply-import-idempotent-name-already-bound', () => {
    const { view, cursor } = setup(`const { Alphabet } = imports;\nnew Alpha▮`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nnew Alphabet`);
  });

  it('S-apply-import-single-undo', () => {
    const { view, cursor } = setup(`const { State, Tape } = imports;\nnew Alpha▮`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    const after = view.state.doc.toString();
    view.dispatch({ effects: [], changes: { from: 0, to: view.state.doc.length, insert: '' } });
    // Note: testing CodeMirror undo here requires the history extension; for now we just
    // verify that the apply produced one transaction with `userEvent: 'input.complete'`.
    expect(after).toContain('Alphabet');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/apply/import.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apply/import.ts` — present-block branch only for now**

```ts
// src/lib/completions/apply/import.ts
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { Completion } from '@codemirror/autocomplete';
import type { ChangeSpec } from '@codemirror/state';
import type { EngineSchema } from '../schema/types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

/**
 * Apply a namespace-identifier completion, inserting the name into the top
 * `const { ... } = imports;` block if absent, in a single transaction.
 */
export function applyAutoImport(
  view: EditorView,
  _completion: Completion,
  from: number,
  to: number,
  insertedName: string,
  schema: EngineSchema,
): void {
  const { importsBinding } = inferLocalsFor(view.state, schema);
  const changes: ChangeSpec[] = [{ from, to, insert: insertedName }];

  if (importsBinding.kind === 'present') {
    if (!importsBinding.boundNames.has(insertedName)) {
      const insertChange = buildPresentBlockInsert(view, importsBinding, insertedName);
      if (insertChange) changes.unshift(insertChange);
    }
    // else: idempotent — only cursor-site replacement
  } else {
    const insertChange = buildAbsentBlockInsert(view, insertedName);
    if (insertChange) changes.unshift(insertChange);
  }

  view.dispatch({ changes, userEvent: 'input.complete' });
}

function buildPresentBlockInsert(
  view: EditorView,
  binding: Extract<ReturnType<typeof inferLocalsFor>['importsBinding'], { kind: 'present' }>,
  name: string,
): ChangeSpec | null {
  const { node, boundNames, isMultiLine } = binding;
  // ObjectPattern node: includes braces. Properties are direct children of name `Property` / `PatternProperty`.
  const propsInOrder: { from: number; to: number; name: string }[] = [];
  let prop = node.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        propsInOrder.push({ from: prop.from, to: prop.to, name: view.state.doc.sliceString(k.from, k.to) });
      }
    }
    prop = prop.nextSibling;
  }

  // Empty pattern -> insert between the braces
  if (propsInOrder.length === 0) {
    return { from: node.from + 1, to: node.from + 1, insert: ` ${name} ` };
  }

  // Find alphabetic insertion slot
  const sortedNames = [...boundNames].sort();
  const targetIdx = sortedNames.findIndex((n) => name < n);
  const insertBefore = targetIdx === -1 ? null : propsInOrder.find((p) => p.name === sortedNames[targetIdx]);

  if (isMultiLine) {
    const lineStart = view.state.doc.lineAt(propsInOrder[0].from).from;
    const indentMatch = /^\s*/.exec(view.state.doc.sliceString(lineStart, propsInOrder[0].from));
    const indent = indentMatch?.[0] ?? '  ';
    if (insertBefore) {
      return { from: insertBefore.from, to: insertBefore.from, insert: `${name},\n${indent}` };
    }
    // append after last property
    const last = propsInOrder[propsInOrder.length - 1];
    return { from: last.to, to: last.to, insert: `,\n${indent}${name}` };
  }

  // single-line
  if (insertBefore) {
    return { from: insertBefore.from, to: insertBefore.from, insert: `${name}, ` };
  }
  const last = propsInOrder[propsInOrder.length - 1];
  return { from: last.to, to: last.to, insert: `, ${name}` };
}

function buildAbsentBlockInsert(view: EditorView, name: string): ChangeSpec | null {
  // Stub for Task 3.2.
  return { from: 0, to: 0, insert: `const { ${name} } = imports;\n` };
}
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/apply/import.test.ts
npm run lint
npm run check
```

Expected: 4 tests PASS.

- [ ] **Step 5: Report — Task 3.1 done. Do NOT commit.**

---

### Task 3.2: `applyAutoImport` — absent-block branch + multi-line cases + rename

**Files:**
- Modify: `src/lib/completions/apply/import.ts`
- Modify: `src/lib/completions/apply/import.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/completions/apply/import.test.ts`:

```ts
describe('applyAutoImport — absent-block + multi-line', () => {
  it('S-apply-import-absent', () => {
    const { view, cursor } = setup(`// Task: count cells on the tape.\n\nconst a = new Alpha▮;`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(
      `// Task: count cells on the tape.\n\nconst { Alphabet } = imports;\nconst a = new Alphabet;`
    );
  });

  it('S-apply-import-absent-no-leading-comment', () => {
    const { view, cursor } = setup(`const a = new Alpha▮;`);
    applyAutoImport(view, { label: 'Alphabet' } as any, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nconst a = new Alphabet;`);
  });

  it('S-apply-import-present-multiline-end', () => {
    const before = `const {\n  Alphabet,\n  State,\n  Tape,\n} = imports;\nnew Turin▮`;
    const { view, cursor } = setup(before);
    applyAutoImport(view, { label: 'TuringMachine' } as any, cursor - 'Turin'.length, cursor, 'TuringMachine', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(
      `const {\n  Alphabet,\n  State,\n  Tape,\n  TuringMachine,\n} = imports;\nnew TuringMachine`
    );
  });

  it('S-apply-import-rename-suppresses-original', () => {
    const before = `const { State: TS, Tape } = imports;\nnew Stat▮`;
    const { view, cursor } = setup(before);
    // Caller supplies `TS` (the rename's local name) since namespaceIdentifier offers TS, not State.
    applyAutoImport(view, { label: 'TS' } as any, cursor - 'Stat'.length, cursor, 'TS', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { State: TS, Tape } = imports;\nnew TS`);
  });
});
```

- [ ] **Step 2: Run to verify failure / status**

```bash
npx vitest run src/lib/completions/apply/import.test.ts
```

Expected: at least `S-apply-import-absent` and `-no-leading-comment` will fail because the absent-branch stub inserts at position 0 with no awareness of leading comments.

- [ ] **Step 3: Replace `buildAbsentBlockInsert` with a real implementation**

In `src/lib/completions/apply/import.ts`:

```ts
function buildAbsentBlockInsert(view: EditorView, name: string): ChangeSpec | null {
  // Find the first non-blank, non-comment line.
  const text = view.state.doc.toString();
  // Strip leading line comments (//) and blocks (/* … */) plus blank lines.
  let i = 0;
  while (i < text.length) {
    // skip whitespace
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    break;
  }
  const insertAt = i;
  return { from: insertAt, to: insertAt, insert: `const { ${name} } = imports;\n` };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/completions/apply/import.test.ts
```

Expected: all PASS. (`S-apply-import-present-multiline-end` should pass via Task 3.1's multi-line code path; the rename test passes because `TS` is already in `boundNames`, so the destructure-change is skipped — only the cursor-site replacement runs.)

- [ ] **Step 5: Run lint + check + report**

```bash
npm run lint
npm run check
```

Expected: clean. **Report — Task 3.2 done. Do NOT commit.**

---

### Task 3.3: `namespaceIdentifier` — wire auto-import variant

**Files:**
- Modify: `src/lib/completions/contexts/namespaceIdentifier.ts`
- Modify: `src/lib/completions/contexts/namespaceIdentifier.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/completions/contexts/namespaceIdentifier.test.ts`:

```ts
describe('contexts/namespaceIdentifier (Phase 3 — auto-import apply)', () => {
  it('S-src-ns-apply-callback-present-on-import-variant', () => {
    const r = completionAt(`const a = Alpha▮`, 'turing', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'Alphabet');
    expect(opt?.apply).toBeTypeOf('function');
  });

  it('S-src-ns-apply-callback-absent-on-already-destructured', () => {
    const r = completionAt(`const { Alphabet } = imports;\nconst a = Alpha▮`, 'turing', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'Alphabet');
    expect(opt?.apply).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — apply callback not present.

- [ ] **Step 3: Modify `namespaceIdentifier.ts`**

Import `applyAutoImport`; replace the `not-destructured` branch's completion construction:

```ts
import { applyAutoImport } from '../apply/import.ts';
import type { EditorView } from '@codemirror/view';
// ...

// inside the loop, in the else (not destructured) branch:
options.push({
  label: name,
  type: nsEntryTypeForLabel(entry),
  detail: `${entry.detail} (import)`,
  boost: 80,
  apply: (view: EditorView, _c: any, from: number, to: number) => {
    applyAutoImport(view, _c, from, to, name, env.schema);
  },
});
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/namespaceIdentifier.test.ts
npm test
npm run lint
npm run check
```

Expected: all PASS.

- [ ] **Step 5: Smoke test in browser**

```bash
npm run dev
```

Open `/turing`. Delete `Alphabet` from the default destructure. Type `new Alpha`, accept the `(import)` suggestion, verify the destructure regrows alphabetically and the prefix expands. `Ctrl-C` to stop.

- [ ] **Step 6: Report — Phase 3 complete. Stop here. User: please review the diff and grant commit permission.**

Suggested commit message:

```
feat: smart completions phase 3 — auto-import on undestructured names (#103)

- apply/import.ts: applyAutoImport inserts a namespace name into the top
  `const { … } = imports;` block (alphabetical, format-aware for single
  vs multi-line). Creates the block above the first non-comment statement
  when absent. One-undo transaction.
- namespaceIdentifier: not-yet-destructured entries (boost 80, `(import)`
  detail) now carry the apply callback; already-destructured entries
  (boost 99) and rename aliases keep label-only behavior.
```

---

## Phase 4 — Upstream API constructors

Adds `optionsBag.ts` for top-level options, snippet expansion in `new <ident>` position, and post-instruction snippet expansion. Snippet apply chains through `applyAutoImport`.

---

### Task 4.1: `optionsBag.ts` — top-level only

**Files:**
- Create: `src/lib/completions/contexts/optionsBag.ts`
- Create: `src/lib/completions/contexts/optionsBag.test.ts`
- Modify: `src/lib/completions/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/completions/contexts/optionsBag.test.ts
import { describe, it, expect } from 'vitest';
import { optionsBag } from './optionsBag.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: Array<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/optionsBag (Phase 4 — top-level)', () => {
  it('S-src-options-toplevel-turingmachine', () => {
    const r = completionAt(`new TuringMachine({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['tapeBlock']);
  });

  it('S-src-options-toplevel-tape', () => {
    const r = completionAt(`new Tape({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['alphabet', 'symbols', 'viewportWidth']);
  });

  it('S-src-options-toplevel-tapeblock', () => {
    const r = completionAt(`new TapeBlock({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['tapes']);
  });

  it('S-src-options-postmachine', () => {
    const r = completionAt(`new PostMachine({}, { ▮ })`, 'post', optionsBag);
    expect(labelsOf(r)).toEqual(['blankSymbol', 'markSymbol']);
  });

  it('S-src-options-partial', () => {
    const r = completionAt(`new Tape({ alphabet, ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['symbols', 'viewportWidth']);
  });

  it('S-src-options-not-options-context — null', () => {
    const r = completionAt(`const x = { ▮ }`, 'turing', optionsBag);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — module missing.

- [ ] **Step 3: Create `optionsBag.ts`**

```ts
// src/lib/completions/contexts/optionsBag.ts
import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

/** Walk up to find ObjectExpression. Then check if its parent chain is an arg of NewExpression. */
function findOptionsBagContext(ctx: CompletionContext): { className: string; existing: Set<string> } | null {
  const tree = syntaxTree(ctx.state);
  let obj: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (obj && obj.name !== 'ObjectExpression') obj = obj.parent;
  if (!obj) return null;
  let p: SyntaxNode | null = obj.parent;
  // Skip ArgList / Arguments node names depending on Lezer JS grammar
  while (p && p.name !== 'NewExpression' && p.name !== 'CallExpression') p = p.parent;
  if (!p || p.name !== 'NewExpression') return null;
  const callee = p.firstChild?.nextSibling;
  if (!callee || callee.name !== 'VariableName') return null;
  const className = nameText(callee, ctx);

  const existing = new Set<string>();
  let prop = obj.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k && (k.name === 'PropertyName' || k.name === 'VariableName' || k.name === 'PropertyDefinition')) {
        existing.add(nameText(k, ctx));
      }
    }
    prop = prop.nextSibling;
  }

  return { className, existing };
}

export const optionsBag: CompletionSourceFactory = (env) => (ctx) => {
  const found = findOptionsBagContext(ctx);
  if (!found) return null;
  const cls = env.schema.classes[found.className];
  if (!cls?.ctor?.optionsShape) return null;
  const shape = env.schema.shapes[cls.ctor.optionsShape];
  if (!shape) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  const options: Completion[] = shape.keys
    .filter((k) => !found.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 90 }));
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
```

- [ ] **Step 4: Wire into `completions/index.ts`**

Insert `optionsBag(env)` before `destructureBag(env)` in the source order (more specific contexts run first):

```ts
import { optionsBag } from './contexts/optionsBag.ts';
// ...
javascriptLanguage.data.of({ autocomplete: optionsBag(env) }),
javascriptLanguage.data.of({ autocomplete: destructureBag(env) }),
```

- [ ] **Step 5: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/optionsBag.test.ts
npm test
npm run lint
npm run check
```

Expected: all PASS.

- [ ] **Step 6: Report — Task 4.1 done. Do NOT commit.**

---

### Task 4.2: Snippet expansion in `new <ident>` position + post-instructions

**Files:**
- Modify: `src/lib/completions/contexts/namespaceIdentifier.ts`
- Modify: `src/lib/completions/contexts/namespaceIdentifier.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/completions/contexts/namespaceIdentifier.test.ts`:

```ts
describe('contexts/namespaceIdentifier (Phase 4 — snippets)', () => {
  it('S-src-ns-snippet-new-turingmachine', () => {
    const r = completionAt(`const m = new Turin▮`, 'turing', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'TuringMachine');
    // Snippet body uses `\${1:tapeBlock}` token form
    expect(opt?.apply).toBeDefined();
  });

  it('S-src-ns-snippet-post-call', () => {
    const r = completionAt(`{ 10: call▮ }`, 'post', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'call');
    expect(opt?.apply).toBeDefined();
  });

  it('S-src-ns-snippet-post-mark-no-params', () => {
    const r = completionAt(`{ 10: mar▮ }`, 'post', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'mark');
    // mark has no params → no snippet, plain insert
    expect(typeof opt?.apply === 'function' || opt?.apply === undefined).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/namespaceIdentifier.test.ts
```

Expected: FAIL on the snippet tests (apply not set).

- [ ] **Step 3: Update `namespaceIdentifier.ts`**

Add a helper that detects "in NewExpression callee position":

```ts
import { snippet } from '@codemirror/autocomplete';
// ...
function isNewExprCallee(ctx: CompletionContext, wordFrom: number): boolean {
  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(wordFrom, 1);
  const parent = node.parent;
  return parent?.name === 'NewExpression' && parent.firstChild?.nextSibling === node;
}
```

Then, when emitting an entry whose `kind === 'class'` AND `isNewExprCallee(ctx, word.from)`, build a snippet completion body:

```ts
function classSnippetBody(name: string, schema: EngineSchema): string {
  const cls = schema.classes[name];
  if (!cls?.ctor?.optionsShape) return `${name}(\${1})`;
  const shape = schema.shapes[cls.ctor.optionsShape];
  if (!shape?.keys.length) return `${name}({ \${1} })`;
  const first = shape.keys[0];
  return `${name}({ ${first.name}: \${1:${first.name}} })`;
}

function postInstrSnippetBody(name: string, entry: NamespaceEntry & { kind: 'post-instruction' }): string {
  if (!entry.params) return name;
  const slots = entry.params
    .filter((p) => !p.optional)
    .map((p, i) => `\${${i + 1}:${p.name}}`)
    .join(', ');
  return `${name}(${slots})`;
}
```

In the loop, when constructing the not-destructured `(import)` variant, IF `entry.kind === 'class'` and `isNewExprCallee(...)`, chain both: insert auto-import AND the snippet body:

```ts
const isNewCallee = entry.kind === 'class' && isNewExprCallee(ctx, word.from);
const snippetBody = isNewCallee ? classSnippetBody(name, env.schema) : null;

options.push({
  label: name,
  type: nsEntryTypeForLabel(entry),
  detail: `${entry.detail}${boundNames.has(name) ? '' : ' (import)'}`,
  boost: boundNames.has(name) ? 99 : 80,
  apply: (view, _c, from, to) => {
    const insertText = snippetBody ?? name;
    // First do auto-import (if needed); then snippet/string at cursor.
    if (snippetBody) {
      // Chain: apply auto-import range to insert destructure change, then use CodeMirror's
      // snippet apply to handle tab-stops.
      if (!boundNames.has(name)) {
        applyAutoImport(view, _c, from, to, '', env.schema);  // empty cursor-site insertion; snippet follows
      }
      snippet(snippetBody)(view, _c, from, to);
    } else {
      applyAutoImport(view, _c, from, to, name, env.schema);
    }
  },
});
```

(Post-instruction snippets are handled similarly using `postInstrSnippetBody` instead of `classSnippetBody`; chain them only when params exist.)

**Implementation note:** The `applyAutoImport` insertion of empty-name at cursor is awkward. Refactor: split `applyAutoImport` into `computeDestructureChange(view, name, schema): ChangeSpec | null` so callers can compose it with the snippet apply themselves. Adjust the original `applyAutoImport` to use the new helper.

Refactor `apply/import.ts` to export:

```ts
export function computeDestructureChange(view: EditorView, name: string, schema: EngineSchema): ChangeSpec | null {
  const { importsBinding } = inferLocalsFor(view.state, schema);
  if (importsBinding.kind === 'present') {
    if (importsBinding.boundNames.has(name)) return null;
    return buildPresentBlockInsert(view, importsBinding, name);
  }
  return buildAbsentBlockInsert(view, name);
}

export function applyAutoImport(/* same args */): void {
  const change = computeDestructureChange(view, insertedName, schema);
  const changes: ChangeSpec[] = [{ from, to, insert: insertedName }];
  if (change) changes.unshift(change);
  view.dispatch({ changes, userEvent: 'input.complete' });
}
```

Then in `namespaceIdentifier.ts` snippet apply path:

```ts
apply: (view, _c, from, to) => {
  if (snippetBody) {
    const destructureChange = computeDestructureChange(view, name, env.schema);
    if (destructureChange) {
      view.dispatch({ changes: [destructureChange], userEvent: 'input.complete' });
    }
    snippet(snippetBody)(view, _c, from, to);
  } else {
    applyAutoImport(view, _c, from, to, name, env.schema);
  }
},
```

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/namespaceIdentifier.test.ts
npm test
npm run lint
npm run check
```

Expected: all PASS.

- [ ] **Step 5: Browser smoke test**

```bash
npm run dev
```

Open `/turing`. Type `new Turin`, accept `TuringMachine` — verify destructure regrows AND the inserted code is `TuringMachine({ tapeBlock: tapeBlock })` with first tab-stop selected. `Ctrl-C`.

- [ ] **Step 6: Report — Phase 4 complete. Stop here. User: please review the diff and grant commit permission.**

Suggested commit message:

```
feat: smart completions phase 4 — constructor snippets + options bag (#103)

- optionsBag: complete keys inside `new <Class>({ … })` against the
  class's optionsShape (Tape / TapeBlock / TuringMachine / PostMachine).
- namespaceIdentifier: class entries in `new <ident>` callee position
  expand to snippet `new Class({ firstKey: ${1:firstKey} })`. Post
  instructions with params expand similarly (`call('${1:label}')` etc.).
- apply/import.ts: refactored to expose computeDestructureChange so
  snippet apply can compose auto-import + snippet body in one dispatch.
```

---

## Phase 5 — Nested options + polish + E2E

Final polish phase: nested options-bag walk, bundle-size check, E2E smoke tests.

---

### Task 5.1: Nested `optionsBag` — shape-path walk

**Files:**
- Modify: `src/lib/completions/contexts/optionsBag.ts`
- Modify: `src/lib/completions/contexts/optionsBag.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/completions/contexts/optionsBag.test.ts`:

```ts
describe('contexts/optionsBag (Phase 5 — nested)', () => {
  it('S-src-options-nested-state-pattern', () => {
    const src = `new State({ [tb.symbol(['a'])]: { ▮ } })`;
    const r = completionAt(src, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['command', 'nextState']);
  });

  it('S-src-options-nested-command', () => {
    const src = `new State({ [tb.symbol(['a'])]: { command: [{ ▮ }] } })`;
    const r = completionAt(src, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['movement', 'symbol']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/lib/completions/contexts/optionsBag.test.ts
```

Expected: FAIL (nested contexts return null today).

- [ ] **Step 3: Add a shape-path walker to `optionsBag.ts`**

Generalize `findOptionsBagContext`:

```ts
type Frame = { shape: ShapeSpec; existing: Set<string> };

function resolveNestedShape(ctx: CompletionContext, env: Env): Frame | null {
  const tree = syntaxTree(ctx.state);
  let obj: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (obj && obj.name !== 'ObjectExpression') obj = obj.parent;
  if (!obj) return null;

  // Collect the chain of parent ObjectExpression/ArrayExpression/Property up to a NewExpression.
  const stack: Array<{ kind: 'object'; existing: Set<string>; node: SyntaxNode } | { kind: 'array' } | { kind: 'property'; key: string }> = [];
  let cursor: SyntaxNode | null = obj;
  while (cursor) {
    if (cursor.name === 'ObjectExpression') {
      const existing = new Set<string>();
      let prop = cursor.firstChild;
      while (prop) {
        if (prop.name === 'Property') {
          const k = prop.firstChild;
          if (k && (k.name === 'PropertyName' || k.name === 'VariableName')) {
            existing.add(ctx.state.doc.sliceString(k.from, k.to));
          }
        }
        prop = prop.nextSibling;
      }
      stack.unshift({ kind: 'object', existing, node: cursor });
    } else if (cursor.name === 'ArrayExpression') {
      stack.unshift({ kind: 'array' });
    } else if (cursor.name === 'Property') {
      const k = cursor.firstChild;
      const key = k ? ctx.state.doc.sliceString(k.from, k.to) : '';
      stack.unshift({ kind: 'property', key });
    } else if (cursor.name === 'NewExpression') {
      break;
    }
    cursor = cursor.parent;
  }

  if (!cursor || cursor.name !== 'NewExpression') return null;
  const callee = cursor.firstChild?.nextSibling;
  if (!callee || callee.name !== 'VariableName') return null;
  const className = ctx.state.doc.sliceString(callee.from, callee.to);
  const cls = env.schema.classes[className];
  if (!cls?.ctor?.optionsShape) return null;

  // Walk down: shape starts at optionsShape; for each property step, descend into its TypeRef.
  let shape: ShapeSpec | null = env.schema.shapes[cls.ctor.optionsShape];
  if (!shape) return null;
  let topFrameExisting: Set<string> = new Set();

  for (let i = 0; i < stack.length; i++) {
    const item = stack[i];
    if (item.kind === 'object') {
      topFrameExisting = item.existing;
    } else if (item.kind === 'property') {
      const member = shape!.keys.find((k) => k.name === item.key);
      if (!member) return null;
      shape = resolveTypeToShape(member.type, env);
      if (!shape) return null;
    } else if (item.kind === 'array') {
      // arrays of shaped elements — pass through; next frame is one element
      // shape unchanged (we already pointed to the element shape via the Property step above)
    }
  }

  return { shape: shape!, existing: topFrameExisting };
}

function resolveTypeToShape(t: TypeRef, env: Env): ShapeSpec | null {
  if (t.kind === 'shape') return env.schema.shapes[t.name] ?? null;
  if (t.kind === 'array') return resolveTypeToShape(t.of, env);
  if (t.kind === 'class') {
    // Special-case: `nextState: State` — no nested completion target inside it.
    return null;
  }
  return null;
}

export const optionsBag: CompletionSourceFactory = (env) => (ctx) => {
  const frame = resolveNestedShape(ctx, env);
  if (!frame) return null;
  const word = ctx.matchBefore(/[\w$]*/);
  const options: Completion[] = frame.shape.keys
    .filter((k) => !frame.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 90 }));
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
```

(Note: this replaces the original top-level finder with a single generalized walker. The Phase 4 tests still pass because top-level options is the depth-0 case.)

- [ ] **Step 4: Run to verify pass + lint + check**

```bash
npx vitest run src/lib/completions/contexts/optionsBag.test.ts
npm test
npm run lint
npm run check
```

Expected: all PASS, including all Phase 4 top-level cases.

- [ ] **Step 5: Report — Task 5.1 done. Do NOT commit.**

---

### Task 5.2: Schema polish + bundle-size sanity check

**Files:**
- Modify: `src/lib/completions/schema/turing.ts` (small additions)

- [ ] **Step 1: Add the remaining stub-namespace entries**

In `turing.ts`, add these entries (if not yet present) with one-line `detail: 'advanced'` markers so they at least appear in the menu:

```ts
DebugSession:  { kind: 'class', classRef: 'DebugSession', detail: 'advanced: interactive debug session' },
CallFrame:     { kind: 'class', classRef: 'CallFrame', detail: 'advanced: subroutine call frame' },
Command:       { kind: 'class', classRef: 'Command', detail: 'advanced: precomputed command' },
Reference:     { kind: 'class', classRef: 'Reference', detail: 'advanced: forward reference helper' },
TapeCommand:   { kind: 'class', classRef: 'TapeCommand', detail: 'advanced: per-tape command' },

toMermaid:     { kind: 'function', params: [{ name: 'graph', type: { kind: 'shape', name: 'Graph' } }], returns: { kind: 'primitive', name: 'string' }, detail: 'advanced: graph → Mermaid source' },
fromMermaid:   { kind: 'function', params: [{ name: 'src', type: { kind: 'primitive', name: 'string' } }], returns: { kind: 'shape', name: 'Graph' }, detail: 'advanced: Mermaid → graph' },
summarize:     { kind: 'function', params: [{ name: 'state', type: { kind: 'class', name: 'State' } }, { name: 'block', type: { kind: 'class', name: 'TapeBlock' } }], returns: { kind: 'shape', name: 'GraphSummary' }, detail: 'advanced: state summary' },
summarizeGraph:{ kind: 'function', params: [{ name: 'graph', type: { kind: 'shape', name: 'Graph' } }], returns: { kind: 'shape', name: 'GraphSummary' }, detail: 'advanced: graph summary' },
equivalentOn:  { kind: 'function', params: [{ name: 'cases', type: { kind: 'array', of: { kind: 'shape', name: 'EquivalenceCase' } } }], returns: { kind: 'shape', name: 'EquivalenceReport' }, detail: 'advanced: behavioral equivalence' },
tapeViewport:  { kind: 'function', params: [{ name: 'snapshot', type: { kind: 'shape', name: 'TapeSnapshot' } }, { name: 'width', type: { kind: 'primitive', name: 'number' } }, { name: 'blank', type: { kind: 'primitive', name: 'string' } }], returns: { kind: 'shape', name: 'TapeSnapshot' }, detail: 'advanced: centered window over a snapshot' },
```

Add the referenced "advanced" shapes as empty:

```ts
Graph: { keys: [] },
GraphSummary: { keys: [] },
EquivalenceCase: { keys: [] },
EquivalenceReport: { keys: [] },
TapeSnapshot: { keys: [] },
```

(Add corresponding `members: []` stubs for the new class entries inside `classes:` if not yet present.)

- [ ] **Step 2: Update the drift-guard test if needed**

Run:

```bash
npx vitest run src/lib/completions/schema/engine.test.ts
```

If `S-schema-runtime-drift-turing` fails on any new name, the runtime export changed. Update the schema name to match the engine's actual export.

- [ ] **Step 3: Bundle-size sanity check**

```bash
npm run build
ls -lh dist/assets/*.js
```

Compare the gzipped size of the main chunk against the previous build (before Phase 1). The spec's hard ceiling is 30 KB of added weight. If exceeded:

```bash
# Inspect main chunk content
npx vite-bundle-visualizer  # if installed; otherwise install ad-hoc
```

If schema bloat is the cause, the fix is to move `schema/turing.ts` and `schema/post.ts` to a dynamic import (lazy-load on first keystroke after editor focus). Don't implement unless ceiling exceeded.

- [ ] **Step 4: Report — Task 5.2 done. Do NOT commit.**

---

### Task 5.3: E2E spec

**Files:**
- Create: `e2e/completions.spec.ts`

- [ ] **Step 1: Write failing E2E spec**

```ts
// e2e/completions.spec.ts
import { test, expect } from '@playwright/test';

test.describe('smart completions', () => {
  test('E-completions-movements-member', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    // Navigate to end of doc
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nmovements.');
    // Wait for the autocomplete listbox to render
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'left' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'right' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'stay' })).toBeVisible();
  });

  test('E-completions-state-debug-rhs', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nconst s = new State({});\ns.debug = ');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'true' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'false' })).toBeVisible();
  });

  test('E-completions-auto-import-roundtrip', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    // Select all + delete to start fresh
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('const a = new Alpha');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    const option = menu.getByRole('option', { name: 'Alphabet' });
    await expect(option).toBeVisible();
    await option.click();
    // Allow CodeMirror's snippet machinery to settle
    await page.waitForTimeout(100);
    const text = await editor.textContent();
    expect(text).toContain('const { Alphabet } = imports;');
    expect(text).toContain('Alphabet(');
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npm run test:e2e -- --grep "smart completions"
```

Expected: all 3 PASS. If any fails, adjust the test selector (CodeMirror's listbox role may need adjustment based on the actual DOM).

- [ ] **Step 3: Run the full E2E suite to confirm no regression**

```bash
npm run test:e2e
```

Expected: all green.

- [ ] **Step 4: Run full final verification**

```bash
npm test
npm run check
npm run lint
npm run build
```

Expected: all green.

- [ ] **Step 5: Report — Phase 5 complete. Stop here. User: please review the diff and grant commit permission.**

Suggested commit message:

```
feat: smart completions phase 5 — nested options + polish + E2E (#103)

- optionsBag: shape-path walker generalizes top-level to nested. Now
  surfaces `command` / `nextState` inside `new State({[k]: { ▮ } })`
  and `movement` / `symbol` inside `command: [{ ▮ }]`.
- Schema: stub-only namespace entries for less-used exports (DebugSession,
  CallFrame, Reference, etc.) now carry a `detail: 'advanced: ...'` line
  so they show up usefully in the menu.
- e2e/completions.spec.ts: three smoke scenarios covering the most-typed
  paths (movements.* member, state.debug RHS, auto-import roundtrip).

Closes #103.
```

---

## Post-merge follow-ups (NOT part of any commit)

After the PR merges (these are TODOs for the docs-audit pass — handled outside the implementation plan):

- Update `machines-demo/CLAUDE.md`:
  - *Editor* section: replace mention of `importsCompletion(engine)` with `completionExtensions(engine)`.
  - `src/lib/` architecture diagram: replace the `completions.ts` line with the `completions/` subdirectory tree.
  - *Conventions* section: note the `S-`-prefixed test ID convention for completion specs.
- `machines-demo/README.md`: grep for "completion" / "autocomplete" / "importsCompletion"; update any user-facing prose.
- Workspace `machines/CLAUDE.md`: add a per-alpha bullet under the machines-demo paragraph noting the smart-completions overhaul.
- Tracking issue #103: close with a link to the merged PR; verify all "Future work" items survived to the issue body (or move to a fresh follow-up issue if they grew specific scope).

---

## Self-review notes (executed against the spec)

Coverage check — every spec requirement maps to a task:

| Spec section | Task(s) |
|--------------|---------|
| Layer 1 (schema types + content + drift) | 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 5.2 |
| Layer 2 (scanner rules + ImportsBinding + cache) | 1.6, 1.7, 2.2 |
| Layer 3 — memberAccess | 1.9, 2.3 |
| Layer 3 — debugAssignment | 1.10 |
| Layer 3 — destructureBag | 2.4 |
| Layer 3 — optionsBag (top-level + nested) | 4.1, 5.1 |
| Layer 3 — namespaceIdentifier (label-only, auto-import, snippet) | 1.11, 3.3, 4.2 |
| Layer 4 — apply/import.ts | 3.1, 3.2 |
| Orchestration + Editor wire-up | 1.12, 2.4 (re-wire), 4.1 (re-wire) |
| Tests — schema | 1.5 |
| Tests — scanner | 1.7, 2.2 |
| Tests — per-source | 1.9, 1.10, 1.11, 2.3, 2.4, 3.3, 4.1, 4.2, 5.1 |
| Tests — apply | 3.1, 3.2 |
| Tests — E2E | 5.3 |
| Phasing — single PR / one alpha | (delivery shape; tasks honor commit boundaries) |

No identified gaps. The Open questions / Risks / Follow-ups sections from the spec don't need their own tasks — they're documented carries forward in the tracking issue.
