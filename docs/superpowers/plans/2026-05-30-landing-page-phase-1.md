# Landing page Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a `/` landing page with prerecorded snippet panels driven by `visuals.recordSnippet` via a Vite plugin. Ship with one placeholder showcase example per engine (Turing + Post) to prove the pipeline end-to-end. `/turing` and `/post` are untouched; DEMO continues to run.

**Architecture:** New `/` route is a first-class entry (not a redirect to `/turing`). Snippets are recorded at build time by a Vite plugin that runs each `showcase: true` example through `@turing-machine-js/visuals`'s `recordSnippet`, exposing the artifacts as a `virtual:snippets` module. `SnippetPanel.svelte` is pure-playback over a `Snippet` artifact — no worker, no `eval`, IntersectionObserver auto-play with `prefers-reduced-motion` opt-out. `MachineGraph` + `TapesStack` gain a `readOnly?: boolean` prop for showcase use.

**Tech Stack:** Vite + Svelte 5 (runes) + TypeScript. New runtime dep `@turing-machine-js/visuals@^7.0.0-alpha.7`. Tests: Vitest (jsdom + node) + Playwright (E2E).

**Spec source:** [`docs/superpowers/specs/2026-05-27-landing-page-design.md`](../specs/2026-05-27-landing-page-design.md) — read first for full design decisions and rationale.

---

## Task ordering

Tasks 1-3 are foundational (dep + types + build-time pipeline). Tasks 4-5 introduce the new routing. Tasks 6-8 land the landing-page UI. Task 9 is E2E. Each task ships independently; subagent-driven-development can fold tasks 1-2 into a single dispatch if desired.

---

### Task 1: Add `@turing-machine-js/visuals` dependency + ambient types

**Files:**
- Modify: `package.json`
- Modify: `src/vite-env.d.ts` (already declares `virtual:lib-versions` — verify `visualsVersion` is in there)

- [ ] **Step 1: Install `@turing-machine-js/visuals` as a runtime dependency**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo install --save '@turing-machine-js/visuals@next'
```

Expected: `package.json` gains `"@turing-machine-js/visuals": "^7.0.0-alpha.7"` (or whatever alpha.N is current). `package-lock.json` updates.

- [ ] **Step 2: Verify `npm run check` passes**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
```

Expected: no svelte-check errors. (Visuals types should resolve since visuals is already used elsewhere — this is a no-op verification.)

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add package.json package-lock.json
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "deps: add @turing-machine-js/visuals as runtime dep (was peer-only via lib import)"
```

---

### Task 2: Extend `Example` type + flag placeholder showcase examples

**Files:**
- Modify: `src/lib/defaultCode.ts`

- [ ] **Step 1: Extend the `Example` type**

In `src/lib/defaultCode.ts`, locate the `Example` type definition (likely near `TURING_EXAMPLES` / `POST_EXAMPLES`). Add three optional fields:

```ts
export type Example = {
  id: string;
  title: string;
  code: string;
  // Phase 1: showcase flag drives the Vite snippet recorder; description appears
  // as the panel caption; intervalMs overrides the playback default (800ms).
  showcase?: boolean;
  description?: string;
  intervalMs?: number;
};
```

- [ ] **Step 2: Flag one Turing and one Post example as showcase placeholders**

Pick `TURING_REPLACE_B` (or the existing simplest Turing example) and the simplest single-tape Post example. Add `showcase: true` and a temporary `description`:

```ts
// (in the chosen Turing example)
{
  id: 'replace-b',
  title: 'Replace B with A',
  code: '...',
  showcase: true,
  description: 'Placeholder showcase — replace each B with A until blank.',
},
// (in the chosen Post example)
{
  id: '<post-id>',
  title: '...',
  code: '...',
  showcase: true,
  description: 'Placeholder showcase — to be replaced in the content sub-PR.',
},
```

- [ ] **Step 3: Run `npm run check` + tests**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo test
```

Expected: type-check clean, all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/defaultCode.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(examples): extend Example type with showcase/description/intervalMs; flag one example per engine as placeholder showcase"
```

---

### Task 3: Vite plugin — `virtual:snippets`

**Files:**
- Create: `src/vite-plugins/snippets.ts`
- Create: `src/vite-plugins/snippets.test.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the failing plugin tests**

In `src/vite-plugins/snippets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSnippetsPlugin } from './snippets';
import type { Example } from '../lib/defaultCode';

const stubExamples = (engine: 'turing' | 'post'): Example[] => [
  {
    id: 'showcase-1',
    title: 'A',
    code: engine === 'turing'
      ? 'export default ({ machine: { TuringMachine, ... } }) => { /* small program */ }'
      : 'export default ({ post: { ... } }) => { /* small program */ }',
    showcase: true,
    description: 'desc',
  },
  { id: 'not-shown', title: 'B', code: 'export default () => {}' },
];

describe('snippets vite plugin', () => {
  it('V-plugin-emits-virtual-module — resolves virtual:snippets', async () => {
    const plugin = createSnippetsPlugin({
      examples: (engine) => stubExamples(engine),
    });
    const resolved = await (plugin.resolveId as any).call({}, 'virtual:snippets');
    expect(resolved).toBe('\0virtual:snippets');
  });

  it('V-plugin-only-showcase — non-showcase examples are excluded', async () => {
    const plugin = createSnippetsPlugin({ examples: stubExamples });
    const out = await (plugin.load as any).call({}, '\0virtual:snippets');
    expect(out).toMatch(/showcase-1/);
    expect(out).not.toMatch(/not-shown/);
  });

  it('V-plugin-snippet-shape — emitted artifacts match Snippet schema', async () => {
    const plugin = createSnippetsPlugin({ examples: stubExamples });
    const out = await (plugin.load as any).call({}, '\0virtual:snippets');
    // Module source contains JSON.stringify({ turing: [Snippet], post: [Snippet] })
    const match = out.match(/export default (.+);/);
    expect(match).toBeTruthy();
    const data = JSON.parse(match![1]);
    for (const engine of ['turing', 'post'] as const) {
      for (const snippet of data[engine]) {
        expect(snippet).toMatchObject({
          version: 1,
          engine,
          graph: expect.any(Object),
          alphabets: expect.any(Array),
          frames: expect.any(Array),
        });
      }
    }
  });

  it('V-plugin-error-on-runtime-throw — bad example fails the build', async () => {
    const examples = (engine: 'turing' | 'post') => engine === 'turing'
      ? [{ id: 'broken', title: 'X', code: 'throw new Error("nope")', showcase: true }]
      : [];
    const plugin = createSnippetsPlugin({ examples });
    await expect((plugin.load as any).call({}, '\0virtual:snippets'))
      .rejects.toThrow(/broken/);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo vitest run src/vite-plugins/snippets.test.ts
```

Expected: FAIL — `createSnippetsPlugin` not defined.

- [ ] **Step 3: Implement the plugin**

Examples follow the worker's `build()` contract (`src/lib/machineWorker.ts:280-341`):
- `code` is a JS string evaluated via `new Function('imports', code)` (where `imports` is `{...turing}` or `{...post}` depending on engine).
- The code destructures from `imports` and `return`s `{ machine, initialState?, tape? }`.
- `initialState` falls back to `machine.initialState` (post case), then is required.
- `tape` falls back to `machine.tapeBlock.tapes[0]` if present, then to `machine.tape`.

The plugin mirrors that shape. For minimal duplication: implement a small `evalExampleCode(engine, code) → { machine, initialState, tapeBlock, tapes }` helper inline in the plugin file (or extract to `src/lib/workerHelpers.ts` and call from both worker and plugin — discuss with reviewer; the per-PR diff is similar). For now this plan inlines.

Create `src/vite-plugins/snippets.ts`:

```ts
import type { Plugin } from 'vite';
import type { Snippet } from '@turing-machine-js/visuals';
import { recordSnippet } from '@turing-machine-js/visuals';
import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';
import type { Example } from '../lib/defaultCode';

type Engine = 'turing' | 'post';

type Options = {
  // Inject for testability; default to importing the real `examples()` helper.
  examples?: (engine: Engine) => readonly Example[];
};

const VIRTUAL_ID = 'virtual:snippets';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

// Mirrors machineWorker.ts:280-341 `build()` — eval user code with the engine's
// namespace as `imports`, validate the returned shape, derive the tape block.
function evalExampleCode(engine: Engine, code: string) {
  const imports = engine === 'post' ? { ...post } : { ...turing };
  const fn = new Function('imports', code) as (i: Record<string, unknown>) => unknown;
  const r = fn(imports);
  if (!r || typeof r !== 'object') {
    throw new Error('example must return { machine, initialState?, tape? }');
  }
  const result = r as { machine?: any; initialState?: any; tape?: any };
  if (!result.machine) throw new Error('example return value missing `machine`');
  const machine = result.machine;
  const initialState = result.initialState ?? machine.initialState ?? null;
  if (!initialState) throw new Error('example missing `initialState` (and machine.initialState absent)');
  const tapeBlock = machine.tapeBlock;
  if (!tapeBlock) throw new Error('example machine has no `tapeBlock`');
  const tapes = tapeBlock.tapes ?? (result.tape ? [result.tape] : machine.tape ? [machine.tape] : []);
  if (tapes.length === 0) throw new Error('example produced no tapes');
  return { machine, initialState, tapeBlock, tapes };
}

export function createSnippetsPlugin(opts: Options = {}): Plugin {
  const examplesFn: (engine: Engine) => Promise<readonly Example[]> | readonly Example[] =
    opts.examples ?? (async (engine) => {
      const mod = await import('../lib/defaultCode');
      return mod.examples(engine);
    });

  return {
    name: 'machines-demo:snippets',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;

      const out: Record<Engine, unknown[]> = { turing: [], post: [] };

      for (const engine of ['turing', 'post'] as const) {
        const examples = await examplesFn(engine);
        for (const example of examples) {
          if (!example.showcase) continue;
          try {
            const { machine, initialState, tapeBlock, tapes } = evalExampleCode(engine, example.code);
            // graph + alphabets shaped like machineWorker.ts:662-669 sends in `built`.
            const graph = turing.State.toGraph(initialState, tapeBlock);
            const alphabets = tapes.map((t: any) => [...t.alphabet.symbols]);
            const snippet = recordSnippet({
              machine,
              initialState,
              graph,
              alphabets,
              name: example.title,
              maxSteps: 1000,
            });
            out[engine].push({
              ...snippet,
              engine,
              id: example.id,
              description: example.description,
              intervalMs: example.intervalMs,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`snippets plugin: failed to record "${example.id}" (${engine}): ${msg}`);
          }
        }
      }

      return `export default ${JSON.stringify(out)};`;
    },

    handleHotUpdate(ctx) {
      // Re-record when defaultCode.ts changes.
      if (ctx.file.endsWith('/defaultCode.ts')) {
        const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
        return [];
      }
    },
  };
}
```

VERIFIED against `@turing-machine-js/visuals@7.0.0-alpha.7`'s `recordSnippet.d.ts`:
- `RecordSnippetOptions = { machine: TuringMachine; initialState: State; graph: Graph; alphabets: string[][]; name?; maxSteps?; log? }` — `alphabets` is exactly per-tape `string[][]`, matching `tapes.map(t => [...t.alphabet.symbols])`.
- `Snippet` itself has NO `engine` / `id` / `description` / `intervalMs` fields — those are extension fields the plugin attaches on top. The plan's extension shape is correct.

Post engine note: `PostMachine extends TuringMachine` (see `node_modules/@post-machine-js/machine/dist/classes/PostMachine.d.ts`), so the post example's `{ machine }` IS a TuringMachine — pass directly to `recordSnippet` with no unwrap. `pm.initialState` is exposed as a getter (overriding the engine's).

- [ ] **Step 4: Wire the plugin into vite.config.ts**

In `vite.config.ts`, import and register:

```ts
import { createSnippetsPlugin } from './src/vite-plugins/snippets';
// in plugins: [...]
plugins: [
  // existing
  svelte(),
  createSnippetsPlugin(),
],
```

- [ ] **Step 5: Run tests + build**

```bash
npx --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo vitest run src/vite-plugins/snippets.test.ts
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run build
```

Expected: tests pass, build succeeds and emits the virtual module.

- [ ] **Step 6: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/vite-plugins vite.config.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(snippets): vite plugin emitting virtual:snippets via visuals.recordSnippet"
```

---

### Task 4: Routing — discriminated union + pure helpers

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/routing.ts`
- Create: `src/lib/routing.test.ts`

- [ ] **Step 1: Add `Route` type to `src/lib/types.ts`**

```ts
import type { Engine } from './types';

export type Route =
  | { kind: 'landing' }
  | { kind: 'engine'; engine: Engine };
```

- [ ] **Step 2: Write failing routing tests**

In `src/lib/routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readRouteFromUrl, readEngineFromLandingQuery, legacyMachineRewrite } from './routing';

describe('routing helpers', () => {
  it('R-route-landing-from-root', () => {
    expect(readRouteFromUrl('/')).toEqual({ kind: 'landing' });
  });
  it('R-route-landing-from-unknown', () => {
    expect(readRouteFromUrl('/foo')).toEqual({ kind: 'landing' });
  });
  it('R-route-engine-turing', () => {
    expect(readRouteFromUrl('/turing')).toEqual({ kind: 'engine', engine: 'turing' });
  });
  it('R-route-engine-post', () => {
    expect(readRouteFromUrl('/post')).toEqual({ kind: 'engine', engine: 'post' });
  });
  it('R-route-landing-engine-query — defaults to turing', () => {
    expect(readEngineFromLandingQuery('')).toBe('turing');
    expect(readEngineFromLandingQuery('?engine=post')).toBe('post');
    expect(readEngineFromLandingQuery('?engine=bogus')).toBe('turing');
  });
  it('R-route-legacy-machine-rewrite', () => {
    const url = legacyMachineRewrite(new URL('http://x.test/?machine=post'));
    expect(url.pathname).toBe('/post');
    expect(url.searchParams.has('machine')).toBe(false);
  });
});
```

- [ ] **Step 3: Run failing tests**

```bash
npx --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo vitest run src/lib/routing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/routing.ts`**

```ts
import { ENGINES, type Engine } from './types';
import type { Route } from './types';

export function readRouteFromUrl(pathname: string): Route {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  if ((ENGINES as readonly string[]).includes(seg)) {
    return { kind: 'engine', engine: seg as Engine };
  }
  return { kind: 'landing' };
}

export function readEngineFromLandingQuery(search: string): Engine {
  const params = new URLSearchParams(search);
  const raw = params.get('engine');
  return (ENGINES as readonly string[]).includes(raw ?? '') ? (raw as Engine) : 'turing';
}

export function legacyMachineRewrite(url: URL): URL {
  const legacy = url.searchParams.get('machine');
  if (legacy !== null) {
    url.searchParams.delete('machine');
    if ((ENGINES as readonly string[]).includes(legacy)) {
      url.pathname = '/' + legacy;
    }
  }
  return url;
}
```

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/types.ts src/lib/routing.ts src/lib/routing.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(routing): extract pure route helpers + discriminated Route union"
```

---

### Task 5: App.svelte route swap — render Landing on `/`

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Replace `activeEngine` with `route`**

Swap the mount/popstate logic to use `readRouteFromUrl(window.location.pathname)`. Strip the old "normalise unknown paths to /turing" block. Add a `selectRoute(route)` helper (replaces `selectEngine`); header tabs always `pushState('/' + engine)`. Landing renders `<Landing />` (new component, created in Task 8 — for now, a placeholder `<div>Landing</div>` so this task is self-contained).

Sketch:

```ts
import { readRouteFromUrl, readEngineFromLandingQuery, legacyMachineRewrite } from './lib/routing';
import type { Route } from './lib/types';
import Landing from './components/Landing.svelte'; // wired in Task 8

let route = $state<Route>({ kind: 'landing' });

onMount(() => {
  const url = legacyMachineRewrite(new URL(window.location.href));
  if (url.href !== window.location.href) history.replaceState(null, '', url);
  route = readRouteFromUrl(window.location.pathname);
  const onPopState = () => { route = readRouteFromUrl(window.location.pathname); };
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
});

function selectRoute(next: Route): void {
  if (route.kind === next.kind && (next.kind === 'landing' || next.engine === (route as any).engine)) return;
  route = next;
  history.pushState(null, '', next.kind === 'landing' ? '/' : '/' + next.engine);
}
```

Header tab buttons:

```svelte
<button
  type="button"
  class:active={route.kind === 'engine' && route.engine === 'turing'}
  onclick={() => selectRoute({ kind: 'engine', engine: 'turing' })}
>Turing</button>
<!-- analogous for post -->
```

Main:

```svelte
<main>
  {#if route.kind === 'landing'}
    <Landing />
  {:else}
    {#key route.engine}
      <MachineView engine={route.engine} />
    {/key}
  {/if}
</main>
```

- [ ] **Step 2: Stub `src/components/Landing.svelte` so App compiles**

```svelte
<script lang="ts"></script>
<div class="landing-stub">Landing (placeholder)</div>
```

- [ ] **Step 3: `npm run check` + dev-server smoke test**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
```

Expected: clean. Manually verify in dev (`npm run dev`) that:
- `/` shows the Landing stub
- `/turing` and `/post` show their MachineView
- Clicking header tabs navigates
- `?machine=post` legacy URL still rewrites to `/post`

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/App.svelte src/components/Landing.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(routing): App renders Landing on /, MachineView on engine paths"
```

---

### Task 6: `readOnly` prop on `MachineGraph` + `TapesStack`

**Files:**
- Modify: `src/components/MachineGraph.svelte`
- Modify: `src/components/TapesStack.svelte`

- [ ] **Step 1: Add `readOnly?: boolean` prop to `MachineGraph.svelte`**

```svelte
<script lang="ts">
  // existing props
  let { graph, readOnly = false }: { graph: Graph; readOnly?: boolean } = $props();
</script>
```

Gate breakpoint click handlers and the collapse toggle on `!readOnly`. Search for `onclick` handlers in the component and wrap each interactive surface with `if (readOnly) return;` or guard the markup with `{#if !readOnly}`.

- [ ] **Step 2: Add `readOnly?: boolean` prop to `TapesStack.svelte`**

Same shape. Gate the caret-edit affordance and copy-paste handlers on `!readOnly`. The imperative `setFromTape` / `clearAll` API still works; only the user-facing interactions are disabled.

- [ ] **Step 3: `npm run check` + existing tests**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo test
```

Expected: no new failures; default `readOnly = false` preserves existing behavior for MachineView.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/MachineGraph.svelte src/components/TapesStack.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(components): readOnly prop on MachineGraph + TapesStack for showcase reuse"
```

---

### Task 7: `SnippetPanel.svelte` — pure playback component

**Files:**
- Create: `src/components/SnippetPanel.svelte`
- Create: `src/components/SnippetPanel.test.ts`

- [ ] **Step 1: Write failing component tests**

In `src/components/SnippetPanel.test.ts` (`// @vitest-environment happy-dom` pragma at top):

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SnippetPanel from './SnippetPanel.svelte';
import type { Snippet } from '@turing-machine-js/visuals';

const stubSnippet = (): Snippet & { id: string; description?: string } => ({
  version: 1,
  engine: 'turing',
  id: 'showcase-1',
  description: 'A test snippet',
  graph: { /* minimal valid Graph stub */ } as any,
  alphabets: [[' ', 'a', 'b']],
  tape: { tapes: [{ symbols: ['a','b'], position: 0 }] } as any,
  frames: [
    { step: 0, tape: [{ symbols: ['a','b'], position: 0 }], highlight: null },
    { step: 1, tape: [{ symbols: ['b','b'], position: 1 }], highlight: null },
  ] as any,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SnippetPanel', () => {
  it('S-snippet-panel-renders-caption', () => {
    render(SnippetPanel, { snippet: stubSnippet() });
    expect(screen.getByText(/A test snippet/)).toBeInTheDocument();
  });

  it('S-snippet-panel-static-on-mount', () => {
    render(SnippetPanel, { snippet: stubSnippet() });
    // Without IntersectionObserver firing, panel sits on frame 0.
    // (verify via a data-testid="snippet-frame-index" attr the component exposes)
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('0');
  });

  // ... S-snippet-panel-autoplay-on-intersect / S-freeze-at-halt / S-replay-resets
  // / S-reduced-motion / S-deep-link
});
```

(The IntersectionObserver test uses `vi.stubGlobal('IntersectionObserver', ...)` with a manual `trigger(isIntersecting)` method.)

- [ ] **Step 2: Run failing tests**

Expected: FAIL — component not defined.

- [ ] **Step 3: Implement `SnippetPanel.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import MachineGraph from './MachineGraph.svelte';
  import TapesStack from './TapesStack.svelte';
  import type { Snippet } from '@turing-machine-js/visuals';

  type Props = { snippet: Snippet & { id: string; description?: string; intervalMs?: number } };
  let { snippet }: Props = $props();

  const DEFAULT_INTERVAL_MS = 800;
  const intervalMs = snippet.intervalMs ?? DEFAULT_INTERVAL_MS;

  let frameIndex = $state(0);
  let playing = $state(false);
  let done = $state(false);
  let reducedMotion = false;
  let panelEl: HTMLDivElement;
  let timer: ReturnType<typeof setInterval> | null = null;

  function advance() {
    if (frameIndex >= snippet.frames.length - 1) {
      stop();
      done = true;
      return;
    }
    frameIndex += 1;
    applyFrame();
  }

  function applyFrame() {
    // (apply highlight to the graph + tape snapshot to TapesStack imperatively
    // via refs — exact shape depends on MachineGraph/TapesStack APIs)
  }

  function play() {
    if (playing) return;
    playing = true;
    timer = setInterval(advance, intervalMs);
  }

  function stop() {
    playing = false;
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function replay() {
    stop();
    frameIndex = 0;
    done = false;
    applyFrame();
    play();
  }

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      frameIndex = snippet.frames.length - 1; // halt frame
      done = true;
      applyFrame();
    } else {
      const io = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) { io.disconnect(); play(); } },
        { threshold: 0.5 },
      );
      io.observe(panelEl);
      return () => io.disconnect();
    }
  });

  $effect(() => { applyFrame(); }); // re-apply on mount
</script>

<div class="snippet-panel" bind:this={panelEl}>
  <h3>{snippet.description ?? snippet.id}</h3>
  <MachineGraph graph={snippet.graph} readOnly />
  <TapesStack tapeCount={snippet.tape.tapes.length} readOnly />
  <div class="meta" data-testid="snippet-frame-index">{frameIndex}</div>
  <div class="controls">
    {#if done}
      <button type="button" onclick={replay}>{reducedMotion ? 'Play' : 'Replay'}</button>
    {/if}
    <a href={`/${snippet.engine}?example=${snippet.id}`} class="open-in-editor">
      Open in editor
    </a>
  </div>
</div>

<style>
  /* layout/styling — match the design system */
</style>
```

NOTE: applying frames imperatively to `MachineGraph` / `TapesStack` likely requires they expose imperative methods or accept a reactive `highlight` / `tape` prop. Decide during implementation; if a refactor is needed it may bleed back into Task 6.

- [ ] **Step 4: Run tests until they pass**

```bash
npx --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo vitest run src/components/SnippetPanel.test.ts
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/SnippetPanel.svelte src/components/SnippetPanel.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(components): SnippetPanel — pure-playback with IntersectionObserver auto-play + reduced-motion opt-out"
```

---

### Task 8: `Landing.svelte` — full landing view

**Files:**
- Modify: `src/components/Landing.svelte` (was a stub in Task 5)

- [ ] **Step 1: Replace the stub with the real landing view**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import SnippetPanel from './SnippetPanel.svelte';
  import snippets from 'virtual:snippets';
  import { readEngineFromLandingQuery } from '../lib/routing';
  import type { Engine } from '../lib/types';

  let engine = $state<Engine>('turing');

  onMount(() => {
    engine = readEngineFromLandingQuery(window.location.search);
    const onPopState = () => { engine = readEngineFromLandingQuery(window.location.search); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  function setEngine(next: Engine) {
    if (next === engine) return;
    engine = next;
    const url = new URL(window.location.href);
    if (next === 'turing') url.searchParams.delete('engine');
    else url.searchParams.set('engine', next);
    history.pushState(null, '', url);
  }

  const currentSnippets = $derived(snippets[engine] ?? []);
</script>

<section class="landing">
  <header>
    <h1>Turing & Post machines, visualised</h1>
    <p>Each panel is a small program that runs to halt. Click <em>Open in editor</em> to step through it yourself.</p>
  </header>

  <nav class="engine-switcher" role="tablist">
    <button type="button" class:active={engine === 'turing'} onclick={() => setEngine('turing')}>Turing snippets</button>
    <button type="button" class:active={engine === 'post'} onclick={() => setEngine('post')}>Post snippets</button>
  </nav>

  <div class="snippet-grid">
    {#each currentSnippets as snippet (snippet.id)}
      <SnippetPanel {snippet} />
    {/each}
  </div>
</section>

<style>
  /* layout */
</style>
```

- [ ] **Step 2: Update App.svelte to render header tabs with no active state on landing**

In App.svelte's header tabs:

```svelte
<button
  type="button"
  class:active={route.kind === 'engine' && route.engine === 'turing'}
  onclick={() => selectRoute({ kind: 'engine', engine: 'turing' })}
>Turing</button>
```

(Already done in Task 5 — verify the `class:active` predicate is correctly false on landing.)

- [ ] **Step 3: `npm run check` + dev smoke**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run dev
```

Manually verify:
- `/` renders the landing page with one Turing snippet panel
- Engine switcher swaps to Post snippet, URL becomes `/?engine=post`
- "Open in editor" navigates to `/turing?example=<id>`
- Header tabs render with no active state on landing
- `prefers-reduced-motion` (devtools rendering panel → emulate) shows the halt frame statically

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/Landing.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(landing): real Landing view with engine switcher + virtual:snippets binding"
```

---

### Task 9: E2E — `e2e/landing.spec.ts`

**Files:**
- Create: `e2e/landing.spec.ts`

- [ ] **Step 1: Write the E2E specs**

```ts
import { test, expect } from '@playwright/test';

test.describe('landing', () => {
  test('renders snippet panels on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Turing & Post machines/ })).toBeVisible();
    await expect(page.locator('.snippet-panel')).toHaveCount(1); // one placeholder per engine; phase-1 default = turing
  });

  test('engine switch updates URL and panels', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Post snippets/ }).click();
    await expect(page).toHaveURL(/\?engine=post/);
    await expect(page.locator('.snippet-panel')).toHaveCount(1);
  });

  test('deep link to editor opens the example', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /Open in editor/ });
    await link.click();
    await expect(page).toHaveURL(/\/turing\?example=/);
    // MachineView visible
    await expect(page.locator('[data-testid="tape-cell"]').first()).toBeVisible();
  });

  test('header tab navigates from landing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Turing' }).click();
    await expect(page).toHaveURL('/turing');
  });

  test('scroll triggers playback', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('.snippet-panel').first();
    await panel.scrollIntoViewIfNeeded();
    // After intervalMs * frames + epsilon, the panel reaches done state
    await expect(panel.getByRole('button', { name: /Replay/ })).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run test:e2e -- e2e/landing.spec.ts
```

Expected: all 5 scenarios pass.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add e2e/landing.spec.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "test(e2e): landing page — render + engine switch + deep-link + scroll-play"
```

---

## Wrap-up

After Task 9:

- [ ] Open PR against master with the full series of Phase-1 commits
- [ ] PR description summarizes the new `/` route, the Vite plugin, the SnippetPanel, and links to the spec
- [ ] Once merged, the content sub-PR (3 curated examples per engine) and Phase 2 (DEMO-mode retirement) become independent follow-ups

## Out of scope (for this plan)

- Phase 2 — DEMO-mode retirement (separate plan)
- Content sub-PR — three curated examples per engine (separate plan)
- Anything in the spec's "Out of scope" section (mobile polish, interactive snippet editing, snippet authoring UI, multi-tape Post snippets, etc.)
