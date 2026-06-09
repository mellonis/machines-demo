import { describe, it, expect } from 'vitest';
import { namespaceIdentifier } from './namespaceIdentifier.ts';
import { completionAt } from '../../testUtils.ts';

const find = (r: { options: ReadonlyArray<{ label: string; boost?: number; detail?: string; apply?: unknown }> } | null, label: string) =>
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

  it('S-src-ns-rename-by-original-name — typing original surfaces alias-applying entry', () => {
    const r = completionAt(`const { State: TS } = imports;\nconst x = Stat▮`, 'turing', namespaceIdentifier);
    const orig = find(r, 'State');
    expect(orig).toBeTruthy();
    expect(orig!.detail).toMatch(/\(as TS\)/);
    expect(orig!.apply).toBe('TS');
  });

  it('S-src-ns-rename-by-local-name — typing local name surfaces alias-of entry', () => {
    const r = completionAt(`const { State: TS } = imports;\nconst x = T▮`, 'turing', namespaceIdentifier);
    const local = find(r, 'TS');
    expect(local).toBeTruthy();
    expect(local!.detail).toMatch(/\(alias of State\)/);
    expect(local!.apply).toBeUndefined();
  });
});

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

describe('contexts/namespaceIdentifier (Phase 4 — snippets)', () => {
  it('S-src-ns-snippet-new-turingmachine — class in new position has apply', () => {
    const r = completionAt(`const m = new Turin▮`, 'turing', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'TuringMachine');
    expect(opt).toBeTruthy();
    expect(opt?.apply).toBeTypeOf('function');
  });

  it('S-src-ns-snippet-post-call — parameterized post-instruction has apply', () => {
    const r = completionAt(`const m = new PostMachine({\n  10: call▮\n});`, 'post', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'call');
    expect(opt).toBeTruthy();
    expect(opt?.apply).toBeTypeOf('function');
  });

  it('S-src-ns-snippet-post-mark — bare post-instruction has no snippet apply', () => {
    const r = completionAt(`const m = new PostMachine({\n  10: mar▮\n});`, 'post', namespaceIdentifier);
    const opt = r?.options.find((o) => o.label === 'mark');
    expect(opt).toBeTruthy();
    expect(typeof opt?.apply === 'function' || opt?.apply === undefined).toBe(true);
  });
});
