import { describe, it, expect } from 'vitest';
import { namespaceIdentifier } from './namespaceIdentifier.ts';
import { completionAt } from '../../testUtils.ts';

const find = (r: { options: ReadonlyArray<{ label: string; boost?: number; detail?: string }> } | null, label: string) =>
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
    expect(find(r, 'State')).toBeNull();
  });
});
