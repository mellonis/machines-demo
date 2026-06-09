import { describe, it, expect } from 'vitest';
import type { InferredType, InferredLocals, ImportsBinding } from './types';

describe('scan/types', () => {
  it('S-scan-types-roundtrip', () => {
    const t: InferredType = { kind: 'class', name: 'State' };
    const map: InferredLocals = new Map();
    map.set('x', t);
    const absent: ImportsBinding = { kind: 'absent' };
    expect([t.kind, absent.kind]).toEqual(['class', 'absent']);
  });
});
