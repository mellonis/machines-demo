# Smart editor completions — design

Tracks: [#103](https://github.com/mellonis/machines-demo/issues/103) (umbrella for the smart-completions overhaul). Rolls in [#44](https://github.com/mellonis/machines-demo/issues/44) (the original "member-completion for `movements.*`, `symbolCommands.*`" ask, narrowed to one of five priorities here; closed as superseded by #103).

## Problem

`src/lib/completions.ts` is a flat-list completion source: it matches `[\w$]+` and returns every named export of the engine namespace as a `Completion` with `boost: 99`. That's all it does. The editor has no awareness of:

1. **`state.debug` / `haltState.debug` assignment shapes** — typing `state.debug = ` offers no hint of `true` / `false` / `{ before, after }`; typing `state.debug = { ` doesn't suggest the two valid keys. This is the gap that motivated #44 (filed while implementing #40's debug-snippets work).
2. **User-named states (and other typed locals)** — typing `walkToBlank.` (where `walkToBlank = new State({…}, 'walkToBlank')`) doesn't surface `withOverriddenHaltState`, `tag`, `debug`, etc.
3. **Constructor parameters and options-bag shapes** — typing `new TuringMachine({ ` doesn't suggest `tapeBlock`; typing `new Tape({ ` doesn't suggest `alphabet` / `symbols` / `viewportWidth`.
4. **Already-imported vs. importable identifiers** — every namespace name shows at the same rank regardless of whether it's been destructured out of `imports`. Accepting an undestructured name inserts the identifier but leaves it unbound at runtime.
5. **Static-enum member access** — typing `movements.` doesn't list `left` / `right` / `stay`. (#44's original ask.)

The current `src/lib/completions.ts` is replaced by a context-aware, schema-driven completion layer that addresses all five.

## Decisions

### Scope: one spec, phased rollout, single PR

The five priorities share infrastructure (a context-detection layer, a Lezer scan over the editor buffer, a hand-rolled engine schema, and a code-mutation helper for auto-import). They're designed together so the architecture lands once; the implementation is sliced into five commits on one branch, shipped as one PR, one alpha bump, one GH pre-release. See [Phasing](#phasing) for commit boundaries.

### Schema source: hand-rolled TS data file

A typed const in `src/lib/completions/schema/` describes the engine API surface. Rejected alternatives:

- **In-browser TypeScript language service** (`typescript` + a CodeMirror-TS bridge): ~3–5 MB even lazy-loaded; incompatible with a playground's startup budget.
- **Build-time schema generation from `.d.ts`** (Vite plugin that parses engine + post `.d.ts` via the TS compiler API): lower per-bump maintenance, but higher upfront build complexity and a `.d.ts` parser path we'd own. Reconsider if hand-maintenance becomes painful — likely after engine v7.x churn settles.

The engine + post namespaces total ~30 named entities; hand-rolled lands in ~300 LoC of typed data.

### Auto-import behavior: insert into top destructure, rank by status

User code runs in a worker via `new Function('imports', body)`, so "import" means destructuring from the `imports` parameter (`const { State, Tape } = imports;`) rather than ES `import` statements. When the user accepts a not-yet-destructured namespace identifier, the apply callback inserts it alphabetically into the top destructure block (creating one if absent). Already-destructured names rank at boost 99; undestructured names rank one tier lower (boost 80) with an `(import)` detail label. Rejected alternative: hint-only labels with no insertion — would force every newcomer to learn the destructure pattern before completion is useful.

### Constructor UX: snippet expansion + object-key completion

Accepting a class name in `new <ident>` position expands to `new <Class>({ ${1:firstKey}: ${2} })` with tab-stops, and the cursor inside `{…}` of a known options bag completes to the bag's keys. The snippet apply chains through the auto-import callback in a single undo step. Rejected alternatives: hover-tooltip signature help (requires a custom tooltip view, doesn't insert anything, less reactive), bare snippet expansion without inner-bag completion (cheaper but less useful once the user starts typing inside the bag).

### Post instruction shape: flattened

Engine namespace splits `class` / `function` / `singleton` / `constants` / `symbol`. Post namespace flattens all instructions into one `post-instruction` kind with optional `params`. Singletons (`mark`, `stop`, `right`, …) and parameterized constructors (`call`, `check`, `$tag`) live in one schema bucket; the completion menu groups them as one "Post instructions" cluster. Snippet expansion still works (presence of `params` triggers it).

### Phase order swap: auto-import before constructor snippets

Original brainstorming order was priorities 1 → 2 → 3 → 4 → 5. In the commit ordering this becomes 1 → 2 → 4 → 3 → 5: auto-import lands before constructor snippets because snippet expansion combined with an undestructured class would otherwise insert ReferenceError-y code. Auto-import-first means each commit leaves the branch in a self-consistent state.

### `CallFrame` deferred from the schema

Users almost never construct `CallFrame` directly — it's a return type from `withOverriddenHaltState`. Modeling it in v1 buys nothing visible.

## Architecture

Three layers, plus an apply-helper, replacing the current `src/lib/completions.ts`:

```
┌────────────────────────────────────────────────────────────────┐
│  components/Editor.svelte                                      │
│    extensions = [..., ...completionExtensions(engine)]         │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/lib/completions/index.ts        ← orchestration entry     │
│    completionExtensions(engine):                               │
│      composes the 5 completion sources + JS locals + keywords  │
└────────────────────────────────────────────────────────────────┘
        │              │                │                │
        ▼              ▼                ▼                ▼
┌──────────────┐ ┌────────────┐ ┌────────────────┐ ┌────────────┐
│ schema/      │ │ scan/      │ │ contexts/      │ │ apply/     │
│ engine.ts    │ │ locals.ts  │ │ *.ts           │ │ import.ts  │
│              │ │            │ │                │ │            │
│ STATIC DATA  │ │ AST WALK   │ │ ONE PER CASE   │ │ MUTATION   │
└──────────────┘ └────────────┘ └────────────────┘ └────────────┘
```

### Layer 1 — `schema/`

A typed const exporting two `EngineSchema` records (Turing, Post):

```ts
type EngineSchema = {
  namespace: Record<string, NamespaceEntry>;
  classes:   Record<string, ClassSpec>;
  shapes:    Record<string, ShapeSpec>;
  constants: Record<string, { keys: string[]; detail: string }>;
};

type NamespaceEntry =
  | { kind: 'class';            classRef: string;     detail: string }
  | { kind: 'function';         params: ParamSpec[];  returns: TypeRef; detail: string }
  | { kind: 'singleton';        type: TypeRef;        detail: string }
  | { kind: 'constants';        constantsRef: string; detail: string }
  | { kind: 'symbol';                                 detail: string }
  | { kind: 'post-instruction'; params?: ParamSpec[]; detail: string };

type TypeRef =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'unknown' }
  | { kind: 'class';     name: string }
  | { kind: 'shape';     name: string }
  | { kind: 'constants'; name: string }
  | { kind: 'array';     of: TypeRef }
  | { kind: 'union';     of: TypeRef[] }
  | { kind: 'literal';   value: string | number | boolean }
  | { kind: 'symbol' };

type ClassSpec = {
  ctor?: { params: ParamSpec[]; optionsShape?: string };
  members: MemberSpec[];
  detail: string;
};

type ShapeSpec = { keys: MemberSpec[] };
type MemberSpec = {
  name: string;
  kind: 'property' | 'method' | 'getter';
  type: TypeRef;
  params?: ParamSpec[];
  detail: string;
};
type ParamSpec = { name: string; type: TypeRef; optional?: true; detail?: string };
```

Closed registry — `TypeRef` of kind `class` / `shape` / `constants` only references entries that exist in the matching map. Drift is caught by the schema tests.

#### Coverage estimate

| Namespace | Classes | Singletons / consts | Functions / instructions | Shapes |
|-----------|---------|---------------------|--------------------------|--------|
| Turing    | 5 (Alphabet, State, Tape, TapeBlock, TuringMachine) | 4 (haltState, ifOtherSymbol, movements, symbolCommands) | 2-3 (toMermaid, summarize, tapeViewport) | 6 (StateDebug, StateSymbolMap, Command, TapeOptions, TapeBlockOptions, TuringMachineOptions) |
| Post      | 1 + reused 2 (PostMachine, +Tape/State by ref) | 4 (haltState, alphabet, blankSymbol, markSymbol) | 9 (mark, erase, noop, left, right, stop, call, check, $tag) | 2 (PostMachineOptions, Instructions-value) |

Total v1: ~30 namespace entries + ~6 classes + ~8 shapes + 2 constant-maps; ~300 LoC of TS data.

#### Coverage rule for v1

Cover what the bundled examples in `src/lib/defaultCode.ts` use, plus the v7 debug surface (`state.debug`, `haltState.debug`, `DebugSession`). Obscure exports (`Reference`, `equivalentOn`, `fromMermaid`, `summarizeGraph`) get a one-line namespace entry but no member detail — they complete by name, just not depth.

#### Drift guard

A Vitest spec asserts every `namespace` entry name exists as a runtime key of `* as turingNs` / `* as postNs`. Catches typo'd names and removed upstream exports. Doesn't try to verify member shapes (would need the `.d.ts` parser path we ruled out).

### Layer 2 — `scan/locals.ts`

One function: `inferLocals(state: EditorState) → { locals: Map<string, InferredType>; importsBinding: ImportsBinding }`.

Walks the Lezer tree from `@codemirror/lang-javascript` (already in use by `syntaxLinter.ts` — same tree, no new parser dep). Cached via a CodeMirror `StateField` keyed on the Lezer tree (recomputes only on tree change).

#### Inference rules (commits 1+2)

| Rule | Pattern | Binds |
|------|---------|-------|
| `newexpr-known-class` | `const X = new <KnownClass>(…)` | `X → class:<Name>` |
| `wohs-return`         | `const X = <ident>.withOverriddenHaltState(…)` | `X → class:State` |
| `tag-return`          | `const X = <ident>.tag(…)` | `X → class:State` (engine alpha.3 — tag returns self) |
| `static-fromTapes`    | `const X = <ident>.fromTapes(…)` | `X → class:TapeBlock` |
| `import-singleton`    | `const X = imports.haltState` / `const X = haltState` | `X → class:State` |
| `destructure-imports` | `const { A, B } = imports;` | each name → namespace entry's type |
| `destructure-imports-renamed` | `const { State: TS } = imports;` | `TS → class:State`; `State` recorded in `boundNames` |
| `destructure-tapeblock` | `const { symbol } = <local-tapeBlock>;` | `symbol → function:tapeBlock.symbol` |

Anything not matching → unknown (silently skipped). The existing JS local-completion source continues to handle generic locals; the scanner only adds *type-tagged* knowledge.

#### `ImportsBinding`

```ts
type ImportsBinding =
  | { kind: 'present'; node: SyntaxNode; boundNames: Set<string>; isMultiLine: boolean }
  | { kind: 'absent' };
```

`node` points at the `ObjectPattern` of the **first** `const { … } = imports;` declaration; `boundNames` is the union across all such blocks (subsequent blocks are recognized for dedup purposes but never edited by auto-import). `isMultiLine` is true if the `ObjectPattern` spans more than one line — drives auto-import formatting.

#### Failure modes

- **Broken Lezer tree** (mid-typing partial input): scanner wraps each rule in a try/catch and returns the partially-built map. Tested with `S-scan-incomplete-tree`.
- **Nested-scope destructures** (e.g. `(() => { const { State } = imports; })()`): ignored. Only top-level declarations in the function body count.

### Layer 3 — `contexts/`

Five `.ts` files, one per context kind. Each is a pure `(ctx: CompletionContext, env: CompletionEnv) → CompletionResult | null` composed in priority order by `index.ts`. The final fallthrough is CodeMirror's existing JS `localCompletionSource` + JS keywords.

| Source                  | Cursor in...                                                  | Suggests                                                                  | Boost |
|-------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------|-------|
| `memberAccess.ts`       | `<ident>.▮`                                                   | Members of `<ident>`'s inferred type                                       | 99    |
| `debugAssignment.ts` (A) | `<state>.debug = ▮`                                          | `true`, `false`, three object snippets                                     | 99    |
| `debugAssignment.ts` (B) | `<state>.debug = { ▮ }`                                      | Remaining keys from `StateDebug`                                           | 99    |
| `optionsBag.ts`         | inside `{…}` of a known constructor's options arg            | Keys from the constructor's `optionsShape`, minus keys already present     | 90    |
| `destructureBag.ts`     | inside `{…}` of `const {…} = imports;` or `… = tapeBlock;`   | Remaining (not-yet-destructured) namespace / object keys                  | 90    |
| `namespaceIdentifier.ts`| bare word at expression position                              | All namespace exports; already-destructured first, rest with `(import)`    | 80–99 |

Identifier-lookup order (used by `memberAccess.ts` and `optionsBag.ts`):

1. Inferred-locals map.
2. Namespace entry by name.
3. Special-case `imports` (returns the full namespace as a synthetic "members" list).

For `haltState.debug`, sub-context A detects `<ident>` resolves to `imports.haltState` or a local rebound from it and offers only `true` / `false` (engine alpha.5 collapsed `haltState.debug` to a boolean).

Phase-2 deepen of `optionsBag.ts` (commit 5): walks up through nested `ObjectExpression` / `ArrayExpression` / `Property` nodes to compose a "shape path" — surfaces `command` / `nextState` inside `new State({ [k]: { ▮ } })` and `movement` / `symbol` inside `command: [{ ▮ }]`.

### Layer 4 — `apply/import.ts`

One function used as the `apply` callback on `namespaceIdentifier` completions for not-yet-destructured names:

```ts
applyAutoImport(view: EditorView, completion: Completion, from: number, to: number): void
```

#### Single-undo transaction

Both branches build a single `view.dispatch({ changes, selection })` so the user sees one undo step covering:
- Insert/extend the destructure block.
- Replace the typed prefix at `[from, to]` with the completion's identifier (and, for class-in-`new` position, the snippet body).
- Move the cursor to the final tab-stop.

If the name is already in `boundNames`, the destructure-change is skipped; only the cursor-site replacement happens.

#### Present-block branch

1. Read the pattern's properties from the Lezer tree (plain `PropertyName` or `PropertyName: BindingName` renames).
2. Compute alphabetic insertion offset by the **imported name** (the `PropertyName`, not the local rename).
3. Format insertion based on `isMultiLine`:
   - **Single-line**: insert `, <name>` or `<name>, ` at the chosen offset.
   - **Multi-line**: detect leading indent of an existing binding; insert `\n<indent><name>,` (preserving any existing trailing comma).
4. **Empty pattern** (`const { } = imports;`): insert `<name>` between the braces, default single-line.

#### Absent-block branch

1. Find the first non-comment, non-blank statement in the function body via the Lezer tree.
2. Match its indent.
3. Emit `<indent>const { <name> } = imports;\n` immediately above it.

#### Rename handling

If the existing pattern has `const { State: TS } = imports;`, the `namespaceIdentifier` source offers the rename's **local name** (`TS`, label `TS`, detail `State (as TS)`) at boost 99. Accepting inserts `TS` at the cursor with no destructure change. Auto-import never undoes a user-written alias; never silently duplicates the destructure with both `State` and `TS`.

#### Snippet expansion + auto-import (commit 4)

For class entries in `new <Class>(…)` position, the completion's `apply` callback runs `applyAutoImport` AND replaces the typed prefix with the snippet body `<Class>({ ${1:firstKey}: ${2} })`. Both changes ship in the same transaction. Delegating to CodeMirror's `snippetCompletion` internally handles the tab-stop selection.

#### Idempotency

Apply re-reads scanner state from the current document (not from when the menu opened). If `name` is already in `boundNames`, the destructure-change is a no-op. CodeMirror invalidates the menu on document changes, so the race is rare in practice.

### Worked examples

**Example A — present multi-line block, alphabetic mid-insert:**

```js
// before — cursor at ▮
const {
  Alphabet,
  State,
  Tape,
} = imports;
const a = new Alpha▮;
```

User accepts `Alphabet` (already destructured → no destructure change). Cursor-site replacement only:

```js
const {
  Alphabet,
  State,
  Tape,
} = imports;
const a = new Alphabet;
```

**Example B — present single-line block, name absent, alphabetic insert + snippet expand:**

```js
const { State, Tape, TapeBlock } = imports;
const m = new TuringM▮;
```

User accepts `TuringMachine`:

```js
const { State, Tape, TapeBlock, TuringMachine } = imports;
const m = new TuringMachine({ tapeBlock: ▮ });
```

**Example C — absent block, code starts with comment then statement:**

```js
// Task: count cells on the tape.

const a = new Alpha▮;
```

Becomes:

```js
// Task: count cells on the tape.

const { Alphabet } = imports;
const a = new Alphabet(▮);
```

**Example D — existing rename:**

```js
const { State: TS, Tape } = imports;
const x = new Stat▮;
```

Completion menu offers `TS` (label `TS`, detail `State (as TS)`). Acceptance inserts `TS` only:

```js
const { State: TS, Tape } = imports;
const x = new TS({ ▮ });
```

## Phasing

Single branch (`feat/smart-completions`), single PR, single alpha bump, single GH pre-release. Commits map to the phase boundaries below; each commit leaves the branch in a working state (demo runs, type-check clean, tests pass). Reviewer walks the diff commit-by-commit.

### Commit 1 — Foundation + debug shapes (priority #1)

Largest commit — establishes Layers 1+2+3 (partial).

- Layer 1: full schema types + minimal content (namespace entries both engines, `State` class with `debug`/`tag`/`withOverriddenHaltState` only, `StateDebug` shape, `movements` + `symbolCommands` constants).
- Layer 2: full Lezer walker, but inference only fires for `const X = new State(…)` and `const X = imports.haltState` / `const X = haltState`. `ImportsBinding` is fully scanned (needed by commit 3).
- Layer 3: `memberAccess.ts` (only `class:State` + `constants:*`), `debugAssignment.ts` (both sub-contexts), `namespaceIdentifier.ts` (label-only, no auto-import — preserves today's behavior; already-destructured filter wired so commit 3 just plugs in the auto-import variant).
- Drift-guard Vitest.

End state: `movements.` / `symbolCommands.` / `state.debug = …` / `haltState.debug = …` all work; everything else falls through to today's behavior. Closes #44's original static-enum ask.

### Commit 2 — User-named states + general instance members (priorities #2 + #5)

- Layer 1: flesh out class members for `Tape`, `TapeBlock`, `Alphabet`, `TuringMachine`, `PostMachine`. Add shape entries for options bags (used by commit 4).
- Layer 2: scanner inference expands to all `new <KnownClass>(…)`, `.withOverriddenHaltState(…)`, `.tag(…)`, `.fromTapes(…)`, and `const { symbol } = <local-tapeBlock>;`.
- Layer 3: `memberAccess.ts` becomes general; `destructureBag.ts` ships (no auto-import side effects yet).

End state: any user-declared local with a known type completes its members. Priority #5 delivered as a free byproduct.

### Commit 3 — Auto-import (priority #4)

- Layer 4: full `apply/import.ts` (both branches, single-undo transaction, rename handling, idempotency).
- Layer 3: `namespaceIdentifier.ts` upgraded — already-destructured (boost 99) vs not-yet-destructured (boost 80, `(import)` detail, `apply` wired to `applyAutoImport`).

End state: typing a not-destructured namespace name offers it with `(import)`; accepting auto-inserts into the top destructure block.

### Commit 4 — Upstream API constructors (priority #3, top-level)

- Layer 3: `optionsBag.ts` (top-level only).
- Layer 3: `namespaceIdentifier.ts` extended — class entries snippet-expand in `new <ident>` context; snippet chains through `applyAutoImport`.
- Post-instruction snippets for `call`, `check`, `$tag`, dual-form `right` etc.

End state: snippet expansion + key completion inside known top-level options bags works.

### Commit 5 — Nested options + polish

- Layer 3: `optionsBag.ts` deepens — shape-path walk for `new State({[k]: { ▮ }})` and `command: [{ ▮ }]`.
- Stub-only namespace entries get enough detail to be useful (or stay deliberate stubs marked `detail: 'advanced'`).
- Bundle-size sanity check (`npm run build` + compare main chunk vs pre-Commit-1).
- Final commit before opening the PR.

End state: full design as specified is in place.

### PR description note

```
Walk the commits in order. Each commit is self-contained:
checkout any commit, `npm run build && npm test`,
the demo runs at that scope. Commit 1 is the largest because
it carries the architectural scaffold; commits 2–5 lean on it.
```

## Tests

Layered testing matches the layered architecture. Scenario-ID prefix: `S-` for completions specs, `E-` for E2E.

### Schema tests (`schema/engine.test.ts`)

Pure data invariants — no CodeMirror, no Lezer.

- `S-schema-runtime-drift-turing` / `S-schema-runtime-drift-post`: every name in `<X>_SCHEMA.namespace` is a runtime key of `* as turingNs` / `* as postNs`.
- `S-schema-typeref-closure`: every `TypeRef` of kind `class` / `shape` / `constants` resolves.
- `S-schema-ctor-options-shape-exists`: every `ClassSpec.ctor.optionsShape` references an existing `ShapeMap` entry.
- `S-schema-constants-nonempty`: every `ConstantMap` entry has at least one key.

### Scanner tests (`scan/locals.test.ts`)

Pure function over `(source: string) → { locals, importsBinding }`. Call `javascriptLanguage.parser.parse(source)` directly — no `EditorState` needed.

| Test ID | Source fixture | Expected |
|---------|---------------|----------|
| `S-scan-newexpr-state` | `const x = new State({});` | `x → class:State` |
| `S-scan-newexpr-tape` | `const t = new Tape({ alphabet });` | `t → class:Tape` |
| `S-scan-newexpr-unknown` | `const z = new Foo();` | `z` absent |
| `S-scan-wohs-return` | `const w = a.withOverriddenHaltState(b);` | `w → class:State` |
| `S-scan-tag-return` | `const x = s.tag(['k']);` | `x → class:State` |
| `S-scan-static-fromTapes` | `const tb = TapeBlock.fromTapes([t]);` | `tb → class:TapeBlock` |
| `S-scan-import-haltState` | `const h = imports.haltState;` | `h → class:State` |
| `S-scan-destructure-imports-flat` | `const { State, Tape } = imports;` | `boundNames = {State, Tape}`, `kind = 'present'`, `isMultiLine = false` |
| `S-scan-destructure-imports-multiline` | multi-line fixture from `defaultCode.ts` | same locals, `isMultiLine = true` |
| `S-scan-destructure-rename` | `const { State: TS } = imports;` | `boundNames = {State}`, local `TS → class:State` |
| `S-scan-destructure-tapeblock-symbol` | `const { symbol } = tapeBlock;` (tapeBlock inferred as TapeBlock) | `symbol → function:tapeBlock.symbol` |
| `S-scan-importsBinding-absent` | source without destructure | `kind = 'absent'` |
| `S-scan-importsBinding-first-wins` | two `const {…} = imports;` blocks | first node, union `boundNames` |
| `S-scan-incomplete-tree` | `const x = new State(` (unclosed) | empty locals + `kind = 'absent'`, doesn't throw |
| `S-scan-cache` | same Lezer tree → same Map instance | validates StateField cache |

### Source tests (`contexts/<name>.test.ts`)

Construct an `EditorState` with cursor at a `▮` marker. Call the source. Assert `CompletionResult.options`. Helper in `lib/testUtils.ts`: `completionAt(source, engine, sourceFn): CompletionResult | null`. No happy-dom needed — `EditorState` is pure.

- `S-src-member-state-debug`: `state.▮` → menu has `debug`, `tag`, `withOverriddenHaltState` (boost 99).
- `S-src-member-movements`: `movements.▮` → `left`, `right`, `stay`.
- `S-src-member-symbolCommands`: `symbolCommands.▮` → `keep`, `erase`.
- `S-src-member-unknown-falls-through`: `someUnknown.▮` → `null`.
- `S-src-debug-rhs-state`: `state.debug = ▮` → `true`, `false`, three object snippets.
- `S-src-debug-rhs-halt`: `haltState.debug = ▮` → only `true`, `false`.
- `S-src-debug-keys-state`: `state.debug = { ▮ }` → `before`, `after`.
- `S-src-debug-keys-state-partial`: `state.debug = { before: true, ▮ }` → only `after`.
- `S-src-options-toplevel-turingmachine`: `new TuringMachine({ ▮ })` → `tapeBlock`.
- `S-src-options-toplevel-tape`: `new Tape({ ▮ })` → `alphabet`, `symbols`, `viewportWidth`.
- `S-src-options-nested-state-pattern` (commit 5): `new State({ [s]: { ▮ } })` → `command`, `nextState`.
- `S-src-options-nested-command` (commit 5): `command: [{ ▮ }]` → `movement`, `symbol`.
- `S-src-destructure-imports-empty`: `const { ▮ } = imports;` → all namespace names.
- `S-src-destructure-imports-partial`: `const { State, ▮ } = imports;` → namespace names minus `State`.
- `S-src-destructure-tapeblock`: `const { ▮ } = tapeBlock;` → `tapes`, `symbol`.
- `S-src-ns-already-destructured`: `Alpha▮` with `Alphabet` in destructure → boost 99, no `(import)`.
- `S-src-ns-not-destructured`: `Alpha▮` without destructure → boost 80, `(import)` in detail.
- `S-src-ns-rename`: `Stat▮` with `const { State: TS } = imports;` → label `TS`, detail `State (as TS)`.
- `S-src-ns-snippet-new` (commit 4): `new Turin▮` → completion includes snippet body `TuringMachine({ ${1:tapeBlock}: ${2} })`.

### Apply tests (`apply/import.test.ts`)

`// @vitest-environment happy-dom` (only layer that needs the DOM). Build a real `EditorView`, dispatch via `applyAutoImport`, assert document + selection.

- `S-apply-import-present-singleline-mid-alpha`
- `S-apply-import-present-multiline-end`
- `S-apply-import-present-empty-pattern`
- `S-apply-import-absent` (with leading comment block)
- `S-apply-import-absent-no-leading-comment`
- `S-apply-import-idempotent-name-already-bound`
- `S-apply-import-rename-suppresses-original`
- `S-apply-import-single-undo` (dispatch + undo → pre-state)
- `S-apply-import-snippet-chained` (commit 4 — destructure insert + snippet body in one transaction; selection at first tab-stop)
- `S-apply-import-multi-line-trailing-comma`

### E2E tests (`e2e/completions.spec.ts`)

Smoke-grade. Three scenarios; mirrors `e2e/cold-start.spec.ts` style.

- `E-completions-movements-member`: type `movements.` → listbox shows `left`, `right`, `stay`.
- `E-completions-state-debug-rhs`: declare `const s = new State({})`, type `s.debug = ` → listbox shows `true`, `false`.
- `E-completions-auto-import-roundtrip`: delete `Alphabet` from default destructure, type `new Alpha`, accept → destructure restored, prefix expanded to `Alphabet({…})`. Full Layer-4 path end-to-end.

### Deliberately not tested at unit level

- CodeMirror DOM rendering of completions (owned by CodeMirror; covered at E2E).
- Snippet tab-stop traversal (CodeMirror snippet machinery; covered once by `E-completions-auto-import-roundtrip`).
- Multi-source menu ordering (we test `boost` values, not CodeMirror's sort).
- Performance (assertion-grade perf checks are flaky; the `S-scan-cache` invariant covers the only "we recompute too often" failure mode).

## Non-goals (explicit)

- **TypeScript language service in browser** — ruled out for bundle weight.
- **Semantic diagnostics / type errors** — existing `syntaxLinter` covers syntax; runtime semantics stay the worker's responsibility.
- **Hover tooltips with documentation prose** — completion `detail` (one-liner type signatures) is the only doc surface.
- **Member completion on computed/heavily-chained expressions** — `[a, b][i].`, `someFn().`, `(cond ? a : b).` are not tracked.
- **Auto-`import` for ES modules** — runtime pattern is `const { … } = imports;`, not ES `import`.
- **Refactoring features** — rename, extract, inline.
- **Quick-fixes for unbound identifiers** — would add a diagnostics layer and code-action surface; tempting follow-up, not v1.
- **Multi-cursor smart behaviors.**
- **Per-engine settings UI** for toggling auto-import / snippet expansion.
- **Tag-name completion** for `state.tag(['…'])` — requires an upstream registry the engine doesn't expose.

## Open questions

Re-confirm during implementation; not blockers for starting.

1. **`imports` itself as a namespace identifier when typed.** Recommended: yes — `import▮.` completes to `imports.`, then `imports.State` etc. via `memberAccess.ts` case 3. (`imports` without `s` is a JS keyword; cursor-on-`imports` is the discriminator.)
2. **Nested-scope destructures.** Recommended: ignore — only top-level destructures of the function body count.
3. **Multiple top-level `const { … } = imports;` blocks.** Recommended: scanner unions `boundNames`; auto-import always edits the first block. Subsequent blocks are de-facto orphaned for auto-import; the dedup is still correct.
4. **Snippet expansion in non-`new` position.** Recommended: snippet only fires when Lezer parent is `NewExpression` callee. Bare-name uses elsewhere (`function f(Alphabet)`) get the plain identifier.
5. **Cursor after auto-import in absent-block branch with empty function body.** Recommended: destructure lands above the cursor's empty position; harmless.

## Risks

- **Schema drift on engine bumps.** Drift-guard catches typos and removed exports; new upstream exports aren't auto-added. Mitigation: add "update completion schema" to the engine-alpha-bump checklist.
- **Bundle size creep.** Estimated ~20 KB total addition (schema ~5–10 KB, scanner ~3–5 KB, sources ~5 KB, apply ~3 KB). Commit 5 validates with `npm run build`. Hard ceiling: 30 KB. If exceeded, code-split the schema chunk to load lazily after first keystroke.
- **`(import)` entries cluttering the menu.** If users find boost-80 entries noisy, filter them out when prefix is empty (only show after at least one character). Cheap to add; not v1.
- **Lezer error trees on partial input.** Real-world partial states we didn't fixture may regress. Scanner wraps each rule in try/catch; one test fixture targets this (`S-scan-incomplete-tree`).

## Follow-ups

Park on the tracking issue's "Future work" section.

- **Schema generation from `.d.ts`** (Approach C from brainstorming). Revisit if hand-maintenance becomes painful.
- **Hover-tooltip signature help** — cheap once schema is in place; deferred to keep v1 lean.
- **Tag-name completion** for `state.tag(['▮'])` if engine exposes a tag registry.
- **Quick-fix for unbound namespace identifiers** — diagnostics + code-action pass.
- **Engine-side docs links** in `Completion.info` callback, once upstream README anchors stabilize.

## Post-implementation docs audit

After the PR merges, audit and update:

- **`machines-demo/CLAUDE.md`** — the *Editor* section (currently describes `importsCompletion(engine)` as boost-99 namespace + JS locals); the `src/lib/` architecture diagram (replace `completions.ts` line with the `completions/` subdirectory tree); the *Conventions* section if any of the new patterns (schema drift guard, scenario-ID prefix `S-`) deserve a callout.
- **`machines-demo/README.md`** — check for any mention of editor / completion behavior; update if present.
- **`docs/execution-model.md`** — no expected impact (this work doesn't touch the execution-mode state machine); confirm with a grep for "completion" / "autocomplete".
- **`docs/superpowers/specs/`** — this spec is the source of truth; no other spec should reference completion internals.
- **`docs/palette-sandbox/README.md`** — no expected impact; verify.
- **Workspace `machines/CLAUDE.md`** (the umbrella) — the machines-demo paragraph gets a new bullet on the smart-completions alpha (matching the per-alpha update pattern used for landing-page Phase 1/2, breakpoint mirror, etc.).
- **Tracking issue + #44** — close on merge; the tracking issue's "Future work" carries the follow-ups listed above.
- **Engine repos** — no expected impact. The schema describes the engine surface but doesn't import engine internals beyond the public namespace; engine changes don't require coordinated schema changes outside the demo. Confirm by greping engine repos for any reference to `completions` / `schema` after merge.
