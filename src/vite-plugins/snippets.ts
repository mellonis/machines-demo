import type { Plugin } from 'vite';
import { recordSnippet } from '@turing-machine-js/visuals';
import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';
import type { Example } from '../lib/defaultCode.ts';

type Engine = 'turing' | 'post';

type Options = {
  // Inject for testability; default to importing the real `examples()` helper.
  examples?: (engine: Engine) => readonly Example[] | Promise<readonly Example[]>;
};

const VIRTUAL_ID = 'virtual:snippets';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

// Mirrors machineWorker.ts:280-341 `build()` — eval user code with the engine's
// namespace as `imports`, validate the returned shape, derive the tape block.
// Kept inline (vs extracting to workerHelpers) because the build-time eval
// surface differs in two ways: no sandbox-stub globals (Node lacks `alert` /
// `prompt` anyway), and the plugin needs the tape-block handle for graph
// inspection, not just the per-tape array.
function evalExampleCode(engine: Engine, code: string) {
  const imports: Record<string, unknown> =
    engine === 'post' ? { ...post } : { ...turing };
  const fn = new Function('imports', code) as (
    i: Record<string, unknown>,
  ) => unknown;
  const r = fn(imports);
  if (!r || typeof r !== 'object') {
    throw new Error('example must return { machine, initialState?, tape? }');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = r as { machine?: any; initialState?: any; tape?: any };
  if (!result.machine) throw new Error('example return value missing `machine`');
  const machine = result.machine;
  const initialState = result.initialState ?? machine.initialState ?? null;
  if (!initialState) {
    throw new Error(
      'example missing `initialState` (and machine.initialState absent)',
    );
  }
  const tapeBlock = machine.tapeBlock;
  if (!tapeBlock) throw new Error('example machine has no `tapeBlock`');
  const blockTapes = tapeBlock.tapes;
  const tapes =
    blockTapes && blockTapes.length > 0
      ? [...blockTapes]
      : result.tape
        ? [result.tape]
        : machine.tape
          ? [machine.tape]
          : [];
  if (tapes.length === 0) throw new Error('example produced no tapes');
  return { machine, initialState, tapeBlock, tapes };
}

export function createSnippetsPlugin(opts: Options = {}): Plugin {
  const examplesFn: (
    engine: Engine,
  ) => readonly Example[] | Promise<readonly Example[]> =
    opts.examples ??
    (async (engine) => {
      const mod = await import('../lib/defaultCode.ts');
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
            const { machine, initialState, tapeBlock, tapes } = evalExampleCode(
              engine,
              example.code,
            );
            // graph + alphabets shaped to match what MachineView sends in `built`:
            // engine `State.toGraph(initialState, tapeBlock)`, per-tape alphabet
            // arrays (blank-first by codebase convention).
            const graph = turing.State.toGraph(initialState, tapeBlock);
            const alphabets = tapes.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (t: any) => [...t.alphabet.symbols] as string[],
            );
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
            throw new Error(
              `snippets plugin: failed to record "${example.id}" (${engine}): ${msg}`,
            );
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
