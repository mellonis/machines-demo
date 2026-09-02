# Toolchain engines (PM-1 / TM-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new engine pages, `/pm1` and `/tm1`, that compile, assemble, lint, format, run, step and debug PM-1 / TM-1 programs in the browser through the machine-toolchains wasm bundle, reusing the demo's shell and leaf components.

**Architecture:** A sibling orchestrator (`ToolchainView.svelte`) beside the untouched `MachineView.svelte`, driven by its own worker (`toolchainWorker.ts` → testable `ToolchainCore`) and runner (`ToolchainRunner`) over the wasm `Toolchain` / `Program` / `Session` classes. The editor is the debugger surface: two file tabs (user buffer + read-only stdlib), gutter breakpoints keyed by `{ file, line }`, an ip line highlight, lint from the toolchain, `std::` completion. Tapes are UI-owned seeds in MANUAL and Rust snapshots while a session lives; tape blocks load and save through the codec.

**Tech Stack:** Vite 8 + Svelte 5 runes + TypeScript 6; CodeMirror 6 (`@codemirror/language` StreamLanguage, `@codemirror/lint`, `@codemirror/autocomplete`, `@codemirror/view` gutters/decorations, `@lezer/highlight` tags); wasm-bindgen `web` glue from `mtc-wasm` v0.5.0-rc.2; Vitest (node + happy-dom); Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-136-toolchain-engines-design.md` — read it first; every task below argues from it.

## Global Constraints

- **Toolchains pin**: `v0.5.0-rc.2`; file hashes exactly as in the spec's `toolchains-wasm.json` block (`mtc_wasm_bg.wasm` `ffe72ee9…25a73`, `mtc_wasm.js` `c26e045c…978f2`, `mtc_wasm.d.ts` `4c484021…2d2b0b4`, `manifest.json` `9b1e2039…890e42`).
- **`typescript` stays `^6`** (svelte-check cannot run TS 7 — `CLAUDE.md (Dependency notes)`).
- **`MachineView.svelte` and the JS engines' worker protocol are not modified.** The only JS-page-adjacent edits are the widened `Engine` union, `Editor.svelte`'s new optional props, `Toolbar.svelte`'s optional Format / file-menu props, `TapesStack.svelte`'s optional actions snippet, and `Landing.svelte`'s engine narrowing.
- **Trailing wasm arguments are required-but-nullable**: always `Toolchain.build(lang, code, undefined)`, `Toolchain.check(lang, code, undefined)`, `program.session(seeds, limits)` with explicit `undefined` — never omit (`docs/wasm.md`, the toolchains).
- **`pump` budgets are finite and ≥ 1.**
- **Published text is forge-agnostic** (README, `docs/execution-model.md`, code comments): no issue numbers, no provider URLs. Code comments cite `docs/wasm.md (…)` of the toolchains or `docs/execution-model.md (toolchain engines)`, never spec sections.
- **No literal fallbacks in CSS `var()`**; every color / length token comes from `app.css` or another token.
- **Selector convention**: buttons via accessible names; non-button DOM via `data-testid`.
- **Scenario IDs**: node / helper tests cite `T-…`, component tests `C-…`, e2e `E-tc-…`; each `it()` cites one.
- **Commits**: the user's global instructions forbid `git commit` without explicit permission. Each task ends with a commit step; the executor stops there and asks unless the user has pre-authorised commits for this plan. No Claude attribution in commit messages.
- **Git workflow**: branch from freshly pulled `master`; before pushing, `git fetch origin master && git rebase origin/master`.

## Shared interfaces (referenced by every task)

`src/lib/toolchain/types.ts` — defined in Task 2, used everywhere after:

```ts
import type { ToolchainEngine } from '../types.ts';
import type {
  Diagnostic, Lang, Outcome, RunResult, RunStats, Seed, SourceFile,
  TapeBlockTapeInput, TapeLayout, TapeSnapshot, TrapInfo,
} from '$mtc';
export type {
  Diagnostic, Lang, Outcome, RunResult, RunStats, Seed, SourceFile,
  TapeBlockTapeInput, TapeLayout, TapeSnapshot, TrapInfo,
};

export type BufferKind = 'source' | 'asm';
export type Arch = 'pm' | 'tm';
export const TOOLCHAIN_ARCH: Record<ToolchainEngine, Arch> = { pm1: 'pm', tm1: 'tm' };
export function langFor(engine: ToolchainEngine, kind: BufferKind): Lang;   // 'pmc' | 'pma' | 'tmc' | 'tma'
export function kindOfLang(lang: Lang): BufferKind;                           // *c → source, *a → asm
export type SourceTab = 'main' | 'std';

export type AddrLoc = { addr: number; file: SourceFile; line: number | null; fn: string };
/** `userLineToAddr[n]` / `stdLineToAddr[n]` are indexed by 1-based line; index 0 is always null. */
export type LineMap = { addrToLoc: AddrLoc[]; userLineToAddr: (number | null)[]; stdLineToAddr: (number | null)[] };

/** Sparse seed tape: absolute position → alphabet index; blank (index 0) everywhere else. */
export type SeedTape = { cells: Map<number, number>; head: number };
/** Author-facing seed in glyphs (examples, persistence). */
export type ExampleSeed = { cells: string[]; head?: number; origin?: number };

export type DriveMode = 'step' | 'auto' | 'continuous';
export type PauseCause = 'step' | 'brk' | 'manual' | { breakpoint: number } | { trap: string };

export type ToolchainRequest =
  | { type: 'build'; lang: Lang; code: string }
  | { type: 'stdlib'; lang: Lang }
  | { type: 'check'; lang: Lang; code: string }
  | { type: 'format'; lang: Lang; code: string }
  | { type: 'disassemble' }
  | { type: 'decodeTapeBlock'; bytes: Uint8Array }
  | { type: 'encodeTapeBlock'; tapes: TapeBlockTapeInput[] }
  | { type: 'start'; seeds: Seed[]; limits: { maxSteps?: number }; breakpoints: number[]; mode: DriveMode; intervalMs?: number }
  | { type: 'resume'; mode: DriveMode; intervalMs?: number }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'setBreakpoints'; addrs: number[] }
  | { type: 'setDebug'; on: boolean };

export type BuiltResponse =
  | { type: 'built'; ok: true; tapes: TapeLayout[]; diagnostics: Diagnostic[]; lineMap: LineMap }
  | { type: 'built'; ok: false; diagnostics: Diagnostic[] };
export type FormattedResponse =
  | { type: 'formatted'; ok: true; text: string }
  | { type: 'formatted'; ok: false; error: Diagnostic };
export type SteppedResponse = { type: 'stepped'; snapshots: TapeSnapshot[]; ip: number; stats: RunStats; retired: boolean };
export type ProgressResponse = { type: 'progress'; snapshots: TapeSnapshot[]; steps: number; ip: number };
export type PausedResponse = { type: 'paused'; cause: PauseCause; ip: number; snapshots: TapeSnapshot[]; stats: RunStats };
export type FinishedResponse = { type: 'finished'; result: RunResult; snapshots: TapeSnapshot[] };
export type ErrorResponse = { type: 'error'; message: string; fatal?: boolean };

export type ToolchainResponse =
  | BuiltResponse
  | { type: 'stdlibText'; text: string }
  | { type: 'checked'; diagnostics: Diagnostic[] }
  | FormattedResponse
  | { type: 'disassembled'; text: string }
  | { type: 'tapeBlockSeeds'; seeds: Seed[] }
  | { type: 'tapeBlockBytes'; bytes: Uint8Array }
  | SteppedResponse | ProgressResponse | PausedResponse | FinishedResponse
  | { type: 'idle' } | { type: 'busy' }
  | ErrorResponse;
```

Run-channel vs simple-channel: `stepped` / `progress` / `paused` / `finished` / `idle` / `busy` belong to the run channel; every other response answers exactly one simple request. `error` rejects the simple pending if one exists, else the run pending, else it is uncorrelated. `error.fatal` marks a dead module (a `WebAssembly.RuntimeError` — the `panic = "abort"` trap).

---
### Task 0: Branch and spec commit

**Files:**
- Commit: `docs/superpowers/specs/2026-09-02-136-toolchain-engines-design.md` (already written, uncommitted)

- [ ] **Step 1: Sync master and branch**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo status --porcelain   # expect only the spec (untracked)
git stash push -u -m "136 spec" -- docs/superpowers/specs/2026-09-02-136-toolchain-engines-design.md
git checkout master && git pull --ff-only origin master
git checkout -b feat/136-toolchain-engines
git stash pop
```

- [ ] **Step 2: Commit the spec** (ask the user first — see Global Constraints)

```bash
git add docs/superpowers/specs/2026-09-02-136-toolchain-engines-design.md
git commit -m "docs(spec): toolchain engines (PM-1 / TM-1) over the machine-toolchains wasm bundle"
```

---

### Task 1: Bundle pipeline — pin file, fetch script, vendor dir, aliases

**Files:**
- Create: `toolchains-wasm.json`
- Create: `scripts/fetch-toolchains-wasm.mjs`
- Create: `scripts/fetch-toolchains-wasm.test.mjs`
- Create: `src/lib/toolchain/testModule.ts` (node-side loader for tests)
- Create: `src/lib/toolchain/module.test.ts`
- Modify: `.gitignore`, `package.json` (scripts, deps), `tsconfig.json` (paths, include), `vite.config.ts` (alias), `vitest.config.ts` (alias), `eslint.config.mjs` (ignores)

**Interfaces:**
- Produces: `vendor/mtc-wasm/{mtc_wasm_bg.wasm,mtc_wasm.js,mtc_wasm.d.ts,manifest.json}`; module alias `$mtc`; `loadMtcForTests(): Promise<typeof import('$mtc')>` in `testModule.ts` (initialises the module from bytes once per process and returns the glue namespace).

- [ ] **Step 1: Write the pin file**

`toolchains-wasm.json`:

```json
{
  "tag": "v0.5.0-rc.2",
  "files": {
    "mtc_wasm_bg.wasm": "ffe72ee93a31f273685393b067225a2e2dbdb6172f1372bf1385b8e74de25a73",
    "mtc_wasm.js": "c26e045c796496d708dfd09f1247d3e848227c7c02799ee5dee61efd8ed978f2",
    "mtc_wasm.d.ts": "4c4840214894fb69c5097aed2dc2d2f0c679aa798735382f04c3917aa2d2b0b4",
    "manifest.json": "9b1e20397754ab63f755dae0f1f51efc943937ae419b2255c37326120c890e42"
  }
}
```

- [ ] **Step 2: Write the failing script test**

`scripts/fetch-toolchains-wasm.test.mjs` (plain `node --test`, no vitest — the script is build tooling):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fetchBundle } from './fetch-toolchains-wasm.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Builds a tarball with the bundle's file names and returns { tarPath, hashes }. */
function makeFixture(dir, corrupt = false) {
  const inner = join(dir, 'machine-toolchains-wasm-v9.9.9');
  mkdirSync(inner, { recursive: true });
  const files = {
    'mtc_wasm_bg.wasm': Buffer.from('\0asm-fake'),
    'mtc_wasm.js': Buffer.from('export default async function init() {}\n'),
    'mtc_wasm.d.ts': Buffer.from('export {};\n'),
  };
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(inner, name), buf);
  const manifest = { toolchains_version: '9.9.9', files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha(b)])) };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(inner, 'manifest.json'), manifestBuf);
  const hashes = { ...manifest.files, 'manifest.json': sha(manifestBuf) };
  if (corrupt) hashes['mtc_wasm.js'] = '0'.repeat(64);
  const tarPath = join(dir, 'machine-toolchains-wasm-v9.9.9.tar.gz');
  execFileSync('tar', ['czf', tarPath, '-C', dir, 'machine-toolchains-wasm-v9.9.9']);
  return { tarPath, hashes };
}

function serve(tarPath) {
  let hits = 0;
  const server = createServer((req, res) => { hits++; res.writeHead(200); res.end(readFileSync(tarPath)); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/bundle.tar.gz`, hits: () => hits, close: () => server.close() });
  }));
}

test('T-fetch-good: verified download lands the four files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  const log = [];
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: (m) => log.push(m) });
  assert.ok(existsSync(join(out, 'mtc_wasm.js')));
  assert.ok(existsSync(join(out, 'manifest.json')));
  assert.equal(srv.hits(), 1);
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-corrupt: a hash mismatch fails naming the file and leaves no vendor dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir, true);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  await assert.rejects(
    fetchBundle({ url: srv.url, files: hashes, outDir: out, log: () => {} }),
    /mtc_wasm\.js/,
  );
  assert.ok(!existsSync(join(out, 'mtc_wasm.js')));
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-noop: a verified cache makes no network request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: () => {} });
  const log = [];
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: (m) => log.push(m) });
  assert.equal(srv.hits(), 1);
  assert.ok(log.some((m) => /already verified/.test(m)));
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-override: MTC_WASM_DIR copies without hashing and warns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { hashes } = makeFixture(dir);
  const src = join(dir, 'machine-toolchains-wasm-v9.9.9');
  writeFileSync(join(src, 'mtc_wasm.js'), 'export default 1;\n'); // now differs from the pinned hash
  const out = join(dir, 'vendor');
  const log = [];
  await fetchBundle({ url: 'http://127.0.0.1:1/unused', files: hashes, outDir: out, overrideDir: src, log: (m) => log.push(m) });
  assert.equal(readFileSync(join(out, 'mtc_wasm.js'), 'utf8'), 'export default 1;\n');
  assert.ok(log.some((m) => /WARNING/.test(m)));
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test scripts/fetch-toolchains-wasm.test.mjs`
Expected: FAIL — `Cannot find module './fetch-toolchains-wasm.mjs'`.

- [ ] **Step 4: Write the script**

`scripts/fetch-toolchains-wasm.mjs`:

```js
#!/usr/bin/env node
// Fetches the machine-toolchains wasm bundle pinned in toolchains-wasm.json
// into vendor/mtc-wasm/, verifying every file's SHA-256 against the pin.
// No-op when the cached directory already verifies. MTC_WASM_DIR=<dir>
// copies an unpacked local bundle instead (no hash check; warns).
//
//   node scripts/fetch-toolchains-wasm.mjs          # used by `postinstall`
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'mellonis/machine-toolchains';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const VENDOR_DIR = join(ROOT, 'vendor', 'mtc-wasm');
export const PIN_PATH = join(ROOT, 'toolchains-wasm.json');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Returns the first file name whose hash differs, or null when all verify. */
function firstMismatch(dir, files) {
  for (const [name, expected] of Object.entries(files)) {
    const p = join(dir, name);
    if (!existsSync(p)) return name;
    if (sha256(p) !== expected) return name;
  }
  return null;
}

export function releaseUrl(tag) {
  return `https://github.com/${REPO}/releases/download/${tag}/machine-toolchains-wasm-${tag}.tar.gz`;
}

/**
 * @param {{ url: string, files: Record<string,string>, outDir: string, overrideDir?: string, log: (m: string) => void }} opts
 */
export async function fetchBundle({ url, files, outDir, overrideDir, log }) {
  if (overrideDir) {
    log(`WARNING: MTC_WASM_DIR=${overrideDir} — copying an unverified local bundle (hashes not checked)`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const name of Object.keys(files)) cpSync(join(overrideDir, name), join(outDir, name));
    return;
  }
  if (existsSync(outDir) && firstMismatch(outDir, files) === null) {
    log(`toolchains wasm bundle already verified in ${outDir}`);
    return;
  }
  log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  const tmp = mkdtempSync(join(tmpdir(), 'mtc-wasm-'));
  try {
    const tar = join(tmp, 'bundle.tar.gz');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['xzf', tar, '-C', tmp]);
    // The tarball unpacks to one directory; find the one holding manifest.json.
    const unpacked = readdirSync(tmp)
      .map((n) => join(tmp, n))
      .find((p) => statSync(p).isDirectory() && existsSync(join(p, 'manifest.json')));
    if (!unpacked) throw new Error('tarball holds no directory with manifest.json');
    const bad = firstMismatch(unpacked, files);
    if (bad !== null) throw new Error(`checksum mismatch for ${bad} — the pin in toolchains-wasm.json does not match the downloaded bundle`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(dirname(outDir), { recursive: true });
    cpSync(unpacked, outDir, { recursive: true });
    for (const name of Object.keys(files)) log(`verified ${name}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));
  fetchBundle({
    url: releaseUrl(pin.tag),
    files: pin.files,
    outDir: VENDOR_DIR,
    overrideDir: process.env.MTC_WASM_DIR || undefined,
    log: (m) => console.log(`[fetch-toolchains-wasm] ${m}`),
  }).catch((err) => { console.error(`[fetch-toolchains-wasm] ${err.message}`); process.exit(1); });
}
```

- [ ] **Step 5: Run the script test**

Run: `node --test scripts/fetch-toolchains-wasm.test.mjs`
Expected: 4 passing.

- [ ] **Step 6: Wire it in — gitignore, postinstall, aliases, lint ignore**

`.gitignore` — append:

```
vendor/
```

`package.json` — add to `scripts` and `devDependencies`:

```json
"scripts": {
  "postinstall": "node scripts/fetch-toolchains-wasm.mjs",
  "fetch:wasm": "node scripts/fetch-toolchains-wasm.mjs",
  "test:scripts": "node --test scripts/*.test.mjs",
  ...existing
}
```

Run `npm install @lezer/highlight@^1` (needed by Task 6's tokenizers; declared now so the alias/lint wiring is one commit) and `npm run fetch:wasm` once; confirm `vendor/mtc-wasm/manifest.json` exists.

`tsconfig.json` — add inside `compilerOptions`:

```json
"baseUrl": ".",
"paths": { "$mtc": ["vendor/mtc-wasm/mtc_wasm.js"] }
```

and extend `include` with `"vendor/mtc-wasm/*.d.ts"`.

`vite.config.ts` — add after the imports and before `defineConfig`:

```ts
import { fileURLToPath } from 'node:url';
const MTC_GLUE = fileURLToPath(new URL('./vendor/mtc-wasm/mtc_wasm.js', import.meta.url));
```

and inside `defineConfig({ … })`:

```ts
resolve: { alias: { $mtc: MTC_GLUE } },
```

`vitest.config.ts` — same alias under `resolve` (keep `conditions: ['browser']`):

```ts
import { fileURLToPath } from 'node:url';
const MTC_GLUE = fileURLToPath(new URL('./vendor/mtc-wasm/mtc_wasm.js', import.meta.url));
// …
resolve: { conditions: ['browser'], alias: { $mtc: MTC_GLUE } },
```

`eslint.config.mjs` — `ignores: ['dist', 'node_modules', '.svelte-kit', 'coverage', 'vendor']`.

- [ ] **Step 7: Node-side test loader and a module-loads test**

`src/lib/toolchain/testModule.ts`:

```ts
// Test-only: initialises the vendored wasm module from bytes under Node, once
// per process, the way the toolchains' own smoke script does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as glue from '$mtc';

let ready: Promise<typeof glue> | null = null;

export function loadMtcForTests(): Promise<typeof glue> {
  if (!ready) {
    const wasmPath = fileURLToPath(new URL('../../../vendor/mtc-wasm/mtc_wasm_bg.wasm', import.meta.url));
    ready = glue.default({ module_or_path: readFileSync(wasmPath) }).then(() => glue);
  }
  return ready;
}
```

`src/lib/toolchain/module.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadMtcForTests } from './testModule.ts';

describe('mtc-wasm module', () => {
  it('T-module-loads: the vendored bundle initialises and builds a one-line program', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', 'main() {\n  1: mark(!);\n}\n', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.program.tapes()).toEqual([{ name: 'tape', glyphs: [' ', '*'] }]);
      r.program.free();
    }
  });
});
```

- [ ] **Step 8: Run check, lint, and the new test**

Run: `npm run check && npm run lint && npx vitest run src/lib/toolchain/module.test.ts`
Expected: check clean (the `$mtc` path resolves to the vendored `.d.ts`), lint clean, 1 passing.

- [ ] **Step 9: Commit**

```bash
git add toolchains-wasm.json scripts/fetch-toolchains-wasm.mjs scripts/fetch-toolchains-wasm.test.mjs .gitignore package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts eslint.config.mjs src/lib/toolchain/testModule.ts src/lib/toolchain/module.test.ts
git commit -m "build: pin and fetch the machine-toolchains wasm bundle into vendor/mtc-wasm"
```

---
### Task 2: Engine ids and the toolchain protocol types

**Files:**
- Modify: `src/lib/types.ts:8-9` (ENGINES / Engine)
- Modify: `src/lib/routing.ts:12-16` (`readEngineFromLandingQuery`)
- Modify: `src/components/Landing.svelte:6-8,87,101`
- Create: `src/lib/toolchain/types.ts`
- Create: `src/lib/toolchain/types.test.ts`

**Interfaces:**
- Produces (in `src/lib/types.ts`): `ENGINES`, `Engine`, `JS_ENGINES`, `JsEngine`, `TOOLCHAIN_ENGINES`, `ToolchainEngine`, `isToolchainEngine(e): e is ToolchainEngine`, `isJsEngine(e): e is JsEngine`.
- Produces (in `src/lib/toolchain/types.ts`): everything in **Shared interfaces** above, plus `langFor`, `kindOfLang`, `TOOLCHAIN_ARCH`, `extOf(lang) = lang` (the file extension equals the language name).

- [ ] **Step 1: Write the failing test**

`src/lib/toolchain/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ENGINES, isJsEngine, isToolchainEngine } from '../types.ts';
import { readEngineFromLandingQuery, readRouteFromUrl } from '../routing.ts';
import { kindOfLang, langFor, TOOLCHAIN_ARCH } from './types.ts';

describe('toolchain engine ids', () => {
  it('T-engines-four: ENGINES lists the two JS engines then the two toolchain engines', () => {
    expect(ENGINES).toEqual(['turing', 'post', 'pm1', 'tm1']);
    expect(isToolchainEngine('pm1')).toBe(true);
    expect(isToolchainEngine('turing')).toBe(false);
    expect(isJsEngine('post')).toBe(true);
    expect(isJsEngine('tm1')).toBe(false);
  });

  it('T-engines-route: /pm1 and /tm1 are engine routes', () => {
    expect(readRouteFromUrl('/pm1')).toEqual({ kind: 'engine', engine: 'pm1' });
    expect(readRouteFromUrl('/tm1')).toEqual({ kind: 'engine', engine: 'tm1' });
  });

  it('T-engines-landing-query: the landing query only knows the JS engines this round', () => {
    expect(readEngineFromLandingQuery('?engine=post')).toBe('post');
    expect(readEngineFromLandingQuery('?engine=pm1')).toBe('turing');
  });

  it('T-lang-for: arch × kind gives the four languages', () => {
    expect(TOOLCHAIN_ARCH).toEqual({ pm1: 'pm', tm1: 'tm' });
    expect(langFor('pm1', 'source')).toBe('pmc');
    expect(langFor('pm1', 'asm')).toBe('pma');
    expect(langFor('tm1', 'source')).toBe('tmc');
    expect(langFor('tm1', 'asm')).toBe('tma');
    expect(kindOfLang('tmc')).toBe('source');
    expect(kindOfLang('pma')).toBe('asm');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/toolchain/types.test.ts`
Expected: FAIL — `ENGINES` has two entries; `./types.ts` missing.

- [ ] **Step 3: Widen the engine union**

`src/lib/types.ts` — replace lines 8–9 with:

```ts
export const JS_ENGINES = ['turing', 'post'] as const;
export type JsEngine = (typeof JS_ENGINES)[number];
export const TOOLCHAIN_ENGINES = ['pm1', 'tm1'] as const;
export type ToolchainEngine = (typeof TOOLCHAIN_ENGINES)[number];
export const ENGINES = [...JS_ENGINES, ...TOOLCHAIN_ENGINES] as const;
export type Engine = (typeof ENGINES)[number];

export function isToolchainEngine(e: Engine): e is ToolchainEngine {
  return (TOOLCHAIN_ENGINES as readonly string[]).includes(e);
}
export function isJsEngine(e: Engine): e is JsEngine {
  return (JS_ENGINES as readonly string[]).includes(e);
}
```

`src/lib/routing.ts` — change `readEngineFromLandingQuery` to return `JsEngine` and test against `JS_ENGINES`:

```ts
import { ENGINES, JS_ENGINES, type Engine, type JsEngine, type Route } from './types';
// …
export function readEngineFromLandingQuery(search: string): JsEngine {
  const params = new URLSearchParams(search);
  const raw = params.get('engine');
  return (JS_ENGINES as readonly string[]).includes(raw ?? '') ? (raw as JsEngine) : 'turing';
}
```

`src/components/Landing.svelte` — `import type { JsEngine } from '../lib/types';` (replacing the `Engine` import), `let engine = $state<JsEngine>('turing');`, and `function setEngine(next: JsEngine)`. `snippets[engine]` then type-checks against the `virtual:snippets` declaration unchanged.

- [ ] **Step 4: Write the protocol types**

`src/lib/toolchain/types.ts` — the **Shared interfaces** block verbatim, plus:

```ts
export function langFor(engine: ToolchainEngine, kind: BufferKind): Lang {
  return `${TOOLCHAIN_ARCH[engine]}${kind === 'source' ? 'c' : 'a'}` as Lang;
}
export function kindOfLang(lang: Lang): BufferKind {
  return lang.endsWith('c') ? 'source' : 'asm';
}
/** File extension for a buffer of `lang` — the language name is the extension. */
export function extOf(lang: Lang): string {
  return lang;
}
```

- [ ] **Step 5: Run tests, check, lint**

Run: `npx vitest run src/lib/toolchain/types.test.ts && npm run check && npm run lint && npm test`
Expected: all green — the JS engines' suites are untouched by the widened union.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/routing.ts src/components/Landing.svelte src/lib/toolchain/types.ts src/lib/toolchain/types.test.ts
git commit -m "feat(toolchain): pm1 / tm1 engine ids and the worker protocol types"
```

---
### Task 3: Pure helpers — seeds, snapshots, line map, stdlib index

**Files:**
- Create: `src/lib/toolchain/toolchainHelpers.ts`
- Create: `src/lib/toolchain/toolchainHelpers.test.ts`
- Create: `src/lib/caretColors.ts`

**Interfaces:**
- Consumes: `SeedTape`, `ExampleSeed`, `Seed`, `TapeSnapshot`, `TapeLayout`, `LineMap`, `AddrLoc`, `Lang` from `./types.ts`; `Program` type from `$mtc`; `Command` from `../types.ts`; `turing.Tape` / `turing.Alphabet` from `@turing-machine-js/machine`.
- Produces (all exported from `toolchainHelpers.ts`):
  - `glyphIndex(glyphs: readonly string[], glyph: string): number` — throws `Error("unknown glyph 'x' …")`.
  - `seedFromGlyphs(glyphs, seed: ExampleSeed): SeedTape`, `seedToGlyphs(glyphs, seed: SeedTape): ExampleSeed`.
  - `seedToWasm(seed: SeedTape): Seed`, `seedFromSnapshot(snap: TapeSnapshot): SeedTape`, `emptySeed(): SeedTape`.
  - `applyCommand(seed: SeedTape, glyphs, cmd: Command): SeedTape` (pure; new object).
  - `seedToLibTape(seed, glyphs, viewportWidth): turing.Tape`, `snapshotToLibTape(snap, viewportWidth): turing.Tape`.
  - `headDelta(prevHead: number, nextHead: number): -1 | 0 | 1`, `cellAt(snap: TapeSnapshot, pos: number): number`, `seedCellAt(seed, pos): number`.
  - `buildLineMap(program: Program, userLines: number, stdLines: number): LineMap` — exact mapping from `listing()` + `lineOf`; a line owns an address only if some instruction's `lineOf` names it (comments and declarations map to null).
  - `layoutsEqual(a: TapeLayout[], b: TapeLayout[]): boolean`.
  - `type StdExport = { name: string; kind: 'function' | 'routine' | 'graph' | 'alphabet'; line: number; detail: string; doc: string | null }`, `indexStdExports(lang: Lang, text: string): StdExport[]`, `findStdDefinition(exports: StdExport[], name: string): StdExport | undefined`.
- `src/lib/caretColors.ts` exports `CARET_COLORS` (the same five hex strings `MachineView.svelte` declares; `MachineView` keeps its own copy — do not edit it).

- [ ] **Step 1: Write the failing tests**

`src/lib/toolchain/toolchainHelpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VIEWPORT_WIDTH } from '../caps.ts';
import { loadMtcForTests } from './testModule.ts';
import {
  applyCommand, buildLineMap, cellAt, findStdDefinition, glyphIndex, headDelta, indexStdExports,
  layoutsEqual, seedFromGlyphs, seedFromSnapshot, seedToGlyphs, seedToLibTape, seedToWasm, snapshotToLibTape,
} from './toolchainHelpers.ts';
import type { SeedTape, TapeSnapshot } from './types.ts';

const PM = [' ', '*'];
const PMC_INC = 'main() {\n    1: right(2);\n    2: check(1, 3);\n    3: mark(4);\n    4: left(5);\n    5: check(4, 6);\n    6: right(!);\n}\n';
const PMC_STD = 'main() {\n    @std::goToEnd();\n    right;\n    mark;\n}\n';

function snap(cells: number[], origin: number, head: number): TapeSnapshot {
  return { band: 0, name: 'tape', glyphs: PM, origin, cells: new Uint8Array(cells), head };
}

describe('seeds', () => {
  it('T-seed-roundtrip: glyphs → SeedTape → glyphs keeps cells, origin and head', () => {
    const seed = seedFromGlyphs(PM, { cells: ['*', '*', ' ', '*'], origin: 3, head: 4 });
    expect([...seed.cells.entries()]).toEqual([[3, 1], [4, 1], [6, 1]]);
    expect(seed.head).toBe(4);
    expect(seedToGlyphs(PM, seed)).toEqual({ cells: ['*', '*', ' ', '*'], origin: 3, head: 4 });
  });

  it('T-seed-unknown-glyph: an unknown glyph throws naming it', () => {
    expect(() => seedFromGlyphs(PM, { cells: ['x'] })).toThrow(/unknown glyph 'x'/);
  });

  it('T-seed-dense: SeedTape → wasm Seed is dense from the lowest to the highest cell with absolute origin and head', () => {
    const seed: SeedTape = { cells: new Map([[5, 1], [7, 1]]), head: 6 };
    expect(seedToWasm(seed)).toEqual({ cells: [1, 0, 1], origin: 5, head: 6 });
    expect(seedToWasm({ cells: new Map(), head: 2 })).toEqual({ cells: [], origin: 2, head: 2 });
  });

  it('T-seed-from-snapshot: blanks are dropped, head kept', () => {
    const seed = seedFromSnapshot(snap([1, 0, 1], 5, 6));
    expect([...seed.cells.entries()]).toEqual([[5, 1], [7, 1]]);
    expect(seed.head).toBe(6);
  });

  it('T-seed-apply: Apply writes the symbol then moves the head; null symbol keeps', () => {
    const s0: SeedTape = { cells: new Map(), head: 0 };
    const s1 = applyCommand(s0, PM, { movement: 'R', symbol: '*' });
    expect([...s1.cells.entries()]).toEqual([[0, 1]]);
    expect(s1.head).toBe(1);
    const s2 = applyCommand(s1, PM, { movement: 'L', symbol: null });
    expect(s2.head).toBe(0);
    const s3 = applyCommand(s2, PM, { movement: 'S', symbol: ' ' });
    expect(s3.cells.size).toBe(0);
    expect(s0.cells.size).toBe(0); // pure
  });
});

describe('rendering', () => {
  it('T-window-center: a seed becomes a library tape whose viewport is VIEWPORT_WIDTH wide with the head in the middle', () => {
    const tape = seedToLibTape({ cells: new Map([[0, 1], [2, 1]]), head: 2 }, PM, VIEWPORT_WIDTH);
    const view = tape.viewport;
    expect(view.length).toBe(VIEWPORT_WIDTH);
    const mid = (VIEWPORT_WIDTH - 1) / 2;
    expect(view[mid]).toBe('*');
    expect(view[mid - 2]).toBe('*');
    expect(view[mid - 1]).toBe(' ');
  });

  it('T-window-empty: an empty seed renders all blanks', () => {
    const tape = seedToLibTape({ cells: new Map(), head: 0 }, PM, VIEWPORT_WIDTH);
    expect(tape.viewport.every((c) => c === ' ')).toBe(true);
  });

  it('T-window-snapshot: a snapshot with the head outside its span still centers the head', () => {
    const tape = snapshotToLibTape(snap([1, 1], 0, 5), VIEWPORT_WIDTH);
    const mid = (VIEWPORT_WIDTH - 1) / 2;
    expect(tape.viewport[mid]).toBe(' ');
    expect(tape.viewport[mid - 5]).toBe('*');
  });

  it('T-delta-clamp: head delta is clamped to one cell', () => {
    expect(headDelta(3, 4)).toBe(1);
    expect(headDelta(3, 3)).toBe(0);
    expect(headDelta(3, 0)).toBe(-1);
    expect(cellAt(snap([1, 0, 1], 5, 5), 7)).toBe(1);
    expect(cellAt(snap([1, 0, 1], 5, 5), 99)).toBe(0);
  });

  it('T-layouts-equal: same bands and glyphs compare equal, anything else not', () => {
    expect(layoutsEqual([{ name: 'a', glyphs: ['_', 'x'] }], [{ name: 'a', glyphs: ['_', 'x'] }])).toBe(true);
    expect(layoutsEqual([{ name: 'a', glyphs: ['_', 'x'] }], [{ name: 'a', glyphs: ['_', 'y'] }])).toBe(false);
    expect(layoutsEqual([{ name: 'a', glyphs: ['_'] }], [])).toBe(false);
  });
});

describe('line map', () => {
  it('T-linemap-inverse: every instruction line of a user program maps to an address whose lineOf is that line', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', PMC_INC, undefined);
    if (!r.ok) throw new Error('build failed');
    const map = buildLineMap(r.program, PMC_INC.split('\n').length, Toolchain.stdlibSource('pmc').split('\n').length);
    for (const line of [2, 3, 4, 5, 6, 7]) {
      const addr = map.userLineToAddr[line];
      expect(addr).not.toBeNull();
      expect(map.addrToLoc.find((l) => l.addr === addr)?.line).toBe(line);
    }
    expect(map.userLineToAddr[0]).toBeNull();
    expect(map.userLineToAddr[1]).toBeNull(); // `main() {` owns no instruction
    expect(map.userLineToAddr[8]).toBeNull(); // `}`
    r.program.free();
  });

  it('T-linemap-std: stdlib addresses resolve to std lines and stdLineToAddr inverts them', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', PMC_STD, undefined);
    if (!r.ok) throw new Error('build failed');
    const std = Toolchain.stdlibSource('pmc');
    const map = buildLineMap(r.program, PMC_STD.split('\n').length, std.split('\n').length);
    const stdLocs = map.addrToLoc.filter((l) => l.file === 'std' && l.line !== null);
    expect(stdLocs.length).toBeGreaterThan(0);
    for (const loc of stdLocs) expect(map.stdLineToAddr[loc.line!]).not.toBeNull();
    expect(map.stdLineToAddr.length).toBe(std.split('\n').length + 1);
    r.program.free();
  });

  it('T-linemap-asm: an assembled program maps physical lines', async () => {
    const { Toolchain } = await loadMtcForTests();
    const PMA = '.func main\nL1:\n        rgt\n        jm      L1\n        wr      1\n        stp\n';
    const r = Toolchain.build('pma', PMA, undefined);
    if (!r.ok) throw new Error('assemble failed');
    const map = buildLineMap(r.program, PMA.split('\n').length, 1);
    expect(map.userLineToAddr[3]).not.toBeNull(); // rgt
    expect(map.userLineToAddr[2]).toBeNull();     // label line
    r.program.free();
  });
});

describe('stdlib index', () => {
  it('T-stddef-all: every `export` in both stdlibs is indexed with its line and detail', async () => {
    const { Toolchain } = await loadMtcForTests();
    const pmc = Toolchain.stdlibSource('pmc');
    const pm = indexStdExports('pmc', pmc);
    expect(pm.map((e) => e.name)).toContain('goToEnd');
    const goToEnd = findStdDefinition(pm, 'goToEnd')!;
    expect(pmc.split('\n')[goToEnd.line - 1]).toMatch(/export goToEnd\(\)/);
    expect(goToEnd.kind).toBe('function');
    expect(goToEnd.detail).toBe('goToEnd()');
    const tmc = Toolchain.stdlibSource('tmc');
    const tm = indexStdExports('tmc', tmc);
    expect(tm.some((e) => e.kind === 'routine')).toBe(true);
    expect(tm.some((e) => e.kind === 'graph')).toBe(true);
    expect(tm.some((e) => e.kind === 'alphabet')).toBe(true);
    // Count check against a plain scan of the text — nothing exported is missed.
    const exportLines = tmc.split('\n').filter((l) => /^\s*export\s+(routine|graph|alphabet)\s+/.test(l)).length;
    expect(tm.length).toBe(exportLines);
    expect(findStdDefinition(tm, 'nope')).toBeUndefined();
  });

  it('T-stdcomp-doc: a preceding `?` doc block becomes the export\'s doc', () => {
    const text = '? Walks right.\n? Stops on blank.\nexport routine goRight(tape t: a writes {}) {\n}\n';
    const [e] = indexStdExports('tmc', text);
    expect(e.doc).toBe('Walks right.\nStops on blank.');
    expect(e.detail).toBe('routine goRight(tape t: a writes {})');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/toolchain/toolchainHelpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

`src/lib/caretColors.ts`:

```ts
/** Per-tape caret palette; length must match MAX_TAPES (lib/caps.ts). Same
 *  five colors as MachineView.svelte's CARET_COLORS. */
export const CARET_COLORS: readonly string[] = ['#6ea8fe', '#ff6b6b', '#5fd068', '#c084fc', '#ffd166'];
```

`src/lib/toolchain/toolchainHelpers.ts`:

```ts
// Pure helpers for the toolchain engines: seed tapes, snapshots, the line
// map, the stdlib export index. No DOM, no worker — every function here is
// exercised under Node against the real wasm module.
import * as turing from '@turing-machine-js/machine';
import type { Program } from '$mtc';
import type { Command } from '../types.ts';
import type { AddrLoc, ExampleSeed, Lang, LineMap, Seed, SeedTape, TapeLayout, TapeSnapshot } from './types.ts';

export function glyphIndex(glyphs: readonly string[], glyph: string): number {
  const i = glyphs.indexOf(glyph);
  if (i === -1) {
    throw new Error(`unknown glyph '${glyph}' (alphabet: ${glyphs.map((g) => `'${g}'`).join(' ')})`);
  }
  return i;
}

export function emptySeed(): SeedTape {
  return { cells: new Map(), head: 0 };
}

export function seedFromGlyphs(glyphs: readonly string[], seed: ExampleSeed): SeedTape {
  const origin = seed.origin ?? 0;
  const cells = new Map<number, number>();
  seed.cells.forEach((g, i) => {
    const ix = glyphIndex(glyphs, g);
    if (ix !== 0) cells.set(origin + i, ix);
  });
  return { cells, head: seed.head ?? 0 };
}

function span(seed: SeedTape): { lo: number; hi: number } | null {
  if (seed.cells.size === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of seed.cells.keys()) {
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  return { lo, hi };
}

export function seedCellAt(seed: SeedTape, pos: number): number {
  return seed.cells.get(pos) ?? 0;
}

export function seedToGlyphs(glyphs: readonly string[], seed: SeedTape): ExampleSeed {
  const s = span(seed);
  if (!s) return { cells: [], origin: seed.head, head: seed.head };
  const cells: string[] = [];
  for (let p = s.lo; p <= s.hi; p++) cells.push(glyphs[seedCellAt(seed, p)]);
  return { cells, origin: s.lo, head: seed.head };
}

export function seedToWasm(seed: SeedTape): Seed {
  const s = span(seed);
  if (!s) return { cells: [], origin: seed.head, head: seed.head };
  const cells: number[] = [];
  for (let p = s.lo; p <= s.hi; p++) cells.push(seedCellAt(seed, p));
  return { cells, origin: s.lo, head: seed.head };
}

export function seedFromSnapshot(snap: TapeSnapshot): SeedTape {
  const cells = new Map<number, number>();
  snap.cells.forEach((v, i) => {
    if (v !== 0) cells.set(snap.origin + i, v);
  });
  return { cells, head: snap.head };
}

export function applyCommand(seed: SeedTape, glyphs: readonly string[], cmd: Command): SeedTape {
  const cells = new Map(seed.cells);
  if (cmd.symbol !== null) {
    const ix = glyphIndex(glyphs, cmd.symbol);
    if (ix === 0) cells.delete(seed.head);
    else cells.set(seed.head, ix);
  }
  const head = seed.head + (cmd.movement === 'L' ? -1 : cmd.movement === 'R' ? 1 : 0);
  return { cells, head };
}

export function cellAt(snap: TapeSnapshot, pos: number): number {
  const i = pos - snap.origin;
  return i >= 0 && i < snap.cells.length ? snap.cells[i] : 0;
}

export function headDelta(prevHead: number, nextHead: number): -1 | 0 | 1 {
  const d = nextHead - prevHead;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** Symbols from `lo` to `hi` inclusive (absolute positions), reading `at`. */
function libTape(
  glyphs: readonly string[],
  lo: number,
  hi: number,
  head: number,
  at: (pos: number) => number,
  viewportWidth: number,
): turing.Tape {
  const start = Math.min(lo, head);
  const end = Math.max(hi, head);
  const symbols: string[] = [];
  for (let p = start; p <= end; p++) symbols.push(glyphs[at(p)]);
  return new turing.Tape({
    alphabet: new turing.Alphabet([...glyphs]),
    symbols,
    position: head - start,
    viewportWidth,
  });
}

export function seedToLibTape(seed: SeedTape, glyphs: readonly string[], viewportWidth: number): turing.Tape {
  const s = span(seed) ?? { lo: seed.head, hi: seed.head };
  return libTape(glyphs, s.lo, s.hi, seed.head, (p) => seedCellAt(seed, p), viewportWidth);
}

export function snapshotToLibTape(snap: TapeSnapshot, viewportWidth: number): turing.Tape {
  const lo = snap.origin;
  const hi = snap.cells.length > 0 ? snap.origin + snap.cells.length - 1 : snap.origin;
  return libTape(snap.glyphs, lo, hi, snap.head, (p) => cellAt(snap, p), viewportWidth);
}

export function layoutsEqual(a: TapeLayout[], b: TapeLayout[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.name === b[i].name && x.glyphs.length === b[i].glyphs.length && x.glyphs.every((g, j) => g === b[i].glyphs[j]));
}

/**
 * Exact line ownership: a line owns an address when some instruction's
 * `lineOf` names it (the lowest such address wins). `addressForLine` is not
 * used here — it snaps unmapped lines forward to the next instruction, which
 * is right for planting a breakpoint from a debugger but wrong for a gutter
 * that must refuse comment and declaration lines.
 */
export function buildLineMap(program: Program, userLines: number, stdLines: number): LineMap {
  const addrToLoc: AddrLoc[] = [];
  const userLineToAddr: (number | null)[] = new Array(userLines + 1).fill(null);
  const stdLineToAddr: (number | null)[] = new Array(stdLines + 1).fill(null);
  for (const row of program.listing()) {
    const loc = program.lineOf(row.addr);
    if (!loc) continue;
    addrToLoc.push({ addr: row.addr, file: loc.file, line: loc.line, fn: loc.function });
    if (loc.line === null) continue;
    const table = loc.file === 'std' ? stdLineToAddr : userLineToAddr;
    if (loc.line < table.length && table[loc.line] === null) table[loc.line] = row.addr;
  }
  return { addrToLoc, userLineToAddr, stdLineToAddr };
}

export type StdExport = {
  name: string;
  kind: 'function' | 'routine' | 'graph' | 'alphabet';
  /** 1-based line of the declaration in `stdlibSource(lang)`. */
  line: number;
  /** The declaration, trimmed, without `export` and without the trailing `{`. */
  detail: string;
  /** Preceding contiguous `?` doc lines (`.tmc`) or `//` lines (`.pmc`), joined; null when none. */
  doc: string | null;
};

const PMC_EXPORT = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{?/;
const TMC_EXPORT = /^\s*export\s+(routine|graph|alphabet)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/;

function docAbove(lines: string[], i: number, marker: RegExp): string | null {
  const out: string[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const m = marker.exec(lines[j]);
    if (!m) break;
    out.unshift(m[1].trim());
  }
  return out.length > 0 ? out.join('\n') : null;
}

export function indexStdExports(lang: Lang, text: string): StdExport[] {
  const lines = text.split('\n');
  const out: StdExport[] = [];
  const isPm = lang === 'pmc' || lang === 'pma';
  lines.forEach((raw, i) => {
    if (isPm) {
      const m = PMC_EXPORT.exec(raw);
      if (!m) return;
      out.push({ name: m[1], kind: 'function', line: i + 1, detail: `${m[1]}()`, doc: docAbove(lines, i, /^\s*\/\/\s?(.*)$/) });
    } else {
      const m = TMC_EXPORT.exec(raw);
      if (!m) return;
      const rest = m[3].replace(/\s*\{\s*$/, '').trimEnd();
      out.push({
        name: m[2],
        kind: m[1] as StdExport['kind'],
        line: i + 1,
        detail: `${m[1]} ${m[2]}${rest}`,
        doc: docAbove(lines, i, /^\s*\?\s?(.*)$/),
      });
    }
  });
  return out;
}

export function findStdDefinition(exports: StdExport[], name: string): StdExport | undefined {
  return exports.find((e) => e.name === name);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/toolchain/toolchainHelpers.test.ts`
Expected: all passing. If `T-window-*` fail on the `turing.Alphabet` constructor rejecting a glyph list, read `node_modules/@turing-machine-js/machine/dist/classes/Alphabet.d.ts` and adapt the call — the constructor takes `string[]`.

- [ ] **Step 5: Lint + check, then commit**

Run: `npm run lint && npm run check`

```bash
git add src/lib/caretColors.ts src/lib/toolchain/toolchainHelpers.ts src/lib/toolchain/toolchainHelpers.test.ts
git commit -m "feat(toolchain): pure helpers for seeds, snapshots, the line map and the stdlib index"
```

---
### Task 4: Worker core — request dispatch and the pump loops

**Files:**
- Modify: `src/lib/caps.ts` (append `TOOLCHAIN_SLICE_BUDGET`)
- Create: `src/lib/toolchain/workerCore.ts`
- Create: `src/lib/toolchain/workerCore.test.ts`
- Create: `src/lib/toolchain/toolchainWorker.ts`

**Interfaces:**
- Consumes: `ToolchainRequest` / `ToolchainResponse` and friends from `./types.ts`; `buildLineMap` from `./toolchainHelpers.ts`; `PROGRESS_INTERVAL_MS`, `TOOLCHAIN_SLICE_BUDGET` from `../caps.ts`; the module namespace type `typeof import('$mtc')`.
- Produces:
  ```ts
  export type MtcModule = Pick<typeof import('$mtc'), 'Toolchain'>;
  export type CoreDeps = {
    post: (r: ToolchainResponse) => void;
    sleep: (ms: number) => Promise<void>;
    yieldTurn: () => Promise<void>;
    now: () => number;
  };
  export class ToolchainCore { constructor(mod: MtcModule, deps: CoreDeps); handle(req: ToolchainRequest): Promise<void>; }
  ```
  `toolchainWorker.ts` is the thin `self.onmessage` shell that inits the module once and forwards to a `ToolchainCore` (Vite `?worker` import in Task 12).

- [ ] **Step 1: Add the slice budget**

Append to `src/lib/caps.ts`:

```ts
/** Instructions retired per `pump` slice in a continuous toolchain run.
 *  Between slices the worker yields to its event loop so `pause` / `stop` /
 *  lint requests are served and a `progress` heartbeat can go out. Sized for
 *  roughly 20–50 ms of work on a mid-range laptop (measured against the
 *  unary power-of-two example at implementation time — see the plan's
 *  calibration step); `docs/execution-model.md (toolchain engines)`. */
export const TOOLCHAIN_SLICE_BUDGET = 20_000;
```

- [ ] **Step 2: Write the failing tests**

`src/lib/toolchain/workerCore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadMtcForTests } from './testModule.ts';
import { ToolchainCore, type CoreDeps } from './workerCore.ts';
import type { ToolchainRequest, ToolchainResponse } from './types.ts';

const PMC_INC = 'main() {\n    1: right(2);\n    2: check(1, 3);\n    3: mark(4);\n    4: left(5);\n    5: check(4, 6);\n    6: right(!);\n}\n';
const PMC_BRK = 'main() {\n    right;\n    debugger;\n    mark;\n}\n';
const TMC_REPLACE_B = "alphabet ab { '_', 'a', 'b' }\n\nmachine {\n  tape main: ab;\n\n  entry state scan {\n    ['b'] -> write ['a'] move [>] goto scan;\n    ['a'] ->             move [>] goto scan;\n    ['_'] -> stop;\n  }\n}\n";

type Harness = { core: ToolchainCore; posted: ToolchainResponse[]; send: (r: ToolchainRequest) => Promise<void>; sleeps: number[] };

async function harness(): Promise<Harness> {
  const mod = await loadMtcForTests();
  const posted: ToolchainResponse[] = [];
  const sleeps: number[] = [];
  const deps: CoreDeps = {
    post: (r) => posted.push(r),
    sleep: async (ms) => { sleeps.push(ms); },
    yieldTurn: async () => {},
    now: () => Date.now(),
  };
  const core = new ToolchainCore(mod, deps);
  return { core, posted, sleeps, send: (r) => core.handle(r) };
}

const last = (h: Harness) => h.posted[h.posted.length - 1];
const ofType = <T extends ToolchainResponse['type']>(h: Harness, t: T) =>
  h.posted.filter((r) => r.type === t) as Extract<ToolchainResponse, { type: T }>[];

describe('build / simple requests', () => {
  it('T-core-build-ok: built carries tapes, warnings and a line map', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = last(h);
    expect(b.type).toBe('built');
    if (b.type === 'built' && b.ok) {
      expect(b.tapes).toEqual([{ name: 'tape', glyphs: [' ', '*'] }]);
      expect(b.lineMap.userLineToAddr[2]).not.toBeNull();
    } else throw new Error('expected ok build');
  });

  it('T-core-build-fatal: a syntax error is built ok:false with one error diagnostic', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() { nope' });
    const b = last(h);
    expect(b.type === 'built' && !b.ok && b.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('T-core-stdlib-check-format: stdlib text, lint channel and format answer', async () => {
    const h = await harness();
    await h.send({ type: 'stdlib', lang: 'tmc' });
    expect(last(h).type).toBe('stdlibText');
    await h.send({ type: 'check', lang: 'pmc', code: 'namespace api {\nhelper() {\n5: right;\n}\n}\nmain() { @api::helper(); }\n' });
    const c = last(h);
    expect(c.type === 'checked' && c.diagnostics.some((d) => d.code === 'unused-label')).toBe(true);
    await h.send({ type: 'format', lang: 'pmc', code: 'main() {  right;   mark; }\n' });
    expect(last(h).type === 'formatted' && (last(h) as { ok: boolean }).ok).toBe(true);
  });

  it('T-core-disassemble-roundtrip: disassembly of a source build assembles to the same bytes', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'disassemble' });
    const d = last(h);
    expect(d.type).toBe('disassembled');
    const mod = await loadMtcForTests();
    const again = mod.Toolchain.build('tma', (d as { text: string }).text, undefined);
    expect(again.ok).toBe(true);
    if (again.ok) again.program.free();
  });

  it('T-core-disassemble-without-build: error, not fatal', async () => {
    const h = await harness();
    await h.send({ type: 'disassemble' });
    expect(last(h)).toEqual({ type: 'error', message: 'disassemble: nothing built yet' });
  });
});

describe('pump loops', () => {
  it('T-pump-step: step mode retires one instruction per start/resume and reports snapshots + ip', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [], mode: 'step' });
    const s1 = ofType(h, 'stepped')[0];
    expect(s1.retired).toBe(true);
    expect(s1.stats.steps).toBe(1);
    await h.send({ type: 'resume', mode: 'step' });
    expect(ofType(h, 'stepped')[1].stats.steps).toBe(2);
  });

  it('T-pump-step-to-finish: stepping past the last instruction posts finished with the final snapshots', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() {\n    mark(!);\n}\n' });
    await h.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'step' });
    for (let i = 0; i < 10 && ofType(h, 'finished').length === 0; i++) await h.send({ type: 'resume', mode: 'step' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(Array.from(f.snapshots[0].cells)).toEqual([1]);
  });

  it('T-pump-continuous-finished: continuous runs to the end and posts finished', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2] }], limits: {}, breakpoints: [], mode: 'continuous' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(Array.from(f.snapshots[0].cells.slice(0, 3))).toEqual([1, 1, 1]);
  });

  it('T-pump-step-limit: maxSteps traps as step-limit inside finished', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2, 2, 2, 2] }], limits: { maxSteps: 2 }, breakpoints: [], mode: 'continuous' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('trapped');
    expect(f.result.outcome.kind === 'trapped' && f.result.outcome.trap.kind).toBe('step-limit');
  });

  it('T-pump-breakpoint: a registered breakpoint pauses before its instruction; the next step retires it', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = ofType(h, 'built')[0];
    const addr = b.ok ? b.lineMap.userLineToAddr[4]! : -1; // `3: mark(4);`
    await h.send({ type: 'setDebug', on: true });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    const p = ofType(h, 'paused')[0];
    expect(p.cause).toEqual({ breakpoint: addr });
    expect(p.ip).toBe(addr);
    await h.send({ type: 'resume', mode: 'step' });
    const s = ofType(h, 'stepped')[0];
    expect(s.retired).toBe(true);
    expect(s.ip).not.toBe(addr);
  });

  it('T-pump-breakpoint-debug-off: with debug off the same run does not pause', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = ofType(h, 'built')[0];
    const addr = b.ok ? b.lineMap.userLineToAddr[4]! : -1;
    await h.send({ type: 'setDebug', on: false });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    expect(ofType(h, 'paused')).toHaveLength(0);
    expect(ofType(h, 'finished')).toHaveLength(1);
  });

  it('T-pump-brk: a retired `debugger` pauses with cause brk when debug is on and is ignored when off', async () => {
    const on = await harness();
    await on.send({ type: 'build', lang: 'pmc', code: PMC_BRK });
    await on.send({ type: 'setDebug', on: true });
    await on.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(on, 'paused')[0]?.cause).toBe('brk');
    const off = await harness();
    await off.send({ type: 'build', lang: 'pmc', code: PMC_BRK });
    await off.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(off, 'paused')).toHaveLength(0);
    expect(ofType(off, 'finished')).toHaveLength(1);
  });

  it('T-pump-manual-pause: pause during an auto run ends the segment with cause manual', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    // sleep is instrumented: request the pause from inside the first sleep.
    let armed = false;
    const origSleep = (h.core as unknown as { deps: CoreDeps }).deps.sleep;
    (h.core as unknown as { deps: CoreDeps }).deps.sleep = async (ms) => {
      await origSleep(ms);
      if (!armed) { armed = true; await h.send({ type: 'pause' }); }
    };
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2, 2, 2, 2, 2, 2] }], limits: {}, breakpoints: [], mode: 'auto', intervalMs: 50 });
    expect(ofType(h, 'paused')[0]?.cause).toBe('manual');
    expect(ofType(h, 'idle').length).toBeGreaterThan(0);
    expect(h.sleeps[0]).toBe(50);
  });

  it('T-pump-stop: stop while paused posts finished { stopped } with snapshots', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [], mode: 'step' });
    await h.send({ type: 'stop' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(f.snapshots).toHaveLength(1);
  });

  it('T-pump-progress: a continuous run posts progress when the gate opens', async () => {
    const h = await harness();
    // now() jumps by a second on every call so the time gate is always open.
    let t = 0;
    (h.core as unknown as { deps: CoreDeps }).deps.now = () => (t += 1000);
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: new Array(60_000).fill(2) }], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(h, 'progress').length).toBeGreaterThan(0);
    expect(ofType(h, 'finished')).toHaveLength(1);
  });

  it('T-pump-std-bp: a breakpoint planted on a stdlib line pauses with the ip in the std file', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() {\n    @std::goToEnd();\n    mark;\n}\n' });
    const b = ofType(h, 'built')[0];
    if (!b.ok) throw new Error('build failed');
    const stdLine = b.lineMap.stdLineToAddr.findIndex((a) => a !== null);
    const addr = b.lineMap.stdLineToAddr[stdLine]!;
    await h.send({ type: 'setDebug', on: true });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1] }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    const p = ofType(h, 'paused')[0];
    expect(p.cause).toEqual({ breakpoint: addr });
    expect(b.lineMap.addrToLoc.find((l) => l.addr === p.ip)?.file).toBe('std');
  });

  it('T-pump-tapeblock: decode → seedsFromTapeBlock and encode round-trip through the core', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'encodeTapeBlock', tapes: [{ cells: [2, 1, 2], head: 0, origin: 0, glyphs: ['_', 'a', 'b'] }] });
    const enc = last(h);
    expect(enc.type).toBe('tapeBlockBytes');
    await h.send({ type: 'decodeTapeBlock', bytes: (enc as { bytes: Uint8Array }).bytes });
    const dec = last(h);
    expect(dec.type === 'tapeBlockSeeds' && Array.from(dec.seeds[0].cells)).toEqual([2, 1, 2]);
    await h.send({ type: 'encodeTapeBlock', tapes: [{ cells: [1], glyphs: ['_', 'x'] }] });
    const bad = last(h);
    expect(bad.type).toBe('tapeBlockBytes'); // encoding is alphabet-agnostic…
    await h.send({ type: 'decodeTapeBlock', bytes: (bad as { bytes: Uint8Array }).bytes });
    expect(last(h).type).toBe('error');      // …mapping onto this program is not
    expect((last(h) as { message: string }).message).toMatch(/`x`/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/toolchain/workerCore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the core**

`src/lib/toolchain/workerCore.ts`:

```ts
// The toolchain worker's brain, kept free of `self` so it runs under Node in
// tests. Owns the wasm Program and at most one Session; drives it with pump
// calls per `docs/execution-model.md (toolchain engines)` and the session
// contract in the toolchains' `docs/wasm.md (sessions)`.
import type { Program, Session } from '$mtc';
import { PROGRESS_INTERVAL_MS, TOOLCHAIN_SLICE_BUDGET } from '../caps.ts';
import { buildLineMap } from './toolchainHelpers.ts';
import type { DriveMode, Lang, PauseCause, ToolchainRequest, ToolchainResponse } from './types.ts';

export type MtcModule = Pick<typeof import('$mtc'), 'Toolchain'>;

export type CoreDeps = {
  post: (r: ToolchainResponse) => void;
  sleep: (ms: number) => Promise<void>;
  /** Lets queued messages run between pump slices. */
  yieldTurn: () => Promise<void>;
  now: () => number;
};

export class ToolchainCore {
  private program: Program | null = null;
  private session: Session | null = null;
  private breakpoints = new Set<number>();
  private registered = new Set<number>();
  private debugOn = false;
  private stopRequested = false;
  private loopActive = false;
  private lastProgressAt = 0;

  constructor(private readonly mod: MtcModule, private readonly deps: CoreDeps) {}

  async handle(req: ToolchainRequest): Promise<void> {
    try {
      switch (req.type) {
        case 'build': return this.build(req.lang, req.code);
        case 'stdlib': return this.deps.post({ type: 'stdlibText', text: this.mod.Toolchain.stdlibSource(req.lang) });
        case 'check': return this.deps.post({ type: 'checked', diagnostics: this.mod.Toolchain.check(req.lang, req.code, undefined) });
        case 'format': {
          const r = this.mod.Toolchain.format(req.lang, req.code);
          return this.deps.post(r.ok ? { type: 'formatted', ok: true, text: r.text } : { type: 'formatted', ok: false, error: r.error });
        }
        case 'disassemble':
          if (!this.program) return this.deps.post({ type: 'error', message: 'disassemble: nothing built yet' });
          return this.deps.post({ type: 'disassembled', text: this.program.disassembly() });
        case 'decodeTapeBlock': {
          if (!this.program) return this.deps.post({ type: 'error', message: 'load tape block: nothing built yet' });
          const block = this.mod.Toolchain.decodeTapeBlock(req.bytes);
          return this.deps.post({ type: 'tapeBlockSeeds', seeds: this.program.seedsFromTapeBlock(block) });
        }
        case 'encodeTapeBlock':
          return this.deps.post({ type: 'tapeBlockBytes', bytes: this.mod.Toolchain.encodeTapeBlock({ tapes: req.tapes }) });
        case 'start': return this.start(req);
        case 'resume': return this.drive(req.mode, req.intervalMs);
        case 'pause':
          this.session?.pause();
          return;
        case 'stop': return this.stop();
        case 'setBreakpoints':
          this.breakpoints = new Set(req.addrs);
          this.syncBreakpoints();
          return;
        case 'setDebug':
          this.debugOn = req.on;
          this.syncBreakpoints();
          return;
      }
    } catch (err) {
      // A Rust panic surfaces as a WebAssembly trap and leaves the module
      // unusable (`docs/wasm.md (failure modes)`); everything else is a
      // documented JsError from the binding.
      const fatal = err instanceof WebAssembly.RuntimeError;
      this.deps.post({ type: 'error', message: err instanceof Error ? err.message : String(err), ...(fatal ? { fatal: true } : {}) });
    }
  }

  private build(lang: Lang, code: string): void {
    this.dropSession();
    if (this.program) { this.program.free(); this.program = null; }
    const r = this.mod.Toolchain.build(lang, code, undefined);
    if (!r.ok) { this.deps.post({ type: 'built', ok: false, diagnostics: r.diagnostics }); return; }
    this.program = r.program;
    const stdLines = this.mod.Toolchain.stdlibSource(lang).split('\n').length;
    const lineMap = buildLineMap(r.program, code.split('\n').length, stdLines);
    this.deps.post({ type: 'built', ok: true, tapes: r.program.tapes(), diagnostics: r.diagnostics, lineMap });
  }

  private start(req: Extract<ToolchainRequest, { type: 'start' }>): Promise<void> {
    if (!this.program) { this.deps.post({ type: 'error', message: 'start: nothing built yet' }); return Promise.resolve(); }
    this.dropSession();
    const limits = req.limits.maxSteps === undefined ? undefined : { maxSteps: req.limits.maxSteps };
    this.session = this.program.session(req.seeds, limits);
    this.registered = new Set();
    this.breakpoints = new Set(req.breakpoints);
    this.stopRequested = false;
    this.lastProgressAt = 0;
    this.syncBreakpoints();
    return this.drive(req.mode, req.intervalMs);
  }

  /** Registers exactly `breakpoints` on the live session when debug is on, none when off. */
  private syncBreakpoints(): void {
    if (!this.session) return;
    const want = this.debugOn ? this.breakpoints : new Set<number>();
    for (const a of this.registered) if (!want.has(a)) this.session.removeBreakpoint(a);
    for (const a of want) if (!this.registered.has(a)) this.session.addBreakpoint(a);
    this.registered = new Set(want);
  }

  private dropSession(): void {
    if (this.session) { try { this.session.free(); } catch { /* already stopped */ } this.session = null; }
    this.loopActive = false;
  }

  private finish(): void {
    const s = this.session!;
    const result = s.finished()!;
    this.deps.post({ type: 'finished', result, snapshots: s.snapshots() });
    this.dropSession();
  }

  private stop(): void {
    if (!this.session) { this.deps.post({ type: 'error', message: 'stop: no run in progress' }); return; }
    if (this.loopActive) { this.stopRequested = true; return; } // the loop finalises after its slice
    this.finishStopped();
  }

  private finishStopped(): void {
    const s = this.session!;
    const snapshots = s.snapshots();
    const ip = s.ip;
    const stack = s.stack();
    const stats = s.stop();
    this.session = null;
    this.loopActive = false;
    this.deps.post({ type: 'finished', result: { outcome: { kind: 'stopped' }, stats, ip, stack }, snapshots });
  }

  /** `brk` is a pause only while debug is on; breakpoints are never registered while it is off. */
  private isPauseHonoured(cause: PauseCause): boolean {
    if (cause === 'brk') return this.debugOn;
    return true;
  }

  private async drive(mode: DriveMode, intervalMs?: number): Promise<void> {
    const s = this.session;
    if (!s) { this.deps.post({ type: 'error', message: 'resume: no run in progress' }); return; }
    if (s.finished()) { this.finish(); return; }
    this.loopActive = true;
    try {
      if (mode === 'step') {
        const ev = s.pump(1);
        if (ev.kind === 'finished') { this.finish(); return; }
        if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
        if (ev.kind === 'paused' && !this.isPauseHonoured(ev.cause)) {
          // An ignored brk retired like a no-op — count it as the step.
          this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired: true });
          return;
        }
        const retired = ev.kind === 'budgetSpent' || (ev.kind === 'paused' && ev.cause === 'brk');
        this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired });
        return;
      }
      for (;;) {
        if (this.stopRequested) { this.finishStopped(); return; }
        const budget = mode === 'auto' ? 1 : TOOLCHAIN_SLICE_BUDGET;
        const ev = s.pump(budget);
        if (ev.kind === 'finished') { this.finish(); return; }
        if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
        if (ev.kind === 'paused') {
          if (this.isPauseHonoured(ev.cause)) {
            this.deps.post({ type: 'paused', cause: ev.cause, ip: s.ip, snapshots: s.snapshots(), stats: s.stats() });
            return;
          }
          // ignored brk: fall through and keep going
        }
        if (mode === 'auto') {
          this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired: true });
          this.deps.post({ type: 'idle' });
          await this.deps.sleep(intervalMs ?? 0);
          this.deps.post({ type: 'busy' });
        } else {
          const t = this.deps.now();
          if (t - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
            this.lastProgressAt = t;
            this.deps.post({ type: 'progress', snapshots: s.snapshots(), steps: s.stats().steps, ip: s.ip });
          }
          await this.deps.yieldTurn();
        }
      }
    } finally {
      this.loopActive = false;
    }
  }
}
```

`src/lib/toolchain/toolchainWorker.ts`:

```ts
// Thin Web Worker shell: initialises the wasm module once, then forwards
// every request to a ToolchainCore. The Vite `?worker` import lives in
// ToolchainView.svelte; this file stays plain TypeScript.
import init, * as mtc from '$mtc';
import { ToolchainCore } from './workerCore.ts';
import type { ToolchainRequest } from './types.ts';

// The glue resolves `mtc_wasm_bg.wasm` relative to itself via
// `new URL(…, import.meta.url)`, which Vite turns into a hashed asset.
const ready: Promise<ToolchainCore> = init().then(
  () =>
    new ToolchainCore(mtc, {
      post: (r) => self.postMessage(r),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      yieldTurn: () => new Promise((resolve) => setTimeout(resolve, 0)),
      now: () => performance.now(),
    }),
);

self.onmessage = (e: MessageEvent<ToolchainRequest>) => {
  void ready.then((core) => core.handle(e.data));
};
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/toolchain/workerCore.test.ts`
Expected: all passing. The `T-pump-manual-pause` case reaches into `deps` — keep `deps` a `readonly` property (not `#private`) so the test can wrap it.

- [ ] **Step 6: Calibrate the slice budget**

Run this one-off under Node (not committed):

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const glue = await import('./vendor/mtc-wasm/mtc_wasm.js');
await glue.default({ module_or_path: readFileSync('vendor/mtc-wasm/mtc_wasm_bg.wasm') });
const src = readFileSync('src/lib/toolchain/examples/pow2.tmc','utf8'); // exists after Task 10; until then paste the pow2 program from the toolchains' docs/examples/pow2/pow2.tmc
const p = glue.Toolchain.build('tmc', src, undefined).program;
const s = p.session([{ cells: [1,2,4,4,4,4,4,4,4,4,4,4,4,4,4,4,3], head: 1 }], undefined);
for (let i=0;i<5;i++){ const t=performance.now(); const ev=s.pump(20000); console.log(ev.kind, (performance.now()-t).toFixed(1),'ms'); if(ev.kind==='finished')break; }
"
```

Adjust `TOOLCHAIN_SLICE_BUDGET` so one slice lands in 20–50 ms and note the measured number in the `caps.ts` comment.

- [ ] **Step 7: Lint, check, commit**

Run: `npm run lint && npm run check`

```bash
git add src/lib/caps.ts src/lib/toolchain/workerCore.ts src/lib/toolchain/workerCore.test.ts src/lib/toolchain/toolchainWorker.ts
git commit -m "feat(toolchain): worker core driving the wasm session — build, lint, format, codec, pump loops"
```

---
### Task 5: Main-thread runner with watchdog, progress stash and panic respawn

**Files:**
- Create: `src/lib/toolchain/toolchainRunner.ts`
- Create: `src/lib/toolchain/toolchainTestUtils.ts` (FakeToolchainWorker)
- Create: `src/lib/toolchain/toolchainRunner.test.ts`

**Interfaces:**
- Consumes: protocol types from `./types.ts`; `getSetting` from `../settings.ts`.
- Produces:
  ```ts
  export interface ToolchainWorkerLike {
    postMessage(msg: ToolchainRequest): void; terminate(): void;
    onmessage: ((e: MessageEvent<ToolchainResponse>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
  }
  export type ToolchainWorkerFactory = () => ToolchainWorkerLike;
  export class ToolchainWorkerError extends Error { readonly fatal: boolean }
  export class ToolchainTimeoutError extends ToolchainWorkerError { readonly progress: ProgressResponse | null }
  export type RunHandlers = { onStepped?: (r: SteppedResponse) => void; onPaused?: (r: PausedResponse) => void; onProgress?: (r: ProgressResponse) => void };
  export class ToolchainRunner {
    constructor(factory: ToolchainWorkerFactory);
    onUncorrelatedError: ((message: string) => void) | null;
    onFatal: ((message: string) => void) | null;       // module died; worker terminated; next request respawns
    get lastProgress(): ProgressResponse | null;
    get runPending(): boolean;
    build(lang: Lang, code: string): Promise<BuiltResponse>;
    stdlib(lang: Lang): Promise<string>;
    check(lang: Lang, code: string): Promise<Diagnostic[]>;
    format(lang: Lang, code: string): Promise<FormattedResponse>;
    disassemble(): Promise<string>;
    decodeTapeBlock(bytes: Uint8Array): Promise<Seed[]>;
    encodeTapeBlock(tapes: TapeBlockTapeInput[]): Promise<Uint8Array>;
    start(req: Omit<Extract<ToolchainRequest, { type: 'start' }>, 'type' | 'limits'> & { limits?: { maxSteps?: number } }, handlers?: RunHandlers): Promise<FinishedResponse>;
    resume(mode: DriveMode, intervalMs?: number): void;
    pause(): void; stop(): void; setBreakpoints(addrs: number[]): void; setDebug(on: boolean): void;
    terminate(): void;
  }
  ```
  `start` fills `limits.maxSteps` from `getSetting('maxSteps')` when the caller omits it (Infinity → omitted). The worker is spawned lazily on the first request and kept across builds; it is respawned only after `terminate()`, a watchdog kill, or a fatal error.

- [ ] **Step 1: Write the fake worker**

`src/lib/toolchain/toolchainTestUtils.ts`:

```ts
import type { ToolchainWorkerFactory, ToolchainWorkerLike } from './toolchainRunner.ts';
import type { ToolchainRequest, ToolchainResponse } from './types.ts';

export class FakeToolchainWorker implements ToolchainWorkerLike {
  postedMessages: ToolchainRequest[] = [];
  onmessage: ((e: MessageEvent<ToolchainResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(msg: ToolchainRequest): void {
    if (this.terminated) throw new Error('postMessage on terminated worker');
    this.postedMessages.push(msg);
  }
  terminate(): void { this.terminated = true; }
  respond(data: ToolchainResponse): void {
    if (!this.onmessage) throw new Error('respond() before onmessage set');
    this.onmessage({ data } as MessageEvent<ToolchainResponse>);
  }
  get last(): ToolchainRequest | undefined { return this.postedMessages[this.postedMessages.length - 1]; }
}

export function makeFakeToolchainFactory(): { factory: ToolchainWorkerFactory; current: () => FakeToolchainWorker; all: () => FakeToolchainWorker[] } {
  const fakes: FakeToolchainWorker[] = [];
  return {
    factory: () => { const f = new FakeToolchainWorker(); fakes.push(f); return f; },
    current: () => { const l = fakes[fakes.length - 1]; if (!l) throw new Error('factory not yet called'); return l; },
    all: () => fakes.slice(),
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/toolchain/toolchainRunner.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolchainRunner, ToolchainTimeoutError, ToolchainWorkerError } from './toolchainRunner.ts';
import { makeFakeToolchainFactory } from './toolchainTestUtils.ts';
import { setSetting } from '../settings.ts';
import type { FinishedResponse, TapeSnapshot } from './types.ts';

const snap = (cells: number[], head = 0): TapeSnapshot => ({ band: 0, name: 'tape', glyphs: [' ', '*'], origin: 0, cells: new Uint8Array(cells), head });
const finished = (cells: number[]): FinishedResponse => ({
  type: 'finished',
  result: { outcome: { kind: 'stopped' }, stats: { steps: 1, coreTacts: 1, stallTacts: 0, totalTacts: 1 }, ip: 0, stack: [] },
  snapshots: [snap(cells)],
});

describe('ToolchainRunner', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('T-runner-build: build posts the request and resolves on built', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const p = r.build('pmc', 'main() {}');
    expect(current().last).toEqual({ type: 'build', lang: 'pmc', code: 'main() {}' });
    current().respond({ type: 'built', ok: false, diagnostics: [] });
    await expect(p).resolves.toEqual({ type: 'built', ok: false, diagnostics: [] });
  });

  it('T-runner-worker-kept: a second build reuses the same worker (no module re-init)', async () => {
    const { factory, current, all } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const p1 = r.build('pmc', 'a'); current().respond({ type: 'built', ok: false, diagnostics: [] }); await p1;
    const p2 = r.build('pmc', 'b'); current().respond({ type: 'built', ok: false, diagnostics: [] }); await p2;
    expect(all()).toHaveLength(1);
  });

  it('T-runner-simple-during-run: check is answered while a run is pending', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    const chk = r.check('pmc', 'x');
    current().respond({ type: 'checked', diagnostics: [] });
    await expect(chk).resolves.toEqual([]);
    current().respond(finished([1]));
    await expect(run).resolves.toMatchObject({ type: 'finished' });
  });

  it('T-runner-maxsteps-from-settings: start fills limits from the setting; Infinity omits it', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' });
    expect(current().last).toMatchObject({ type: 'start', limits: { maxSteps: 100_000 } });
    current().respond(finished([]));
    setSetting('maxSteps', Infinity);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' });
    expect(current().last).toMatchObject({ type: 'start', limits: {} });
  });

  it('T-runner-timer-suspend-on-paused: the watchdog stops on paused and restarts on resume', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    current().respond({ type: 'paused', cause: 'manual', ip: 0, snapshots: [], stats: { steps: 0, coreTacts: 0, stallTacts: 0, totalTacts: 0 } });
    vi.advanceTimersByTime(60_000);
    expect(current().terminated).toBe(false);
    r.resume('continuous');
    vi.advanceTimersByTime(5_000);
    expect(current().terminated).toBe(true);
    await expect(run).rejects.toBeInstanceOf(ToolchainTimeoutError);
  });

  it('T-runner-idle-busy: idle stops the watchdog, busy restarts it', () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'auto', intervalMs: 30_000 }).catch(() => {});
    current().respond({ type: 'idle' });
    vi.advanceTimersByTime(30_000);
    expect(current().terminated).toBe(false);
    current().respond({ type: 'busy' });
    vi.advanceTimersByTime(5_000);
    expect(current().terminated).toBe(true);
  });

  it('T-runner-progress-stash: lastProgress survives a timeout kill and rides on the error', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    current().respond({ type: 'progress', snapshots: [snap([1, 1])], steps: 7, ip: 3 });
    vi.advanceTimersByTime(5_000);
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(ToolchainTimeoutError);
    expect((err as ToolchainTimeoutError).progress?.steps).toBe(7);
    expect(r.lastProgress?.steps).toBe(7);
  });

  it('T-runner-error-routes: error rejects the simple pending first, then the run, else uncorrelated', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const seen: string[] = [];
    r.onUncorrelatedError = (m) => seen.push(m);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    const chk = r.check('pmc', 'x');
    current().respond({ type: 'error', message: 'lint boom' });
    await expect(chk).rejects.toBeInstanceOf(ToolchainWorkerError);
    current().respond({ type: 'error', message: 'run boom' });
    await expect(run).rejects.toThrow('run boom');
    current().respond({ type: 'error', message: 'stray' });
    expect(seen).toEqual(['stray']);
  });

  it('T-runner-fatal-respawn: a fatal error terminates the worker, calls onFatal, and the next request spawns a new one', async () => {
    const { factory, current, all } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const fatal: string[] = [];
    r.onFatal = (m) => fatal.push(m);
    const p = r.build('pmc', 'x');
    current().respond({ type: 'error', message: 'unreachable', fatal: true });
    await expect(p).rejects.toMatchObject({ fatal: true });
    expect(all()[0].terminated).toBe(true);
    expect(fatal).toEqual(['unreachable']);
    void r.build('pmc', 'y');
    expect(all()).toHaveLength(2);
  });

  it('T-runner-handlers: stepped / paused / progress reach their handlers; finished resolves', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const onStepped = vi.fn(); const onPaused = vi.fn(); const onProgress = vi.fn();
    const run = r.start({ seeds: [], breakpoints: [], mode: 'auto', intervalMs: 100 }, { onStepped, onPaused, onProgress });
    current().respond({ type: 'stepped', snapshots: [], ip: 1, stats: { steps: 1, coreTacts: 0, stallTacts: 0, totalTacts: 0 }, retired: true });
    current().respond({ type: 'progress', snapshots: [], steps: 1, ip: 1 });
    current().respond({ type: 'paused', cause: 'brk', ip: 2, snapshots: [], stats: { steps: 2, coreTacts: 0, stallTacts: 0, totalTacts: 0 } });
    expect(onStepped).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onPaused).toHaveBeenCalledTimes(1);
    r.resume('step');
    expect(current().last).toEqual({ type: 'resume', mode: 'step', intervalMs: undefined });
    current().respond(finished([]));
    await expect(run).resolves.toMatchObject({ type: 'finished' });
    expect(r.runPending).toBe(false);
  });

  it('T-runner-reject-overlap: a second start while one is pending throws', () => {
    const { factory } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' }).catch(() => {});
    expect(() => r.start({ seeds: [], breakpoints: [], mode: 'step' })).toThrow(/pending/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/toolchain/toolchainRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the runner**

`src/lib/toolchain/toolchainRunner.ts`:

```ts
// Main-thread wrapper for the toolchain worker. Same shape as
// lib/machineRunner.ts (injected worker factory, per-segment watchdog read
// from settings at each segment start, progress stash kept across terminate)
// with two differences: one simple request may be pending alongside a run
// (lint and format are served between pump slices), and the worker is kept
// across builds because module init is the expensive part. A fatal error
// (`docs/wasm.md (failure modes)`) kills the worker; the next request respawns.
import { getSetting } from '../settings.ts';
import type {
  BuiltResponse, Diagnostic, DriveMode, FinishedResponse, FormattedResponse, Lang, PausedResponse,
  ProgressResponse, Seed, SteppedResponse, TapeBlockTapeInput, ToolchainRequest, ToolchainResponse,
} from './types.ts';

export class ToolchainWorkerError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal = false) { super(message); this.name = 'ToolchainWorkerError'; this.fatal = fatal; }
}

export class ToolchainTimeoutError extends ToolchainWorkerError {
  readonly progress: ProgressResponse | null;
  constructor(message: string, progress: ProgressResponse | null) { super(message); this.name = 'ToolchainTimeoutError'; this.progress = progress; }
}

export interface ToolchainWorkerLike {
  postMessage(msg: ToolchainRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<ToolchainResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}
export type ToolchainWorkerFactory = () => ToolchainWorkerLike;

export type RunHandlers = {
  onStepped?: (r: SteppedResponse) => void;
  onPaused?: (r: PausedResponse) => void;
  onProgress?: (r: ProgressResponse) => void;
};

type SimplePending = { resolve: (r: ToolchainResponse) => void; reject: (e: Error) => void; timeoutId: ReturnType<typeof setTimeout> };
type RunPending = { resolve: (r: FinishedResponse) => void; reject: (e: Error) => void; timeoutId: ReturnType<typeof setTimeout> | null; handlers: RunHandlers };

const RUN_CHANNEL = new Set(['stepped', 'progress', 'paused', 'finished', 'idle', 'busy']);

export type StartOptions = Omit<Extract<ToolchainRequest, { type: 'start' }>, 'type' | 'limits'> & { limits?: { maxSteps?: number } };

export class ToolchainRunner {
  private worker: ToolchainWorkerLike | null = null;
  private simple: SimplePending | null = null;
  private run: RunPending | null = null;
  private lastRunProgress: ProgressResponse | null = null;
  onUncorrelatedError: ((message: string) => void) | null = null;
  onFatal: ((message: string) => void) | null = null;

  constructor(private readonly factory: ToolchainWorkerFactory) {}

  get lastProgress(): ProgressResponse | null { return this.lastRunProgress; }
  get runPending(): boolean { return this.run !== null; }

  private ensureWorker(): ToolchainWorkerLike {
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.killAll(new ToolchainWorkerError(`worker error: ${e.message ?? 'unknown'}`, true));
    }
    return this.worker;
  }

  private killAll(err: Error): void {
    if (this.simple) { clearTimeout(this.simple.timeoutId); this.simple.reject(err); this.simple = null; }
    if (this.run) { if (this.run.timeoutId) clearTimeout(this.run.timeoutId); this.run.reject(err); this.run = null; }
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  private startRunTimer(): void {
    if (!this.run) return;
    if (this.run.timeoutId) clearTimeout(this.run.timeoutId);
    const timeoutMs = getSetting('workerTimeoutMs');
    this.run.timeoutId = setTimeout(() => {
      const p = this.run;
      this.run = null;
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      p?.reject(new ToolchainTimeoutError(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`, this.lastRunProgress));
    }, timeoutMs);
  }

  private stopRunTimer(): void {
    if (this.run?.timeoutId) { clearTimeout(this.run.timeoutId); this.run.timeoutId = null; }
  }

  private onMessage(data: ToolchainResponse): void {
    if (data.type === 'error') {
      const err = new ToolchainWorkerError(data.message, data.fatal === true);
      if (err.fatal) { this.onFatal?.(data.message); this.killAll(err); return; }
      if (this.simple) { const p = this.simple; this.simple = null; clearTimeout(p.timeoutId); p.reject(err); return; }
      if (this.run) { const p = this.run; this.run = null; if (p.timeoutId) clearTimeout(p.timeoutId); p.reject(err); return; }
      this.onUncorrelatedError?.(data.message);
      return;
    }
    if (RUN_CHANNEL.has(data.type)) {
      const p = this.run;
      if (!p) return;
      switch (data.type) {
        case 'stepped': this.stopRunTimer(); p.handlers.onStepped?.(data); return;
        case 'paused': this.stopRunTimer(); p.handlers.onPaused?.(data); return;
        case 'progress': this.lastRunProgress = data; p.handlers.onProgress?.(data); return;
        case 'idle': this.stopRunTimer(); return;
        case 'busy': this.startRunTimer(); return;
        case 'finished':
          this.run = null;
          this.lastRunProgress = null;
          if (p.timeoutId) clearTimeout(p.timeoutId);
          p.resolve(data);
          return;
      }
    }
    if (this.simple) { const p = this.simple; this.simple = null; clearTimeout(p.timeoutId); p.resolve(data); }
  }

  private sendSimple(msg: ToolchainRequest): Promise<ToolchainResponse> {
    if (this.simple) throw new Error('previous request still pending');
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const timeoutMs = getSetting('workerTimeoutMs');
      const timeoutId = setTimeout(() => {
        this.simple = null;
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        reject(new ToolchainTimeoutError(`timeout after ${timeoutMs}ms — worker terminated`, null));
      }, timeoutMs);
      this.simple = { resolve, reject, timeoutId };
      w.postMessage(msg);
    });
  }

  private async expect<T extends ToolchainResponse['type']>(msg: ToolchainRequest, type: T): Promise<Extract<ToolchainResponse, { type: T }>> {
    const r = await this.sendSimple(msg);
    if (r.type !== type) throw new Error(`unexpected response: ${r.type}`);
    return r as Extract<ToolchainResponse, { type: T }>;
  }

  build(lang: Lang, code: string): Promise<BuiltResponse> { return this.expect({ type: 'build', lang, code }, 'built'); }
  async stdlib(lang: Lang): Promise<string> { return (await this.expect({ type: 'stdlib', lang }, 'stdlibText')).text; }
  async check(lang: Lang, code: string): Promise<Diagnostic[]> { return (await this.expect({ type: 'check', lang, code }, 'checked')).diagnostics; }
  format(lang: Lang, code: string): Promise<FormattedResponse> { return this.expect({ type: 'format', lang, code }, 'formatted'); }
  async disassemble(): Promise<string> { return (await this.expect({ type: 'disassemble' }, 'disassembled')).text; }
  async decodeTapeBlock(bytes: Uint8Array): Promise<Seed[]> { return (await this.expect({ type: 'decodeTapeBlock', bytes }, 'tapeBlockSeeds')).seeds; }
  async encodeTapeBlock(tapes: TapeBlockTapeInput[]): Promise<Uint8Array> { return (await this.expect({ type: 'encodeTapeBlock', tapes }, 'tapeBlockBytes')).bytes; }

  start(opts: StartOptions, handlers: RunHandlers = {}): Promise<FinishedResponse> {
    if (this.run) throw new Error('previous run still pending');
    const w = this.ensureWorker();
    const maxSteps = opts.limits?.maxSteps ?? getSetting('maxSteps');
    const limits = Number.isFinite(maxSteps) ? { maxSteps } : {};
    this.lastRunProgress = null;
    return new Promise((resolve, reject) => {
      this.run = { resolve, reject, timeoutId: null, handlers };
      this.startRunTimer();
      w.postMessage({ type: 'start', seeds: opts.seeds, limits, breakpoints: opts.breakpoints, mode: opts.mode, intervalMs: opts.intervalMs });
    });
  }

  resume(mode: DriveMode, intervalMs?: number): void {
    if (!this.run || !this.worker) throw new Error('resume: no pending run');
    this.startRunTimer();
    this.worker.postMessage({ type: 'resume', mode, intervalMs });
  }

  pause(): void { if (this.run && this.worker) this.worker.postMessage({ type: 'pause' }); }
  stop(): void { if (this.run && this.worker) { this.startRunTimer(); this.worker.postMessage({ type: 'stop' }); } }
  setBreakpoints(addrs: number[]): void { this.worker?.postMessage({ type: 'setBreakpoints', addrs }); }
  setDebug(on: boolean): void { this.worker?.postMessage({ type: 'setDebug', on }); }

  terminate(): void { this.killAll(new ToolchainWorkerError('runner terminated')); }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/toolchain/toolchainRunner.test.ts`
Expected: all passing.

- [ ] **Step 6: Lint, check, commit**

```bash
npm run lint && npm run check
git add src/lib/toolchain/toolchainRunner.ts src/lib/toolchain/toolchainTestUtils.ts src/lib/toolchain/toolchainRunner.test.ts
git commit -m "feat(toolchain): main-thread runner — watchdog per segment, progress stash, fatal respawn"
```

---
### Task 6: CodeMirror stream modes for pmc / tmc / pma / tma

**Files:**
- Create: `src/lib/toolchain/lang/tokens.ts`, `pmc.ts`, `tmc.ts`, `pma.ts`, `tma.ts`, `index.ts`
- Create: `src/lib/toolchain/lang/lang.test.ts`

**Interfaces:**
- Consumes: `StreamLanguage`, `StreamParser`, `StringStream`, `LanguageSupport` from `@codemirror/language`; `tags` from `@lezer/highlight`; `Lang` from `../types.ts`.
- Produces: `pmcParser` / `tmcParser` / `pmaParser` / `tmaParser` (`StreamParser<State>`), `toolchainLanguage(lang: Lang): LanguageSupport` (memoised per lang), `tokenizeLine(parser, line): Array<[text, style | null]>` (test helper, exported from `index.ts`).

Token style names are resolved through one `tokenTable` (`tokens.ts`) so the four modes share a palette: `kw` keyword, `cmt` comment, `doc` docComment, `num` number, `glyph` string, `op` operator, `label` labelName, `fn` function name, `ns` namespace, `type` typeName, `directive` processingInstruction, `wild` atom, `sym` variableName, `move` operator.

- [ ] **Step 1: Write the failing tests**

`src/lib/toolchain/lang/lang.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pmaParser, pmcParser, tmaParser, tmcParser, tokenizeLine, toolchainLanguage } from './index.ts';

const styles = (parser: Parameters<typeof tokenizeLine>[0], line: string) =>
  tokenizeLine(parser, line).filter(([, s]) => s !== null).map(([t, s]) => `${s}:${t}`);

describe('pmc', () => {
  it('T-lang-pmc-call: keywords, labels, calls, namespaces and the return bang', () => {
    expect(styles(pmcParser, '    1: @std::goToEnd(!);')).toEqual(['label:1:', 'fn:@std::goToEnd', 'op:!']);
    expect(styles(pmcParser, 'use std::goToEnd, std::goToBegin;')).toEqual(['kw:use', 'ns:std::', 'sym:goToEnd', 'ns:std::', 'sym:goToBegin']);
    expect(styles(pmcParser, 'export helper() {')).toEqual(['kw:export', 'fn:helper']);
    expect(styles(pmcParser, '    check(1, 3);')).toEqual(['kw:check', 'num:1', 'num:3']);
  });
  it('T-lang-pmc-comments: line and block comments, block spanning lines', () => {
    expect(styles(pmcParser, 'mark; // to the end')).toEqual(['kw:mark', 'cmt:// to the end']);
    const state = pmcParser.startState!(2);
    expect(tokenizeLine(pmcParser, '/* open', state).map(([, s]) => s)).toEqual(['cmt']);
    expect(tokenizeLine(pmcParser, 'still */ right;', state).map(([, s]) => s)).toEqual(['cmt', null, 'kw', null]);
  });
});

describe('tmc', () => {
  it('T-lang-tmc-rule: glyphs, rule arrow, wildcard, moves, keywords', () => {
    expect(styles(tmcParser, "    ['0'..'1' as c, *] -> write [-, {c}] move [>, >] goto copy;")).toEqual([
      'glyph:\'0\'', 'op:..', 'glyph:\'1\'', 'kw:as', 'sym:c', 'wild:*', 'op:->', 'kw:write', 'move:-', 'sym:c', 'kw:move', 'move:>', 'move:>', 'kw:goto', 'sym:copy',
    ]);
  });
  it('T-lang-tmc-decl: declaring keywords color the introduced name as a type', () => {
    expect(styles(tmcParser, "alphabet bits { '_', '0', '1' }")).toEqual(['kw:alphabet', 'type:bits', 'glyph:\'_\'', 'glyph:\'0\'', 'glyph:\'1\'']);
    expect(styles(tmcParser, '  entry state inc {')).toEqual(['kw:entry', 'kw:state', 'type:inc']);
    expect(styles(tmcParser, '? Corrected 2^n (unary)')).toEqual(['doc:? Corrected 2^n (unary)']);
    expect(styles(tmcParser, '! [deprecated] use foo')).toEqual(['cmt:! [deprecated] use foo']);
  });
});

describe('pma', () => {
  it('T-lang-pma: directives, labels, mnemonics, numbers, symbols, comments', () => {
    expect(styles(pmaParser, '.func main local')).toEqual(['directive:.func', 'fn:main', 'kw:local']);
    expect(styles(pmaParser, 'L1:     rgt')).toEqual(['label:L1:', 'kw:rgt']);
    expect(styles(pmaParser, '        jm      L1 ; loop')).toEqual(['kw:jm', 'sym:L1', 'cmt:; loop']);
    expect(styles(pmaParser, '        call    std::goToEnd')).toEqual(['kw:call', 'fn:std::goToEnd']);
    expect(styles(pmaParser, '        wr      1')).toEqual(['kw:wr', 'num:1']);
    expect(styles(pmaParser, '        .byte   -3 @sym.x')).toEqual(['directive:.byte', 'num:-3', 'sym:@sym.x']);
  });
});

describe('tma', () => {
  it('T-lang-tma: sections, tables, interpolation, hex, operators', () => {
    expect(styles(tmaParser, '.section text')).toEqual(['directive:.section', 'type:text']);
    expect(styles(tmaParser, '.rept v = 0x10')).toEqual(['directive:.rept', 'sym:v', 'op:=', 'num:0x10']);
    expect(styles(tmaParser, '        .row [*, {v}, *] -> Linc{v}')).toEqual(['directive:.row', 'wild:*', 'op:{v}', 'wild:*', 'op:->', 'sym:Linc', 'op:{v}']);
    expect(styles(tmaParser, '        call.m  std::goToNumber #2')).toEqual(['kw:call.m', 'fn:std::goToNumber', 'op:#', 'num:2']);
  });
});

describe('LanguageSupport', () => {
  it('T-lang-support: each language builds a LanguageSupport once', () => {
    expect(toolchainLanguage('pmc')).toBe(toolchainLanguage('pmc'));
    expect(toolchainLanguage('tma').language.name).toBe('tma');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/toolchain/lang/lang.test.ts` — FAIL, module not found.

- [ ] **Step 3: Write the modes**

`src/lib/toolchain/lang/tokens.ts`:

```ts
import { tags, type Tag } from '@lezer/highlight';

/** One palette for the four stream modes. Keys are the style names the
 *  tokenizers return; values are the highlight tags One Dark / the default
 *  light style already color. */
export const tokenTable: Record<string, Tag> = {
  kw: tags.keyword,
  cmt: tags.comment,
  doc: tags.docComment,
  num: tags.number,
  glyph: tags.string,
  op: tags.operator,
  move: tags.operator,
  label: tags.labelName,
  fn: tags.function(tags.variableName),
  ns: tags.namespace,
  type: tags.typeName,
  directive: tags.processingInstruction,
  wild: tags.atom,
  sym: tags.variableName,
};

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
export const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+/;
```

`src/lib/toolchain/lang/pmc.ts` (ported from the toolchains' `editors/grammars/pmc.tmLanguage.json`):

```ts
// PM-1 `.pmc` source. Ported from the toolchains' editors/grammars/pmc.tmLanguage.json
// (keywords, commands, `@calls`, definitions, numeric labels, `::`, `!`).
import type { StreamParser, StringStream } from '@codemirror/language';
import { IDENT, tokenTable } from './tokens.ts';

export type CState = { inBlock: boolean; lineStart: boolean };

const KEYWORDS = /^(?:use|namespace|volatile|export|as|goto|check|halt|left|right|mark|unmark|debugger)\b/;

function blockComment(stream: StringStream, state: CState): string {
  if (stream.skipTo('*/')) { stream.match('*/'); state.inBlock = false; } else stream.skipToEnd();
  return 'cmt';
}

export const pmcParser: StreamParser<CState> = {
  name: 'pmc',
  startState: () => ({ inBlock: false, lineStart: true }),
  tokenTable,
  token(stream, state) {
    if (state.inBlock) return blockComment(stream, state);
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match('/*')) { state.inBlock = true; return blockComment(stream, state); }
    const atStatementStart = state.lineStart;
    state.lineStart = false;
    if (atStatementStart && stream.match(/^\d+\s*:/)) return 'label';
    if (stream.match(/^@\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*/)) return 'fn';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*::/)) return 'ns';
    if (stream.match(KEYWORDS)) return 'kw';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?=\s*\(\s*\)\s*\{)/)) return 'fn';
    if (stream.match(IDENT)) return 'sym';
    if (stream.match(/^\d+/)) return 'num';
    if (stream.match('!')) return 'op';
    if (stream.match(/^[;,{}():]/)) { if (stream.current() === ';' || stream.current() === '{' || stream.current() === '}') state.lineStart = true; return null; }
    stream.next();
    return null;
  },
};
```

`src/lib/toolchain/lang/tmc.ts` (ported from `tmc.tmLanguage.json`):

```ts
// TM-1 `.tmc` source. Ported from the toolchains' editors/grammars/tmc.tmLanguage.json.
import type { StreamParser, StringStream } from '@codemirror/language';
import { IDENT, tokenTable } from './tokens.ts';
import type { CState } from './pmc.ts';

const KEYWORDS = /^(?:alphabet|machine|tape|state|routine|graph|namespace|export|entry|volatile|use|as|goto|call|then|return|stop|halt|graft|bind|write|move|map|with|debugger|writes|preserves)\b/;
const DECLARING = /^(?:alphabet|routine|graph|namespace|state)\b/;

type TState = CState & { expectName: boolean };

function blockComment(stream: StringStream, state: TState): string {
  if (stream.skipTo('*/')) { stream.match('*/'); state.inBlock = false; } else stream.skipToEnd();
  return 'cmt';
}

export const tmcParser: StreamParser<TState> = {
  name: 'tmc',
  startState: () => ({ inBlock: false, lineStart: true, expectName: false }),
  tokenTable,
  token(stream, state) {
    if (state.inBlock) return blockComment(stream, state);
    if (stream.sol()) {
      state.lineStart = true;
      if (stream.match(/^[ \t]*\?.*$/)) return 'doc';
      if (stream.match(/^[ \t]*!.*$/)) return 'cmt';
    }
    if (stream.eatSpace()) return null;
    state.lineStart = false;
    if (stream.match('//')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match('/*')) { state.inBlock = true; return blockComment(stream, state); }
    if (state.expectName && stream.match(IDENT)) { state.expectName = false; return 'type'; }
    state.expectName = false;
    if (stream.match(/^'(?:\\.|[^'\\])*'/)) return 'glyph';
    if (stream.match(/^\{[^}\n]*\}/)) {
      // `{c}` / `{v+1}` interpolation: color the inner identifier as a symbol when it is one.
      const inner = stream.current().slice(1, -1);
      return IDENT.test(inner) && !/\W/.test(inner) ? 'sym' : 'op';
    }
    if (stream.match(/^(?:->|=>|\.\.|=)/)) return 'op';
    if (stream.match(/^\*(?![A-Za-z0-9_])/)) return 'wild';
    if (stream.match(/^(?:<|>|\.|-)(?=\s*[,\]])/)) return 'move';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*::/)) return 'ns';
    if (stream.match(DECLARING)) { state.expectName = true; return 'kw'; }
    if (stream.match(KEYWORDS)) return 'kw';
    if (stream.match(IDENT)) return 'sym';
    if (stream.match(/^\d+/)) return 'num';
    stream.next();
    return null;
  },
};
```

`src/lib/toolchain/lang/pma.ts` (ported from `pma.tmLanguage.json`):

```ts
// PM-1 `.pma` assembly. Ported from the toolchains' editors/grammars/pma.tmLanguage.json;
// the mnemonic alternation is longest-first so `jm.s` is never shadowed by `jm`.
import type { StreamParser } from '@codemirror/language';
import { QUALIFIED, IDENT, tokenTable } from './tokens.ts';

const MNEMONICS = /^(?:call\.s|jmp\.s|jnm\.s|call|jm\.s|nop|stp|hlt|lft|rgt|jmp|jnm|ret|ent|brk|wrl|wrr|wr|jm)\b/;

type AState = { afterFunc: boolean };

export const pmaParser: StreamParser<AState> = {
  name: 'pma',
  startState: () => ({ afterFunc: false }),
  tokenTable,
  token(stream, state) {
    if (stream.sol()) {
      state.afterFunc = false;
      if (stream.match(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*:/)) return 'label';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(';')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match(/^\.func\b/)) { state.afterFunc = true; return 'directive'; }
    if (stream.match(/^\.(?:byte|volatile)\b/)) return 'directive';
    if (state.afterFunc) {
      if (stream.match(/^local\b/)) return 'kw';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_.:]*/)) return 'fn';
    }
    if (stream.match(MNEMONICS)) return 'kw';
    if (stream.match(QUALIFIED)) return 'fn';
    if (stream.match(/^@[A-Za-z_][\w.:]*/)) return 'sym';
    if (stream.match(/^-?\d+/)) return 'num';
    if (stream.match(IDENT)) return 'sym';
    stream.next();
    return null;
  },
};
```

`src/lib/toolchain/lang/tma.ts` (ported from `tma.tmLanguage.json`):

```ts
// TM-1 `.tma` assembly. Ported from the toolchains' editors/grammars/tma.tmLanguage.json.
import type { StreamParser } from '@codemirror/language';
import { QUALIFIED, IDENT, tokenTable } from './tokens.ts';

const MNEMONICS = /^(?:call\.m|call\.s|wrmv|djmp|retx|trap|call|jmp|jnm|brk|ent|hlt|mov|mtc|nop|ret|stp|rd|jm|wr)\b/;

type AState = { after: 'func' | 'section' | null };

export const tmaParser: StreamParser<AState> = {
  name: 'tma',
  startState: () => ({ after: null }),
  tokenTable,
  token(stream, state) {
    if (stream.sol()) {
      state.after = null;
      if (stream.match(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*:/)) return 'label';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(';')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match(/^\.section\b/)) { state.after = 'section'; return 'directive'; }
    if (stream.match(/^\.(?:func|routine)\b/)) { state.after = 'func'; return 'directive'; }
    if (stream.match(/^\.(?:rept|endr|row|targets|target|frame|map|exits|byte)\b/)) return 'directive';
    if (state.after === 'section' && stream.match(IDENT)) { state.after = null; return 'type'; }
    if (state.after === 'func') {
      if (stream.match(/^local\b/)) return 'kw';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_.:]*/)) { state.after = null; return 'fn'; }
    }
    if (stream.match(/^\{[^}\n]*\}/)) return 'op';
    if (stream.match(/^(?:->|=>|#|=)/)) return 'op';
    if (stream.match(/^\*(?![A-Za-z0-9_])/)) return 'wild';
    if (stream.match(/^[<>](?![A-Za-z0-9_=])/)) return 'move';
    if (stream.match(MNEMONICS)) return 'kw';
    if (stream.match(QUALIFIED)) return 'fn';
    if (stream.match(/^@[A-Za-z_][\w.:]*/)) return 'sym';
    if (stream.match(/^-?(?:0x[0-9A-Fa-f]+|\d+)\b/)) return 'num';
    if (stream.match(IDENT)) return 'sym';
    stream.next();
    return null;
  },
};
```

`src/lib/toolchain/lang/index.ts`:

```ts
import { LanguageSupport, StreamLanguage, StringStream, type StreamParser } from '@codemirror/language';
import type { Lang } from '../types.ts';
import { pmaParser } from './pma.ts';
import { pmcParser } from './pmc.ts';
import { tmaParser } from './tma.ts';
import { tmcParser } from './tmc.ts';

export { pmaParser, pmcParser, tmaParser, tmcParser };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PARSERS: Record<Lang, StreamParser<any>> = { pmc: pmcParser, tmc: tmcParser, pma: pmaParser, tma: tmaParser };
const cache = new Map<Lang, LanguageSupport>();

export function toolchainLanguage(lang: Lang): LanguageSupport {
  let s = cache.get(lang);
  if (!s) { s = new LanguageSupport(StreamLanguage.define(PARSERS[lang])); cache.set(lang, s); }
  return s;
}

/** Test helper: tokenizes one line, returning `[text, style]` pairs. Pass the
 *  same `state` across calls to carry block-comment state between lines. */
export function tokenizeLine<S>(parser: StreamParser<S>, line: string, state: S = parser.startState!(2)): Array<[string, string | null]> {
  const stream = new StringStream(line, 2, 2);
  const out: Array<[string, string | null]> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = parser.token(stream, state);
    if (stream.pos === stream.start) stream.next();
    out.push([stream.current(), style]);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and iterate on token boundaries**

Run: `npx vitest run src/lib/toolchain/lang/lang.test.ts`
Expected: all passing. The expectations above are the contract; adjust the regexes, not the tests, when a case fails (e.g. `state.lineStart` bookkeeping for labels after `;`).

- [ ] **Step 5: Lint, check, commit**

```bash
npm run lint && npm run check
git add src/lib/toolchain/lang
git commit -m "feat(toolchain): CodeMirror stream modes for pmc, tmc, pma and tma"
```

---
### Task 7: Editor generalisation, toolchain lint source, `std::` completion, go-to-definition link

**Files:**
- Modify: `src/components/Editor.svelte`
- Create: `src/lib/toolchain/editor/lint.ts`, `stdCompletion.ts`, `stdLink.ts`
- Create: `src/lib/toolchain/editor/lint.test.ts`, `stdCompletion.test.ts`, `stdLink.test.ts`

**Interfaces:**
- `Editor.svelte` props (new, all optional): `lang?: Lang` (toolchain engines only — selects the stream mode; ignored for JS engines), `extensions?: Extension[]` (appended after the built-in set), `readOnly?: boolean` (no persistence, no reset button, no diagnostics counter, `EditorState.readOnly` + `EditorView.editable(false)`), `onReady?: (view: EditorView) => void` (passthrough of the wrapper's `onready`).
- `lint.ts`: `mapToolchainDiagnostics(raw: Diagnostic[], docLength: number): CmDiagnostic[]` (pure) and `toolchainLinter(check: () => Promise<Diagnostic[]>): Extension` (a `linter()` with `delay: 400` that calls `check()` and maps; on rejection returns `[]`).
- `stdCompletion.ts`: `stdCompletionSource(getExports: () => StdExport[]): CompletionSource` and `stdCompletion(getExports): Extension` (`autocompletion({ override: [source] })`).
- `stdLink.ts`: `stdNameAt(text: string, pos: number): string | null` (pure) and `stdLink(onGoTo: (name: string) => void): Extension` (Cmd/Ctrl-click handler).

- [ ] **Step 1: Write the failing tests**

`src/lib/toolchain/editor/lint.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mapToolchainDiagnostics } from './lint.ts';
import type { Diagnostic } from '../types.ts';

const diag = (over: Partial<Diagnostic>): Diagnostic => ({ code: 'x', severity: 'warning', from: 0, to: 1, message: 'm', ...over });

describe('mapToolchainDiagnostics', () => {
  it('T-lint-map: positions, severity and code carry over', () => {
    const [d] = mapToolchainDiagnostics([diag({ from: 2, to: 5, severity: 'error', code: 'unknown-mnemonic', message: 'bad' })], 10);
    expect(d).toMatchObject({ from: 2, to: 5, severity: 'error', message: 'bad', source: 'unknown-mnemonic' });
  });
  it('T-lint-clamp: positions past the document clamp to its length', () => {
    const [d] = mapToolchainDiagnostics([diag({ from: 8, to: 50 })], 10);
    expect(d.from).toBe(8); expect(d.to).toBe(10);
  });
  it('T-lint-fix-action: a fix becomes an action that applies its edits; maybeIncorrect is labelled', () => {
    const raw = diag({ from: 4, to: 6, fix: { description: "remove the label prefix '1:'", applicability: 'maybeIncorrect', edits: [{ from: 4, to: 6, replacement: '' }] } });
    const [d] = mapToolchainDiagnostics([raw], 20);
    expect(d.actions?.[0].name).toBe("remove the label prefix '1:' (may be incorrect)");
    const view = new EditorView({ state: EditorState.create({ doc: 'abcd1:efg' }) });
    d.actions![0].apply(view, 4, 6);
    expect(view.state.doc.toString()).toBe('abcdefg');
    view.destroy();
  });
  it('T-lint-fix-machine-applicable: no suffix on a machineApplicable fix', () => {
    const [d] = mapToolchainDiagnostics([diag({ fix: { description: 'sort', applicability: 'machineApplicable', edits: [] } })], 5);
    expect(d.actions?.[0].name).toBe('sort');
  });
});
```

`src/lib/toolchain/editor/stdCompletion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { stdCompletionSource } from './stdCompletion.ts';
import type { StdExport } from '../toolchainHelpers.ts';

const EXPORTS: StdExport[] = [
  { name: 'goToEnd', kind: 'function', line: 13, detail: 'goToEnd()', doc: 'Walk right to the first blank.' },
  { name: 'goToBegin', kind: 'function', line: 21, detail: 'goToBegin()', doc: null },
  { name: 'symbols', kind: 'alphabet', line: 53, detail: "alphabet symbols { '_', '^', '$', '0', '1' }", doc: null },
];

function at(marked: string) {
  const pos = marked.indexOf('▮');
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return stdCompletionSource(() => EXPORTS)(new CompletionContext(state, pos, true));
}

describe('std:: completion', () => {
  it('T-stdcomp-activates: only after `std::`', () => {
    expect(at('    1: @std::▮')).not.toBeNull();
    expect(at('    1: @st▮')).toBeNull();
    expect(at('call std::go▮')).not.toBeNull();
  });
  it('T-stdcomp-options: one option per export with detail / info, from after the `::`', () => {
    const r = at('@std::go▮')!;
    expect(r.from).toBe('@std::'.length);
    expect(r.options.map((o) => o.label)).toEqual(['goToEnd', 'goToBegin', 'symbols']);
    expect(r.options[0]).toMatchObject({ type: 'function', detail: 'goToEnd()', info: 'Walk right to the first blank.' });
    expect(r.options[2].type).toBe('class');
  });
});
```

`src/lib/toolchain/editor/stdLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stdNameAt } from './stdLink.ts';

describe('stdNameAt', () => {
  it('T-stdlink-hit: a position inside `std::name` yields the name', () => {
    const text = '    1: @std::goToEnd();\n';
    expect(stdNameAt(text, text.indexOf('goToEnd') + 3)).toBe('goToEnd');
    expect(stdNameAt(text, text.indexOf('std'))).toBe('goToEnd');
  });
  it('T-stdlink-miss: outside any std:: reference → null', () => {
    expect(stdNameAt('right; mark;', 3)).toBeNull();
    expect(stdNameAt('use foo::bar;', 9)).toBeNull();
  });
  it('T-stdlink-asm: works on an assembly operand too', () => {
    const text = '        call    std::goToNumber #2';
    expect(stdNameAt(text, text.indexOf('Number'))).toBe('goToNumber');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/toolchain/editor` → modules not found.

- [ ] **Step 3: Write the extensions**

`src/lib/toolchain/editor/lint.ts`:

```ts
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
```

`src/lib/toolchain/editor/stdCompletion.ts`:

```ts
// `std::` completion over the standard library's exported names. The list is
// built from `stdlibSource` (the text the module links), so it cannot drift.
import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { StdExport } from '../toolchainHelpers.ts';

export function stdCompletionSource(getExports: () => StdExport[]): CompletionSource {
  return (ctx) => {
    const m = ctx.matchBefore(/std::[A-Za-z0-9_]*/);
    if (!m) return null;
    return {
      from: m.from + 'std::'.length,
      validFor: /^[A-Za-z0-9_]*$/,
      options: getExports().map((e) => ({
        label: e.name,
        type: e.kind === 'alphabet' ? 'class' : 'function',
        detail: e.detail,
        ...(e.doc ? { info: e.doc } : {}),
      })),
    };
  };
}

export function stdCompletion(getExports: () => StdExport[]): Extension {
  return autocompletion({ override: [stdCompletionSource(getExports)] });
}
```

`src/lib/toolchain/editor/stdLink.ts`:

```ts
// Cmd/Ctrl-click on a `std::name` reference opens the stdlib tab at its
// definition (the orchestrator does the tab switch and the search).
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const REF = /std::([A-Za-z_][A-Za-z0-9_]*)/g;

export function stdNameAt(text: string, pos: number): string | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const col = pos - lineStart;
  for (const m of line.matchAll(REF)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (col >= start && col <= end) return m[1];
  }
  return null;
}

export function stdLink(onGoTo: (name: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.metaKey || e.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const name = stdNameAt(view.state.doc.toString(), pos);
      if (!name) return false;
      e.preventDefault();
      onGoTo(name);
      return true;
    },
  });
}
```

- [ ] **Step 4: Generalise `Editor.svelte`**

Replace the `<script>` block of `src/components/Editor.svelte` with:

```ts
  import CodeMirror from 'svelte-codemirror-editor';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { completionExtensions } from '../lib/completions/index.ts';
  import { argCountLinter } from '../lib/completions/lint/argCount.ts';
  import { crossRefLinter } from '../lib/completions/lint/crossRef.ts';
  import { unboundLinter } from '../lib/completions/lint/unbound.ts';
  import { getSchema } from '../lib/completions/schema/index.ts';
  import type { Env } from '../lib/completions/contexts/types.ts';
  import { syntaxLinter } from '../lib/syntaxLinter.ts';
  import { saveCode } from '../lib/persist.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { DiagnosticsCounter, diagnosticsCounterPlugin } from '../lib/diagnosticsCounter.svelte.ts';
  import DiagnosticsCounterComponent from './DiagnosticsCounter.svelte';
  import IconButton from './IconButton.svelte';
  import { isToolchainEngine, type Engine } from '../lib/types.ts';
  import { langFor, type Lang } from '../lib/toolchain/types.ts';
  import { toolchainLanguage } from '../lib/toolchain/lang/index.ts';

  type Props = {
    engine: Engine;
    code: string;
    onReset: () => void;
    resetVisible?: boolean;
    resetTitle?: string;
    /** Toolchain engines only: which stream mode to use. Ignored for JS engines. */
    lang?: Lang;
    /** Appended after the built-in set — the orchestrator's lint / gutter / highlight / completion. */
    extensions?: Extension[];
    /** Read-only viewer (the stdlib tab): no persistence, no reset, no counter. */
    readOnly?: boolean;
    onReady?: (view: EditorView) => void;
  };

  let {
    engine, code = $bindable(), onReset, resetVisible = true, resetTitle = 'Reset code to selected example',
    lang, extensions: extra = [], readOnly = false, onReady,
  }: Props = $props();

  const toolchain = isToolchainEngine(engine);

  // Persist code to localStorage on every change (editable buffers only).
  $effect(() => {
    if (!readOnly) saveCode(engine, code);
  });

  const counter = new DiagnosticsCounter();

  const jsLang = javascript();
  const cmLang = $derived(toolchain ? toolchainLanguage(lang ?? langFor(engine, 'source')) : jsLang);

  // Bundle oneDark only when the *resolved* theme is dark; the light theme
  // falls back to CodeMirror's default highlighting paired with --editor-bg.
  const extensions = $derived.by(() => {
    const base: Extension[] = [];
    if (!toolchain) {
      const env: Env = { engine, schema: getSchema(engine) };
      base.push(...completionExtensions(engine), syntaxLinter, argCountLinter(env), crossRefLinter(env), unboundLinter(env));
    }
    base.push(...extra);
    if (!readOnly) base.push(diagnosticsCounterPlugin(counter));
    if (readOnly) base.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    return theme.resolved === 'dark' ? [oneDark, ...base] : base;
  });
```

and the markup with:

```svelte
<div class="editor" class:read-only={readOnly}>
  {#if resetVisible && !readOnly}
    <IconButton icon="resetCode" title={resetTitle} onClick={onReset} />
  {/if}
  <CodeMirror bind:value={code} lang={cmLang} {extensions} onready={onReady} />
  {#if !readOnly}
    <DiagnosticsCounterComponent {counter} />
  {/if}
</div>
```

Add to the `<style>` block (inside `.editor`), the ip-line and breakpoint gutter rules used by Task 8 (tokens only):

```css
    :global(.cm-ip-line) {
      background: color-mix(in srgb, var(--graph-highlight) 18%, transparent);
    }
    :global(.cm-bp-gutter) {
      width: 14px;
    }
    :global(.cm-bp-gutter .cm-gutterElement) {
      cursor: pointer;
    }
    :global(.cm-bp-gutter .cm-gutterElement.cm-bp-unmappable) {
      cursor: not-allowed;
    }
    :global(.cm-bp-marker) {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 2px;
      border-radius: 50%;
      background: var(--graph-breakpoint);
    }
```

- [ ] **Step 5: Run tests, check, lint**

Run: `npx vitest run src/lib/toolchain/editor && npm run check && npm run lint && npm test`
Expected: green; the JS pages' Editor behaviour is unchanged (props default off).

- [ ] **Step 6: Commit**

```bash
git add src/components/Editor.svelte src/lib/toolchain/editor
git commit -m "feat(toolchain): editor generalisation, toolchain lint source, std:: completion and go-to-definition link"
```

---
### Task 8: Breakpoint gutter and ip line highlight

**Files:**
- Create: `src/lib/toolchain/editor/breakpointGutter.ts`, `ipHighlight.ts`
- Create: `src/lib/toolchain/editor/breakpointGutter.test.ts`, `ipHighlight.test.ts`

**Interfaces:**
- `breakpointGutter.ts`:
  ```ts
  export type BreakpointGutterOpts = {
    has: (line: number) => boolean;      // 1-based line has a breakpoint
    canSet: (line: number) => boolean;   // line owns an address (lineMap)
    onToggle: (line: number) => void;
    refuseTitle: string;                 // tooltip on lines that cannot take one
  };
  export const bpRefresh: StateEffectType<null>;   // dispatch to re-render markers after the set or the line map changed
  export function breakpointGutter(opts: BreakpointGutterOpts): Extension;
  export function refreshBreakpoints(view: EditorView): void;   // view.dispatch({ effects: bpRefresh.of(null) })
  ```
- `ipHighlight.ts`:
  ```ts
  export const setIpLine: StateEffectType<number | null>;   // 1-based line or null
  export function ipHighlight(): Extension;
  export function showIp(view: EditorView, line: number | null): void;   // dispatches setIpLine and scrolls the line into view with scrollTop math
  export function ipLineOf(state: EditorState): number | null;           // test accessor
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/toolchain/editor/breakpointGutter.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { breakpointGutter, refreshBreakpoints } from './breakpointGutter.ts';

function make(has: Set<number>, mappable: Set<number>, onToggle: (n: number) => void) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'a\nb\nc\n',
      extensions: [breakpointGutter({ has: (n) => has.has(n), canSet: (n) => mappable.has(n), onToggle, refuseTitle: 'no instruction on this line' })],
    }),
  });
  return { view, parent };
}

const markers = (parent: HTMLElement) => parent.querySelectorAll('.cm-bp-gutter .cm-bp-marker').length;

describe('breakpointGutter', () => {
  it('T-bp-render: one marker per breakpointed line; refresh re-renders', () => {
    const has = new Set<number>([2]);
    const { view, parent } = make(has, new Set([1, 2, 3]), () => {});
    expect(markers(parent)).toBe(1);
    has.add(3);
    refreshBreakpoints(view);
    expect(markers(parent)).toBe(2);
    view.destroy();
  });

  it('T-bp-click: a click on a mappable line calls onToggle with its number', () => {
    const toggled: number[] = [];
    const { view, parent } = make(new Set(), new Set([1, 2, 3]), (n) => toggled.push(n));
    const el = parent.querySelectorAll('.cm-bp-gutter .cm-gutterElement')[1] as HTMLElement;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toggled).toEqual([2]);
    view.destroy();
  });

  it('T-bp-refuse: an unmappable line is not toggled and carries the refuse title', () => {
    const toggled: number[] = [];
    const { view, parent } = make(new Set(), new Set([2]), (n) => toggled.push(n));
    const el = parent.querySelectorAll('.cm-bp-gutter .cm-gutterElement')[0] as HTMLElement;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toggled).toEqual([]);
    expect(el.classList.contains('cm-bp-unmappable')).toBe(true);
    expect(el.title).toBe('no instruction on this line');
    view.destroy();
  });
});
```

`src/lib/toolchain/editor/ipHighlight.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ipHighlight, ipLineOf, showIp } from './ipHighlight.ts';

function make() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ parent, state: EditorState.create({ doc: 'a\nb\nc\n', extensions: [ipHighlight()] }) });
}

describe('ipHighlight', () => {
  it('T-ip-set: showIp decorates the line; null clears', () => {
    const view = make();
    showIp(view, 2);
    expect(ipLineOf(view.state)).toBe(2);
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(1);
    showIp(view, null);
    expect(ipLineOf(view.state)).toBeNull();
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(0);
    view.destroy();
  });
  it('T-ip-out-of-range: a line past the document clears instead of throwing', () => {
    const view = make();
    showIp(view, 99);
    expect(ipLineOf(view.state)).toBeNull();
    view.destroy();
  });
  it('T-ip-survives-edit: the decoration maps through an edit above it', () => {
    const view = make();
    showIp(view, 3);
    view.dispatch({ changes: { from: 0, insert: 'x\n' } });
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(1);
    view.destroy();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/toolchain/editor/breakpointGutter.test.ts src/lib/toolchain/editor/ipHighlight.test.ts` → modules not found.

- [ ] **Step 3: Write the gutter**

`src/lib/toolchain/editor/breakpointGutter.ts`:

```ts
// Breakpoint gutter keyed by 1-based line. Breakpoint state lives in the
// orchestrator (`{ file, line }` keys — docs/execution-model.md (toolchain
// engines)); the gutter reads it through `has` / `canSet` and re-renders when
// `bpRefresh` is dispatched.
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export type BreakpointGutterOpts = {
  has: (line: number) => boolean;
  canSet: (line: number) => boolean;
  onToggle: (line: number) => void;
  refuseTitle: string;
};

export const bpRefresh = StateEffect.define<null>();

class BpMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'cm-bp-marker';
    return el;
  }
}
const marker = new BpMarker();

class Unmappable extends GutterMarker {
  constructor(private readonly title: string) { super(); }
  elementClass = 'cm-bp-unmappable';
  toDOM(): Node {
    const el = document.createElement('span');
    el.title = this.title;
    return el;
  }
}

export function breakpointGutter(opts: BreakpointGutterOpts): Extension {
  const unmappable = new Unmappable(opts.refuseTitle);
  return gutter({
    class: 'cm-bp-gutter',
    lineMarker(view, line) {
      const n = view.state.doc.lineAt(line.from).number;
      if (opts.has(n)) return marker;
      return opts.canSet(n) ? null : unmappable;
    },
    lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(bpRefresh))),
    initialSpacer: () => marker,
    domEventHandlers: {
      mousedown(view, line, event) {
        const n = view.state.doc.lineAt(line.from).number;
        const target = event.target as HTMLElement | null;
        if (!opts.canSet(n)) {
          if (target) target.title = opts.refuseTitle;
          return true;
        }
        opts.onToggle(n);
        view.dispatch({ effects: bpRefresh.of(null) });
        return true;
      },
    },
  });
}

export function refreshBreakpoints(view: EditorView): void {
  view.dispatch({ effects: bpRefresh.of(null) });
}
```

The `Unmappable` marker's `elementClass` puts `cm-bp-unmappable` on the gutter element and its DOM carries the title, so the refuse test sees both without a click.

- [ ] **Step 4: Write the ip highlight**

`src/lib/toolchain/editor/ipHighlight.ts`:

```ts
// Line decoration for the paused instruction pointer. Scrolls with
// `scrollTop` math (never `scrollIntoView`, which would yank the page —
// the same policy as ExecutionTraceTable.svelte).
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export const setIpLine = StateEffect.define<number | null>();

const ipLine = Decoration.line({ class: 'cm-ip-line' });

const ipField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setIpLine)) continue;
      const line = e.value;
      if (line === null || line < 1 || line > tr.state.doc.lines) { deco = Decoration.none; continue; }
      const from = tr.state.doc.line(line).from;
      deco = Decoration.set([ipLine.range(from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function ipHighlight(): Extension {
  return ipField;
}

export function ipLineOf(state: EditorState): number | null {
  const set = state.field(ipField, false);
  if (!set || set.size === 0) return null;
  let pos = -1;
  set.between(0, state.doc.length, (from) => { pos = from; return false; });
  return pos < 0 ? null : state.doc.lineAt(pos).number;
}

export function showIp(view: EditorView, line: number | null): void {
  view.dispatch({ effects: setIpLine.of(line) });
  if (line === null || line < 1 || line > view.state.doc.lines) return;
  const pos = view.state.doc.line(line).from;
  const block = view.lineBlockAt(pos);
  const scroller = view.scrollDOM;
  const top = block.top - scroller.clientHeight / 2 + block.height / 2;
  scroller.scrollTop = Math.max(0, top);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/toolchain/editor` — all passing. If happy-dom does not lay out gutters (no `.cm-gutterElement` children), replace the DOM-count assertions in `T-bp-render` with a check on the `RangeSet` returned by iterating `view.state.facet(EditorView.decorations)` and note the reason in the test; do not weaken the click and refuse cases.

- [ ] **Step 6: Lint, check, commit**

```bash
npm run lint && npm run check
git add src/lib/toolchain/editor/breakpointGutter.ts src/lib/toolchain/editor/ipHighlight.ts src/lib/toolchain/editor/breakpointGutter.test.ts src/lib/toolchain/editor/ipHighlight.test.ts
git commit -m "feat(toolchain): breakpoint gutter and ip line highlight"
```

---
### Task 9: Toolbar Format + file menu, TapesStack actions slot, new icons

**Files:**
- Modify: `src/lib/icons.ts` (five icons)
- Modify: `src/components/Toolbar.svelte` (props + markup)
- Modify: `src/components/Toolbar.test.ts` (append cases)
- Modify: `src/components/TapesStack.svelte` (optional `actions` snippet)
- Create: `src/components/TapesStack.test.ts`

**Interfaces:**
- `icons` gains `formatCode` (`@tabler/icons/outline/indent-increase.svg?raw`), `fileOpen` (`outline/upload.svg?raw`), `fileSave` (`outline/download.svg?raw`), `tapeImport` (`outline/file-import.svg?raw`), `tapeExport` (`outline/file-export.svg?raw`).
- `Toolbar` props (new, optional): `onFormat?: () => void`, `onOpenFile?: (file: File) => void`, `onSaveFile?: () => void`. Buttons render only when the callback is provided. Accessible names: "Format", "Open source file", "Save source file".
- `TapesStack` prop (new, optional): `actions?: Snippet` rendered in a `.stack-actions` corner (top-right, absolute) inside `.tapes-stack`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Toolbar.test.ts` inside `describe('Toolbar', …)`:

```ts
  describe('format and file menu', () => {
    it('C-toolbar-format-hidden: no Format button without onFormat', () => {
      render(Toolbar, { props: defaultProps() });
      expect(screen.queryByRole('button', { name: /^format$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-format-click: Format calls onFormat', async () => {
      const onFormat = vi.fn();
      render(Toolbar, { props: { ...defaultProps(), onFormat } });
      await fireEvent.click(screen.getByRole('button', { name: /^format$/i }));
      expect(onFormat).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-file-menu: Open / Save render only with their callbacks; Save calls back; Open forwards the picked file', async () => {
      const onOpenFile = vi.fn();
      const onSaveFile = vi.fn();
      render(Toolbar, { props: { ...defaultProps(), onOpenFile, onSaveFile } });
      await fireEvent.click(screen.getByRole('button', { name: 'Save source file' }));
      expect(onSaveFile).toHaveBeenCalledTimes(1);
      const input = screen.getByTestId('open-file-input') as HTMLInputElement;
      const file = new File(['main() {}'], 'x.pmc', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file] });
      await fireEvent.change(input);
      expect(onOpenFile).toHaveBeenCalledWith(file);
    });
  });
```

`src/components/TapesStack.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import TapesStack from './TapesStack.svelte';

describe('TapesStack', () => {
  afterEach(() => cleanup());

  it('C-stack-actions: the optional actions snippet renders in the corner slot', () => {
    const actions = createRawSnippet(() => ({ render: () => '<button type="button">Load tape block</button>' }));
    render(TapesStack, { props: { tapeCount: 1, caretColors: ['#fff'], actions } });
    expect(screen.getByRole('button', { name: 'Load tape block' })).toBeInTheDocument();
    expect(screen.getByTestId('stack-actions')).toBeInTheDocument();
  });

  it('C-stack-actions-absent: no slot markup without the snippet', () => {
    render(TapesStack, { props: { tapeCount: 1, caretColors: ['#fff'] } });
    expect(screen.queryByTestId('stack-actions')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/Toolbar.test.ts src/components/TapesStack.test.ts` → the new cases fail (no button / no slot).

- [ ] **Step 3: Icons**

`src/lib/icons.ts` — add imports (alphabetical with the others) and keys in the `icons` object:

```ts
import fileOpen from '@tabler/icons/outline/upload.svg?raw';
import fileSave from '@tabler/icons/outline/download.svg?raw';
import formatCode from '@tabler/icons/outline/indent-increase.svg?raw';
import tapeExport from '@tabler/icons/outline/file-export.svg?raw';
import tapeImport from '@tabler/icons/outline/file-import.svg?raw';
// … in `icons`: fileOpen, fileSave, formatCode, tapeExport, tapeImport,
```

- [ ] **Step 4: Toolbar**

In `Toolbar.svelte` `Props` add:

```ts
    /** Toolchain engines: canonical whitespace-only formatting of the buffer. */
    onFormat?: () => void;
    /** Toolchain engines: open a local source file into the buffer. */
    onOpenFile?: (file: File) => void;
    /** Toolchain engines: download the buffer as a source file. */
    onSaveFile?: () => void;
```

destructure them (`onFormat, onOpenFile, onSaveFile`) and add `let fileInputEl = $state<HTMLInputElement | undefined>(undefined);`. In the markup, after the `save-menu` div and before the Build button:

```svelte
  {#if onOpenFile || onSaveFile}
    <div class="file-menu">
      {#if onOpenFile}
        <input
          type="file"
          class="visually-hidden"
          data-testid="open-file-input"
          accept=".pmc,.tmc,.pma,.tma"
          bind:this={fileInputEl}
          onchange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) onOpenFile(f);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
        <button type="button" class="icon-only" title="Open source file" aria-label="Open source file" onclick={() => fileInputEl?.click()}>
          {@html icons.fileOpen}
        </button>
      {/if}
      {#if onSaveFile}
        <button type="button" class="icon-only" title="Save source file" aria-label="Save source file" onclick={onSaveFile}>
          {@html icons.fileSave}
        </button>
      {/if}
    </div>
  {/if}
  {#if onFormat}
    <button type="button" disabled={loadDisabled} title="Format (canonical whitespace)" onclick={onFormat}>
      {@html icons.formatCode}<span class="btn-label">Format</span>
    </button>
  {/if}
```

Style: `.file-menu { display: inline-flex; gap: 4px; }` next to the existing `.save-menu` rules (reuse `.icon-only`). Note the mobile e2e will click "Format" by accessible name — the `.btn-label` text is part of the name.

- [ ] **Step 5: TapesStack actions slot**

In `TapesStack.svelte`: `import type { Snippet } from 'svelte';`, add `actions?: Snippet` to `Props` and destructure; in the markup, as the last child of `.tapes-stack`:

```svelte
  {#if actions}
    <div class="stack-actions" data-testid="stack-actions">{@render actions()}</div>
  {/if}
```

Style (inside `.tapes-stack`'s block is fine as a sibling rule):

```css
  .stack-actions {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 4px;
    z-index: 2;
  }
```

- [ ] **Step 6: Run tests, check, lint**

Run: `npx vitest run src/components && npm run check && npm run lint`
Expected: green, including the pre-existing Toolbar cases.

- [ ] **Step 7: Commit**

```bash
git add src/lib/icons.ts src/components/Toolbar.svelte src/components/Toolbar.test.ts src/components/TapesStack.svelte src/components/TapesStack.test.ts
git commit -m "feat(toolbar,tapes): optional Format and file actions; actions slot on the tape stack"
```

---
### Task 10: Bundled examples, `Example` fields, persistence of kind and seeds

**Files:**
- Create: `src/lib/toolchain/examples/unary-increment.pmc`, `sum.pmc`, `binary-increment.tmc`, `two-tape-copy.tmc`, `pow2.tmc`, `unary-increment.pma`, `binary-increment.tma`
- Create: `src/lib/toolchain/examples.ts`, `src/lib/toolchain/examples.test.ts`
- Modify: `src/lib/defaultCode.ts:3-16` (Example type), `:538-540` (`examples()` dispatch)
- Modify: `src/lib/persist.ts` (Snippet fields, `saveSnippet` extra, seeds / kind keys)
- Create: `src/lib/toolchain/persistToolchain.test.ts`
- Modify: `src/vite-env.d.ts` (declare `*.pmc?raw` etc.)

**Interfaces:**
- `Example` gains `kind?: BufferKind` (default `'source'`) and `seeds?: ExampleSeed[]`.
- `examples(engine)` / `findExample` / `defaultExample` in `defaultCode.ts` dispatch to `toolchainExamples(engine)` for `pm1` / `tm1`.
- `persist.ts`: `Snippet = { title; code; savedAt; kind?: BufferKind; seeds?: ExampleSeed[] }`; `saveSnippet(engine, title, code, extra?: { kind?: BufferKind; seeds?: ExampleSeed[] })`; `loadSeeds(engine): ExampleSeed[] | null`, `saveSeeds(engine, seeds)`, `loadKind(engine): BufferKind | null`, `saveKind(engine, kind)` under keys `machines-demo:<engine>:seeds` / `:kind`.

- [ ] **Step 1: Example source files**

`src/vite-env.d.ts` — add:

```ts
declare module '*.pmc?raw' { const content: string; export default content; }
declare module '*.tmc?raw' { const content: string; export default content; }
declare module '*.pma?raw' { const content: string; export default content; }
declare module '*.tma?raw' { const content: string; export default content; }
```

`src/lib/toolchain/examples/unary-increment.pmc`:

```
// Unary increment: append one mark to a run of marks.
// The head starts on the first mark; the run grows by one on the right.
main() {
    @std::goToEnd();
    mark;
    @std::goToBegin();
}
```

`src/lib/toolchain/examples/sum.pmc` (the toolchains' golden `sum.pmc` without its unreferenced numeric labels — the lint channel flags those as `unused-label`):

```
// Adds the two unary numbers on the tape. Numbers are n+1 marks; input
// "a gap b" with the head on a's first mark; output one section a+b.
use std::goToEnd, std::goToBegin;

main() {
    @goToEnd();
    right;
    right;
    @goToEnd();
    unmark;
    left;
    @goToBegin();
    left;
    mark;
    @goToEnd();
    unmark;
    left;
    @goToBegin(!);
}
```

`src/lib/toolchain/examples/binary-increment.tmc` (the toolchains' golden `a2_binary_plus_one.tmc`):

```
alphabet bits { '_', '0', '1' }

machine {
  tape num: bits; // head on the least significant digit

  entry state inc {
    ['1'] -> write ['0'] move [<] goto inc; // carry
    ['0'] -> write ['1'] stop;
    ['_'] -> write ['1'] stop;
  }
}
```

`src/lib/toolchain/examples/two-tape-copy.tmc` (golden `a3_two_tape_copy.tmc`):

```
alphabet bits { '_', '0', '1' }

machine {
  tape src: bits;
  tape dst: bits;

  entry state copy {
    ['0'..'1' as c, *] -> write [-, {c}] move [>, >] goto copy;
    ['_', *]           -> stop;
  }
}
```

`src/lib/toolchain/examples/pow2.tmc` — the toolchains' `docs/examples/pow2/pow2.tmc` verbatim (three tapes; copy the file from the toolchains repository at tag `v0.5.0-rc.2`).

- [ ] **Step 2: Generate the two assembly examples from the module** (one-off, then commit the output)

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const glue = await import('./vendor/mtc-wasm/mtc_wasm.js');
await glue.default({ module_or_path: readFileSync('vendor/mtc-wasm/mtc_wasm_bg.wasm') });
for (const [src, lang, out] of [['unary-increment.pmc','pmc','unary-increment.pma'], ['binary-increment.tmc','tmc','binary-increment.tma']]) {
  const r = glue.Toolchain.build(lang, readFileSync('src/lib/toolchain/examples/'+src,'utf8'), undefined);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  writeFileSync('src/lib/toolchain/examples/'+out, r.program.disassembly());
  r.program.free();
}
console.log('written');
"
```

- [ ] **Step 3: Write the failing tests**

`src/lib/toolchain/examples.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_ENGINES } from '../types.ts';
import { defaultExample, examples, findExample } from '../defaultCode.ts';
import { loadMtcForTests } from './testModule.ts';
import { seedFromGlyphs } from './toolchainHelpers.ts';
import { toolchainExamples } from './examples.ts';
import { langFor } from './types.ts';

describe('toolchain examples', () => {
  it('T-examples-clean: every example builds, lints clean, and its seeds fit the program\'s bands', async () => {
    const { Toolchain } = await loadMtcForTests();
    for (const engine of TOOLCHAIN_ENGINES) {
      for (const ex of toolchainExamples(engine)) {
        const lang = langFor(engine, ex.kind ?? 'source');
        const r = Toolchain.build(lang, ex.code, undefined);
        expect(r.ok, `${engine}/${ex.id} builds`).toBe(true);
        if (!r.ok) continue;
        expect(r.diagnostics, `${engine}/${ex.id} build warnings`).toEqual([]);
        expect(Toolchain.check(lang, ex.code, undefined), `${engine}/${ex.id} lint`).toEqual([]);
        const tapes = r.program.tapes();
        expect((ex.seeds ?? []).length).toBeLessThanOrEqual(tapes.length);
        (ex.seeds ?? []).forEach((s, i) => expect(() => seedFromGlyphs(tapes[i].glyphs, s)).not.toThrow());
        r.program.free();
      }
    }
  });

  it('T-examples-dispatch: defaultCode routes toolchain engines to their example sets', () => {
    expect(examples('pm1')[0].id).toBe('unary-increment');
    expect(examples('tm1')[0].id).toBe('binary-increment');
    expect(defaultExample('tm1').kind ?? 'source').toBe('source');
    expect(findExample('pm1', 'unary-increment-asm')?.kind).toBe('asm');
    expect(findExample('pm1', 'nope')).toBeUndefined();
  });

  it('T-examples-asm-roundtrip: each assembly example is the disassembly of its source twin (same bytes)', async () => {
    const { Toolchain } = await loadMtcForTests();
    for (const [engine, srcId, asmId] of [['pm1', 'unary-increment', 'unary-increment-asm'], ['tm1', 'binary-increment', 'binary-increment-asm']] as const) {
      const src = Toolchain.build(langFor(engine, 'source'), findExample(engine, srcId)!.code, undefined);
      const asm = Toolchain.build(langFor(engine, 'asm'), findExample(engine, asmId)!.code, undefined);
      if (!src.ok || !asm.ok) throw new Error('build failed');
      expect(Array.from(asm.program.bytes())).toEqual(Array.from(src.program.bytes()));
      src.program.free(); asm.program.free();
    }
  });
});
```

`src/lib/toolchain/persistToolchain.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadKind, loadSeeds, loadSnippets, saveKind, saveSeeds, saveSnippet } from '../persist.ts';

describe('toolchain persistence', () => {
  beforeEach(() => localStorage.clear());

  it('T-persist-seeds: seeds round-trip in glyph form under the engine key', () => {
    expect(loadSeeds('pm1')).toBeNull();
    saveSeeds('pm1', [{ cells: ['*', '*'], origin: 0, head: 1 }]);
    expect(loadSeeds('pm1')).toEqual([{ cells: ['*', '*'], origin: 0, head: 1 }]);
    expect(localStorage.getItem('machines-demo:pm1:seeds')).not.toBeNull();
  });

  it('T-persist-kind: kind round-trips and rejects junk', () => {
    expect(loadKind('tm1')).toBeNull();
    saveKind('tm1', 'asm');
    expect(loadKind('tm1')).toBe('asm');
    localStorage.setItem('machines-demo:tm1:kind', 'nope');
    expect(loadKind('tm1')).toBeNull();
  });

  it('T-persist-snippet-extra: saveSnippet stores kind and seeds and keeps the UUID on overwrite', () => {
    const a = saveSnippet('tm1', 'inc', 'code', { kind: 'asm', seeds: [{ cells: ['1'] }] });
    const b = saveSnippet('tm1', 'inc', 'code2', { kind: 'source' });
    expect(b.id).toBe(a.id);
    expect(loadSnippets('tm1')[a.id]).toMatchObject({ code: 'code2', kind: 'source' });
    expect(loadSnippets('tm1')[a.id].seeds).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run to verify failure** — `npx vitest run src/lib/toolchain/examples.test.ts src/lib/toolchain/persistToolchain.test.ts` → missing modules / functions.

- [ ] **Step 5: Example type and dispatch**

`src/lib/defaultCode.ts` — extend the type:

```ts
import type { BufferKind, ExampleSeed } from './toolchain/types.ts';
import { toolchainExamples } from './toolchain/examples.ts';
import { isToolchainEngine, type Engine } from './types.ts';

export type Example = {
  id: string;
  title: string;
  code: string;
  showcase?: boolean;
  description?: string;
  lessonNotes?: string;
  intervalMs?: number;
  /** Toolchain engines: the buffer language kind this example is written in (default `source`). */
  kind?: BufferKind;
  /** Toolchain engines: input tape per band, in glyphs. */
  seeds?: ExampleSeed[];
};
```

and the dispatch:

```ts
export function examples(engine: Engine): readonly Example[] {
  if (isToolchainEngine(engine)) return toolchainExamples(engine);
  return engine === 'post' ? POST_EXAMPLES : TURING_EXAMPLES;
}
```

`src/lib/toolchain/examples.ts`:

```ts
import type { Example } from '../defaultCode.ts';
import type { ToolchainEngine } from '../types.ts';
import UNARY_INCREMENT from './examples/unary-increment.pmc?raw';
import UNARY_INCREMENT_ASM from './examples/unary-increment.pma?raw';
import SUM from './examples/sum.pmc?raw';
import BINARY_INCREMENT from './examples/binary-increment.tmc?raw';
import BINARY_INCREMENT_ASM from './examples/binary-increment.tma?raw';
import TWO_TAPE_COPY from './examples/two-tape-copy.tmc?raw';
import POW2 from './examples/pow2.tmc?raw';

const PM1: readonly Example[] = [
  { id: 'unary-increment', title: 'Unary increment', code: UNARY_INCREMENT, description: 'Append one mark to a run of marks using the standard library.', seeds: [{ cells: ['*', '*', '*'], head: 0 }] },
  { id: 'sum', title: 'Unary sum', code: SUM, description: 'Add two unary numbers separated by a gap.', seeds: [{ cells: ['*', '*', '*', ' ', '*', '*'], head: 0 }] },
  { id: 'unary-increment-asm', title: 'Unary increment (assembly)', code: UNARY_INCREMENT_ASM, kind: 'asm', description: 'The same program as PM-1 assembly — the disassembly of the source example.', seeds: [{ cells: ['*', '*', '*'], head: 0 }] },
];

const TM1: readonly Example[] = [
  { id: 'binary-increment', title: 'Binary increment', code: BINARY_INCREMENT, description: 'Add one to a binary number; head on the least significant digit.', seeds: [{ cells: ['0', '1', '1'], head: 2 }] },
  { id: 'two-tape-copy', title: 'Two-tape copy', code: TWO_TAPE_COPY, description: 'Copy tape src onto tape dst, both heads moving right.', seeds: [{ cells: ['0', '1', '1', '0'], head: 0 }, { cells: [], head: 0 }] },
  { id: 'pow2', title: 'Unary power of two', code: POW2, description: 'Three tapes compute 2^N in unary; input s b 1×N k with the head on b.', seeds: [{ cells: ['s', 'b', '1', '1', '1', 'k'], head: 1 }, { cells: [], head: 0 }, { cells: [], head: 0 }] },
  { id: 'binary-increment-asm', title: 'Binary increment (assembly)', code: BINARY_INCREMENT_ASM, kind: 'asm', description: 'The same program as TM-1 assembly; bands are image-labelled (0, 1, 2).', seeds: [{ cells: ['1', '2', '2'], head: 2 }] },
];

export function toolchainExamples(engine: ToolchainEngine): readonly Example[] {
  return engine === 'pm1' ? PM1 : TM1;
}
```

The `binary-increment-asm` seed uses the decimal glyphs an assembled TM-1 program carries (`'0'` blank, `'1'` = `'0'`, `'2'` = `'1'`), which is what makes the test's seed check pass.

- [ ] **Step 6: Persistence**

`src/lib/persist.ts` — change `Snippet` and `saveSnippet`, add the two key pairs:

```ts
import type { BufferKind, ExampleSeed } from './toolchain/types.ts';

export type Snippet = { title: string; code: string; savedAt: number; kind?: BufferKind; seeds?: ExampleSeed[] };

export function saveSnippet(
  engine: Engine,
  title: string,
  code: string,
  extra: { kind?: BufferKind; seeds?: ExampleSeed[] } = {},
): { id: string; snippet: Snippet } {
  const current = loadSnippets(engine);
  const existingId = Object.entries(current).find(([, s]) => s.title === title)?.[0];
  const id = existingId ?? crypto.randomUUID();
  const snippet: Snippet = { title, code, savedAt: Date.now(), ...(extra.kind ? { kind: extra.kind } : {}), ...(extra.seeds ? { seeds: extra.seeds } : {}) };
  try {
    current[id] = snippet;
    localStorage.setItem(engineKey(engine, 'snippets'), JSON.stringify(current));
  } catch { /* quota or private mode — ignore */ }
  return { id, snippet };
}

export function loadSeeds(engine: Engine): ExampleSeed[] | null {
  try {
    const v = localStorage.getItem(engineKey(engine, 'seeds'));
    if (!v) return null;
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? (parsed as ExampleSeed[]) : null;
  } catch { return null; }
}
export function saveSeeds(engine: Engine, seeds: ExampleSeed[]): void {
  try { localStorage.setItem(engineKey(engine, 'seeds'), JSON.stringify(seeds)); } catch { /* ignore */ }
}
export function loadKind(engine: Engine): BufferKind | null {
  try {
    const v = localStorage.getItem(engineKey(engine, 'kind'));
    return v === 'source' || v === 'asm' ? v : null;
  } catch { return null; }
}
export function saveKind(engine: Engine, kind: BufferKind): void {
  try { localStorage.setItem(engineKey(engine, 'kind'), kind); } catch { /* ignore */ }
}
```

- [ ] **Step 7: Run tests, check, lint**

Run: `npx vitest run src/lib/toolchain/examples.test.ts src/lib/toolchain/persistToolchain.test.ts && npm run check && npm run lint && npm test`
Expected: green. If `T-examples-clean` reports a lint finding on an example, apply the finding's fix to the example file (the finding names it) rather than loosening the test.

- [ ] **Step 8: Commit**

```bash
git add src/vite-env.d.ts src/lib/toolchain/examples src/lib/toolchain/examples.ts src/lib/toolchain/examples.test.ts src/lib/defaultCode.ts src/lib/persist.ts src/lib/toolchain/persistToolchain.test.ts
git commit -m "feat(toolchain): bundled PM-1 / TM-1 examples with seeds; persist buffer kind and seeds"
```

---
### Task 11: `FileTabs` — main buffer / stdlib tabs with the kind switch

**Files:**
- Create: `src/components/FileTabs.svelte`
- Create: `src/components/FileTabs.test.ts`

**Interfaces:**
```ts
type Props = {
  active: SourceTab;                 // 'main' | 'std'
  arch: Arch;                        // 'pm' | 'tm' → extensions pmc/pma or tmc/tma
  kind: BufferKind;                  // current main-buffer kind
  kindSwitchEnabled: boolean;        // false while an op is pending
  onSelect: (tab: SourceTab) => void;
  onKindChange: (kind: BufferKind) => void;
};
```
Accessible names: tabs `main.<ext>` and `std.<srcExt>` (`role="tab"`, `aria-selected`); the kind control is a `<select aria-label="Buffer language">` with options labelled `.pmc` / `.pma` (or `.tmc` / `.tma`), values `source` / `asm`. `data-testid="file-tabs"` on the root.

- [ ] **Step 1: Write the failing test**

`src/components/FileTabs.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import FileTabs from './FileTabs.svelte';

function props(over: Partial<Parameters<typeof render<typeof FileTabs>>[1] extends { props?: infer P } ? P : never> = {}) {
  return { active: 'main' as const, arch: 'tm' as const, kind: 'source' as const, kindSwitchEnabled: true, onSelect: vi.fn(), onKindChange: vi.fn(), ...over };
}

describe('FileTabs', () => {
  afterEach(() => cleanup());

  it('C-tabs-names: tab names follow arch and kind; std keeps the source extension', () => {
    render(FileTabs, { props: props() });
    expect(screen.getByRole('tab', { name: 'main.tmc' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'std.tmc' })).toHaveAttribute('aria-selected', 'false');
    cleanup();
    render(FileTabs, { props: props({ kind: 'asm', arch: 'pm', active: 'std' }) });
    expect(screen.getByRole('tab', { name: 'main.pma' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'std.pmc' })).toHaveAttribute('aria-selected', 'true');
  });

  it('C-tabs-select: clicking a tab calls onSelect', async () => {
    const p = props();
    render(FileTabs, { props: p });
    await fireEvent.click(screen.getByRole('tab', { name: 'std.tmc' }));
    expect(p.onSelect).toHaveBeenCalledWith('std');
  });

  it('C-tabs-kind: the language select reports the new kind and is disabled while an op is pending', async () => {
    const p = props();
    render(FileTabs, { props: p });
    const select = screen.getByLabelText('Buffer language') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['.tmc', '.tma']);
    await fireEvent.change(select, { target: { value: 'asm' } });
    expect(p.onKindChange).toHaveBeenCalledWith('asm');
    cleanup();
    render(FileTabs, { props: props({ kindSwitchEnabled: false }) });
    expect(screen.getByLabelText('Buffer language')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/FileTabs.test.ts` → component missing.

- [ ] **Step 3: Write the component**

`src/components/FileTabs.svelte`:

```svelte
<script lang="ts">
  import type { Arch, BufferKind, SourceTab } from '../lib/toolchain/types.ts';

  type Props = {
    active: SourceTab;
    arch: Arch;
    kind: BufferKind;
    kindSwitchEnabled: boolean;
    onSelect: (tab: SourceTab) => void;
    onKindChange: (kind: BufferKind) => void;
  };

  let { active, arch, kind, kindSwitchEnabled, onSelect, onKindChange }: Props = $props();

  const srcExt = $derived(`${arch}c`);
  const asmExt = $derived(`${arch}a`);
  const mainExt = $derived(kind === 'source' ? srcExt : asmExt);
</script>

<div class="file-tabs" role="tablist" data-testid="file-tabs">
  <button
    type="button"
    role="tab"
    class="tab"
    aria-selected={active === 'main'}
    onclick={() => onSelect('main')}
  >main.{mainExt}</button>
  <select
    class="kind"
    aria-label="Buffer language"
    disabled={!kindSwitchEnabled}
    value={kind}
    onchange={(e) => onKindChange((e.currentTarget as HTMLSelectElement).value as BufferKind)}
  >
    <option value="source">.{srcExt}</option>
    <option value="asm">.{asmExt}</option>
  </select>
  <button
    type="button"
    role="tab"
    class="tab"
    aria-selected={active === 'std'}
    onclick={() => onSelect('std')}
  >std.{srcExt}</button>
</div>

<style>
  .file-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 12px;

    .tab {
      background: transparent;
      border: 1px solid transparent;
      border-bottom: none;
      color: var(--muted);
      padding: 4px 10px;
      font: inherit;
      cursor: pointer;
      border-radius: 6px 6px 0 0;

      &[aria-selected='true'] {
        color: var(--fg);
        background: var(--editor-bg);
        border-color: var(--cell-border);
      }
    }

    .kind {
      font: inherit;
      color: var(--muted);
      background: var(--cell-bg);
      border: 1px solid var(--cell-border);
      border-radius: 4px;
      padding: 2px 4px;
      margin-right: 8px;

      &:disabled {
        opacity: 0.4;
      }
    }
  }
</style>
```

- [ ] **Step 4: Run tests, check, lint; commit**

```bash
npx vitest run src/components/FileTabs.test.ts && npm run check && npm run lint
git add src/components/FileTabs.svelte src/components/FileTabs.test.ts
git commit -m "feat(toolchain): FileTabs — main buffer and stdlib tabs with the language-kind switch"
```

---
### Task 12: `ToolchainView` orchestrator, App wiring, footer version

**Files:**
- Create: `src/components/ToolchainView.svelte`
- Create: `src/lib/toolchain/download.ts`
- Modify: `src/lib/toolchain/toolchainHelpers.ts` (+ `seedFromWasm`), `toolchainHelpers.test.ts` (+ `T-seed-from-wasm`)
- Modify: `src/lib/toolchain/editor/ipHighlight.ts` (+ `scrollToLine`)
- Modify: `src/App.svelte` (tabs, mount, footer)
- Modify: `vite.config.ts` (`toolchainsVersion`), `src/vite-env.d.ts` (`virtual:lib-versions`)

**Interfaces:**
- Consumes everything produced by Tasks 2–11.
- `download.ts`: `downloadBlob(filename: string, blob: Blob): void` (anchor + `URL.createObjectURL`, revoked after click).
- `toolchainHelpers.seedFromWasm(seed: Seed): SeedTape` — `cells` (Uint8Array or number[]) from `origin ?? 0`, dropping zeros; `head ?? 0`.
- `ipHighlight.scrollToLine(view: EditorView, line: number): void` — the scrollTop math `showIp` uses, exported for go-to-definition.
- Log line vocabulary (the e2e specs match these exactly):
  - `building…` · `built — N band(s): a, b` (ok) · `build failed: <message> (line L)` (error) · `warning: <message> (line L)` (warn, per build warning)
  - `step N: <file>:<line|?> <fn>` · `paused at <file>:<line|?> in <fn> (breakpoint|debugger|manual|step)` (pause)
  - `halted after N step(s)` (ok) · `stopped after N step(s)` (ok) · `truncated at N steps (limit hit)` (warn) · `trapped: <kind> — <detail> at <file>:<line|?>` (abort) · `stopped` (warn, hand Stop) · `user took control` (ok)
  - `formatted` (ok) · `format failed: <message> (line L)` (error) · `disassembled last Build into main.<ext>` (ok)
  - `loaded tape block "<name>": N band(s)` (ok) · `load tape block failed: <message>` (error) · `saved tape block <file>` (ok) · `opened <file>` (ok) · `cannot open <file>: not a <arch> source` (error) · `saved <file>` (ok)
  - `dropped breakpoint(s) with no instruction: main.pmc:12, std.pmc:40` (warn) · `seeds reset — the program's bands changed` (warn) · `toolchain module crashed — restarting the worker` (error)

- [ ] **Step 1: Small helpers and their tests**

Append to `toolchainHelpers.ts`:

```ts
export function seedFromWasm(seed: Seed): SeedTape {
  const origin = seed.origin ?? 0;
  const cells = new Map<number, number>();
  Array.from(seed.cells).forEach((v, i) => { if (v !== 0) cells.set(origin + i, v); });
  return { cells, head: seed.head ?? 0 };
}
```

Append to `toolchainHelpers.test.ts` (inside `describe('seeds')`):

```ts
  it('T-seed-from-wasm: a codec Seed becomes a sparse SeedTape with absolute positions', () => {
    const s = seedFromWasm({ cells: new Uint8Array([2, 0, 1]), origin: 4, head: 5 });
    expect([...s.cells.entries()]).toEqual([[4, 2], [6, 1]]);
    expect(s.head).toBe(5);
    expect(seedFromWasm({ cells: [1] }).head).toBe(0);
  });
```

`src/lib/toolchain/download.ts`:

```ts
/** Triggers a browser download of `blob` as `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

In `ipHighlight.ts` extract the scroll math:

```ts
export function scrollToLine(view: EditorView, line: number): void {
  if (line < 1 || line > view.state.doc.lines) return;
  const pos = view.state.doc.line(line).from;
  const block = view.lineBlockAt(pos);
  const scroller = view.scrollDOM;
  scroller.scrollTop = Math.max(0, block.top - scroller.clientHeight / 2 + block.height / 2);
}

export function showIp(view: EditorView, line: number | null): void {
  view.dispatch({ effects: setIpLine.of(line) });
  if (line !== null) scrollToLine(view, line);
}
```

- [ ] **Step 2: Footer version**

`vite.config.ts` — in the `lib-versions` plugin's `load`, read the vendored manifest and export one more constant:

```ts
const toolchains = JSON.parse(readFileSync('./vendor/mtc-wasm/manifest.json', 'utf-8')).toolchains_version as string;
// … append to the returned source:
// export const toolchainsVersion = ${JSON.stringify(toolchains)};
```

`src/vite-env.d.ts` — add `export const toolchainsVersion: string;` to the `virtual:lib-versions` declaration.

- [ ] **Step 3: App wiring**

`src/App.svelte`:
- import `ToolchainView` and `toolchainsVersion`; import `isToolchainEngine` and `ENGINES` from `./lib/types.ts`.
- Replace the two hard-coded tab buttons with a loop over `TAB_LABELS`:

```ts
  const TAB_LABELS: Record<Engine, string> = { turing: 'Turing', post: 'Post', pm1: 'PM-1', tm1: 'TM-1' };
```

```svelte
  <nav class="tabs">
    {#each ENGINES as engine (engine)}
      <button
        type="button"
        class:active={route.kind === 'engine' && route.engine === engine}
        aria-current={route.kind === 'engine' && route.engine === engine ? 'page' : undefined}
        onclick={() => selectRoute({ kind: 'engine', engine })}
      >{TAB_LABELS[engine]}</button>
    {/each}
  </nav>
```

- Mount:

```svelte
    {#key route.engine}
      {#if isToolchainEngine(route.engine)}
        <ToolchainView engine={route.engine} />
      {:else}
        <MachineView engine={route.engine} />
      {/if}
    {/key}
```

- Footer: after the visuals link, a separator and

```svelte
    <a href="https://github.com/mellonis/machine-toolchains" target="_blank" rel="noopener" title="machine-toolchains on GitHub">toolchains v{toolchainsVersion}</a>
```

(the footer already links to GitHub for the repo; this is UI chrome, not published documentation).

- [ ] **Step 4: Write the orchestrator**

`src/components/ToolchainView.svelte`:

```svelte
<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { EditorView } from '@codemirror/view';
  import type { Extension } from '@codemirror/state';
  import TapesStack from './TapesStack.svelte';
  import Toolbar from './Toolbar.svelte';
  import ControlPanel from './ControlPanel.svelte';
  import FileTabs from './FileTabs.svelte';
  import Log from './Log.svelte';
  import { LogStore } from '../lib/logStore.svelte.ts';
  import ToolchainWorker from '../lib/toolchain/toolchainWorker.ts?worker';
  import { ToolchainRunner, ToolchainTimeoutError } from '../lib/toolchain/toolchainRunner.ts';
  import { BELT_ANIMATION_MIN_INTERVAL_MS, MAX_TAPES, VIEWPORT_WIDTH } from '../lib/caps.ts';
  import { CARET_COLORS } from '../lib/caretColors.ts';
  import type { Command, ToolchainEngine } from '../lib/types.ts';
  import {
    TOOLCHAIN_ARCH, langFor, extOf,
    type BufferKind, type Diagnostic, type ExampleSeed, type FinishedResponse, type LineMap, type PausedResponse,
    type ProgressResponse, type SeedTape, type SourceFile, type SourceTab, type SteppedResponse, type TapeLayout, type TapeSnapshot,
  } from '../lib/toolchain/types.ts';
  import {
    applyCommand, cellAt, emptySeed, findStdDefinition, headDelta, indexStdExports, layoutsEqual, seedCellAt,
    seedFromGlyphs, seedFromSnapshot, seedFromWasm, seedToGlyphs, seedToLibTape, seedToWasm, snapshotToLibTape, type StdExport,
  } from '../lib/toolchain/toolchainHelpers.ts';
  import { toolchainLinter } from '../lib/toolchain/editor/lint.ts';
  import { stdCompletion } from '../lib/toolchain/editor/stdCompletion.ts';
  import { stdLink } from '../lib/toolchain/editor/stdLink.ts';
  import { breakpointGutter, refreshBreakpoints } from '../lib/toolchain/editor/breakpointGutter.ts';
  import { ipHighlight, scrollToLine, showIp } from '../lib/toolchain/editor/ipHighlight.ts';
  import { downloadBlob } from '../lib/toolchain/download.ts';
  import { parseInterval } from '../lib/interval.ts';
  import { parse as parseSnapshot, serialize as serializeSnapshot } from '../lib/tapeSnapshot.ts';
  import { defaultExample, examples, findExample, type Example } from '../lib/defaultCode.ts';
  import { computeInitialBoot } from '../lib/initialBoot.ts';
  import {
    loadCode, loadExampleId, saveExampleId, loadSnippets, saveSnippet, deleteSnippet, renameSnippet,
    loadDebugMode, saveDebugMode, loadSeeds, saveSeeds, loadKind, saveKind, type Snippets,
  } from '../lib/persist.ts';
  import { icons } from '../lib/icons.ts';

  type Props = { engine: ToolchainEngine };
  let { engine }: Props = $props();

  type ExecutionMode = 'MANUAL' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS' | 'RUNNING_PAUSED' | 'HALTED';

  /* ───── boot ───── */
  const arch = untrack(() => TOOLCHAIN_ARCH[engine]);
  const engineExamples = untrack(() => examples(engine));
  const initialExample = untrack(() => {
    const persistedId = loadExampleId(engine);
    return (persistedId && findExample(engine, persistedId)) || defaultExample(engine);
  });
  const initialSnippets = untrack(() => loadSnippets(engine));
  let snippets = $state<Snippets>(initialSnippets);
  const initial = untrack(() =>
    computeInitialBoot({ engine, url: new URL(window.location.href), snippets: initialSnippets, loadedCode: loadCode(engine), initialExample }),
  );
  let selectedExampleId = $state<string>(initial.selectedExampleId);
  let loadedSnippetId = $state<string | null>(initial.loadedSnippetId);
  let code = $state<string>(initial.code);
  // Kind and seeds follow the same boot tier as the code: example → snippet → localStorage → the example's own.
  let kind = $state<BufferKind>(untrack(() => {
    if (initial.loadedSnippetId !== null) return initialSnippets[initial.loadedSnippetId]?.kind ?? 'source';
    if (initial.code === (findExample(engine, initial.selectedExampleId) ?? initialExample).code) return (findExample(engine, initial.selectedExampleId) ?? initialExample).kind ?? 'source';
    return loadKind(engine) ?? 'source';
  }));
  // Glyph seeds waiting for the first successful Build (the band layouts).
  let pendingSeedGlyphs: ExampleSeed[] | null = untrack(() => {
    if (initial.loadedSnippetId !== null) return initialSnippets[initial.loadedSnippetId]?.seeds ?? [];
    if (initial.code === (findExample(engine, initial.selectedExampleId) ?? initialExample).code) return (findExample(engine, initial.selectedExampleId) ?? initialExample).seeds ?? [];
    return loadSeeds(engine) ?? initialExample.seeds ?? [];
  });
  // The other kind's buffer, kept for the page's lifetime so switching back restores it.
  const otherBuffer: Record<BufferKind, string | null> = { source: null, asm: null };

  /* ───── state ───── */
  let executionMode = $state<ExecutionMode>('MANUAL');
  let pendingOp = $state<'load' | 'run' | null>(null);
  let workerLive = $state(false);
  let builtSource = $state<string | null>(null);
  let builtLang = $state<string | null>(null);
  let tapes = $state<TapeLayout[]>([]);
  let seeds = $state<SeedTape[]>([]);
  let lastSnapshots = $state<TapeSnapshot[] | null>(null);
  let lineMap = $state<LineMap | null>(null);
  let stdText = $state<string>('');
  let stdExports = $state<StdExport[]>([]);
  let activeTab = $state<SourceTab>('main');
  let ipLoc = $state<{ file: SourceFile; line: number | null; fn: string } | null>(null);
  let withPause = $state(false);
  let debugMode = $state<boolean>(untrack(() => loadDebugMode(engine)));
  let intervalText = $state('1s');
  let stopRequested = false;
  let takeControlRequested = false;
  let codeChangedWarned = false;
  // Breakpoints keyed "<file>:<line>" — user intent, kept across builds; resolved to addresses at Build / start.
  const breakpoints = new SvelteSet<string>();
  let mainView: EditorView | null = null;
  let stdView: EditorView | null = null;
  let tapesStackRef = $state<ReturnType<typeof TapesStack> | undefined>();
  let panelRef = $state<ReturnType<typeof ControlPanel> | undefined>();
  let tapeBlockInputEl = $state<HTMLInputElement | undefined>(undefined);
  const log = new LogStore();
  const editorPromise = import('./Editor.svelte').then((m) => m.default);
  const runner = new ToolchainRunner(() => new ToolchainWorker());
  runner.onUncorrelatedError = (msg) => log.report(`error: ${msg}`, 'error');
  runner.onFatal = () => { workerLive = false; log.report('toolchain module crashed — restarting the worker', 'error'); };

  /* ───── derived ───── */
  const lang = $derived(langFor(engine, kind));
  const ext = $derived(extOf(lang));
  const srcExt = $derived(`${arch}c`);
  const alphabets = $derived(tapes.map((t) => t.glyphs));
  const tapeCount = $derived(Math.max(1, tapes.length));
  const showTapeLabels = $derived(tapeCount > 1);
  const intervalMs = $derived(parseInterval(intervalText));
  const intervalIsValid = $derived(intervalMs !== null);
  const latestEntry = $derived(log.latest);
  const panelEnabled = $derived(executionMode === 'MANUAL' && tapes.length > 0);
  const applyVisible = $derived(executionMode === 'MANUAL');
  const takeControlVisible = $derived(executionMode !== 'MANUAL' && executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const pasteEnabled = $derived(executionMode === 'MANUAL' && tapes.length > 0);
  const tapeBlockEnabled = $derived((executionMode === 'MANUAL' || executionMode === 'HALTED') && workerLive && pendingOp === null);
  const beltTransitionsOn = $derived(executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const selectedExample = $derived(findExample(engine, selectedExampleId) ?? defaultExample(engine));
  const sourceCode = $derived.by(() => {
    if (loadedSnippetId !== null) return snippets[loadedSnippetId]?.code ?? null;
    return selectedExample.code;
  });
  const dirty = $derived(sourceCode !== null && code !== sourceCode);
  const resetVisible = $derived(dirty);
  const staleBuild = $derived(builtSource !== null && (code !== builtSource || builtLang !== lang));
  const resetTitle = $derived(loadedSnippetId !== null && loadedSnippetId in snippets ? `Reset to "${snippets[loadedSnippetId].title}"` : 'Reset to selected example');
  const loadDisabled = $derived(pendingOp !== null);
  const stepDisabled = $derived((pendingOp !== null && executionMode !== 'RUNNING_PAUSED' && executionMode !== 'RUNNING_AUTO') || executionMode === 'RUNNING_CONTINUOUS');
  const runDisabled = $derived((pendingOp !== null && executionMode !== 'RUNNING_PAUSED') || executionMode === 'RUNNING_AUTO' || executionMode === 'RUNNING_CONTINUOUS' || (withPause && !intervalIsValid));
  const kindSwitchEnabled = $derived(pendingOp === null && executionMode !== 'RUNNING_AUTO' && executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const mainTitle = $derived(loadedSnippetId !== null ? snippets[loadedSnippetId]?.title ?? 'main' : selectedExampleId);

  /* ───── breakpoints ───── */
  const bpKey = (file: SourceFile, line: number) => `${file}:${line}`;
  function tableFor(file: SourceFile): (number | null)[] { return file === 'std' ? lineMap?.stdLineToAddr ?? [] : lineMap?.userLineToAddr ?? []; }
  function canSet(file: SourceFile, line: number): boolean { return (tableFor(file)[line] ?? null) !== null; }
  function resolveBreakpoints(): number[] {
    const out: number[] = [];
    for (const key of breakpoints) {
      const [file, l] = key.split(':') as [SourceFile, string];
      const addr = tableFor(file)[Number(l)] ?? null;
      if (addr !== null) out.push(addr);
    }
    return out;
  }
  function toggleBreakpoint(file: SourceFile, line: number): void {
    const key = bpKey(file, line);
    if (breakpoints.has(key)) breakpoints.delete(key); else breakpoints.add(key);
    runner.setBreakpoints(resolveBreakpoints());
  }
  function pruneBreakpoints(): void {
    const dropped: string[] = [];
    for (const key of [...breakpoints]) {
      const [file, l] = key.split(':') as [SourceFile, string];
      if (!canSet(file, Number(l))) { breakpoints.delete(key); dropped.push(`${file === 'std' ? 'std' : 'main'}.${file === 'std' ? srcExt : ext}:${l}`); }
    }
    if (dropped.length > 0) log.report(`dropped breakpoint(s) with no instruction: ${dropped.join(', ')}`, 'warn');
    if (mainView) refreshBreakpoints(mainView);
    if (stdView) refreshBreakpoints(stdView);
  }
  function gutterFor(file: SourceFile): Extension {
    return breakpointGutter({
      has: (line) => breakpoints.has(bpKey(file, line)),
      canSet: (line) => canSet(file, line),
      onToggle: (line) => toggleBreakpoint(file, line),
      refuseTitle: 'no instruction on this line',
    });
  }

  /* ───── editor extensions ───── */
  const mainExtensions = $derived<Extension[]>([
    toolchainLinter(() => runner.check(lang, code)),
    stdCompletion(() => stdExports),
    stdLink(goToStd),
    gutterFor('user'),
    ipHighlight(),
  ]);
  const stdExtensions: Extension[] = [gutterFor('std'), ipHighlight(), stdLink(goToStd)];

  function onMainReady(view: EditorView): void { mainView = view; syncIp(); }
  function onStdReady(view: EditorView): void { stdView = view; syncIp(); }

  /* ───── rendering ───── */
  function locOf(ip: number): { file: SourceFile; line: number | null; fn: string } | null {
    const l = lineMap?.addrToLoc.find((x) => x.addr === ip);
    return l ? { file: l.file, line: l.line, fn: l.fn } : null;
  }
  function fileLabel(file: SourceFile): string { return file === 'std' ? `std.${srcExt}` : `main.${ext}`; }
  function locText(loc: { file: SourceFile; line: number | null; fn: string } | null): string {
    return loc ? `${fileLabel(loc.file)}:${loc.line ?? '?'} ${loc.fn}` : '?';
  }
  /** Re-applies the ip decoration to whichever views exist; follows the ip across files. */
  function syncIp(): void {
    const loc = ipLoc;
    if (mainView) showIp(mainView, loc && loc.file === 'user' ? loc.line : null);
    if (stdView) showIp(stdView, loc && loc.file === 'std' ? loc.line : null);
  }
  function setIp(ip: number | null): void {
    ipLoc = ip === null ? null : locOf(ip);
    if (ipLoc && ipLoc.line !== null) activeTab = ipLoc.file === 'std' ? 'std' : 'main';
    void tick().then(syncIp);
  }
  function renderSeeds(): void {
    seeds.forEach((s, i) => tapesStackRef?.setFromTape(i, seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH)));
  }
  function renderSnapshots(snaps: TapeSnapshot[], animate: boolean, prevHeads: number[] | null, prev: TapeSnapshot[] | null): void {
    snaps.forEach((snap, i) => {
      const prevHead = prevHeads?.[i] ?? snap.head;
      const delta = animate ? headDelta(prevHead, snap.head) : 0;
      const wrote = animate && prev !== null ? cellAt(prev[i], prevHead) !== cellAt(snap, prevHead) : false;
      tapesStackRef?.setFromTape(i, snapshotToLibTape(snap, VIEWPORT_WIDTH), delta, animate, wrote);
    });
    lastSnapshots = snaps;
  }
  function adoptSnapshots(snaps: TapeSnapshot[]): void {
    seeds = snaps.map(seedFromSnapshot);
    lastSnapshots = snaps;
  }

  /* ───── build ───── */
  function posToLine(d: Diagnostic, source: string): number { return source.slice(0, d.from).split('\n').length; }

  async function reloadWorker(): Promise<boolean> {
    pendingOp = 'load';
    const source = code;
    const builtWith = lang;
    try {
      if (stdText === '' || builtLang === null || builtLang[0] !== builtWith[0]) {
        stdText = await runner.stdlib(builtWith);
        stdExports = indexStdExports(builtWith, stdText);
      }
      const res = await runner.build(builtWith, source);
      if (!res.ok) {
        for (const d of res.diagnostics) log.report(`${d.severity === 'error' ? 'build failed' : 'warning'}: ${d.message} (line ${posToLine(d, source)})`, d.severity === 'error' ? 'error' : 'warn');
        return false;
      }
      for (const d of res.diagnostics) log.report(`warning: ${d.message} (line ${posToLine(d, source)})`, 'warn');
      workerLive = true;
      builtSource = source;
      builtLang = builtWith;
      lineMap = res.lineMap;
      if (pendingSeedGlyphs !== null) {
        const glyphSeeds = pendingSeedGlyphs;
        pendingSeedGlyphs = null;
        seeds = res.tapes.map((t, i) => {
          const g = glyphSeeds[i];
          if (!g) return emptySeed();
          try { return seedFromGlyphs(t.glyphs, g); } catch (err) { log.report(`seed for band ${t.name} ignored: ${(err as Error).message}`, 'error'); return emptySeed(); }
        });
      } else if (!layoutsEqual(tapes, res.tapes)) {
        if (tapes.length > 0) log.report("seeds reset — the program's bands changed", 'warn');
        seeds = res.tapes.map(() => emptySeed());
      }
      tapes = res.tapes;
      lastSnapshots = null;
      setIp(null);
      activeTab = 'main';
      await tick();
      renderSeeds();
      pruneBreakpoints();
      runner.setBreakpoints(resolveBreakpoints());
      runner.setDebug(debugMode);
      return true;
    } catch (err) {
      workerLive = false;
      log.report(`error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    } finally {
      pendingOp = null;
    }
  }

  async function doLoad(): Promise<void> {
    log.reportSeparator();
    log.report('building…');
    const ok = await reloadWorker();
    executionMode = 'MANUAL';
    if (!ok) return;
    log.report(`built — ${tapes.length} band(s): ${tapes.map((t) => t.name).join(', ')}`, 'ok');
    panelRef?.reflect(tapes.map(() => ({ movement: 'S', symbol: null }) as Command));
  }

  /* ───── run ───── */
  function causeText(p: PausedResponse): string {
    if (p.cause === 'brk') return 'debugger';
    if (p.cause === 'manual') return 'manual';
    if (p.cause === 'step') return 'step';
    if (typeof p.cause === 'object' && 'breakpoint' in p.cause) return 'breakpoint';
    return 'trap';
  }
  let prevHeads: number[] | null = null;

  function onStepped(r: SteppedResponse): void {
    const animate = executionMode !== 'RUNNING_AUTO' || (intervalMs !== null && intervalMs >= BELT_ANIMATION_MIN_INTERVAL_MS);
    renderSnapshots(r.snapshots, animate, prevHeads, lastSnapshots);
    prevHeads = r.snapshots.map((s) => s.head);
    setIp(r.ip);
    if (r.retired) log.report(`step ${r.stats.steps}: ${locText(ipLoc)}`);
    if (executionMode !== 'RUNNING_AUTO') executionMode = 'RUNNING_PAUSED';
  }
  function onPaused(r: PausedResponse): void {
    renderSnapshots(r.snapshots, false, null, null);
    prevHeads = r.snapshots.map((s) => s.head);
    setIp(r.ip);
    log.report(`paused at ${locText(ipLoc)?.replace(' ', ' in ') ?? '?'} (${causeText(r)})`, 'pause');
    executionMode = 'RUNNING_PAUSED';
  }
  function onProgress(r: ProgressResponse): void {
    renderSnapshots(r.snapshots, false, null, null);
  }
  function onFinished(f: FinishedResponse): void {
    renderSnapshots(f.snapshots, false, null, null);
    adoptSnapshots(f.snapshots);
    const o = f.result.outcome;
    if (takeControlRequested) {
      takeControlRequested = false;
      log.report('user took control', 'ok');
      setIp(null);
      executionMode = 'MANUAL';
      return;
    }
    if (o.kind === 'trapped') {
      if (o.trap.kind === 'step-limit') log.report(`truncated at ${f.result.stats.steps} steps (limit hit)`, 'warn');
      else log.report(`trapped: ${o.trap.kind} — ${o.trap.detail} at ${locText(locOf(o.trap.at ?? f.result.ip))}`, 'abort');
      setIp(o.trap.at ?? f.result.ip);
    } else {
      if (!stopRequested) log.report(`${o.kind} after ${f.result.stats.steps} step(s)`, 'ok');
      setIp(null);
    }
    stopRequested = false;
    executionMode = 'HALTED';
  }
  function failHalted(err: unknown): void {
    if (takeControlRequested) { takeControlRequested = false; executionMode = 'MANUAL'; return; }
    const msg = err instanceof Error ? err.message : String(err);
    log.report(`error: ${msg}`, 'error');
    if (err instanceof ToolchainTimeoutError && err.progress) {
      renderSnapshots(err.progress.snapshots, false, null, null);
      adoptSnapshots(err.progress.snapshots);
      log.report(`tape shows step ${err.progress.steps} — last snapshot before termination`);
    }
    workerLive = false;
    setIp(null);
    executionMode = 'HALTED';
  }

  async function startRun(mode: 'step' | 'auto' | 'continuous'): Promise<void> {
    log.reportSeparator();
    log.report('building…');
    const ok = await reloadWorker();
    if (!ok) { executionMode = 'MANUAL'; return; }
    codeChangedWarned = false;
    prevHeads = seeds.map((s) => s.head);
    lastSnapshots = null;
    executionMode = mode === 'step' ? 'RUNNING_PAUSED' : mode === 'auto' ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
    log.report(mode === 'step' ? 'running step by step…' : mode === 'auto' ? `running, auto-stepping every ${intervalMs}ms` : 'running…');
    pendingOp = 'run';
    try {
      const f = await runner.start(
        { seeds: seeds.map(seedToWasm), breakpoints: resolveBreakpoints(), mode, intervalMs: mode === 'auto' ? (intervalMs ?? undefined) : undefined },
        { onStepped, onPaused, onProgress },
      );
      onFinished(f);
    } catch (err) {
      failHalted(err);
    } finally {
      pendingOp = null;
    }
  }

  function doStep(): void {
    if (executionMode === 'RUNNING_PAUSED') { runner.resume('step'); return; }
    if (executionMode === 'RUNNING_AUTO') { runner.pause(); return; }
    void startRun('step');
  }
  function doRun(): void {
    if (executionMode === 'RUNNING_PAUSED') {
      const mode = withPause ? 'auto' : 'continuous';
      runner.resume(mode, withPause ? (intervalMs ?? undefined) : undefined);
      executionMode = withPause ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
      return;
    }
    void startRun(withPause ? 'auto' : 'continuous');
  }
  function stopMachine(): void {
    if (runner.runPending) { stopRequested = true; log.report('stopped', 'warn'); runner.stop(); return; }
    executionMode = 'HALTED';
    log.report('stopped', 'warn');
  }
  function takeControl(): void {
    if (runner.runPending) { takeControlRequested = true; runner.stop(); return; }
    log.report('user took control', 'ok');
    executionMode = 'MANUAL';
  }

  /* ───── panel / tapes ───── */
  function onApply(commands: Command[]): void {
    if (commands.length !== seeds.length) return;
    try {
      const next = seeds.map((s, i) => applyCommand(s, alphabets[i], commands[i]));
      next.forEach((s, i) => {
        const prev = seeds[i];
        tapesStackRef?.setFromTape(i, seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH), headDelta(prev.head, s.head), true, seedCellAt(prev, prev.head) !== seedCellAt(s, prev.head));
      });
      seeds = next;
      log.report(`applied ${commands.map((c) => `${c.symbol === null ? '·' : `'${c.symbol}'`}/${c.movement}`).join(' ')}`);
    } catch (err) {
      log.report(`apply failed: ${(err as Error).message}`, 'error');
    }
  }
  async function onCopy(): Promise<void> {
    if (tapes.length === 0) { log.report('copy failed: no tape state to copy', 'error'); return; }
    try {
      const libTapes = seeds.map((s, i) => seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH));
      await navigator.clipboard.writeText(serializeSnapshot(libTapes.map((t) => ({ symbols: t.symbols, position: t.position })), alphabets));
      log.report(`copied ${seeds.length}-tape snapshot`, 'ok');
    } catch { log.report('copy failed: clipboard unavailable', 'error'); }
  }
  async function onPaste(): Promise<void> {
    let text: string;
    try { text = await navigator.clipboard.readText(); } catch { log.report('paste failed: clipboard unavailable', 'error'); return; }
    const result = parseSnapshot(text);
    if ('reason' in result) { log.report(`paste failed: ${result.reason === 'wrong-shape' ? `malformed — ${result.detail}` : result.reason.replace(/-/g, ' ')}`, 'error'); return; }
    if (result.tapes.length !== tapes.length || result.tapes.length > MAX_TAPES) { log.report(`paste failed: snapshot has ${result.tapes.length} tape(s), program has ${tapes.length}`, 'error'); return; }
    try {
      seeds = result.tapes.map((t, i) => seedFromGlyphs(alphabets[i], { cells: t.symbols, origin: 0, head: t.position }));
      renderSeeds();
      log.report(`pasted ${seeds.length}-tape snapshot`, 'ok');
    } catch (err) { log.report(`paste failed: ${(err as Error).message}`, 'error'); }
  }
  async function onLoadTapeBlock(file: File): Promise<void> {
    try {
      const wasm = await runner.decodeTapeBlock(new Uint8Array(await file.arrayBuffer()));
      seeds = tapes.map((_, i) => (wasm[i] ? seedFromWasm(wasm[i]) : emptySeed()));
      renderSeeds();
      if (executionMode === 'HALTED') executionMode = 'MANUAL';
      log.report(`loaded tape block "${file.name}": ${wasm.length} band(s)`, 'ok');
    } catch (err) { log.report(`load tape block failed: ${(err as Error).message}`, 'error'); }
  }
  async function onSaveTapeBlock(): Promise<void> {
    try {
      const bytes = await runner.encodeTapeBlock(seeds.map((s, i) => ({ ...seedToWasm(s), glyphs: [...alphabets[i]] })));
      const name = `${mainTitle}.${arch}t`;
      downloadBlob(name, new Blob([bytes], { type: 'application/octet-stream' }));
      log.report(`saved tape block ${name}`, 'ok');
    } catch (err) { log.report(`save tape block failed: ${(err as Error).message}`, 'error'); }
  }

  /* ───── editor actions ───── */
  async function onFormat(): Promise<void> {
    try {
      const r = await runner.format(lang, code);
      if (!r.ok) { log.report(`format failed: ${r.error.message} (line ${posToLine(r.error, code)})`, 'error'); return; }
      if (mainView) mainView.dispatch({ changes: { from: 0, to: mainView.state.doc.length, insert: r.text } });
      else code = r.text;
      log.report('formatted', 'ok');
    } catch (err) { log.report(`format failed: ${(err as Error).message}`, 'error'); }
  }
  async function onKindChange(next: BufferKind): Promise<void> {
    if (next === kind) return;
    otherBuffer[kind] = code;
    const kept = otherBuffer[next];
    if (kept !== null && kept !== '') { kind = next; code = kept; return; }
    if (next === 'asm' && workerLive && builtSource !== null) {
      try {
        const text = await runner.disassemble();
        kind = next; code = text;
        log.report(`disassembled last Build into main.${extOf(langFor(engine, next))}`, 'ok');
        return;
      } catch (err) { log.report(`disassemble failed: ${(err as Error).message}`, 'error'); }
    }
    kind = next;
    code = '';
  }
  async function onOpenFile(file: File): Promise<void> {
    const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
    const fileKind: BufferKind | null = fileExt === `${arch}c` ? 'source' : fileExt === `${arch}a` ? 'asm' : null;
    if (fileKind === null) { log.report(`cannot open ${file.name}: not a ${arch === 'pm' ? 'PM-1' : 'TM-1'} source`, 'error'); return; }
    const text = await file.text();
    kind = fileKind;
    code = text;
    loadedSnippetId = null;
    log.report(`opened ${file.name}`, 'ok');
  }
  function onSaveFile(): void {
    const name = `${mainTitle}.${ext}`;
    downloadBlob(name, new Blob([code], { type: 'text/plain' }));
    log.report(`saved ${name}`, 'ok');
  }
  function goToStd(name: string): void {
    activeTab = 'std';
    const def = findStdDefinition(stdExports, name);
    void tick().then(() => {
      if (!stdView) return;
      if (def) { stdView.dispatch({ selection: { anchor: stdView.state.doc.line(def.line).from } }); scrollToLine(stdView, def.line); }
      else log.report(`no definition found for std::${name}`, 'warn');
    });
  }

  /* ───── examples / snippets (parity with MachineView) ───── */
  function resetCodeToSelected(): void {
    if (loadedSnippetId !== null) { const s = snippets[loadedSnippetId]; if (s) code = s.code; return; }
    code = selectedExample.code;
  }
  function pickExample(ex: Example): void {
    selectedExampleId = ex.id;
    kind = ex.kind ?? 'source';
    code = ex.code;
    loadedSnippetId = null;
    pendingSeedGlyphs = ex.seeds ?? [];
  }
  function currentSeedGlyphs(): ExampleSeed[] { return seeds.map((s, i) => seedToGlyphs(alphabets[i] ?? [' '], s)); }
  function onSaveSnippet(title: string): void {
    const { id, snippet } = saveSnippet(engine, title, code, { kind, seeds: currentSeedGlyphs() });
    snippets = { ...snippets, [id]: snippet };
    loadedSnippetId = id;
  }
  function onSaveChanges(): void {
    if (loadedSnippetId === null) return;
    const existing = snippets[loadedSnippetId];
    if (!existing) return;
    const { id, snippet } = saveSnippet(engine, existing.title, code, { kind, seeds: currentSeedGlyphs() });
    snippets = { ...snippets, [id]: snippet };
    log.report(`saved "${existing.title}"`, 'ok');
  }
  function onLoadSnippet(id: string): void {
    const s = snippets[id];
    if (!s) return;
    kind = s.kind ?? 'source';
    code = s.code;
    loadedSnippetId = id;
    pendingSeedGlyphs = s.seeds ?? [];
  }
  function onDeleteSnippet(id: string): void {
    deleteSnippet(engine, id);
    const { [id]: _, ...rest } = snippets;
    snippets = rest;
  }
  function onRenameSnippet(id: string, newTitle: string): void {
    if (!renameSnippet(engine, id, newTitle)) return;
    snippets = { ...loadSnippets(engine) };
  }

  /* ───── effects ───── */
  $effect(() => { saveDebugMode(engine, debugMode); });
  $effect(() => { if (workerLive) runner.setDebug(debugMode); });
  $effect(() => { saveExampleId(engine, selectedExampleId); });
  $effect(() => { saveKind(engine, kind); });
  $effect(() => { if (tapes.length > 0) saveSeeds(engine, currentSeedGlyphs()); });
  $effect(() => {
    const url = new URL(window.location.href);
    if (loadedSnippetId !== null) url.searchParams.set('snippet', loadedSnippetId); else url.searchParams.delete('snippet');
    url.searchParams.delete('example');
    history.replaceState(null, '', url);
  });
  $effect(() => { tapesStackRef?.setTransitionsEnabled(beltTransitionsOn); });
  $effect(() => {
    void code;
    untrack(() => {
      if ((executionMode === 'RUNNING_AUTO' || executionMode === 'RUNNING_CONTINUOUS' || executionMode === 'RUNNING_PAUSED') && !codeChangedWarned) {
        codeChangedWarned = true;
        log.report('code changed — current execution continues from the last Build', 'warn');
      }
    });
  });

  onMount(() => {
    if (initial.badExampleId !== null) log.report(`example not found: ${initial.badExampleId}`, 'error');
    if (initial.badUrlId !== null) log.report(`snippet not found: ${initial.badUrlId}`, 'error');
    void doLoad();
  });
  onDestroy(() => { runner.terminate(); log.dispose(); });
</script>

<section class="tab">
  <h1 class="sr-only">{engine === 'pm1' ? 'PM-1 Post machine toolchain demo' : 'TM-1 Turing machine toolchain demo'}</h1>
  <div class="panel-tape">
    <TapesStack bind:this={tapesStackRef} {tapeCount} caretColors={CARET_COLORS}>
      {#snippet actions()}
        <input
          type="file"
          class="visually-hidden"
          data-testid="tape-block-input"
          accept=".pmt,.tmt"
          bind:this={tapeBlockInputEl}
          onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) void onLoadTapeBlock(f); (e.currentTarget as HTMLInputElement).value = ''; }}
        />
        <button class="tape-action-btn" type="button" disabled={!tapeBlockEnabled} title="Load tape block" aria-label="Load tape block" onclick={() => tapeBlockInputEl?.click()}>{@html icons.tapeImport}</button>
        <button class="tape-action-btn" type="button" disabled={!tapeBlockEnabled} title="Save tape block" aria-label="Save tape block" onclick={onSaveTapeBlock}>{@html icons.tapeExport}</button>
      {/snippet}
    </TapesStack>

    <div class="panel-enter-clip">
      <ControlPanel bind:this={panelRef} {alphabets} enabled={panelEnabled} {applyVisible} {showTapeLabels} caretColors={CARET_COLORS} {onApply} />
    </div>

    <div class="tape-actions">
      {#if takeControlVisible}
        <button class="take-control" type="button" onclick={takeControl}>{@html icons.takeControl}<span class="btn-label">Take control</span></button>
      {/if}
      <button class="tape-action-btn" type="button" onclick={onCopy} title="Copy tape state" aria-label="Copy tape state">{@html icons.copy}</button>
      <button class="tape-action-btn" type="button" onclick={onPaste} disabled={!pasteEnabled} title="Paste tape state" aria-label="Paste tape state">{@html icons.clipboard}</button>
    </div>

    <Log entries={log.entries} onClear={() => log.clear()} />
  </div>

  <div class="panel-editor">
    <Toolbar
      {executionMode} {loadDisabled} {stepDisabled} {runDisabled} {intervalIsValid}
      examples={engineExamples} {selectedExampleId}
      bind:withPause bind:debugMode bind:intervalText
      onBuild={() => doLoad()} onStep={doStep} onRun={doRun} onStop={stopMachine} onPickExample={pickExample}
      {snippets} {loadedSnippetId} {dirty} {staleBuild}
      {onSaveSnippet} {onSaveChanges} {onLoadSnippet} {onDeleteSnippet} {onRenameSnippet}
      {onFormat} {onOpenFile} {onSaveFile}
    />
    <div class="status" role="status" aria-live="polite"
      class:error={latestEntry?.kind === 'error'} class:warn={latestEntry?.kind === 'warn'} class:ok={latestEntry?.kind === 'ok'} class:abort={latestEntry?.kind === 'abort'}>
      {latestEntry?.text ?? ''}
    </div>
    <FileTabs active={activeTab} {arch} {kind} {kindSwitchEnabled} onSelect={(t) => { activeTab = t; void tick().then(syncIp); }} onKindChange={(k) => void onKindChange(k)} />
    {#await editorPromise}
      <div class="editor-loading">Loading editor…</div>
    {:then Editor}
      {#if activeTab === 'main'}
        <Editor {engine} bind:code onReset={resetCodeToSelected} {resetVisible} {resetTitle} {lang} extensions={mainExtensions} onReady={onMainReady} />
      {:else}
        <Editor {engine} code={stdText} onReset={() => {}} resetVisible={false} lang={langFor(engine, 'source')} extensions={stdExtensions} readOnly onReady={onStdReady} />
      {/if}
    {:catch err}
      <div class="editor-error">Failed to load editor: {err.message}</div>
    {/await}
  </div>
</section>

<style>
  /* Layout mirrors MachineView.svelte's .tab / .panel-tape / .panel-editor / .tape-actions /
     .tape-action-btn / .take-control / .editor-loading / .editor-error / .status rules —
     copy those blocks verbatim from MachineView.svelte (lines 545–760 at the time of writing),
     omitting the .machine-graph-row and .graph-dialog rules. */
</style>
```

When the std tab unmounts the main editor, `mainView` goes stale: set `mainView = null` in the `{:else}` branch by handling it in `onSelect` — simplest is `onSelect={(t) => { if (t === 'std') mainView = null; else stdView = null; activeTab = t; void tick().then(syncIp); }}`. Apply that in the markup above.

- [ ] **Step 5: Build, check, lint, run everything**

Run: `npm run check && npm run lint && npm test && npm run build`
Expected: green; `dist/` contains a hashed `mtc_wasm_bg-*.wasm` asset and a worker chunk that imports it. Then `npm run dev`, open `/pm1` and `/tm1`, and walk: Build → Step → Run → breakpoint via gutter → Format → kind switch → tape block Save/Load → std tab via Cmd-click on `std::goToEnd`. Fix what the walk finds before the e2e task.

- [ ] **Step 6: Commit**

```bash
git add src/components/ToolchainView.svelte src/lib/toolchain/download.ts src/lib/toolchain/toolchainHelpers.ts src/lib/toolchain/toolchainHelpers.test.ts src/lib/toolchain/editor/ipHighlight.ts src/App.svelte vite.config.ts src/vite-env.d.ts
git commit -m "feat(toolchain): ToolchainView orchestrator for /pm1 and /tm1; header tabs and footer version"
```

---
### Task 13: End-to-end specs

**Files:**
- Create: `e2e/toolchain-pm1.spec.ts`, `e2e/toolchain-tm1.spec.ts`, `e2e/no-wasm-on-js-pages.spec.ts`

**Interfaces:**
- Consumes the log vocabulary from Task 12, the accessible names from Tasks 9 and 11, `data-testid`s `tapes-stack`, `tape`, `tape-cell`, `log-line`, `open-file-input`, `tape-block-input`, `file-tabs`, and the CodeMirror classes `.cm-content`, `.cm-bp-gutter .cm-gutterElement`, `.cm-bp-marker`, `.cm-ip-line`.
- Example boot: `/pm1` mounts `unary-increment` (seed `* * *`, head 0 → final `* * * *`); `/tm1` mounts `binary-increment` (seed `0 1 1`, head 2 → final `1 0 0`).

- [ ] **Step 1: Write the specs**

`e2e/toolchain-pm1.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

/** Replace the main buffer. insertText bypasses the CodeMirror keymap. */
async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
const logLine = (page: Page, re: RegExp) => page.getByTestId('log-line').filter({ hasText: re });
const cells = (page: Page) => page.getByTestId('tape').first().getByTestId('tape-cell');
const nonBlank = async (page: Page) => (await cells(page).allInnerTexts()).filter((s) => s.trim() !== '');

const UNARY_INCREMENT = '// Unary increment: append one mark to a run of marks.\n// The head starts on the first mark; the run grows by one on the right.\nmain() {\n    @std::goToEnd();\n    mark;\n    @std::goToBegin();\n}\n';

test.describe('PM-1 page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/pm1');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): tape$/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-boot: the first example builds and seeds the tape with three marks', async ({ page }) => {
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
    await expect(page.getByRole('tab', { name: 'main.pmc' })).toHaveAttribute('aria-selected', 'true');
  });

  test('E-tc-build-error: a syntax error fails the Build with a positioned error and the counter pill', async ({ page }) => {
    await setEditorText(page, 'main() {\n    mark;\n');
    await expect(page.locator('[data-testid="diag-pill"][data-severity="error"]')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^build failed: .* \(line \d+\)$/)).toBeVisible({ timeout: 10_000 });
    await setEditorText(page, UNARY_INCREMENT);
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\)/).nth(1)).toBeVisible({ timeout: 10_000 });
  });

  test('E-tc-run: Run to completion appends one mark', async ({ page }) => {
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);
  });

  test('E-tc-step: Step pauses, highlights the ip line, and Continue runs to the end', async ({ page }) => {
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(logLine(page, /^step 1: main\.pmc:/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-step-into-std: stepping into std::goToEnd switches to the stdlib tab with the ip line highlighted', async ({ page }) => {
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: /^(step|continue)$/i }).first().click();
      await page.waitForTimeout(200);
      if (await page.getByRole('tab', { name: 'std.pmc' }).getAttribute('aria-selected') === 'true') break;
    }
    await expect(page.getByRole('tab', { name: 'std.pmc' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    await expect(logLine(page, /std\.pmc:\d+ in std::goToEnd/).first()).toBeVisible();
  });

  test('E-tc-breakpoint: a gutter click on `mark;` pauses the run there with debug on', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    // Line 5 is `    mark;` — gutter elements are 0-based.
    await page.locator('.cm-bp-gutter .cm-gutterElement').nth(4).dispatchEvent('mousedown');
    await expect(page.locator('.cm-bp-marker')).toHaveCount(1);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^paused at main\.pmc:5 in main \(breakpoint\)$/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-breakpoint-refused: a comment line cannot take a breakpoint', async ({ page }) => {
    await page.locator('.cm-bp-gutter .cm-gutterElement').nth(0).dispatchEvent('mousedown');
    await expect(page.locator('.cm-bp-marker')).toHaveCount(0);
    await expect(page.locator('.cm-bp-gutter .cm-gutterElement').nth(0)).toHaveAttribute('title', 'no instruction on this line');
  });

  test('E-tc-format: Format rewrites the buffer and lights the stale-build dot', async ({ page }) => {
    await setEditorText(page, 'main() {\n  @std::goToEnd();  mark;\n  @std::goToBegin();\n}\n');
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\)/).nth(1)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^format$/i }).click();
    await expect(logLine(page, /^formatted$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-content')).toContainText('mark;');
    await expect(page.getByRole('button', { name: /^build$/i })).toHaveAttribute('title', 'code changed since last Build');
  });

  test('E-tc-kind-switch: switching to assembly disassembles the last Build, which builds and runs to the same tape', async ({ page }) => {
    await page.getByLabel('Buffer language').selectOption('asm');
    await expect(logLine(page, /^disassembled last Build into main\.pma$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'main.pma' })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('.func main');
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);
  });

  test('E-tc-seed-persists: a seed edited on the panel survives a reload', async ({ page }) => {
    // Apply: write '*' and move right → four marks on the seed.
    await page.getByRole('button', { name: /^right$/i }).first().click();
    await page.getByRole('button', { name: /^'?\*'?$/ }).first().click();
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page.getByRole('button', { name: /^left$/i }).first().click();
    await page.getByRole('button', { name: /^'?\*'?$/ }).first().click();
    await page.getByRole('button', { name: /^apply$/i }).click();
    const before = await nonBlank(page);
    await page.reload();
    await expect(logLine(page, /^built — 1 band\(s\)/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(before);
  });

  test('E-tc-tapeblock-roundtrip: Save tape block then Load restores the seed', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save tape block' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.pmt$/);
    const path = await file.path();
    await expect(logLine(page, /^saved tape block /)).toBeVisible();
    // Blank the seed, then load the block back.
    await page.getByRole('button', { name: /^'? '?$|^blank$/i }).first().click().catch(() => {});
    await page.getByTestId('tape-block-input').setInputFiles(path!);
    await expect(logLine(page, /^loaded tape block ".*\.pmt": 1 band\(s\)$/)).toBeVisible({ timeout: 10_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
  });

  test('E-tc-std-tab: the stdlib tab is read-only and shows the library text', async ({ page }) => {
    await page.getByRole('tab', { name: 'std.pmc' }).click();
    await expect(page.locator('.cm-content')).toContainText('export goToEnd()');
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  });

  test('E-tc-std-completion: typing std:: offers the exported names', async ({ page }) => {
    await setEditorText(page, 'main() {\n    @std::');
    await page.keyboard.press('ControlOrMeta+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('goToEnd');
  });
});
```

`e2e/toolchain-tm1.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

const logLine = (page: Page, re: RegExp) => page.getByTestId('log-line').filter({ hasText: re });
const nonBlank = async (page: Page) => (await page.getByTestId('tape').first().getByTestId('tape-cell').allInnerTexts()).filter((s) => s !== '_' && s.trim() !== '');

test.describe('TM-1 page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/tm1');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): num$/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-tm-boot-run: binary increment of 011 gives 100', async ({ page }) => {
    expect(await nonBlank(page)).toEqual(['0', '1', '1']);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['1', '0', '0']);
  });

  test('E-tc-tm-multitape: the two-tape example shows two belts and copies src to dst', async ({ page }) => {
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Two-tape copy' }).click();
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 2 band\(s\): src, dst$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tape')).toHaveCount(2);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
    const dst = (await page.getByTestId('tape').nth(1).getByTestId('tape-cell').allInnerTexts()).filter((s) => s !== '_' && s.trim() !== '');
    expect(dst).toEqual(['0', '1', '1', '0']);
  });

  test('E-tc-tm-step-limit: a lowered maxSteps truncates the power-of-two run', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Max run steps').fill('20');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary power of two' }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^truncated at 20 steps \(limit hit\)$/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-tm-asm-example: the assembly example builds with image-labelled bands', async ({ page }) => {
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Binary increment (assembly)' }).click();
    await expect(page.getByRole('tab', { name: 'main.tma' })).toBeVisible();
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\): tape0$/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)$/)).toBeVisible({ timeout: 15_000 });
  });
});
```

`e2e/no-wasm-on-js-pages.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

for (const path of ['/turing', '/post']) {
  test(`E-tc-no-wasm-${path.slice(1)}: the JS engine page never requests the wasm bundle`, async ({ page }) => {
    const wasmRequests: string[] = [];
    page.on('request', (r) => { if (/\.wasm(\?|$)/.test(r.url())) wasmRequests.push(r.url()); });
    await page.goto(path);
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ })).toBeVisible({ timeout: 10_000 });
    expect(wasmRequests).toEqual([]);
  });
}
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:e2e`
Expected: green. Where a selector in these specs does not match the implementation from Task 12 (control-panel chip names, gutter indices after a whitespace change), fix the selector to the real accessible name or the log text to the vocabulary table — never by widening a regex to match anything.

- [ ] **Step 3: Commit**

```bash
git add e2e/toolchain-pm1.spec.ts e2e/toolchain-tm1.spec.ts e2e/no-wasm-on-js-pages.spec.ts
git commit -m "test(e2e): PM-1 / TM-1 pages — build, step, breakpoints, std tab, format, kind switch, tape blocks; no wasm on JS pages"
```

---
### Task 14: Documentation

**Files:**
- Modify: `CLAUDE.md` (file tree, new section)
- Modify: `docs/execution-model.md` (new section 13, `T-` prefix in §12)
- Modify: `README.md` (intro paragraph, Tech list)

- [ ] **Step 1: `CLAUDE.md`**

Add the new files to the tree (under `src/lib/` a `toolchain/` block mirroring the spec's file map; under `src/components/` `ToolchainView.svelte`, `FileTabs.svelte`, `TapesStack.test.ts`, `FileTabs.test.ts`; under `e2e/` the three specs; at the root `toolchains-wasm.json`, `scripts/fetch-toolchains-wasm.mjs`, `vendor/` gitignored). Add to **Commands**: `npm run fetch:wasm` and `npm run test:scripts`. Then a new section after **Machine graph**:

```markdown
## Toolchain engines (PM-1 / TM-1)

`/pm1` and `/tm1` are driven by the Rust toolchains compiled to WebAssembly — `mtc-wasm`, the browser bundle every machine-toolchains release attaches. The bundle is **pinned** in `toolchains-wasm.json` (tag + SHA-256 per file) and fetched by `scripts/fetch-toolchains-wasm.mjs` into the gitignored `vendor/mtc-wasm/` on `postinstall` (no-op when the cache verifies; `MTC_WASM_DIR=<unpacked bundle>` copies a local build instead and warns). Only `src/lib/toolchain/toolchainWorker.ts` imports the glue (alias `$mtc`), so the JS engine pages never load the wasm.

What differs from the JS engines:

- **Orchestrator**: `ToolchainView.svelte` (sibling of `MachineView.svelte`, which is untouched) over `ToolchainRunner` → `toolchainWorker.ts` → `ToolchainCore` (`workerCore.ts`, testable under Node against the real module via `testModule.ts`). Protocol in `src/lib/toolchain/types.ts`. Same five execution modes; Step is one `pump(1)` (one instruction, not one source-level transition), auto-run is `pump(1)` per interval, continuous is `pump(TOOLCHAIN_SLICE_BUDGET)` slices with a `progress` heartbeat and an event-loop yield between slices. See `docs/execution-model.md` (toolchain engines).
- **Tapes are UI-owned seeds** (`SeedTape`, sparse map of alphabet indices) in MANUAL; Rust snapshots while a session lives; snapshots copied back into seeds on HALTED / Take Control. Seeds persist per engine (`machines-demo:<engine>:seeds`, glyph form) and travel with examples and snippets. Tape blocks (`.pmt` / `.tmt`) load and save through the codec via the two icon buttons on the tape stack.
- **Buffer kind** `source | asm` per engine (`machines-demo:<engine>:kind`); `lang = arch × kind` (`pmc` / `pma` / `tmc` / `tma`). Switching to asm with a build behind it disassembles the last Build into the buffer; each kind's buffer is kept for the page's lifetime.
- **Editor is the debugger view**: two tabs (`FileTabs.svelte`) — the user's buffer and the read-only stdlib (`Toolchain.stdlibSource`, the exact text the module links). Breakpoints are keyed `"<file>:<line>"` and resolved to addresses through `LineMap` at Build / start (a line owns an address only if an instruction's `lineOf` names it — `addressForLine` snaps forward and is not used). The active tab follows the ip across `user` / `std`. Cmd/Ctrl-click on `std::name` jumps to its definition; `std::` completion lists the stdlib's exports (`indexStdExports`).
- **Stream modes** in `src/lib/toolchain/lang/`, hand-ported from the toolchains' TextMate grammars; syntax errors come from the toolchain's `check` (lint channel → `@codemirror/lint`) and `build` (fatal as one error, logged).
- **Panic policy**: a `WebAssembly.RuntimeError` is `error { fatal: true }`; the runner terminates the worker and respawns on the next request; the log says so once.
```

- [ ] **Step 2: `docs/execution-model.md`**

Append a new section before §9 and renumber the later sections (9→10, 10→11, 11→12, 12→13):

```markdown
## 9. Toolchain engines

The `/pm1` and `/tm1` pages keep the five modes and every user action of §§2–7; only the worker mechanics differ. The engine is a pumped wasm session (the toolchains' `docs/wasm.md (sessions)`): `pump(budget)` retires instructions until the budget is spent, a pause fires, or the program ends. A **step is one instruction** (`pump(1)`), which for TM-1 may be one of several instructions behind a single source transition.

| Mode / action | JS engines | Toolchain engines |
|---|---|---|
| Build | `build` → mirror machine rebuilt | `build { lang }` → `built`; seeds kept if bands + alphabets unchanged, else reset (logged); breakpoints re-resolved by `{ file, line }` |
| Step (cold-start / paused) | `run { step }` / `resume { step }` | `start { mode: 'step' }` / `resume { mode: 'step' }` → `stepped` → RUNNING_PAUSED |
| Run, withPause on | `run { intervalMs }` | `start { mode: 'auto', intervalMs }` — `pump(1)`, `idle`, sleep, `busy` per step |
| Run, withPause off | `run` | `start { mode: 'continuous' }` — `pump(TOOLCHAIN_SLICE_BUDGET)` slices, `progress` heartbeats, an event-loop yield between slices |
| Pause (auto) | `pause` | `pause` → next `paused { cause: 'manual' }` |
| Continue | `resume` | `resume { mode }` |
| Stop | terminate | `stop` → `finished { stopped }` → HALTED |
| Take Control | mode flip | `stop`; last snapshots copied into seeds → MANUAL |
| Apply (MANUAL) | mirror write | seed-tape write on the main thread |
| Debug toggle | `setDebug` | `setDebug` — off: no breakpoints registered, a retired `debugger` (`brk`) is not a pause |
| Completion | `ran` | `finished { halted \| stopped \| trapped }` → HALTED; `step-limit` reads as the truncated run; other traps keep the ip highlight on the faulting line |

Pause causes: `breakpoint` (before the instruction at the address; resuming past it does not re-pause), `brk` (a retired `debugger`), `manual`. The watchdog is per segment: armed on `start` / `resume` / `busy`, disarmed on `paused` / `stepped` / `idle` / `finished`. A timeout restores the last `progress` snapshot.

Scenario IDs for this section use the `T-` prefix (node / helper / core / runner tests, `src/lib/toolchain/**/*.test.ts`); component tests keep `C-`, e2e specs use `E-tc-…` (`e2e/toolchain-*.spec.ts`).
```

In §12 (now §13, Scenario ID grammar) add a row:

```markdown
| `T-` | toolchain-engine node scenarios (helpers, worker core, runner, modes, editor extensions). Format `T-<topic>-<facet>`, e.g. `T-pump-breakpoint`, `T-linemap-std`. Used in `src/lib/toolchain/**/*.test.ts`. |
```

and change the regex line to `\b[SRCET]-[a-z-]+`.

- [ ] **Step 3: `README.md`**

Intro: after the existing paragraph, add:

```markdown
Two more tabs, `/pm1` and `/tm1`, run the Rust machine toolchains in the browser: the Post machine PM-1 and the multi-tape Turing machine TM-1, compiled to WebAssembly. You write `.pmc` / `.tmc` source (or `.pma` / `.tma` assembly), Build, and step or run the linked program with the same tape, panel and log; the editor doubles as the debugger — gutter breakpoints, the instruction pointer highlighted on its line, the standard library open in a read-only second tab, lint and canonical formatting from the toolchain itself. Input tapes are edited on the panel or loaded from `.pmt` / `.tmt` tape-block files. The deploy pins one toolchains release; the footer shows its version.
```

Tech list: add `- Machine toolchains wasm bundle (\`mtc-wasm\`, pinned by tag and checksum; fetched on install into a gitignored vendor directory) — PM-1 / TM-1 compile, assemble, lint, format, tape-block codec, and a pumped run session, all in a Web Worker`.

- [ ] **Step 4: Verify the docs build is not affected, commit**

Run: `npm run check && npm run lint` (docs only — sanity), then:

```bash
git add CLAUDE.md docs/execution-model.md README.md
git commit -m "docs: toolchain engines — CLAUDE.md section, execution-model mapping, README"
```

- [ ] **Step 5: Rebase, push, open the PR** (with the user's go-ahead)

```bash
git fetch origin master && git rebase origin/master
npm run check && npm run lint && npm test && npm run test:e2e
git push -u origin feat/136-toolchain-engines
```

PR title: `feat: PM-1 / TM-1 engine pages over the machine-toolchains wasm bundle`. Body: link #136 and the spec; list the surface (build / run / step / lint / format / breakpoints / ip highlight / std tab / std:: completion / assembly kind / tape blocks / Open-Save); note the rc.2 pin and that landing showcases are a follow-up. No Claude attribution.

---

## Self-review notes (written after drafting; fixed inline)

- Spec coverage: bundle pipeline (T1), engine ids + protocol (T2), helpers (T3), worker + pump loops incl. `deviceWait` → error and the panic policy (T4), runner watchdog / stash / respawn (T5), four stream modes (T6), editor generalisation + lint + `std::` completion + go-to-definition (T7), gutter + ip highlight (T8), Toolbar Format / Open / Save + TapesStack actions (T9), examples with seeds + kind + persistence (T10), FileTabs with kind switch (T11), orchestrator incl. seeds / tape blocks / tab-follow / disassemble-on-switch / URL effects + App tabs + footer version (T12), e2e incl. the no-wasm guard (T13), docs (T14). Deploy-side nginx / CSP verification stays an open question for the `mellonis/vps` repo, as the spec says.
- Deviation recorded: the spec's "offers *Disassemble last Build* or *Start blank*" on the kind switch is implemented as: restore the kept buffer for that kind if any, else disassemble when a build exists, else blank — no modal, one deterministic path (T12 `onKindChange`).
- Type consistency checked: `LineMap.addrToLoc / userLineToAddr / stdLineToAddr` (T2, T3, T4, T12); `SeedTape { cells, head }`; `seedToWasm` returns `{ cells, origin, head }`; runner method names (`start`, `resume`, `pause`, `stop`, `setBreakpoints`, `setDebug`, `check`, `format`, `disassemble`, `stdlib`, `decodeTapeBlock`, `encodeTapeBlock`) match between T5 and T12; `showIp` / `scrollToLine` / `refreshBreakpoints` between T8 and T12; `Editor` props `lang` / `extensions` / `readOnly` / `onReady` between T7 and T12; `FileTabs` props between T11 and T12; icon keys between T9 and T12.
