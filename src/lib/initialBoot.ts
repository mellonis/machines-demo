import { findExample, type Example } from './defaultCode.ts';
import type { Snippets } from './persist.ts';
import type { Engine } from './types.ts';

export type InitialBoot = {
  loadedSnippetId: string | null;
  code: string;
  selectedExampleId: string;
  badUrlId: string | null;
  badExampleId: string | null;
};

export type ComputeInitialBootInput = {
  engine: Engine;
  url: URL;
  snippets: Snippets;
  loadedCode: string | null;
  initialExample: Example;
};

/**
 * Resolve the initial editor state for a MachineView mount.
 *
 * Priority (highest to lowest):
 *   1. `?example=<id>` query — when the id matches a bundled example, the
 *      example's code wins and `selectedExampleId` snaps to it. Unknown ids
 *      fall through and surface via `badExampleId` for the mount-time log.
 *   2. `?snippet=<uuid>` query — when the uuid matches a saved snippet,
 *      that snippet's code wins. Unknown uuids fall through and surface via
 *      `badUrlId` for the mount-time log.
 *   3. localStorage `code` (per-engine) — last editor contents if any.
 *   4. The first bundled example for the engine (provided via
 *      `initialExample`).
 *
 * Pure given inputs; no DOM / localStorage reads. Extracted out of
 * MachineView.svelte so the boot-priority decision tree is unit-testable
 * without mounting the component (worker, mermaid, editor lazy-load).
 */
export function computeInitialBoot({
  engine,
  url,
  snippets,
  loadedCode,
  initialExample,
}: ComputeInitialBootInput): InitialBoot {
  const rawExample = url.searchParams.get('example');
  const exampleId = rawExample !== null && rawExample !== '' ? rawExample : null;
  const rawSnippet = url.searchParams.get('snippet');
  const snippetId = rawSnippet !== null && rawSnippet !== '' ? rawSnippet : null;

  // 1. ?example=<id> wins when the id is known.
  if (exampleId !== null) {
    const ex = findExample(engine, exampleId);
    if (ex !== undefined) {
      return {
        loadedSnippetId: null,
        code: ex.code,
        selectedExampleId: ex.id,
        badUrlId: null,
        badExampleId: null,
      };
    }
  }

  // 2. ?snippet=<uuid> wins when the uuid is in localStorage.
  if (snippetId !== null && snippetId in snippets) {
    return {
      loadedSnippetId: snippetId,
      code: snippets[snippetId].code,
      selectedExampleId: initialExample.id,
      badUrlId: null,
      badExampleId: exampleId,
    };
  }

  // 3. / 4. fall back to localStorage code (else the bundled example).
  return {
    loadedSnippetId: null,
    code: loadedCode ?? initialExample.code,
    selectedExampleId: initialExample.id,
    badUrlId: snippetId,
    badExampleId: exampleId,
  };
}
