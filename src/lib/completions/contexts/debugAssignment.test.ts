import { describe, it, expect } from 'vitest';
import { debugAssignment } from './debugAssignment.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: ReadonlyArray<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/debugAssignment', () => {
  it('S-src-debug-rhs-state — full menu', () => {
    const r = completionAt(`const s = new State({});\ns.debug = ▮`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual([
      'false',
      'true',
      '{ after: true }',
      '{ before: true }',
      '{ before: true, after: true }',
    ]);
  });

  it('S-src-debug-rhs-halt — boolean-only', () => {
    const r = completionAt(`haltState.debug = ▮`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['false', 'true']);
  });

  it('S-src-debug-keys-state — full', () => {
    const r = completionAt(`const s = new State({});\ns.debug = { ▮ };`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['after', 'before']);
  });

  it('S-src-debug-keys-state-partial — only after remains', () => {
    const r = completionAt(`const s = new State({});\ns.debug = { before: true, ▮ };`, 'turing', debugAssignment);
    expect(labelsOf(r)).toEqual(['after']);
  });

  it('S-src-debug-out-of-context — null', () => {
    const r = completionAt(`const s = new State({});\ns.foo = ▮`, 'turing', debugAssignment);
    expect(r).toBeNull();
  });
});
