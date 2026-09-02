import { describe, expect, it } from 'vitest';
import { computeInitialBoot, parseIdParam } from './initialBoot.ts';
import { defaultExample, findExample } from './defaultCode.ts';
import type { Snippets } from './persist.ts';
import type { ExecutionMode } from './graphHighlightDerivation.ts';

const TURING_INITIAL_EXAMPLE = defaultExample('turing');
const POST_INITIAL_EXAMPLE = defaultExample('post');

function makeUrl(query: string): URL {
  return new URL(`http://localhost/turing${query}`);
}

describe('computeInitialBoot — boot-priority decision tree', () => {
  it('M-boot-example-query: ?example=<id> loads the matching bundled example', () => {
    const result = computeInitialBoot({
      engine: 'turing',
      url: makeUrl('?example=toggle-bits'),
      snippets: {},
      loadedCode: null,
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    const expected = findExample('turing', 'toggle-bits')!;
    expect(result.code).toBe(expected.code);
    expect(result.selectedExampleId).toBe('toggle-bits');
    expect(result.loadedSnippetId).toBe(null);
    expect(result.badExampleId).toBe(null);
    expect(result.badUrlId).toBe(null);
  });

  it('M-boot-example-unknown: unknown ?example= surfaces badExampleId and falls through to localStorage / default', () => {
    // No snippet param, no localStorage code → falls to initialExample.
    const result = computeInitialBoot({
      engine: 'turing',
      url: makeUrl('?example=does-not-exist'),
      snippets: {},
      loadedCode: null,
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    expect(result.code).toBe(TURING_INITIAL_EXAMPLE.code);
    expect(result.selectedExampleId).toBe(TURING_INITIAL_EXAMPLE.id);
    expect(result.loadedSnippetId).toBe(null);
    expect(result.badExampleId).toBe('does-not-exist');
    expect(result.badUrlId).toBe(null);

    // With localStorage code populated, that wins over the bundled default
    // (badExampleId still set so onMount logs once).
    const withLocal = computeInitialBoot({
      engine: 'turing',
      url: makeUrl('?example=does-not-exist'),
      snippets: {},
      loadedCode: '// user saved code',
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    expect(withLocal.code).toBe('// user saved code');
    expect(withLocal.badExampleId).toBe('does-not-exist');
  });

  it('M-boot-priority-example-over-snippet: ?example=<id> beats ?snippet=<uuid> when both present', () => {
    const snippets: Snippets = {
      'snippet-uuid-1': { title: 'mine', code: '// snippet code', savedAt: 1 },
    };
    const result = computeInitialBoot({
      engine: 'turing',
      url: makeUrl('?example=toggle-bits&snippet=snippet-uuid-1'),
      snippets,
      loadedCode: '// local code',
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    const expected = findExample('turing', 'toggle-bits')!;
    expect(result.code).toBe(expected.code);
    expect(result.selectedExampleId).toBe('toggle-bits');
    expect(result.loadedSnippetId).toBe(null);
    // Example matched cleanly — both bad-id slots stay null even though
    // the snippet param was carried in the URL.
    expect(result.badExampleId).toBe(null);
    expect(result.badUrlId).toBe(null);
  });

  it('M-boot-priority-snippet-over-localstorage: ?snippet=<uuid> beats localStorage when no example query', () => {
    const snippets: Snippets = {
      'snippet-uuid-2': { title: 'mine', code: '// snippet wins', savedAt: 1 },
    };
    const result = computeInitialBoot({
      engine: 'post',
      url: new URL('http://localhost/post?snippet=snippet-uuid-2'),
      snippets,
      loadedCode: '// local code that should lose',
      initialExample: POST_INITIAL_EXAMPLE,
    });
    expect(result.code).toBe('// snippet wins');
    expect(result.loadedSnippetId).toBe('snippet-uuid-2');
    expect(result.selectedExampleId).toBe(POST_INITIAL_EXAMPLE.id);
    expect(result.badExampleId).toBe(null);
    expect(result.badUrlId).toBe(null);
  });

  it('M-boot-priority-localstorage-over-default: localStorage code wins over the bundled default when no URL params', () => {
    const result = computeInitialBoot({
      engine: 'turing',
      url: makeUrl(''),
      snippets: {},
      loadedCode: '// previously saved editor code',
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    expect(result.code).toBe('// previously saved editor code');
    expect(result.selectedExampleId).toBe(TURING_INITIAL_EXAMPLE.id);
    expect(result.loadedSnippetId).toBe(null);
    expect(result.badExampleId).toBe(null);
    expect(result.badUrlId).toBe(null);

    // And with neither: bundled default.
    const bare = computeInitialBoot({
      engine: 'turing',
      url: makeUrl(''),
      snippets: {},
      loadedCode: null,
      initialExample: TURING_INITIAL_EXAMPLE,
    });
    expect(bare.code).toBe(TURING_INITIAL_EXAMPLE.code);
  });
});

describe('parseIdParam', () => {
  it('M-boot-parse-id-param: empty string and missing both normalise to null; a real value passes through', () => {
    const withValue = new URL('http://localhost/pm1?example=unary-increment&snippet=');
    expect(parseIdParam(withValue, 'example')).toBe('unary-increment');
    expect(parseIdParam(withValue, 'snippet')).toBe(null);
    expect(parseIdParam(withValue, 'missing')).toBe(null);
  });
});

describe('ExecutionMode union', () => {
  it('M-execution-mode-union — no longer accepts DEMO', () => {
    // @ts-expect-error — DEMO removed from the union in Phase 2
    const _bad: ExecutionMode = 'DEMO';
    expect(true).toBe(true);
  });
});
