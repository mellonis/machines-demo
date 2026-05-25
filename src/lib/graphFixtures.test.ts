import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';
import { examples } from './defaultCode.ts';
import type { Engine } from './types.ts';

/**
 * Fixture-roundtrip test: for each bundled example, evaluate its source
 * code, call `State.toGraph`, and assert deep-equal vs the committed
 * fixture JSON in `tests/fixtures/graphs/`.
 *
 * Purpose: lock in the engine's `Graph` emit shape against accidental
 * drift. When the engine intentionally changes emit (e.g. a v7+ refinement
 * to subgraph layout, halt markers, or tags), the failing diff identifies
 * exactly what changed — refresh fixtures with `REGEN_FIXTURES=1 npm test`.
 *
 * The same fixtures are consumed by `applyHighlight.spec.ts` (the rule
 * tests use them as known-good graph inputs), so engine drift surfaces
 * here before it surfaces in highlight tests downstream.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = resolve(__dirname, '../../tests/fixtures/graphs');

const REGEN = process.env.REGEN_FIXTURES === '1';

type Example = { id: string; title: string; code: string };

const CASES: Array<{ engine: Engine; example: Example }> = [
  ...examples('turing').map((example) => ({ engine: 'turing' as Engine, example })),
  ...examples('post').map((example) => ({ engine: 'post' as Engine, example })),
];

function buildGraph(engine: Engine, code: string): unknown {
  const imports = engine === 'post' ? { ...post } : { ...turing };
  const userFn = new Function('imports', code) as (i: Record<string, unknown>) => unknown;
  const result = userFn(imports) as {
    machine?: { tapeBlock?: unknown; initialState?: unknown };
    initialState?: unknown;
  } | null | undefined;
  if (!result || typeof result !== 'object') {
    throw new Error('user code must return { machine, initialState? }');
  }
  const machine = result.machine;
  if (!machine) throw new Error('return value missing `machine`');
  const initialState = result.initialState ?? machine.initialState;
  if (!initialState) throw new Error('return value missing `initialState`');
  return turing.State.toGraph(
    initialState as turing.State,
    machine.tapeBlock as turing.TapeBlock,
  );
}

describe('graph fixtures', () => {
  for (const { engine, example } of CASES) {
    it(`${engine}/${example.id} matches fixture`, () => {
      const fixturePath = resolve(FIXTURE_DIR, `${engine}-${example.id}.json`);
      const built = buildGraph(engine, example.code);
      const builtJson = JSON.stringify(built, null, 2) + '\n';

      if (REGEN || !existsSync(fixturePath)) {
        writeFileSync(fixturePath, builtJson, 'utf-8');
        // First write or explicit regen: don't assert, leave the fixture in
        // place for review. Re-running without REGEN_FIXTURES will then
        // verify against this snapshot.
        return;
      }

      const fixture = readFileSync(fixturePath, 'utf-8');
      expect(builtJson).toEqual(fixture);
    });
  }
});
