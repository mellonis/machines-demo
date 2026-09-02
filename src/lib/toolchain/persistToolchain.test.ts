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
