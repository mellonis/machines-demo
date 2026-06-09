import { describe, it, expect } from 'vitest';
import { formatTypeRef } from './format.ts';

describe('hints/format/formatTypeRef', () => {
  it('S-fmt-primitive', () => {
    expect(formatTypeRef({ kind: 'primitive', name: 'string' })).toBe('string');
    expect(formatTypeRef({ kind: 'primitive', name: 'number' })).toBe('number');
    expect(formatTypeRef({ kind: 'primitive', name: 'boolean' })).toBe('boolean');
    expect(formatTypeRef({ kind: 'primitive', name: 'unknown' })).toBe('unknown');
  });

  it('S-fmt-class', () => {
    expect(formatTypeRef({ kind: 'class', name: 'State' })).toBe('State');
  });

  it('S-fmt-shape', () => {
    expect(formatTypeRef({ kind: 'shape', name: 'TapeOptions' })).toBe('TapeOptions');
  });

  it('S-fmt-constants', () => {
    expect(formatTypeRef({ kind: 'constants', name: 'movements' })).toBe('movements');
  });

  it('S-fmt-symbol', () => {
    expect(formatTypeRef({ kind: 'symbol' })).toBe('symbol');
  });

  it('S-fmt-array', () => {
    expect(formatTypeRef({ kind: 'array', of: { kind: 'primitive', name: 'string' } })).toBe('string[]');
    expect(formatTypeRef({ kind: 'array', of: { kind: 'class', name: 'Tape' } })).toBe('Tape[]');
  });

  it('S-fmt-union', () => {
    expect(formatTypeRef({
      kind: 'union',
      of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }],
    })).toBe('string | number');
  });

  it('S-fmt-union-of-arrays-wraps-each-side', () => {
    expect(formatTypeRef({
      kind: 'union',
      of: [
        { kind: 'array', of: { kind: 'primitive', name: 'string' } },
        { kind: 'symbol' },
      ],
    })).toBe('string[] | symbol');
  });

  it('S-fmt-array-of-union-wraps-union-in-parens', () => {
    expect(formatTypeRef({
      kind: 'array',
      of: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'symbol' }] },
    })).toBe('(string | symbol)[]');
  });

  it('S-fmt-literal', () => {
    expect(formatTypeRef({ kind: 'literal', value: 'keep' })).toBe('"keep"');
    expect(formatTypeRef({ kind: 'literal', value: 0 })).toBe('0');
    expect(formatTypeRef({ kind: 'literal', value: true })).toBe('true');
  });
});
