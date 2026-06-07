import { describe, it, expect } from 'vitest';
import type { EngineSchema, TypeRef, NamespaceEntry } from './types.ts';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';
import { getSchema } from './index.ts';

describe('schema/types', () => {
  it('S-schema-types-roundtrip — example TypeRef constructions compile', () => {
    const prim: TypeRef = { kind: 'primitive', name: 'string' };
    const cls: TypeRef = { kind: 'class', name: 'State' };
    const ns: NamespaceEntry = { kind: 'class', classRef: 'State', detail: '' };
    const schema: EngineSchema = {
      namespace: {},
      classes: {},
      shapes: {},
      constants: {},
    };
    expect([prim.kind, cls.kind, ns.kind, Object.keys(schema).length]).toEqual([
      'primitive',
      'class',
      'class',
      4,
    ]);
  });
});

describe('TURING_SCHEMA (Phase 1)', () => {
  it('S-schema-turing-has-required-namespace-entries — covers the State debug surface', () => {
    const required = ['Alphabet', 'State', 'Tape', 'TapeBlock', 'TuringMachine', 'haltState', 'ifOtherSymbol', 'movements', 'symbolCommands'];
    for (const name of required) {
      expect(TURING_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-turing-state-class-has-debug-members — needed for Phase 1 memberAccess', () => {
    const memberNames = TURING_SCHEMA.classes.State.members.map((m) => m.name);
    expect(memberNames).toEqual(expect.arrayContaining(['debug', 'tag', 'withOverriddenHaltState']));
  });

  it('S-schema-turing-statedebug-shape-has-before-after', () => {
    expect(TURING_SCHEMA.shapes.StateDebug.keys.map((k) => k.name)).toEqual(['before', 'after']);
  });

  it('S-schema-turing-movements-constants', () => {
    expect(TURING_SCHEMA.constants.movements.keys).toEqual(['left', 'right', 'stay']);
  });

  it('S-schema-turing-symbolCommands-constants', () => {
    expect(TURING_SCHEMA.constants.symbolCommands.keys).toEqual(['keep', 'erase']);
  });
});

describe('POST_SCHEMA (Phase 1)', () => {
  it('S-schema-post-has-required-namespace-entries', () => {
    const required = [
      'PostMachine', 'Tape', 'State', 'haltState',
      'alphabet', 'blankSymbol', 'markSymbol',
      'mark', 'erase', 'noop', 'left', 'right', 'stop', 'call', 'check', '$tag',
    ];
    for (const name of required) {
      expect(POST_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-post-instruction-bare', () => {
    expect(POST_SCHEMA.namespace.mark.kind).toBe('post-instruction');
  });

  it('S-schema-post-instruction-parameterized', () => {
    expect(POST_SCHEMA.namespace.call.kind).toBe('post-instruction');
    const callEntry = POST_SCHEMA.namespace.call;
    if (callEntry.kind === 'post-instruction') {
      expect(callEntry.params).toEqual([{ name: 'label', type: { kind: 'primitive', name: 'string' } }]);
    }
  });
});

describe('getSchema', () => {
  it('S-schema-getSchema-turing', () => {
    expect(getSchema('turing').namespace.State.kind).toBe('class');
  });

  it('S-schema-getSchema-post', () => {
    expect(getSchema('post').namespace.PostMachine.kind).toBe('class');
  });
});
